// The last crisis of the age (systems/lastCrisis.js): the reckoning gathers
// against a dominant House, breaks as a horde, a holy war or a pretender, and
// ends in a Golden Age named for the House or a Dark Age that breaks its realm.
import { describe, it, expect, beforeAll } from 'vitest';
import { loadData, newGame, endDay } from './playtest/harness.js';
import { LastCrisis } from '../systems/lastCrisis.js';
import { Crises } from '../systems/crises.js';
import { Throne } from '../systems/throne.js';
import { Legacy } from '../systems/legacy.js';
import { Annals } from '../systems/annals.js';
import { Coalitions } from '../systems/coalitions.js';
import { HighCrowns } from '../systems/highCrowns.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { KingdomBonuses } from '../world/kingdomState.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';

/** A player crowned in the realm with the most towns. */
function crowned(seed) {
    const g = newGame(seed);
    const { world, player } = g;
    const k = world.kingdoms.filter(x => x.isAlive)
        .sort((a, b) => KingdomAI._settlementsOf(b, world).length - KingdomAI._settlementsOf(a, world).length || String(a.id).localeCompare(String(b.id)))[0];
    Throne._takeThrone(player, world, k);
    player.q = k.capital.q;
    player.r = k.capital.r;
    return { ...g, realm: k };
}

/** Conquered provinces: towns taken from the other realms (not their capitals), nearest first, until the realm holds `n`. */
function grow(world, realm, n) {
    const cands = [];
    for (const k of world.kingdoms) {
        if (!k.isAlive || k === realm) continue;
        for (const t of KingdomAI._settlementsOf(k, world)) {
            if (k.capital && t.q === k.capital.q && t.r === k.capital.r) continue;
            cands.push({ k, t, d: Hex.wrappingOffsetDistance(t.q, t.r, realm.capital.q, realm.capital.r, world.width) });
        }
    }
    cands.sort((a, b) => a.d - b.d || a.t.q - b.t.q || a.t.r - b.t.r);
    for (const c of cands) {
        if (KingdomAI._settlementsOf(realm, world).length >= n) break;
        KingdomAI.takeTile(realm, c.k, world, c.t.q, c.t.r);
    }
    if (typeof world.invalidateSettlements === 'function') world.invalidateSettlements();
}

/** Run the last crisis's own clock day by day (the world itself is not advanced). */
function days(world, player, n) {
    const notices = [];
    for (let i = 0; i < n; i++) {
        world.day++;
        notices.push(...LastCrisis.processDay(world, player).notices);
    }
    return notices;
}

/** Make the realm dominate: the lion's share of the world's arms. */
function dominate(world, realm) {
    const others = world.kingdoms.filter(k => k.isAlive && k !== realm).reduce((s, k) => s + (k.military || 0), 0);
    realm.military = Math.max(realm.military || 0, others * 2);
}

