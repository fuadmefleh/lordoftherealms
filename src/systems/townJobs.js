// ============================================
// TOWN JOBS — every townsperson's occupation, and the work that is the town's output
// ============================================
// Each grown resident of a town with a roster (systems/townsfolk.js) holds an
// occupation that fits the town — farmer, smith, miller, baker, fisher by the
// water, miner in the hills, weaver, carpenter, servant, carter, the watch,
// the priest, a beggar, or out of work:
//
//   person.job = { id, rank: 'apprentice' | 'journeyman' | 'master', since,
//                  master?: person id (an apprentice's or a servant's),
//                  employer?: 'player', pk?, wage?, paid?   (in the player's service)
//                  hired?: { until, label }                 (at the player's commission) }
//
// The town fills its trades in the order of its plan (data/townJobs.json
// plan[type]) as far as it has grown people of a fitting role and the land
// for it; the plan is reckoned afresh from the people it has, so a smith who
// dies leaves the smith's place open (not dropped from the plan), and the
// town's iron goods fall until someone takes up the trade.
//
// The work IS the economy: `crew(settlement, world, day)` is what each trade's
// hands bring to the market's turn (SettlementMarket.processSettlement reads
// it as ctx.crew, from systems/marketDynamics.js): for each occupation, the
// weight of its hands (rank, years at it, injuries from brawls, the heart's
// mood — systems/romance.js workFactor —, hunger, a babe keeping them up, the
// cells, the player's commission) against the plan's count for it, as
// floor + (1 − floor) × min(cap, ratio) ^ elasticity on the goods and trades
// it works. A town at its plan's strength works as it always did (1).
//
// A season (Townsfolk._season calls `season`): masters take apprentices,
// apprentices become journeymen and journeymen masters, a widow keeps the
// shop, the jobless take up an empty trade or labour, a tradesman comes from
// elsewhere where none is left; wages are paid — the town's buyers (its
// purse) pay the masters for their goods, masters pay their journeymen and
// apprentices, households their servants, the town its watch, priest and day
// labourers — and everyone spends on bread and board back into the town's
// purse (Economy.payTown): coin moves, none is made. The poor eat plainer and
// in a dearth go hungry. It all runs off-screen, a season at a time, at the
// same rates whether the player is in town or not.
//
// The player: `describe` (asked "What's your work?"), `trades` (the town's
// Trades & Workers), `engage` (a commission takes a real worker from their
// post until it is done), `offerWork` / `dismiss` / `processDay` (the
// player's own servants, guards and hands, paid weekly from the player's
// purse to theirs).
//
// Deterministic: every roll is a hash of the world seed, the town, the day
// and the person; the shared RNG is never drawn. Old saves: `ensure` gives
// every grown resident an occupation on first sight. Data: data/townJobs.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Economy } from '../world/economy.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Townsfolk } from './townsfolk.js';
import { Romance } from './romance.js';
import { PracticeSkills } from './practiceSkills.js';
import { Ledger } from './ledger.js';
import { TownSchool } from './townSchool.js';
// (what they remember of the player's House: systems/npcMemory.js)
import { NpcMemory } from './npcMemory.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _arr = (v) => (Array.isArray(v) ? v : []);
const _r2 = (v) => Math.round(v * 100) / 100;

const FIXED_ROLES = new Set(['guard', 'priest', 'noble', 'beggar']);

let _cfg = null;
let _cfgSrc;
// Caches that must not travel with the save
const _crewCache = new WeakMap();
const _landCache = new WeakMap();

function _seedOf(world) {
    return (world && world.generationParams && world.generationParams.seed) || 1;
}

/** A deterministic stream for one town on one day (its own salt: never the townsfolk's own). */
function _rng(world, folk, day, salt = '') {
    let s = (Utils.hashStr(`${_seedOf(world)}|${folk.q},${folk.r}|${day}|jobs${salt}`) >>> 0) || 1;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

/** A single roll in [0, 1) from parts. */
function _roll(...parts) {
    let h = Utils.hashStr(parts.join('|')) >>> 0;
    // (well mixed: similar strings must not give similar rolls)
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0; h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

function _pick(list, u) {
    return list && list.length ? list[Math.floor(u * list.length) % list.length] : null;
}

function _fill(text, vars) {
    return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : ''));
}

