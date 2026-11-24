// Harrying the countryside (systems/harrying.js, player/harrying.js): in a war
// the player's riders burn an enemy village, fire its crops and its mill,
// drive off its herds, scatter or slaughter its peasants — and the damage is
// real and read (production, granary food, rents and the crown's taxes, the
// revolt's hunger, the realm's stability), recovers over seasons with real
// timber, the realm answers with a pursuit host paid out of its treasury, AI
// realms at war harry each other, and no coin or good is made from nothing.
// On a real generated world.

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { Utils } from '../core/utils.js';
import { Harrying } from '../systems/harrying.js';
import { PlayerHarrying } from '../player/harrying.js';
import { RealmWars } from '../systems/realmWars.js';
import { Atrocities } from '../systems/atrocities.js';
import { TownMemory } from '../systems/townMemory.js';
import { PeasantRevolts } from '../systems/peasantRevolts.js';
import { Livestock } from '../systems/livestock.js';
import { Harvests } from '../world/harvests.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { KingdomStability } from '../world/kingdomState.js';
import { NPCLords } from '../world/npcLords.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { loadData, endDay } from './playtest/harness.js';
import { coinGame, measure } from './playtest/coinCheck.js';

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => Utils.resetRng());

function armyOf(type, n) {
    const def = Object.values(PlayerMilitary.UNIT_TYPES).find(u => u.id === type);
    return Array.from({ length: n }, () => PlayerMilitary.makeArmyUnit(def));
}

const views = (world) => world.getSettlementViews();
const realmPop = (world, kid) => views(world).filter(s => s.kingdom === kid).reduce((a, s) => a + (s.population || 0), 0);

/** A live game, the player standing at a village of a realm they are at war with, with soldiers. */
function setup(seed = 101) {
    const game = coinGame(seed, 1);
    const { world, player } = game;
    // (a realm's town or village — not its capital — with other towns of the realm to flee to)
    const v = views(world).filter(s => s.kingdom != null && s.type !== 'capital' && (s.population || 0) > 150)
        .find(s => views(world).filter(t => t.kingdom === s.kingdom && t !== s).length >= 2);
    expect(v).toBeTruthy();
    const s = world.getTile(v.q, v.r).settlement;
    const k = world.getKingdom(s.kingdom);
    player.allegiance = null;
    player.q = s.q; player.r = s.r;
    player.army = armyOf('soldier', 12);
    player.actionPoints = 60;
    player.inventory = {};
    RealmWars.declareWar(player, world, k, 'test');
    // (the levy is tested on its own: here it has already been beaten today)
    Harrying.scar(s).foughtDay = world.day;
    const tile = world.getTile(s.q, s.r);
    return { game, world, player, s, k, tile };
}

describe('Harrying — who may harry', () => {
    it('is offered only at war with the town\'s realm, and only with soldiers', () => {
        const ctx = setup();
        const { world, player, tile, k } = ctx;
        expect(PlayerHarrying.available(player, world, tile)).toBe(true);
        const opts = PlayerHarrying.options(player, world, tile);
        expect(opts.map(o => o.id)).toEqual(Harrying.ACTS);
        expect(opts.find(o => o.id === 'torch').ok).toBe(true);
        // No army: greyed with the reason
        const army = player.army;
        player.army = [];
        expect(PlayerHarrying.available(player, world, tile)).toBe(false);
        expect(PlayerHarrying.options(player, world, tile)[0].why).toMatch(/soldiers/);
        player.army = army;
        // At peace: not offered
        RealmWars.endWar(player, world, k.id, 'bought');
        expect(PlayerHarrying.available(player, world, tile)).toBe(false);
        expect(PlayerHarrying.why(player, world, tile)).toMatch(/not at war/);
    });

    it('the levy turns out against the first harrying of a day', () => {
        const ctx = setup();
        const { world, player, s } = ctx;
        delete s.harried.foughtDay;
        const levy = PlayerHarrying.resistance(player, world, s);
        expect(levy).toBeGreaterThan(0);
        player.army = armyOf('soldier', 40);
        const r = PlayerHarrying.act(player, world, 'fields');
        expect(r.success).toBe(true);
        expect(r.battle).toBeTruthy();
        // Beaten today, it does not turn out again
        if (r.battle.victory) expect(PlayerHarrying.resistance(player, world, s)).toBe(0);
    });
});

