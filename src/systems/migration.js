// ============================================
// MIGRATION — families on the move between the towns
// ============================================
// The weekly movement of people is worked out by systems/labour.js: refugees
// flee danger and famine for safer linked towns (and go home when it passes),
// and each class drifts along the trade links toward the town where it fares
// better (its labour welfare: food, work, the wage against bread, safety,
// taxes). This system is the rest of migration, hooked into that week:
//
//   PUSH & PULL — what the labour welfare does not count: the plague (a
//     plagued town's people flee, as from a siege; a quarantined one can't),
//     crime, harsh laws (a curfew, harsh punishments), a town's prosperity
//     (SettlementWealth), its contentment under its ruler, and kin — people
//     follow those who went before (settlement.migr.kin, decaying).
//   THE PLAYER'S POLICY over the towns they rule (world.migration.policy):
//     settlers' grants (1g a head) or land and grants (2g a head) draw more
//     settlers, the coin going into the town's purse as they spend it; gates
//     open, refugees only, or closed (refugees turned back at the gates).
//     Lower taxes already draw people through the welfare.
//   REAL HOUSEHOLDS — a town's roster (systems/townsfolk.js) stands for its
//     people, so with every (population ÷ roster) who move a whole household
//     of named people goes too: marked away in the old town, and written into
//     the new one's roster (new ids; spouse, children, trade skills,
//     literacy, purse carried; the trade is found anew). A town with no
//     roster sends none; one that receives from a town without a roster gets
//     newcomer families. The roster's usual size follows the population
//     (folk.mScale), so a town that has doubled has twice the people about.
//   COLUMNS — a big week's flow walks the roads as a party on the world map
//     (a world unit of type 'migrants', `daysPerHex` a hex); its households
//     reach their new town's roster when it arrives.
//   TREND — every town's head count is sampled (settlement.migr.h), its
//     comings and goings logged with the reason (settlement.migr.log, the
//     year's totals by reason in migr.yr); a town well below its peak stands
//     with houses empty (migr.vac — weathered and boarded on the street map,
//     world/townEras.js), one that has grown with new-built ones (migr.fresh).
//   SIZE — a town's class follows its people (village ↔ town ↔ city, held
//     for a few samples first; capitals never change): _resize.
//   PEOPLE YOU KNOW — may move too (slower to; not those courted, wed,
//     sworn or in the player's service). The player is told; their memory
//     of the player goes with them, their old record points on to the new
//     one (Relationships.folkPerson follows it) and their relationship NPC
//     moves home with them: _forward.
//   FALLING ON A COLUMN — PlayerMilitary.attackUnit → onAttacked: purses
//     taken, a share slain (never arriving), murder before the realm.
//   NEWS — big shifts on world.migration.flows (the realm view); notices
//     only for the player's own towns (a monthly digest, refugees turned
//     back, a column arriving) — labour.js already tells of refugees.
//
// Deterministic: draws no shared RNG (a hash stream of the world seed, the
// town and the day picks households and names). Tuned in data/migration.json.
// State: world.migration (saved by systems/saveLoad.js), settlement.migr and
// folk.mScale/mBase/mPop (saved with the tile), the columns in world.units.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { WorldUnit } from '../world/units.js';
import { Economy } from '../world/economy.js';
import { SettlementWealth } from '../world/settlementWealth.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { WorldEvents } from '../world/worldEvents.js';
import { Townsfolk } from './townsfolk.js';
import { Crises } from './crises.js';
import { Illness } from './illness.js';
import { Laws } from './laws.js';
import { NightStreets } from './nightStreets.js';
import { Ledger } from './ledger.js';
// (how bad the sickness is in a town, its gates shut: systems/plague.js)
import { Plague } from './plague.js';
import { Taxation } from './marketDynamics.js';
import { Relationships } from './relationships.js';
import { Underworld } from './underworld.js';

export const MIGRANT_TYPE = 'migrants';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _key = (q, r) => `${q},${r}`;
const _r2 = (v) => Math.round(v * 100) / 100;

const DEFAULTS = {
    enabled: true,
    pull: { plague: 0.09, crime: 0.05, laws: 0.025, prosperity: 0.05, reputation: 0.025, kin: 0.02, kinPer: 0.002, kinFade: 0.9, plagueRefugee: 0.7 },
    policy: {
        settlers: {
            none: { label: 'No grants', pull: 0, cost: 0 },
            grants: { label: "Settlers' grants", pull: 0.04, cost: 1 },
            land: { label: 'Land and grants', pull: 0.08, cost: 2 },
        },
        borders: { open: { label: 'Open gates' }, refugees: { label: 'Refugees only' }, closed: { label: 'Closed borders' } },
    },
    folk: { minHousehold: 1, maxHouseholdsWeek: 3, scaleMin: 0.5, scaleMax: 2.2 },
    columns: { min: 25, max: 14, minDistance: 2, daysPerHex: 2, maxDays: 80, refugeeIcon: '🧳', migrantIcon: '🎒' },
    trend: { sampleDays: 30, keep: 48, logKeep: 14, growing: 0.03, shrinking: -0.03 },
    houses: { lossFree: 0.1, growFree: 0.1, perLoss: 0.8, maxVacant: 0.35, perGrowth: 0.6, maxNew: 0.25, peakDecay: 0.002 },
    news: { bigShift: 120, keep: 40, noticeShare: 0.05 },
    known: { stayBias: 0.45, noticesWeek: 2 },
    size: { enabled: true, town: 650, city: 5000, cityToTown: 3500, townToVillage: 300, months: 3 },
    attack: {
        killShare: 0.3, karma: { refugees: -12, migrants: -8, return: -8 }, crime: 'murder', reputation: 15,
        kinFear: 0.5, failKarma: -3, failCrime: 'assault', failReputation: 5,
    },
    reasons: {},
};

// The fields of a townsperson that travel with them (ids and town-bound state are remade)
// (what they think of the player and remember of them goes too: mem, nm, rnpc)
const CARRY = ['first', 'last', 'maiden', 'gender', 'born', 'role', 'retired', 'traits', 'practiceSkills', 'literacy',
    'purse', 'devout', 'imm', 'diet', 'youth', 'wedDay', 'culture', 'tongue', 'langs', 'look', 'looks', 'faith',
    'mem', 'nm', 'nmSaid', 'rnpc'];
// A household with any of these stays put (the player's people, wards, the court, protégés)
const STAY = ['wedHouse', 'ward', 'court', 'office', 'steward', 'agent', 'protegeOf'];

let _cfgSrc;
let _cfg = null;

/** A hash stream in [0, 1) of the world seed and its parts (no shared RNG is drawn). */
function _rng(world, ...parts) {
    const seed = (world && world.generationParams && world.generationParams.seed) || 1;
    let s = (Utils.hashStr(`${seed}|mig|${parts.join('|')}`) >>> 0) || 1;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

function _merge(base, over) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
        if (k.startsWith('_')) continue;
        out[k] = _obj(v) && _obj(base[k]) ? _merge(base[k], v) : v;
    }
    return out;
}

/** The context of a week that moves no one (migration off, or no world). */
const NULL_WEEK = {
    on: false,
    push: () => 0, pull: () => 0, pair: () => 0, plague: () => 0,
    admits: () => true, sealed: () => false, reason: () => 'better', flow: () => {},
};

