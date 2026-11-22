// Water (systems/water.js, player/thirst.js): the player thirsts and drinks —
// at the water passed or stood by, from the skins, bought in a town whose
// wells are foul — and dies of a few days without it; a town's wells foul
// (siege carcasses, the plague dead, an agent, the drought, your poison) and
// its people sicken, pay carriers and leave; besieged towns drink their
// cisterns then thirst; ships carry casks; a commanded host needs water near.
// Hash rolls only: no shared RNG.
import { describe, it, expect, beforeAll } from 'vitest';
import { loadData, newGame } from './playtest/harness.js';
import { Water } from '../systems/water.js';
import { Thirst } from '../player/thirst.js';
import { Atrocities } from '../systems/atrocities.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { Economy } from '../world/economy.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Utils } from '../core/utils.js';
import { Afterlife } from '../player/afterlife.js';
import { WaterSources } from '../world/waterSources.js';
import { HandBuilding } from '../world/handBuilding.js';

function setup(seed = 31) {
    const g = newGame(seed);
    const { world, player } = g;
    const views = world.getSettlementViews().filter(s => s && s.kingdom && s.population >= 300).sort((a, b) => b.population - a.population);
    const dry = views.find(s => !Water.freshAt(world, s.q, s.r)) || views[0];
    Economy.initSettlement(dry);
    if (!Number.isFinite(dry.happiness)) dry.happiness = 60;
    player.gold = 500;
    player.inventory = player.inventory || {};
    return { world, player, s: dry, views };
}

/** A passable wild hex with no water on or beside it. */
function dryWild(world) {
    for (let r = 2; r < world.height - 2; r++) {
        for (let q = 2; q < world.width - 2; q++) {
            const t = world.getTile(q, r);
            if (!t || !t.terrain || !t.terrain.passable || t.settlement) continue;
            if (!Water.sourceAt(world, q, r)) return t;
        }
    }
    return null;
}

function riverHex(world) {
    for (let r = 0; r < world.height; r++) for (let q = 0; q < world.width; q++) {
        const t = world.getTile(q, r);
        if (t && t.hasRiver && !t.settlement && t.terrain && t.terrain.passable) return t;
    }
    return null;
}

