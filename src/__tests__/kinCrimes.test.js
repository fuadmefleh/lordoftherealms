// Crimes against your own blood (systems/kinCrimes.js): a hunting accident
// or poison for an heir or a sibling, the cloister, a declaration of
// unfitness, disinheritance into a bitter cadet branch, a forced match — the
// household's suspicion, exposure, and what the next generation remembers.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { loadData, newGame, endDay, roundTrip } from './playtest/harness.js';
import { KinCrimes } from '../systems/kinCrimes.js';
import { Relationships } from '../systems/relationships.js';
import { Inheritance } from '../systems/inheritance.js';
import { House } from '../systems/house.js';
import { Traits } from '../systems/traits.js';
import { Raising } from '../systems/raising.js';
import { Nemesis } from '../systems/nemesis.js';
import { CadetBranches } from '../systems/cadetBranches.js';
import { Upbringing } from '../systems/upbringing.js';
import { Heirs } from '../systems/heirs.js';

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

function kid(game, age, gender = null) {
    const c = Relationships.generateChild(game.player, { culture: 'Imperial' }, game.world, { quiet: true });
    c.age = age;
    if (gender) c.gender = gender;
    if (age >= 16) Upbringing.ensure(c).comeOfAge = true;
    return c;
}

function setup(seed) {
    const game = newGame(seed);
    endDay(game);
    const { player } = game;
    player.children = [];
    player.heir = null;
    player.house.prestige = 200;
    Inheritance.setCoin(player, 2000);
    const elder = kid(game, 22, 'male');
    const heir = kid(game, 18, 'female');
    const little = kid(game, 12);
    player.heir = heir.id;
    return { game, elder, heir, little };
}

/** Run only this system's days. */
function kinDays(game, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
        game.world.day++;
        out.push(...KinCrimes.processDay(game.world, game.player).notices);
    }
    return out;
}

describe('a hunting accident', () => {
    it('kills the heir, brings their portion home, and the household may suspect', () => {
        const { game, heir, elder, little } = setup(11);
        const { player, world } = game;
        heir.purse = 120;
        const before = Inheritance.coin(player);
        const res = KinCrimes.murder(player, world, heir.id, 'hunt', () => 0);
        expect(res.success).toBe(true);
        expect(res.died).toBe(true);
        expect(heir.isAlive).toBe(false);
        expect(heir.deathCause).toBe('a hunting accident');
        expect(player.heir).toBe(null);
        expect(Inheritance.coin(player)).toBeCloseTo(before + 120, 2);
        expect(res.act.suspicion).toBeGreaterThan(0);
        // Everyone at home old enough saw it (the dice forced to 0)
        expect(elder.kin.suspects).toContain(res.act.id);
        expect(little.kin.suspects).toContain(res.act.id);
        expect(elder.kin.grievance).toBeGreaterThan(0);
        // The official story is in the chronicle; the truth is not
        const last = player.house.history[player.house.history.length - 1];
        expect(last.text).toMatch(/hunting accident/);
    });

    it('can fail: the target lives, knows, and swears a feud', () => {
        const { game, elder } = setup(12);
        const { player, world } = game;
        const res = KinCrimes.murder(player, world, elder.id, 'poison', () => 0.999);
        expect(res.success).toBe(true);
        expect(res.died).toBe(false);
        expect(elder.isAlive).not.toBe(false);
        expect(res.act.kind).toBe('attempt');
        expect(elder.kin.suspects).toContain(res.act.id);
        expect(elder.kin.grievance).toBeGreaterThanOrEqual(60);
        expect(Nemesis.state(player).grudges.some(g => g.kind === 'kin' && g.ref.childId === elder.id)).toBe(true);
    });

    it('is refused for a child too young or away', () => {
        const { game } = setup(13);
        const baby = kid(game, 3);
        expect(KinCrimes.murder(game.player, game.world, baby.id, 'hunt').success).toBe(false);
    });
});

describe('exposure', () => {
    it('costs Prestige, marks the ruler Kinslayer, stains the House and rewrites the cause', () => {
        const { game, heir, elder } = setup(21);
        const { player, world } = game;
        const res = KinCrimes.murder(player, world, heir.id, 'hunt', () => 0);
        const p0 = player.house.prestige;
        const n = KinCrimes.expose(player, world, res.act);
        expect(n.text).toMatch(/no accident/);
        expect(player.house.prestige).toBeLessThan(p0);
        expect(Traits.has(player, 'kinslayer')).toBe(true);
        expect(KinCrimes.state(player).stain).toBeGreaterThan(0);
        expect(heir.deathCause).toBe('murdered by their own blood');
        const last = player.house.history[player.house.history.length - 1];
        expect(last.tags).toContain('betrayal');
        // The victim's grown sibling swears a feud
        expect(Nemesis.state(player).grudges.some(g => g.ref && g.ref.childId === elder.id)).toBe(true);
        // Exposed once only
        expect(KinCrimes.expose(player, world, res.act)).toBe(null);
    });

    it('comes out in time by the weekly roll, the same way for the same seed', () => {
        const run = () => {
            const { game, heir } = setup(22);
            const res = KinCrimes.murder(game.player, game.world, heir.id, 'hunt', () => 0);
            res.act.suspicion = 90;
            res.act.floor = 90;
            kinDays(game, 1500);
            return res.act.exposed;
        };
        const a = run();
        expect(a).not.toBe(null);
        expect(run()).toBe(a);
    });

    it('suspicion decays toward its floor but a murder never fully', () => {
        const { game, heir } = setup(23);
        const res = KinCrimes.murder(game.player, game.world, heir.id, 'hunt', () => 0.5);
        res.act.suspicion = 20;
        // keep it hidden: no exposure roll can fire at this level often; force the stream to never expose
        KinCrimes.config();
        const orig = KinCrimes.config;
        KinCrimes.config = () => ({ ...orig(), exposeWeekly: 0 });
        try {
            kinDays(game, 120 * 10);
        } finally {
            KinCrimes.config = orig;
        }
        expect(res.act.suspicion).toBeGreaterThanOrEqual(KinCrimes.config().murder.floor);
        expect(res.act.suspicion).toBeLessThan(20);
    });
});

