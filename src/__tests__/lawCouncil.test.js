// The AI crowns change their laws (systems/lawCouncil.js): Pestilence wired —
// a realm shuts its sick towns' gates when the plague is in or near its
// towns, opens them once it has long passed, by the ruler's temper, without
// flapping; the heralds cry it; the player's own realm is theirs to decide.
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Laws } from '../systems/laws.js';
import { LawCouncil } from '../systems/lawCouncil.js';
import { Illness } from '../systems/illness.js';
import { Heralds } from '../systems/heralds.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

/** Two realms: Northmarch (towns at 10,10 and 14,10) and Southfold (a town at 40,40). */
function makeWorld(traits = { k0: [], k1: [] }) {
    const kingdoms = ['k0', 'k1'].map((id, i) => ({
        id, name: i ? 'Southfold' : 'Northmarch', isAlive: true, stability: 60, treasury: 500, culture: 'Imperial',
        characterData: { ruler: { name: i ? 'Edwyn' : 'Aldric', gender: 'male', traits: (traits[id] || []).map(t => ({ id: t })) } },
    }));
    const towns = [
        { name: 'Ashford', q: 10, r: 10, kingdom: 'k0', type: 'town' },
        { name: 'Brack', q: 14, r: 10, kingdom: 'k0', type: 'town' },
        { name: 'Dunmere', q: 40, r: 40, kingdom: 'k1', type: 'town' },
        { name: 'Elsby', q: 17, r: 10, kingdom: null, type: 'village' },
    ];
    const world = {
        day: 100, kingdoms, activeEvents: [], getKingdom: id => kingdoms.find(k => k.id === id) || null,
        getTile: (q, r) => { const s = towns.find(t => t.q === q && t.r === r); return s ? { q, r, settlement: s } : null; },
        getSettlementViews: () => towns,
    };
    return { world, kingdoms, towns, at: name => towns.find(t => t.name === name) };
}

const plague = (s, day) => { s.sickness = { d: day, n: 3, abed: 2, share: 0.1, k: 'plague', epi: true, closed: false }; };
const law = (world, id) => Laws.value(world, id, 'pestilence');

/** Run the council day by day from world.day to `to` (inclusive); `each(day)` runs first. */
function run(world, to, each = () => {}, player = null) {
    for (; world.day <= to; world.day++) {
        each(world.day);
        LawCouncil.processDay(world, player);
    }
    world.day--;
}

