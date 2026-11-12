// Age-defining crises (systems/crises.js): each kind starts, runs through its
// phases on the real systems, and leaves its mark; the shared RNG is never drawn.
import { describe, it, expect, beforeAll } from 'vitest';
import { loadData, newGame } from './playtest/harness.js';
import { Afterlife } from '../player/afterlife.js';
import { Crises } from '../systems/crises.js';
import { Religion } from '../systems/religion.js';
import { Annals } from '../systems/annals.js';
import { Hinterland } from '../world/hinterland.js';
import { Utils } from '../core/utils.js';
import { TownMarks } from '../world/townMarks.js';
import { Interrupts } from '../core/interrupts.js';

function pass(world, n) {
    for (let i = 0; i < n; i++) Afterlife.passDay(world, null);
}

function fresh(seed = 7) {
    const g = newGame(seed);
    pass(g.world, 8);
    return g;
}

describe('Crises', () => {
    beforeAll(async () => { await loadData(); }, 60000);

    it('schedules the first crisis years out, not in the opening', () => {
        const { world } = fresh(11);
        const st = Crises.state(world);
        expect(st.active).toBe(null);
        expect(st.nextDay).toBeGreaterThanOrEqual(12 * 120);
        expect(st.nextDay).toBeLessThanOrEqual(22 * 120);
    }, 60000);

    it('an invasion lands real hosts, forms an alliance and fights for towns', () => {
        const { world, player } = fresh(7);
        const c = Crises.start(world, 'invasion');
        expect(c).toBeTruthy();
        expect(c.phase).toBe('omens');
        c.phaseEnd = world.day + 1;
        pass(world, 10);
        expect(c.phase).toBe('war');
        const hosts = world.units.filter(u => u.type === 'invader_host');
        expect(hosts.length).toBeGreaterThanOrEqual(2);
        expect(hosts.every(h => h.strength > 0 && h.hostile)).toBe(true);
        expect((c.data.alliance || []).length + (c.data.aloof || []).length).toBeGreaterThan(0);
        pass(world, 120);
        expect((c.data.taken || []).length + (c.data.held || 0)).toBeGreaterThan(0);
        if ((c.data.taken || []).length) {
            const realm = world.getKingdom(c.data.realmId);
            expect(realm).toBeTruthy();
            expect(realm.lord).toBeTruthy();
        }
        // The choices offered are plain data; funding moves real coin
        player.gold = 1000;
        const member = c.data.alliance.map(id => world.getKingdom(id)).find(k => k && k.isAlive && k.capital);
        if (member && c.phase === 'war') {
            player.q = member.capital.q;
            player.r = member.capital.r;
            const t0 = member.treasury;
            const res = Crises.act(player, world, 'fund', 100);
            expect(res.success).toBe(true);
            expect(player.gold).toBe(900);
            expect(member.treasury).toBe(t0 + 100);
        }
    }, 120000);

    it('a great plague spreads along trade links and kills', () => {
        const { world } = fresh(9);
        const c = Crises.start(world, 'plague');
        expect(c).toBeTruthy();
        const originKey = Object.keys(c.data.towns)[0];
        const [q, r] = originKey.split(',').map(Number);
        const pop0 = world.getTile(q, r).settlement.population;
        pass(world, 150);
        expect(Object.keys(c.data.towns).length).toBeGreaterThan(1);
        expect(c.data.dead).toBeGreaterThan(0);
        expect(world.getTile(q, r).settlement.population).toBeLessThan(pop0);
        expect(Crises.news(world).length).toBeGreaterThan(1);
    }, 120000);

    it('a plague town keeps a plague pit once its course is run', () => {
        const { world } = fresh(9);
        Interrupts.take(world);
        const c = Crises.start(world, 'plague');
        // (a crisis beginning stops a time skip: core/interrupts.js)
        expect(Interrupts.pending(world).some(e => e.source === 'crises')).toBe(true);
        const key = Object.keys(c.data.towns)[0];
        const [q, r] = key.split(',').map(Number);
        const s = world.getTile(q, r).settlement;
        const before = TownMarks.marks(s, 'mound').length;
        Object.assign(c.data.towns[key], { end: world.day + 1, dead: 400 });
        pass(world, 10);
        const pits = TownMarks.marks(s, 'mound').filter(m => m.cause === 'plague');
        expect(pits.length).toBe(before + 1);
        expect(pits[pits.length - 1].dead).toBeGreaterThanOrEqual(400);
        pass(world, 10);
        expect(TownMarks.marks(s, 'mound').filter(m => m.cause === 'plague').length).toBe(pits.length);
    }, 120000);

    it('an invasion storm leaves a cairn, and a town it takes keeps the ruins of the sack', () => {
        const { world } = fresh(7);
        const c = Crises.start(world, 'invasion');
        c.phaseEnd = world.day + 1;
        pass(world, 10);
        expect(c.phase).toBe('war');
        const band = world.units.filter(u => u.type === 'invader_host' && !u.destroyed);
        const town = world.getAllSettlements().find(x => x.kingdom && x.kingdom !== c.data.realmId && x.type !== 'capital');
        expect(town && band.length).toBeTruthy();
        for (const h of band) h.strength = 100000;
        const sacks0 = TownMarks.marks(world.getTile(town.q, town.r).settlement, 'sack').length;
        Crises._assault(world, c, band, town, world.day);
        const s = world.getTile(town.q, town.r).settlement;
        expect(TownMarks.marks(s, 'sack').length).toBe(sacks0 + 1);
        expect(TownMarks.marks(s, 'cairn').length + TownMarks.fieldMarks(world, town.q, town.r).length).toBeGreaterThan(0);
    }, 120000);

    it('a schism splits a faith into rites the diplomacy reads', () => {
        const { world } = fresh(8);
        const c = Crises.start(world, 'schism');
        expect(c).toBeTruthy();
        c.phaseEnd = world.day + 1;
        pass(world, 10);
        expect(c.phase).toBe('split');
        c.phaseEnd = world.day + 1;
        pass(world, 10);
        expect(c.phase).toBe('strife');
        const faithful = world.kingdoms.filter(k => k.isAlive && k.religion && k.religion.riteOf === c.uid);
        expect(faithful.length).toBeGreaterThanOrEqual(2);
        expect(faithful.some(k => k.religion.rite === 'reformed')).toBe(true);
        const ref = faithful.find(k => k.religion.rite === 'reformed');
        const orth = faithful.find(k => k.religion.rite === 'orthodox');
        if (ref && orth) {
            expect(Religion.sameFaith(ref, orth)).toBe(false);
            expect(Religion.faithCompatibility(ref, orth)).toBeLessThan(0);
        }
        c.phaseEnd = world.day + 1;
        pass(world, 10);
        expect(c.phase).toBe('aftermath');
        expect(c.outcome).toBeTruthy();
    }, 120000);

    it('a famine lays blights in the harvests of its regions', () => {
        const { world } = fresh(10);
        const c = Crises.start(world, 'famine');
        expect(c).toBeTruthy();
        const st = world.harvests;
        const planted = c.data.regions.some(id => (st.cur.regions[id].plan || []).some(p => p.kind === 'rust'));
        expect(planted || st.cur.settled).toBe(true);
    }, 60000);

    it('a gold rush opens a mother lode and draws people in', () => {
        const { world } = fresh(12);
        const c = Crises.start(world, 'rush');
        if (!c) return; // (no hill for gold near a town on this map)
        const site = Hinterland.site(world, c.data.siteId);
        expect(site.kind).toBe('gold_mine');
        expect(site.res0).toBeGreaterThan(300);
        const boom0 = world.getTile(c.data.townQ, c.data.townR).settlement.population;
        pass(world, 60);
        expect(c.data.gained).toBeGreaterThan(0);
        expect(world.getTile(c.data.townQ, c.data.townR).settlement.population).toBeGreaterThan(boom0 - 50);
    }, 60000);

    it('draws nothing from the shared RNG', () => {
        const { world } = fresh(13);
        const c = Crises.start(world, 'invasion');
        c.phaseEnd = world.day;
        Utils.setSeed(4242);
        const saved = world.day;
        for (let i = 0; i < 30; i++) { world.day = saved + i; Crises.processDay(world, null); }
        const a = Utils.random();
        Utils.setSeed(4242);
        expect(Utils.random()).toBe(a);
    }, 60000);

    it('survives a save and reads as Annals chapters', () => {
        const { world, player } = fresh(9);
        const c = Crises.start(world, 'plague');
        pass(world, 14);
        const saved = JSON.parse(JSON.stringify(Crises.serialize(world)));
        world.crises = null;
        Crises.restore(saved, world);
        expect(Crises.active(world).uid).toBe(c.uid);
        const ages = Crises.annalChapters(world, 0);
        expect(ages.length).toBe(1);
        expect(ages[0].paragraphs.length).toBeGreaterThan(0);
        const book = Annals.compose(player, world);
        expect(book.ages.length).toBe(1);
        expect(Annals.toText(book)).toContain(ages[0].title);
    }, 60000);
});
