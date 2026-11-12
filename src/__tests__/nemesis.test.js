// Nemeses (systems/nemesis.js): a named enemy born of a real deed, whose
// hatred escalates, who learns the player's habits and counters them, strikes
// at the worst moments, passes the feud to the next of the line, and ends in
// revenge, reconciliation, marriage or extinction.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Nemesis } from '../systems/nemesis.js';
import { NPCLords } from '../world/npcLords.js';
import { Ailments } from '../systems/ailments.js';
import { Schemes } from '../systems/schemes.js';
import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { loadData, newGame } from './playtest/harness.js';

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

let _game = null;
function game() {
    if (!_game) _game = newGame(4242);
    return _game;
}

function liveKingdom(world, skip = null) {
    return world.kingdoms.find(k => k && k.isAlive && k.lord && k.id !== skip);
}

/** A fresh player record and a lord nemesis born of a conquest. */
function lordNemesis(g, hatred = 50) {
    const { player, world } = g;
    player.nemesis = null;
    for (const k of world.kingdoms) if (k && k.lord) k.lord.memory = [];
    const k = liveKingdom(world);
    NPCLords.rememberDeed(world, k.lord, 'conquest', { weight: -60, note: 'Ashford' });
    const out = { notices: [] };
    const nm = Utils.withRng(Utils.seededRandom(7), () => Nemesis._births(player, world, out));
    nm.hatred = hatred;
    return { nm, k, out };
}

const day = (world) => world.day;

describe('birth from a real deed', () => {
    it('a lord with a deep vendetta becomes a named nemesis, with a letter and a notice', () => {
        const g = game();
        const { nm, k, out } = lordNemesis(g);
        expect(nm).toBeTruthy();
        expect(nm.kind).toBe('lord');
        expect(nm.ref.kingdomId).toBe(k.id);
        expect(nm.name).toBe(k.lord.name);
        expect(nm.origin.deed).toBe('conquest');
        expect(nm.letters[0].kind).toBe('birth');
        expect(out.notices.some(n => n.title === 'A Nemesis Is Born')).toBe(true);
        expect(Nemesis.biography(g.player, g.world, nm)).toMatch(/feud began/);
    }, 120000);

    it('keeps at most maxActive, and wrongs wait in the wings', () => {
        const g = game();
        const { player, world } = g;
        lordNemesis(g);
        const st = Nemesis.state(player);
        for (let i = 0; i < 5; i++) Nemesis.wrong(player, world, { name: `Avenger ${i}`, deed: { label: 'a brother you hanged' }, score: 50 });
        expect(st.grudges.length).toBe(5);
        for (let i = 0; i < 6; i++) {
            st.lastBirthDay = -1e9;
            Utils.withRng(Utils.seededRandom(i + 1), () => Nemesis._births(player, world, { notices: [] }));
        }
        expect(Nemesis.active(player).length).toBe(Nemesis.config().maxActive);
        expect(st.grudges.length).toBe(5 - (Nemesis.config().maxActive - 1));
    }, 120000);

    it('a sibling older than the new head, passed over, holds a grudge', () => {
        const g = game();
        const { player, world } = g;
        player.nemesis = null;
        const gd = DataLoader._gamedata.nemesis.config.birth;
        const was = gd.kinChance;
        gd.kinChance = 1;
        player.children = [{ id: 'sib1', firstName: 'Osric', dynasty: 'Vane', age: (player.age || 20) + 5, isAlive: true, isSibling: true, gender: 'male' }];
        Nemesis.state(player).lastGen = player.house.generation;
        player.house.generation += 1;
        const out = { notices: [] };
        Utils.withRng(Utils.seededRandom(3), () => Nemesis._watchSuccession(player, world, out));
        gd.kinChance = was;
        player.house.generation -= 1;
        const st = Nemesis.state(player);
        expect(st.successionDay).toBe(day(world));
        expect(st.grudges[0].kind).toBe('kin');
        expect(st.grudges[0].deed.key).toBe('disinherited');
        player.children = [];
    }, 120000);
});