describe('Harrying — the damage is real, and read', () => {
    it('torching a village: houses burned, the dead, the refugees in the realm\'s other towns, the stores, the street map', () => {
        const ctx = setup();
        const { world, player, s, k } = ctx;
        SettlementMarket.add(s, 'grain', 40);
        const pop0 = s.population, realm0 = realmPop(world, k.id), dmg0 = s.damage || 0;
        const grain0 = SettlementMarket.stock(s, 'grain');
        const food0 = s.economy.food;
        const r = PlayerHarrying.act(player, world, 'torch');
        expect(r.success).toBe(true);
        expect(s.damage).toBeGreaterThanOrEqual(Math.min(0.9, dmg0 + Harrying.config().acts.torch.damage[s.type || 'village']) - 1e-6);
        expect(s.population).toBe(pop0 - r.dead - r.fled);
        // The refugees are real people in the realm's other towns: only the dead left the realm
        expect(r.fled).toBeGreaterThan(0);
        expect(realmPop(world, k.id)).toBe(realm0 - r.dead);
        expect(views(world).some(t => t !== s && t.labour && t.labour.from && t.labour.from[`${s.q},${s.r}`] > 0)).toBe(true);
        // What the men carried is what left the market (no grain from nowhere); the rest burned
        const carried = r.carried.grain || 0;
        expect(player.inventory.grain || 0).toBe(carried);
        expect(SettlementMarket.stock(s, 'grain')).toBeLessThan(grain0 - carried + 1e-6);
        expect(s.economy.food).toBeLessThan(food0);
        // Burnt shells on the street map, remembered
        expect((s.memory.marks || []).some(m => m.k === 'fire' && m.cause === 'harrying')).toBe(true);
        // The name it leaves: the realm's regard, the lord's memory
        expect(player.reputation[k.id]).toBeLessThan(-60);
        expect(NPCLords.memoryOpinion(k.lord, world.day)).toBeLessThan(0);
        expect(Atrocities.state(player).stats.harry).toBe(1);
        // Done once: greyed until there is something to burn again
        expect(PlayerHarrying.options(player, world, ctx.tile).find(o => o.id === 'torch').why).toMatch(/Already/);
    });

    it('firing the standing crops: the harvest in force falls — market grain, granary food, rents, revolt hunger — and the next reckoning', () => {
        const ctx = setup(202);
        const { world, player, s } = ctx;
        world.day = Math.floor(world.day / 120) * 120 + 35; // high summer
        Harrying.scar(s).foughtDay = world.day;
        Harvests.ensureFarm(world, s);
        const gf0 = Harvests.grainFactor(s), ff0 = Harvests.foodFactor(world, s), rf0 = Harvests.rentFactor(s);
        const prod0 = Harvests.applyToProduction(world, s, { grain: 10 }).grain;
        const hunger0 = (PeasantRevolts.pressure(world, s).parts.find(p => p.id === 'hunger') || { v: 0 }).v;
        const r = PlayerHarrying.act(player, world, 'fields');
        expect(r.success).toBe(true);
        expect(r.standing).toBe(true);
        expect(Harvests.grainFactor(s)).toBeLessThan(gf0);
        expect(Harvests.foodFactor(world, s)).toBeLessThan(ff0);
        expect(Harvests.rentFactor(s)).toBeLessThan(rf0);
        expect(Harvests.applyToProduction(world, s, { grain: 10 }).grain).toBeLessThan(prod0);
        const hunger1 = (PeasantRevolts.pressure(world, s).parts.find(p => p.id === 'hunger') || { v: 0 }).v;
        expect(hunger1).toBeGreaterThan(hunger0);
        // The next harvest reckoned carries the burning
        expect(s.harried.fields.share).toBeGreaterThan(0);
        expect(s.harried.fields.until).toBeGreaterThan(world.day);
    });

    it('burning the mill: no flour ground until it is rebuilt, and the rebuilding takes the town\'s timber', () => {
        const ctx = setup(303);
        const { world, player } = ctx;
        // A town with a mill of its own (villages grind too where the trade reaches them)
        let s = ctx.s;
        if (!SettlementMarket.hasTrade(s, 'mill')) {
            const t = views(world).find(x => x.kingdom === ctx.k.id && SettlementMarket.hasTrade(x, 'mill') && x.type !== 'capital');
            s = world.getTile(t.q, t.r).settlement;
            player.q = s.q; player.r = s.r;
            Harrying.scar(s).foughtDay = world.day;
        }
        const r = PlayerHarrying.act(player, world, 'mill');
        expect(r.success).toBe(true);
        expect(s.market.idle.mill).toBeGreaterThan(world.day);
        // Its rebuilding waits on wood: none in the market, none rebuilt
        const st = Harrying.state(world);
        s.market.stock.wood = 0;
        world.day = s.harried.mill.until;
        Harrying._mendWeek(world, st, world.day);
        expect(s.harried.mill.paid).toBe(false);
        expect(s.market.idle.mill).toBeGreaterThan(world.day);
        // Timber comes to market: the millwrights take it, and the mill grinds again
        SettlementMarket.add(s, 'wood', 50);
        const wood0 = SettlementMarket.stock(s, 'wood');
        world.day += 7;
        Harrying._mendWeek(world, st, world.day);
        expect(s.harried.mill.paid).toBe(true);
        expect(SettlementMarket.stock(s, 'wood')).toBeLessThan(wood0);
        world.day = s.harried.mill.until + 1;
        Harrying._mendWeek(world, st, world.day);
        expect(s.harried ? s.harried.mill : undefined).toBeUndefined();
    });

    it('driving off the herds: real head out of the pens, into your hands; the pens refill slowly', () => {
        const ctx = setup(404);
        const { world, player } = ctx;
        let s = ctx.s;
        let pens = Harrying.pens(world, s);
        if (!Object.keys(pens).length) {
            const t = views(world).find(x => x.kingdom === ctx.k.id && Object.keys(Harrying.pens(world, x)).length);
            s = world.getTile(t.q, t.r).settlement;
            player.q = s.q; player.r = s.r;
            Harrying.scar(s).foughtDay = world.day;
            pens = Harrying.pens(world, s);
        }
        const before = Object.values(pens).reduce((a, b) => a + b, 0);
        const r = PlayerHarrying.act(player, world, 'herds');
        expect(r.success).toBe(true);
        const after = Object.values(Harrying.pens(world, s)).reduce((a, b) => a + b, 0);
        expect(r.head).toBeGreaterThan(0);
        expect(before - after).toBeGreaterThanOrEqual(r.head - Object.keys(pens).length); // (pens hold fractions of a head)
        // Every head went somewhere: home to a place of yours, or butchered into your packs
        expect(r.drove.home + r.drove.butchered).toBe(r.head);
        if (r.drove.butchered) expect(Object.values(r.drove.goods).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(0);
        // The pens fill back at a quarter of their pace while the herds are gone
        const id = Object.keys(r.taken)[0];
        const st0 = s.livestockMarket.stock[id];
        const target = Livestock.offerings(world, s)[id];
        world.day += 10;
        Livestock._book(world, s);
        const per = 1 / Math.max(1, (Livestock.config().market || {}).restockDays || 20);
        const gain = s.livestockMarket.stock[id] - st0;
        expect(gain).toBeLessThan(target * per * 10 * 0.5);
        // ...and the town's own herds yield less until the next harvest
        expect(Harvests.townYield(s).stock).toBeLessThan(1);
    });

    it('scattering the peasants moves real people; slaughtering them is an atrocity', () => {
        const ctx = setup(707);
        const { world, player, s, k } = ctx;
        const realm0 = realmPop(world, k.id), pop0 = s.population;
        const r = PlayerHarrying.act(player, world, 'scatter');
        expect(r.success).toBe(true);
        expect(r.fled).toBeGreaterThan(0);
        expect(s.population).toBe(pop0 - r.fled);
        expect(realmPop(world, k.id)).toBe(realm0);
        const butcher0 = Atrocities.butcher(player), karma0 = player.karma || 0;
        const pop1 = s.population;
        const r2 = PlayerHarrying.act(player, world, 'slaughter');
        expect(r2.success).toBe(true);
        expect(r2.killed).toBeGreaterThan(0);
        expect(s.population).toBe(pop1 - r2.killed);
        expect(Atrocities.butcher(player)).toBeGreaterThanOrEqual(butcher0 + 19);
        expect(player.karma).toBeLessThan(karma0 - 10);
        expect(Atrocities.state(player).stats.slaughter).toBe(1);
    });
});

describe('Harrying — the realm answers', () => {
    it('stability falls with its harried towns, halved once the crown answers; the reasons say why', () => {
        const ctx = setup(606);
        const { world, player, s, k } = ctx;
        k.military = 0; // (no host: the crown does nothing)
        PlayerHarrying.act(player, world, 'torch');
        world.day = Math.floor(world.day / 7) * 7 + 3 + 7;
        Harrying.processDay(world, player);
        expect(k.harried.towns).toBe(1);
        expect(k.harried.stab).toBeLessThan(0);
        expect(k.harried.answered).toBe(false);
        const part = KingdomStability.target(k, world).parts.find(p => p.label === 'Countryside harried');
        expect(part.value).toBeLessThan(0);
        // The crown rides out after them: the grumbling halves
        const full = k.harried.stab;
        Harrying.state(world).realms[String(k.id)].answeredDay = world.day;
        Harrying._reckonRealms(world);
        expect(k.harried.answered).toBe(true);
        expect(Math.abs(k.harried.stab - full / 2)).toBeLessThanOrEqual(0.1);
        expect(s.harried).toBeTruthy();
    });

    it('a pursuit host rides out, paid for out of the treasury (no coin made), follows the harriers, and goes home with its chest', () => {
        const ctx = setup(707);
        const { world, player, k } = ctx;
        k.military = Math.max(400, k.military || 0);
        k.treasury = Math.max(5000, k.treasury || 0);
        const mil0 = k.military;
        const m = measure(world, player, () => PlayerHarrying.act(player, world, 'fields'));
        expect(m.result.success).toBe(true);
        expect(m.unbooked).toBeCloseTo(0, 1);
        const rec = m.result.pursuit;
        expect(rec).toBeTruthy();
        const unit = world.units.find(u => u.id === rec.id);
        expect(unit.type).toBe('war_host');
        expect(unit.hostile).toBe(true);
        expect(k.military).toBe(mil0 - rec.strength);
        expect(unit.inventory.gold).toBe(rec.chest);
        // It follows the player while they are in its land
        world.day += 1;
        Harrying.processDay(world, player);
        expect(unit.objectiveQ).toBe(player.q);
        expect(k.harried === undefined || k.harried.answered !== false).toBe(true);
        // The player leaves the realm far behind: the chase is off, men and chest home
        let far = null;
        for (let r = 0; r < world.height && !far; r += 3) {
            for (let q = 0; q < world.width && !far; q += 3) {
                if (!Harrying._nearRealm(world, k.id, q, r, Harrying.config().pursuit.leashHexes)) far = { q, r };
            }
        }
        expect(far).toBeTruthy();
        if (far) {
            player.q = far.q; player.r = far.r;
            const t0 = k.treasury;
            world.day += 1;
            const m2 = measure(world, player, () => Harrying.processDay(world, player));
            expect(m2.unbooked).toBeCloseTo(0, 1);
            expect(unit.destroyed).toBe(true);
            expect(k.treasury).toBeCloseTo(t0 + rec.chest, 1);
            expect(k.military).toBe(mil0);
            expect(Harrying.state(world).hosts.length).toBe(0);
        }
    });

    it('a pursuit host broken by the player counts as the crown answering, and losing', () => {
        const ctx = setup(808);
        const { world, player, k } = ctx;
        k.military = Math.max(400, k.military || 0);
        k.treasury = Math.max(5000, k.treasury || 0);
        const r = PlayerHarrying.act(player, world, 'scatter');
        const unit = world.units.find(u => u.id === r.pursuit.id);
        unit.destroyed = true;
        unit.slainByPlayer = true;
        unit.inventory.gold = 0; // (the victor took the chest)
        Harrying.onHostDefeated(player, world, unit);
        const st = Harrying.state(world);
        expect(st.hosts.length).toBe(0);
        expect(st.stats.hostsBeaten).toBe(1);
        expect(st.realms[String(k.id)].lost).toBe(1);
        expect(st.realms[String(k.id)].answeredDay).toBe(world.day);
    });
});

describe('Harrying — recovery over seasons', () => {
    it('the burnt village is rebuilt with the market\'s wood, its damage held up until then; the scar heals', () => {
        const ctx = setup(909);
        const { world, player, s } = ctx;
        PlayerHarrying.act(player, world, 'torch');
        const st = Harrying.state(world);
        const left0 = s.harried.burn.left;
        // Repair would mend it in a month; the ashes hold it back
        s.damage = 0;
        SettlementMarket.add(s, 'wood', 500);
        const wood0 = SettlementMarket.stock(s, 'wood');
        Harrying._mendWeek(world, st, world.day + 7);
        expect(s.harried.burn.left).toBeLessThan(left0);
        expect(s.damage).toBeCloseTo(s.harried.burn.left, 3);
        expect(SettlementMarket.stock(s, 'wood')).toBeLessThan(wood0);
        // No wood: no rebuilding
        s.market.stock.wood = 0;
        const left1 = s.harried.burn.left;
        Harrying._mendWeek(world, st, world.day + 14);
        expect(s.harried.burn.left).toBe(left1);
        // A town with timber rebuilds within the season's span, and the scar is gone in time
        let d = world.day + 14;
        for (let i = 0; i < 80 && s.harried; i++) {
            SettlementMarket.add(s, 'wood', 50);
            d += 7;
            Harrying._mendWeek(world, st, d);
        }
        expect(s.harried).toBeUndefined();
        expect(st.towns[`${s.q},${s.r}`]).toBeUndefined();
    });
});

describe('Harrying — the realms harry each other', () => {
    it('a realm at war harries its enemy\'s border village: real damage and refugees, plunder to its own town, no coin made', () => {
        const game = coinGame(111, 1);
        const { world, player } = game;
        const ks = world.kingdoms.filter(k => k && k.isAlive !== false && views(world).some(s => s.kingdom === k.id));
        // Two realms, the second with a town that is not its capital (the riders' range opened up for the small test map)
        const b = ks.find(k => views(world).some(s => s.kingdom === k.id && (s.type === 'village' || s.type === 'town') && s.population >= 60));
        const a0 = ks.find(k => k !== b);
        expect(b && a0).toBeTruthy();
        const pair = [a0, b];
        const [a] = pair;
        for (const k of world.kingdoms) k.wars = [];
        a.wars = [b.id]; b.wars = [a.id];
        a.military = Math.max(a.military || 0, 300);
        const cfg = Harrying.config();
        const chance = cfg.ai.chance, range = cfg.ai.rangeHexes;
        cfg.ai.chance = 1;
        cfg.ai.rangeHexes = 200;
        try {
            world.day = Math.floor(world.day / 7) * 7 + 3 + 7;
            const realmB0 = realmPop(world, b.id);
            const m = measure(world, player, () => Harrying.processDay(world, null));
            expect(m.unbooked).toBeCloseTo(0, 1);
            const st = Harrying.state(world);
            expect(st.log.length).toBeGreaterThan(0);
            const e = st.log[st.log.length - 1];
            expect(e.by).toBe(a.id);
            const s = world.getTile(e.q, e.r).settlement;
            expect(s.kingdom).toBe(b.id);
            expect(s.damage).toBeGreaterThan(0.1);
            expect(s.harried.byKid).toBe(a.id);
            expect(realmPop(world, b.id)).toBeLessThanOrEqual(realmB0);
            expect(b.harried.towns).toBeGreaterThan(0);
            expect(world.events.some(ev => /harry/.test(ev.text))).toBe(true);
        } finally {
            cfg.ai.chance = chance;
            cfg.ai.rangeHexes = range;
        }
    });
});

describe('Harrying — saved and restored', () => {
    it('the realms\' records and the pursuit hosts come back from a save; the towns\' scars travel with them', () => {
        const ctx = setup(121);
        const { world, player, s, k } = ctx;
        k.military = Math.max(400, k.military || 0);
        k.treasury = Math.max(5000, k.treasury || 0);
        PlayerHarrying.act(player, world, 'torch');
        const saved = JSON.parse(JSON.stringify(Harrying.serialize(world)));
        delete world.harrying;
        delete k.harried;
        Harrying.restore(saved, world);
        const st = Harrying.state(world);
        expect(Object.keys(st.towns)).toContain(`${s.q},${s.r}`);
        expect(st.hosts.length).toBe(1);
        expect(k.harried.towns).toBe(1);
        expect(TownMemory.describe(s, world).length).toBeGreaterThan(0);
    });
});

describe('Harrying — the day goes on', () => {
    it('the full daily turn runs with a pursuit host on the harriers\' heels (the soak bot\'s day)', () => {
        const ctx = setup(131);
        const { game, world, player, k } = ctx;
        k.military = Math.max(400, k.military || 0);
        k.treasury = Math.max(5000, k.treasury || 0);
        const r = PlayerHarrying.act(player, world, 'herds');
        expect(r.success).toBe(true);
        const day0 = world.day;
        for (let i = 0; i < 12; i++) endDay(game);
        expect(world.day).toBe(day0 + 12);
        // The host is still on the hunt, home again, or broken: never lost track of
        const st = Harrying.state(world);
        for (const h of st.hosts) expect(world.units.some(u => u.id === h.id)).toBe(true);
    });
});