describe('the AI crowns\' law council', () => {
    it('plague in a town: the gates shut once it has stood a day or two, and illness and trade read the quarantine', () => {
        const { world, at } = makeWorld();
        const rule = Laws.aiRules().pestilence;
        expect(rule).toBeTruthy();
        expect(Illness.quarantined(world, at('Ashford'))).toBe(false);
        plague(at('Ashford'), 100);
        run(world, 100 + rule.actDays - 1, d => plague(at('Ashford'), d));
        expect(law(world, 'k0')).toBe('open');
        run(world, 100 + rule.actDays, d => plague(at('Ashford'), d));
        expect(law(world, 'k0')).toBe('quarantine');
        expect(Illness.quarantined(world, at('Brack'))).toBe(true);
        // The realm far off keeps its gates open
        expect(law(world, 'k1')).toBe('open');
        const k = world.getKingdom('k0');
        expect(k.laws.history[k.laws.history.length - 1]).toMatchObject({ law: 'pestilence', to: 'quarantine', by: 'crown' });
        expect(LawCouncil.news(world)[0]).toMatchObject({ kind: 'law_pestilence_quarantine', kingdomId: 'k0', place: 'Ashford' });
    });

    it('plague within reach of its towns (another realm\'s town) shuts the gates too; far off, nothing', () => {
        const { world, at } = makeWorld();
        // Elsby is 3 hexes from Brack
        run(world, 110, d => plague(at('Elsby'), d));
        expect(law(world, 'k0')).toBe('quarantine');
        const far = makeWorld();
        const s = far.at('Dunmere');
        run(far.world, 110, d => plague(s, d));
        expect(law(far.world, 'k0')).toBe('open');
        expect(law(far.world, 'k1')).toBe('quarantine');
    });

    it('opens again only after the plague has been gone a good while — and does not flap', () => {
        const { world, at } = makeWorld();
        const rule = Laws.aiRules().pestilence;
        run(world, 105, d => plague(at('Ashford'), d));
        expect(law(world, 'k0')).toBe('quarantine');
        const shut = world.getKingdom('k0').laws.changed.pestilence;
        delete at('Ashford').sickness;
        // The plague gone: shut still, until clearDays (and minHoldDays) have passed
        world.day++;
        run(world, shut + Math.max(rule.clearDays, rule.minHoldDays) - 1);
        expect(law(world, 'k0')).toBe('quarantine');
        // A flicker of plague near, not near enough to shut the gates, keeps them shut longer
        const flick = world.day + 1;
        at('Elsby').q = 19; // 5 hexes from Brack: inside clearRadius, outside radius
        run(world, flick, d => plague(at('Elsby'), d));
        delete at('Elsby').sickness;
        world.day++;
        run(world, flick + rule.clearDays - 1);
        expect(law(world, 'k0')).toBe('quarantine');
        world.day++;
        run(world, flick + rule.clearDays + 1);
        expect(law(world, 'k0')).toBe('open');
        expect(LawCouncil.news(world).map(n => n.kind)).toEqual(['law_pestilence_quarantine', 'law_pestilence_open']);
        // Once open, the next plague must stand actDays again before the gates shut
        const again = world.day + 1;
        world.day = again;
        run(world, again, d => plague(at('Ashford'), d));
        expect(law(world, 'k0')).toBe(rule.actDays > 0 ? 'open' : 'quarantine');
    });

    it('the ruler\'s temper: a wise ruler shuts the gates sooner and longer, a greedy one waits and opens early', () => {
        const wise = LawCouncil.temper(Laws.aiRules().pestilence, { characterData: { ruler: { traits: [{ id: 'wise' }, { id: 'paranoid' }] } } });
        const greedy = LawCouncil.temper(Laws.aiRules().pestilence, { characterData: { ruler: { traits: ['greedy', 'merchant_prince'] } } });
        expect(wise.act).toBeLessThan(greedy.act);
        expect(wise.clear).toBeGreaterThan(greedy.clear);
        expect(wise.radius).toBeGreaterThan(greedy.radius);
        expect(greedy.clearRadius).toBeGreaterThan(greedy.radius);
        // In the world: the same plague near both, the wise realm shuts first
        const { world, at, towns } = makeWorld({ k0: ['wise', 'paranoid'], k1: ['greedy', 'merchant_prince'] });
        towns.push({ name: 'Fenwick', q: 40, r: 37, kingdom: 'k1', type: 'town' });
        let first = { k0: null, k1: null };
        run(world, 120, (d) => {
            plague(at('Ashford'), d); plague(at('Fenwick'), d);
            for (const id of ['k0', 'k1']) if (first[id] == null && law(world, id) === 'quarantine') first[id] = d;
        });
        expect(first.k0).not.toBe(null);
        expect(first.k1 == null || first.k1 > first.k0).toBe(true);
    });

    it('the realm the player rules is theirs to decide', () => {
        const { world, at } = makeWorld();
        const player = { throne: { ruling: { kingdomId: 'k0' } } };
        run(world, 110, d => plague(at('Ashford'), d), player);
        expect(law(world, 'k0')).toBe('open');
    });

    it('the heralds cry it: "closes the gates against the plague"', () => {
        const { world, at } = makeWorld();
        const player = { q: 10, r: 10, name: 'Aldric' };
        Heralds.processDay(world, player);
        world.day++;
        run(world, 104, d => { plague(at('Ashford'), d); Heralds.processDay(world, player); });
        const st = Heralds.state(player);
        const p = st.list.find(x => x.kind === 'law_pestilence_quarantine');
        expect(p).toBeTruthy();
        expect(p.text).toMatch(/Northmarch/);
        expect(p.text).not.toMatch(/\{\w+\}/);
    });

    it('old saves: realms with no laws, no AI memory, no news still run', () => {
        const { world, kingdoms } = makeWorld();
        for (const k of kingdoms) delete k.laws;
        delete world.lawNews;
        expect(() => LawCouncil.processDay(world, null)).not.toThrow();
        expect(LawCouncil.news(world)).toEqual([]);
        expect(() => LawCouncil.processDay({ day: 3 }, null)).not.toThrow();
        // A saved realm's laws, AI memory included, survive a JSON round trip
        const { world: w2, at } = makeWorld();
        run(w2, 104, d => plague(at('Ashford'), d));
        const k = JSON.parse(JSON.stringify(w2.getKingdom('k0')));
        expect(k.laws.pestilence).toBe('quarantine');
        expect(k.laws.ai.pestilence).toBeTruthy();
    });
});
