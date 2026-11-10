// The General's court and orders (player/generalship.js): the rival is a real
// lord of one of the realm's noble Houses whose schemes the player sees and
// answers; a coup seats a Royal Court as the Monarch start does; a "take the
// town" order counts only when the general's host took part; a storm or a
// raid fought on the town's own streets hands its outcome to the usual path.

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { loadData, newGame } from './playtest/harness.js';
import { Generalship } from '../player/generalship.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { Economy } from '../world/economy.js';
import { Estates } from '../world/estates.js';
import { Kingship } from '../systems/kingship.js';
import { Throne } from '../systems/throne.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';

beforeAll(async () => {
    await loadData();
});

afterEach(() => {
    vi.restoreAllMocks();
});

function atWar(g, rank = 2) {
    const w = g.world;
    const realms = w.kingdoms.filter(k => k.isAlive !== false && Economy.realmTowns(k, w).length >= 2);
    const [a, b] = realms;
    if (!(a.wars || []).includes(b.id)) KingdomAI.startWar(a, b, w);
    a.military = Math.max(a.military, 2000);
    b.military = Math.max(b.military, 2000);
    a.treasury = Math.max(a.treasury || 0, 5000);
    g.player.reputation = g.player.reputation || {};
    const c = Generalship._grant(g.player, w, a, { rank, favour: 50, morale: 60, rivalInfluence: 40 });
    return { a, b, c, w };
}

describe('the rival at court', () => {
    it('is a lord of one of the realm\'s noble Houses, with traits and a persona', () => {
        const g = newGame(401);
        const { a, c, w } = atWar(g);
        const r = c.rival;
        expect(Array.isArray(r.traits)).toBe(true);
        expect(r.traits.some(t => t.id === 'ambitious' || t.id === 'cunning')).toBe(true);
        expect(r.persona && r.persona.manner).toBeTruthy();
        if (Estates.enabled() && r.holder) {
            const h = Estates.holder(w, r.holder);
            expect(Estates.kindOf(r.holder)).toBe('noble');
            expect(String(h.kid)).toBe(String(a.id));
            expect(r.name).toContain(String(r.house).replace(/^House\s+/i, ''));
        }
    }, 60000);

    it('hatches a scheme the player sees coming, which bites on its day unless answered', () => {
        const g = newGame(402);
        const { c, a, w } = atWar(g);
        const out = { notices: [] };
        w.day = c.since + 15;
        Generalship._courtDay(g.player, w, c, a, out);
        const sc = c.rival.scheme;
        expect(sc).toBeTruthy();
        expect(sc.due).toBeGreaterThan(w.day);
        expect(out.notices.some(n => n.title === 'A Scheme at Court')).toBe(true);
        // Forced to slander, it costs favour on its day
        sc.kind = 'slander';
        const f0 = c.favour;
        w.day = sc.due;
        Generalship._courtDay(g.player, w, c, a, { notices: [] });
        expect(c.rival.scheme).toBeNull();
        expect(c.favour).toBeLessThan(f0);
    }, 60000);

    it('can be exposed (foiled and shamed) or bought off with gold into his House\'s purse', () => {
        const g = newGame(403);
        const { c, w } = atWar(g);
        c.rival.scheme = { kind: 'wages', since: w.day, due: w.day + 7, text: 'x', strength: 40 };
        vi.spyOn(Utils, 'random').mockReturnValue(0);
        const inf = c.rival.influence;
        const res = Generalship.exposeScheme(g.player, w);
        expect(res.success).toBe(true);
        expect(res.failed).toBeFalsy();
        expect(c.rival.scheme).toBeNull();
        expect(c.rival.influence).toBeLessThan(inf);
        vi.restoreAllMocks();
        // Bought off: the gold leaves the purse for his House (or the capital), none minted
        c.rival.persona.bribable = true;
        c.rival.scheme = { kind: 'slander', since: w.day, due: w.day + 7, text: 'x', strength: 40 };
        const price = Generalship.buyOffPrice(c);
        g.player.gold = price + 10;
        const h = c.rival.holder && Estates.enabled() ? Estates.ensureHolder(w, c.rival.holder) : null;
        const purse0 = h ? Number(h.purse) || 0 : 0;
        const bought = Generalship.buyOffRival(g.player, w);
        expect(bought.success).toBe(true);
        expect(g.player.gold).toBe(10);
        if (h) expect(h.purse).toBe(purse0 + price);
        expect(c.rival.scheme).toBeNull();
        expect(c.rival.quietUntil).toBeGreaterThan(w.day);
        // An honourable lord is not for sale
        c.rival.persona.bribable = false;
        expect(Generalship.buyOffRival(g.player, w).success).toBe(false);
    }, 60000);

    it('an old save\'s rival (a name and a number) becomes a lord on the next day', () => {
        const g = newGame(404);
        const { c, a, w } = atWar(g);
        c.rival = { name: 'Lord Osric', influence: 30 };
        Generalship._courtDay(g.player, w, c, a, { notices: [] });
        expect(c.rival.name).toBe('Lord Osric');
        expect(c.rival.influence).toBe(30);
        expect(Array.isArray(c.rival.traits)).toBe(true);
    }, 60000);
});