describe('a sibling killed for the inheritance', () => {
    it('kills a sibling kept from the last succession, and their portion comes to you', () => {
        const { game, heir, elder } = setup(31);
        const { player, world } = game;
        // The heir takes the seat: the elder becomes a sibling
        player.heir = heir.id;
        expect(Relationships.succeedAsHeir(player, heir.id, world, {}).success).toBe(true);
        const sib = player.children.find(c => c.id === elder.id);
        expect(sib.isSibling).toBe(true);
        sib.purse = 300;
        const coin = Inheritance.coin(player);
        const res = KinCrimes.murder(player, world, sib.id, 'poison', () => 0);
        expect(res.died).toBe(true);
        expect(res.act.sibling).toBe(true);
        expect(Inheritance.coin(player)).toBeCloseTo(coin + 300, 2);
        // Not your heir to declare unfit, not yours to disinherit or sell
        expect(KinCrimes.whyNot(player, world, player.children.find(c => c.isAlive !== false && c.isSibling)?.id || 'none', 'unfit')).toBeTruthy();
    });
});

describe('declared unfit', () => {
    it('can never take the seat until declared fit again', () => {
        const { game, heir } = setup(41);
        const { player, world } = game;
        const res = KinCrimes.declareUnfit(player, world, heir.id);
        expect(res.success).toBe(true);
        expect(player.heir).toBe(null);
        expect(Relationships.getEligibleHeirs(player).some(c => c.id === heir.id)).toBe(false);
        expect(Relationships.designateHeir(player, heir.id).success).toBe(false);
        expect(House.assessSuccession(player).adults.some(c => c.id === heir.id)).toBe(false);
        expect(heir.kin.grievance).toBeGreaterThan(0);
        expect(KinCrimes.restoreFit(player, world, heir.id).success).toBe(true);
        expect(Relationships.getEligibleHeirs(player).some(c => c.id === heir.id)).toBe(true);
        // the grievance stays
        expect(heir.kin.grievance).toBeGreaterThan(0);
    });
});

describe('the cloister', () => {
    it('takes the child out of the household; the endowment and portion go to a town', () => {
        const { game, little } = setup(51);
        const { player, world } = game;
        little.purse = 50;
        const coin = Inheritance.coin(player);
        const res = KinCrimes.cloister(player, world, little.id);
        expect(res.success).toBe(true);
        expect(player.children.some(c => c.id === little.id)).toBe(false);
        expect(Inheritance.coin(player)).toBeCloseTo(coin - KinCrimes.config().cloister.endowment, 2);
        const rec = KinCrimes.state(player).cloistered[0];
        expect(rec.name).toBe(little.firstName);
        if (!res.vocation) expect(rec.bitter).toBe(true);
    });
});

describe('disinherit and cast out', () => {
    it('founds an estranged cadet branch with a grudge that caps its loyalty', () => {
        const { game, elder } = setup(61);
        const { player, world } = game;
        elder.purse = 400;
        const coin = Inheritance.coin(player);
        const res = KinCrimes.disinherit(player, world, elder.id, { seize: true });
        expect(res.success).toBe(true);
        expect(Inheritance.coin(player)).toBeCloseTo(coin + 400, 2);
        const b = res.branch;
        expect(b.why).toBe('cast');
        expect(b.estranged).toBe(true);
        expect(b.grudge).toBeTruthy();
        expect(player.children.some(c => c.id === elder.id)).toBe(false);
        // Gifts cannot buy back the first heads' grudge
        b.loyalty = 90;
        kinDays(game, 7);
        expect(b.loyalty).toBeLessThanOrEqual(b.grudge.cap);
        // The chronicle tells it as a casting-out, not a leaving
        expect(player.house.history.some(h => /cast out/.test(h.text))).toBe(true);
        expect(House._estrangedCadets(player.house).some(x => x.id === b.id)).toBe(true);
    });

    it('the grudge fades after its heads', () => {
        const { game, elder } = setup(62);
        const res = KinCrimes.disinherit(game.player, game.world, elder.id);
        const b = res.branch;
        b.stats.heads = b.grudge.heads + b.grudge.gens;
        kinDays(game, 7);
        expect(b.grudge).toBeUndefined();
    });
});

