// ============================================
// TOWN FAMILY — townsfolk conceive, carry, bear, raise, grow old, inherit
// ============================================
// Over the roster (systems/townsfolk.js) and its courtships (systems/
// romance.js), every `stepDays` in every town with a roster:
//
//   CONCEPTION — a wedded wife and husband at home (or, rarely, a wife and
//   her lover — a scandal if it comes out) conceive at a rate by her age,
//   how many little ones they have already, the town's food and health, her
//   hurts and the family's station (data/townFamily.json → conception).
//   PREGNANCY — `p.preg = { d, due, f, aff }`, `pregnancyDays` long (a game
//   year is 120 days: nine months is 90). Visible: the bio ("with child"),
//   her family's talk, the journal, the town's gossip.
//   BIRTH — a midwife attends (a grown woman of the town); the baby is a real
//   person on the roster (Townsfolk._born: parents, a culture's name, the
//   family's name and house). `p.postpartum = { d, by }` — `isPostpartum`
//   for the sickness system to read (childbed fever is theirs: set
//   birth.childbedDeath to 0 when it takes over).
//   HOUSEHOLDS — `p.hh`: a couple and their children under one roof; a
//   newly-wed pair set up house (a free house while the town has one, else
//   in with the smaller family); an orphan is taken in by kin (grandparents,
//   aunts and uncles, a grown brother or sister) or a neighbour (`p.ward`).
//   INHERITANCE — when the last grown member of a household dies, the eldest
//   child (else the nearest kin) inherits the house and the purse (`p.heir`
//   on the dead; the trade is the jobs system's to pass on).
//   AGEING — `ageStage`, `canWork` (retirement from heavy work), `frailty`
//   (for illness), `greyShade` (hair goes grey, silver, white), `isYouth` and
//   `comingOfAge` (12–15: for apprenticeships, the jobs system's to give).
//   LINEAGE — `lineage`/`familyLine`: grandparents to grandchildren.
//
// Every roll is a hash stream of the world seed, the town and the day —
// never the shared RNG. Data: data/townFamily.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Townsfolk } from './townsfolk.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { WorldEvents } from '../world/worldEvents.js';
import { TownSchool } from './townSchool.js';

const DEFAULTS = {
    enabled: true,
    stepDays: 10,
    pregnancyDays: 90,
    conception: {
        byAge: [{ under: 18, rate: 0 }, { under: 25, rate: 0.5 }, { under: 35, rate: 0.45 }, { under: 40, rate: 0.3 }, { under: 43, rate: 0.12 }, { under: 999, rate: 0 }],
        afterWedDays: 30, gapAfterBirthDays: 60, perLivingChild: 0.12, maxChildren: 5,
        dearth: 0.5, plague: 0.6, hurt: 0.5, station: { 0: 0.85, 1: 1, 2: 1.05, 3: 1.1 }, affair: 0.04, affairFoundOut: 0.5,
    },
    birth: { childbedDeath: 0.02, postpartumDays: 30, midwifeMinAge: 35, stillbirth: 0.03 },
    youthAge: 12,
    elderAge: 60,
    frailFrom: 55,
    frailFull: 85,
    retire: { heavy: 62, all: 75, heavyRoles: ['guard', 'farmer', 'blacksmith_npc'] },
    grey: { from: [42, 58], silver: 12, white: 22 },
    houses: { perResident: 0.3, slack: 1 },
    maxComingOfAge: 30,
    christening: { afterDays: 3, offering: 1, godparents: 2, lateDays: 60 },
    adoption: { maxAge: 55, neighbourMaxKids: 3, range: 12 },
    onMap: {},
    lines: {},
};

const STATION = { noble: 3, merchant: 2, priest: 2, guard: 1, blacksmith_npc: 1, farmer: 1, villager: 1, child: 1, beggar: 0 };

let _cfg = null;
let _cfgSrc;

function _obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }
function _num(v, d = 0) { return typeof v === 'number' && isFinite(v) ? v : d; }
function _seed(world) { return (world && world.generationParams && world.generationParams.seed) || 1; }
function _h(...parts) { return ((Utils.hashStr(parts.join('|')) >>> 0) % 1000003) / 1000003; }