describe('Water', () => {
    beforeAll(async () => { await loadData(); }, 60000);

    it("a town's wells foul: no clean water, its people sicken, its purse pays carriers, the coin goes to the next town", () => {
        const { world, player, s } = setup(31);
        Townsfolk.seed(s, world);
        player.q = -99; player.r = -99;
        const v0 = Water.view(world, s);
        expect(v0.wells).toBeGreaterThanOrEqual(1);
        expect(v0.ok).toBe(true);
        Water.foul(world, s, 'carcasses', { n: v0.wells, by: 'the besiegers' });
        const v = Water.view(world, s);
        expect(v.fouled).toBe(v0.wells);
        expect(v.ok).toBe(!!v.fresh);
        if (v.fresh) return; // (every town on this seed by a lake: nothing more to see)
        const src = Water.sourceAt(world, s.q, s.r);
        expect(src.foul).toBe(true);
        const before = Economy.townPurse(s);
        const others = world.getSettlementViews().filter(o => o !== s);
        for (const o of others) Economy.initSettlement(o);
        const otherCoin = others.reduce((a, o) => a + (o.economy ? Number(o.economy.gold) || 0 : 0), 0);
        const happy = s.happiness;
        const rnd0 = Utils.random;
        let draws = 0;
        Utils.random = (...a) => { draws++; return rnd0(...a); };
        try {
            for (let i = 0; i < 5; i++) { world.day++; Water.processDay(world, null); }
        } finally { Utils.random = rnd0; }
        expect(draws).toBe(0);
        expect(s.happiness).toBeLessThan(happy);
        const sick = Townsfolk.residents(s.folk).filter(p => p.ill && p.ill.k === 'flux').length;
        expect(sick).toBeGreaterThan(0);
        const paid = before - Economy.townPurse(s);
        expect(paid).toBeGreaterThan(0);
        const otherAfter = others.reduce((a, o) => a + (o.economy ? Number(o.economy.gold) || 0 : 0), 0);
        expect(Math.round((otherAfter - otherCoin) * 100)).toBe(Math.round(paid * 100));
        // The well-diggers: paid into the town's purse, clean in two days
        const q = Water.cleanQuote(world, s);
        expect(q && q.price).toBeGreaterThan(0);
        const gold = player.gold;
        const purse = Economy.townPurse(s);
        expect(Water.clean(world, player, s).success).toBe(true);
        expect(player.gold).toBe(Utils.cents(gold - q.price));
        expect(Math.round((Economy.townPurse(s) - purse) * 100)).toBe(Math.round(q.price * 100));
        world.day += 3;
        Water.processDay(world, null);
        expect(Water.view(world, s).ok).toBe(true);
    }, 120000);

    it('the player drinks at a town and from the skins, and dies of days without water', () => {
        const { world, player, s } = setup(32);
        const w = Thirst.state(player);
        expect(player.inventory.waterskin).toBeGreaterThanOrEqual(1);
        expect(Thirst.held(player)).toBe(Thirst.capacity(player));
        // At a clean town: slaked at the day's end
        player.q = s.q; player.r = s.r;
        Water.state(s) && delete s.water;
        w.thirst = 20;
        Thirst.processDay(player, world, {});
        expect(Thirst.level(player)).toBe(100);
        // In dry wilds: the skins, then nothing
        const wild = dryWild(world);
        expect(wild).toBeTruthy();
        player.q = wild.q; player.r = wild.r;
        player.health = 100;
        // (the desert: hardly any water off the land)
        const keep = wild.terrain;
        wild.terrain = { ...wild.terrain, id: 'desert' };
        let died = false, days = 0;
        for (; days < 20 && !died; days++) {
            world.day++;
            player.movementRemaining = 10;
            died = Thirst.processDay(player, world, {}).died;
        }
        wild.terrain = keep;
        expect(died).toBe(true);
        expect(days).toBeLessThan(14); // days, not weeks
        expect(Thirst.held(player)).toBe(0);
        expect(w.parched).toBeGreaterThan(0);
    }, 120000);

    it('out in wet country the land gives water most nights; the desert hardly ever', () => {
        const { world, player } = setup(39);
        const wild = dryWild(world);
        const keep = wild.terrain;
        let wood = 0, desert = 0;
        for (let d = 0; d < 100; d++) {
            world.day++;
            wild.terrain = { ...keep, id: 'woodland' };
            if (Thirst.landWater(player, world, wild)) wood++;
            wild.terrain = { ...keep, id: 'desert' };
            if (Thirst.landWater(player, world, wild)) desert++;
        }
        wild.terrain = keep;
        expect(wood).toBeGreaterThan(65);
        expect(desert).toBeLessThan(15);
        // A long walk through the woods with one skin: never parched
        player.q = wild.q; player.r = wild.r;
        wild.terrain = { ...keep, id: 'woodland' };
        const st = Thirst.state(player);
        let worst = 100;
        for (let d = 0; d < 120; d++) { world.day++; player.movementRemaining = 10; Thirst.processDay(player, world, {}); worst = Math.min(worst, st.thirst); }
        wild.terrain = keep;
        expect(st.parched).toBe(0);
        expect(worst).toBeGreaterThan(0);
    }, 120000);

    it('heat, a march and a fight make it come faster; a river walked onto slakes and fills the skins', () => {
        const { world, player } = setup(33);
        const wild = dryWild(world);
        player.q = wild.q; player.r = wild.r;
        const base = Thirst.drainMult(player, world);
        const saved = { terrain: wild.terrain, temperature: wild.temperature };
        wild.terrain = { ...wild.terrain, id: 'desert' };
        wild.temperature = 0.95;
        const hot = Thirst.drainMult(player, world);
        wild.terrain = saved.terrain; wild.temperature = saved.temperature;
        expect(hot).toBeGreaterThan(base * 1.5);
        player._thirstDay = { d: world.day, hexes: 3, fights: 1 };
        expect(Thirst.drainMult(player, world)).toBeGreaterThan(base * 1.3);
        const rv = riverHex(world);
        if (rv) {
            const st = Thirst.state(player);
            st.thirst = 10; st.held = 0;
            Thirst.passHex(player, world, rv);
            expect(Thirst.level(player)).toBe(100);
            expect(Thirst.held(player)).toBe(Thirst.capacity(player));
        }
    }, 120000);

    it('in a town of foul wells the carriers sell water (to the town), or the foul well is drunk at the last', () => {
        const { world, player, s } = setup(34);
        if (Water.freshAt(world, s.q, s.r)) return;
        Water.foul(world, s, 'agent', { n: Water.wellsOf(s) });
        player.q = s.q; player.r = s.r;
        const st = Thirst.state(player);
        st.thirst = 30; st.held = 0;
        const purse = Economy.townPurse(s);
        const out = Thirst.processDay(player, world, {});
        expect(out.drank.join(' ')).toMatch(/carriers/);
        expect(Economy.townPurse(s)).toBeGreaterThan(purse);
        // No coin, no ale: the foul water, and maybe the flux
        player.gold = 0;
        st.thirst = 5; st.held = 0;
        for (const k of ['beer', 'cider', 'mead', 'wine', 'milk']) delete player.inventory[k];
        const out2 = Thirst.processDay(player, world, {});
        expect(out2.notices.some(n => /Foul Water/.test(n.title))).toBe(true);
        expect(Thirst.level(player)).toBe(100);
    }, 120000);

    it('a besieged town with its wells fouled drinks its cisterns, then thirsts; the dark deed does it', () => {
        const { world, player, s } = setup(35);
        if (Water.freshAt(world, s.q, s.r)) return;
        const siege = { q: s.q, r: s.r, name: s.name, garrison: 200, morale: 70, startDay: world.day, kingdomId: s.kingdom, log: [] };
        player.sieges = { active: siege };
        player.army = [{ id: 'u1', type: 'infantry' }];
        player.actionPoints = 10;
        const opt = Atrocities.options(player, world, world.getTile(s.q, s.r)).find(o => o.id === 'wells');
        expect(opt && opt.ok).toBe(true);
        const res = Atrocities.act(player, world, 'wells');
        expect(res.success).toBe(true);
        expect(Water.canDrink(world, s)).toBe(false);
        expect(Atrocities.state(player).stats.wells).toBe(1);
        const cis = Water.cisternDays(s);
        let dm = 0;
        for (let i = 0; i < cis; i++) { world.day++; dm = Water.siegeDay(world, siege, s, {}); }
        expect(dm).toBe(0);
        world.day++;
        dm = Water.siegeDay(world, siege, s, {});
        expect(dm).toBeLessThan(0);
        expect(siege.garrison).toBeLessThan(200);
    }, 120000);

    it('ships drink their casks at sea and fill them in port; a dry ship loses heart and men', () => {
        const ship = { id: 's1', name: 'Gull', status: 'at_sea', crew: 20, morale: 60, q: 0, r: 0 };
        expect(Water.shipWater(ship)).toBe(Water.shipCap());
        ship.waterDays = 1;
        const set = (sh, m) => { sh.morale = m; };
        Water.shipDay(null, ship, true, 20, set, sh => sh.morale);
        expect(ship.waterDays).toBe(0);
        for (let i = 0; i < 3; i++) Water.shipDay(null, ship, true, ship.crew, set, sh => sh.morale);
        expect(ship.morale).toBeLessThan(60);
        expect(ship.crew).toBeLessThan(20);
        ship.status = 'docked';
        Water.shipDay(null, ship, false, ship.crew, set, sh => sh.morale);
        expect(ship.waterDays).toBe(Water.shipCap());
    });

    it('a commanded host far from water thirsts after a day; by a river it does not', () => {
        const { world } = setup(36);
        const wild = dryWild(world);
        const host = { men: 500, morale: 60 };
        Water.hostDay(world, wild.q, wild.r, host);
        const r2 = Water.hostDay(world, wild.q, wild.r, host);
        if (!r2.dry) return; // (water a hex off)
        expect(r2.gone).toBeGreaterThan(0);
        expect(host.morale).toBeLessThan(60);
        const rv = riverHex(world);
        if (rv) expect(Water.hostDay(world, rv.q, rv.r, host).dry).toBe(false);
    }, 120000);

    it("the realms' hosts on the map thirst in dry country; their battles read the water", () => {
        const { world, s } = setup(37);
        const wild = dryWild(world);
        if (!wild || WaterSources.nearFresh(world, wild.q, wild.r)) return;
        const unit = { q: wild.q, r: wild.r, strength: 100 };
        const rec = { strength: 100 };
        for (let i = 0; i < 2; i++) expect(Water.armyUnitDay(world, unit, rec)).toBe(0);
        expect(Water.armyUnitDay(world, unit, rec)).toBeGreaterThan(0);
        expect(unit.strength).toBeLessThan(100);
        expect(rec.strength).toBeLessThan(100);
        expect(Water.campaignFactor(world, wild.q, wild.r, 'attack')).toBeLessThan(1);
        // A town with every well foul and no river or lake holds out the worse
        if (!Water.freshAt(world, s.q, s.r)) {
            expect(Water.campaignFactor(world, s.q, s.r, 'defend')).toBe(1);
            Water.foul(world, s, 'carcasses', { n: Water.wellsOf(s) });
            expect(WaterSources.townDry(world, s)).toBe(true);
            expect(Water.campaignFactor(world, s.q, s.r, 'defend')).toBeLessThan(1);
        }
    }, 120000);

    it('a well of your own (dug by hand) waters you when the town wells are foul', () => {
        const { world, player, s } = setup(38);
        if (Water.freshAt(world, s.q, s.r)) return;
        Water.foul(world, s, 'agent', { n: Water.wellsOf(s) });
        player.q = s.q; player.r = s.r;
        expect(Thirst.sourceHere(player, world).foul).toBe(true);
        const laid = HandBuilding.lay(world, s.q, s.r, 'well', 10, 10, world.day);
        laid.rec.done = true;
        const src = Thirst.sourceHere(player, world);
        expect(src.foul).toBe(false);
        expect(src.own).toBe(true);
        Thirst.state(player).thirst = 20;
        Thirst.processDay(player, world, {});
        expect(Thirst.level(player)).toBe(100);
    }, 120000);

    it('the water is saved with the player, and the world tick is classified', () => {
        expect(SaveLoad.EXTRA_PLAYER_FIELDS).toContain('water');
        expect(Afterlife.worldDaySystems()).toContain('Water');
        expect(Object.keys(Afterlife.worldDaySkipped())).toContain('Thirst');
    });
});