export const Migration = {
    MIGRANT_TYPE,

    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.migration : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            _cfg = _merge(DEFAULTS, _obj(src) || {});
        }
        return _cfg;
    },

    on() { return Migration.config().enabled !== false; },

    // ── State ─────────────────────────────────────────────

    /** World record: { policy: { settlers, borders }, flows: [...], refused: {}, lastDigest }. */
    state(world) {
        if (!world) return null;
        let st = world.migration;
        if (!_obj(st)) st = world.migration = {};
        if (!_obj(st.policy)) st.policy = { settlers: 'none', borders: 'open' };
        if (!Array.isArray(st.flows)) st.flows = [];
        if (!_obj(st.refused)) st.refused = {};
        return st;
    },

    serialize(world) {
        const st = world && _obj(world.migration);
        return st ? JSON.parse(JSON.stringify(st)) : null;
    },

    restore(saved, world) {
        if (!world) return;
        world.migration = _obj(saved) ? JSON.parse(JSON.stringify(saved)) : {};
        Migration.state(world);
    },

    /** A town's record: { h: [[day, pop]], log: [...], yr: { y, in, out, why }, kin: { 'q,r': n }, peak, vac, fresh }. */
    town(s) {
        if (!s || typeof s !== 'object') return null;
        let m = s.migr;
        if (!_obj(m)) m = s.migr = {};
        if (!Array.isArray(m.h)) m.h = [];
        if (!Array.isArray(m.log)) m.log = [];
        if (!_obj(m.kin)) m.kin = {};
        return m;
    },

    policy(world) {
        const st = Migration.state(world);
        const P = Migration.config().policy;
        return {
            settlers: P.settlers[st.policy.settlers] ? st.policy.settlers : 'none',
            borders: P.borders[st.policy.borders] ? st.policy.borders : 'open',
        };
    },

    /** Set the player's settlers ('none'|'grants'|'land') or borders ('open'|'refugees'|'closed') policy. */
    setPolicy(world, kind, value) {
        const st = Migration.state(world);
        const P = Migration.config().policy;
        if (kind === 'settlers' && P.settlers[value]) st.policy.settlers = value;
        else if (kind === 'borders' && P.borders[value]) st.policy.borders = value;
        else return false;
        return true;
    },

    reasonDef(id) {
        const R = Migration.config().reasons || {};
        return R[id] || { icon: '➡️', push: id, pull: id, short: id };
    },

    // ── What drives people ────────────────────────────────

    /** How badly the plague holds the town (0..1). */
    plagueAt(world, s, day = null) {
        if (!world || !s) return 0;
        const d = day == null ? _num(world.day) : day;
        let v = 0;
        // The plague system's own reading of the town's sickness (systems/plague.js)
        if (Plague && typeof Plague.severityAt === 'function') {
            try { return _r2(_clamp(_num(Plague.severityAt(world, s, d)), 0, 1)); } catch (e) { /* read it ourselves */ }
        }
        try {
            const c = Crises.active(world);
            const t = c && c.kind === 'plague' && c.data && c.data.towns ? c.data.towns[_key(s.q, s.r)] : null;
            if (t && _num(t.end, -1) >= d) v = Math.max(v, 0.7);
        } catch (e) { /* no crisis */ }
        const sick = _obj(s.sickness);
        if (sick && sick.k === 'plague' && (_num(sick.until, -1) >= d || d - _num(sick.d, -1e9) <= 21)) v = Math.max(v, 0.5);
        const folk = _obj(s.folk);
        if (folk && Array.isArray(folk.people)) {
            let n = 0, ill = 0;
            for (const p of folk.people) {
                if (p.died != null || p.away) continue;
                n++;
                if (p.ill && p.ill.k === 'plague' && _num(p.ill.end, -1) >= d) ill++;
            }
            if (n > 0 && ill > 0) v = Math.max(v, Math.min(1, ill / n * 4));
        }
        if (v < 0.5) {
            try {
                if (WorldEvents.getEventsAt(world, { q: s.q, r: s.r, settlement: s, kingdom: s.kingdom }).some(e => e && e.id === 'plague')) v = Math.max(v, 0.5);
            } catch (e) { /* no events */ }
        }
        return _r2(v);
    },

    /** How harsh the laws are on the town's people (0..1): a curfew, harsh punishment. */
    harshness(world, s) {
        let h = 0;
        try { if (NightStreets.curfew(world, s).active) h += 0.5; } catch (e) { /* none */ }
        try { if (s.kingdom != null) h += Math.max(0, Laws.punishment(world, s.kingdom).deter - 1) * 0.5; } catch (e) { /* none */ }
        return _clamp(h, 0, 1);
    },

    /** The factors of a town this week (plain numbers, 0..1 unless said). */
    factors(world, s, ctx = null) {
        const lab = s.labour || {};
        const m = s.market || {};
        const ruled = ctx && ctx.ruled ? ctx.ruled.has(_key(s.q, s.r)) : false;
        const tax = ruled && ctx.taxRate != null ? _clamp((ctx.taxRate - 0.15) * 3, 0, 1) : 0;
        let atWar = false;
        try {
            const k = s.kingdom != null && typeof world.getKingdom === 'function' ? world.getKingdom(s.kingdom) : null;
            atWar = !!(k && Array.isArray(k.wars) && k.wars.length);
        } catch (e) { atWar = false; }
        return {
            danger: _num(lab.danger), atWar,
            famine: _clamp(_num(m.short && m.short.food), 0, 1),
            plague: Migration.plagueAt(world, s, ctx ? ctx.day : null),
            crime: _clamp(_num(lab.crime), 0, 1),
            idle: _clamp(_num(lab.idleAll), 0, 1),
            crowd: _clamp(_num(lab.idle && lab.idle.land), 0, 1),
            laws: Migration.harshness(world, s),
            tax,
            wealth: SettlementWealth.score(s),
            content: _clamp((_num(s.happiness, 50) - 50) / 50, -1, 1),
            wage: _num(lab.wage && lab.wage.craft),
            ruled,
        };
    },

    /** The draw of kin from `a` already settled in `b` (welfare units). */
    kinPull(a, b) {
        const P = Migration.config().pull;
        const kin = _num(b && b.migr && b.migr.kin && b.migr.kin[_key(a.q, a.r)]);
        return kin > 0 ? Math.min(_num(P.kin, 0.02), _num(P.kinPer, 0.002) * Math.sqrt(kin)) : 0;
    },

    // ── The week (driven from systems/labour.js) ──────────

    /**
     * The week's context for the labour week's movement of people: extra
     * pushes and pulls, which towns admit newcomers, and a sink for the
     * flows. `ruled`: the keys of the towns the player rules.
     */
    week(world, player, lives, ruled, day) {
        if (!world || !Migration.on()) return NULL_WEEK;
        const C = Migration.config();
        const P = C.pull;
        const pol = Migration.policy(world);
        const settlers = C.policy.settlers[pol.settlers] || {};
        let taxRate = null;
        if (player) {
            const t = Taxation.TAX_RATES[String(player.taxRate || 'moderate').toUpperCase()];
            taxRate = t ? t.rate : null;
        }
        const ctx = { day, ruled: ruled || new Set(), taxRate, player };
        const fac = new Map();
        const F = (s) => {
            let f = fac.get(s);
            if (!f) { f = Migration.factors(world, s, ctx); fac.set(s, f); }
            return f;
        };
        const pulls = new Map();
        const isRuled = (s) => ctx.ruled.has(_key(s.q, s.r));
        // (its gates shut against the sickness: systems/plague.js; else the realm's quarantine over a plagued town)
        const sealed = (s) => (Plague && typeof Plague.isQuarantined === 'function' ? Plague.isQuarantined(world, s) : F(s).plague >= 0.3 && Illness.quarantined(world, s));
        const flows = new Map();
        const refused = new Map();
        const week = {
            on: true, day, world, player, ctx, flows, refused, factors: F, pol,
            /** Plague drives people out like danger (0..1, the refugees' distress). */
            push: (s) => F(s).plague * _num(P.plagueRefugee, 0.7),
            plague: (s) => F(s).plague,
            /** Extra draw of a town on top of its welfare. */
            pull: (s) => {
                if (pulls.has(s)) return pulls.get(s);
                const f = F(s);
                let v = -f.plague * _num(P.plague) - f.crime * _num(P.crime) - f.laws * _num(P.laws)
                    + (f.wealth - 0.5) * 2 * _num(P.prosperity) + f.content * _num(P.reputation);
                if (isRuled(s)) v += _num(settlers.pull);
                pulls.set(s, v);
                return v;
            },
            /** Kin draw along a link: positive favours b. */
            pair: (a, b) => Migration.kinPull(a, b) - Migration.kinPull(b, a),
            /** Does `t` let newcomers settle? (refugee: those fleeing) */
            admits: (t, refugee = false) => {
                if (sealed(t)) return false;
                if (!isRuled(t)) return true;
                const b = pol.borders;
                const ok = b === 'open' || (b === 'refugees' && refugee);
                if (!ok) refused.set(t, (refused.get(t) || 0) + 1);
                return ok;
            },
            /** A quarantined plague town: no one leaves or comes. */
            sealed,
            reason: (from, to, stratum) => Migration.reason(F(from), F(to), from, to, stratum, isRuled(to) && _num(settlers.pull) > 0),
            flow: (from, to, n, kind, why) => {
                if (!from || !to || !(n > 0)) return;
                const k = `${_key(from.q, from.r)}>${_key(to.q, to.r)}`;
                let f = flows.get(k);
                if (!f) { f = { from, to, n: 0, kind, why: {} }; flows.set(k, f); }
                f.n += n;
                if (kind === 'refugees') f.kind = 'refugees';
                else if (f.kind !== 'refugees' && kind === 'return') f.kind = f.kind || 'return';
                f.why[why || 'better'] = _num(f.why[why || 'better']) + n;
            },
        };
        return week;
    },

    /** Why a class leaves `from` for `to` (a reason id), from the two towns' factors. */
    reason(ff, ft, from, to, stratum, grants = false) {
        const c = [
            [ff.danger >= 0.15 ? (ff.atWar ? 'war' : 'danger') : null, ff.danger * 1.2],
            ['plague', ff.plague * 1.3],
            ['famine', ff.famine * 1.2],
            ['taxes', ff.tax * 0.7],
            ['crime', (ff.crime - ft.crime) * 0.9],
            ['laws', (ff.laws - ft.laws) * 0.5],
            ['crowding', ff.crowd * 0.9],
            ['idle', (ff.idle - ft.idle) * 1.1],
            ['wages', ff.wage > 0 && ft.wage > ff.wage ? Math.min(1, (ft.wage / ff.wage - 1) * 1.5) : 0],
            ['prosperity', (ft.wealth - ff.wealth) * 0.8],
            ['grants', grants ? 0.35 : 0],
            ['kin', Migration.kinPull(from, to) * 5],
        ];
        let best = 'better', bv = 0.06;
        for (const [id, v] of c) if (id && v > bv) { best = id; bv = v; }
        return best;
    },

    /**
     * After the labour week: the flows logged on both towns, households
     * moved, columns set on the roads, grants paid, news and notices.
     */
    endWeek(world, player, week, out) {
        if (!week || !week.on || !world) return;
        const C = Migration.config();
        const st = Migration.state(world);
        const day = week.day;
        const year = Math.floor(_num(world.year, 0));
        const settlers = C.policy.settlers[week.pol.settlers] || {};
        let grantDue = 0;
        const grantTo = [];
        const flows = [...week.flows.values()].sort((a, b) => b.n - a.n);
        let cols = (world.units || []).filter(u => u && u.type === MIGRANT_TYPE && !u.destroyed).length;
        const told = { n: 0 };
        for (const f of flows) {
            const { from, to, n } = f;
            const why = Object.entries(f.why).sort((a, b) => b[1] - a[1])[0][0];
            const kind = f.kind || 'migrants';
            Migration._log(from, { d: day, o: 1, n, t: to.name, q: to.q, r: to.r, w: why, k: kind }, year);
            Migration._log(to, { d: day, i: 1, n, t: from.name, q: from.q, r: from.r, w: why, k: kind }, year);
            if (kind !== 'return') {
                const kin = Migration.town(to).kin;
                const fk = _key(from.q, from.r);
                kin[fk] = Math.round(_num(kin[fk]) + n);
            }
            // The households who go
            const moved = Migration._moveFolk(world, from, to, n, why, kind, day, player);
            if (player) Migration._toldOfKnown(moved, to, why, out, told);
            // A big flow walks the roads
            const far = Hex.wrappingOffsetDistance(from.q, from.r, to.q, to.r, world.width || 1e9);
            if (n >= _num(C.columns.min, 25) && far >= _num(C.columns.minDistance, 2) && cols < _num(C.columns.max, 14)) {
                Migration._spawnColumn(world, from, to, n, kind, why, moved, day);
                cols++;
            } else if (moved.length) {
                Migration._place(world, to, moved, from, day, player);
            }
            // Grants to the settlers in the player's towns
            if (player && kind !== 'return' && week.ctx.ruled.has(_key(to.q, to.r)) && _num(settlers.cost) > 0) {
                grantDue += n * _num(settlers.cost);
                grantTo.push([to, n * _num(settlers.cost)]);
            }
            if (n >= _num(C.news.bigShift, 120)) {
                st.flows.push({ d: day, y: year, from: from.name, to: to.name, fq: from.q, fr: from.r, tq: to.q, tr: to.r, n, w: why, k: kind });
            }
        }
        if (st.flows.length > _num(C.news.keep, 40)) st.flows.splice(0, st.flows.length - _num(C.news.keep, 40));
        // Pay the grants (into the towns' purses: the settlers spend them there)
        if (grantDue > 0 && player) {
            const gold = _num(player.gold);
            if (gold >= grantDue) {
                player.gold = _r2(gold - grantDue);
                Ledger.record(player, 'settlerGrants', -grantDue);
                for (const [t, g] of grantTo) Economy.payTown(t, g);
            } else {
                st.policy.settlers = 'none';
                out.notices.push({ icon: '📜', title: 'Grants Lapse', text: `Your purse could not meet the settlers' grants (${Math.round(grantDue)}g this week). The offer lapses; settlers come as they please.`, type: 'warning' });
            }
        }
        // Refugees turned back at closed gates (a notice at most once a month)
        for (const [t, k] of week.refused) {
            const key = _key(t.q, t.r);
            if (!(k > 0) || day - _num(st.refused[key], -1e9) < 30) continue;
            st.refused[key] = day;
            if (player) {
                out.notices.push({ icon: '🚧', title: 'Turned Back', text: `Newcomers seeking to settle in ${t.name} were turned back at the gates on your orders.`, type: 'info' });
            }
        }
    },

    /** A word to the player when people they have dealt with move away (a few a week at most). */
    _toldOfKnown(moved, to, why, out, told) {
        const cap = Math.max(0, _num(Migration.config().known.noticesWeek, 2));
        for (const h of moved) {
            if (!h || !Array.isArray(h.known) || !h.known.length || told.n >= cap) continue;
            told.n++;
            const R = Migration.reasonDef(h.why || why);
            const names = h.known.map(k => k.name);
            const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
            const fam = h.people && h.people.length > h.known.length ? ' with their household' : '';
            const cause = R.push || R.pull || 'for a better life';
            out.notices.push({ icon: '🎒', title: 'Moved Away', text: `${who}, whom you know, ${names.length === 1 ? 'has' : 'have'} left ${h.from.name}${fam} for ${to.name} — ${cause}. You may find them there.`, type: 'info' });
        }
    },

    /** Log a coming or going on a town (merged with the same week's from the same place). */
    _log(s, e, year) {
        const C = Migration.config();
        const m = Migration.town(s);
        const last = m.log.find(x => x.q === e.q && x.r === e.r && !!x.i === !!e.i && e.d - x.d < 7 && x.w === e.w);
        if (last) last.n += e.n;
        else m.log.push(e);
        const keep = _num(C.trend.logKeep, 14);
        if (m.log.length > keep) m.log.splice(0, m.log.length - keep);
        if (!_obj(m.yr) || m.yr.y !== year) m.yr = { y: year, in: 0, out: 0, why: {} };
        if (e.i) m.yr.in += e.n; else m.yr.out += e.n;
        const w = (e.i ? '+' : '-') + e.w;
        m.yr.why[w] = _num(m.yr.why[w]) + e.n;
    },

    // ── Households ────────────────────────────────────────

    /** The town's households of residents: [[person, ...]] (by p.hh; else a couple and their little ones). */
    households(folk, day) {
        const res = Townsfolk.residents(folk);
        const by = new Map();
        const loose = [];
        for (const p of res) {
            if (p.hh != null) {
                if (!by.has(p.hh)) by.set(p.hh, []);
                by.get(p.hh).push(p);
            } else loose.push(p);
        }
        const out = [...by.values()];
        const used = new Set();
        for (const p of loose) {
            if (used.has(p)) continue;
            const g = [p];
            used.add(p);
            const sp = p.spouse != null ? loose.find(x => x.id === p.spouse) : null;
            if (sp && !used.has(sp)) { g.push(sp); used.add(sp); }
            for (const x of loose) {
                if (used.has(x) || Townsfolk.age(x, day) >= 16) continue;
                if ((x.parents || []).some(id => g.some(a => a.id === id))) { g.push(x); used.add(x); }
            }
            out.push(g);
        }
        return out;
    },

    /**
     * May this household up and leave? Not the player's own people (wards,
     * the court, protégés, those they employ), nor anyone they court or are
     * sworn to, the sick or the noble. People they merely know may go — less
     * readily (Migration._knownTo) — and the player hears of it.
     */
    _mayGo(g, day, player = null) {
        if (!g.length) return false;
        if (!g.some(p => Townsfolk.age(p, day) >= 17)) return false;
        for (const p of g) {
            for (const k of STAY) if (p[k] != null && p[k] !== false) return false;
            if (Migration._tiedTo(player, p)) return false;
            if (p.role === 'noble' || p.role === 'priest') return false;
            if (p.job && (p.job.employer === 'player' || p.job.hired)) return false;
            if (p.ill && _num(p.ill.end, -1) >= day) return false;
        }
        return true;
    },

    /** The relationship NPC behind a townsperson, if the player has come to know them. */
    _npcOf(p) {
        if (!p || p.rnpc == null) return null;
        return (Relationships._npcs || []).find(n => n.id === p.rnpc) || null;
    },

    /** Is this person bound to the player too closely to move away (courted, wed, sworn, mentor)? */
    _tiedTo(player, p) {
        const npc = Migration._npcOf(p);
        if (!npc) return false;
        if (npc.isRomantic || npc.isMarried) return true;
        if (!player) return false;
        if (player.spouse === npc.id) return true;
        if (Array.isArray(player.travelParty) && player.travelParty.includes(npc.id)) return true;
        const rel = player.relationships && player.relationships[npc.id];
        if (rel && (rel.isRomantic || rel.isLover || rel.betrothed)) return true;
        const bonds = player.bonds && Array.isArray(player.bonds.list) ? player.bonds.list : [];
        const b = bonds.find(x => x.npcId === npc.id);
        return !!(b && (b.sworn || b.kind === 'mentor' || b.kind === 'protege'));
    },

    /** Has the player dealt with this person (spoken with them, or come to know them)? */
    _knownTo(p) {
        return !!(p && ((p.mem && _num(p.mem.timesSpoken) > 0) || p.rnpc != null));
    },

    /**
     * Move the households a flow of `n` takes from `from`'s roster (marked
     * away), or make newcomer families for `to` when `from` keeps none.
     * → [{ people: [clone], from }] to write into `to`'s roster.
     */
    _moveFolk(world, from, to, n, why, kind, day, player = null) {
        const C = Migration.config().folk;
        const ff = _obj(from.folk) && Array.isArray(from.folk.people) ? from.folk : null;
        const tf = _obj(to.folk) && Array.isArray(to.folk.people) ? to.folk : null;
        const out = [];
        const maxH = Math.max(0, Math.floor(_num(C.maxHouseholdsWeek, 3)));
        if (ff) {
            const res = Townsfolk.residents(ff).length;
            const popBefore = Math.max(1, _num(from.population) + n);
            let debt = _num(ff.migOut) + n * res / popBefore;
            const rng = _rng(world, from.q, from.r, day, 'out');
            // (households the player knows are slower to go: they have a friend here)
            const bias = _num(Migration.config().known.stayBias, 0.45);
            const hs = Migration.households(ff, day).filter(g => Migration._mayGo(g, day, player))
                .map(g => ({ g, k: rng() + (g.some(Migration._knownTo) ? bias : 0) })).sort((a, b) => a.k - b.k).map(x => x.g);
            let count = 0;
            while (debt >= _num(C.minHousehold, 1) && hs.length && count < maxH) {
                const i = hs.findIndex(g => g.length <= debt + 1);
                const g = hs.splice(i >= 0 ? i : 0, 1)[0];
                debt -= g.length;
                count++;
                out.push(Migration._leave(world, ff, g, from, to, why, kind, day));
            }
            ff.migOut = _r2(_clamp(debt, 0, 6));
            if (out.length) delete ff._index;
        } else if (tf) {
            const res = Townsfolk.residents(tf).length;
            let debt = _num(tf.migIn) + n * res / Math.max(1, _num(to.population));
            const rng = _rng(world, to.q, to.r, day, 'in', from.q, from.r);
            let count = 0;
            while (debt >= 2 && count < maxH) {
                const fam = Migration._newFamily(world, tf, from, day, rng);
                debt -= fam.length;
                count++;
                out.push({ people: null, made: fam.map(p => p.id), from: { q: from.q, r: from.r, name: from.name } });
            }
            tf.migIn = _r2(_clamp(debt, 0, 6));
        }
        return out;
    },

    /** A household leaves its town's roster: marked away, its clone ready for the new one. */
    _leave(world, ff, g, from, to, why, kind, day) {
        const head = g.slice().sort((a, b) => Townsfolk.age(b, day) - Townsfolk.age(a, day))[0];
        const people = [];
        for (const p of g) {
            p.away = { d: day, to: to.name, mig: 1, q: to.q, r: to.r };
            Townsfolk._log(p, day, 'left', null, to.name);
            const c = { oid: p.id, spouse: p.spouse, parents: (p.parents || []).slice(), kids: (p.kids || []).slice() };
            for (const k of CARRY) if (p[k] !== undefined) c[k] = JSON.parse(JSON.stringify(p[k]));
            if (p.preg && _obj(p.preg)) c.preg = { ...p.preg, f: g.some(x => x.id === p.preg.f) ? p.preg.f : null };
            // (the purse goes with them: it is theirs)
            if (p.purse !== undefined) p.purse = 0;
            people.push(c);
        }
        try { Townsfolk._annal(ff, world, day, { k: 'left', a: head.id, x: to.name }, []); } catch (e) { /* no annals */ }
        // Those the player has dealt with: the player hears they have gone
        const known = g.filter(Migration._knownTo).map(p => ({ oid: p.id, name: Townsfolk.name(p) }));
        const h = { people, from: { q: from.q, r: from.r, name: from.name, culture: from.culture || null }, head: head.id, why, kind };
        if (known.length) h.known = known;
        return h;
    },

    /** Newcomer family for a roster (from a town without one): a couple, perhaps children. */
    _newFamily(world, tf, from, day, rng) {
        const age = 19 + Math.floor(rng() * 24);
        const a = Townsfolk._newcomer(tf, day, rng, { age, from: from.name });
        const fam = [a];
        if (rng() < 0.6) {
            const b = Townsfolk._newcomer(tf, day, rng, {
                gender: a.gender === 'male' ? 'female' : 'male', age: Math.max(18, age - 3 + Math.floor(rng() * 7)), from: from.name, last: a.last,
            });
            Townsfolk._wed(tf, a, b, day, true);
            fam.push(b);
            const kids = age >= 24 ? Math.floor(rng() * 3) : 0;
            const Y = Townsfolk.config().daysPerYear;
            for (let i = 0; i < kids; i++) {
                const ka = 1 + Math.floor(rng() * Math.min(14, age - 19));
                const k = Townsfolk._newcomer(tf, day, rng, { age: ka, from: from.name, last: a.last, role: 'child' });
                k.born = Math.max(k.born, a.born + 18 * Y, b.born + 18 * Y);
                const mum = a.gender === 'female' ? a : b, dad = mum === a ? b : a;
                k.parents = [dad.id, mum.id];
                mum.kids.push(k.id);
                dad.kids.push(k.id);
                fam.push(k);
            }
        }
        for (const p of fam) p.mig = { d: day, from: from.name };
        delete tf._index;
        try { Townsfolk._annal(tf, world, day, { k: 'arrived', a: a.id, x: from.name }, []); } catch (e) { /* no annals */ }
        return fam;
    },

    /** Write moved households into the new town's roster (new ids; kin kept within the household). */
    _place(world, to, moved, from, day, player = null) {
        const tf = _obj(to.folk) && Array.isArray(to.folk.people) ? to.folk : null;
        if (!tf) return 0;
        let placed = 0;
        for (const h of moved) {
            if (!h || !Array.isArray(h.people)) continue;
            const ids = new Map();
            for (const c of h.people) ids.set(c.oid, tf.n++);
            const fromName = (h.from && h.from.name) || (from && from.name) || 'elsewhere';
            for (const c of h.people) {
                const p = { id: ids.get(c.oid), died: null, cause: null, away: null, log: [], traits: [] };
                for (const k of CARRY) if (c[k] !== undefined) p[k] = c[k];
                p.spouse = ids.has(c.spouse) ? ids.get(c.spouse) : null;
                p.parents = (c.parents || []).filter(id => ids.has(id)).map(id => ids.get(id));
                p.kids = (c.kids || []).filter(id => ids.has(id)).map(id => ids.get(id));
                if (c.preg) p.preg = { ...c.preg, f: ids.has(c.preg.f) ? ids.get(c.preg.f) : null };
                // (their culture, where they came from abroad: their names say so)
                if (h.from && h.from.culture && tf.culture && h.from.culture !== tf.culture && !p.culture) p.culture = h.from.culture;
                p.from = { q: h.from ? h.from.q : null, r: h.from ? h.from.r : null, id: c.oid, town: fromName };
                p.mig = { d: day, from: fromName, w: h.why || null };
                p.log.push({ d: day, k: 'arrived', x: fromName });
                if (!Array.isArray(p.traits)) p.traits = [];
                tf.people.push(p);
                placed++;
                Migration._forward(world, h.from, c.oid, to, tf, p, player);
            }
            const head = ids.get(h.head);
            if (head != null) {
                try { Townsfolk._annal(tf, world, day, { k: 'arrived', a: head, x: fromName }, []); } catch (e) { /* no annals */ }
            }
        }
        if (placed) delete tf._index;
        return placed;
    },

    /**
     * A person has settled in their new town: their old record points on to
     * the new one (Relationships.folkPerson follows it, so every "q,r#id"
     * reference — bonds, letters, grudges, quests — still finds them), and the
     * relationship NPC the player knows them by moves home with them.
     */
    _forward(world, fromRef, oid, to, tf, p, player = null) {
        const ft = fromRef && fromRef.q != null && typeof world.getTile === 'function' ? world.getTile(fromRef.q, fromRef.r) : null;
        const ff = ft && ft.settlement && _obj(ft.settlement.folk);
        const old = ff && Array.isArray(ff.people) ? Townsfolk.get(ff, oid) : null;
        if (old && old.away && old.away.mig) old.away.nid = p.id;
        if (p.rnpc == null) return;
        const npc = Migration._npcOf(p);
        if (!npc) { delete p.rnpc; return; }
        const oldUid = npc.folkUid;
        npc.folkUid = `${tf.q != null ? tf.q : to.q},${tf.r != null ? tf.r : to.r}#${p.id}`;
        npc.settlementName = to.name;
        npc.settlementQ = to.q;
        npc.settlementR = to.r;
        npc.kingdomId = to.kingdom != null ? to.kingdom : null;
        npc.movedFrom = fromRef ? fromRef.name : null;
        if (old) delete old.rnpc;
        // (a mentor's or protégé's uid on the player's bonds, if it named the old one)
        const bonds = player && player.bonds && Array.isArray(player.bonds.list) ? player.bonds.list : [];
        for (const b of bonds) if (b.folkUid === oldUid) b.folkUid = npc.folkUid;
    },

    // ── Columns on the roads ──────────────────────────────

    _spawnColumn(world, from, to, n, kind, why, moved, day) {
        const C = Migration.config().columns;
        const refugee = kind === 'refugees';
        const unit = Object.assign(Object.create(WorldUnit.prototype), {
            type: MIGRANT_TYPE,
            id: `mig_${(Utils.hashStr(`${from.q},${from.r}>${to.q},${to.r}@${day}`) >>> 0).toString(36)}`,
            q: from.q, r: from.r, sourceQ: from.q, sourceR: from.r, targetQ: to.q, targetR: to.r,
            path: [], destroyed: false, age: 0, maxAge: 1e9, speed: 0, inventory: {}, strength: Math.max(1, Math.round(n / 15)),
            icon: refugee ? C.refugeeIcon : C.migrantIcon,
            name: refugee ? `Refugees from ${from.name}` : kind === 'return' ? `Homecomers to ${to.name}` : `Settlers from ${from.name}`,
            population: n, migKind: kind, why, fromName: from.name, toName: to.name,
            start: day, next: day + Math.max(1, _num(C.daysPerHex, 2)), households: moved,
        });
        if (!Array.isArray(world.units)) world.units = [];
        world.units.push(unit);
        return unit;
    },

    /** The column takes its day: a hex every daysPerHex, arriving at its new town. */
    _columnDay(world, player, u, day, out, ruled) {
        const C = Migration.config().columns;
        const atEnd = u.q === u.targetQ && u.r === u.targetR;
        if (!atEnd && day - _num(u.start, day) <= _num(C.maxDays, 80)) {
            if (day < _num(u.next, 0)) return;
            u.next = day + Math.max(1, _num(C.daysPerHex, 2));
            const W = world.width || 1e9;
            const cur = Hex.wrappingOffsetDistance(u.q, u.r, u.targetQ, u.targetR, W);
            let best = null, bd = cur, bestAny = null, bad = cur;
            for (const nb of Hex.neighbors(u.q, u.r)) {
                const q = typeof Hex.wrapQ === 'function' ? Hex.wrapQ(nb.q, W) : nb.q;
                const t = world.getTile(q, nb.r);
                if (!t) continue;
                const d = Hex.wrappingOffsetDistance(q, nb.r, u.targetQ, u.targetR, W);
                const land = !t.terrain || t.terrain.passable !== false;
                if (land && d < bd) { best = { q, r: nb.r }; bd = d; }
                if (d < bad) { bestAny = { q, r: nb.r }; bad = d; }
            }
            const step = best || bestAny;
            if (step) { u.q = step.q; u.r = step.r; }
            else { u.q = u.targetQ; u.r = u.targetR; }
            if (!(u.q === u.targetQ && u.r === u.targetR)) return;
        }
        // Arrived (or the road ran out: they settle where they meant to)
        u.destroyed = true;
        const tile = world.getTile(u.targetQ, u.targetR);
        const to = tile && tile.settlement;
        if (!to) return;
        const placed = Array.isArray(u.households) ? Migration._place(world, to, u.households, null, day, player) : 0;
        u.households = null;
        const mine = ruled.has(_key(to.q, to.r));
        const here = player && player.q === to.q && player.r === to.r;
        if (player && (mine || here)) {
            const R = Migration.reasonDef(u.why);
            const fam = placed ? ` Among them ${placed} you may meet in the streets.` : '';
            out.notices.push(u.migKind === 'refugees'
                ? { icon: '🧳', title: 'Refugees at the Gates', text: `A column of ${u.population} refugees from ${u.fromName} straggles into ${to.name}, ${R.push || 'fleeing'}.${fam}`, type: 'info' }
                : { icon: '🎒', title: 'Settlers Arrive', text: `${u.population} people from ${u.fromName} have come to settle in ${to.name} — ${R.pull || R.push || 'for a better life'}.${fam}`, type: 'info' });
        }
    },

    /**
     * The player fell on a column of migrants (PlayerMilitary.attackUnit).
     * Won: the coin in the households' purses is the player's, a share of the
     * column is cut down - the dead never reach their new town (its head
     * count falls; their old roster marks them slain on the road) - and the
     * rest straggle on into it now, telling of it. It is murder in the realm
     * they left (heat, a charge, a rumour: the survivors saw your face), both
     * towns' realms think the worse of you, and the road between the towns is
     * feared (the kin pull falls). Lost: the column beat you off - still an
     * assault, and they tell of it. `loot` (the attack's spoils) is added to.
     * -> a line for the chronicle.
     */
    onAttacked(player, world, u, won, loot = null) {
        if (!player || !world || !u || u.type !== MIGRANT_TYPE) return '';
        const A = Migration.config().attack || {};
        const day = _num(world.day);
        const fromTile = world.getTile(u.sourceQ, u.sourceR);
        const toTile = world.getTile(u.targetQ, u.targetR);
        const from = fromTile && fromTile.settlement;
        const to = toTile && toTile.settlement;
        const realm = (from && from.kingdom) || (to && to.kingdom) || Underworld._nearestKingdom(world, u.q, u.r);
        const what = u.migKind === 'refugees' ? 'refugees' : u.migKind === 'return' ? 'homecomers' : 'settlers';
        const victim = { name: `the ${what} of ${u.fromName}`, type: 'villager', icon: '🎒' };
        if (!won) {
            player.karma = Math.max(-100, _num(player.karma) + _num(A.failKarma, -3));
            Underworld.recordCrime(player, world, A.failCrime || 'assault', { kingdom: realm, caught: true, q: u.targetQ, r: u.targetR, victim });
            if (realm != null && player.reputation) player.reputation[realm] = _num(player.reputation[realm]) - _num(A.failReputation, 5);
            u.attackedBy = { d: day, won: false };
            return `The ${what} from ${u.fromName} beat off ${player.name || 'an attacker'} on the road.`;
        }
        // The households' purses: theirs, now the player's
        const hs = Array.isArray(u.households) ? u.households : [];
        let coin = 0;
        for (const h of hs) for (const c of h.people || []) { coin += Math.max(0, _num(c.purse)); c.purse = 0; }
        coin = _r2(coin);
        if (coin > 0) {
            player.gold = _r2(_num(player.gold) + coin);
            if (loot) loot.gold = _r2(_num(loot.gold) + coin);
        }
        // The dead: a share of the column, whole households among them
        const pop = Math.max(0, Math.round(_num(u.population)));
        const killed = Math.min(pop, Math.round(pop * _clamp(_num(A.killShare, 0.3), 0, 1)));
        const rng = _rng(world, 'raid', u.id, day);
        const order = hs.map(h => ({ h, k: rng() })).sort((a, b) => a.k - b.k).map(x => x.h);
        const slainN = Math.round(order.length * (pop > 0 ? killed / pop : 0));
        const slain = order.slice(0, slainN);
        const ff = from && _obj(from.folk) && Array.isArray(from.folk.people) ? from.folk : null;
        let named = 0;
        for (const h of slain) {
            for (const c of h.people || []) {
                const p = ff ? Townsfolk.get(ff, c.oid) : null;
                if (p && p.died == null) { Townsfolk._die(ff, p, day, 'slain on the road'); named++; }
            }
        }
        if (ff && named) delete ff._index;
        if (to) to.population = Math.max(1, Math.round(_num(to.population) - killed));
        // The rest straggle on into their new town at once
        const living = order.slice(slainN);
        let placed = 0;
        if (to && living.length) placed = Migration._place(world, to, living, from, day, player);
        u.households = null;
        u.attackedBy = { d: day, won: true, killed };
        // The road is feared: fewer follow their kin down it
        if (to && from) {
            const kin = Migration.town(to).kin;
            const fk = _key(from.q, from.r);
            if (kin[fk]) kin[fk] = Math.floor(kin[fk] * _clamp(_num(A.kinFear, 0.5), 0, 1));
        }
        if (to && killed > 0) Migration._log(to, { d: day, o: 1, n: killed, t: 'the road', q: u.q, r: u.r, w: 'danger', k: 'slain' }, Math.floor(_num(world.year, 0)));
        // The deed: murder before the realm, karma, the realms' regard
        const kk = A.karma || {};
        const karma = _num(kk[u.migKind], _num(kk.migrants, -8));
        player.karma = Math.max(-100, _num(player.karma) + karma);
        Underworld.recordCrime(player, world, A.crime || 'murder', {
            kingdom: realm, caught: true, scale: _clamp(killed / 20, 0.5, 2), q: to ? to.q : u.q, r: to ? to.r : u.r, victim,
        });
        if (player.reputation) {
            const rep = _num(A.reputation, 15);
            if (realm != null) player.reputation[realm] = _num(player.reputation[realm]) - rep;
            if (to && to.kingdom != null && to.kingdom !== realm) player.reputation[to.kingdom] = _num(player.reputation[to.kingdom]) - Math.round(rep / 2);
        }
        u.massacre = { killed, coin, placed };
        return killed > 0
            ? `${player.name || 'Raiders'} fell on the ${what} from ${u.fromName} on the road to ${u.toName}: ${killed} were cut down${coin > 0 ? ' and their purses taken' : ''}. The rest fled on to ${u.toName}.`
            : `${player.name || 'Raiders'} robbed the ${what} from ${u.fromName} on the road to ${u.toName}.`;
    },

    // ── The day ───────────────────────────────────────────

    /**
     * The daily part (after the labour day): columns walk, each town's head
     * count is sampled (trend, empty and new houses, the roster's size),
     * and a monthly digest for the player's towns. Adds to out.notices.
     */
    processDay(world, player = null, out = { notices: [] }) {
        if (!world || !Migration.on() || typeof world.getTile !== 'function') return out;
        const C = Migration.config();
        const day = _num(world.day);
        const ruled = new Set();
        if (player) {
            try { for (const ref of Taxation.getPlayerSettlements(player, world)) ruled.add(_key(ref.q, ref.r)); } catch (e) { /* none */ }
        }
        for (const u of world.units || []) {
            if (u && u.type === MIGRANT_TYPE && !u.destroyed) Migration._columnDay(world, player, u, day, out, ruled);
        }
        const every = Math.max(1, Math.floor(_num(C.trend.sampleDays, 30)));
        if (day % every !== 0) return out;
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        const st = Migration.state(world);
        let resized = false;
        for (const v of views) {
            const tile = world.getTile(v.q, v.r);
            const s = tile && tile.settlement;
            if (!s) continue;
            Migration._sample(s, day);
            if (Migration._resize(world, s, day, out, player, ruled)) resized = true;
            if (player && ruled.has(_key(v.q, v.r))) Migration._digest(world, s, day, every, out);
        }
        if (resized && typeof world.invalidateSettlements === 'function') world.invalidateSettlements();
        st.lastSample = day;
        return out;
    },

    /** Sample a town's head count: its trend, empty and new houses, the roster's size. */
    _sample(s, day) {
        const C = Migration.config();
        const m = Migration.town(s);
        const pop = Math.max(0, Math.round(_num(s.population)));
        m.h.push([day, pop]);
        const keep = Math.max(4, _num(C.trend.keep, 48));
        if (m.h.length > keep) m.h.splice(0, m.h.length - keep);
        const H = C.houses;
        m.peak = Math.max(pop, Math.round(_num(m.peak, pop) * (1 - _num(H.peakDecay, 0.002))));
        const lost = m.peak > 0 ? (m.peak - pop) / m.peak : 0;
        const old = m.h[0] ? m.h[0][1] : pop;
        const grew = old > 0 ? (pop - old) / old : 0;
        // (in twentieths, so the street map is laid out anew only when it shows)
        m.vac = Math.round(_clamp((lost - _num(H.lossFree, 0.1)) * _num(H.perLoss, 0.8), 0, _num(H.maxVacant, 0.35)) * 20) / 20;
        m.fresh = Math.round(_clamp((grew - _num(H.growFree, 0.1)) * _num(H.perGrowth, 0.6), 0, _num(H.maxNew, 0.25)) * 20) / 20;
        if (!m.vac) delete m.vac;
        if (!m.fresh) delete m.fresh;
        // Kin's memory fades (those who went before are settled, or gone on again)
        for (const k of Object.keys(m.kin)) {
            m.kin[k] = Math.floor(m.kin[k] * _num(C.pull.kinFade, 0.9));
            if (m.kin[k] < 3) delete m.kin[k];
        }
        // The roster's usual size follows the town's (systems/townsfolk.js attach reads folk.mScale)
        const folk = _obj(s.folk);
        if (folk && Array.isArray(folk.people)) {
            if (!(_num(folk.mPop) > 0)) { folk.mPop = Math.max(1, pop); folk.mBase = _num(folk.target); }
            const F = C.folk;
            folk.mScale = _r2(_clamp(pop / folk.mPop, _num(F.scaleMin, 0.5), _num(F.scaleMax, 2.2)));
            if (_num(folk.mBase) > 0) folk.target = Math.max(1, Math.round(folk.mBase * folk.mScale));
        }
    },

    /**
     * A town grows into its size, or dwindles out of it: a village of
     * `size.town` people becomes a town, a town of `size.city` a city - and
     * a city fallen under `cityToTown` is a town again, a town under
     * `townToVillage` a village. Only once the head count has held there for
     * `months` samples running (no flicker at the edge). Capitals stay
     * capitals; villages founded at the dawn or by the player rise by their
     * own rule (world/dawn.js, world/villageFounding.js) and only fall here.
     * The street map is laid out for its new size the next time it is entered.
     * -> true when the town changed size.
     */
    _resize(world, s, day, out, player = null, ruled = null) {
        const Z = Migration.config().size || {};
        if (Z.enabled === false || !s || s.type === 'capital') return false;
        const pop = _num(s.population);
        const type = s.type || 'village';
        let next = null;
        if (type === 'village' && pop >= _num(Z.town, 650) && !s.dawnBorn && !s.playerFounded) next = 'town';
        else if (type === 'town' && pop >= _num(Z.city, 5000)) next = 'city';
        else if (type === 'city' && pop < _num(Z.cityToTown, 3500)) next = 'town';
        else if (type === 'town' && pop < _num(Z.townToVillage, 300)) next = 'village';
        const m = Migration.town(s);
        if (!next) { delete m.sz; return false; }
        if (!_obj(m.sz) || m.sz.to !== next) m.sz = { to: next, n: 0 };
        m.sz.n++;
        if (m.sz.n < Math.max(1, _num(Z.months, 3))) return false;
        delete m.sz;
        const grew = (next === 'town' && type === 'village') || next === 'city';
        s.type = next;
        s.level = next === 'village' ? 0 : next === 'town' ? 1 : 2;
        s.sizeChanged = { d: day, from: type, to: next };
        const line = grew
            ? (next === 'city' ? `${s.name} has grown into a city of ${Math.round(pop)} souls.` : `${s.name} has grown from a village into a town.`)
            : (next === 'village' ? `${s.name} has dwindled to a village.` : `${s.name}, emptied of its people, is a city no longer: a town again.`);
        const icon = grew ? (next === 'city' ? '🏙️' : '🏘️') : (next === 'village' ? '🏚️' : '📉');
        if (Array.isArray(world.events)) world.events.push({ text: `${icon} ${line}`, type: 'growth', category: 'ECONOMIC' });
        const mine = ruled && ruled.has(_key(s.q, s.r));
        const here = player && player.q === s.q && player.r === s.r;
        if (player && (mine || here)) {
            out.notices.push({ icon, title: grew ? `${s.name} Grows` : `${s.name} Dwindles`, text: line, type: grew ? 'success' : 'warning' });
        }
        return true;
    },

    /** A monthly word on the player's own town when its people come or go in numbers. */
    _digest(world, s, day, every, out) {
        const C = Migration.config();
        const m = Migration.town(s);
        let inn = 0, gone = 0;
        const why = {};
        for (const e of m.log) {
            if (day - e.d > every) continue;
            if (e.i) inn += e.n; else gone += e.n;
            const k = (e.i ? '+' : '-') + e.w;
            why[k] = _num(why[k]) + e.n;
        }
        const net = inn - gone;
        const pop = Math.max(1, _num(s.population));
        if (Math.abs(net) < Math.max(20, pop * _num(C.news.noticeShare, 0.05) * 0.4)) return;
        const top = Object.entries(why).sort((a, b) => b[1] - a[1])[0];
        const R = top ? Migration.reasonDef(top[0].slice(1)) : null;
        const cause = R ? (top[0][0] === '+' ? R.pull || R.push : R.push || R.pull) : '';
        out.notices.push(net > 0
            ? { icon: '📈', title: `${s.name} Grows`, text: `${inn} people came to settle in ${s.name} this month${gone ? ` and ${gone} left` : ''}${cause ? ` — most ${cause}` : ''}.`, type: 'info' }
            : { icon: '📉', title: `${s.name} Empties`, text: `${gone} people left ${s.name} this month${inn ? ` and ${inn} came` : ''}${cause ? ` — most ${cause}` : ''}.`, type: 'warning' });
    },

    // ── Readers ───────────────────────────────────────────

    /**
     * A town's trend: { pop, change (share over the span), span (days), label,
     * color, yearIn, yearOut, why: [{ id, n, in }], recent: [log], vacant, fresh }.
     */
    trend(s, day = null) {
        if (!s) return null;
        const C = Migration.config();
        const m = _obj(s.migr) || {};
        const h = Array.isArray(m.h) ? m.h : [];
        const pop = Math.round(_num(s.population));
        const d = day == null ? (h.length ? h[h.length - 1][0] : 0) : day;
        // A year back (120 days), else as far back as is known
        const Y = Townsfolk.config().daysPerYear || 120;
        let base = null;
        for (const [hd, hp] of h) if (d - hd <= Y + 1) { base = [hd, hp]; break; }
        if (!base && h.length) base = h[0];
        const change = base && base[1] > 0 ? (pop - base[1]) / base[1] : 0;
        const span = base ? Math.max(0, d - base[0]) : 0;
        const T = C.trend;
        const label = !base || span < 30 ? 'steady' : change >= _num(T.growing, 0.03) ? 'growing' : change <= _num(T.shrinking, -0.03) ? 'shrinking' : 'steady';
        const color = label === 'growing' ? '#9fd59f' : label === 'shrinking' ? '#e8a040' : '#cfc6b0';
        const yr = _obj(m.yr) || { in: 0, out: 0, why: {} };
        const why = Object.entries(yr.why || {}).map(([k, n]) => ({ id: k.slice(1), n, in: k[0] === '+' })).sort((a, b) => b.n - a.n);
        return {
            pop, change: _r2(change * 100) / 100, span, label, color,
            yearIn: _num(yr.in), yearOut: _num(yr.out), year: yr.y, why,
            recent: (Array.isArray(m.log) ? m.log : []).slice().reverse(),
            vacant: _num(m.vac), fresh: _num(m.fresh), history: h.slice(),
        };
    },

    /** A one-line trend for the hex info and panels: "growing (+6% in a year)". */
    trendLine(s, day = null) {
        const t = Migration.trend(s, day);
        if (!t || !t.history.length) return '';
        const pct = Math.round(t.change * 100);
        const span = t.span >= 100 ? 'a year' : `${t.span} days`;
        return t.label === 'steady' ? `steady${t.span >= 30 ? ` (${pct >= 0 ? '+' : ''}${pct}% in ${span})` : ''}` : `${t.label} (${pct >= 0 ? '+' : ''}${pct}% in ${span})`;
    },

    /** Big flows on record, newest first. */
    flows(world, limit = 20) {
        const st = world && _obj(world.migration);
        return (st && Array.isArray(st.flows) ? st.flows : []).slice().reverse().slice(0, limit);
    },

    /** Columns on the roads now. */
    columns(world) {
        return (world && world.units ? world.units : []).filter(u => u && u.type === MIGRANT_TYPE && !u.destroyed);
    },

    /** Is this unit a column of migrants? */
    isColumn(u) { return !!u && u.type === MIGRANT_TYPE && !u.destroyed; },

    /** The towns sorted by their year's net movement: { gaining: [...], losing: [...] } of { s, net, in, out, top }. */
    realmFlows(world, kingdomId = undefined) {
        const views = world && typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        const rows = [];
        for (const v of views) {
            const tile = world.getTile(v.q, v.r);
            const s = tile && tile.settlement;
            if (!s || (kingdomId !== undefined && s.kingdom !== kingdomId)) continue;
            const yr = s.migr && _obj(s.migr.yr);
            if (!yr) continue;
            const net = _num(yr.in) - _num(yr.out);
            if (!net) continue;
            const top = Object.entries(yr.why || {}).sort((a, b) => b[1] - a[1])[0];
            rows.push({ s, q: v.q, r: v.r, net, in: _num(yr.in), out: _num(yr.out), top: top ? { id: top[0].slice(1), in: top[0][0] === '+' } : null });
        }
        rows.sort((a, b) => b.net - a.net);
        return { gaining: rows.filter(x => x.net > 0).slice(0, 8), losing: rows.filter(x => x.net < 0).reverse().slice(0, 8) };
    },
};