describe('a forced match', () => {
    it('sells the match for coin out of a realm\'s treasury; the bond is capped for good', () => {
        const { game, elder } = setup(71);
        const { player, world } = game;
        const k = Heirs.kingdoms(player, world).find(x => (x.treasury || 0) > 1000) || Heirs.kingdoms(player, world)[0];
        k.treasury = Math.max(k.treasury || 0, 5000);
        const t0 = k.treasury;
        const c0 = Inheritance.coin(player);
        const res = KinCrimes.forceMatch(player, world, elder.id, k.id, 'price');
        expect(res.success).toBe(true);
        expect(res.price).toBeGreaterThan(0);
        expect(k.treasury).toBeCloseTo(t0 - res.price, 2);
        expect(Inheritance.coin(player)).toBeCloseTo(c0 + res.price, 2);
        expect(elder.upbringing.spouse.forced).toBe(true);
        Raising.ensure(elder).bond = 100;
        kinDays(game, 7);
        expect(Raising.bond(elder)).toBeLessThanOrEqual(100 - elder.kin.grievance);
    });

    it('a forced heir comes to the seat hardened and will not sell a child of their own', () => {
        const { game, heir } = setup(72);
        const { player, world } = game;
        const k = Heirs.kingdoms(player, world)[0];
        expect(KinCrimes.forceMatch(player, world, heir.id, k.id, 'alliance').success).toBe(true);
        Raising.ensure(heir).bond = 10;
        expect(Relationships.succeedAsHeir(player, heir.id, world, {}).success).toBe(true);
        expect(Traits.has(player, KinCrimes.config().forced.rulerTraitBitter)).toBe(true);
        const grand = kid(game, 18);
        expect(KinCrimes.whyNot(player, world, grand.id, 'forced')).toMatch(/will not sell/);
    });
});

describe('the next generation remembers', () => {
    it('an heir who suspected may tell the truth at their succession; the stain halves', () => {
        const { game, heir, elder } = setup(81);
        const { player, world } = game;
        const res = KinCrimes.murder(player, world, elder.id, 'hunt', () => 0);
        expect(heir.kin.suspects).toContain(res.act.id);
        KinCrimes.state(player).stain = 40;
        const orig = KinCrimes.config;
        KinCrimes.config = () => ({ ...orig(), succession: { ...orig().succession, knewExposeChance: 1 } });
        try {
            expect(Relationships.succeedAsHeir(player, heir.id, world, {}).success).toBe(true);
        } finally {
            KinCrimes.config = orig;
        }
        expect(res.act.exposed).not.toBe(null);
        expect(res.act.exposedBy).toBe('heir');
        // The old ruler's deed: the new ruler is not the Kinslayer
        expect(Traits.has(player, 'kinslayer')).toBe(false);
        const st = KinCrimes.state(player);
        expect(st.stain).toBeLessThan(40 + KinCrimes.config().murder.stain);
        expect(kinDays(game, 1).some(n => /secret/.test(n.text))).toBe(true);
    });

    it('a stained House gives men a reason to contest the seat', () => {
        const { game } = setup(82);
        const st = KinCrimes.state(game.player);
        st.stain = 100;
        game.player.house._pendingClaim = false;
        const Y = 120;
        game.world.day = Math.ceil(game.world.day / Y) * Y;
        let claimed = false;
        for (let y = 0; y < 20 && !claimed; y++) {
            game.world.day += Y - 1;
            kinDays(game, 1);
            claimed = !!game.player.house._pendingClaim;
        }
        expect(claimed).toBe(true);
    });

    it('an elder passed over for a younger heir resents it', () => {
        const { game, elder } = setup(83);
        const Y = 120;
        game.world.day = Math.ceil(game.world.day / Y) * Y;
        for (let y = 0; y < 3; y++) {
            game.world.day += Y - 1;
            kinDays(game, 1);
        }
        expect(elder.kin.passedOver).toBeGreaterThanOrEqual(3);
    });
});

describe('saving', () => {
    it('keeps the deeds, the stain and the children\'s memory through a save', () => {
        const { game, heir, elder } = setup(91);
        const res = KinCrimes.murder(game.player, game.world, heir.id, 'hunt', () => 0);
        KinCrimes.declareUnfit(game.player, game.world, elder.id);
        KinCrimes.state(game.player).stain = 12;
        const g2 = roundTrip(game);
        const st = KinCrimes.state(g2.player);
        expect(st.acts.map(a => a.id)).toContain(res.act.id);
        expect(st.stain).toBe(12);
        const e2 = g2.player.children.find(c => c.id === elder.id);
        expect(KinCrimes.isUnfit(e2)).toBe(true);
        expect(Relationships.getEligibleHeirs(g2.player).some(c => c.id === elder.id)).toBe(false);
    });
});
