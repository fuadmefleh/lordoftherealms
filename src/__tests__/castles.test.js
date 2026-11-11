// Castles come late (world/castles.js): before a capital's year its seat is a
// great hall (a manor on the town map, an unwalled town on the world map);
// each capital raises its castle in a year of its own after the era begins,
// paid from its crown's treasury into the capital's purse; a full-grown
// world is unchanged.

import { describe, it, expect, beforeAll } from 'vitest';
import { Utils } from '../core/utils.js';
import { World } from '../world/world.js';
import { Castles } from '../world/castles.js';
import { InnerMap } from '../world/innerMap.js';
import { Economy } from '../world/economy.js';
import { loadData, WORLD_W, WORLD_H } from './playtest/harness.js';

beforeAll(async () => {
    await loadData();
});

function make(gen) {
    Utils.setSeed(1);
    const w = new World(WORLD_W, WORLD_H);
    w.generate({ seed: 9137, kingdomCount: 6, terrainGen: 6, ...gen });
    return w;
}

const capitals = (w) => w.getSettlementViews().map(v => w.getTile(v.q, v.r).settlement).filter(s => s.type === 'capital');

describe('castles come late', () => {
    it('a young world\'s capitals keep great halls; a full-grown one has its castles, untouched', () => {
        const young = make({ startYear: 400 });
        const caps = capitals(young);
        expect(caps.length).toBeGreaterThan(0);
        for (const s of caps) {
            expect(s.castle).toBe(false);
            expect(Castles.has(s)).toBe(false);
        }
        const old = make({});
        for (const s of capitals(old)) {
            expect(s.castle).toBeUndefined(); // no flag: the default world as it always was
            expect(Castles.has(s)).toBe(true);
        }
    });

    it('each capital is due in a year of its own, within the era', () => {
        const C = Castles.config();
        const dues = capitals(make({ startYear: 400 })).map(s => Castles.dueYear(s));
        for (const d of dues) {
            expect(d).toBeGreaterThanOrEqual(C.startYear);
            expect(d).toBeLessThanOrEqual(C.startYear + C.spread);
        }
        expect(new Set(dues).size).toBeGreaterThan(1);
    });

    it('on the town map a capital without its castle keeps its seat in a great hall', () => {
        const s = { type: 'capital', name: 'Hallby', castle: false };
        const hall = InnerMap.settlementLayout(s);
        expect(hall.required).not.toContain('castle');
        expect(hall.required).toContain('manor');
        const keep = InnerMap.settlementLayout({ ...s, castle: true });
        expect(keep.required).toContain('castle');
    });

    it('when its year comes the castle rises, paid by the crown into the capital\'s purse; a poor crown waits', () => {
        const w = make({ startYear: 400 });
        const [s] = capitals(w);
        const k = w.getKingdom(s.kingdom);
        const cost = Castles.config().cost;
        // a poor crown: the year comes and goes, no castle
        w.year = Castles.dueYear(s);
        k.treasury = cost - 1;
        Castles.sync(w);
        expect(s.castle).toBe(false);
        // the crown can pay: masons in town, a castle of stone
        k.treasury = cost + 100;
        if (!s.economy || !Number.isFinite(s.economy.gold)) s.economy = { ...(s.economy || {}), gold: 1000 };
        const purse = Economy.townPurse(s);
        const raised = Castles.sync(w);
        expect(raised.some(r => r.settlement === s)).toBe(true);
        expect(s.castle).toBe(true);
        expect(k.treasury).toBe(100);
        expect(Economy.townPurse(s)).toBeGreaterThan(purse);
        expect(w.events.some(e => /castle of stone/.test(e.text))).toBe(true);
    });
});