describe('a coup seats a Royal Court', () => {
    it('crowned, the usurper has sworn lords, a council, a royal guard and a pretender', () => {
        const g = newGame(405);
        const { a, c, w } = atWar(g);
        g.player.q = a.capital.q; g.player.r = a.capital.r;
        c.morale = 90;
        for (const lt of c.lieutenants) lt.loyalty = 90;
        const army0 = (g.player.army || []).length;
        vi.spyOn(Utils, 'random').mockReturnValue(0);
        const res = Generalship.stageCoup(g.player, w);
        vi.restoreAllMocks();
        expect(res.crowned).toBe(true);
        expect(Throne.ruledKingdom(g.player, w).id).toBe(a.id);
        const court = Kingship.court(g.player);
        expect(court.initialized).toBe(true);
        expect(court.vassals.length).toBeGreaterThan(0);
        expect(court.vassals.some(v => v.oldRival)).toBe(true);
        expect((g.player.army || []).length).toBeGreaterThan(army0);
        expect(Throne.state(g.player).ruling.usurped).toBe(true);
        // The realm's temper is a steward's now, not the old ruler's
        expect(a.lord.name).toBe(a.ruler);
    }, 60000);
});

describe('"take the town" orders', () => {
    function besiegeOrder(g, a, b, c) {
        const w = g.world;
        const t = Economy.realmTowns(b, w).find(x => !(b.capital && b.capital.q === x.q && b.capital.r === x.r)) || Economy.realmTowns(b, w)[0];
        c.order = { kind: 'besiege', enemyId: b.id, target: { q: t.q, r: t.r, name: t.settlement.name }, need: 1, progress: 0, due: w.day + 40, issued: w.day, text: `Take ${t.settlement.name}.` };
        return t;
    }

    it('taken by the realm\'s own armies far from the host: no credit, fresh orders', () => {
        const g = newGame(406);
        const { a, b, c, w } = atWar(g);
        const t = besiegeOrder(g, a, b, c);
        // the general is far away
        const far = Economy.realmTowns(a, w).sort((x, y) => Hex.wrappingDistance(y.q, y.r, t.q, t.r, w.width) - Hex.wrappingDistance(x.q, x.r, t.q, t.r, w.width))[0];
        g.player.q = far.q; g.player.r = far.r;
        KingdomAI.takeTile(a, b, w, t.q, t.r);
        const done = c.record.ordersDone;
        const out = { notices: [] };
        Generalship._tickOrder(g.player, w, c, out);
        expect(c.record.ordersDone).toBe(done);
        expect(out.notices.some(n => n.title === 'Taken Without You')).toBe(true);
        expect(!c.order || c.order.target == null || c.order.target.q !== t.q || c.order.target.r !== t.r).toBe(true);
    }, 60000);

    it('taken while the host stood before it: carried out', () => {
        const g = newGame(407);
        const { a, b, c, w } = atWar(g);
        const t = besiegeOrder(g, a, b, c);
        g.player.q = t.q; g.player.r = t.r;
        Generalship._tickOrder(g.player, w, c, { notices: [] }); // the host at the front
        KingdomAI.takeTile(a, b, w, t.q, t.r);
        const done = c.record.ordersDone;
        Generalship._tickOrder(g.player, w, c, { notices: [] });
        expect(c.record.ordersDone).toBe(done + 1);
    }, 60000);
});

describe('a storm fought on the streets', () => {
    it('hands its outcome to the capture path', () => {
        const g = newGame(408);
        const { a, b, c, w } = atWar(g);
        const t = Economy.realmTowns(b, w).find(x => !(b.capital && b.capital.q === x.q && b.capital.r === x.r)) || Economy.realmTowns(b, w)[0];
        g.player.q = t.q; g.player.r = t.r;
        expect(Generalship.besiege(g.player, w, 'spare').success).toBe(true);
        const prep = Generalship.assaultSpec(g.player, w);
        expect(prep.spec.kind).toBe('assault');
        const res = Generalship.assault(g.player, w, { outcome: { victory: true, hostLost: 5, enemyLost: c.siege.garrison, retinueLost: 0 } });
        expect(res.victory).toBe(true);
        expect(t.settlement.kingdom).toBe(a.id);
        expect(c.record.townsTaken).toBe(1);
    }, 60000);
});