describe('LastCrisis', () => {
    beforeAll(async () => { await loadData(); }, 60000);

    it('measures dominance and gathers the reckoning only while it is held', () => {
        const { world, player, realm } = crowned(11);
        const st = LastCrisis.state(world);
        let m = LastCrisis.measure(world, player);
        expect(m.realm).toBe(realm);
        expect(m.townShare).toBeGreaterThan(0);
        dominate(world, realm);
        m = LastCrisis.measure(world, player);
        expect(m.mightShare).toBeGreaterThan(0.6);
        expect(m.dominant).toBe(true);
        days(world, player, 70);
        expect(st.held).toBeGreaterThanOrEqual(63);
        const meter = LastCrisis.meter(world, player);
        expect(meter.pct).toBeGreaterThan(0.5);
        expect(meter.pct).toBeLessThan(1);
        // Slipping back, it ebbs twice as fast
        realm.military = 0;
        const before = st.held;
        days(world, player, 14);
        expect(st.held).toBeLessThan(before - 20);
        // No player (the interregnum): it neither gathers nor fires
        dominate(world, realm);
        const h = st.held;
        days(world, null, 21);
        expect(st.held).toBe(h);
    }, 60000);

    it('fires once held long enough, never beside a world crisis, and draws no shared RNG', () => {
        const { world, player, realm } = crowned(11);
        dominate(world, realm);
        const st = LastCrisis.state(world);
        world.day = 20 * 120;
        st.need = 14;
        Crises.state(world).nextDay = 1e9;
        // (a world crisis running: a stand-in, the reckoning only asks whether one is)
        Crises.state(world).active = { uid: 'stub1', kind: 'rush', name: 'a rush', phase: 'rush', log: [], data: {} };
        Utils.setSeed(5);
        const a = Utils.random();
        Utils.setSeed(5);
        days(world, player, 28);
        expect(Utils.random()).toBe(a);
        expect(st.phase).toBe('watch');
        Crises.state(world).active = null;
        days(world, player, 14);
        expect(st.phase).toBe('omens');
        expect(st.trial && LastCrisis.KINDS).toContain(st.trial.kind);
        expect(st.log.length).toBe(1);
        // ...and while its omens run no world crisis begins
        expect(Crises.state(world).nextDay).toBeGreaterThan(world.day);
    }, 60000);

    it('refuses a kind it does not know, and leaves the watch untouched', () => {
        const { world, player, realm } = crowned(11);
        grow(world, realm, 9);
        const seq = LastCrisis.state(world).seq;
        expect(LastCrisis.start(world, player, { kind: 'pretender' })).toBe(false);
        const st = LastCrisis.state(world);
        expect(st.phase).toBe('watch');
        expect(st.trial == null).toBe(true);
        expect(st.seq).toBe(seq);
    });

    it('a pretender carves out a real kingdom; beaten, the House wins a Golden Age', () => {
        const { world, player, realm } = crowned(11);
        grow(world, realm, 9);
        const towns0 = KingdomAI._settlementsOf(realm, world).length;
        expect(towns0).toBe(9);
        const gold0 = realm.treasury;
        expect(LastCrisis.start(world, player, { kind: 'breakaway' })).toBe(true);
        let st = LastCrisis.state(world);
        st.omenEnd = world.day;
        days(world, player, 7);
        expect(st.phase).toBe('trial');
        const p = world.getKingdom(st.trial.pretenderId);
        expect(p && p.isAlive).toBe(true);
        expect(p.lord).toBeTruthy();
        const ptowns = KingdomAI._settlementsOf(p, world);
        expect(ptowns.length).toBeGreaterThanOrEqual(2);
        expect(KingdomAI._settlementsOf(realm, world).length).toBe(towns0 - ptowns.length);
        expect(p.wars).toContain(realm.id);
        // The pretender's chests came out of the realm's (nothing minted)
        expect(p.treasury + realm.treasury).toBeCloseTo(gold0, 5);
        expect(p.territory.every(t => world.getTile(t.q, t.r).kingdom === p.id)).toBe(true);
        // Funding the royal host moves real coin
        player.gold = 2000;
        const mil = realm.military;
        const res = LastCrisis.act(player, world, 'fund', 500);
        expect(res.success).toBe(true);
        expect(player.gold).toBe(1500);
        expect(realm.military).toBe(mil + 125);
        // The pretender's cause collapses: his towns come home
        const prestige0 = player.house.prestige;
        const score0 = Legacy.score(player, world);
        st.trial.resolve = 0.5;
        days(world, player, 7);
        expect(st.phase).toBe('age');
        expect(st.age.kind).toBe('golden');
        expect(p.isAlive).toBe(false);
        expect(KingdomAI._settlementsOf(realm, world).length).toBe(towns0);
        expect(realm.ageMods && realm.ageMods.stability).toBeGreaterThan(0);
        expect(KingdomBonuses.get(realm, 'stability')).toBeGreaterThanOrEqual(realm.ageMods.stability - 1);
        expect(player.house.prestige).toBeGreaterThan(prestige0);
        expect(player.house.ages[0].kind).toBe('golden');
        expect(Legacy.score(player, world)).toBeGreaterThan(score0);
        expect(LastCrisis.threatMult(world, player)).toBeLessThan(1);
        // The Annals give it a chapter
        const book = Annals.compose(player, world);
        expect(book.ages.some(a => a.id.startsWith('age_last') && a.outcome === 'golden')).toBe(true);
        // A save keeps the age and lays its mods on again
        const saved = LastCrisis.serialize(world);
        delete realm.ageMods;
        LastCrisis.restore(saved, world);
        expect(realm.ageMods.stability).toBeGreaterThan(0);
        // The age runs out in fifty years, and the next reckoning is an age away
        st = LastCrisis.state(world);
        st.age.until = world.day + 1;
        days(world, player, 7);
        expect(st.phase).toBe('watch');
        expect(realm.ageMods).toBeFalsy();
        expect(st.nextAllowed).toBeGreaterThan(world.day + 100 * 120);
    }, 60000);

    it('a holy war that breaks the realm brings a Dark Age of successor states', () => {
        const { world, player, realm } = crowned(11);
        grow(world, realm, 9);
        player.house.prestige = 200;
        expect(LastCrisis.start(world, player, { kind: 'crusade' })).toBe(true);
        const st = LastCrisis.state(world);
        st.omenEnd = world.day;
        days(world, player, 7);
        expect(st.phase).toBe('trial');
        expect(st.trial.foes.length).toBeGreaterThanOrEqual(2);
        for (const id of st.trial.foes) expect(world.getKingdom(id).wars).toContain(realm.id);
        // Buying a crusader out ends its war and shakes the others
        const foe = world.getKingdom(st.trial.foes[0]);
        player.gold = 1e6;
        const r0 = st.trial.resolve;
        expect(LastCrisis.act(player, world, 'buyoff', foe.id).success).toBe(true);
        expect(foe.wars).not.toContain(realm.id);
        expect(st.trial.resolve).toBeLessThan(r0);
        // The realm is beaten: its armies gone, its years run out with the foe unbroken
        const towns0 = KingdomAI._settlementsOf(realm, world).length;
        const kingdoms0 = world.kingdoms.filter(k => k.isAlive).length;
        realm.military = 0;
        for (const id of st.trial.foes) world.getKingdom(id).military = 5000;
        st.trial.until = world.day + 1;
        days(world, player, 7);
        expect(st.phase).toBe('age');
        expect(st.age.kind).toBe('dark');
        expect(st.age.successors.length).toBeGreaterThanOrEqual(1);
        expect(world.kingdoms.filter(k => k.isAlive).length).toBe(kingdoms0 + st.age.successors.length);
        const left = KingdomAI._settlementsOf(realm, world).length;
        expect(left).toBeLessThan(towns0);
        expect(left).toBeGreaterThanOrEqual(1);
        // The House keeps its capital
        expect(world.getTile(realm.capital.q, realm.capital.r).settlement.kingdom).toBe(realm.id);
        for (const id of st.age.successors) {
            const s = world.getKingdom(id);
            expect(KingdomAI._settlementsOf(s, world).length).toBeGreaterThan(0);
            expect(s.lord).toBeTruthy();
        }
        expect(player.house.prestige).toBeLessThan(200);
        expect(realm.ageMods.stability).toBeLessThan(0);
        expect(player.house.ages[0].kind).toBe('dark');
        // The realms' threat is scaled where Coalitions reads it
        const k = world.kingdoms.find(x => x.isAlive && x !== realm && !st.age.successors.includes(x.id));
        const pts = [{ q: realm.capital.q, r: realm.capital.r }];
        const h1 = Coalitions.assess(player, world, k, { score: 120 }, pts, realm).hostility;
        const age = st.age;
        st.phase = 'watch';
        const h0 = Coalitions.assess(player, world, k, { score: 120 }, pts, realm).hostility;
        st.phase = 'age';
        expect(st.age).toBe(age);
        expect(LastCrisis.threatMult(world, player)).toBeCloseTo(0.85, 5);
        expect(h0).toBeGreaterThan(0);
        expect(h1).toBeLessThan(h0);
    }, 60000);

    it('a horde is a real invasion aimed at the realm, sized to its army', () => {
        const { world, player, realm } = crowned(7);
        realm.military = 900;
        expect(LastCrisis.start(world, player, { kind: 'horde' })).toBe(true);
        const st = LastCrisis.state(world);
        st.omenEnd = world.day;
        days(world, player, 7);
        expect(st.phase).toBe('trial');
        const c = Crises.active(world);
        expect(c && c.uid).toBe(st.trial.uid);
        expect(c.aim.realmId).toBe(realm.id);
        expect(c.name).toMatch(/Great Coming/);
        // The host comes ashore within weeks, near the realm, as strong as it was sized
        for (let i = 0; i < 21; i++) { world.day++; Crises.processDay(world, player); LastCrisis.processDay(world, player); }
        expect(c.phase).toBe('war');
        expect(c.data.strength0).toBe(st.trial.host);
        expect(st.trial.host).toBeGreaterThanOrEqual(900);
        const towns = KingdomAI._settlementsOf(realm, world);
        const d = Math.min(...towns.map(t => Hex.wrappingOffsetDistance(t.q, t.r, c.data.at.q, c.data.at.r, world.width)));
        expect(d).toBeLessThanOrEqual(16);
        // When it closes, the last crisis is judged on what the realm still holds
        c.phase = 'aftermath';
        c.outcome = 'repelled';
        c.phaseEnd = world.day;
        for (let i = 0; i < 7; i++) { world.day++; Crises.processDay(world, player); }
        expect(Crises.active(world)).toBe(null);
        days(world, player, 7);
        expect(st.phase).toBe('age');
        expect(['golden', 'dark']).toContain(st.age.kind);
    }, 60000);

    it('plays on in the real day loop: wars fought, the clock kept, no crash', () => {
        const g = crowned(11);
        const { world, player, realm } = g;
        grow(world, realm, 8);
        expect(LastCrisis.start(world, player, { kind: 'breakaway' })).toBe(true);
        const st = LastCrisis.state(world);
        st.omenEnd = world.day + 3;
        for (let i = 0; i < 150; i++) {
            player.starvationDays = 0;
            player.health = Math.max(player.health || 0, 100);
            endDay(g);
        }
        expect(['trial', 'age']).toContain(st.phase);
        expect(st.trialDay).toBeGreaterThan(0);
        if (st.phase === 'trial') expect(st.trial.resolve).toBeLessThan(100);
        // A pretender's realm is a real kingdom on the map, with its towns
        const p = world.getKingdom(st.trial.pretenderId);
        expect(p).toBeTruthy();
        expect(LastCrisis.meter(world, player).stage).not.toBe('watch');
    }, 180000);

    it('an emperor dominates, and every crown worn counts (systems/highCrowns.js)', () => {
        const { world, player, realm } = crowned(11);
        const other = world.kingdoms.find(k => k.isAlive && k !== realm);
        const m0 = LastCrisis.measure(world, player);
        try {
            LastCrisis.useHighCrowns({ isEmperor: () => true, crownsOf: () => [{ kingdomId: realm.id, kingdom: realm }, { kingdomId: other.id, kingdom: other }] });
            const m = LastCrisis.measure(world, player);
            expect(m.emperor).toBe(true);
            expect(m.dominant).toBe(true);
            expect(m.crowns.length).toBe(2);
            expect(m.myTowns).toBeGreaterThan(m0.myTowns);
        } finally {
            LastCrisis.useHighCrowns(HighCrowns);
        }
        // The real one, with no empire proclaimed: just the one crown
        expect(LastCrisis.measure(world, player).crowns.map(k => k.id)).toEqual([realm.id]);
    }, 60000);

    it('saves and restores its state', () => {
        const { world, player } = crowned(11);
        LastCrisis.start(world, player, { kind: 'crusade' });
        const snap = JSON.parse(JSON.stringify(LastCrisis.serialize(world)));
        world.lastCrisis = null;
        LastCrisis.restore(snap, world);
        expect(LastCrisis.state(world).phase).toBe('omens');
        expect(LastCrisis.state(world).trial.kind).toBe('crusade');
    }, 60000);
});
