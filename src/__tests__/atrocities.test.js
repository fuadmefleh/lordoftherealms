// Atrocities of war (systems/atrocities.js): salted fields that really fail
// the harvest, hostages under an ultimatum, plague dead over the walls, a
// surrendered town put to the sword — and the name they leave, which the
// siege code reads (no surrender, a fight to the last). On a real generated world.

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { Utils } from '../core/utils.js';
import { Sieges } from '../systems/sieges.js';
import { Atrocities } from '../systems/atrocities.js';
import { TownMemory } from '../systems/townMemory.js';
import { Heralds } from '../systems/heralds.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Harvests } from '../world/harvests.js';
import { NPCLords } from '../world/npcLords.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { KingdomNavy } from '../world/kingdomNavy.js';
import { loadData, newGame } from './playtest/harness.js';

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => Utils.resetRng());

function armyOf(type, n) {
    const def = Object.values(PlayerMilitary.UNIT_TYPES).find(u => u.id === type);
    return Array.from({ length: n }, () => PlayerMilitary.makeArmyUnit(def));
}

function setup(seed = 4242) {
    Utils.setSeed(seed);
    const game = newGame(seed);
    const { world, player } = game;
    const found = world.getAllSettlements().find(s => s.kingdom && s.type !== 'capital' && !KingdomNavy.isPortTile(world, s.q, s.r) && (s.population || 0) > 200);
    const settlement = world.getTile(found.q, found.r).settlement;
    player.q = settlement.q;
    player.r = settlement.r;
    player.army = armyOf('soldier', 8);
    player.gold = 5000;
    player.allegiance = null;
    player.actionPoints = 50;
    player.inventory = { bread: 40, salt: 40 };
    const tile = world.getTile(settlement.q, settlement.r);
    return { game, world, player, settlement, tile };
}

function besiege(ctx) {
    const res = Sieges.invest(ctx.player, ctx.world, ctx.tile);
    expect(res.success).toBe(true);
    // No relief host for these tests
    if (res.siege.relief) { Sieges._reliefHome(ctx.world, res.siege); res.siege.relief = null; }
    return res.siege;
}

describe('Atrocities — salting the fields', () => {
    it('a besieged town can be salted: its harvest fails, the reckoning keeps it failed, the town remembers', () => {
        const ctx = setup();
        const { world, player, settlement, tile } = ctx;
        const s = besiege(ctx);
        const morale = s.morale;
        const opt = Atrocities.options(player, world, tile).find(o => o.id === 'salt');
        expect(opt.ok).toBe(true);
        const salt0 = player.inventory.salt;
        const r = Atrocities.saltFields(player, world, tile);
        expect(r.success).toBe(true);
        expect(player.inventory.salt).toBeLessThan(salt0); // real salt, out of the packs
        expect(Harvests.saltedYield(settlement, world.day)).toBe(0);
        expect(Harvests.townYield(settlement).grain).toBe(0);
        expect(Harvests.grainFactor(settlement)).toBe(0);
        expect(Harvests.foodFactor(world, settlement)).toBeLessThan(Harvests.config().effects.econMin);
        expect(s.morale).toBeLessThan(morale);
        // The town's memory: an atrocity mark, told in its history, darkening its mood
        expect(TownMemory.describe(settlement, world).some(l => l.kind === 'atrocity' && /salt/.test(l.text))).toBe(true);
        expect(TownMemory.moodOf(settlement)).toBeLessThan(0);
        // Salting again is greyed with a reason
        expect(Atrocities.options(player, world, tile).find(o => o.id === 'salt').why).toMatch(/already/);
    });

    it('a harvest reckoned while the salt lies fails too; after it lifts the soil is spent', () => {
        const { world, settlement } = setup(4243);
        Harvests.saltFields(world, settlement, (world.day || 0) + 500, { yield: 0 });
        const st = Harvests.state(world);
        world.day = Math.max(1, world.day || 1);
        Harvests._sow(world, st, Harvests.yearOf(world.day), world.day);
        expect(st && st.cur && st.cur.regions).toBeTruthy();
        {
            Harvests._settle(world, st, Harvests.yearOf(world.day || 1), world.day || 1, null, { notices: [] });
            expect(settlement.farm.y.grain).toBe(0);
            expect(settlement.farm.soil).toBe(Harvests.config().soil.min);
        }
        expect(Harvests.saltedYield(settlement, (world.day || 0) + 501)).toBe(null);
    });

    it('without salt it cannot be done, and the row says why', () => {
        const ctx = setup();
        besiege(ctx);
        ctx.player.inventory = { bread: 40 };
        const opt = Atrocities.options(ctx.player, ctx.world, ctx.tile).find(o => o.id === 'salt');
        expect(opt.ok).toBe(false);
        expect(opt.why).toMatch(/salt/);
        expect(Atrocities.saltFields(ctx.player, ctx.world, ctx.tile).success).toBe(false);
    });
});

