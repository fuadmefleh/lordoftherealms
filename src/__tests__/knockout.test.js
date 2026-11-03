// Beaten to 0 health is beaten senseless, not dead: who downed you decides
// what comes next (systems/knockout.js).
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Knockout } from '../systems/knockout.js';
import { NpcDisposition } from '../systems/npcDisposition.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});
beforeEach(() => Utils.setSeed(11));

const player = () => ({ name: 'Wanderer', gold: 200, health: 0, maxHealth: 100 });
let nextId = 1;
const npc = (type = 'villager', extra = {}) => ({ id: nextId++, type, name: 'Bram', personalityTraits: [], ...extra });

function tally(make, n = 400, ctx = {}) {
    const out = {};
    for (let i = 0; i < n; i++) {
        const v = Knockout.attackerVerdict(make(), player(), ctx);
        out[v.act] = (out[v.act] || 0) + 1;
    }
    return out;
}

describe('Knocked out', () => {
    it('the watch never kills: the wanted go to the cells, the rest get a warning', () => {
        const g = npc('guard');
        expect(Knockout.attackerVerdict(g, player(), { wanted: { id: 1 } }).act).toBe('arrest');
        expect(Knockout.attackerVerdict(g, player(), {}).act).toBe('warn');
        expect(tally(() => npc('guard')).finish).toBeUndefined();
    });

    it('most folk leave you be or rob you; few finish you', () => {
        const t = tally(() => npc('villager'));
        expect((t.finish || 0) / 400).toBeLessThan(0.08);
        expect((t.rob || 0) + (t.leave || 0)).toBeGreaterThan(360);
        expect(t.rob).toBeGreaterThan(50);
    });

    it('kin of someone you killed will likely finish you', () => {
        const t = tally(() => {
            const n = npc('villager');
            NpcDisposition.getMemory(n).grudge = { victimName: 'Alda', relation: 'sibling', severity: 'murder' };
            return n;
        });
        expect((t.finish || 0) / 400).toBeGreaterThan(0.6);
        const v = Knockout.attackerVerdict(Object.assign(npc(), { _dialogMemory: { disposition: 5, grudge: { victimName: 'Alda', severity: 'murder' } } }), player(), { rnd: () => 0 });
        expect(v.act).toBe('finish');
        expect(v.why).toMatch(/Alda/);
    });

    it('a child never kills; a priest rarely robs', () => {
        expect(tally(() => npc('child')).finish).toBeUndefined();
        const t = tally(() => npc('priest'));
        expect((t.rob || 0) / 400).toBeLessThan(0.15);
    });

    it('waking costs hours and leaves a little health; robbed, part of the purse', () => {
        const p = player();
        const res = Knockout.playerWakes(p, { act: 'rob' });
        expect(res.hours).toBeGreaterThanOrEqual(1);
        expect(p.health).toBeGreaterThan(0);
        expect(p.health).toBeLessThan(30);
        expect(res.stolen).toBeGreaterThan(0);
        expect(p.gold).toBe(200 - res.stolen);
        const q = player();
        expect(Knockout.playerWakes(q, { act: 'leave' }).stolen).toBe(0);
        expect(q.gold).toBe(200);
    });

    it('an NPC lies senseless for a while and comes round with a little health', () => {
        const w = Knockout.npcWake();
        expect(w.seconds).toBeGreaterThan(30);
        expect(w.hpShare).toBeGreaterThan(0);
        expect(Knockout.wakeLine()).toBeTruthy();
    });
});

describe('Who started it', () => {
    it('the player threw the first blow in town: they run for the watch', () => {
        const t = tally(() => npc('villager'), 400, { starter: 'player', hasWatch: true });
        expect((t.fetch || 0) / 400).toBeGreaterThan(0.75);
        // No watch out on the open road: the old ways (rob, leave)
        const road = tally(() => npc('villager'), 200, { starter: 'player', hasWatch: false });
        expect(road.fetch).toBeUndefined();
        // A child doesn't fetch anyone
        expect(tally(() => npc('child'), 100, { starter: 'player', hasWatch: true }).fetch).toBeUndefined();
    });

    it('they set on the player: kill, or their prison camp where the realm allows it', () => {
        const allowed = tally(() => npc('villager'), 600, { starter: 'npc', hasWatch: true, campsAllowed: true, campName: 'Bram\'s camp' });
        expect(allowed.capture).toBeGreaterThan(200);
        expect(allowed.finish).toBeGreaterThan(40);
        expect(allowed.fetch).toBeUndefined();
        const banned = tally(() => npc('villager'), 600, { starter: 'npc', hasWatch: true, campsAllowed: false });
        expect(banned.capture).toBeUndefined();
        expect(banned.finish).toBeGreaterThan(40);
        const v = Knockout.attackerVerdict(npc(), player(), { starter: 'npc', campsAllowed: true, rnd: (() => { const s = [0.99, 0.1, 0.5]; let i = 0; return () => s[i++ % s.length]; })() });
        expect(v.act).toBe('capture');
        expect(v.days).toBeGreaterThan(0);
    });

    it('a camp takes the player into servitude: days of labour, freedom to buy', () => {
        const p = player();
        const r = Knockout.capturePlayer(p, { act: 'capture', days: 10 }, { campName: 'Bram\'s prison camp', keeper: 'Bram', kingdom: 'k1' });
        expect(r.days).toBe(10);
        expect(p.indenturedServitude).toMatchObject({ captor: 'Bram\'s prison camp', daysRemaining: 10, privateCamp: true, canBuyFreedom: true });
        expect(p.gold).toBe(200 - r.took);
    });

    it('some realms allow private prison camps, others not — and a realm\'s own law decides', () => {
        const world = (k) => ({ getKingdom: () => k });
        let yes = 0;
        for (let i = 0; i < 200; i++) if (Knockout.privatePrisonsAllowed(world({ id: `k${i}`, name: `Realm ${i}` }), `k${i}`)) yes++;
        expect(yes).toBeGreaterThan(40);
        expect(yes).toBeLessThan(140);
        // The same realm, the same answer
        const k = { id: 'k7', name: 'Realm 7' };
        expect(Knockout.privatePrisonsAllowed(world(k), 'k7')).toBe(Knockout.privatePrisonsAllowed(world(k), 'k7'));
        expect(Knockout.privatePrisonsAllowed(world({ ...k, laws: { privatePrisons: true } }), 'k7')).toBe(true);
        expect(Knockout.privatePrisonsAllowed(world({ ...k, laws: { privatePrisons: false } }), 'k7')).toBe(false);
        expect(Knockout.privatePrisonsAllowed(world(k), null)).toBe(false);
    });

    it('a householder who hates the player may set on them; a friendly one never', () => {
        let n = 0;
        for (let i = 0; i < 200; i++) if (Knockout.householderAttacks(npc('villager', { _dialogMemory: { disposition: 5 } })).attacks) n++;
        expect(n).toBeGreaterThan(60);
        for (let i = 0; i < 100; i++) expect(Knockout.householderAttacks(npc('villager', { _dialogMemory: { disposition: 70 } })).attacks).toBe(false);
        expect(Knockout.householderAttacks(npc('guard', { _dialogMemory: { disposition: 0 } })).attacks).toBe(false);
    });
});