describe('learning and countering your habits', () => {
    it('reads your favourite stance and fights harder against it; a new habit must be learnt again', () => {
        const g = game();
        const { player, world } = g;
        const { nm, k } = lordNemesis(g, 80);
        for (let i = 0; i < 20; i++) Nemesis.noteStance(player, 'aggressive');
        for (let w = 0; w < 20; w++) Nemesis._learn(player, nm);
        expect(nm.read.stance).toBeGreaterThan(0.3);
        const enemy = { kingdomId: k.id, type: 'war_host' };
        const read = Nemesis.battleRead(player, world, enemy);
        expect(read.stance).toBe('aggressive');
        expect(read.mult).toBeGreaterThan(1);
        expect(Nemesis.battleRead(player, world, { kingdomId: 'nobody' })).toBe(null);
        // Change your ways: they must learn you again
        for (let i = 0; i < 60; i++) Nemesis.noteStance(player, 'hold');
        const before = nm.read.stance;
        Nemesis._learn(player, nm);
        expect(nm.readTop.stance).toBe('hold');
        expect(nm.read.stance).toBeLessThan(before);
        expect(Nemesis.learnt(player, nm).some(l => l.kind === 'stance')).toBe(true);
    }, 120000);

    it('raids your busiest trade route', () => {
        const g = game();
        const { player, world } = g;
        const { nm } = lordNemesis(g, 80);
        player.tradeRoutes = [{ id: 'TR-1', fromName: 'Ashford', toName: 'Brill', totalRuns: 12, protection: 0, prosperity: 2, nextDispatchIn: 0 }];
        Nemesis._noteRoutes(player);
        nm.read = { route: 0.9 };
        nm.readTop = { route: 'TR-1' };
        let res = null;
        for (let s = 1; s < 40 && !(res && res.outcome === 'struck'); s++) res = Utils.withRng(Utils.seededRandom(s), () => Nemesis._doRaid(player, world, nm, { mult: 1, why: [] }));
        expect(res.outcome).toBe('struck');
        expect(player.tradeRoutes[0].lastResult).toBe('raided');
        expect(player.tradeRoutes[0].nextDispatchIn).toBeGreaterThanOrEqual(10);
        player.tradeRoutes = [];
    }, 120000);
});

