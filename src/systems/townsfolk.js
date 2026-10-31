// ============================================
// TOWNSFOLK — the people of every settlement live their lives
// ============================================
// Each settlement the player has walked through keeps a roster of its people
// on `settlement.folk` (saved with the tile). They are born, grow up, take a
// trade, marry, have children, grow old, retire, move away and die — a season
// at a time, for every town with a roster, whether the player is there or not.
//
//   folk = { v, q, r, n (next id), target, tick (last season reckoned),
//            visit, prevVisit, people: [person], annals: [entry] }
//   person = { id, first, last, maiden, gender, born, died, cause, role,
//              retired, traits, spouse, parents, kids, away: {d, to}|null,
//              log: [{d, k, o, x}], seen: {d, age, role}|undefined,
//              mem: dialog memory (systems/npcDisposition.js)|undefined }
//
// The inner map (world/innerMap/npcs.js) spawns the walking NPCs from the
// roster (`attach` + `dress`); the dialog reads it for reunions, family and
// the town's news. All rolls come from a hash of the world seed, the town and
// the day — no draws on the shared RNG. Tuned in data/townsfolk.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { WorldEvents } from '../world/worldEvents.js';

const DEFAULTS = {
    enabled: true,
    daysPerYear: 120,
    tickDays: 30,
    comeOfAge: 16,
    onMapMinAge: 4,
    mortality: [
        { under: 5, rate: 0.04 }, { under: 16, rate: 0.006 }, { under: 40, rate: 0.008 },
        { under: 55, rate: 0.016 }, { under: 65, rate: 0.045 }, { under: 75, rate: 0.11 },
        { under: 85, rate: 0.22 }, { under: 999, rate: 0.4 },
    ],
    hardship: { dearth: 2, plague: 4, winterOld: 1.4, warSoldierDeath: 0.03 },
    marriage: { minAge: 17, maxAge: 45, chance: 0.22, outsiderChance: 0.06 },
    birth: { motherMin: 18, motherMax: 42, chance: 0.32, maxChildren: 5, childbedDeath: 0.02, namedForKin: 0.3 },
    departure: { minAge: 17, maxAge: 30, chance: 0.05, crowdedChance: 0.15 },
    arrival: { belowShare: 0.85, chance: 0.9 },
    retireAge: 62,
    retiringRoles: ['guard', 'farmer', 'blacksmith_npc'],
    inheritRoleChance: 0.55,
    roleWeights: { villager: 4, farmer: 2, merchant: 1, guard: 1, priest: 0.25 },
    inheritableRoles: ['farmer', 'blacksmith_npc', 'merchant', 'priest', 'guard', 'noble'],
    reunionAfterDays: 60,
    maxAnnals: 60,
    maxLog: 14,
    pruneAfterYears: 40,
    names: {
        male: ['Brom', 'Dorn', 'Finn', 'Holt', 'Lars', 'Nils', 'Rolf', 'Tor', 'Arne', 'Dag', 'Knut', 'Sven', 'Ulf'],
        female: ['Ada', 'Clara', 'Eva', 'Greta', 'Iris', 'Maeve', 'Siv', 'Una', 'Wren', 'Elsa', 'Inga', 'Lena', 'Thora'],
    },
    lastNames: ['Stoneheart', 'Ironwood', 'Oakshield', 'Ashborne', 'Blackthorn', 'Greymoor', 'Millbrook', 'Hayward'],
    causes: {
        infant: ['a fever in the cradle'], old: ['old age'], common: ['a fever', 'a bad fall'],
        winter: ['the winter cold'], dearth: ['hunger in the dearth'], plague: ['the plague'],
        childbed: ['childbed'], war: ['the fighting against {enemy}'],
    },
    roleTitles: {
        villager: 'townsman', farmer: 'farmer', merchant: 'merchant', guard: 'guard', priest: 'priest',
        blacksmith_npc: 'smith', noble: 'noble', beggar: 'beggar', child: 'child',
    },
};

const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

let _cfg = null;
let _cfgSrc;

function _obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }
function _num(v, d = 0) { return typeof v === 'number' && isFinite(v) ? v : d; }