describe('Atrocities — hostages', () => {
    it('hostages raise the terms, cannot hang before the deadline, then hang: morale breaks, the realm remembers', () => {
        const ctx = setup();
        const { world, player, settlement, tile } = ctx;
        const s = besiege(ctx);
        const before = Sieges.termsChance(player, world, 'ransom');
        const pop0 = settlement.population;
        const r = Atrocities.takeHostages(player, world);
        expect(r.success).toBe(true);
        expect(settlement.population).toBe(pop0 - r.count);
        expect(Sieges.termsChance(player, world, 'ransom')).toBeGreaterThan(before);
        expect(Atrocities.executeHostages(player, world).success).toBe(false); // the ultimatum still runs
        world.day = r.deadline;
        const morale = s.morale;
        const ex = Atrocities.executeHostages(player, world);
        expect(ex.success).toBe(true);
        expect(s.morale).toBeLessThan(morale);
        expect(Atrocities.state(player).hostages).toBe(null);
        expect(settlement.population).toBe(pop0 - r.count); // the dead do not come home
        expect(Atrocities.butcher(player)).toBeGreaterThan(0);
        const lord = world.getKingdom(settlement.kingdom).lord;
        expect(NPCLords.memoryOf(lord, world.day).some(m => m.key === 'atrocity')).toBe(true);
    });

    it('a hollow threat: past the deadline unhanged, the town takes heart; the siege over, they go home', () => {
        const ctx = setup();
        const { world, player, settlement } = ctx;
        const s = besiege(ctx);
        const pop0 = settlement.population;
        const r = Atrocities.takeHostages(player, world);
        world.day = r.deadline + Atrocities.config().hostages.graceDays + 1;
        const morale = s.morale;
        Atrocities.processDay(world, player);
        expect(Atrocities.state(player).hostages.hollow).toBe(true);
        expect(s.morale).toBeGreaterThan(morale);
        Sieges.lift(player, world);
        const out = Atrocities.processDay(world, player);
        expect(out.notices.length).toBe(1);
        expect(settlement.population).toBe(pop0);
    });
});

describe('Atrocities — plague over the walls', () => {
    it('needs sick dead; with camp fever the town sickens and its folk are seeded', () => {
        const ctx = setup();
        const { world, player, tile } = ctx;
        const s = besiege(ctx);
        expect(Atrocities.options(player, world, tile).find(o => o.id === 'plague').ok).toBe(false);
        s.campSick = 4;
        const r = Atrocities.flingPlague(player, world);
        expect(r.success).toBe(true);
        expect(s.townSick).toBe(true);
        expect(r.seeded).toBeGreaterThan(0);
        expect(Sieges.stormDefense(s)).toBeGreaterThan(0);
        expect(Atrocities.options(player, world, tile).find(o => o.id === 'plague').ok).toBe(false);
    });
});