describe('escalation and worst moments', () => {
    it('strikes sooner while you are sick', () => {
        const g = game();
        const { player, world } = g;
        const { nm } = lordNemesis(g, 90);
        nm.dueDay = day(world) + 10;
        const out = { notices: [] };
        const healthy = Nemesis.moment(player, world);
        Utils.withRng(Utils.seededRandom(11), () => {
            const every = Nemesis.stage(nm).every;
            const early = healthy.mult > 1 ? every * (1 - 1 / healthy.mult) * 0.6 : 0;
            expect(day(world) >= nm.dueDay - early).toBe(healthy.mult > 1);
        });
        player.health = 10;
        player.maxHealth = 100;
        const sick = Nemesis.moment(player, world);
        expect(sick.why).toContain('sick');
        expect(sick.mult).toBeGreaterThan(1);
        nm.acts = [];
        Utils.withRng(Utils.seededRandom(12), () => {
            const every = Nemesis.stage(nm).every;
            if (day(world) >= nm.dueDay - every * (1 - 1 / sick.mult) * 0.6) Nemesis._act(player, world, nm, sick, out);
        });
        expect(nm.acts.length + out.notices.length).toBeGreaterThan(0);
        player.health = 100;
    }, 120000);

    it('hatred grows over the years and the stage hardens', () => {
        const g = game();
        const { player, world } = g;
        const { nm } = lordNemesis(g, 34);
        expect(Nemesis.stage(nm).id).toBe('grudge');
        nm.grownDay = day(world) - 120 * 5;
        nm.dueDay = 1e9;
        Utils.withRng(Utils.seededRandom(5), () => Nemesis._week(player, world, { notices: [] }));
        expect(nm.hatred).toBeGreaterThan(45);
        expect(Nemesis.stage(nm).id).toBe('enmity');
    }, 120000);

    it('an assassin wounds you; a foiled blow is proof to lay before a court', () => {
        const g = game();
        const { player, world } = g;
        const { nm, k } = lordNemesis(g, 90);
        k.treasury = 5000;
        player.army = [];
        let res = null;
        for (let s = 1; s < 60 && !(res && res.outcome === 'struck'); s++) res = Utils.withRng(Utils.seededRandom(s), () => Nemesis._doAssassin(player, world, nm, { mult: 1, why: [] }));
        expect(res.outcome).toBe('struck');
        expect(Ailments.list(player).some(a => a.source === 'assassin')).toBe(true);
        expect(Nemesis.canAccuse(player, world, nm).ok).toBe(false);
        nm.evidence = 1;
        player.allegiance = liveKingdom(world).id;
        const due = nm.dueDay;
        const r = Nemesis.accuse(player, world, nm.id);
        expect(r.success).toBe(true);
        expect(nm.dueDay).toBe(due + Nemesis.config().accuse.stayDays);
        player.ailments.list = [];
        player.health = 100;
    }, 120000);

    it('a plot it sets is a real scheme, and its outcome comes back', () => {
        const g = game();
        const { player, world } = g;
        const { nm } = lordNemesis(g, 70);
        player.house.schemes = [];
        const res = Utils.withRng(Utils.seededRandom(2), () => Nemesis._doScheme(player, world, nm));
        if (!res) return; // no eligible plot in this world (no properties, colonies…)
        const scheme = Schemes.active(player).find(s => s.nemesisId === nm.id);
        expect(scheme).toBeTruthy();
        nm.acts.unshift({ day: day(world), kind: 'scheme', outcome: 'hidden', schemeId: scheme.id });
        Schemes._settle(player, world, scheme, 'foiled', 'Foiled.');
        Nemesis._readSettled(player, world, { notices: [] });
        expect(nm.acts[0].outcome).toBe('foiled');
        expect(nm.evidence).toBe(1);
    }, 120000);
});