/** A deterministic stream for one town on one day. */
function _rng(world, folk, day, salt = '') {
    const seed = (world && world.generationParams && world.generationParams.seed) || 1;
    let s = (Utils.hashStr(`${seed}|${folk.q},${folk.r}|${day}|folk${salt}`) >>> 0) || 1;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

function _pick(arr, rng) { return arr && arr.length ? arr[Math.floor(rng() * arr.length)] : null; }

function _weighted(weights, rng) {
    const entries = Object.entries(weights).filter(([, w]) => w > 0);
    const total = entries.reduce((t, [, w]) => t + w, 0);
    let roll = rng() * total;
    for (const [k, w] of entries) { roll -= w; if (roll <= 0) return k; }
    return entries.length ? entries[entries.length - 1][0] : 'villager';
}

/** Chance per season from a yearly rate. */
function _seasonal(rate) {
    const C = Townsfolk.config();
    const f = C.tickDays / C.daysPerYear;
    return 1 - Math.pow(1 - Math.min(0.99, Math.max(0, rate)), f);
}

function _article(word) { return /^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`; }

export const Townsfolk = {
    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.townsfolk : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            _cfg = { ...DEFAULTS, ...(_obj(src) || {}) };
            for (const k of ['hardship', 'marriage', 'birth', 'departure', 'arrival', 'names', 'causes', 'roleTitles']) {
                _cfg[k] = { ...DEFAULTS[k], ...(_obj(src && src[k]) || {}) };
            }
        }
        return _cfg;
    },

    // ── Lookups ──────────────────────────────────────────

    get(folk, id) {
        if (!folk || id == null) return null;
        if (!folk._index || folk._index.size !== folk.people.length) {
            Object.defineProperty(folk, '_index', { value: new Map(), writable: true, configurable: true, enumerable: false });
            for (const p of folk.people) folk._index.set(p.id, p);
        }
        return folk._index.get(id) || null;
    },

    age(p, day) {
        const Y = Townsfolk.config().daysPerYear;
        const until = p.died != null ? p.died : day;
        return Math.max(0, Math.floor((until - p.born) / Y));
    },

    isHere(p) { return !!p && p.died == null && !p.away; },

    residents(folk) { return folk ? folk.people.filter(Townsfolk.isHere) : []; },

    name(p) { return p ? `${p.first} ${p.last}` : 'someone'; },

    roleTitle(p) {
        if (!p) return 'townsman';
        if (p.retired) return `retired ${Townsfolk.title(p.retired, p.gender)}`;
        return Townsfolk.title(p.role, p.gender);
    },

    /** What a role is called, for a man or a woman. */
    title(role, gender) {
        if (role === 'villager' && gender === 'female') return 'townswoman';
        const T = Townsfolk.config().roleTitles;
        return T[role] || role;
    },

    kinWord(p, rel) {
        const f = p && p.gender === 'female';
        return { spouse: f ? 'wife' : 'husband', parent: f ? 'mother' : 'father', child: f ? 'daughter' : 'son', sibling: f ? 'sister' : 'brother' }[rel] || rel;
    },

    /** "in the winter of 861" */
    when(d, world) {
        const Y = Townsfolk.config().daysPerYear;
        const base = _num(world && world.baseYear, 853);
        const year = base + Math.floor((Math.max(1, d) - 1) / Y);
        const season = SEASONS[Math.floor(((Math.max(1, d) - 1) % Y) / (Y / 4))] || 'spring';
        return `in the ${season} of ${year}`;
    },

    siblings(folk, p) {
        if (!p || !p.parents || !p.parents.length) return [];
        return folk.people.filter(o => o.id !== p.id && o.parents && o.parents.some(id => p.parents.includes(id)));
    },

    // ── The roster ───────────────────────────────────────

    /**
     * The people to show on the inner map. Builds the roster from the freshly
     * generated NPCs on a first visit; afterwards reckons any seasons not yet
     * lived and returns the residents old enough to be about.
     * @param {object} opts { q, r, target } — target: the town's usual head count
     */
    attach(settlement, world, npcs, opts = {}) {
        const C = Townsfolk.config();
        if (!C.enabled || !settlement || !world) return null;
        const day = _num(world.day, 1);
        let folk = settlement.folk;
        if (!_obj(folk) || !Array.isArray(folk.people)) {
            folk = Townsfolk._create(settlement, world, npcs || [], opts, day);
        } else {
            Townsfolk.catchUp(world, settlement, day);
        }
        if (opts.target) folk.target = opts.target;
        folk.prevVisit = folk.visit != null ? folk.visit : null;
        folk.visit = day;
        const shown = Townsfolk.residents(folk).filter(p => Townsfolk.age(p, day) >= C.onMapMinAge);
        // Crowded towns: the people the player knows are always about
        const cap = Math.max(4, Math.round((folk.target || shown.length) * 1.3));
        if (shown.length <= cap) return shown;
        const known = shown.filter(p => p.mem && p.mem.timesSpoken > 0);
        const rest = shown.filter(p => !(p.mem && p.mem.timesSpoken > 0));
        const rng = _rng(world, folk, day, 'crowd');
        for (let i = rest.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [rest[i], rest[j]] = [rest[j], rest[i]];
        }
        return known.concat(rest).slice(0, cap);
    },

    _create(settlement, world, npcs, opts, day) {
        const C = Townsfolk.config();
        const Y = C.daysPerYear;
        const folk = {
            v: 1, q: _num(opts.q, settlement.q), r: _num(opts.r, settlement.r), n: 0,
            target: opts.target || 0, tick: day - (day % C.tickDays), visit: null, prevVisit: null,
            people: [], annals: [],
        };
        const rng = _rng(world, folk, day, 'create');
        const byNpc = new Map();
        for (const npc of npcs) {
            if (npc.type === 'traveler') continue;
            const age = _num(npc.age, 30);
            const gender = npc.gender || (rng() < 0.5 ? 'male' : 'female');
            const names = C.names[gender] || [];
            const p = {
                id: folk.n++,
                first: names.length && !names.includes(npc.name) ? _pick(names, rng) : npc.name,
                last: npc.lastName || _pick(C.lastNames, rng),
                gender,
                born: day - age * Y - Math.floor(rng() * Y),
                died: null, cause: null,
                role: npc.type,
                traits: (npc.personalityTraits || []).slice(),
                spouse: null, parents: [], kids: [], away: null, log: [],
            };
            byNpc.set(npc.id, p);
            folk.people.push(p);
        }
        for (const npc of npcs) {
            const p = byNpc.get(npc.id);
            if (!p) continue;
            const sp = npc.spouseId != null ? byNpc.get(npc.spouseId) : null;
            if (sp) p.spouse = sp.id;
            p.parents = (npc.parentIds || []).map(id => byNpc.get(id)).filter(Boolean).map(o => o.id);
            p.kids = (npc.childIds || []).map(id => byNpc.get(id)).filter(Boolean).map(o => o.id);
        }
        // A child is the right age for the parents it was given
        for (const p of folk.people) {
            if (!p.parents.length) continue;
            const youngest = Math.max(...p.parents.map(id => Townsfolk.get(folk, id).born));
            const minBorn = youngest + 17 * Y;
            if (p.born < minBorn) p.born = Math.min(day - Y, minBorn + Math.floor(rng() * 4 * Y));
            if (Townsfolk.age(p, day) >= C.comeOfAge && p.role === 'child') p.role = 'villager';
        }
        // ...and the parents not too old for their youngest
        for (const par of folk.people) {
            if (!par.kids.length) continue;
            const kids = par.kids.map(id => Townsfolk.get(folk, id));
            const gap = par.gender === 'female' ? 40 : 50;
            const lo = Math.max(...kids.map(k => k.born)) - gap * Y;
            const hi = Math.min(...kids.map(k => k.born)) - 17 * Y;
            if (lo <= hi && par.born < lo) par.born = lo + Math.floor(rng() * Math.min(hi - lo + 1, 8 * Y));
        }
        settlement.folk = folk;
        return folk;
    },

    // ── The seasons turn ─────────────────────────────────

    /**
     * Reckon every season since the roster was last reckoned. Returns the
     * news of people the player has spoken with.
     */
    catchUp(world, settlement, day, player = null) {
        const folk = settlement && settlement.folk;
        if (!_obj(folk) || !Array.isArray(folk.people)) return [];
        const C = Townsfolk.config();
        const news = [];
        let t = _num(folk.tick, day);
        // At most a lifetime at a time (a very old save opening)
        let guard = 0;
        while (t + C.tickDays <= day && guard++ < 400) {
            t += C.tickDays;
            Townsfolk._season(world, settlement, folk, t, news, player);
        }
        folk.tick = Math.max(_num(folk.tick, 0), t);
        return news;
    },

    /** The daily hook: every tickDays, every town with a roster lives a season. */
    processDay(world, player = null) {
        const C = Townsfolk.config();
        if (!C.enabled || !world || _num(world.day) % C.tickDays !== 0) return [];
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        const news = [];
        for (const s of views) {
            if (s && s.folk) news.push(...Townsfolk.catchUp(world, s, world.day, player));
        }
        return news;
    },

    _context(world, settlement, folk, day, player = null) {
        const ctx = { dearth: false, plague: false, winter: false, enemy: null, towns: [], rivalHouse: null, feud: 0 };
        try { ctx.dearth = SettlementMarket.inDearth(settlement); } catch (e) { ctx.dearth = false; }
        try { ctx.plague = WorldEvents.getEventsAt(world, { q: folk.q, r: folk.r, settlement }).some(ev => ev.id === 'plague'); } catch (e) { ctx.plague = false; }
        const Y = Townsfolk.config().daysPerYear;
        ctx.winter = Math.floor(((day - 1) % Y) / (Y / 4)) === 3;
        const kingdom = settlement.kingdom != null && typeof world.getKingdom === 'function' ? world.getKingdom(settlement.kingdom) : null;
        if (kingdom && Array.isArray(kingdom.wars) && kingdom.wars.length) {
            const foe = world.getKingdom(kingdom.wars[0]);
            ctx.enemy = foe ? foe.name : 'the enemy';
        }
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        for (const s of views) if (s && s.name && s !== settlement && s.name !== settlement.name) ctx.towns.push(s.name);
        // A rival House of the player's holds this realm (systems/house.js rivals, keyed by kingdom)
        const rival = player && player.house && player.house.rivals && settlement.kingdom != null ? player.house.rivals[settlement.kingdom] : null;
        if (rival) { ctx.rivalHouse = rival.name; ctx.feud = _num(rival.feud); }
        return ctx;
    },

    _season(world, settlement, folk, day, news, player) {
        const C = Townsfolk.config();
        const rng = _rng(world, folk, day);
        const ctx = Townsfolk._context(world, settlement, folk, day, player);
        const H = C.hardship;
        const note = (k, a, b, x) => Townsfolk._annal(folk, world, day, { k, a, b, x }, news);

        // Deaths
        for (const p of Townsfolk.residents(folk)) {
            const age = Townsfolk.age(p, day);
            let rate = (C.mortality.find(m => age < m.under) || { rate: 0.4 }).rate;
            if (ctx.dearth && (age < 5 || age >= 60)) rate *= H.dearth;
            if (ctx.plague) rate *= H.plague;
            if (ctx.winter && age >= 60) rate *= 1 + (H.winterOld - 1) * 4;   // the whole year's extra falls in winter
            let cause = null;
            if (rng() < _seasonal(rate)) cause = Townsfolk._cause(age, ctx, rng);
            else if (ctx.enemy && p.role === 'guard' && rng() < H.warSoldierDeath) {
                cause = (_pick(C.causes.war, rng) || 'the war').replace('{enemy}', ctx.enemy);
            }
            if (cause) {
                Townsfolk._die(folk, p, day, cause);
                note('died', p.id, null, cause);
            }
        }

        // Growing up and growing old
        for (const p of Townsfolk.residents(folk)) {
            const age = Townsfolk.age(p, day);
            if (p.role === 'child' && age >= C.comeOfAge) {
                p.role = Townsfolk._chooseRole(folk, p, rng);
                Townsfolk._log(p, day, 'grown', null, p.role);
                note('grown', p.id, null, p.role);
            } else if (age >= C.retireAge && C.retiringRoles.includes(p.role)) {
                p.retired = p.role;
                p.role = 'villager';
                Townsfolk._log(p, day, 'retired', null, p.retired);
            }
        }

        // Weddings
        const M = C.marriage;
        const single = p => {
            const sp = Townsfolk.get(folk, p.spouse);
            return !sp || sp.died != null;
        };
        const eligible = p => {
            const a = Townsfolk.age(p, day);
            return a >= M.minAge && a <= M.maxAge && single(p) && p.role !== 'priest';
        };
        const pool = Townsfolk.residents(folk).filter(eligible);
        for (const a of pool) {
            if (!eligible(a) || rng() >= _seasonal(M.chance)) continue;
            const kin = new Set([...a.parents, ...a.kids, ...Townsfolk.siblings(folk, a).map(s => s.id)]);
            const ageA = Townsfolk.age(a, day);
            const match = pool.find(b => b !== a && b.gender !== a.gender && eligible(b) && !kin.has(b.id) &&
                Math.abs(Townsfolk.age(b, day) - ageA) <= 12);
            if (match) {
                Townsfolk._wed(folk, a, match, day);
                note('wed', a.id, match.id);
            } else if (rng() < M.outsiderChance / Math.max(0.01, M.chance)) {
                const from = _pick(ctx.towns, rng) || 'a distant town';
                const b = Townsfolk._newcomer(folk, day, rng, {
                    gender: a.gender === 'male' ? 'female' : 'male',
                    age: Math.max(M.minAge, ageA - 4 + Math.floor(rng() * 9)),
                    from,
                });
                Townsfolk._wed(folk, a, b, day);
                note('wed', a.id, b.id, from);
            }
        }

        // Births
        const B = C.birth;
        for (const mother of Townsfolk.residents(folk)) {
            if (mother.gender !== 'female') continue;
            const age = Townsfolk.age(mother, day);
            if (age < B.motherMin || age > B.motherMax) continue;
            const father = Townsfolk.get(folk, mother.spouse);
            if (!Townsfolk.isHere(father)) continue;
            if (mother.wedDay != null && day - mother.wedDay < C.daysPerYear * 0.75) continue;
            const living = mother.kids.map(id => Townsfolk.get(folk, id)).filter(k => k && k.died == null).length;
            if (living >= B.maxChildren) continue;
            // A year at least between little ones
            const last = mother.kids.map(id => Townsfolk.get(folk, id)).filter(Boolean).reduce((m, k) => Math.max(m, k.born), -Infinity);
            if (day - last < C.daysPerYear * 1.25) continue;
            if (rng() >= _seasonal(B.chance * (1 - living * 0.12))) continue;
            const child = Townsfolk._born(folk, mother, father, day, rng);
            note('born', child.id, mother.id);
            if (rng() < B.childbedDeath) {
                Townsfolk._die(folk, mother, day, _pick(C.causes.childbed, rng) || 'childbed');
                note('died', mother.id, null, mother.cause);
            }
        }

        // Leaving for elsewhere
        const D = C.departure;
        const crowded = folk.target && Townsfolk.residents(folk).length > folk.target * 1.4;
        for (const p of Townsfolk.residents(folk)) {
            const age = Townsfolk.age(p, day);
            if (age < D.minAge || age > D.maxAge || !single(p) || p.role === 'noble') continue;
            if (rng() >= _seasonal(crowded ? D.crowdedChance : D.chance)) continue;
            const to = _pick(ctx.towns, rng) || 'the wider world';
            p.away = { d: day, to };
            Townsfolk._log(p, day, 'left', null, to);
            for (const pid of p.parents) Townsfolk._log(Townsfolk.get(folk, pid), day, 'kidLeft', p.id, to);
            note('left', p.id, null, to);
        }

        // New arrivals keep a shrinking town alive
        const A = C.arrival;
        if (folk.target && Townsfolk.residents(folk).length < folk.target * A.belowShare && rng() < _seasonal(A.chance)) {
            const from = _pick(ctx.towns, rng) || 'a distant town';
            const roleWeights = { ...C.roleWeights };
            const a = Townsfolk._newcomer(folk, day, rng, { age: 19 + Math.floor(rng() * 22), from, role: _weighted(roleWeights, rng) });
            note('arrived', a.id, null, from);
            if (rng() < 0.45) {
                const b = Townsfolk._newcomer(folk, day, rng, {
                    gender: a.gender === 'male' ? 'female' : 'male',
                    age: Math.max(18, Townsfolk.age(a, day) - 3 + Math.floor(rng() * 7)),
                    from, role: _weighted(roleWeights, rng), last: a.last,
                });
                Townsfolk._wed(folk, a, b, day, true);
                const kids = Math.floor(rng() * 3);
                const mother = a.gender === 'female' ? a : b;
                const father = a.gender === 'female' ? b : a;
                for (let i = 0; i < kids && Townsfolk.age(mother, day) >= 20; i++) {
                    const c = Townsfolk._born(folk, mother, father, day - Math.floor(rng() * 10 * C.daysPerYear), rng, true);
                    c.log = [{ d: day, k: 'arrived', x: from }];
                }
            }
        }

        // A feuding rival House's men come asking after the player's House
        if (ctx.rivalHouse && ctx.feud >= 30 && player && player.house && rng() < 0.25) {
            note('rivalMen', null, null, `${ctx.rivalHouse}|${player.house.name}`);
        }

        Townsfolk._prune(folk, day);
    },

    // ── Life events ──────────────────────────────────────

    _log(p, d, k, o = null, x = null) {
        if (!p) return;
        const entry = { d, k };
        if (o != null) entry.o = o;
        if (x != null) entry.x = x;
        p.log.push(entry);
        const cap = Townsfolk.config().maxLog;
        if (p.log.length > cap) p.log.splice(0, p.log.length - cap);
    },

    _annal(folk, world, day, entry, news) {
        entry.d = day;
        folk.annals.push(entry);
        const cap = Townsfolk.config().maxAnnals;
        if (folk.annals.length > cap) folk.annals.splice(0, folk.annals.length - cap);
        // Word reaches the player of the people they know
        const known = [entry.a, entry.b].map(id => Townsfolk.get(folk, id)).filter(p => p && p.mem && p.mem.timesSpoken > 0);
        if (!known.length) return;
        const close = known.some(p => p.mem.timesSpoken >= 2 || _num(p.mem.disposition, 50) >= 65);
        if (entry.k === 'died' || (close && entry.k !== 'grown')) {
            news.push({ kind: entry.k, folk, entry, text: Townsfolk.annalText(folk, entry, world) });
        }
    },

    _die(folk, p, day, cause) {
        p.died = day;
        p.cause = cause;
        Townsfolk._log(p, day, 'died', null, cause);
        const sp = Townsfolk.get(folk, p.spouse);
        if (sp && sp.died == null && sp.spouse === p.id) Townsfolk._log(sp, day, 'widowed', p.id, cause);
        for (const id of p.kids) {
            const k = Townsfolk.get(folk, id);
            if (k && k.died == null) Townsfolk._log(k, day, 'parentDied', p.id, cause);
        }
        for (const id of p.parents) {
            const par = Townsfolk.get(folk, id);
            if (par && par.died == null) Townsfolk._log(par, day, 'childDied', p.id, cause);
        }
    },

    _wed(folk, a, b, day, quiet = false) {
        a.spouse = b.id;
        b.spouse = a.id;
        a.wedDay = day;
        b.wedDay = day;
        const bride = a.gender === 'female' ? a : b;
        const groom = bride === a ? b : a;
        if (bride.last !== groom.last) { bride.maiden = bride.maiden || bride.last; bride.last = groom.last; }
        if (!quiet) {
            Townsfolk._log(a, day, 'wed', b.id);
            Townsfolk._log(b, day, 'wed', a.id);
        }
    },

    _born(folk, mother, father, day, rng, quiet = false) {
        const C = Townsfolk.config();
        const gender = rng() < 0.5 ? 'male' : 'female';
        const taken = new Set(mother.kids.map(id => Townsfolk.get(folk, id)).filter(k => k && k.died == null).map(k => k.first));
        taken.add(mother.first);
        taken.add(father.first);
        let first = null;
        let namedFor = null;
        if (rng() < C.birth.namedForKin) {
            const elders = [...mother.parents, ...father.parents].map(id => Townsfolk.get(folk, id))
                .filter(e => e && e.gender === gender && e.died != null && !taken.has(e.first));
            const e = _pick(elders, rng);
            if (e) { first = e.first; namedFor = e.id; }
        }
        if (!first) {
            const names = (C.names[gender] || []).filter(n => !taken.has(n));
            first = _pick(names.length ? names : C.names[gender], rng) || 'Ash';
        }
        const child = {
            id: folk.n++, first, last: father.last, gender, born: day, died: null, cause: null,
            role: 'child', traits: Townsfolk._traits(rng), spouse: null,
            parents: [mother.id, father.id], kids: [], away: null, log: [],
        };
        if (namedFor != null) child.namedFor = namedFor;
        folk.people.push(child);
        mother.kids.push(child.id);
        father.kids.push(child.id);
        if (!quiet) {
            Townsfolk._log(mother, day, 'birth', child.id);
            Townsfolk._log(father, day, 'birth', child.id);
        }
        return child;
    },

    _newcomer(folk, day, rng, o = {}) {
        const C = Townsfolk.config();
        const gender = o.gender || (rng() < 0.5 ? 'male' : 'female');
        const p = {
            id: folk.n++,
            first: _pick(C.names[gender], rng) || 'Ash',
            last: o.last || _pick(C.lastNames, rng) || 'Stone',
            gender,
            born: day - _num(o.age, 25) * C.daysPerYear - Math.floor(rng() * C.daysPerYear),
            died: null, cause: null,
            role: o.role || _weighted(C.roleWeights, rng),
            traits: Townsfolk._traits(rng),
            spouse: null, parents: [], kids: [], away: null,
            log: [{ d: day, k: 'arrived', x: o.from || 'elsewhere' }],
        };
        folk.people.push(p);
        return p;
    },

    _traits(rng) {
        const pool = ['kind', 'stern', 'jovial', 'quiet', 'bold', 'cautious', 'witty', 'generous', 'stubborn', 'curious'];
        const out = [];
        const n = 1 + Math.floor(rng() * 2);
        for (let i = 0; i < n; i++) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
        return out;
    },

    _cause(age, ctx, rng) {
        const C = Townsfolk.config().causes;
        if (ctx.plague && rng() < 0.6) return _pick(C.plague, rng);
        if (ctx.dearth && (age < 5 || age >= 60) && rng() < 0.5) return _pick(C.dearth, rng);
        if (ctx.winter && age >= 60 && rng() < 0.5) return _pick(C.winter, rng);
        if (age < 5) return _pick(C.infant, rng);
        if (age >= 62 && rng() < 0.75) return _pick(C.old, rng);
        return _pick(C.common, rng);
    },

    _chooseRole(folk, p, rng) {
        const C = Townsfolk.config();
        const parents = p.parents.map(id => Townsfolk.get(folk, id)).filter(Boolean);
        const roles = parents.map(par => par.retired || par.role);
        if (roles.includes('noble')) return 'noble';
        const trade = roles.find(r => C.inheritableRoles.includes(r));
        if (trade && rng() < C.inheritRoleChance) return trade;
        return _weighted(C.roleWeights, rng);
    },

    /** Forget the long-gone whom the player never met and no one living names. */
    _prune(folk, day) {
        const C = Townsfolk.config();
        const horizon = day - C.pruneAfterYears * C.daysPerYear;
        const named = new Set();
        for (const p of folk.people) {
            if (p.died != null) continue;
            if (p.spouse != null) named.add(p.spouse);
            for (const id of p.parents) named.add(id);
            for (const id of p.kids) named.add(id);
        }
        const keep = folk.people.filter(p => {
            const gone = p.died != null ? p.died : (p.away ? p.away.d : null);
            // Those in the player's life (systems/relationships/folk.js) are never forgotten
            return gone == null || gone > horizon || named.has(p.id) || (p.mem && p.mem.timesSpoken > 0) || p.rnpc || p.wedHouse;
        });
        if (keep.length !== folk.people.length) {
            folk.people = keep;
            delete folk._index;
        }
    },

    // ── On the inner map ─────────────────────────────────

    /** Make an inner-map NPC this person: name, age, family, memory. */
    dress(npc, p, folk, world) {
        const day = _num(world && world.day, 1);
        npc.name = p.first;
        npc.lastName = p.last;
        npc.fullName = Townsfolk.name(p);
        npc.age = Townsfolk.age(p, day);
        npc.gender = p.gender;
        npc.type = p.role;
        npc.personalityTraits = (p.traits || []).slice();
        npc.roleTitle = Townsfolk.roleTitle(p);
        npc.uid = `${folk.q},${folk.r}#${p.id}`;
        npc.familyGroupId = null;
        npc.spouseId = null;
        npc.parentIds = [];
        npc.childIds = [];
        npc.siblingIds = [];
        Object.defineProperty(npc, '_person', { value: p, configurable: true, enumerable: false, writable: true });
        Object.defineProperty(npc, '_folk', { value: folk, configurable: true, enumerable: false, writable: true });
        // The dialog memory lives on the person, so it outlasts the visit
        Object.defineProperty(npc, '_dialogMemory', {
            configurable: true,
            enumerable: false,
            get() { return p.mem; },
            set(v) { p.mem = v; },
        });
        if (p.mem) p.mem.questOffered = false;
        return npc;
    },

    /** Point the NPCs' family ids at each other (only those on the map). */
    linkFamilies(npcs) {
        const byPerson = new Map();
        for (const n of npcs) if (n._person) byPerson.set(n._person.id, n);
        for (const n of npcs) {
            const p = n._person;
            if (!p) continue;
            const sp = byPerson.get(p.spouse);
            if (sp && sp._person.spouse === p.id) n.spouseId = sp.id;
            n.parentIds = p.parents.map(id => byPerson.get(id)).filter(Boolean).map(o => o.id);
            n.childIds = p.kids.map(id => byPerson.get(id)).filter(Boolean).map(o => o.id);
            n.siblingIds = Townsfolk.siblings(n._folk, p).map(s => byPerson.get(s.id)).filter(Boolean).map(o => o.id);
        }
    },

    // ── Brawls (ui/innerMapCombat.js, systems/duels.js) ──

    /**
     * The coin a person carries, rolled once on this town's own hash stream
     * (range [lo, hi] by trade, from data/duels.json) and kept on the person.
     */
    purse(folk, p, world, range = [2, 12]) {
        if (!folk || !p) return 0;
        if (typeof p.purse !== 'number') {
            const rng = _rng(world, folk, p.born || 0, `purse${p.id}`);
            const lo = _num(range[0]);
            const hi = Math.max(lo, _num(range[1], lo));
            p.purse = lo + Math.floor(rng() * (hi - lo + 1));
        }
        return p.purse;
    },

    /** Take the person's purse (a robbery or a beating): returns the coin. */
    takePurse(folk, p, world, range) {
        const coin = Townsfolk.purse(folk, p, world, range);
        p.purse = 0;
        return coin;
    },

    /** Record a beating: { hp, max } on day `day`, healed a share of max a day. */
    injure(p, day, hp, max) {
        if (!p) return;
        p.hurt = { hp: Math.max(0, Math.round(hp)), max: Math.max(1, Math.round(max)), d: _num(day) };
    },

    /** The person's hit points today ({ hp, max }), or null when whole. */
    injury(p, day, healPerDay = 0.12) {
        const h = p && p.hurt;
        if (!h) return null;
        const hp = Math.min(h.max, h.hp + Math.max(0, _num(day) - h.d) * h.max * healPerDay);
        if (hp >= h.max) { delete p.hurt; return null; }
        return { hp: Math.round(hp), max: h.max };
    },

    /** The person was killed (by the player's hand): they die on the roster. */
    slay(folk, p, day, cause = 'a brawl') {
        if (!folk || !p || p.died != null) return;
        delete p.hurt;
        Townsfolk._die(folk, p, day, cause);
    },

    // ── What others do in town (systems/schemes.js) ─────

    /** Write an entry into the town's annals (so townNews and the journal tell it). Returns the news for the player. */
    record(folk, world, day, entry) {
        if (!folk || !Array.isArray(folk.annals) || !entry) return [];
        const news = [];
        Townsfolk._annal(folk, world, _num(day, 1), { ...entry }, news);
        return news;
    },

    /** Add a line to a person's own life (reunions and the journal tell it). */
    note(p, day, k, o = null, x = null) {
        Townsfolk._log(p, _num(day, 1), k, o, x);
    },

    /** Drive a person out of town (exile): they are gone from the roster's living here. */
    exile(folk, p, day, to = 'exile') {
        if (!folk || !p || p.died != null) return;
        p.away = { d: _num(day, 1), to };
        Townsfolk._log(p, _num(day, 1), 'exiled', null, to);
    },

    // ── In conversation ──────────────────────────────────

    /** The player has spoken with this person today. */
    noteSeen(npc, day) {
        const p = npc && npc._person;
        if (!p) return;
        p.seen = { d: day, age: Townsfolk.age(p, day), role: p.role };
    },

    /**
     * What someone says on seeing the player again after a long while: how
     * they have grown, and what has happened to them since.
     */
    reunionLine(npc, world) {
        const p = npc && npc._person;
        const folk = npc && npc._folk;
        if (!p || !folk || !p.seen) return null;
        const C = Townsfolk.config();
        const day = _num(world && world.day, 1);
        const gap = day - p.seen.d;
        if (gap < C.reunionAfterDays) return null;
        const parts = [];
        const nowAge = Townsfolk.age(p, day);
        if (p.seen.role === 'child' && p.role !== 'child') {
            parts.push(`Do you remember me? I was only a child of ${p.seen.age} when you were last here. I'm ${_article(Townsfolk.roleTitle(p))} now — ${nowAge} years old!`);
        } else if (p.role === 'child' && nowAge - p.seen.age >= 1) {
            parts.push(`You came before! I was only ${p.seen.age} then. I'm ${nowAge} now.`);
        }
        const rank = { widowed: 6, childDied: 5, rescued: 5, spared: 5, wed: 4, informant: 4, birth: 3, wronged: 3, raided: 3, parentDied: 2, favour: 2, retired: 1 };
        const since = p.log.filter(e => e.d > p.seen.d && rank[e.k]).sort((a, b) => rank[b.k] - rank[a.k] || b.d - a.d);
        for (const e of since.slice(0, 2)) {
            const t = Townsfolk.lifeText(folk, p, e, world);
            if (t) parts.push(t);
        }
        if (!parts.length && gap >= C.daysPerYear * 2) {
            parts.push(`It's been ${Math.floor(gap / C.daysPerYear)} years since you last came through!`);
        }
        return parts.length ? parts.join(' ') : null;
    },

    /** A first-person line about one entry of a person's life. */
    lifeText(folk, p, e, world) {
        const o = Townsfolk.get(folk, e.o);
        const when = Townsfolk.when(e.d, world);
        switch (e.k) {
            case 'wed': return o ? `I wed ${Townsfolk.name(o)} ${when}.` : null;
            case 'birth': return o ? `We had a little ${o.gender === 'female' ? 'girl' : 'boy'} ${when} — ${o.first}${o.died != null ? ', though we lost the poor thing' : ''}.` : null;
            case 'widowed': return o ? `My ${Townsfolk.kinWord(o, 'spouse')} ${o.first} died ${when} — ${e.x}. I miss ${o.gender === 'female' ? 'her' : 'him'} every day.` : null;
            case 'childDied': return o ? `We lost our ${Townsfolk.kinWord(o, 'child')} ${o.first} ${when}. ${e.x ? `It was ${e.x}.` : ''}`.trim() : null;
            case 'parentDied': return o ? `My ${Townsfolk.kinWord(o, 'parent')} ${o.first} passed ${when}.` : null;
            case 'retired': return `I've given up the work of ${_article(Townsfolk.title(e.x, p.gender))} — my bones are too old for it now.`;
            case 'kidLeft': return o ? `Our ${o.first} went off to ${e.x} ${when}.` : null;
            case 'arrived': return `I came here from ${e.x} ${when}.`;
            // The player's tasks (systems/npcTasks.js)
            case 'rescued': return `I was lost ${when}, and you brought me home.`;
            case 'favour': return `You did me a good turn ${when}. I haven't forgotten it.`;
            case 'wronged': return `You wronged me ${when}. I haven't forgotten that either.`;
            // Rival Houses' plots (systems/schemes.js)
            case 'spared': return `You let me go ${when}, when you could have had me hanged for ${e.x || 'what I did'}. I'll not forget it.`;
            case 'informant': return `I've kept my ears open for you since ${when}, as we agreed. ${e.x || 'They'} still don't suspect me.`;
            case 'raided': return `${e.x || 'Raiders'} came ${when} and the fighting reached our door. We've not slept easy since.`;
            default: return null;
        }
    },

    /** How the speaker names someone: "I", "my mother Ada", or "Ada Stoneheart". */
    _call(folk, p, speaker) {
        if (!speaker) return Townsfolk.name(p);
        if (p.id === speaker.id) return 'I';
        let rel = null;
        if (speaker.spouse === p.id) rel = 'spouse';
        else if (speaker.parents.includes(p.id)) rel = 'parent';
        else if (speaker.kids.includes(p.id)) rel = 'child';
        else if (p.parents.some(id => speaker.parents.includes(id))) rel = 'sibling';
        return rel ? `my ${Townsfolk.kinWord(p, rel)} ${p.first}` : Townsfolk.name(p);
    },

    /**
     * A line about one of the town's annals — in the third person, or as the
     * speaker (a townsperson) would put it.
     */
    annalText(folk, entry, world, speaker = null) {
        const a = Townsfolk.get(folk, entry.a);
        const b = Townsfolk.get(folk, entry.b);
        const when = Townsfolk.when(entry.d, world);
        if (entry.k === 'rivalMen') {
            const [rival, house] = String(entry.x || '').split('|');
            return `Men in the colours of ${rival || 'a great House'} came through ${when}, asking questions about ${house || 'your House'}.`;
        }
        if (!a) return null;
        const A = Townsfolk._call(folk, a, speaker);
        const self = speaker && a.id === speaker.id;
        let t;
        switch (entry.k) {
            case 'died': t = `${A} died ${when}, aged ${Townsfolk.age(a, entry.d)} — ${entry.x}.`; break;
            case 'wedHouse': t = self ? `I wed into ${entry.x} ${when}.` : `${A} wed into ${entry.x} ${when}. Imagine that.`; break;
            case 'wed': {
                if (!b) return null;
                const called = Townsfolk._call(folk, b, speaker);
                const B = called === Townsfolk.name(b) ? `${b.first} ${b.maiden || b.last}` : called;
                const from = entry.x ? ` (${b.gender === 'female' ? 'she' : 'he'} came from ${entry.x})` : '';
                if (self) t = `I wed ${B} ${when}${from}.`;
                else if (called === 'I') t = `I wed ${A} ${when}.`;
                else t = `${A} and ${B} were wed ${when}${from}.`;
                break;
            }
            case 'born': {
                if (!b) return null;
                const M = Townsfolk._call(folk, b, speaker);
                const kid = a.gender === 'female' ? 'daughter' : 'son';
                t = M === 'I' ? `I had a ${kid}, ${a.first}, ${when}.`
                    : `${M} had a ${kid}, ${a.first}, ${when}${a.namedFor != null ? ' — named for a grandparent' : ''}.`;
                if (self) t = `I was born ${when}.`;
                break;
            }
            case 'left': t = self ? `I left for ${entry.x} ${when}.` : `${A} left for ${entry.x} ${when}.`; break;
            case 'arrived': t = self ? `I came here from ${entry.x} ${when}.` : `${A} came here from ${entry.x} ${when}.`; break;
            case 'grown': t = self ? `I'm grown now — ${_article(Townsfolk.title(entry.x, a.gender))}.` : `${A} is grown now — ${_article(Townsfolk.title(entry.x, a.gender))}.`; break;
            // Rival Houses' plots (systems/schemes.js): x = "rival|deed"
            case 'plot': {
                const [rival, deed] = String(entry.x || '').split('|');
                t = self ? `I did a shameful thing ${when}: ${deed || 'I took'} for ${rival || 'a great House'}.`
                    : `They say ${A}, ${_article(Townsfolk.roleTitle(a))}, ${deed || 'took the coin of'} for ${rival || 'a great House'} ${when}.`;
                break;
            }
            case 'plotFoiled': {
                const [rival] = String(entry.x || '').split('|');
                t = self ? `I was caught out ${when}, doing ${rival || 'a great House'}'s dirty work.` : `${A} was caught ${when} doing ${rival || 'a great House'}'s dirty work.`;
                break;
            }
            case 'exiled': t = self ? `I was driven out ${when}.` : `${A} was named a traitor and driven out of town ${when}${entry.x ? ` — ${entry.x}` : ''}.`; break;
            default: return null;
        }
        return t.charAt(0).toUpperCase() + t.slice(1);
    },

    /**
     * The town's news since the player's previous visit (or the latest, on a
     * first), the people the player knows first.
     */
    townNews(folk, world, limit = 4, speaker = null) {
        if (!folk || !folk.annals || !folk.annals.length) return [];
        const since = folk.prevVisit != null ? folk.prevVisit : -Infinity;
        // The speaker's own news is told in the reunion; here, everyone else's
        const own = e => speaker && (e.a === speaker.id || (e.b === speaker.id && e.k !== 'died'));
        let entries = folk.annals.filter(e => e.d > since && !own(e));
        if (!entries.length) return [];
        const weight = { plot: 6, exiled: 5, died: 5, plotFoiled: 4, born: 4, wed: 3, rivalMen: 2, left: 2, arrived: 1, grown: 1 };
        const knows = e => [e.a, e.b].some(id => { const p = Townsfolk.get(folk, id); return p && p.mem && p.mem.timesSpoken > 0; });
        entries = entries.slice().sort((x, y) => (knows(y) - knows(x)) || (weight[y.k] - weight[x.k]) || (y.d - x.d));
        return entries.slice(0, limit).sort((x, y) => x.d - y.d).map(e => Townsfolk.annalText(folk, e, world, speaker)).filter(Boolean);
    },

    // ── The player's journal ────────────────────────────

    /** A third-person line about one entry of a person's life. */
    biographyLine(folk, p, e, world) {
        const o = Townsfolk.get(folk, e.o);
        const when = Townsfolk.when(e.d, world);
        switch (e.k) {
            case 'wed': return o ? `Married ${Townsfolk.name(o)} ${when}.` : null;
            case 'birth': return o ? `A ${o.gender === 'female' ? 'daughter' : 'son'}, ${o.first}, born ${when}.` : null;
            case 'widowed': return o ? `Widowed ${when}: ${o.first} died — ${e.x}.` : null;
            case 'childDied': return o ? `Lost ${p.gender === 'female' ? 'her' : 'his'} ${Townsfolk.kinWord(o, 'child')} ${o.first} ${when}.` : null;
            case 'parentDied': return o ? `${p.gender === 'female' ? 'Her' : 'His'} ${Townsfolk.kinWord(o, 'parent')} ${o.first} died ${when}.` : null;
            case 'retired': return `Gave up the work of ${_article(Townsfolk.title(e.x, p.gender))} ${when}.`;
            case 'kidLeft': return o ? `${o.first} left home for ${e.x} ${when}.` : null;
            case 'grown': return `Came of age ${when} and became ${_article(Townsfolk.title(e.x, p.gender))}.`;
            case 'left': return `Left for ${e.x} ${when}.`;
            case 'arrived': return `Came here from ${e.x} ${when}.`;
            case 'died': return `Died ${when}, aged ${Townsfolk.age(p, e.d)} — ${e.x}.`;
            case 'leftWithPlayer': return `Took to the road with ${e.x} ${when}.`;
            case 'wedPlayer': return `Married ${e.x} ${when}.`;
            case 'wedHouse': return `Married ${e.x} ${when}, and went to live with the House.`;
            case 'cameHome': return `Came home ${when}.`;
            case 'plotted': return `Took ${e.x || 'a rival House'}'s coin to work against you ${when}.`;
            case 'spared': return `You spared them ${when}.`;
            case 'informant': return `Became your informant ${when}.`;
            case 'exiled': return `Driven out of town ${when}.`;
            default: return null;
        }
    },

    /** Status of a person for the journal: here, away, or dead. */
    status(p, world) {
        const day = _num(world && world.day, 1);
        if (p.died != null) return { kind: 'dead', text: `Died ${Townsfolk.when(p.died, world)}, aged ${Townsfolk.age(p, day)} — ${p.cause}` };
        if (p.away && p.away.withPlayer) return { kind: 'away', text: `Away — ${p.away.to}, since ${Townsfolk.when(p.away.d, world).replace(/^in /, '')}` };
        if (p.away) return { kind: 'away', text: `Moved to ${p.away.to} ${Townsfolk.when(p.away.d, world)}` };
        return { kind: 'here', text: `${Townsfolk.roleTitle(p)}, ${Townsfolk.age(p, day)}` };
    },

    /**
     * Everyone the player has spoken with, in every town with a roll:
     * [{ person, folk, town, status, lines, spouse, kids }], the living first.
     */
    acquaintances(world) {
        const views = world && typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        const out = [];
        for (const s of views) {
            const folk = s && s.folk;
            if (!folk || !Array.isArray(folk.people)) continue;
            for (const p of folk.people) {
                if (!(p.mem && p.mem.timesSpoken > 0)) continue;
                const sp = Townsfolk.get(folk, p.spouse);
                out.push({
                    person: p, folk, town: s.name,
                    status: Townsfolk.status(p, world),
                    spouse: sp ? `${Townsfolk.kinWord(sp, 'spouse')} ${Townsfolk.name(sp)}${sp.died != null ? ' (late)' : ''}` : null,
                    kids: p.kids.map(id => Townsfolk.get(folk, id)).filter(Boolean).map(k => `${k.first}${k.died != null ? ' †' : (k.away ? ' (away)' : ` (${Townsfolk.age(k, _num(world.day, 1))})`)}`),
                    lines: p.log.map(e => Townsfolk.biographyLine(folk, p, e, world)).filter(Boolean),
                });
            }
        }
        const order = { here: 0, away: 1, dead: 2 };
        out.sort((a, b) => (order[a.status.kind] - order[b.status.kind]) || a.town.localeCompare(b.town) || a.person.first.localeCompare(b.person.first));
        return out;
    },

    /** The latest word of the people the player knows, newest first. */
    recentWord(world, limit = 8) {
        const views = world && typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        const out = [];
        for (const s of views) {
            const folk = s && s.folk;
            if (!folk || !folk.annals) continue;
            for (const e of folk.annals) {
                const known = [e.a, e.b].some(id => { const p = Townsfolk.get(folk, id); return p && p.mem && p.mem.timesSpoken > 0; });
                if (known && e.k !== 'grown') out.push({ d: e.d, kind: e.k, town: s.name, text: Townsfolk.annalText(folk, e, world) });
            }
        }
        return out.filter(x => x.text).sort((a, b) => b.d - a.d).slice(0, limit);
    },

    /** Everything this person can say about their family, living and dead. */
    familyLines(npc, world) {
        const p = npc && npc._person;
        const folk = npc && npc._folk;
        if (!p || !folk) return null;
        const day = _num(world && world.day, 1);
        const lines = [];
        const sp = Townsfolk.get(folk, p.spouse);
        if (sp) {
            const kin = Townsfolk.kinWord(sp, 'spouse');
            if (sp.died != null) lines.push(`My ${kin} ${sp.first} died ${Townsfolk.when(sp.died, world)} — ${sp.cause}.`);
            else lines.push(`My ${kin} ${sp.first} is ${_article(Townsfolk.roleTitle(sp))} here.`);
        }
        // Those they were married to before
        for (const e of p.log.filter(x => x.k === 'widowed' && x.o !== p.spouse)) {
            const late = Townsfolk.get(folk, e.o);
            if (late) lines.push(`My first ${Townsfolk.kinWord(late, 'spouse')}, ${late.first}, died ${Townsfolk.when(e.d, world)} — ${e.x}.`);
        }
        const kids = p.kids.map(id => Townsfolk.get(folk, id)).filter(Boolean);
        const home = kids.filter(Townsfolk.isHere);
        if (home.length) {
            lines.push(home.length === 1
                ? `Our ${Townsfolk.kinWord(home[0], 'child')} ${home[0].first} is ${Townsfolk.age(home[0], day)}.`
                : `We have ${home.length} at home: ${home.map(k => `${k.first} (${Townsfolk.age(k, day)})`).join(', ')}.`);
        }
        for (const k of kids.filter(k => k.away && k.died == null)) {
            lines.push(k.away.withPlayer ? `${k.first} is away — ${k.away.to}. You'd know better than I how they fare.` : `${k.first} went off to ${k.away.to}.`);
        }
        for (const k of kids.filter(k => k.died != null)) lines.push(`We lost ${k.first} ${Townsfolk.when(k.died, world)}.`);
        for (const par of p.parents.map(id => Townsfolk.get(folk, id)).filter(Boolean)) {
            const kin = Townsfolk.kinWord(par, 'parent');
            if (par.died != null) lines.push(`My ${kin} ${par.first} passed ${Townsfolk.when(par.died, world)}.`);
            else if (Townsfolk.isHere(par)) lines.push(`My ${kin} ${par.first} is ${Townsfolk.age(par, day)} and still with us.`);
        }
        const sibs = Townsfolk.siblings(folk, p).filter(Townsfolk.isHere);
        if (sibs.length) lines.push(`My ${sibs.length === 1 ? Townsfolk.kinWord(sibs[0], 'sibling') : 'kin'} ${sibs.map(s => s.first).join(' and ')} ${sibs.length === 1 ? 'lives' : 'live'} here too.`);
        if (p.namedFor != null) {
            const n = Townsfolk.get(folk, p.namedFor);
            if (n) lines.push(`I'm named for my grand${p.gender === 'female' ? 'mother' : 'father'}, ${n.first}.`);
        }
        if (!lines.length) return null;
        return `We're the ${p.last} family. ` + lines.join(' ');
    },
};