function _article(word) { return /^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`; }
function _cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

export const TownJobs = {
    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.townJobs : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            _cfg = {
                enabled: d.enabled !== false && !!_obj(d.occupations),
                adultAge: 16, apprenticeAge: 12, refWeight: 0.92, capRatio: 1.3, skillYears: 12, idleShare: 0.25,
                ...d,
                occupations: _obj(d.occupations) || {},
                ranks: { apprentice: { weight: 0.45, wage: 0.25 }, journeyman: { weight: 0.85, wage: 0.7 }, master: { weight: 1, wage: 1 }, ...(_obj(d.ranks) || {}) },
                promotion: { journeymanYears: 3, journeymanAge: 17, masterYears: 5, masterAge: 23, masterChance: 0.35, apprenticeChance: 0.45, maxApprentices: 1, ...(_obj(d.promotion) || {}) },
                vacancy: { takeUpChance: 0.6, widowChance: 0.7, arrivalChance: 0.3, arrivalAfterDays: 60, quitChance: 0.04, ...(_obj(d.vacancy) || {}) },
                living: { perDay: 0.32, child: 0.12, poorBelow: 6, richAbove: 45, richSpend: 0.35, hungryBelow: 4, hungryWork: 0.8, tavernShare: 0.5, alms: 0.15, ...(_obj(d.living) || {}) },
                tired: { babyDays: 90, baby: 0.92, ...(_obj(d.tired) || {}) },
                plan: _obj(d.plan) || {},
                fallback: _obj(d.fallback) || {},
                lines: _obj(d.lines) || {},
                annals: _obj(d.annals) || {},
                hours: _obj(d.hours) || {},
                playerJobs: { kinds: {}, every: 7, accept: 0.55, joblessBonus: 0.35, masterAsk: 2, dispositionPer: 0.008, ...(_obj(d.playerJobs) || {}) },
            };
            // Which occupation works each good and each trade (the first to list it)
            _cfg.goodOcc = {};
            _cfg.recipeOcc = {};
            for (const [id, o] of Object.entries(_cfg.occupations)) {
                for (const g of _arr(o.goods)) if (!_cfg.goodOcc[g]) _cfg.goodOcc[g] = id;
                for (const r of _arr(o.recipes)) if (!_cfg.recipeOcc[r]) _cfg.recipeOcc[r] = id;
            }
        }
        return _cfg;
    },

    enabled() {
        const C = TownJobs.config();
        return !!C.enabled && Townsfolk.config().enabled !== false;
    },

    occ(id) {
        return TownJobs.config().occupations[id] || null;
    },

    /** The occupation that works a good, or a market trade (recipe id), or null. */
    occOfGood(goodId) { return TownJobs.config().goodOcc[goodId] || null; },
    occOfRecipe(recipeId) { return TownJobs.config().recipeOcc[recipeId] || null; },

    // ── Who does what ─────────────────────────────────────

    _adult(p, day) {
        return Townsfolk.isHere(p) && Townsfolk.age(p, day) >= TownJobs.config().adultAge && p.role !== 'child';
    },

    /** The land about the town: { water, hills, pasture, forest } (unknown land allows the plain trades). */
    land(folk, settlement, world) {
        const hit = _landCache.get(folk);
        if (hit && hit.world === world) return hit.land;
        let land = { water: false, hills: false, pasture: true, forest: true };
        try {
            if (world && typeof world.getTile === 'function') {
                const prof = SettlementMarket.landProfile(world, folk.q, folk.r);
                const sh = prof.shares || {};
                land = {
                    water: _num(sh.water) > 0.05 || !!prof.river || PracticeSkills.coastalAt(world, folk.q, folk.r),
                    hills: _num(sh.upland) > 0.12 || PracticeSkills.mountainAt(world, folk.q, folk.r),
                    pasture: _num(sh.pasture) > 0.05 || _num(sh.upland) > 0.2,
                    forest: true,
                };
            }
        } catch (e) { /* a mock world: the plain trades */ }
        _landCache.set(folk, { world, land });
        return land;
    },

    /**
     * The town's plan: how many of each occupation it keeps, from the grown
     * people it has (their roles) and its land → { occId: count }. Guards,
     * priests, nobles and beggars hold their own and are not planned.
     */
    plan(folk, settlement, world, day) {
        const C = TownJobs.config();
        const type = settlement && C.plan[settlement.type] ? settlement.type : 'village';
        const order = _arr(C.plan[type]);
        const land = TownJobs.land(folk, settlement, world);
        const pool = {};
        for (const p of folk.people) {
            if (!TownJobs._adult(p, day) || p.retired || FIXED_ROLES.has(p.role)) continue;
            if (p.job && p.job.employer === 'player') continue;
            pool[p.role] = (pool[p.role] || 0) + 1;
        }
        const out = {};
        for (const id of order) {
            const o = C.occupations[id];
            if (!o || (o.land && !land[o.land])) continue;
            const role = _arr(o.roles).find(r => pool[r] > 0);
            if (!role) continue;
            pool[role]--;
            out[id] = (out[id] || 0) + 1;
        }
        return out;
    },

    /** Holders of each occupation now (not the player's own, not the dead or gone) → { occId: [person] }. */
    holders(folk, day) {
        const out = {};
        for (const p of folk.people) {
            if (!p.job || !Townsfolk.isHere(p) || p.job.employer === 'player') continue;
            if (Townsfolk.age(p, day) < TownJobs.config().apprenticeAge) continue;
            (out[p.job.id] || (out[p.job.id] = [])).push(p);
        }
        return out;
    },

    /** The rank a person new to a trade starts at, by their age. */
    _rankFor(age, u) {
        const P = TownJobs.config().promotion;
        if (age < _num(P.journeymanAge, 17) + 1) return 'apprentice';
        if (age < _num(P.masterAge, 23) || (age < 30 && u < 0.4)) return 'journeyman';
        return 'master';
    },

    /** A trade this person already practises (their craft or trade by the practised skills): woodcutter, miner, fisher. */
    _hint(folk, p, world, day) {
        try {
            const who = Townsfolk.skillWho(folk, p, day, PracticeSkills.coastalAt(world, folk.q, folk.r), PracticeSkills.mountainAt(world, folk.q, folk.r));
            const craft = PracticeSkills.craftOf(who);
            if (craft === 'woodcutter' || craft === 'miner') return craft;
            if (craft === 'herbalist') return 'healer';
            if (PracticeSkills.tradeOf(who) === 'fisher') return 'fisher';
        } catch (e) { /* no world */ }
        return null;
    },

    /**
     * Every grown resident has an occupation (an old save's on first sight,
     * a newcomer's or the newly grown the season they appear). → folk.
     */
    ensure(folk, settlement, world, day = null) {
        if (!folk || !Array.isArray(folk.people) || !TownJobs.enabled()) return folk;
        const C = TownJobs.config();
        const d = day != null ? day : _num(world && world.day, 1);
        const Y = Townsfolk.config().daysPerYear;
        const todo = folk.people.filter(p => TownJobs._adult(p, d) && !p.retired && !(p.job && C.occupations[p.job.id]));
        if (!todo.length) return folk;
        const plan = TownJobs.plan(folk, settlement, world, d);
        const held = TownJobs.holders(folk, d);
        const room = (id) => _num(plan[id]) - (held[id] ? held[id].length : 0);
        const order = _arr(C.plan[settlement && C.plan[settlement.type] ? settlement.type : 'village']);
        const land = TownJobs.land(folk, settlement, world);
        // (the particular roles first — the smith's own place to the smith — the townsmen, who can take anything, last)
        for (const p of todo.sort((a, b) => (a.role === 'villager') - (b.role === 'villager') || a.id - b.id)) {
            const age = Townsfolk.age(p, d);
            let id = null;
            if (FIXED_ROLES.has(p.role)) id = C.fallback[p.role] || p.role;
            if (!id) {
                const hint = TownJobs._hint(folk, p, world, d);
                const ho = hint && C.occupations[hint];
                if (ho && _arr(ho.roles).includes(p.role) && (!ho.land || land[ho.land]) && room(hint) > 0) id = hint;
            }
            if (!id) id = order.find(o => room(o) > 0 && C.occupations[o] && _arr(C.occupations[o].roles).includes(p.role)) || null;
            if (!id) {
                id = C.fallback[p.role] || 'labourer';
                // (some of the spare hands find no work at all)
                if (id === 'labourer' && _roll(_seedOf(world), folk.q, folk.r, p.id, 'idle') < _num(C.idleShare)) id = 'unemployed';
            }
            if (!C.occupations[id]) id = 'labourer';
            const rank = ['labourer', 'unemployed', 'beggar', 'noble', 'guard', 'priest'].includes(id) ? 'master'
                : TownJobs._rankFor(age, _roll(_seedOf(world), folk.q, folk.r, p.id, 'rank'));
            const years = rank === 'master' ? Math.min(age - 16, 6 + Math.floor(_roll(_seedOf(world), p.id, 'yrs') * 18)) : rank === 'journeyman' ? Math.min(age - 14, 4) : 1;
            p.job = { id, rank, since: d - Math.max(0, years) * Y };
            (held[id] || (held[id] = [])).push(p);
        }
        // Apprentices and serving folk answer to someone
        for (const p of folk.people) TownJobs._attachMaster(folk, p, d);
        return folk;
    },

    /** An apprentice's master (a master of the trade); a servant's household; the serving staff's innkeeper. */
    _attachMaster(folk, p, day) {
        const j = p.job;
        if (!j || !Townsfolk.isHere(p) || j.employer === 'player') return;
        const cur = j.master != null ? Townsfolk.get(folk, j.master) : null;
        if (cur && Townsfolk.isHere(cur)) return;
        delete j.master;
        const o = TownJobs.occ(j.id);
        let want = null;
        if (j.rank === 'apprentice') want = q => q.job && q.job.id === j.id && q.job.rank === 'master';
        else if (o && o.employer) want = q => q.job && q.job.id === o.employer;
        if (!want) return;
        const m = folk.people.find(q => q !== p && Townsfolk.isHere(q) && want(q));
        if (m) j.master = m.id;
    },

    // ── The work as output ────────────────────────────────

    /** How much work a person puts in today, 0..~1.2. */
    weight(folk, p, day) {
        const C = TownJobs.config();
        const j = p && p.job;
        if (!j || !Townsfolk.isHere(p) || j.employer === 'player') return 0;
        if (j.hired && _num(j.hired.until) > day) return 0;
        if (p.jailedUntil != null && day < p.jailedUntil) return 0;
        const R = C.ranks[j.rank] || C.ranks.master;
        const Y = Townsfolk.config().daysPerYear;
        const years = Math.max(0, (day - _num(j.since, day)) / Y);
        let w = _num(R.weight, 1) * (0.9 + 0.2 * Math.min(1, years / Math.max(1, _num(C.skillYears, 12))));
        const hurt = Townsfolk.injury(p, day);
        if (hurt) w *= Math.max(0.2, hurt.hp / hurt.max);
        try { w *= Romance.workFactor(folk, p, day); } catch (e) { /* no courtships */ }
        if (p.hungry != null && day - p.hungry < Townsfolk.config().tickDays) w *= _num(C.living.hungryWork, 0.8);
        // (a babe in the house keeps them up at night)
        const T = C.tired;
        if (_arr(p.kids).some(id => { const k = Townsfolk.get(folk, id); return k && k.died == null && day - k.born < _num(T.babyDays, 90); })) w *= _num(T.baby, 0.92);
        // (sore from a fight the day of it and the next, and worse for one fought late: systems/brawls.js)
        w *= TownJobs.brawlFactor(p, day);
        return w;
    },

    /** A fight's toll on the next day's work: 1, or less for one who fought (and fought late). */
    brawlFactor(p, day) {
        const T = TownJobs.config().tired;
        const b = p && p.brawled;
        if (!b || !Number.isFinite(b.d)) return 1;
        const since = _num(day) - b.d;
        if (since < 0 || since > _num(T.brawlDays, 1)) return 1;
        return _num(T.brawl, 0.9) * (b.late ? _num(T.late, 0.88) : 1);
    },

    /** Was a fight at this hour a late one (up past bedtime)? */
    lateHour(hour) {
        const T = TownJobs.config().tired;
        const h = ((_num(hour, 12) % 24) + 24) % 24;
        return h >= _num(T.lateFrom, 21) || h < _num(T.lateTo, 5);
    },

    /**
     * What the town's hands bring to the market's turn: { g: { goodId: factor },
     * r: { recipeId: factor }, occ: { occId: { factor, staff, planned } } },
     * or null for a town without a roster (its work is reckoned as before).
     */
    crew(settlement, world, day = null) {
        const folk = settlement && settlement.folk;
        if (!_obj(folk) || !Array.isArray(folk.people) || !TownJobs.enabled()) return null;
        const d = day != null ? day : _num(world && world.day, 1);
        const hit = _crewCache.get(folk);
        if (hit && hit.day === d && hit.n === folk.people.length) return hit.crew;
        TownJobs.ensure(folk, settlement, world, d);
        const C = TownJobs.config();
        const plan = TownJobs.plan(folk, settlement, world, d);
        const staff = {};
        for (const p of folk.people) {
            if (!p.job) continue;
            const w = TownJobs.weight(folk, p, d);
            if (!(w > 0)) continue;
            staff[p.job.id] = (staff[p.job.id] || 0) + w;
            const o = C.occupations[p.job.id];
            if (o && o.assists) staff[o.assists] = (staff[o.assists] || 0) + w * _num(o.assistWeight, 0.3);
        }
        const crew = { g: {}, r: {}, occ: {} };
        for (const [id, o] of Object.entries(C.occupations)) {
            const planned = _num(plan[id]);
            if (!planned || (!_arr(o.goods).length && !_arr(o.recipes).length)) continue;
            const ratio = Math.min(_num(C.capRatio, 1.3), _num(staff[id]) / (planned * _num(C.refWeight, 0.92)));
            const floor = Math.max(0, Math.min(1, _num(o.floor, 0.5)));
            const f = floor + (1 - floor) * Math.pow(Math.max(0, ratio), _num(o.elasticity, 0.5));
            crew.occ[id] = { factor: _r2(f), staff: _r2(_num(staff[id])), planned };
            for (const g of _arr(o.goods)) if (C.goodOcc[g] === id) crew.g[g] = f;
            for (const r of _arr(o.recipes)) if (C.recipeOcc[r] === id) crew.r[r] = f;
        }
        _crewCache.set(folk, { day: d, n: folk.people.length, crew });
        return crew;
    },

    // ── A season of working lives ─────────────────────────

    /** Townsfolk._season's hook: apprentices, promotions, the empty trades filled, wages and board. */
    season(world, settlement, folk, day, news = [], player = null) {
        if (!TownJobs.enabled() || !folk) return;
        const C = TownJobs.config();
        const Y = Townsfolk.config().daysPerYear;
        const rng = _rng(world, folk, day);
        const note = (kind, a, b, x) => Townsfolk._annal(folk, world, day, { k: 'job', a: a ? a.id : null, b: b ? b.id : null, x: `${kind}|${x || ''}` }, news);
        TownJobs.ensure(folk, settlement, world, day);
        const P = C.promotion;

        // Apprentices grow into journeymen, journeymen into masters
        for (const p of Townsfolk.residents(folk)) {
            const j = p.job;
            if (!j || j.employer === 'player') continue;
            const age = Townsfolk.age(p, day);
            const yrs = (day - _num(j.since, day)) / Y;
            if (j.rank === 'apprentice' && age >= _num(P.journeymanAge, 17) && yrs >= _num(P.journeymanYears, 3)) {
                j.rank = 'journeyman';
                j.since = day;
                Townsfolk._log(p, day, 'job', null, `journeyman|${j.id}`);
                note('journeyman', p, null, j.id);
            } else if (j.rank === 'journeyman' && age >= _num(P.masterAge, 23) && yrs >= _num(P.masterYears, 5) && rng() < _num(P.masterChance, 0.35)) {
                j.rank = 'master';
                Townsfolk._log(p, day, 'job', null, `master|${j.id}`);
                note('master', p, null, j.id);
            }
        }

        // Masters take apprentices: their own children first, then others' (12 and up)
        const masters = Townsfolk.residents(folk).filter(p => p.job && p.job.rank === 'master' && p.job.employer !== 'player' && (_arr(TownJobs.occ(p.job.id) && TownJobs.occ(p.job.id).goods).length || _arr(TownJobs.occ(p.job.id) && TownJobs.occ(p.job.id).recipes).length));
        const youths = Townsfolk.residents(folk).filter(p => !p.job && p.role === 'child' && Townsfolk.age(p, day) >= C.apprenticeAge);
        for (const m of masters) {
            const has = folk.people.filter(q => Townsfolk.isHere(q) && q.job && q.job.master === m.id && q.job.rank === 'apprentice').length;
            if (has >= _num(P.maxApprentices, 1) || rng() >= _num(P.apprenticeChance, 0.45)) continue;
            const own = youths.find(y => !y.job && y.parents.includes(m.id));
            const y = own || youths.find(q => !q.job && !q.parents.some(pid => { const par = Townsfolk.get(folk, pid); return par && par.job && par.job.rank === 'master' && TownJobs.occ(par.job.id) && _arr(TownJobs.occ(par.job.id).goods).length; }));
            if (!y) continue;
            y.job = { id: m.job.id, rank: 'apprentice', since: day, master: m.id };
            Townsfolk._log(y, day, 'job', m.id, `apprenticed|${m.job.id}`);
            note('apprenticed', y, m, m.job.id);
        }

        // Grown apprentices take the role their trade wants (a smith's boy grows up a smith)
        for (const p of Townsfolk.residents(folk)) TownJobs._attachMaster(folk, p, day);

        // The empty places: a widow keeps the shop, the jobless take it up, someone comes from elsewhere
        const plan = TownJobs.plan(folk, settlement, world, day);
        const held = TownJobs.holders(folk, day);
        const V = C.vacancy;
        const order = Object.keys(plan);
        for (const id of order) {
            const o = C.occupations[id];
            let gap = _num(plan[id]) - (held[id] || []).filter(p => p.job.rank !== 'apprentice').length;
            if (gap <= 0) continue;
            // (an apprentice of the trade steps up early)
            const app = (held[id] || []).find(p => p.job.rank === 'apprentice' && Townsfolk.age(p, day) >= C.adultAge);
            if (app && gap > 0) {
                app.job.rank = 'journeyman';
                app.job.since = day;
                delete app.job.master;
                Townsfolk._log(app, day, 'job', null, `journeyman|${id}`);
                note('journeyman', app, null, id);
                gap--;
            }
            // (the widow or widower of one who died at it keeps the shop)
            const lately = folk.people.filter(p => p.died != null && day - p.died <= Townsfolk.config().tickDays && p.job && p.job.id === id);
            for (const late of lately) {
                if (gap <= 0) break;
                const sp = Townsfolk.get(folk, late.spouse);
                if (!sp || !Townsfolk.isHere(sp) || !sp.job || !_arr(o.roles).includes(sp.role)) continue;
                if (!['labourer', 'unemployed', 'washer'].includes(sp.job.id) || rng() >= _num(V.widowChance, 0.7)) continue;
                sp.job = { id, rank: 'journeyman', since: day };
                Townsfolk._log(sp, day, 'job', late.id, `widow|${id}`);
                note('widow', sp, late, id);
                gap--;
            }
            // (the jobless and the day labourers take it up)
            const spare = Townsfolk.residents(folk).filter(p => p.job && ['unemployed', 'labourer'].includes(p.job.id) && p.job.employer !== 'player'
                && _arr(o.roles).includes(p.role) && TownJobs._adult(p, day)).sort((a, b) => (a.job.id === 'unemployed' ? 0 : 1) - (b.job.id === 'unemployed' ? 0 : 1) || a.id - b.id);
            for (const p of spare) {
                if (gap <= 0) break;
                if (rng() >= _num(V.takeUpChance, 0.6)) continue;
                p.job = { id, rank: Townsfolk.age(p, day) < 22 ? 'apprentice' : 'journeyman', since: day };
                Townsfolk._log(p, day, 'job', null, `tookUp|${id}`);
                note('tookUp', p, null, id);
                gap--;
            }
            // (none to take it: a tradesman comes from elsewhere, once it has stood empty a while)
            if (gap > 0 && (_arr(o.goods).length || _arr(o.recipes).length)) {
                folk.vacant = folk.vacant || {};
                if (folk.vacant[id] == null) folk.vacant[id] = day;
                if (day - folk.vacant[id] >= _num(V.arrivalAfterDays, 60) && rng() < _num(V.arrivalChance, 0.3)) {
                    const n = Townsfolk._newcomer(folk, day, rng, { age: 24 + Math.floor(rng() * 16), from: 'elsewhere', role: o.role || _arr(o.roles)[0] || 'villager' });
                    n.job = { id, rank: 'master', since: day - Y * (3 + Math.floor(rng() * 8)) };
                    note('arrived', n, null, id);
                    delete folk.vacant[id];
                }
            } else if (folk.vacant) delete folk.vacant[id];
        }
        // The jobless find labour now and then (and a labourer is let go in a bad year)
        for (const p of Townsfolk.residents(folk)) {
            if (!p.job || p.job.employer === 'player') continue;
            if (p.job.id === 'unemployed' && rng() < 0.25) {
                p.job = { id: 'labourer', rank: 'master', since: day };
            } else if (p.job.id === 'labourer' && rng() < _num(V.quitChance, 0.04)) {
                p.job = { id: 'unemployed', rank: 'master', since: day };
                Townsfolk._log(p, day, 'job', null, 'jobless|labourer');
            }
            // (the player's commission done: back at their own work)
            if (p.job.hired && _num(p.job.hired.until) <= day) delete p.job.hired;
        }
        TownJobs.payday(world, settlement, folk, day, Townsfolk.config().tickDays);
    },

    /**
     * `days` of wages and board, in coin: the town's buyers pay the masters
     * for their goods (the town's purse), masters pay their hands, households
     * their servants, the town its watch and labourers; then everyone pays for
     * bread and board, back into the town's purse. The poor eat plainer, and
     * in a dearth the poorest go hungry. Moves coin only — never makes it.
     */
    payday(world, settlement, folk, day, days = 30) {
        if (!settlement || settlement.inKind || Economy.townPurse(settlement) == null) return;
        const C = TownJobs.config();
        const L = C.living;
        const type = settlement.type || 'village';
        const typeMult = { village: 0.8, town: 1, city: 1.15, capital: 1.3 }[type] || 1;
        const purse = (p) => Townsfolk.purse(folk, p, world);
        const give = (p, n) => { p.purse = _r2(purse(p) + n); };
        const take = (p, n) => { const have = purse(p); const paid = _r2(Math.min(have, Math.max(0, n))); p.purse = _r2(have - paid); return paid; };
        // (to the penny, so rounding makes no coin)
        const draw = (n) => Economy.drawTown(settlement, _r2(n));
        const people = Townsfolk.residents(folk);
        // Wages
        for (const p of people) {
            const j = p.job;
            if (!j || j.employer === 'player' || (j.hired && _num(j.hired.until) > day)) continue;
            const o = TownJobs.occ(j.id);
            if (!o || !(o.wage > 0) || o.pay === 'none') continue;
            const rank = C.ranks[j.rank] || C.ranks.master;
            const due = _num(o.wage) * _num(rank.wage, 1) * typeMult * days * Math.min(1.1, TownJobs.weight(folk, p, day) || 0.5);
            let paid = 0;
            const boss = j.master != null ? Townsfolk.get(folk, j.master) : null;
            if ((j.rank !== 'master' || o.pay === 'employer') && boss && Townsfolk.isHere(boss)) {
                paid = take(boss, due);
                // (the master is paid for the work by the buyers)
                if (j.rank !== 'master') give(boss, draw(due * 0.9));
            } else {
                paid = draw(due);
            }
            if (paid > 0) give(p, paid);
        }
        // Alms for the beggars, from the faithful
        for (const p of people) {
            if (p.job && p.job.id === 'beggar') give(p, draw(_num(L.alms) * days));
        }
        // Board: bread and the rest, back to the town (a child's paid by its parents)
        const dearth = (() => { try { return SettlementMarket.inDearth(settlement); } catch (e) { return false; } })();
        for (const p of people) {
            const age = Townsfolk.age(p, day);
            if (age < C.adultAge) continue;
            const have = purse(p);
            const kids = _arr(p.kids).map(id => Townsfolk.get(folk, id)).filter(k => k && Townsfolk.isHere(k) && Townsfolk.age(k, day) < C.adultAge && k.parents[0] === p.id).length;
            let want = (_num(L.perDay) + kids * _num(L.child)) * days;
            if (have < _num(L.poorBelow)) want *= 0.6;   // (plainer fare: pottage and bread)
            if (p.shopped) { want = Math.max(0, want - p.shopped); delete p.shopped; }   // (what they already paid the stalls this season: systems/townTrade.js)
            const paid = take(p, want);
            Economy.payTown(settlement, paid);
            // (the well-off spend what's over on fine things: meat, wine, cloth)
            const over = purse(p) - _num(L.richAbove, 45);
            if (over > 0) Economy.payTown(settlement, take(p, over * _num(L.richSpend, 0.35)));
            if (dearth && purse(p) < _num(L.hungryBelow, 4)) p.hungry = day;
            else if (p.hungry != null && day - p.hungry >= Townsfolk.config().tickDays) delete p.hungry;
            p.diet = purse(p) < _num(L.poorBelow) ? 'poor' : purse(p) > _num(L.richAbove) ? 'rich' : 'plain';
        }
    },

    // ── The player ────────────────────────────────────────

    /** The person who would take on a commission of this trade in this town (best hand free), or null. */
    workerFor(folk, day, offer) {
        if (!folk || !offer) return null;
        const C = TownJobs.config();
        let id = offer.kind === 'trade' ? C.recipeOcc[offer.recipeId] : null;
        if (!id && offer.kind === 'craft') {
            const st = { arms: 'smith', smelt: 'smith', craft: 'carpenter', tan: 'cobbler', cook: 'innkeeper', brew: 'healer' };
            id = st[offer.station] || null;
            if (!id) {
                const recipes = (DataLoader._gamedata && DataLoader._gamedata.crafting && DataLoader._gamedata.crafting.recipes) || [];
                const r = recipes.find(x => x.id === offer.recipeId);
                id = r ? st[r.station] || null : null;
            }
        }
        if (!id) return null;
        const list = folk.people.filter(p => Townsfolk.isHere(p) && p.job && p.job.id === id && p.job.employer !== 'player' && !(p.job.hired && _num(p.job.hired.until) > day) && p.job.rank !== 'apprentice');
        list.sort((a, b) => TownJobs.weight(folk, b, day) - TownJobs.weight(folk, a, day) || a.id - b.id);
        return list[0] || null;
    },

    /** A commission taken (systems/commissions.js): the worker is at it, away from the town's own work, until it's done. → the person, or null. */
    engage(world, settlement, offer, untilDay, label = '') {
        const folk = settlement && settlement.folk;
        if (!_obj(folk) || !TownJobs.enabled()) return null;
        const day = _num(world && world.day, 1);
        TownJobs.ensure(folk, settlement, world, day);
        const p = TownJobs.workerFor(folk, day, offer);
        if (!p) return null;
        p.job.hired = { until: Math.max(day + 1, _num(untilDay, day + 1)), label: label || (offer && offer.label) || 'your order' };
        _crewCache.delete(folk);
        return p;
    },

    /** Would this person take the player's offer of work? → { chance, wage, kind, refuse? } */
    offerTerms(player, world, folk, p, kind) {
        const C = TownJobs.config().playerJobs;
        const K = _obj(C.kinds) && C.kinds[kind];
        if (!K || !p || !Townsfolk.isHere(p)) return null;
        const j = p.job || {};
        if (j.employer === 'player') return { kind, wage: _num(j.wage), chance: 0, refuse: 'Already in your service.' };
        if (['noble', 'priest'].includes(j.id) || p.role === 'noble') return { kind, wage: K.wage, chance: 0, refuse: 'Not one to take service.' };
        const day = _num(world && world.day, 1);
        if (Townsfolk.age(p, day) < TownJobs.config().adultAge) return { kind, wage: K.wage, chance: 0, refuse: 'Too young.' };
        // A clerk's desk wants their letters (systems/townSchool.js: schooled literacy, 0–100)
        if (_num(K.minLiteracy) > 0 && _num(TownSchool.schooling(p).literacy) < _num(K.minLiteracy)) return { kind, wage: K.wage, chance: 0, refuse: 'Cannot read or write.' };
        const master = j.rank === 'master' && TownJobs.occ(j.id) && (_arr(TownJobs.occ(j.id).goods).length || _arr(TownJobs.occ(j.id).recipes).length);
        const wage = Math.round(_num(K.wage) * (master ? _num(C.masterAsk, 2) : 1));
        const disp = p.mem ? _num(p.mem.disposition, 50) : 50;
        // Long memory: the House that wronged their family is refused; one that did them good is served gladly
        const mt = NpcMemory.workTerms(world, { folk, person: p }, player);
        if (mt.refuse) return { kind, wage: K.wage, chance: 0, refuse: mt.refuse };
        let chance = _num(C.accept, 0.55) + (disp - 50) * _num(C.dispositionPer, 0.008) + mt.chanceShift;
        if (['unemployed', 'beggar', 'labourer'].includes(j.id)) chance += _num(C.joblessBonus, 0.35);
        if (master) chance -= 0.25;
        return { kind, wage, chance: Math.max(0.02, Math.min(0.97, chance)) };
    },

    /** Offer a townsperson work in the player's service. → { ok, text } */
    offerWork(player, world, settlement, p, kind) {
        const folk = settlement && settlement.folk;
        const T = folk && TownJobs.offerTerms(player, world, folk, p, kind);
        if (!T) return { ok: false, text: 'There is no such work to offer.' };
        if (T.refuse) return { ok: false, text: T.refuse };
        const day = _num(world.day, 1);
        if (_num(player.gold) < T.wage) return { ok: false, text: `You can't pay the first week's ${T.wage} gold.` };
        const u = _roll(_seedOf(world), folk.q, folk.r, p.id, day, kind, 'offer');
        if (u >= T.chance) {
            p.job.asked = day;
            return { ok: false, text: _pick(['I thank you, but no. I\'ll keep to my own work.', 'Not for that wage, I won\'t.', 'Kind of you. But no.'], u) };
        }
        const K = TownJobs.config().playerJobs.kinds[kind];
        const prev = p.job ? p.job.id : 'labourer';
        // The first week paid in hand, from the player's purse to theirs
        player.gold = _r2(_num(player.gold) - T.wage);
        Ledger.record(player, 'householdWages', -T.wage);
        Townsfolk.purse(folk, p, world);
        p.purse = _r2(_num(p.purse) + T.wage);
        p.job = { id: (K.job && TownJobs.occ(K.job) ? K.job : null) || (kind === 'guard' ? 'guard' : kind === 'servant' ? 'servant' : 'labourer'), rank: 'master', since: day, employer: 'player', pk: kind, wage: T.wage, paid: day, prev };
        Townsfolk._log(p, day, 'job', null, `hiredPlayer|${K.name}`);
        Townsfolk._annal(folk, world, day, { k: 'job', a: p.id, b: null, x: `hiredPlayer|${player.name || 'a stranger'}` }, []);
        NpcMemory.remember(world, { folk, person: p }, { kind: 'hired', player });
        _crewCache.delete(folk);
        return { ok: true, text: _pick([`Gladly! I'll start at once. ${T.wage} gold a week, then.`, `You've got yourself ${_article(K.name)}. I'll not let you down.`], u), wage: T.wage };
    },

    /** Let one of the player's people go: back to look for work in town. */
    dismiss(world, folk, p, why = 'dismissed', player = null) {
        if (!p || !p.job || p.job.employer !== 'player') return false;
        const day = _num(world && world.day, 1);
        // Turned out, or left unpaid: remembered (systems/npcMemory.js)
        if (player) NpcMemory.remember(world, { folk, person: p }, { kind: why === 'unpaid' ? 'wages_unpaid' : 'dismissed', player });
        const prev = p.job.prev;
        const back = prev && TownJobs.occ(prev) && !['servant', 'guard'].includes(prev) ? prev : 'unemployed';
        p.job = { id: back, rank: back === 'unemployed' ? 'master' : 'journeyman', since: day };
        Townsfolk._log(p, day, 'job', null, `leftPlayer|${why}`);
        Townsfolk._annal(folk, world, day, { k: 'job', a: p.id, b: null, x: `leftPlayer|${why}` }, []);
        _crewCache.delete(folk);
        return true;
    },

    /** The player's people in every town: [{ person, folk, town }]. */
    playerStaff(world) {
        const out = [];
        const views = world && typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        for (const s of views) {
            const folk = s && s.folk;
            if (!folk || !Array.isArray(folk.people)) continue;
            for (const p of folk.people) if (p.job && p.job.employer === 'player' && Townsfolk.isHere(p)) out.push({ person: p, folk, town: s.name, settlement: s });
        }
        return out;
    },

    /** The daily hook: the player's people paid weekly, from the player's purse to theirs; unpaid, they leave. → notes */
    processDay(world, player) {
        if (!world || !player || !TownJobs.enabled()) return [];
        const C = TownJobs.config().playerJobs;
        const every = Math.max(1, _num(C.every, 7));
        const day = _num(world.day, 1);
        const notes = [];
        for (const { person: p, folk, town } of TownJobs.playerStaff(world)) {
            if (day - _num(p.job.paid, day) < every) continue;
            const w = _num(p.job.wage);
            if (_num(player.gold) < w) {
                TownJobs.dismiss(world, folk, p, 'unpaid', player);
                notes.push(`${Townsfolk.name(p)} has left your service in ${town}: unpaid.`);
                continue;
            }
            player.gold = _r2(_num(player.gold) - w);
            Ledger.record(player, 'householdWages', -w);
            Townsfolk.purse(folk, p, world);
            p.purse = _r2(_num(p.purse) + w);
            p.job.paid = day;
        }
        return notes;
    },

    // ── Words ─────────────────────────────────────────────

    /** What an occupation is called, for a man or a woman (and the rank). */
    title(p) {
        const j = p && p.job;
        const o = j && TownJobs.occ(j.id);
        if (!o) return null;
        if (j.employer === 'player') {
            const K = TownJobs.config().playerJobs.kinds[j.pk];
            return K ? `your ${K.name}` : 'in your service';
        }
        const name = p.gender === 'female' && o.female ? o.female : o.name;
        if (j.rank === 'apprentice') return `apprentice ${name}`;
        if (j.rank === 'journeyman' && (_arr(o.goods).length || _arr(o.recipes).length)) return `journeyman ${name}`;
        return name;
    },

    /** Their answer to "What's your work?", in character. */
    describe(folk, p, world, ctx = {}) {
        const C = TownJobs.config();
        const day = _num(world && world.day, 1);
        if (!p || !folk) return null;
        if (TownJobs._adult(p, day) && !p.retired) TownJobs.ensure(folk, ctx.settlement || null, world, day);
        const j = p.job;
        const L = C.lines;
        const u = _roll(_seedOf(world), p.id, day, 'say');
        if (p.retired) return `I was ${_article(Townsfolk.title(p.retired, p.gender))}, till my bones said no more. Now I sit in the sun.`;
        if (!j) return Townsfolk.age(p, day) < C.apprenticeAge ? 'Work? I\'m only little!' : 'I help about the house. Mother says I\'ll be apprenticed soon.';
        const o = TownJobs.occ(j.id);
        if (!o) return null;
        const Y = Townsfolk.config().daysPerYear;
        const years = Math.max(1, Math.round((day - _num(j.since, day)) / Y));
        const boss = j.master != null ? Townsfolk.get(folk, j.master) : null;
        const vars = { place: ctx.place || 'tavern', town: ctx.town || 'this town', years, master: boss ? Townsfolk.name(boss) : 'my master', since: Townsfolk.when(_num(j.since, day), world).replace(/^in /, ''), trade: o.name };
        const parts = [];
        if (j.employer === 'player') parts.push(_fill(L.playerServant, { wage: `${_num(j.wage)} gold` }));
        else if (j.rank === 'apprentice') parts.push(_fill(L.apprentice, { ...vars, left: _pick(_arr(L.apprenticeLeft), u) || '' }));
        else {
            let line = _fill(_pick(_arr(o.say), u) || `I'm ${_article(o.name)}.`, { ...vars, years: '' }).trim();
            if (j.rank === 'journeyman' && (_arr(o.goods).length || _arr(o.recipes).length)) line = _fill(L.journeyman, { trade: o.name, under: boss ? `, working for ${Townsfolk.name(boss)}` : '' }) + ' ' + line;
            else if (j.rank === 'master' && years >= 3 && (_arr(o.goods).length || _arr(o.recipes).length)) line += _fill(L.master, vars);
            parts.push(line.replace(/\s+/g, ' ').trim());
        }
        if (j.hired && _num(j.hired.until) > day) parts.push(_fill(L.hired, { label: j.hired.label || 'your order', day: j.hired.until }));
        const hurt = Townsfolk.injury(p, day);
        if (hurt && hurt.hp / hurt.max < 0.7) parts.push(L.hurt);
        let mood = 1;
        try { mood = Romance.workFactor(folk, p, day); } catch (e) { mood = 1; }
        if (mood > 1) parts.push(L.love);
        else if (mood < 1) parts.push(L.broken);
        if (p.hungry != null && day - p.hungry < Townsfolk.config().tickDays) parts.push(L.hungry);
        if (TownJobs.brawlFactor(p, day) < 1) parts.push(p.brawled.late ? L.late : L.sore);
        return parts.filter(Boolean).join(' ');
    },

    /** The town's trades and who works them, for the Trades & Workers panel. */
    trades(settlement, world, day = null) {
        const folk = settlement && settlement.folk;
        if (!_obj(folk) || !Array.isArray(folk.people) || !TownJobs.enabled()) return null;
        const d = day != null ? day : _num(world && world.day, 1);
        TownJobs.ensure(folk, settlement, world, d);
        const C = TownJobs.config();
        const plan = TownJobs.plan(folk, settlement, world, d);
        const crew = TownJobs.crew(settlement, world, d) || { occ: {} };
        const rows = {};
        for (const p of folk.people) {
            if (!p.job || !Townsfolk.isHere(p)) continue;
            const id = p.job.employer === 'player' ? '_player' : p.job.id;
            const row = rows[id] || (rows[id] = { id, workers: [] });
            const hurt = Townsfolk.injury(p, d);
            const state = p.job.hired && _num(p.job.hired.until) > d ? 'at your order'
                : (p.jailedUntil != null && d < p.jailedUntil) ? 'in the cells'
                    : hurt ? 'hurt' : (p.hungry != null && d - p.hungry < 30) ? 'hungry' : TownJobs.brawlFactor(p, d) < 1 ? 'sore from a fight' : null;
            row.workers.push({ person: p, name: Townsfolk.name(p), title: TownJobs.title(p), rank: p.job.rank, years: Math.floor((d - _num(p.job.since, d)) / Townsfolk.config().daysPerYear), state, weight: _r2(TownJobs.weight(folk, p, d)) });
        }
        for (const id of Object.keys(plan)) if (!rows[id]) rows[id] = { id, workers: [] };
        const out = Object.values(rows).map(r => {
            const o = r.id === '_player' ? { name: 'in your service', icon: '🏠' } : (C.occupations[r.id] || { name: r.id, icon: '•' });
            const c = crew.occ[r.id];
            return { ...r, name: o.name, icon: o.icon, planned: _num(plan[r.id]), factor: c ? c.factor : null, goods: _arr(o.goods) };
        });
        const rank = id => { const i = Object.keys(plan).indexOf(id); return i < 0 ? 999 : i; };
        out.sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
        return out;
    },

    /** A line about one of the town's job annals. */
    annalText(folk, entry, world, speaker = null) {
        const C = TownJobs.config();
        const [kind, x] = String(entry.x || '').split('|');
        const a = Townsfolk.get(folk, entry.a);
        const b = Townsfolk.get(folk, entry.b);
        const t = C.annals[kind];
        if (!t || !a) return null;
        const o = TownJobs.occ(x);
        const nameOf = (p) => (speaker && p && p.id === speaker.id ? 'I' : p ? Townsfolk.name(p) : 'someone');
        return _cap(_fill(t, { a: nameOf(a), b: b ? (speaker && b.id === speaker.id ? 'me' : Townsfolk.name(b)) : '', trade: o ? o.name : (x || 'tradesman'), x: x || '', when: Townsfolk.when(entry.d, world) }));
    },

    /** A first-person line about a job entry of a person's own life (reunions). */
    lifeText(folk, p, e, world) {
        const [kind, x] = String(e.x || '').split('|');
        const o = TownJobs.occ(x);
        const when = Townsfolk.when(e.d, world);
        const boss = Townsfolk.get(folk, e.o);
        switch (kind) {
            case 'apprenticed': return o ? `I was apprenticed to ${boss ? Townsfolk.name(boss) : 'a master'} ${when}, to learn the ${o.name}'s trade.` : null;
            case 'journeyman': return o ? `I finished my time ${when} — a journeyman ${o.name} now.` : null;
            case 'master': return o ? `I'm a master ${o.name} since ${when.replace(/^in /, '')}.` : null;
            case 'tookUp': return o ? `I took up the ${o.name}'s trade ${when}.` : null;
            case 'widow': return o ? `When ${boss ? boss.first : 'my love'} died I kept the ${o.name}'s shop going. What else could I do?` : null;
            case 'jobless': return `I lost my work ${when}.`;
            default: return null;
        }
    },

    /** A third-person line for the journal. */
    biographyLine(folk, p, e, world) {
        const [kind, x] = String(e.x || '').split('|');
        const o = TownJobs.occ(x);
        const when = Townsfolk.when(e.d, world);
        switch (kind) {
            case 'apprenticed': return o ? `Apprenticed as a ${o.name} ${when}.` : null;
            case 'journeyman': return o ? `Became a journeyman ${o.name} ${when}.` : null;
            case 'master': return o ? `Became a master ${o.name} ${when}.` : null;
            case 'tookUp': return o ? `Took up the trade of ${o.name} ${when}.` : null;
            case 'widow': return o ? `Kept on the late spouse's ${o.name} shop ${when}.` : null;
            case 'jobless': return `Lost work ${when}.`;
            case 'hiredPlayer': return `Took service with you ${when} (${x}).`;
            case 'leftPlayer': return `Left your service ${when}${x === 'unpaid' ? ', unpaid' : ''}.`;
            default: return null;
        }
    },

    /** The role an apprentice grows into (a smith's apprentice a smith), or null. */
    comingOfAgeRole(folk, p) {
        const o = p && p.job && TownJobs.occ(p.job.id);
        return o && o.role ? o.role : null;
    },
};