describe('generations and endings', () => {
    it('the feud passes to the realm\'s new lord, and dies with the realm', () => {
        const g = game();
        const { player, world } = g;
        const { nm, k } = lordNemesis(g, 70);
        const oldName = k.lord.name;
        k.lord.name = 'Lothar the Younger';
        const out = { notices: [] };
        Utils.withRng(Utils.seededRandom(9), () => Nemesis._checkBearer(player, world, nm, out));
        expect(nm.name).toBe('Lothar the Younger');
        expect(nm.generation).toBe(2);
        expect(nm.bearers[0].name).toBe(oldName);
        expect(nm.letters[0].kind).toBe('inherit');
        k.lord.name = oldName;
        k.isAlive = false;
        Utils.withRng(Utils.seededRandom(9), () => Nemesis._checkBearer(player, world, nm, out));
        k.isAlive = true;
        expect(Nemesis.get(player, nm.id)).toBe(null);
        expect(Nemesis.past(player)[0].ended.how).toBe('extinct');
    }, 120000);

    it('a sworn avenger who dies may leave a child to carry it on', () => {
        const g = game();
        const { player, world } = g;
        player.nemesis = null;
        Nemesis.wrong(player, world, { name: 'Garrick Holt', deed: { label: 'the father you hanged' }, score: 80 });
        const nm = Utils.withRng(Utils.seededRandom(1), () => Nemesis._births(player, world, { notices: [] }));
        nm.hatred = 100;
        nm.dead = { day: day(world) };
        const out = { notices: [] };
        let seed = 1;
        let r = Utils.withRng(Utils.seededRandom(seed), () => Nemesis._checkBearer(player, world, nm, out));
        while (!r && seed < 20) {
            // Extinct this time: start again
            player.nemesis = null;
            Nemesis.wrong(player, world, { name: 'Garrick Holt', deed: { label: 'the father you hanged' }, score: 80 });
            const n2 = Utils.withRng(Utils.seededRandom(1), () => Nemesis._births(player, world, { notices: [] }));
            n2.hatred = 100;
            n2.dead = { day: day(world) };
            r = Utils.withRng(Utils.seededRandom(++seed), () => Nemesis._checkBearer(player, world, n2, out));
        }
        expect(r).toBeTruthy();
        expect(r.generation).toBe(2);
        expect(r.name).toMatch(/Holt$/);
    }, 120000);

    it('a blood price can end it; a refusal angers them', () => {
        const g = game();
        const { player, world } = g;
        const { nm } = lordNemesis(g, 20);
        player.gold = 10000;
        const res = Nemesis.reconcile(player, world, nm.id);
        expect(res.success).toBe(true);
        if (res.accepted) {
            expect(Nemesis.past(player)[0].ended.how).toBe('reconciled');
            expect(player.gold).toBe(10000 - res.cost);
        } else {
            expect(nm.hatred).toBe(20 + Nemesis.config().reconcile.failHatred);
        }
        const hot = lordNemesis(g, 95).nm;
        expect(Nemesis.canReconcile(player, world, hot).ok).toBe(false);
    }, 120000);

    it('a match between your child and their line ends it at the altar', () => {
        const g = game();
        const { player, world } = g;
        const { nm } = lordNemesis(g, 40);
        player.gold = 10000;
        player.children = [{ id: 'kid1', firstName: 'Matilda', dynasty: 'Vane', age: 19, isAlive: true, gender: 'female', upbringing: { comeOfAge: true } }];
        const opt = Nemesis.matchOptions(player, world, nm);
        expect(opt.ok).toBe(true);
        const res = Nemesis.proposeMatch(player, world, nm.id, 'kid1');
        expect(res.success).toBe(true);
        expect(Nemesis.past(player)[0].ended.how).toBe('married');
        player.children = [];
    }, 120000);
});

describe('plumbing', () => {
    it('the day draws its own dice, no-ops without a player, and saves whole', () => {
        const g = game();
        const { player, world } = g;
        lordNemesis(g, 60);
        expect(Nemesis.processDay(world, null).notices).toEqual([]);
        Utils.setSeed(99);
        const a = [Utils.random(), Utils.random()];
        Utils.setSeed(99);
        Utils.random();
        Nemesis.state(player).lastDay = null;
        const saveDay = world.day;
        world.day = Math.ceil(saveDay / 7) * 7;
        Nemesis.processDay(world, player);
        world.day = saveDay;
        expect(Utils.random()).toBe(a[1]);
        const copy = JSON.parse(JSON.stringify(Nemesis.serialize(player)));
        expect(copy.list.length).toBe(Nemesis.active(player).length);
        const p2 = { nemesis: copy };
        Nemesis.loadState(p2);
        expect(Nemesis.active(p2)[0].name).toBe(Nemesis.active(player)[0].name);
        expect(typeof SaveLoad).toBe('object');
    }, 120000);

    it('the prose seam: templates by default, a provider\'s text when set, and it never throws', () => {
        const g = game();
        const { player, world } = g;
        const { nm } = lordNemesis(g, 60);
        const tpl = Nemesis.taunt(player, world, nm);
        expect(typeof tpl).toBe('string');
        const asked = [];
        Nemesis.setProse({ write: (w, o) => { asked.push(o.key); return o.fallback; }, text: (w, key, f) => (key.includes(':taunt:') ? 'Written by the scribe.' : f) });
        expect(Nemesis.taunt(player, world, nm)).toBe('Written by the scribe.');
        expect(asked.some(k => k.startsWith(`nemesis:${nm.id}:taunt`))).toBe(true);
        Nemesis.setProse({ write: () => { throw new Error('x'); }, text: () => { throw new Error('y'); } });
        expect(Nemesis.taunt(player, world, nm)).toBe(tpl);
        Nemesis.resetProse();
    }, 120000);
});