describe('Atrocities — the massacre of a surrendered town', () => {
    it('opens after a surrender; loot comes from the town; every realm hears; towns then refuse to surrender', () => {
        const ctx = setup();
        const { world, player, settlement, tile } = ctx;
        const s = besiege(ctx);
        s.morale = 0;
        Sieges.processDay(world, player); // starving and broken, the gates open
        expect(Sieges.active(player)).toBe(null);
        const opt = Atrocities.options(player, world, tile).find(o => o.id === 'massacre');
        expect(opt && opt.ok).toBe(true);
        const purse = settlement.economy ? settlement.economy.gold : null;
        const pop0 = settlement.population;
        const gold0 = player.gold;
        // The heralds take their first look (the snapshot), and the deed is done the next day
        Heralds.processDay(world, player);
        world.day++;
        const others = world.kingdoms.filter(k => k.isAlive && k.id !== settlement.kingdom).map(k => [k.id, player.reputation[k.id] || 0]);
        const r = Atrocities.massacre(player, world, tile);
        expect(r.success).toBe(true);
        expect(settlement.population).toBeLessThan(pop0 * 0.5);
        expect(player.gold - gold0).toBe(r.plunder);
        if (purse != null) expect(settlement.economy.gold).toBeCloseTo(purse - r.plunder, 1);
        for (const [id, rep] of others) expect(player.reputation[id]).toBeLessThan(rep);
        expect(player.gossip.rumors.some(x => x.type === 'massacre')).toBe(true);
        expect(Atrocities.state(player).history.some(h => h.kind === 'massacre')).toBe(true);
        // The heralds cry it
        Heralds.processDay(world, player);
        expect(Heralds.state(player).list.some(p => p.kind === 'atrocity_massacre')).toBe(true);
        // Only once
        expect(Atrocities.options(player, world, tile).find(o => o.id === 'massacre')).toBeUndefined();

        // The next town will not surrender, and fights to the last
        expect(Atrocities.refusesSurrender(player)).toBe(true);
        const next = world.getAllSettlements().find(x => x.kingdom && x.type !== 'capital' && !(x.q === settlement.q && x.r === settlement.r) && (x.population || 0) > 100);
        const t2 = world.getTile(next.q, next.r);
        player.q = next.q; player.r = next.r;
        player.army = armyOf('soldier', 8);
        const s2 = besiege({ player, world, tile: t2 });
        expect(s2.lastStand).toBeGreaterThan(0);
        expect(Sieges.termsChance(player, world, 'surrender')).toBe(0);
        const d = Sieges.stormDefense(s2);
        s2.lastStand = 0;
        expect(Sieges.stormDefense(s2)).toBeLessThan(d);
        s2.morale = 0;
        Sieges.processDay(world, player);
        expect(Sieges.active(player)).not.toBe(null); // broken, but the gates stay shut
    });

    it('the name fades only slowly', () => {
        const { world, player } = setup();
        const st = Atrocities.state(player);
        st.perfidy = 55;
        for (let i = 0; i < 1000; i++) { world.day++; Atrocities.processDay(world, player); }
        expect(Atrocities.refusesSurrender(player)).toBe(true);
        for (let i = 0; i < 5000; i++) { world.day++; Atrocities.processDay(world, player); }
        expect(Atrocities.refusesSurrender(player)).toBe(false);
    });
});

describe('Atrocities — save round trip', () => {
    it('hostages and the name survive a save and load', () => {
        const ctx = setup();
        besiege(ctx);
        Atrocities.takeHostages(ctx.player, ctx.world);
        Atrocities.state(ctx.player).butcher = 33;
        const data = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(ctx.player)));
        const back = { atrocities: data.atrocities };
        Atrocities.loadState(back);
        expect(back.atrocities.hostages.count).toBeGreaterThan(0);
        expect(back.atrocities.butcher).toBe(33);
    });
});
