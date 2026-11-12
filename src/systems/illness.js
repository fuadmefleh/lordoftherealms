// ============================================
// ILLNESS — the townsfolk fall sick, pass it on, are nursed, and recover or die
// ============================================
// Every town with a roster (settlement.folk, systems/townsfolk.js) lives its
// sicknesses a few days at a time (stepDays), the player there or not:
//
//   - onset: each person's own chance a day of a cold, a fever, the flux,
//     consumption (data/illness.json `spont`) by their risk — age, hunger (a
//     dearth in the town's market), station (beggar to noble), a crowded
//     house, the town's size, its wealth (clean water, a bathhouse), the
//     season; wound fever from a beating not healed (`p.hurt`), childbed fever
//     after a birth, the pox brought in now and then, the plague seeded by the
//     plague world event (world/worldEvents.js) in its town and its realm;
//   - contagion: the sick put a force on everyone they live with (the
//     household: spouse, the children at home), work beside (`p.job` /
//     `p.workplace` where the jobs give one, else their trade; the children
//     play together) and mingle with at church, tavern and market (the town);
//     between towns travellers carry it (`processDay`: by size, distance, the
//     Pestilence law's quarantine, data/laws.json); a town with no roster
//     keeps an abstract `settlement.sickness` that seeds the roster it gets;
//   - the course: incubation, then days sick (a share laid up abed — the
//     street map keeps them home in bed, world/innerMap/townSickness.js),
//     tended by family, visited by the town's healer (its best hand at
//     Medicine, systems/tradeSkills.js — a fee from the family's purse to the
//     healer's, herbs out of the town's market paid into the town's purse) or
//     the priest for charity, a physician the player pays for (`folk.ill.fund`),
//     alms (`folk.ill.alms`), a gift from the player (systems/illnessPlayer.js);
//     at the end they recover (immune a while, or for life) or die;
//   - death goes through the townsfolk's own path (`Townsfolk._die`, the
//     annals, widowing, word to the player); the family's own (the heir to
//     the house and purse, the orphans taken in: systems/townFamily.js), and
//     here: the widowed and bereaved grieve (systems/romance.js heartbreak),
//     the sexton's next round lays them in the churchyard (systems/graveyards.js,
//     flagged here).
//
// With sickness on, the townsfolk's own age mortality keeps only `baseShare`
// of the dying (`Townsfolk._season` asks `baseShare`); the rest is this sim's.
// The town's sick share (`settlement.sickness`) idles its hands
// (world/townLabour.js factors). All rolls from a hash of the world seed, the
// town and the day (never the shared RNG); state is plain data on the person
// (`p.ill`, `p.imm`) and on `folk.ill`, saved with the tile; old saves start
// healthy.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { SettlementWealth } from '../world/settlementWealth.js';
import { WorldEvents } from '../world/worldEvents.js';
import { Economy } from '../world/economy.js';
import { Townsfolk } from './townsfolk.js';
import { Romance } from './romance.js';
import { TradeSkills } from './tradeSkills.js';
import { PracticeSkills } from './practiceSkills.js';
import { Laws } from './laws.js';
import { TownFamily } from './townFamily.js';
import { Climate } from '../world/climate.js';

const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const ANNALS = ['outbreak', 'outbreakOver', 'fellIll'];
const LOGS = ['sick', 'recovered', 'nursed'];
const MAX_HIST = 16;
const MAX_DEATHS = 40;

let _cfg = null;
let _cfgSrc;

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function _seedOf(world) { return (world && world.generationParams && world.generationParams.seed) || 1; }

