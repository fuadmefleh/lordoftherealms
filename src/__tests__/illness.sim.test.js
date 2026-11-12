// Opt-in sickness survey: do the townsfolk's sicknesses (systems/illness.js)
// keep towns in range over the years? Lives five towns of two realms for
// ILLYEARS years (a plague struck in one of them now and then) with sickness
// on and off, and prints per town the head count, the deaths by cause, the
// child mortality, the mean age at death and the outbreaks.
//
//   ILLSIM=1 npx vitest run src/__tests__/illness.sim.test.js
//   ILLSEEDS=11,22,33 ILLYEARS=10 ILLPLAGUE=400,900 (days the plague strikes)
//
// Not part of the normal suite (it lives towns for years).

import { it, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DataLoader } from '../core/dataLoader.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { Illness } from '../systems/illness.js';

const ENV = (typeof process !== 'undefined' && process.env) || {};
const ON = ENV.ILLSIM === '1';
const out = (...a) => process.stdout.write(a.join(' ') + '\n');

let BASE = null;

beforeAll(() => {
    if (!ON) return;
    DataLoader._gamedata = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../data/gamedata.json'), 'utf-8'));
    BASE = DataLoader._gamedata.illness;
});

function makeWorld(seed) {
    const towns = [
        { name: 'Ashford', type: 'town', q: 5, r: 7, population: 2500, kingdom: 1 },
        { name: 'Greymoor', type: 'village', q: 9, r: 10, population: 400, kingdom: 1 },
        { name: 'Highmarket', type: 'city', q: 14, r: 5, population: 8000, kingdom: 1 },
        { name: 'Oakvale', type: 'village', q: 3, r: 15, population: 300, kingdom: 2 },
        { name: 'Stormport', type: 'capital', q: 18, r: 13, population: 15000, kingdom: 2 },
    ];
    const kingdoms = { 1: { id: 1, name: 'Westmark', wars: [] }, 2: { id: 2, name: 'Eastholm', wars: [] } };
    const world = {
        day: 1, baseYear: 853, generationParams: { seed }, activeEvents: [], kingdoms: Object.values(kingdoms),
        getSettlementViews: () => towns, getKingdom: id => kingdoms[id] || null,
        getTile: (q, r) => ({ settlement: towns.find(t => t.q === q && t.r === r) || null }),
    };
    for (const t of towns) Townsfolk.seed(t, world, { q: t.q, r: t.r });
    return { world, towns };
}

function live(seed, years, plagueDays, sick) {
    DataLoader._gamedata.illness = { ...BASE, enabled: sick };
    const { world, towns } = makeWorld(seed);
    const start = new Map(towns.map(t => [t.name, Townsfolk.residents(t.folk).length]));
    const end = 1 + years * 120;
    while (world.day < end) {
        world.day++;
        for (const ev of world.activeEvents) ev.daysLeft--;
        world.activeEvents = world.activeEvents.filter(ev => ev.daysLeft > 0);
        if (plagueDays.includes(world.day)) {
            const t = towns[plagueDays.indexOf(world.day) % 2 === 0 ? 2 : 4];
            world.activeEvents.push({ id: 'plague', name: 'Plague Outbreak', kingdomId: t.kingdom, q: t.q, r: t.r, settlementName: t.name, daysLeft: 30, effects: {} });
        }
        Townsfolk.processDay(world, null);
        Illness.processDay(world, null);
    }
    const rows = [];
    for (const t of towns) {
        const f = t.folk;
        const dead = f.people.filter(p => p.died != null && p.died > 1);
        const kids = f.people.filter(p => p.born > 1);
        const under5 = dead.filter(p => Townsfolk.age(p, p.died) < 5).length;
        const byIll = {};
        for (const d of (f.ill && f.ill.deaths) || []) byIll[d.k] = (byIll[d.k] || 0) + 1;
        const illDead = Object.values(byIll).reduce((a, b) => a + b, 0);
        rows.push({
            town: t.name, type: t.type, n0: start.get(t.name), n1: Townsfolk.residents(f).length,
            deaths: dead.length, illDead, byIll, births: kids.length, under5,
            meanAge: dead.length ? Math.round(dead.reduce((s, p) => s + Townsfolk.age(p, p.died), 0) / dead.length) : 0,
            out: ((f.ill && f.ill.hist) || []).map(h => `${h.k}:${h.peak}/${h.dead}`).join(' '),
        });
    }
    return rows;
}

it.skipIf(!ON)('sickness survey', () => {
    const seeds = String(ENV.ILLSEEDS || '11,22,33').split(',').map(Number);
    const years = Number(ENV.ILLYEARS || 10);
    const plague = String(ENV.ILLPLAGUE || '420,900').split(',').map(Number);
    const tot = { on: {}, off: {} };
    for (const seed of seeds) {
        for (const sick of [false, true]) {
            const rows = live(seed, years, plague, sick);
            out(`\n== seed ${seed} sickness ${sick ? 'ON' : 'OFF'} — ${years} years ==`);
            out('town        type     start  end  deaths  sick-deaths  births  <5-deaths  mean-age  outbreaks (kind:peak/dead)');
            for (const r of rows) {
                out(`${r.town.padEnd(11)} ${r.type.padEnd(8)} ${String(r.n0).padStart(5)} ${String(r.n1).padStart(4)} ${String(r.deaths).padStart(7)} ${String(r.illDead).padStart(12)} ${String(r.births).padStart(7)} ${String(r.under5).padStart(10)} ${String(r.meanAge).padStart(9)}  ${r.out}`);
                const T = tot[sick ? 'on' : 'off'];
                for (const k of ['n0', 'n1', 'deaths', 'illDead', 'births', 'under5']) T[k] = (T[k] || 0) + r[k];
                for (const [k, v] of Object.entries(r.byIll)) T['ill_' + k] = (T['ill_' + k] || 0) + v;
            }
        }
    }
    out('\n== totals over seeds ==');
    for (const k of ['off', 'on']) out(k.toUpperCase(), JSON.stringify(tot[k]));
});