function _rng(world, folk, day, salt = '') {
    let s = (Utils.hashStr(`${_seed(world)}|${folk.q},${folk.r}|${day}|fam${salt}`) >>> 0) || 1;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

/** A per-step chance from a yearly rate. */
function _perStep(rate) {
    const C = TownFamily.config();
    const Y = Townsfolk.config().daysPerYear;
    return 1 - Math.pow(1 - Math.min(0.99, Math.max(0, rate)), C.stepDays / Y);
}

export const TownFamily = {
    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.townFamily : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            _cfg = { ...DEFAULTS, ...d };
            for (const k of ['conception', 'birth', 'retire', 'grey', 'houses', 'christening', 'adoption', 'onMap', 'lines']) _cfg[k] = { ...DEFAULTS[k], ...(_obj(d[k]) || {}) };
        }
        return _cfg;
    },

    // ──────────── THE TOWN'S FAMILY BOOK ────────────

    /**
     * The town's family book, made on first asking: { v, tick, nh, houses,
     * comingOfAge: [{ id, d }] }. An old roster gets households and its
     * youths filled in (no back-dated events).
     */
    state(folk, world = null, day = null) {
        if (!folk) return null;
        let st = folk.family;
        if (!_obj(st)) {
            const C = TownFamily.config();
            const at = _num(day, _num(folk.tick, _num(world && world.day, 0)));
            st = folk.family = { v: 1, tick: at - (((at % C.stepDays) + C.stepDays) % C.stepDays), nh: 0, houses: 0, comingOfAge: [] };
            TownFamily._fillIn(folk, st.tick);
        }
        if (!Array.isArray(st.comingOfAge)) st.comingOfAge = [];
        return st;
    },

    /** Households for a roster that had none; youths marked; the long dead settled. */
    _fillIn(folk, day) {
        const st = folk.family;
        const C = TownFamily.config();
        const here = Townsfolk.residents(folk);
        const parent = new Map();
        const find = id => { while (parent.get(id) !== id) { parent.set(id, parent.get(parent.get(id))); id = parent.get(id); } return id; };
        const join = (a, b) => { const x = find(a); const y = find(b); if (x !== y) parent.set(y, x); };
        for (const p of here) parent.set(p.id, p.id);
        for (const p of here) {
            const sp = Townsfolk.get(folk, p.spouse);
            if (sp && Townsfolk.isHere(sp)) join(p.id, sp.id);
            const wed = sp && sp.died == null;
            if (!wed) for (const pid of p.parents || []) { const par = Townsfolk.get(folk, pid); if (par && Townsfolk.isHere(par)) join(par.id, p.id); }
            if (p.ward != null && parent.has(p.ward)) join(p.ward, p.id);
        }
        const ids = new Map();
        for (const p of here) {
            const root = find(p.id);
            if (!ids.has(root)) ids.set(root, st.nh++);
            p.hh = ids.get(root);
        }
        st.houses = Math.max(st.nh, Math.ceil(here.length * _num(C.houses.perResident, 0.3))) + _num(C.houses.slack, 1);
        for (const p of folk.people) {
            if (p.died != null) p.estate = true;
            else if (Townsfolk.isHere(p) && p.role === 'child' && Townsfolk.age(p, day) >= C.youthAge) p.youth = day;
        }
    },

    /** Live every step up to `upTo` (steps land on days divisible by stepDays). */
    catchUp(world, settlement, folk, upTo, news = [], player = null) {
        const C = TownFamily.config();
        if (!C.enabled || !folk || !Array.isArray(folk.people)) return news;
        const st = TownFamily.state(folk, world, _num(folk.tick, upTo));
        let guard = 0;
        while (st.tick + C.stepDays <= upTo && guard++ < 1500) {
            st.tick += C.stepDays;
            TownFamily._step(world, settlement, folk, st.tick, news, player);
        }
        return news;
    },

    _ctx(world, settlement, folk) {
        const ctx = { dearth: false, plague: false };
        try { ctx.dearth = !!(settlement && SettlementMarket.inDearth(settlement)); } catch { ctx.dearth = false; }
        try { ctx.plague = WorldEvents.getEventsAt(world, { q: folk.q, r: folk.r, settlement }).some(ev => ev.id === 'plague'); } catch { ctx.plague = false; }
        return ctx;
    },

    _step(world, settlement, folk, day, news, player) {
        const rng = _rng(world, folk, day);
        const ctx = TownFamily._ctx(world, settlement, folk);
        TownFamily._births(world, folk, day, rng, news);
        TownFamily._christenings(world, settlement, folk, day, rng, news);
        TownFamily._estates(world, folk, day, news);
        TownFamily._orphans(world, folk, day, rng, news);
        TownFamily._households(world, folk, day, rng);
        TownFamily._conceive(world, folk, day, rng, ctx, news);
        TownFamily._youths(folk, day);
        // The children at their letters (systems/townSchool.js)
        TownSchool.step(world, settlement, folk, day, player);
    },

    // ──────────── CONCEPTION AND BIRTH ────────────

    /** This year's chance for a wife of this age (data byAge). */
    _rateFor(age) {
        const band = (TownFamily.config().conception.byAge || []).find(b => age < _num(b.under, 999));
        return band ? _num(band.rate) : 0;
    },

    /** May she conceive now (no child carried, the last born a while ago, not too many)? */
    _canConceive(folk, mother, day) {
        const K = TownFamily.config().conception;
        if (!Townsfolk.isHere(mother) || mother.gender !== 'female' || mother.preg) return false;
        const kids = (mother.kids || []).map(id => Townsfolk.get(folk, id)).filter(Boolean);
        if (kids.filter(k => k.died == null).length >= _num(K.maxChildren, 5)) return false;
        const last = kids.reduce((m, k) => Math.max(m, k.born), -Infinity);
        if (day - last < _num(K.gapAfterBirthDays, 150)) return false;
        return true;
    },

    _conceive(world, folk, day, rng, ctx, news) {
        const C = TownFamily.config();
        const K = C.conception;
        const station = _obj(K.station) || {};
        const conceive = (mother, father, aff) => {
            mother.preg = { d: day, due: day + _num(C.pregnancyDays, 90), f: father.id };
            if (aff) mother.preg.aff = 1;
            if (!aff) {
                Townsfolk._log(mother, day, 'expecting', father.id, String(mother.preg.due));
                Townsfolk._log(father, day, 'expecting', mother.id, String(mother.preg.due));
            }
            // Word reaches the player of someone they know who is with child
            if (mother.mem && mother.mem.timesSpoken > 0 && (mother.mem.timesSpoken >= 2 || _num(mother.mem.disposition, 50) >= 65)) {
                news.push({ kind: 'expecting', folk, entry: { k: 'expecting', a: mother.id, d: day }, text: `${Townsfolk.name(mother)} is with child, due ${Townsfolk.when(mother.preg.due, world)}.` });
            }
        };
        for (const mother of Townsfolk.residents(folk)) {
            if (!TownFamily._canConceive(folk, mother, day)) continue;
            const age = Townsfolk.age(mother, day);
            let rate = TownFamily._rateFor(age);
            if (rate <= 0) continue;
            const living = (mother.kids || []).map(id => Townsfolk.get(folk, id)).filter(k => k && k.died == null).length;
            rate *= Math.max(0.1, 1 - living * _num(K.perLivingChild, 0.12));
            if (ctx.dearth) rate *= _num(K.dearth, 0.5);
            if (ctx.plague) rate *= _num(K.plague, 0.6);
            if (mother.hurt) rate *= _num(K.hurt, 0.5);
            const sp = Townsfolk.get(folk, mother.spouse);
            const wed = sp && sp.died == null && Townsfolk.isHere(sp) && sp.gender !== mother.gender;
            if (wed) {
                if (mother.wedDay != null && day - mother.wedDay < _num(K.afterWedDays, 30)) continue;
                rate *= _num(station[TownFamily.station(mother, folk)], 1);
                if (rng() < _perStep(rate)) conceive(mother, sp, false);
                continue;
            }
            // An affair (systems/romance.js keeps them on folk.romance)
            const aff = folk.romance && Array.isArray(folk.romance.list)
                ? folk.romance.list.find(c => c.affair && (c.a === mother.id || c.b === mother.id)) : null;
            const lover = aff ? Townsfolk.get(folk, aff.a === mother.id ? aff.b : aff.a) : null;
            if (lover && lover.gender !== mother.gender && Townsfolk.isHere(lover) && rng() < _perStep(rate * _num(K.affair, 0.04))) conceive(mother, lover, true);
        }
    },

    /** A family's station (the higher of the pair's: 0 beggar … 3 noble). */
    station(p, folk = null) {
        const sp = folk ? Townsfolk.get(folk, p.spouse) : null;
        const s = r => _num(STATION[r], 1);
        return Math.max(s(p.retired || p.role), sp ? s(sp.retired || sp.role) : 0);
    },

    /** A grown woman of the town to attend (the eldest-ish of the able). */
    _midwife(folk, mother, day, rng) {
        const C = TownFamily.config().birth;
        const able = Townsfolk.residents(folk).filter(p => p !== mother && p.gender === 'female' && Townsfolk.age(p, day) >= _num(C.midwifeMinAge, 35) && Townsfolk.age(p, day) < 75);
        return able.length ? able[Math.floor(rng() * able.length)] : null;
    },

    _births(world, folk, day, rng, news) {
        const C = TownFamily.config();
        const B = C.birth;
        for (const mother of folk.people) {
            const pg = mother.preg;
            if (!pg) continue;
            if (mother.died != null) { delete mother.preg; continue; }
            if (day < _num(pg.due)) continue;
            delete mother.preg;
            if (mother.away) continue; // (born away from town: off the roster)
            const father = Townsfolk.get(folk, pg.f) || Townsfolk.get(folk, mother.spouse);
            if (!father) continue;
            const midwife = TownFamily._midwife(folk, mother, day, rng);
            mother.postpartum = { d: day };
            if (midwife) { mother.postpartum.by = midwife.id; Townsfolk._log(midwife, day, 'midwife', mother.id); }
            if (rng() < _num(B.stillbirth, 0.03)) {
                Townsfolk._log(mother, day, 'stillborn');
                continue;
            }
            const child = Townsfolk._born(folk, mother, father, day, rng);
            child.hh = mother.hh;
            if (pg.aff) {
                // The babe carries the mother's name; whether the town learns whose it is…
                child.last = mother.last;
                const sp = Townsfolk.get(folk, mother.spouse);
                if (sp && sp.id !== father.id) {
                    father.kids = father.kids.filter(id => id !== child.id);
                    child.parents = [mother.id, sp.id];
                    sp.kids.push(child.id);
                    child.trueFather = father.id;
                    if (rng() < _num(C.conception.affairFoundOut, 0.5)) {
                        Townsfolk._annal(folk, world, day, { k: 'affair', a: mother.id, b: father.id }, news);
                        Townsfolk._log(sp, day, 'betrayed', mother.id, father.first);
                    }
                }
            }
            if (father.died != null && father.died < day) Townsfolk._log(child, day, 'bornFatherless', father.id);
            Townsfolk._annal(folk, world, day, { k: 'born', a: child.id, b: mother.id }, news);
            // A christening at the church a few days on (_christenings; no church-service hook exists to use)
            child.christen = day + _num(C.christening.afterDays, 3);
            if (rng() < _num(B.childbedDeath, 0.02)) {
                Townsfolk._die(folk, mother, day, (Townsfolk.config().causes.childbed || ['childbed'])[0] || 'childbed');
                Townsfolk._annal(folk, world, day, { k: 'died', a: mother.id, x: mother.cause }, news);
            }
        }
    },

    /**
     * A babe's christening a few days after the birth (c.christen = the day):
     * the parents, godparents (kin — an aunt, an uncle — else friends of the
     * family) and the priest at the church; the parents' offering goes from
     * their purse to the priest's. The godparents are kept on the child
     * (c.godparents). (The jobs system's church has no service hook to use.)
     */
    _christenings(world, settlement, folk, day, rng, news) {
        const K = TownFamily.config().christening;
        for (const c of Townsfolk.residents(folk)) {
            if (c.christen == null || c.christened != null || day < c.christen) continue;
            delete c.christen;
            if (day - c.born > _num(K.lateDays, 60)) continue;
            const priest = Townsfolk.residents(folk).find(p => p.role === 'priest' || (p.job && p.job.id === 'priest'));
            if (!priest) continue;
            const parents = (c.parents || []).map(id => Townsfolk.get(folk, id)).filter(p => p && Townsfolk.isHere(p));
            const grown = p => p && Townsfolk.isHere(p) && Townsfolk.age(p, day) >= 18 && !parents.includes(p) && p !== priest;
            const kin = parents.flatMap(p => Townsfolk.siblings(folk, p)).filter(grown).sort((a, b) => a.id - b.id);
            const friends = Townsfolk.residents(folk).filter(p => grown(p) && !kin.includes(p) && !parents.some(x => x.hh != null && x.hh === p.hh))
                .sort((a, b) => _h(_seed(world), folk.q, folk.r, c.id, a.id, 'god') - _h(_seed(world), folk.q, folk.r, c.id, b.id, 'god'));
            const gods = [...kin, ...friends].slice(0, Math.max(0, _num(K.godparents, 2)));
            c.godparents = gods.map(g => g.id);
            c.christened = day;
            for (const g of gods) Townsfolk._log(g, day, 'godparent', c.id);
            // The offering, real coin: a parent's purse to the priest's
            const fee = _num(K.offering, 1);
            const payer = parents.find(p => Townsfolk.purse(folk, p, world) >= fee);
            if (fee > 0 && payer) {
                payer.purse = Math.round((payer.purse - fee) * 100) / 100;
                Townsfolk.purse(folk, priest, world);
                priest.purse = Math.round((priest.purse + fee) * 100) / 100;
            }
            const mother = parents.find(p => p.gender === 'female') || parents[0];
            if (mother) Townsfolk._annal(folk, world, day, { k: 'christened', a: c.id, b: mother.id, x: gods.map(g => Townsfolk.name(g)).join('|') }, news);
        }
        void settlement; void rng;
    },

    /** Christenings in a town today: [{ child, parents, godparents }] (the street map gathers them at the church). */
    christeningsOn(folk, day) {
        if (!folk || !Array.isArray(folk.annals)) return [];
        return folk.annals.filter(e => e.k === 'christened' && e.d === day).map(e => {
            const child = Townsfolk.get(folk, e.a);
            return child ? { child, parents: (child.parents || []).map(id => Townsfolk.get(folk, id)).filter(Boolean), godparents: (child.godparents || []).map(id => Townsfolk.get(folk, id)).filter(Boolean) } : null;
        }).filter(Boolean);
    },

    /**
     * An orphan with no one in their own town: a childless wedded couple of a
     * nearby town takes them in (the child moves to that town's roster). → the new person or null
     */
    _adoptAway(world, folk, c, day, rng, news) {
        const A = TownFamily.config().adoption;
        const views = world && typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        const here = views.find(s => s && s.folk === folk);
        const far = s => Math.max(Math.abs(s.q - folk.q), Math.abs(s.r - folk.r));
        const near = views.filter(s => s && s.folk && s.folk !== folk && Array.isArray(s.folk.people) && far(s) <= _num(A.range, 12))
            .sort((a, b) => (far(a) - far(b)) || String(a.name).localeCompare(String(b.name)));
        for (const s of near) {
            const tf = s.folk;
            const none = p => !(p.kids || []).some(id => { const k = Townsfolk.get(tf, id); return k && k.died == null; }) && !tf.people.some(x => x.ward === p.id && x.died == null);
            const couples = Townsfolk.residents(tf).filter(p => {
                const sp = Townsfolk.get(tf, p.spouse);
                const age = Townsfolk.age(p, day);
                return sp && Townsfolk.isHere(sp) && p.id < sp.id && age >= 20 && age < _num(A.maxAge, 55) && none(p) && none(sp);
            });
            if (!couples.length) continue;
            const g = couples[Math.floor(rng() * couples.length)];
            const sp = Townsfolk.get(tf, g.spouse);
            // The child goes to live with them: a person on that town's roster, gone from this one
            const n = {
                ...JSON.parse(JSON.stringify(c)), id: tf.n++, parents: [], kids: [], spouse: null, away: null,
                ward: g.id, hh: g.hh != null ? g.hh : null, from: { q: folk.q, r: folk.r, id: c.id, town: here ? here.name : null },
            };
            delete n.christen;
            tf.people.push(n);
            delete tf._index;
            c.away = { d: day, to: s.name, adopted: n.id };
            Townsfolk._log(n, day, 'takenIn', g.id);
            Townsfolk._log(g, day, 'tookIn', n.id);
            Townsfolk._log(sp, day, 'tookIn', n.id);
            Townsfolk._annal(folk, world, day, { k: 'adoptedAway', a: c.id, b: c.id, x: `${Townsfolk.name(g)} and ${Townsfolk.name(sp)} of ${s.name}` }, news);
            Townsfolk._annal(tf, world, day, { k: 'adoptedFrom', a: g.id, b: n.id, x: here ? here.name : 'another town' }, news);
            return n;
        }
        return null;
    },

    /** Lying in after a birth (for illness: childbed fever is the sickness system's). */
    isPostpartum(p, day, days = null) {
        if (!p || !p.postpartum) return false;
        const D = days != null ? days : _num(TownFamily.config().birth.postpartumDays, 30);
        return _num(day) - _num(p.postpartum.d) <= D;
    },

    /** Births in a town since `since`: [{ child, mother, d }] (the annals). */
    births(folk, since = -Infinity) {
        if (!folk || !Array.isArray(folk.annals)) return [];
        return folk.annals.filter(e => e.k === 'born' && e.d > since).map(e => ({ child: Townsfolk.get(folk, e.a), mother: Townsfolk.get(folk, e.b), d: e.d })).filter(x => x.child);
    },

    // ──────────── HOUSEHOLDS, ESTATES, ORPHANS ────────────

    _members(folk, hh) {
        return Townsfolk.residents(folk).filter(p => p.hh === hh);
    },

    /** Newcomers and newborns get a household; newly-weds set up house. */
    _households(world, folk, day, rng) {
        const st = folk.family;
        const C = TownFamily.config();
        const here = Townsfolk.residents(folk);
        const used = new Set(here.map(p => p.hh).filter(x => x != null));
        st.houses = Math.max(_num(st.houses), Math.ceil(here.length * _num(C.houses.perResident, 0.3)) + _num(C.houses.slack, 1));
        for (const p of here) {
            if (p.hh != null) continue;
            const mum = (p.parents || []).map(id => Townsfolk.get(folk, id)).find(x => x && Townsfolk.isHere(x) && x.hh != null);
            const sp = Townsfolk.get(folk, p.spouse);
            if (p.role === 'child' && mum) p.hh = mum.hh;
            else if (sp && Townsfolk.isHere(sp) && sp.hh != null) p.hh = sp.hh;
            else { p.hh = st.nh++; used.add(p.hh); }
        }
        // A couple under two roofs: they make one
        for (const p of here) {
            const sp = Townsfolk.get(folk, p.spouse);
            if (!sp || sp.died != null || !Townsfolk.isHere(sp) || sp.hh === p.hh || p.id > sp.id) continue;
            const mine = TownFamily._members(folk, p.hh);
            const theirs = TownFamily._members(folk, sp.hh);
            const kidsOf = list => list.filter(k => k !== p && k !== sp && Townsfolk.age(k, day) < 16 && (k.parents || []).some(id => id === p.id || id === sp.id));
            let to;
            if (used.size < _num(st.houses)) {
                to = st.nh++;
                used.add(to);
                Townsfolk._log(p, day, 'newHome', sp.id);
                Townsfolk._log(sp, day, 'newHome', p.id);
            } else {
                // No free house: in with the smaller family
                to = mine.length <= theirs.length ? p.hh : sp.hh;
            }
            for (const x of [p, sp, ...kidsOf(mine), ...kidsOf(theirs)]) x.hh = to;
        }
        void rng;
    },

    /** The last grown one of a household dead: the heir takes the house and the purse. */
    _estates(world, folk, day, news) {
        for (const dead of folk.people) {
            if (dead.died == null || dead.estate) continue;
            dead.estate = true;
            if (dead.hh == null || dead.away) continue;
            const grownLeft = TownFamily._members(folk, dead.hh).filter(p => Townsfolk.age(p, day) >= 16);
            const heir = TownFamily.heirOf(folk, dead, day);
            if (heir) dead.heir = heir.id;
            const coin = typeof dead.purse === 'number' ? dead.purse : 0;
            if (heir && coin > 0) {
                Townsfolk.purse(folk, heir, world);
                heir.purse += coin;
                dead.purse = 0;
            }
            if (!heir) continue;
            // The house was the dead's to leave: the household's eldest (a spouse living keeps it)
            const head = grownLeft.every(p => p.born >= dead.born);
            if (!head || heir.id === dead.spouse) continue;
            if (heir.hh !== dead.hh) {
                // (someone else still lives there: the heir has only the coin)
                if (grownLeft.length) continue;
                // The heir's household moves into the house
                const old = heir.hh;
                for (const p of Townsfolk.residents(folk)) if (p.hh === old && old != null) p.hh = dead.hh;
                heir.hh = dead.hh;
            }
            Townsfolk._log(heir, day, 'inherited', dead.id, coin > 0 ? `the house and ${coin} coin` : 'the house');
            Townsfolk._annal(folk, world, day, { k: 'inherited', a: heir.id, b: dead.id, x: coin > 0 ? `the house and ${coin} coin` : 'the house' }, news);
        }
    },

    /** Who inherits from the dead: the eldest living child here, else a spouse, a sibling, a grandchild. */
    heirOf(folk, dead, day) {
        const here = id => { const p = Townsfolk.get(folk, id); return p && Townsfolk.isHere(p) ? p : null; };
        const grown = p => p && Townsfolk.age(p, day) >= 16;
        const byAge = list => list.filter(Boolean).sort((a, b) => a.born - b.born || a.id - b.id);
        const sp = here(dead.spouse);
        if (sp) return sp;
        const kids = byAge((dead.kids || []).map(here));
        const grownKid = kids.find(grown);
        if (grownKid) return grownKid;
        const sibs = byAge(Townsfolk.siblings(folk, dead).map(s => here(s.id))).filter(grown);
        if (sibs.length) return sibs[0];
        return kids[0] || null;
    },

    /** Children with no parent at home: kin take them in, else a neighbour. */
    _orphans(world, folk, day, rng, news) {
        const here = Townsfolk.residents(folk);
        for (const c of here) {
            if (Townsfolk.age(c, day) >= 16 || c.role !== 'child') continue;
            const parentHome = (c.parents || []).some(id => Townsfolk.isHere(Townsfolk.get(folk, id)));
            const g = c.ward != null ? Townsfolk.get(folk, c.ward) : null;
            if (parentHome || (g && Townsfolk.isHere(g))) continue;
            // (a child on a roster begun with no parents written: they live with some household, not orphaned now)
            if (!(c.parents || []).length && c.ward == null) {
                const home = Townsfolk.residents(folk).filter(p => p.role !== 'child' && Townsfolk.age(p, day) >= 20 && p.hh != null)
                    .sort((a, b) => _h(_seed(world), folk.q, folk.r, c.id, a.id, 'home') - _h(_seed(world), folk.q, folk.r, c.id, b.id, 'home'))[0];
                if (home) { c.ward = home.id; c.hh = home.hh; }
                continue;
            }
            const guardian = TownFamily._guardianFor(folk, c, day, rng);
            if (!guardian) { TownFamily._adoptAway(world, folk, c, day, rng, news); continue; }
            c.ward = guardian.id;
            c.hh = guardian.hh;
            Townsfolk._log(c, day, 'takenIn', guardian.id);
            Townsfolk._log(guardian, day, 'tookIn', c.id);
            Townsfolk._annal(folk, world, day, { k: 'tookIn', a: guardian.id, b: c.id }, news);
        }
    },

    _guardianFor(folk, c, day, rng) {
        const ok = p => p && Townsfolk.isHere(p) && Townsfolk.age(p, day) >= 18 && Townsfolk.age(p, day) < 75 && p.role !== 'child';
        const parents = (c.parents || []).map(id => Townsfolk.get(folk, id)).filter(Boolean);
        const grand = parents.flatMap(p => (p.parents || []).map(id => Townsfolk.get(folk, id))).filter(ok);
        if (grand.length) return grand[0];
        const aunts = parents.flatMap(p => Townsfolk.siblings(folk, p)).filter(ok);
        if (aunts.length) return aunts.sort((a, b) => (b.spouse != null) - (a.spouse != null) || a.id - b.id)[0];
        const sibs = Townsfolk.siblings(folk, c).filter(ok);
        if (sibs.length) return sibs.sort((a, b) => a.born - b.born)[0];
        // A neighbour: a wedded couple (any two), the fewest little ones first, not too many already
        const A = TownFamily.config().adoption;
        const living = p => (p.kids || []).map(id => Townsfolk.get(folk, id)).filter(k => k && k.died == null && Townsfolk.isHere(k) && Townsfolk.age(k, day) < 16).length;
        const couples = Townsfolk.residents(folk).filter(p => ok(p) && Townsfolk.age(p, day) < _num(A.maxAge, 55) && Townsfolk.isHere(Townsfolk.get(folk, p.spouse))
            && p.id < p.spouse && living(p) < _num(A.neighbourMaxKids, 3));
        if (!couples.length) return null;
        couples.sort((a, b) => a.kids.length - b.kids.length || a.id - b.id);
        const few = couples.slice(0, 3);
        return few[Math.floor(rng() * few.length)];
    },

    // ──────────── GROWING UP, GROWING OLD ────────────

    _youths(folk, day) {
        const C = TownFamily.config();
        const st = folk.family;
        for (const p of Townsfolk.residents(folk)) {
            if (p.youth != null || p.role !== 'child' || Townsfolk.age(p, day) < C.youthAge) continue;
            p.youth = day;
            st.comingOfAge.push({ id: p.id, d: day });
        }
        const max = _num(C.maxComingOfAge, 30);
        if (st.comingOfAge.length > max) st.comingOfAge.splice(0, st.comingOfAge.length - max);
    },

    /** Youths who came of age (12) since `since`: [{ person, d }] — for apprenticeships (the jobs system's). */
    comingOfAge(folk, since = -Infinity) {
        const st = folk && folk.family;
        if (!st || !Array.isArray(st.comingOfAge)) return [];
        return st.comingOfAge.filter(e => e.d > since).map(e => ({ person: Townsfolk.get(folk, e.id), d: e.d })).filter(e => e.person && e.person.died == null);
    },

    /** 12–15: old enough to be apprenticed, not yet grown. */
    isYouth(p, day) {
        const a = Townsfolk.age(p, day);
        return a >= TownFamily.config().youthAge && a < Townsfolk.config().comeOfAge;
    },

    /** 'infant' | 'child' | 'youth' | 'adult' | 'elder' */
    ageStage(p, day) {
        const a = Townsfolk.age(p, day);
        const C = TownFamily.config();
        if (a < Townsfolk.config().onMapMinAge) return 'infant';
        if (a < C.youthAge) return 'child';
        if (a < Townsfolk.config().comeOfAge) return 'youth';
        return a >= C.elderAge ? 'elder' : 'adult';
    },

    /** Can they work (heavy: a guard's, a farmer's, a smith's)? The jobs system reads this. */
    canWork(p, day, heavy = null) {
        if (!p || p.died != null) return false;
        const R = TownFamily.config().retire;
        const a = Townsfolk.age(p, day);
        if (a < Townsfolk.config().comeOfAge) return false;
        if (a >= _num(R.all, 75)) return false;
        const isHeavy = heavy != null ? heavy : (R.heavyRoles || []).includes(p.retired || p.role);
        return !(isHeavy && a >= _num(R.heavy, 62));
    },

    /** 0 below frailFrom, 1 at frailFull: the old fall ill easier (for the sickness system). */
    frailty(p, day) {
        const C = TownFamily.config();
        const a = Townsfolk.age(p, day);
        return Math.max(0, Math.min(1, (a - C.frailFrom) / Math.max(1, C.frailFull - C.frailFrom)));
    },

    /** The hair's colour by age: null (their own), 'Gray', 'Silver' or 'White'. Hashed per person. */
    greyShade(world, folk, p, day) {
        const G = TownFamily.config().grey;
        const [lo, hi] = Array.isArray(G.from) ? G.from : [42, 58];
        const from = lo + Math.floor(_h(_seed(world), folk.q, folk.r, p.id, 'grey') * (hi - lo + 1));
        const a = Townsfolk.age(p, day);
        if (a < from) return null;
        if (a >= from + _num(G.white, 22)) return 'White';
        if (a >= from + _num(G.silver, 12)) return 'Silver';
        return 'Gray';
    },

    // ──────────── LINEAGE AND WORDS ────────────

    /** Their family across the generations: { grandparents, parents, siblings, spouse, kids, grandkids } (persons). */
    lineage(folk, p) {
        const get = id => Townsfolk.get(folk, id);
        const parents = (p.parents || []).map(get).filter(Boolean);
        const grandparents = parents.flatMap(x => (x.parents || []).map(get)).filter(Boolean);
        const kids = (p.kids || []).map(get).filter(Boolean);
        const grandkids = kids.flatMap(k => (k.kids || []).map(get)).filter(Boolean);
        const wards = folk.people.filter(x => x.ward === p.id);
        return { grandparents, parents, siblings: Townsfolk.siblings(folk, p), spouse: get(p.spouse), kids, grandkids, wards };
    },

    /** "Family of: …" for the journal, or null. */
    familyLine(folk, p, world) {
        const L = TownFamily.lineage(folk, p);
        const day = _num(world && world.day, 0);
        const nm = x => `${x.first}${x.died != null ? ' †' : ''}`;
        const parts = [];
        if (L.parents.length) parts.push(`child of ${L.parents.map(nm).join(' & ')}`);
        if (L.grandparents.length) parts.push(`grandchild of ${L.grandparents.map(nm).join(', ')}`);
        if (L.grandkids.length) parts.push(`grandparent of ${L.grandkids.map(nm).join(', ')}`);
        if (L.wards.length) parts.push(`took in ${L.wards.map(nm).join(', ')}`);
        if (p.ward != null) { const g = Townsfolk.get(folk, p.ward); if (g) parts.push(`raised by ${g.first} ${g.last}`); }
        if (p.preg && p.died == null) parts.push(`with child, due ${Townsfolk.when(p.preg.due, world).replace(/^in /, '')}`);
        void day;
        return parts.length ? parts.join('; ') : null;
    },

    /** A line from data lines[key] for a speaker (their tempers prefer their own), filled with vars. */
    line(key, speaker, vars = {}, seedKey = '') {
        const list = (TownFamily.config().lines || {})[key];
        if (!Array.isArray(list) || !list.length) return null;
        const traits = (speaker && speaker.traits) || [];
        const own = list.filter(l => typeof l !== 'string' && (Array.isArray(l.p) ? l.p : [l.p]).some(t => traits.includes(t)));
        const plain = list.filter(l => typeof l === 'string' || !l.p);
        const pool = own.length && _h(seedKey, key, 'v') < 0.5 ? own : plain.length ? plain : list;
        const pick = pool[Math.floor(_h(seedKey, key) * pool.length) % pool.length];
        let t = typeof pick === 'string' ? pick : pick.t;
        for (const [k, v] of Object.entries(vars)) t = t.split(`{${k}}`).join(v == null ? '' : String(v));
        return t;
    },

    /** How the town names a mother: "the smith's wife", or her name. */
    describeParent(folk, p) {
        const sp = Townsfolk.get(folk, p.spouse);
        if (sp && sp.died == null && !['villager', 'child'].includes(sp.retired || sp.role)) {
            return `the ${Townsfolk.title(sp.retired || sp.role, sp.gender)}'s ${Townsfolk.kinWord(p, 'spouse')}`;
        }
        return `${p.first} ${p.last}`;
    },

    /** Gossip of the town's newest babes and those expecting: [text] (the street map's chatter). */
    familyNews(folk, world, days = 30) {
        const day = _num(world && world.day, 0);
        const out = [];
        for (const b of TownFamily.births(folk, day - days)) {
            if (!b.mother) continue;
            out.push(TownFamily.line('birthNews', null, { name: TownFamily.describeParent(folk, b.mother), kid: b.child.gender === 'female' ? 'girl' : 'boy' }, `${folk.q},${folk.r}|${b.child.id}`));
        }
        for (const p of Townsfolk.residents(folk)) {
            if (!p.preg || p.preg.aff) continue;
            out.push(TownFamily.line('expectingNews', null, { name: TownFamily.describeParent(folk, p), when: Townsfolk.when(p.preg.due, world) }, `${folk.q},${folk.r}|${p.id}|x`));
        }
        return out.filter(Boolean).map(t => t.charAt(0).toUpperCase() + t.slice(1));
    },

    /** An old townsperson's tale of the old days, from the town's real annals (3+ years back), or null. */
    elderStory(folk, p, world, seedKey = '') {
        const day = _num(world && world.day, 0);
        const Y = Townsfolk.config().daysPerYear;
        const old = (folk.annals || []).filter(e => e.d < day - 3 * Y && ['died', 'wed', 'exiled', 'plotFoiled', 'eloped', 'affair', 'rivalMen', 'graveRobbed', 'brawl'].includes(e.k) && e.a !== p.id);
        if (!old.length) return null;
        const e = old[Math.floor(_h(seedKey, p.id, 'story') * old.length) % old.length];
        const told = Townsfolk.annalText(folk, e, world, p);
        if (!told) return null;
        return TownFamily.line('story', p, { story: told }, `${seedKey}|${p.id}`);
    },

    /** Lines about family for the person's own telling (familyLines): [text] */
    familyTalk(folk, p, world) {
        const out = [];
        if (p.preg && !p.preg.aff) out.push(TownFamily.line('expectingOwn', p, { when: Townsfolk.when(p.preg.due, world) }, `${p.id}|own`));
        const sp = Townsfolk.get(folk, p.spouse);
        if (sp && sp.preg && !sp.preg.aff) out.push(`My ${Townsfolk.kinWord(sp, 'spouse')} is with child — due ${Townsfolk.when(sp.preg.due, world)}.`);
        const L = TownFamily.lineage(folk, p);
        const gk = L.grandkids.filter(k => k.died == null);
        if (gk.length) out.push(`I've ${gk.length === 1 ? 'a grandchild' : `${gk.length} grandchildren`}: ${gk.map(k => k.first).join(', ')}.`);
        if (L.wards.length) out.push(`We took in ${L.wards.map(k => k.first).join(' and ')} when ${L.wards.length === 1 ? 'they were' : 'they were'} left alone.`);
        if (p.ward != null) { const g = Townsfolk.get(folk, p.ward); if (g) out.push(`${g.first} ${g.last} took me in when my folk were gone.`); }
        return out.filter(Boolean);
    },

    /** A first-person line about one entry of a person's life (family), or null. */
    lifeText(folk, p, e, world) {
        const o = Townsfolk.get(folk, e.o);
        const when = Townsfolk.when(e.d, world);
        switch (e.k) {
            case 'expecting': return Number(e.x) > _num(world && world.day) ? `We're expecting a little one, ${Townsfolk.when(Number(e.x), world)}.` : null;
            case 'stillborn': return `We lost a babe at birth ${when}. We don't speak of it much.`;
            case 'midwife': return o ? `I brought ${o.first}'s babe into the world ${when}.` : null;
            case 'newHome': return o ? `${o.first} and I set up house together ${when}.` : null;
            case 'inherited': return o ? `When ${o.first} died ${when}, ${e.x || 'the house'} came to me.` : null;
            case 'takenIn': return o ? `${Townsfolk.name(o)} took me in ${when}, when I'd no one left.` : null;
            case 'tookIn': return o ? `We took in little ${o.first} ${when}. ${o.gender === 'female' ? 'She' : 'He'}'s one of ours now.` : null;
            case 'bornFatherless': return o ? `My father ${o.first} died before I was born.` : null;
            case 'godparent': return o ? `I stood godparent to little ${o.first} ${when}.` : null;
            default: return TownSchool.lifeText(folk, p, e, world);
        }
    },

    /** A third-person journal line (family), or null. */
    biographyLine(folk, p, e, world) {
        const o = Townsfolk.get(folk, e.o);
        const when = Townsfolk.when(e.d, world);
        switch (e.k) {
            case 'expecting': return `Expecting a child ${when}.`;
            case 'stillborn': return `Lost a babe at birth ${when}.`;
            case 'midwife': return o ? `Midwife to ${o.first} ${when}.` : null;
            case 'newHome': return o ? `Set up house with ${o.first} ${when}.` : null;
            case 'inherited': return o ? `Inherited ${e.x || 'the house'} from ${o.first} ${when}.` : null;
            case 'takenIn': return o ? `Orphaned; taken in by ${Townsfolk.name(o)} ${when}.` : null;
            case 'tookIn': return o ? `Took in the orphan ${o.first} ${when}.` : null;
            case 'bornFatherless': return o ? `Born after ${p.gender === 'female' ? 'her' : 'his'} father ${o.first} died.` : null;
            case 'godparent': return o ? `Godparent to ${Townsfolk.name(o)} ${when}.` : null;
            default: return TownSchool.biographyLine(folk, p, e, world);
        }
    },

    /** A town annal of family (inherited, tookIn), or null. */
    annalText(folk, entry, world, speaker = null) {
        if (entry.k === 'schoolFounded') return TownSchool.annalText(folk, entry, world);
        const a = Townsfolk.get(folk, entry.a);
        const b = Townsfolk.get(folk, entry.b);
        if (!a || !b) return null;
        const when = Townsfolk.when(entry.d, world);
        const A = Townsfolk._call(folk, a, speaker);
        const B = Townsfolk._call(folk, b, speaker);
        let t = null;
        if (entry.k === 'inherited') t = `${A} inherited ${entry.x || 'the house'} when ${B} died, ${when}.`;
        if (entry.k === 'tookIn') t = `${A} took in ${B === 'I' ? 'me' : B} ${when}, when the little one had no one left.`;
        if (entry.k === 'christened') {
            const gods = String(entry.x || '').split('|').filter(Boolean);
            t = `${a.first} was christened ${when}, ${B === 'I' ? 'my' : `${B}'s`} ${a.gender === 'female' ? 'daughter' : 'son'}${gods.length ? `; ${gods.join(' and ')} stood godparent${gods.length > 1 ? 's' : ''}` : ''}.`;
        }
        if (entry.k === 'adoptedAway') t = `Little ${a.first} had no one left here; ${entry.x || 'a couple of another town'} took ${a.gender === 'female' ? 'her' : 'him'} in, ${when}.`;
        if (entry.k === 'adoptedFrom') t = `${A} took in little ${b.first}, an orphan from ${entry.x || 'another town'}, ${when}.`;
        return t ? t.charAt(0).toUpperCase() + t.slice(1) : null;
    },

    isFamilyAnnal(k) { return ['inherited', 'tookIn', 'christened', 'adoptedAway', 'adoptedFrom', 'schoolFounded'].includes(k); },
};