/** A deterministic stream keyed by the world seed and the given parts. */
function _rng(world, key) {
    let s = (Utils.hashStr(`${_seedOf(world)}|ill|${key}`) >>> 0) || 1;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

function _range(r, rng) {
    const [a, b] = Array.isArray(r) ? r : [r, r];
    return Math.round(_num(a) + rng() * (_num(b, a) - _num(a)));
}

/**
 * The world as of `day` (a view: its own day, everything else the world's).
 * A step lived late (a lazy catch-up) must see the step's day, not today's,
 * wherever another system reads world.day (skills seeded by age, TradeSkills).
 */
function _at(world, day) {
    if (!world || _num(world.day) === day) return world;
    const w = Object.create(world);
    w.day = day;
    return w;
}

function _pick(arr, rng) { return Array.isArray(arr) && arr.length ? arr[Math.floor(rng() * arr.length) % arr.length] : null; }

function _seasonOf(day) {
    const Y = Townsfolk.config().daysPerYear;
    return SEASONS[Math.floor(((Math.max(1, day) - 1) % Y) / (Y / 4))] || 'spring';
}

export const Illness = {
    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.illness : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            _cfg = {
                enabled: d.enabled !== false && !!_obj(d.illnesses),
                stepDays: Math.max(1, Math.round(_num(d.stepDays, 2))),
                ageBands: Array.isArray(d.ageBands) ? d.ageBands : [{ under: 5, k: 'infant' }, { under: 16, k: 'child' }, { under: 50, k: 'adult' }, { under: 65, k: 'elder' }, { under: 999, k: 'old' }],
                baseShare: _obj(d.baseShare) || {},
                otherCauses: _obj(d.otherCauses) || {},
                risk: _obj(d.risk) || {},
                contact: { household: 1, work: 0.3, town: 0.12, townRef: 12, ...(_obj(d.contact) || {}) },
                travel: _obj(d.travel) || {},
                plagueEvent: _obj(d.plagueEvent) || {},
                care: _obj(d.care) || {},
                fund: _obj(d.fund) || {},
                player: _obj(d.player) || {},
                outbreak: { minCases: 3, plagueMin: 1, epidemicShare: 0.12, ...(_obj(d.outbreak) || {}) },
                work: { sensitivity: 0.8, min: 0.5, ...(_obj(d.work) || {}) },
                illnesses: _obj(d.illnesses) || {},
                lines: _obj(d.lines) || {},
            };
        }
        return _cfg;
    },

    on() { return Illness.config().enabled; },

    def(k) { return Illness.config().illnesses[k] || null; },

    /** 'infant' | 'child' | 'adult' | 'elder' | 'old' */
    band(age) {
        const B = Illness.config().ageBands;
        return (B.find(b => age < _num(b.under, 999)) || B[B.length - 1] || { k: 'adult' }).k;
    },

    // ── What the townsfolk's own seasons keep (systems/townsfolk.js _season) ──

    /** The share of the age mortality the seasons keep (1 with sickness off). */
    baseShare(age) {
        if (!Illness.on()) return 1;
        return _clamp(_num(Illness.config().baseShare[Illness.band(age)], 1), 0, 1);
    },

    /** The plague world event's deaths are this sim's (the seasons drop their plague hardship). */
    handlesPlague() { return Illness.on() && !!Illness.def('plague'); },


    /** A cause of death for the seasons' share that is no sickness (a fall, old age), or null. */
    baseCause(age, ctx, rng) {
        if (!Illness.on()) return null;
        const O = Illness.config().otherCauses;
        if (ctx && ctx.dearth && (age < 5 || age >= 60) && rng() < 0.5 && O.dearth) return _pick(O.dearth, rng);
        if (ctx && ctx.winter && age >= 60 && rng() < 0.4 && O.winter) return _pick(O.winter, rng);
        if (age < 5 && O.infant) return _pick(O.infant, rng);
        if (age >= 62 && rng() < 0.8 && O.old) return _pick(O.old, rng);
        return _pick(O.common, rng);
    },

    // ── A person's state ─────────────────────────────────

    /** Showing it (past the incubation, the course not run). */
    isSick(p, day) {
        const c = p && p.ill;
        return !!(c && p.died == null && day >= _num(c.on) && day < _num(c.end, Infinity));
    },

    /** Laid up in bed: sick, and among the worst of it. */
    isAbed(p, day) {
        if (!Illness.isSick(p, day)) return false;
        const d = Illness.def(p.ill.k);
        return !!d && _num(p.ill.sv) >= 1 - _num(d.abed, 0.5);
    },

    /** Passing it on: from the day before it shows to its end. */
    isContagious(p, day) {
        const c = p && p.ill;
        if (!c || p.died != null) return false;
        const d = Illness.def(c.k);
        return !!d && _num(d.contagion) > 0 && day >= _num(c.on) - 1 && day < _num(c.end, Infinity);
    },

    /** The work they put in today (0 abed, a little less sick on their feet). */
    workFactor(p, day) {
        if (Illness.isAbed(p, day)) return 0;
        return Illness.isSick(p, day) ? 0.7 : 1;
    },

    /** { k, name, label, icon, abed, days (sick so far) } or null. */
    describe(p, day) {
        if (!Illness.isSick(p, day)) return null;
        const d = Illness.def(p.ill.k) || {};
        return { k: p.ill.k, name: d.name || p.ill.k, label: d.label || p.ill.k, icon: d.icon || '🤒', abed: Illness.isAbed(p, day), days: day - _num(p.ill.on), symptoms: d.symptoms || '' };
    },

    _immune(p, k, day) {
        const u = p.imm && p.imm[k];
        return u === -1 || (typeof u === 'number' && u >= day);
    },

    // ── The town's state ─────────────────────────────────

    /** folk.ill, made on first asking (pox immunity for the grown; an abstract sickness seeded). */
    state(world, settlement, folk, day) {
        if (_obj(folk.ill) && folk.ill.v === 1) return folk.ill;
        const step = Illness.config().stepDays;
        const t0 = Math.min(_num(day, 0), _num(folk.tick, _num(day, 0)));
        folk.ill = { v: 1, tick: t0 - (((t0 % step) + step) % step), out: {}, hist: [], deaths: [], fund: null, alms: null };
        const rng = _rng(world, `${folk.q},${folk.r}|init`);
        for (const p of folk.people) Illness._initImm(p, day, rng);
        // A sickness that came to the town before it had a roster (travellers, the plague)
        const ab = settlement && settlement.sickness;
        if (ab && ab.abs && _num(ab.until) >= day && Illness.def(ab.k)) {
            const pool = Townsfolk.residents(folk).filter(p => !Illness._immune(p, ab.k, day));
            const n = Math.min(pool.length, _range(Illness.config().plagueEvent.seedCases || [1, 3], rng));
            for (let i = 0; i < n; i++) {
                const p = pool.splice(Math.floor(rng() * pool.length), 1)[0];
                Illness._infect(folk, p, ab.k, day, rng, 'travel', ab.from || null);
            }
        }
        return folk.ill;
    },

    _initImm(p, day, rng) {
        if (_obj(p.imm)) return;
        p.imm = {};
        // Most of the grown had the pox as children
        if (Townsfolk.age(p, day) >= 10 && rng() < 0.7) p.imm.pox = -1;
    },

    // ── Stepping ─────────────────────────────────────────

    /** Live every step of the town's sickness up to `upTo`. Returns the player's news. */
    catchUp(world, settlement, folk, upTo, news = [], player = null) {
        if (!Illness.on() || !_obj(folk) || !Array.isArray(folk.people)) return news;
        const st = Illness.state(world, settlement, folk, upTo);
        const step = Illness.config().stepDays;
        let guard = 0;
        while (st.tick + step <= upTo && guard++ < 4000) {
            st.tick += step;
            Illness._step(world, settlement, folk, st.tick, news, player);
        }
        return news;
    },

    /**
     * The daily hook (after the townsfolk's seasons, ui/game/endDay.js and the
     * afterlife's world tick): every town with a roster lives its sickness up
     * to today; on a step day the sick of one town carry it to the next.
     * @returns {{ news: Array, notices: Array<{icon,title,text,type}> }}
     */
    processDay(world, player = null) {
        const out = { news: [], notices: [] };
        if (!Illness.on() || !world) return out;
        const day = _num(world.day, 1);
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        for (const s of views) {
            if (s && _obj(s.folk) && Array.isArray(s.folk.people)) Illness.catchUp(world, s, s.folk, day, out.news, player);
        }
        if (day % Illness.config().stepDays === 0) Illness._travel(world, views, day);
        for (const n of out.news) if (n.notice) out.notices.push(n.notice);
        return out;
    },

    _env(world, s, folk, day) {
        const C = Illness.config();
        const R = C.risk;
        const env = { season: _seasonOf(day), dearth: false, alms: false, town: 1, hygiene: 1, plague: null, plagueHere: false, quarantine: false, type: (s && s.type) || 'village' };
        try { env.dearth = !!(s && s.market && SettlementMarket.inDearth(s)); } catch (e) { env.dearth = false; }
        const st = folk.ill;
        env.alms = !!(st && st.alms && _num(st.alms.until) >= day);
        env.town = _num(_obj(R.townType) && R.townType[env.type], 1);
        let score = 0.4;
        try { if (s && s.population != null) score = SettlementWealth.score(s); } catch (e) { score = 0.4; }
        const W = _obj(R.wealth) || {};
        env.hygiene = (_num(W.poor, 1.3) + (_num(W.rich, 0.8) - _num(W.poor, 1.3)) * score) * _num(_obj(R.bathhouse) && R.bathhouse[env.type], 1);
        try {
            const ev = WorldEvents.getEventsAt(world, { q: folk.q, r: folk.r, settlement: s, kingdom: s && s.kingdom }).find(e => e.id === 'plague');
            if (ev) { env.plague = ev; env.plagueHere = ev.q === folk.q && ev.r === folk.r; }
        } catch (e) { env.plague = null; }
        env.quarantine = Illness.quarantined(world, s);
        // The climate's era: fevers in wet decades and warm ages, winter sickness in a cold one (world/climate.js)
        try { env.clim = Climate.diseaseMult(world, folk.q, folk.r, day); } catch (e) { env.clim = 1; }
        return env;
    },

    /** Does the town's realm shut a sick town's gates (the Pestilence law, systems/laws.js)? */
    quarantined(world, s) {
        if (!s || s.kingdom == null) return false;
        try { return Laws.value(world, s.kingdom, 'pestilence') === 'quarantine'; } catch (e) { return false; }
    },

    /** The household each resident lives in → { of: Map(pid → key), size: Map(key → n) } */
    _households(folk, res, day) {
        const of = new Map();
        // The family's own households where it keeps them (systems/townFamily.js p.hh)
        if (res.length && res.every(p => p.hh != null)) {
            for (const p of res) of.set(p.id, `f${p.hh}`);
            const size = new Map();
            for (const k of of.values()) size.set(k, (size.get(k) || 0) + 1);
            return { of, size };
        }
        const here = new Set(res.map(p => p.id));
        const keyOf = p => {
            const sp = Townsfolk.get(folk, p.spouse);
            if (sp && here.has(sp.id) && sp.spouse === p.id) return `h${Math.min(p.id, sp.id)}`;
            return null;
        };
        for (const p of res) {
            let key = keyOf(p);
            if (!key && Townsfolk.age(p, day) < 18) {
                const par = (p.parents || []).map(id => Townsfolk.get(folk, id)).find(x => x && here.has(x.id));
                if (par) key = keyOf(par) || `h${par.id}`;
            }
            of.set(p.id, key || `h${p.id}`);
        }
        const size = new Map();
        for (const k of of.values()) size.set(k, (size.get(k) || 0) + 1);
        return { of, size };
    },

    /** Where they spend the working day, for who they pass it to. */
    _workKey(p, day) {
        if (Townsfolk.age(p, day) < 16) return 'kids';
        // (the jobs' work, systems/townJobs.js: those of a trade work side by side, the apprentices with them)
        const j = p.job;
        if (typeof j === 'string' && j) return `j:${j}`;
        if (j && typeof j === 'object' && (j.place || j.id)) return `j:${j.place || j.id}`;
        if (p.workplace) return `w:${p.workplace}`;
        return `r:${p.retired ? 'retired' : p.role}`;
    },

    /** How likely they are to catch it, and how hard it goes (×). */
    risk(p, k, env, hhSize, day) {
        const C = Illness.config();
        const R = C.risk;
        const d = Illness.def(k) || {};
        const age = Townsfolk.age(p, day);
        let m = _num(_obj(R.age) && R.age[Illness.band(age)], 1);
        // The old frail (systems/townFamily.js frailty: 0 at 55, 1 at 85)
        if (TownFamily.config().enabled) m *= 1 + TownFamily.frailty(p, day) * _num(R.frailty, 0.6);
        m *= _num(_obj(R.station) && R.station[p.role], 1);
        const H = _obj(R.household) || {};
        if (hhSize > _num(H.over, 4)) m *= Math.min(_num(H.max, 1.4), 1 + (hhSize - _num(H.over, 4)) * _num(H.per, 0.08));
        m *= env.town;
        m *= d.water ? env.hygiene : Math.sqrt(env.hygiene);
        if (env.dearth) m *= _num(R.dearth, 1.6);
        if (env.clim && env.clim !== 1) m *= env.clim;
        if (env.alms && ['beggar', 'villager', 'farmer', 'child'].includes(p.role)) m *= _num(R.alms, 0.75);
        return m;
    },

    _infect(folk, p, k, day, rng, by = null, from = null) {
        const d = Illness.def(k);
        if (!d || !p || p.died != null) return null;
        const inc = Math.max(0, _range(d.incubation || [1, 2], rng));
        const dur = Math.max(1, _range(d.days || [4, 8], rng));
        p.ill = { k, d: day, on: day + inc, end: day + inc + dur, sv: Math.round(rng() * 1000) / 1000, fam: false, hl: 1, hb: false, v: 0 };
        if (by) p.ill.by = by;
        if (from) p.ill.from = from;
        return p.ill;
    },

    /** A new case: a serious one laid up goes into their life; word of it if the player knows them. */
    _caught(world, folk, p, k, day, rng, news, by = null, from = null) {
        const c = Illness._infect(folk, p, k, day, rng, by, from);
        if (!c || !(Illness.def(k) || {}).serious || !Illness.isAbedCase(c)) return c;
        Townsfolk._log(p, day, 'sick', null, k);
        if (p.mem && p.mem.timesSpoken > 0) Townsfolk._annal(folk, world, day, { k: 'fellIll', a: p.id, x: k }, news);
        return c;
    },

    _step(world, s, folk, day, news, player) {
        const C = Illness.config();
        const st = folk.ill;
        const res = Townsfolk.residents(folk);
        if (!res.length) return;
        const rng = _rng(world, `${folk.q},${folk.r}|${day}`);
        const env = Illness._env(world, s, folk, day);
        const step = C.stepDays;
        for (const p of res) if (!_obj(p.imm)) Illness._initImm(p, day, rng);
        // (a case carried off with someone who left town, or a stale one, is forgotten)
        for (const p of folk.people) if (p.ill && (p.died != null || p.away)) delete p.ill;

        const hh = Illness._households(folk, res, day);

        // The end of a course: recovered, lingering, or dead
        for (const p of res) {
            if (!p.ill || day < _num(p.ill.end)) continue;
            Illness._resolve(world, s, folk, p, day, env, hh, rng, news, player);
        }

        const alive = Townsfolk.residents(folk);
        // Nursing and doctoring the sick
        Illness._care(world, s, folk, alive, day, env, hh, rng);

        // Who passes what to whom
        const counts = new Map();   // k → { town, hh: Map, wk: Map, wkSize: Map }
        const wkSize = new Map();
        for (const p of alive) { const w = Illness._workKey(p, day); wkSize.set(w, (wkSize.get(w) || 0) + 1); }
        for (const p of alive) {
            if (!Illness.isContagious(p, day)) continue;
            let c = counts.get(p.ill.k);
            if (!c) counts.set(p.ill.k, c = { town: 0, hh: new Map(), wk: new Map() });
            c.town++;
            const h = hh.of.get(p.id);
            c.hh.set(h, (c.hh.get(h) || 0) + 1);
            const w = Illness._workKey(p, day);
            c.wk.set(w, (c.wk.get(w) || 0) + 1);
        }
        const K = C.contact;
        const N = Math.max(1, alive.length);
        const fresh = [];
        for (const p of alive) {
            if (p.ill) continue;
            const h = hh.of.get(p.id);
            const w = Illness._workKey(p, day);
            for (const [k, c] of counts) {
                const d = Illness.def(k);
                if (Illness._immune(p, k, day) || (d.minAge && Townsfolk.age(p, day) < d.minAge)) continue;
                const nh = c.hh.get(h) || 0;
                const nw = c.wk.get(w) || 0;
                const nt = Math.max(0, c.town - nh - nw);
                const crowd = Math.min(1, 6 / Math.max(1, wkSize.get(w) || 1));
                const lam = _num(d.contagion) * (_num(K.household) * nh + _num(K.work) * nw * crowd + _num(K.town) * nt * _num(K.townRef, 12) / N)
                    * _num(_obj(d.season) && d.season[env.season], 1) * Illness.risk(p, k, env, hh.size.get(h) || 1, day) * step;
                if (lam > 0 && rng() < 1 - Math.exp(-lam)) {
                    fresh.push([p, k, nh ? 'household' : nw ? 'work' : 'town']);
                    break;
                }
            }
        }
        for (const [p, k, by] of fresh) Illness._caught(world, folk, p, k, day, rng, news, by);

        // Their own: the season's colds and fevers, bad water, a wound gone bad, childbed
        for (const p of alive) {
            if (p.ill) continue;
            const age = Townsfolk.age(p, day);
            const hs = hh.size.get(hh.of.get(p.id)) || 1;
            let caught = null;
            for (const [k, d] of Object.entries(C.illnesses)) {
                if (!(_num(d.spont) > 0) || Illness._immune(p, k, day) || (d.minAge && age < d.minAge)) continue;
                const lam = _num(d.spont) * _num(_obj(d.season) && d.season[env.season], 1) * Illness.risk(p, k, env, hs, day) * step;
                if (rng() < 1 - Math.exp(-lam)) { caught = k; break; }
            }
            // A beating not healed festers
            const wf = Illness.def('wound_fever');
            if (!caught && wf && p.hurt && day - _num(p.hurt.d) <= _num(wf.hurtDays, 10)) {
                const inj = Townsfolk.injury(p, day);
                if (inj && rng() < _num(wf.fromHurt) * step * (1 - inj.hp / Math.max(1, inj.max)) * 2 * (p.hurt.tended ? 0.3 : 1) * Math.sqrt(env.hygiene)) caught = 'wound_fever';
            }
            // After a birth
            const cb = Illness.def('childbed');
            if (!caught && cb && p.gender === 'female') {
                // (the lying-in after a birth: systems/townFamily.js isPostpartum / p.postpartum; with
                // family life off, the birth in their life)
                const fam = TownFamily.config().enabled;
                const birth = fam ? (TownFamily.isPostpartum(p, day, _num(cb.birthDays, 8)) ? _num(p.postpartum.d) : -Infinity)
                    : (p.log || []).filter(e => e.k === 'birth').reduce((m, e) => Math.max(m, _num(e.d)), -Infinity);
                if (day - birth >= 0 && day - birth <= _num(cb.birthDays, 8) && p.cbChk !== birth) {
                    p.cbChk = birth;
                    if (rng() < _num(cb.afterBirth) * Math.sqrt(env.hygiene) * (env.dearth ? 1.3 : 1)) caught = 'childbed';
                }
            }
            if (caught) Illness._caught(world, folk, p, caught, day, rng, news, 'own');
        }

        // The pox brought into town now and then, where many have never had it
        const pox = Illness.def('pox');
        if (pox && !counts.has('pox')) {
            const open = alive.filter(p => !p.ill && !Illness._immune(p, 'pox', day));
            if (open.length >= Math.max(3, alive.length * 0.25) && rng() < _num(pox.importPerStep) * step / 2 * env.town * (open.length / N) * 2) {
                Illness._infect(folk, _pick(open, rng), 'pox', day, rng, 'travel');
            }
        }
        // The plague, where the plague event rages
        if (env.plague && Illness.def('plague')) {
            const P = C.plagueEvent;
            const chance = env.plagueHere ? _num(P.eventTown, 0.35) : _num(P.realm, 0.025);
            if (rng() < chance * (env.quarantine && !env.plagueHere ? _num(C.travel.quarantine, 0.15) : 1)) {
                const open = alive.filter(p => !p.ill && !Illness._immune(p, 'plague', day));
                const n = Math.min(open.length, env.plagueHere ? _range(P.seedCases || [1, 3], rng) : 1);
                for (let i = 0; i < n; i++) Illness._infect(folk, open.splice(Math.floor(rng() * open.length), 1)[0], 'plague', day, rng, 'travel', env.plagueHere ? null : (env.plague.settlementName || null));
            }
        }

        Illness._outbreaks(world, s, folk, day, env, news, player);
    },

    /** Recover, linger (the slow sicknesses), or die. */
    _resolve(world, s, folk, p, day, env, hh, rng, news, player) {
        const C = Illness.config();
        const c = p.ill;
        const d = Illness.def(c.k);
        if (!d) { delete p.ill; return; }
        const age = Townsfolk.age(p, day);
        let pd = _num(_obj(d.mortality) && d.mortality[Illness.band(age)]);
        pd *= 0.4 + 1.2 * _num(c.sv, 0.5);
        // Hunger and want make it go harder; the station's comforts easier
        if (env.dearth) pd *= 1.3;
        pd *= Math.sqrt(_num(_obj(C.risk.station) && C.risk.station[p.role], 1));
        pd *= Illness.careMult(c, p);
        if (rng() < pd) {
            Illness._kill(world, s, folk, p, day, rng, news, player);
            return;
        }
        if (d.chronic && rng() < 0.35) {
            // It lingers: another stretch of it, a little milder
            const more = Math.max(10, Math.round(_range(d.days, rng) / 2));
            c.end = day + more;
            c.sv = Math.round(_num(c.sv) * 0.8 * 1000) / 1000;
            return;
        }
        delete p.ill;
        const imm = _num(d.immunityDays);
        if (!_obj(p.imm)) p.imm = {};
        if (imm < 0) p.imm[c.k] = -1;
        else if (imm > 0) p.imm[c.k] = day + imm;
        if (d.serious && Illness.isAbedCase(c)) Townsfolk._log(p, day, 'recovered', null, c.k);
        const o = folk.ill.out[c.k];
        if (o) o.rec = _num(o.rec) + 1;
    },

    isAbedCase(c) {
        const d = c && Illness.def(c.k);
        return !!d && _num(c.sv) >= 1 - _num(d.abed, 0.5);
    },

    /** The death chance's multiplier from the care they had (× < 1 better). */
    careMult(c, p) {
        const CC = Illness.config().care;
        let m = c.fam ? _num(CC.family, 0.85) : _num(CC.alone, 1.15);
        m *= _num(c.hl, 1);
        if (c.hb) m *= _num(CC.herbs, 0.88);
        if (c.gift === 'medicine') m *= _num(CC.giftMedicine, 0.55);
        else if (c.gift === 'food') m *= _num(CC.giftFood, 0.85);
        m *= _num(_obj(CC.wealth) && p && CC.wealth[p.role], 1);
        return Math.max(_num(CC.min, 0.2), m);
    },

    /** The town's healer: its best one on their feet (see `healers`), or null. */
    healer(s, world, day) {
        return Illness.healers(s, world, day)[0] || null;
    },

    /**
     * The town's healers on their feet, the best first: those whose work it is
     * (the jobs' 'healer', systems/townJobs.js), else its best hand at Medicine
     * (systems/tradeSkills.js) → [{ person, name, level, levelName, role }].
     */
    healers(s, world, day) {
        world = _at(world, day);
        const folk = s && s.folk;
        if (!folk) return [];
        const out = [];
        for (const p of Townsfolk.residents(folk)) {
            if (!(p.job && p.job.id === 'healer') || Illness.isAbed(p, day)) continue;
            Townsfolk.skillsOf(folk, p, world);
            const level = Math.max(3, TradeSkills.npcLevel(p, 'medicine'));
            out.push({ person: p, name: Townsfolk.name(p), level, levelName: '', role: Townsfolk.roleTitle(p) });
        }
        if (!out.length) {
            let m = null;
            try { m = TradeSkills.master(s, world, 'medicine'); } catch (e) { m = null; }
            if (m && m.person && !Illness.isAbed(m.person, day)) out.push(m);
        }
        out.sort((a, b) => b.level - a.level || a.person.id - b.person.id);
        for (const h of out) if (!h.levelName) h.levelName = PracticeSkills.levelName(h.level);
        return out;
    },

    _care(world, s, folk, alive, day, env, hh, rng) {
        const C = Illness.config();
        const CC = C.care;
        const st = folk.ill;
        const sick = alive.filter(p => Illness.isSick(p, day));
        if (!sick.length) return;
        // Family at home to nurse them
        const nurses = new Map();
        for (const p of alive) {
            if (Townsfolk.age(p, day) < 12 || Illness.isAbed(p, day)) continue;
            const k = hh.of.get(p.id);
            nurses.set(k, (nurses.get(k) || 0) + 1);
        }
        for (const p of sick) {
            const k = hh.of.get(p.id);
            const n = (nurses.get(k) || 0) - (Illness.isAbed(p, day) ? 0 : (Townsfolk.age(p, day) >= 12 ? 1 : 0));
            if (n > 0) p.ill.fam = true;
        }
        // The healer's and the priests' rounds, the worst first
        const docs = Illness.healers(s, world, day).slice(0, 3);
        const doc = docs[0] || null;
        const priests = alive.filter(p => p.role === 'priest' && !Illness.isAbed(p, day));
        const funded = st.fund && _num(st.fund.until) >= day && _num(st.fund.gold) > 0 ? st.fund : null;
        const step = C.stepDays;
        let docVisits = Math.round(docs.length * _num(CC.visitsPerHealer, 4) * step / 2 * (funded ? 2 : 1));
        let priestVisits = Math.round(priests.length * _num(CC.visitsPerPriest, 2) * step / 2);
        const fee = Math.max(0, Math.round(_num(_obj(CC.fee) && CC.fee[env.type], 2)));
        const docFactor = doc ? _clamp(_num(CC.healerBase, 0.7) - _num(CC.healerPerLevel, 0.025) * (doc.level - 4), _num(CC.healerMin, 0.45), 0.95) : 1;
        const order = sick.slice().sort((a, b) => _num(b.ill.sv) - _num(a.ill.sv) || a.id - b.id);
        for (const p of order) {
            if (p === (doc && doc.person)) continue;
            const c = p.ill;
            let seen = false;
            if (docVisits > 0) {
                const payer = Illness._payer(folk, p, hh, world, day);
                let paid = false;
                if (funded && funded.gold >= fee) {
                    funded.gold -= fee;
                    paid = true;
                } else if (payer && Townsfolk.purse(folk, payer, world) >= fee) {
                    payer.purse = Townsfolk.purse(folk, payer, world) - fee;
                    paid = true;
                }
                if (paid || rng() < _num(CC.charityShare, 0.5)) {
                    docVisits--;
                    if (paid && fee > 0) doc.person.purse = Townsfolk.purse(folk, doc.person, world) + fee;
                    c.hl = Math.min(_num(c.hl, 1), funded ? Math.min(docFactor, _num(C.fund.fundedCare, 0.6)) : docFactor);
                    c.vb = doc.person.id;
                    seen = true;
                    // Herbs from the town's market, paid into the town's purse
                    const want = _num(CC.herbsPerVisit, 0.5);
                    let got = 0;
                    try { got = SettlementMarket.take(s, 'herbs', want); } catch (e) { got = 0; }
                    if (got > 0) {
                        c.hb = true;
                        let price = _num(CC.herbPrice, 2) * got;
                        try { price *= _clamp(_num(SettlementMarket.scarcity(s, 'herbs'), 1), 0.5, 3); } catch (e) { /* the usual price */ }
                        price = Math.round(price * 100) / 100;
                        let coin = 0;
                        if (funded && funded.gold >= price) { funded.gold -= price; coin = price; } else if (payer && _num(payer.purse) >= price) { payer.purse -= price; coin = price; }
                        if (coin > 0 && s && s.economy) Economy.payTown(s, coin);
                    }
                }
            }
            if (!seen && priestVisits > 0 && Illness.isAbed(p, day)) {
                priestVisits--;
                c.hl = Math.min(_num(c.hl, 1), _num(CC.priest, 0.9));
                c.vb = priests[Math.floor(rng() * priests.length)].id;
                seen = true;
            }
            if (seen) { c.v = _num(c.v) + 1; c.vd = day; }
        }
        // The physician the player paid for keeps what is left when the days run out
        if (st.fund && _num(st.fund.until) < day) {
            const left = _num(st.fund.gold);
            if (left > 0 && doc) doc.person.purse = Townsfolk.purse(folk, doc.person, world) + left;
            else if (left > 0 && s && s.economy) Economy.payTown(s, left);
            st.fund = null;
        }
        if (st.alms && _num(st.alms.until) < day) st.alms = null;
    },

    /** Who pays the healer: the sick, else the head of the house with the fuller purse. */
    _payer(folk, p, hh, world, day) {
        const k = hh.of.get(p.id);
        let best = null;
        for (const [id, key] of hh.of) {
            if (key !== k) continue;
            const o = Townsfolk.get(folk, id);
            if (!o || Townsfolk.age(o, day) < 16) continue;
            if (!best || Townsfolk.purse(folk, o, world) > Townsfolk.purse(folk, best, world)) best = o;
        }
        return best || p;
    },

    /** Dead of it: the townsfolk's own death, then the heir, the grief, the orphans, the grave. */
    _kill(world, s, folk, p, day, rng, news, player) {
        const k = p.ill.k;
        const d = Illness.def(k) || {};
        const cause = _pick(d.cause, rng) || d.name || 'a sickness';
        delete p.ill;
        Townsfolk._die(folk, p, day, cause);
        Townsfolk._annal(folk, world, day, { k: 'died', a: p.id, x: cause }, news);
        const st = folk.ill;
        st.deaths.push({ d: day, a: p.id, k });
        if (st.deaths.length > MAX_DEATHS) st.deaths.splice(0, st.deaths.length - MAX_DEATHS);
        const o = st.out[k];
        if (o) o.dead = _num(o.dead) + 1;
        // (the house and the purse to the heir, the orphans taken in: systems/townFamily.js's next step;
        // the trade passed on: the jobs')
        Illness._grieve(folk, p, day);
        // The sexton's next round lays them in the churchyard (systems/graveyards.js
        // processDay scans a town whose scanTick isn't its roster's tick)
        if (s && _obj(s.graveyard)) s.graveyard.scanTick = -2;
        // TODO(jobs agent): a funeral procession (world/innerMap/townWork.js) can read
        // folk.ill.deaths / the 'died' annals; the street map's mourners stand in till then.
    },

    _grieve(folk, p, day) {
        const H = (Romance.config() && Romance.config().heartbreak) || {};
        const sp = Townsfolk.get(folk, p.spouse);
        if (sp && sp.died == null && sp.spouse === p.id) Romance._break(sp, p.id, day, _num(H.days, 60), 'death', true);
        for (const id of p.parents || []) {
            const par = Townsfolk.get(folk, id);
            if (par && par.died == null) Romance._break(par, p.id, day, Math.round(_num(H.days, 60) * 0.6), 'death', true);
        }
    },

    /** Outbreaks begun and over: the annals, the town's summary, word to the player. */
    _outbreaks(world, s, folk, day, env, news, player) {
        const C = Illness.config();
        const st = folk.ill;
        const res = Townsfolk.residents(folk);
        const N = Math.max(1, res.length);
        const by = {};
        let sick = 0;
        let abed = 0;
        for (const p of res) {
            if (!p.ill) continue;
            by[p.ill.k] = (by[p.ill.k] || 0) + 1;
            if (Illness.isSick(p, day)) sick++;
            if (Illness.isAbed(p, day)) abed++;
        }
        const knows = res.some(p => p.mem && p.mem.timesSpoken > 0);
        for (const [k, d] of Object.entries(C.illnesses)) {
            if (!d.serious || !(_num(d.contagion) > 0)) continue;
            const n = by[k] || 0;
            const min = d.plague ? _num(C.outbreak.plagueMin, 1) : _num(C.outbreak.minCases, 3);
            const o = st.out[k];
            if (!o && n >= min) {
                st.out[k] = { d: day, n, dead: 0, rec: 0, peak: n };
                const from = res.find(p => p.ill && p.ill.k === k && p.ill.from);
                Townsfolk._annal(folk, world, day, { k: 'outbreak', x: `${k}|${from ? from.ill.from : ''}` }, news);
                if (knows || (player && player.q === folk.q && player.r === folk.r)) {
                    news.push({ kind: 'outbreak', folk, notice: { icon: d.icon || '🤒', title: `Sickness in ${(s && s.name) || 'town'}`, text: Illness.annalText(folk, folk.annals[folk.annals.length - 1], world), type: 'warning' } });
                }
            } else if (o) {
                o.peak = Math.max(_num(o.peak), n);
                o.n = Math.max(_num(o.n), n);
                if (n === 0) {
                    st.hist.push({ k, from: o.d, to: day, peak: o.peak, dead: _num(o.dead) });
                    if (st.hist.length > MAX_HIST) st.hist.splice(0, st.hist.length - MAX_HIST);
                    delete st.out[k];
                    Townsfolk._annal(folk, world, day, { k: 'outbreakOver', x: `${k}|${_num(o.dead)}|${o.d}` }, news);
                }
            }
        }
        // The town's summary: its hands at work (world/townLabour.js), the street map, the talk
        if (s) {
            const worst = Object.keys(st.out).sort((a, b) => _num((Illness.def(b) || {}).plague ? 1 : 0) - _num((Illness.def(a) || {}).plague ? 1 : 0) || (by[b] || 0) - (by[a] || 0))[0] || null;
            if (sick || worst) {
                s.sickness = { d: day, n: sick, abed, share: Math.round((abed + (sick - abed) * 0.3) / N * 1000) / 1000, k: worst, epi: sick / N >= _num(C.outbreak.epidemicShare, 0.12) || worst === 'plague', closed: !!(env.quarantine && worst) };
            } else if (s.sickness && !s.sickness.abs) {
                delete s.sickness;
            }
        }
    },

    // ── Between towns ────────────────────────────────────

    _travel(world, views, day) {
        const C = Illness.config();
        const T = C.travel;
        const radius = Math.max(1, _num(T.radius, 14));
        const towns = views.filter(s => s && Number.isFinite(s.q) && Number.isFinite(s.r));
        // The plague event's own town, if it has no roster, is sick for as long as it rages
        for (const ev of (world.activeEvents || [])) {
            if (ev.id !== 'plague' || !Number.isFinite(ev.q)) continue;
            const t = towns.find(s => s.q === ev.q && s.r === ev.r);
            if (t && !_obj(t.folk)) t.sickness = { k: 'plague', d: day, until: day + Math.max(1, _num(ev.daysLeft, 10)), abs: true, from: null };
        }
        const sources = [];
        for (const s of towns) {
            if (_obj(s.folk) && Array.isArray(s.folk.people) && s.folk.ill) {
                const res = Townsfolk.residents(s.folk);
                const by = {};
                for (const p of res) if (Illness.isContagious(p, day) && !(Illness.def(p.ill.k) || {}).chronic) by[p.ill.k] = (by[p.ill.k] || 0) + 1;
                const N = Math.max(1, res.length);
                for (const [k, n] of Object.entries(by)) sources.push({ s, k, share: n / N });
            } else if (s.sickness && s.sickness.abs) {
                if (_num(s.sickness.until) < day) { delete s.sickness; continue; }
                sources.push({ s, k: s.sickness.k, share: 0.1 });
            }
        }
        for (const src of sources) {
            const d = Illness.def(src.k);
            if (!d || !(_num(d.contagion) > 0)) continue;
            const qa = Illness.quarantined(world, src.s) ? _num(T.quarantine, 0.15) : 1;
            for (const b of towns) {
                if (b === src.s || (b.q === src.s.q && b.r === src.s.r)) continue;
                const dist = Hex.distance(src.s.q, src.s.r, b.q, b.r);
                if (dist > radius) continue;
                const qb = Illness.quarantined(world, b) ? _num(T.quarantine, 0.15) : 1;
                const chance = _num(T.perStep, 0.6) * src.share * Math.min(1, _num(d.contagion) * 10) * (d.plague ? _num(T.plague, 2.5) : 1)
                    * _num(_obj(T.size) && T.size[b.type], 1) * (1 - dist / (radius + 1)) * qa * qb;
                const rng = _rng(world, `${src.s.q},${src.s.r}>${b.q},${b.r}|${src.k}|${day}`);
                if (!(rng() < chance)) continue;
                if (_obj(b.folk) && Array.isArray(b.folk.people)) {
                    Illness.state(world, b, b.folk, day);
                    const open = Townsfolk.residents(b.folk).filter(p => !p.ill && !Illness._immune(p, src.k, day) && !(d.minAge && Townsfolk.age(p, day) < d.minAge));
                    if (open.length) Illness._infect(b.folk, _pick(open, rng), src.k, day, rng, 'travel', src.s.name || null);
                } else if (!b.sickness) {
                    b.sickness = { k: src.k, d: day, until: day + Math.max(1, _num(T.abstractDays, 20)), abs: true, from: src.s.name || null };
                }
            }
        }
    },

    // ── The town in words ────────────────────────────────

    /** The town's sickness now (settlement.sickness, roster or abstract), or null. */
    townSickness(s, day) {
        const k = s && s.sickness;
        if (!k) return null;
        if (k.abs && _num(k.until) < day) return null;
        if (!k.abs && day - _num(k.d) > Illness.config().stepDays * 3) return null;
        return k;
    },

    /**
     * For the talk (systems/chatter.js): the sickness here and the worst near
     * here → { here: { k, name, epi } | null, near: { k, name, town } | null }.
     */
    talk(world, settlement, q, r) {
        if (!Illness.on() || !world) return { here: null, near: null };
        const day = _num(world.day, 1);
        const out = { here: null, near: null };
        const here = Illness.townSickness(settlement, day);
        if (here && here.k) out.here = { k: here.k, name: (Illness.def(here.k) || {}).name || here.k, epi: !!here.epi, closed: !!here.closed };
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        let best = null;
        for (const s of views) {
            if (!s || s === settlement || (s.q === q && s.r === r) || !Number.isFinite(s.q)) continue;
            const k = Illness.townSickness(s, day);
            if (!k || !k.k || !(Illness.def(k.k) || {}).serious) continue;
            const dist = Hex.distance(q, r, s.q, s.r);
            if (dist > _num(Illness.config().travel.radius, 14) * 1.5) continue;
            const score = ((Illness.def(k.k) || {}).plague ? 100 : 0) + (k.epi ? 20 : 0) - dist;
            if (!best || score > best.score) best = { score, k: k.k, name: (Illness.def(k.k) || {}).name || k.k, town: s.name };
        }
        if (best) out.near = { k: best.k, name: best.name, town: best.town };
        return out;
    },

    /** Facts a townsperson's letter may tell (systems/mailVoice.js): [{ k, x, vars, w }]. */
    mailFacts(folk, p, day) {
        const out = [];
        if (!Illness.on() || !folk || !p) return out;
        const me = Illness.describe(p, day);
        if (me && (Illness.def(me.k) || {}).serious) out.push({ k: 'sick', x: me.k, vars: { illness: me.name }, w: 3 });
        else if ((p.log || []).some(e => e.k === 'recovered' && day - _num(e.d) <= 40)) {
            const e = p.log.filter(x => x.k === 'recovered').pop();
            out.push({ k: 'sick_over', x: e.x, vars: { illness: (Illness.def(e.x) || {}).name || 'the sickness' }, w: 2 });
        }
        const kin = [p.spouse, ...(p.kids || []), ...(p.parents || [])].map(id => Townsfolk.get(folk, id)).filter(o => o && Townsfolk.isHere(o));
        for (const o of kin) {
            const dd = Illness.describe(o, day);
            if (!dd || !(Illness.def(dd.k) || {}).serious) continue;
            const rel = o.id === p.spouse ? 'spouse' : (p.kids || []).includes(o.id) ? 'child' : 'parent';
            out.push({ k: 'kin_sick', x: `${o.id}`, vars: { name: o.first, kin: Townsfolk.kinWord(o, rel), illness: dd.name }, w: 3 });
            break;
        }
        const st = folk.ill;
        const ks = st && Object.keys(st.out || {})[0];
        if (ks) {
            const o = st.out[ks];
            out.push({ k: 'town_sick', x: ks, vars: { illness: (Illness.def(ks) || {}).name || ks, dead: _num(o.dead) }, w: (Illness.def(ks) || {}).plague ? 3 : 2 });
        }
        return out;
    },

    // ── Annals and lives (systems/townsfolk.js delegates these kinds) ──

    isAnnal(k) { return ANNALS.includes(k); },

    isLog(k) { return LOGS.includes(k); },

    reunionRanks() { return { recovered: 3, nursed: 4 }; },

    newsWeights() { return { outbreak: 5, outbreakOver: 4, fellIll: 3 }; },

    annalText(folk, entry, world, speaker = null) {
        if (!entry) return null;
        const when = Townsfolk.when(entry.d, world);
        const cap = t => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
        switch (entry.k) {
            case 'outbreak': {
                const [k, from] = String(entry.x || '').split('|');
                const d = Illness.def(k) || {};
                return cap(`${d.name || 'a sickness'} came to the town ${when}${from ? `, brought from ${from}` : ''}.`);
            }
            case 'outbreakOver': {
                const [k, dead] = String(entry.x || '').split('|');
                const d = Illness.def(k) || {};
                const n = _num(Number(dead));
                return cap(`${d.name || 'the sickness'} passed ${when}${n ? ` — it took ${n} of us` : ', and took no one, thank the gods'}.`);
            }
            case 'fellIll': {
                const a = Townsfolk.get(folk, entry.a);
                const d = Illness.def(entry.x) || {};
                return a ? `${Townsfolk.name(a)} fell ill with ${d.name || 'a sickness'} ${when}.` : null;
            }
            default: return null;
        }
    },

    lifeText(folk, p, e, world) {
        const when = Townsfolk.when(e.d, world);
        const o = Townsfolk.get(folk, e.o);
        const d = Illness.def(e.x) || {};
        switch (e.k) {
            case 'recovered': return `I was laid low with ${d.name || 'a sickness'} ${when}. I thought I'd not get up again.`;
            case 'nursed': return `You brought me ${e.x === 'medicine' ? 'medicine' : 'food'} when I was sick ${when}. I'll not forget it.`;
            default: return null;
        }
    },

    biographyLine(folk, p, e, world) {
        const when = Townsfolk.when(e.d, world);
        const o = Townsfolk.get(folk, e.o);
        const d = Illness.def(e.x) || {};
        switch (e.k) {
            case 'recovered': return `Survived ${d.name || 'a sickness'} ${when}.`;
            case 'nursed': return `You tended them through a sickness ${when}.`;
            default: return null;
        }
    },

    /** A line from data lines[key] (a list, or a map by illness), picked by a hash of `key`. */
    line(key, sub = null, hashKey = '', vars = {}) {
        const L = Illness.config().lines;
        let list = L[key];
        if (sub && _obj(list)) list = list[sub];
        if (!Array.isArray(list) || !list.length) return null;
        const t = list[(Utils.hashStr(`${key}|${sub}|${hashKey}`) >>> 0) % list.length];
        return String(t).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
    },

    /** The town's sickness at a glance (the panel, tests): counts and the healer. */
    view(world, s) {
        const folk = s && s.folk;
        const day = _num(world && world.day, 1);
        const out = { sick: [], abed: 0, out: [], hist: [], healer: null, fund: null, alms: null };
        if (!folk || !folk.ill) return out;
        for (const p of Townsfolk.residents(folk)) {
            const dd = Illness.describe(p, day);
            if (!dd) continue;
            out.sick.push({ person: p, ...dd, visits: _num(p.ill.v), fam: !!p.ill.fam, gift: p.ill.gift || null });
            if (dd.abed) out.abed++;
        }
        out.sick.sort((a, b) => (b.abed - a.abed) || (b.days - a.days));
        out.out = Object.entries(folk.ill.out || {}).map(([k, o]) => ({ k, name: (Illness.def(k) || {}).name || k, icon: (Illness.def(k) || {}).icon || '🤒', since: o.d, dead: _num(o.dead), peak: _num(o.peak) }));
        out.hist = (folk.ill.hist || []).slice(-5).reverse();
        const doc = Illness.healer(s, world, day);
        if (doc) out.healer = { name: doc.name, level: doc.level, levelName: doc.levelName, role: doc.role };
        if (folk.ill.fund && _num(folk.ill.fund.until) >= day) out.fund = { ...folk.ill.fund };
        if (folk.ill.alms && _num(folk.ill.alms.until) >= day) out.alms = { ...folk.ill.alms };
        return out;
    },
};
