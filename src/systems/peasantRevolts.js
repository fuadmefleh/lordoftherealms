// ============================================
// PEASANT REVOLTS — the commons rise
// ============================================
// GRIEVANCE. Each week every town of a living realm (and every holding of the
// player's) carries a grievance, 0-100, that creeps toward a PRESSURE built
// from what the game already knows about it:
//   taxes      the burden the people feel (Fiscal.townBurden: the crown's tax
//              levels, a tax farmer's squeeze, corruption), a tax revolt
//              against the collectors (settlement.taxRevolt, systems/fiscal.js)
//   hunger     the peasants' welfare (world/townLabour.js), a poor harvest
//              (Harvests.foodFactor), dear grain (SettlementMarket.scarcity)
//   coin       debased coin (Coinage.purity)
//   cruelty    the lord's: the player's name for butchery (Atrocities), a
//              cruel AI lord's traits, harsh punishment laws (Laws), the
//              hangings at the town (kept here; Executions may add theirs)
//   plague, levies and war, a realm gone rotten (systems/realmDecline.js),
//   unrest (the realm's stability, the town's happiness, a holding's unrest),
//   agitators (a 'rebellion' world event: settlement.revoltSpark), and old
//   wounds — fear after a rising crushed (pulls it down), then resentment.
// Bread and charters granted pull it down for years (a charter for decades).
//
// THE RISING. A town past boilAt may rise (a hash roll a week, likelier the
// angrier it is; one rising per realm at a time, years between). It has a
// named leader (a real townsperson where the town keeps a roster:
// systems/townsfolk.js), a cause (the heaviest grievance) and demands (lower
// taxes, bread, the hated steward's head, honest coin, a charter of
// freedoms). Its rebel host is a peasant_host world unit (world/units.js
// moves it): it burns the estates about the towns it passes (their soil, so
// crops, rents and value fall until the fields grow back: world/estates.js),
// plunders the player's properties there, spreads to aggrieved neighbours if
// no one meets it, and at last marches on its lord's seat and storms it.
//
// THE LORD. Against the player (the ruler of the realm, or the lord of a
// holding) the choice is the player's (ui/actionMenu/peasantRevolts.js):
// grant the demands (a charter: settlement.charter, read by Fiscal.townDues
// and townBurden — the lords call you weak: vassal favour, Prestige), parley,
// buy off the leader, send the royal host, or ride out and beat the host in
// the field (PlayerMilitary.attackUnit → onHostDefeated). After it is
// crushed: mercy, the leader hanged (Executions.condemn when the scaffold
// stands: useExecutions), the ringleaders hanged, or the leader taken (a
// prisoner: PeasantRevolts.prisoners — the dungeon reads it). Cruelty buys
// fear for a few years, then resentment for longer.
// AI realms meet their own risings by their lord's traits (crush, concede,
// parley, buy off); a rising that storms the capital of a weak lord drags him
// down (NPCLords.lordDies) and another takes the throne.
//
// No shared RNG: rolls are hashes of the world seed; units are made on a
// seeded stream of their own. Weekly grievance (cadence), daily hosts. Runs
// with player = null (the interregnum): every rising is the realm's to meet.
// State: world.peasantRevolts (saved by saveLoad), player.peasantRevolts
// (EXTRA_PLAYER_FIELDS). Content: data/peasantRevolts.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { Names } from '../core/names.js';
import { Interrupts } from '../core/interrupts.js';
import { WorldUnit } from '../world/units.js';
import { Economy } from '../world/economy.js';
import { Estates } from '../world/estates.js';
import { Revanche } from '../world/revanche.js';
import { Coinage } from '../world/coinage.js';
import { Harvests } from '../world/harvests.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Seasons } from '../world/seasons.js';
import { MoneySupply } from '../world/moneySupply.js';
import { NPCLords } from '../world/npcLords.js';
import { Throne } from './throne.js';
import { Kingship } from './kingship.js';
import { Holdings } from './holdings.js';
import { Taxation } from './marketDynamics.js';
import { Fiscal } from './fiscal.js';
import { Plague } from './plague.js';
import { Atrocities } from './atrocities.js';
import { Laws } from './laws.js';
import { House } from './house.js';
import { Traits } from './traits.js';
import { Ledger } from './ledger.js';
import { Townsfolk } from './townsfolk.js';
import { RealmDecline } from './realmDecline.js';
// The dead on show: the commons' fear of rising (systems/gibbets.js)
import { Gibbets } from './gibbets.js';
// The scaffold: a rebel leader condemned waits there for the player's word (systems/executions.js; run time only)
import { Executions } from './executions.js';

const YEAR = Seasons.DAYS_PER_YEAR || 120;
const HIST_CAP = 40;
const PARTS = ['tax', 'hunger', 'coin', 'cruelty', 'plague', 'levy', 'decline', 'unrest', 'spark', 'wounds'];
const AFTERMATHS = ['mercy', 'hang_leader', 'hang_ringleaders', 'imprison'];

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _day = (world) => _num(world && world.day);
const _r1 = (v) => Math.round(v * 10) / 10;
const _key = (q, r) => `${q},${r}`;
const _xy = (key) => String(key).split(',').map(Number);

let _cfg = null;
let _cfgSrc = null;
/** A stand-in scaffold (tests; useExecutions) — else systems/executions.js. */
let _exec = null;

function _seed(world) {
    const p = world && world.generationParams;
    return _num(p && p.seed, 1);
}

/** A unit roll for `key` in this world (no RNG stream touched). */
function _roll(world, key) {
    let h = Utils.hashStr(`${_seed(world)}|peasantRevolts|${key}`) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return (((h ^ (h >>> 16)) >>> 0) % 100000) / 100000;
}

function _fill(text, vars) {
    return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

function _tile(world, q, r) {
    return world && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
}

function _town(world, key) {
    const [q, r] = _xy(key);
    const t = _tile(world, q, r);
    return t && t.settlement ? t.settlement : null;
}

function _kingdom(world, id) {
    if (id == null || !world) return null;
    if (typeof world.getKingdom === 'function') return world.getKingdom(id) || null;
    return (world.kingdoms || []).find(k => k && k.id === id) || null;
}

function _dist(world, a, b) {
    return Hex.wrappingDistance(a.q, a.r, b.q, b.r, world.width);
}

function _an(word) { return /^[aeiou]/i.test(String(word || '')) ? `an ${word}` : `a ${word}`; }

function _list(items) {
    const a = items.filter(Boolean);
    if (a.length <= 1) return a[0] || '';
    return `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
}

function _note(out, icon, title, text, type = 'info') {
    if (out && Array.isArray(out.notices)) out.notices.push({ icon, title, text, type });
}

export const PeasantRevolts = {
    PARTS,
    AFTERMATHS,

    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.peasantRevolts : null;
        if (_cfg && _cfgSrc === src) return _cfg;
        _cfgSrc = src;
        _cfg = { enabled: true, ...(_obj(src) || {}) };
        for (const k of ['pressure', 'host', 'march', 'burn', 'seat', 'demands', 'causeDemand', 'player', 'aftermath', 'ai', 'stability', 'prisoner', 'leaderNames', 'text', 'spark', 'road']) _cfg[k] = _obj(_cfg[k]) || {};
        return _cfg;
    },

    enabled() { return PeasantRevolts.config().enabled !== false; },

    /** Stand in a scaffold: { condemn(player, world, person, opts) } (null: systems/executions.js's own). */
    useExecutions(impl) { _exec = impl && typeof impl.condemn === 'function' ? impl : null; },

    line(key, vars = {}) { return _fill(PeasantRevolts.config().text[key], vars); },

    // ── State ─────────────────────────────────────────

    _blank() {
        return { v: 1, towns: {}, revolts: [], realms: {}, burnt: [], nextId: 1, history: [], stats: { risen: 0, crushed: 0, conceded: 0, parleyed: 0, boughtOff: 0, dispersed: 0, won: 0, toppled: 0 } };
    },

    state(world) {
        if (!world) return PeasantRevolts._blank();
        if (!_obj(world.peasantRevolts)) world.peasantRevolts = PeasantRevolts._blank();
        const st = world.peasantRevolts;
        const b = PeasantRevolts._blank();
        for (const k of Object.keys(b)) if (st[k] === undefined) st[k] = b[k];
        if (!Array.isArray(st.revolts)) st.revolts = [];
        if (!Array.isArray(st.history)) st.history = [];
        if (!Array.isArray(st.burnt)) st.burnt = [];
        return st;
    },

    serialize(world) {
        return world && _obj(world.peasantRevolts) ? JSON.parse(JSON.stringify(world.peasantRevolts)) : null;
    },

    restore(saved, world) {
        if (!world) return;
        world.peasantRevolts = _obj(saved) ? JSON.parse(JSON.stringify(saved)) : PeasantRevolts._blank();
        PeasantRevolts.state(world);
    },

    playerState(player) {
        if (!player) return null;
        if (!_obj(player.peasantRevolts)) player.peasantRevolts = { prisoners: [], aftermath: null, nextId: 1, stats: { charters: 0, parleys: 0, bought: 0, crushed: 0, hanged: 0, mercy: 0, lost: 0 } };
        const p = player.peasantRevolts;
        if (!Array.isArray(p.prisoners)) p.prisoners = [];
        if (!_obj(p.stats)) p.stats = {};
        if (!p.nextId) p.nextId = 1;
        return p;
    },

    _townRec(st, key) {
        if (!st.towns[key]) st.towns[key] = { g: 0, p: 0 };
        return st.towns[key];
    },

    grievance(world, q, r) {
        const t = world && _obj(world.peasantRevolts) ? world.peasantRevolts.towns[_key(q, r)] : null;
        return t ? Math.round(_num(t.g)) : 0;
    },

    active(world) {
        return world && _obj(world.peasantRevolts) ? world.peasantRevolts.revolts : [];
    },

    revolt(world, id) {
        return PeasantRevolts.active(world).find(rv => rv.id === id) || null;
    },

    /** A hanging at a town (the scaffold's, or a lord's justice): it weighs on the town's grievance as cruelty. */
    noteHanging(world, q, r, n = 1) {
        if (!world) return;
        const t = PeasantRevolts._townRec(PeasantRevolts.state(world), _key(q, r));
        t.hanged = PeasantRevolts._hangedNow(t, _day(world)) + Math.max(0, n);
        t.hangedDay = _day(world);
    },

    _hangedNow(t, day) {
        if (!t || !(t.hanged > 0)) return 0;
        const half = Math.max(0.1, _num(PeasantRevolts.config().pressure.cruelty.hangedHalfYears, 1.5)) * YEAR;
        return t.hanged * Math.pow(0.5, Math.max(0, day - _num(t.hangedDay, day)) / half);
    },

    // ── Who is lord here ──────────────────────────────

    _context(world, player) {
        const day = _day(world);
        const ctx = { player, day, ruledId: null, holdings: new Set(), butcher: 0, decline: 0, ruled: null, rebelEvents: new Set(), oldCrowns: Revanche.townIndex(world) };
        // A 'Peasant Rebellion' world event in a town (world/worldEvents.js, born of a realm's collapse) stirs it hard
        for (const ev of Array.isArray(world && world.activeEvents) ? world.activeEvents : []) {
            if (ev && ev.id === 'rebellion' && ev.q != null) ctx.rebelEvents.add(_key(ev.q, ev.r));
        }
        if (player) {
            const k = Throne.ruledKingdom(player, world);
            if (k) { ctx.ruledId = k.id; ctx.ruled = k; }
            try {
                for (const ref of Taxation.getPlayerSettlements(player, world)) ctx.holdings.add(_key(ref.q, ref.r));
            } catch (e) { /* no holdings */ }
            ctx.butcher = Atrocities.butcher(player);
            if (k && player.realmDecline && _obj(player.realmDecline.strains)) {
                const v = Object.values(player.realmDecline.strains).map(x => _num(x));
                ctx.decline = v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
            }
        }
        return ctx;
    },

    /** The lord a town's commons would rise against: { kind: 'player', role: 'holding'|'crown' } or { kind: 'ai' }. */
    _lordOf(ctx, s) {
        const key = _key(s.q, s.r);
        if (ctx.player && ctx.holdings.has(key)) return { kind: 'player', role: 'holding' };
        if (ctx.player && ctx.ruledId != null && s.kingdom === ctx.ruledId) return { kind: 'player', role: 'crown' };
        return { kind: 'ai', role: 'ai' };
    },

    _lordName(world, rv, player = null) {
        if (rv.against !== 'ai' && player) return 'you';
        const k = _kingdom(world, rv.kingdomId);
        return k ? (k.ruler || `the crown of ${Names.realm(k.name)}`) : 'their lord';
    },

    // ── Pressure ──────────────────────────────────────

    /** The pressure on a town: { value, parts: [{ id, label, icon, v }] } (relief negative). */
    pressure(world, s, ctx = null) {
        const C = PeasantRevolts.config();
        const P = C.pressure;
        ctx = ctx || PeasantRevolts._context(world, null);
        const day = ctx.day;
        const key = _key(s.q, s.r);
        const st = PeasantRevolts.state(world);
        const t = st.towns[key] || {};
        const k = _kingdom(world, s.kingdom);
        const lord = PeasantRevolts._lordOf(ctx, s);
        const parts = [];
        const add = (id, v) => {
            const def = P[id] || {};
            const capped = Math.min(_num(def.cap, 100), v);
            if (Math.abs(capped) >= 0.5) parts.push({ id, label: def.label || id, icon: def.icon || '', v: _r1(capped) });
        };
        // Taxes
        {
            const T = P.tax || {};
            let v = 0;
            const b = Fiscal.townBurden(world, s);
            if (b != null) v += Math.max(0, b - _num(T.from, 0.16)) * _num(T.per, 260);
            if (_num(s.taxRevolt) > day) v += _num(T.taxRevolt, 10);
            add('tax', v);
        }
        // Hunger
        {
            const H = P.hunger || {};
            let v = 0;
            const lab = s.labour;
            const wel = lab && lab.wel && Number.isFinite(lab.wel.peasants) ? lab.wel.peasants : (lab && Number.isFinite(lab.all) ? lab.all : null);
            if (wel != null) v += Math.max(0, _num(H.welfareAt, 0.72) - wel) * _num(H.perWelfare, 110);
            const ff = _num(Harvests.foodFactor(world, s), 1);
            v += Math.max(0, _num(H.harvestAt, 0.9) - ff) * _num(H.perHarvest, 60);
            const sc = SettlementMarket.scarcity(s, 'grain');
            v += Math.max(0, _num(sc, 1) - _num(H.grainAt, 1.35)) * _num(H.perGrain, 22);
            add('hunger', v);
        }
        // Debased coin
        if (k) add('coin', (1 - Coinage.purity(k)) * _num((P.coin || {}).per, 70));
        // The lord's cruelty
        {
            const Cr = P.cruelty || {};
            let v = 0;
            if (lord.kind === 'player') v += ctx.butcher * _num(Cr.perButcher, 0.25);
            else if (k && k.lord && Array.isArray(k.lord.traits)) {
                const cruel = new Set(Cr.cruelTraits || []);
                v += k.lord.traits.filter(x => x && cruel.has(x.id)).length * _num(Cr.cruelTrait, 9);
            }
            if (k) v += Math.max(0, Laws.punishment(world, k.id).deter - 1) * _num(Cr.perDeter, 12);
            v += PeasantRevolts._hangedNow(t, day) * _num(Cr.perHanged, 6);
            add('cruelty', v);
        }
        // Plague
        if (Plague.isPlague(world, s, day)) add('plague', _num((P.plague || {}).flat, 12));
        // Levies and war
        if (k) {
            const L = P.levy || {};
            let v = 0;
            if (Array.isArray(k.wars) && k.wars.length) v += _num(L.atWar, 5);
            if (Fiscal._levyShare(k, day) > 0) v += _num(L.levy, 10);
            add('levy', v);
        }
        // A realm gone rotten
        if (k) {
            const D = P.decline || {};
            const lvl = lord.kind === 'player' && lord.role === 'crown' ? ctx.decline : _num(k.decline && k.decline.s);
            add('decline', Math.max(0, lvl - _num(D.from, 30)) * _num(D.per, 0.3));
        }
        // Unrest
        {
            const U = P.unrest || {};
            let v = 0;
            if (k) v += Math.max(0, _num(U.stabilityAt, 45) - _num(k.stability, 50)) * _num(U.perStability, 0.45);
            v += Math.max(0, _num(U.happinessAt, 40) - _num(s.happiness, 50)) * _num(U.perHappiness, 0.35);
            if (lord.kind === 'player' && lord.role === 'holding' && _obj(s.holding)) v += _num(s.holding.unrest) * _num(U.perHoldingUnrest, 0.25);
            add('unrest', v);
        }
        // The old crown: a town another living realm lost and still claims remembers it (world/revanche.js)
        {
            const oc = (ctx.oldCrowns || Revanche.townIndex(world)).get(key);
            if (oc && !(s.kingdom != null && String(s.kingdom) === String(oc.kingdomId))) add('oldCrown', oc.w * _num((P.oldCrown || {}).per, 4));
        }
        // Agitators (a 'rebellion' world event)
        {
            const sp = _obj(s.revoltSpark);
            let v = ctx.rebelEvents && ctx.rebelEvents.has(key) ? _num(C.spark.event, 25) : 0;
            if (sp) {
                const half = Math.max(0.05, _num((P.spark || {}).halfYears, 0.5)) * YEAR;
                v += _num(sp.amt) * Math.pow(0.5, Math.max(0, day - _num(sp.day, day)) / half);
            }
            add('spark', v);
        }
        // Old wounds: fear (down), then resentment (up); a leader held
        {
            let v = 0;
            const f = _obj(t.fear);
            if (f) {
                if (day < _num(f.until)) v -= _num(f.amt);
                else if (day < _num(f.resentUntil)) v += _num(f.resent);
            }
            v += _num(t.held);
            if (v > 0) add('wounds', v);
            else if (v < 0) parts.push({ id: 'fear', label: 'Fear', icon: '😨', v: _r1(v) });
        }
        // The dead on show at its gate and crossroads, and its neighbours' (systems/gibbets.js)
        {
            const dread = Gibbets.revoltDread(world, s, day);
            if (dread >= 0.5) parts.push({ id: 'gibbets', label: 'Heads on the gate', icon: '💀', v: _r1(-dread) });
        }
        // Bread and charters
        {
            let v = 0;
            for (const rel of Array.isArray(t.relief) ? t.relief : []) {
                const span = Math.max(1, _num(rel.until) - _num(rel.day));
                const left = _num(rel.until) - day;
                if (left > 0) v += _num(rel.amt) * left / span;
            }
            if (v > 0) parts.push({ id: 'relief', label: (P.relief || {}).label || 'Relief', icon: (P.relief || {}).icon || '📜', v: _r1(-v) });
        }
        const value = _clamp(parts.reduce((a, p) => a + p.v, 0), 0, 100);
        parts.sort((a, b) => b.v - a.v);
        return { value: _r1(value), parts };
    },

    // ── The days ──────────────────────────────────────

    processDay(world, player = null) {
        const out = { notices: [] };
        if (!world || !PeasantRevolts.enabled()) return out;
        const st = PeasantRevolts.state(world);
        const day = _day(world);
        const C = PeasantRevolts.config();
        // (the risings march every day; nothing here draws on the shared stream)
        if (st.revolts.length) {
            const ctx = PeasantRevolts._context(world, player);
            for (const rv of st.revolts.slice()) PeasantRevolts._revoltDay(world, player, st, rv, ctx, day, out);
        }
        if (player) PeasantRevolts._playerDay(world, player, day, out);
        if (day % Math.max(1, _num(C.cadence, 7)) === 0) PeasantRevolts._week(world, player, st, day, out);
        return out;
    },

    _week(world, player, st, day, out) {
        const C = PeasantRevolts.config();
        const ctx = PeasantRevolts._context(world, player);
        const rise = _num(C.rise, 0.05), fall = _num(C.fall, 0.03);
        const candidates = [];
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        for (const s of views) {
            if (!s) continue;
            const key = _key(s.q, s.r);
            const k = _kingdom(world, s.kingdom);
            const mine = ctx.holdings.has(key);
            if (!(k && k.isAlive !== false) && !mine) continue;
            if (_num(s.population) < _num(C.minPop, 60)) continue;
            const p = PeasantRevolts.pressure(world, s, ctx).value;
            const t = PeasantRevolts._townRec(st, key);
            t.g = _r1(_clamp(_num(t.g) + (p - _num(t.g)) * (p > _num(t.g) ? rise : fall), 0, 100));
            t.p = p;
            if (Array.isArray(t.relief)) t.relief = t.relief.filter(x => _num(x.until) > day);
            if (t.g >= _num(C.boilAt, 62)) candidates.push({ s, k, key, t });
        }
        // Fields burned grow back
        PeasantRevolts._regrow(world, st, day);
        // Who boils over
        candidates.sort((a, b) => b.t.g - a.t.g);
        const busy = new Set(st.revolts.map(rv => String(rv.realmKey)));
        for (const c of candidates) {
            const realmKey = c.s.kingdom != null ? String(c.s.kingdom) : `free:${c.key}`;
            if (busy.has(realmKey)) continue;
            if (day - _num(st.realms[realmKey], -1e9) < _num(C.realmCooldownYears, 4) * YEAR) continue;
            if (day - _num(c.t.last, -1e9) < _num(C.townCooldownYears, 10) * YEAR) continue;
            if (c.s.holding && c.s.holding.rebellion) continue; // the town's own streets are already up (systems/holdings.js)
            const over = (c.t.g - _num(C.boilAt, 62)) / Math.max(1, 100 - _num(C.boilAt, 62));
            const chance = _num(C.chance, 0.05) * Math.pow(_clamp(over, 0, 1), 1.5);
            if (_roll(world, `rise|${c.key}|${day}`) >= chance) continue;
            PeasantRevolts._rise(world, player, st, c.s, c.k, ctx, realmKey, day, out);
            busy.add(realmKey);
        }
    },

    _regrow(world, st, day) {
        const B = PeasantRevolts.config().burn;
        const per = 7 / Math.max(1, _num(B.regrowYears, 3) * YEAR);
        st.burnt = st.burnt.filter(b => {
            const e = Estates.estate(world, b.id);
            if (!e) return false;
            const add = Math.min(_num(b.left), _num(b.lost) * per);
            if (add > 0) {
                e.soil = Math.round((_num(e.soil, 1) + add) * 1000) / 1000;
                b.left = Math.round((_num(b.left) - add) * 10000) / 10000;
                Estates.bumpTown(world, e.town);
            }
            return b.left > 0.0005;
        });
    },

    // ── A rising ──────────────────────────────────────

    /** Start a rising in town s now (the week's roll, or a test / console). → the revolt record */
    rise(world, player, q, r) {
        const t = _tile(world, q, r);
        const s = t && t.settlement;
        if (!s) return null;
        const st = PeasantRevolts.state(world);
        const realmKey = s.kingdom != null ? String(s.kingdom) : `free:${_key(q, r)}`;
        if (st.revolts.some(rv => String(rv.realmKey) === realmKey)) return null;
        const ctx = PeasantRevolts._context(world, player);
        const out = { notices: [] };
        const rec = PeasantRevolts._townRec(st, _key(q, r));
        if (_num(rec.g) < _num(PeasantRevolts.config().boilAt, 62)) rec.g = Math.max(_num(rec.g), _num(PeasantRevolts.config().boilAt, 62) + 10);
        return PeasantRevolts._rise(world, player, st, s, _kingdom(world, s.kingdom), ctx, realmKey, _day(world), out);
    },

    _rise(world, player, st, s, k, ctx, realmKey, day, out) {
        const C = PeasantRevolts.config();
        const H = C.host;
        const key = _key(s.q, s.r);
        const t = PeasantRevolts._townRec(st, key);
        const pr = PeasantRevolts.pressure(world, s, ctx);
        const top = pr.parts.find(p => p.v > 0 && PARTS.includes(p.id)) || { id: 'unrest', label: 'Unrest' };
        const demands = [C.causeDemand[top.id] || 'charter'];
        if (t.g >= _num(C.charterAt, 82) && !demands.includes('charter')) demands.push('charter');
        const leader = PeasantRevolts._pickLeader(world, s, day, `${key}|${day}`);
        const strength = Math.round(_clamp(_num(H.base, 10) + _num(s.population) * _num(H.perHead, 0.06) * t.g / 100, _num(H.min, 15), _num(H.max, 260)));
        const lord = PeasantRevolts._lordOf(ctx, s);
        const [r0, r1] = Array.isArray(C.ai.reactDays) ? C.ai.reactDays : [10, 30];
        const rv = {
            id: st.nextId++, realmKey, kingdomId: s.kingdom != null ? s.kingdom : null, origin: key, towns: [key], townNames: [s.name],
            q: s.q, r: s.r, leader, cause: top.id, causeLabel: String(top.label || top.id).toLowerCase(), demands, strength, strength0: strength,
            startDay: day, phase: 'gather', phaseDay: day, lastBurn: day - 1000, burned: [], plundered: [], target: null,
            against: lord.kind === 'player' ? lord.role : 'ai', aiReact: day + Math.round(r0 + (r1 - r0) * _roll(world, `react|${key}|${day}`)),
            royalHostDay: -1e9, parleyed: false, hostId: `peasants_${st.nextId - 1}_${day}`, stuck: 0,
        };
        st.revolts.push(rv);
        st.realms[realmKey] = day;
        t.last = day;
        st.stats.risen++;
        PeasantRevolts._spawnHost(world, rv);
        if (k) k.stability = _clamp(_num(k.stability, 50) + _num(C.stability.start, -3), 0, 100);
        if (lord.role === 'holding') {
            const h = Holdings.ensure(s);
            if (h) h.unrest = _clamp(_num(h.unrest) + 10, 0, 100);
        }
        const vars = PeasantRevolts._vars(world, rv, player);
        const text = PeasantRevolts.line('rise', vars);
        PeasantRevolts._record(world, st, rv, 'rise', text);
        if (Array.isArray(world.events)) world.events.push({ text, type: 'political', category: 'political', kingdom: rv.kingdomId, impact: 'negative' });
        if (rv.against !== 'ai' && player) {
            _note(out, '🔥', 'The Commons Rise', PeasantRevolts.line('riseYours', vars), 'error');
            Interrupts.raise(world, { reason: `${s.name} rises against you`, icon: '🔥', source: 'peasantRevolts' });
        } else if (player && PeasantRevolts._near(world, player, rv, 8)) {
            _note(out, '🔥', 'A Rising Nearby', text, 'warning');
        }
        // The first fires
        PeasantRevolts._burn(world, player, st, rv, key, day, out);
        return rv;
    },

    /** A real townsperson where the town keeps a roster; else a name from the data. */
    _pickLeader(world, s, day, salt) {
        const C = PeasantRevolts.config();
        const folk = s.folk;
        if (folk && Array.isArray(folk.people)) {
            const pool = Townsfolk.residents(folk).filter(p => {
                const a = Townsfolk.age(p, day);
                return a >= 20 && a <= 60 && !['noble', 'lord', 'guard', 'priest', 'governor'].includes(p.role);
            });
            if (pool.length) {
                // the hard-working and the hot-tempered first (a weighted hash pick)
                const p = pool[Math.floor(_roll(world, `leader|${salt}`) * pool.length)];
                const role = Townsfolk.roleTitle(p) || 'a commoner';
                return { name: Townsfolk.name(p), gender: p.gender === 'female' ? 'female' : 'male', pid: p.id, role: /^(a|an|the) /i.test(role) ? role : _an(String(role).toLowerCase()), town: s.name, q: s.q, r: s.r };
            }
        }
        const N = C.leaderNames;
        const fem = _roll(world, `lgender|${salt}`) < 0.25;
        const firsts = (fem ? N.female : N.male) || ['Wat'];
        const bys = N.bynames || ['the Tyler'];
        const first = firsts[Math.floor(_roll(world, `lfirst|${salt}`) * firsts.length)];
        const by = bys[Math.floor(_roll(world, `lby|${salt}`) * bys.length)];
        return { name: `${first} ${by}`, gender: fem ? 'female' : 'male', pid: null, role: fem ? 'a widow of the town' : 'a man of the town', town: s.name, q: s.q, r: s.r };
    },

    _vars(world, rv, player) {
        const C = PeasantRevolts.config();
        const s = _town(world, rv.origin);
        return {
            town: s ? s.name : rv.townNames[0], leader: rv.leader.name, role: rv.leader.role, strength: Math.round(rv.strength),
            cause: rv.causeLabel, lord: PeasantRevolts._lordName(world, rv, player), host: PeasantRevolts.hostName(rv),
            demands: _list(rv.demands.map(d => (C.demands[d] || {}).label || d)),
        };
    },

    hostName(rv) { return `${rv.leader.name}'s rising`; },

    _record(world, st, rv, kind, text) {
        st.history.unshift({ day: _day(world), kind, id: rv.id, kingdomId: rv.kingdomId, town: rv.townNames[0], leader: rv.leader.name, text });
        if (st.history.length > HIST_CAP) st.history.length = HIST_CAP;
    },

    _near(world, player, rv, hexes) {
        return player && typeof player.q === 'number' && _dist(world, player, rv) <= hexes;
    },

    // ── The host on the map ───────────────────────────

    _spawnHost(world, rv) {
        if (!Array.isArray(world.units)) world.units = [];
        const H = PeasantRevolts.config().host;
        // (made on a seeded stream of its own: the WorldUnit constructor rolls)
        const unit = Utils.withRng(Utils.seededRandom((Utils.hashStr(`${_seed(world)}|rebels|${rv.hostId}`) >>> 0) || 1), () => new WorldUnit('peasant_host', rv.q, rv.r, rv.q, rv.r));
        unit.id = rv.hostId;
        unit.icon = '🔥';
        unit.name = `${rv.leader.name}'s Rising`;
        unit.speed = _num(H.speed, 2);
        unit.strength = Math.max(1, Math.round(rv.strength * _num(H.unitShare, 1)));
        unit.population = Math.round(rv.strength * 3);
        unit.peasantRevoltId = rv.id;
        unit.kingdomId = null;
        unit.maxAge = 1e6;
        unit.objectiveQ = rv.target ? rv.target.q : rv.q;
        unit.objectiveR = rv.target ? rv.target.r : rv.r;
        unit.inventory = Object.assign({ food: Math.round(rv.strength) }, _obj(rv.packs) || {});
        // (they bar the road to every traveller — RoadEncounters: their lord they attack on sight)
        unit.hostile = true;
        world.units.push(unit);
        return unit;
    },

    _unitOf(world, rv) {
        return (world.units || []).find(u => u && u.id === rv.hostId) || null;
    },

    _revoltDay(world, player, st, rv, ctx, day, out) {
        const C = PeasantRevolts.config();
        const M = C.march;
        // An old save's player rule changed (crowned, lost a holding): the rising answers to whoever is lord now
        const os = _town(world, rv.origin);
        if (os) {
            const lord = PeasantRevolts._lordOf(ctx, os);
            rv.against = lord.kind === 'player' ? lord.role : 'ai';
        }
        let unit = PeasantRevolts._unitOf(world, rv);
        if (!unit) unit = PeasantRevolts._spawnHost(world, rv);
        if (unit.destroyed) {
            // Cut down by the player alone on the road (RoadEncounters._duel), or broken by someone else (a patrol, a crown's men)
            if (unit.slainByPlayer && player) return PeasantRevolts.onHostDefeated(player, world, unit);
            return PeasantRevolts._end(world, player, st, rv, 'crushed', { by: 'ai' }, out);
        }
        unit.hostile = !!player;
        // Bloodied on the road (a fight that scattered them): the rising is the weaker for it
        const expect = Math.max(1, Math.round(rv.strength * _num(C.host.unitShare, 1)));
        if (unit.strength < expect) rv.strength = Math.max(0, unit.strength / Math.max(0.01, _num(C.host.unitShare, 1)));
        // Their lord within sight: they go for him (and back to their road when he is gone)
        PeasantRevolts._chase(world, player, rv, unit);
        rv.stuck = unit.q === rv.q && unit.r === rv.r && rv.phase === 'march' ? rv.stuck + 1 : 0;
        rv.q = unit.q; rv.r = unit.r;
        // Men drift home to their fields
        const harvest = Seasons.seasonOf(day) === 'Autumn' ? _num(M.harvestDecay, 3) : 1;
        rv.strength = Math.max(0, rv.strength * (1 - _num(M.decay, 0.004) * harvest));
        unit.strength = Math.max(1, Math.round(rv.strength * _num(C.host.unitShare, 1)));
        if (rv.strength < _num(M.dispersAt, 8) || day - rv.startDay > _num(M.maxDays, 180) || rv.stuck > _num(M.stuckDays, 10)) {
            return PeasantRevolts._end(world, player, st, rv, 'dispersed', {}, out);
        }
        // The phases: gather (and burn) → march (spread or seat) → siege → storm
        if (rv.phase === 'gather') {
            const here = rv.towns[rv.towns.length - 1];
            if (day - rv.lastBurn >= _num(C.burn.every, 5)) PeasantRevolts._burn(world, player, st, rv, here, day, out);
            const wait = rv.towns.length > 1 ? Math.round(_num(M.gatherDays, 12) / 2) : _num(M.gatherDays, 12);
            if (day - rv.phaseDay >= wait) PeasantRevolts._nextTarget(world, player, st, rv, unit, day, out);
        } else if (rv.phase === 'march' && rv.target) {
            if (unit.q === rv.target.q && unit.r === rv.target.r) {
                if (rv.target.kind === 'town') PeasantRevolts._join(world, player, st, rv, rv.target.key, day, out);
                else { rv.phase = 'siege'; rv.phaseDay = day; }
            }
        } else if (rv.phase === 'siege') {
            if (day - rv.phaseDay >= _num(M.siegeDays, 10)) PeasantRevolts._storm(world, player, st, rv, day, out);
        }
        if (!st.revolts.includes(rv)) return null;
        // The lord answers (an AI realm's, or any while no one reigns)
        if ((rv.against === 'ai' || !player) && day >= rv.aiReact && !rv.aiDone) PeasantRevolts._aiAnswer(world, player, st, rv, day, out);
        return rv;
    },

    _nextTarget(world, player, st, rv, unit, day, out) {
        const C = PeasantRevolts.config();
        const M = C.march;
        if (rv.towns.length < _num(M.maxTowns, 4) && rv.against !== 'holding') {
            let best = null;
            for (const s of (world.getSettlementViews ? world.getSettlementViews() : [])) {
                if (!s || s.kingdom !== rv.kingdomId || rv.kingdomId == null) continue;
                const key = _key(s.q, s.r);
                if (rv.towns.includes(key)) continue;
                const d = _dist(world, rv, s);
                if (d > _num(M.reach, 6) || d === 0) continue;
                const g = _num((st.towns[key] || {}).g);
                if (g < _num(M.spreadAt, 48)) continue;
                if (!best || g - d * 2 > best.score) best = { s, key, score: g - d * 2 };
            }
            if (best) {
                rv.target = { kind: 'town', key: best.key, q: best.s.q, r: best.s.r, name: best.s.name };
                rv.phase = 'march'; rv.phaseDay = day;
                unit.objectiveQ = best.s.q; unit.objectiveR = best.s.r;
                return;
            }
        }
        const seat = PeasantRevolts._seatFor(world, rv);
        rv.target = seat;
        rv.phase = seat.q === rv.q && seat.r === rv.r ? 'siege' : 'march';
        rv.phaseDay = day;
        unit.objectiveQ = seat.q; unit.objectiveR = seat.r;
        const text = PeasantRevolts.line('marchSeat', { host: PeasantRevolts.hostName(rv), seat: seat.name });
        PeasantRevolts._record(world, st, rv, 'march', text);
        if (rv.against !== 'ai' && player) {
            _note(out, '🔥', 'Rebels on the March', `${text} Meet them in the field, or answer them from 🔥 Risings.`, 'warning');
            Interrupts.raise(world, { reason: `${PeasantRevolts.hostName(rv)} marches on ${seat.name}`, icon: '🔥', source: 'peasantRevolts' });
        }
    },

    /** The lord's seat it marches on: the holding itself, the capital within reach, else the nearest city of the realm. */
    _seatFor(world, rv) {
        const M = PeasantRevolts.config().march;
        const origin = _town(world, rv.origin);
        const here = { kind: 'seat', key: rv.origin, q: _xy(rv.origin)[0], r: _xy(rv.origin)[1], name: origin ? origin.name : rv.townNames[0] };
        if (rv.against === 'holding') return here;
        const k = _kingdom(world, rv.kingdomId);
        if (!k) return here;
        if (k.capital && _dist(world, rv, k.capital) <= _num(M.seatReach, 14)) {
            const s = _town(world, _key(k.capital.q, k.capital.r));
            if (s) return { kind: 'seat', key: _key(k.capital.q, k.capital.r), q: k.capital.q, r: k.capital.r, name: s.name, capital: true };
        }
        let best = null;
        for (const s of (world.getSettlementViews ? world.getSettlementViews() : [])) {
            if (!s || s.kingdom !== k.id || !['city', 'capital'].includes(s.type)) continue;
            const d = _dist(world, rv, s);
            if (d > _num(M.seatReach, 14)) continue;
            if (!best || d < best.d) best = { d, s };
        }
        if (best) return { kind: 'seat', key: _key(best.s.q, best.s.r), q: best.s.q, r: best.s.r, name: best.s.name, capital: !!(k.capital && k.capital.q === best.s.q && k.capital.r === best.s.r) };
        return here;
    },

    _join(world, player, st, rv, key, day, out) {
        const C = PeasantRevolts.config();
        const s = _town(world, key);
        rv.phase = 'gather'; rv.phaseDay = day; rv.target = null;
        if (!s) return;
        const t = PeasantRevolts._townRec(st, key);
        rv.towns.push(key);
        rv.townNames.push(s.name);
        t.last = day;
        const add = Math.round(_num(C.host.perHead, 0.06) * _num(s.population) * _num(t.g) / 100);
        rv.strength = Math.min(_num(C.host.max, 260) * 1.5, rv.strength + add);
        const k = _kingdom(world, rv.kingdomId);
        if (k) k.stability = _clamp(_num(k.stability, 50) + _num(C.stability.townJoins, -1), 0, 100);
        const text = PeasantRevolts.line('joins', { town: s.name, leader: rv.leader.name });
        PeasantRevolts._record(world, st, rv, 'join', text);
        if (rv.against !== 'ai' && player) _note(out, '🔥', 'The Rising Spreads', `${text} The host is ${Math.round(rv.strength)} strong.`, 'warning');
        PeasantRevolts._burn(world, player, st, rv, key, day, out);
    },

    /** Fire the estates about a town (not the commons' own), plunder a property of the player's there. */
    _burn(world, player, st, rv, key, day, out) {
        const B = PeasantRevolts.config().burn;
        rv.lastBurn = day;
        const [q, r] = _xy(key);
        const s = _town(world, key);
        if (!s) return;
        const spare = new Set(B.spare || ['town']);
        const burnt = new Set(st.burnt.map(b => b.id));
        const ests = Estates.estatesOf(world, q, r).filter(e => !spare.has(Estates.kindOf(e.holder)) && !burnt.has(e.id) && !rv.burned.includes(e.id));
        const n = Math.min(ests.length, Math.max(0, Math.round(_num(B.perTown, 2))) - rv.burned.filter(id => { const e = Estates.estate(world, id); return e && e.town === key; }).length);
        for (let i = 0; i < n; i++) {
            const e = ests[Math.floor(_roll(world, `burn|${rv.id}|${key}|${day}|${i}`) * ests.length)];
            if (!e || rv.burned.includes(e.id)) continue;
            const lost = Math.round(Math.min(_num(e.soil, 1) - 0.3, _num(e.soil, 1) * _num(B.soilLoss, 0.45)) * 1000) / 1000;
            if (!(lost > 0)) continue;
            e.soil = Math.round((_num(e.soil, 1) - lost) * 1000) / 1000;
            e.burntDay = day;
            Estates.bumpTown(world, e.town);
            st.burnt.push({ id: e.id, lost, left: lost, day });
            rv.burned.push(e.id);
            const yours = e.holder === 'player' || Estates.kindOf(e.holder) === 'player';
            const vars = { host: PeasantRevolts.hostName(rv), estate: e.name, town: s.name };
            if (yours && player) _note(out, '🔥', 'Your Estate Burned', PeasantRevolts.line('burnYours', vars), 'error');
            else if (i === 0) PeasantRevolts._record(world, st, rv, 'burn', PeasantRevolts.line('burn', vars));
        }
        // A property of the player's on the town's hex: its stores into the rebels' packs
        if (player && !rv.plundered.includes(key)) {
            const tile = _tile(world, q, r);
            const props = tile ? [...(Array.isArray(tile.playerProperties) ? tile.playerProperties : []), ...(tile.playerProperty ? [tile.playerProperty] : [])] : [];
            const unit = PeasantRevolts._unitOf(world, rv);
            for (const prop of props) {
                if (!prop || prop.underConstruction) continue;
                rv.plundered.push(key);
                if (prop.produces && prop.produces !== 'gold' && _num(prop.storage) > 0) {
                    const n2 = Math.floor(_num(prop.storage));
                    rv.packs = rv.packs || {};
                    rv.packs[prop.produces] = _num(rv.packs[prop.produces]) + n2;
                    if (unit) unit.inventory[prop.produces] = _num(unit.inventory[prop.produces]) + n2;
                    prop.storage = 0;
                }
                prop.sabotagedDays = Math.max(_num(prop.sabotagedDays), _num(B.sabotageDays, 25));
                _note(out, '🔥', 'Your Property Plundered', PeasantRevolts.line('plunder', { host: PeasantRevolts.hostName(rv), prop: prop.type || 'property', town: s.name }), 'error');
                break;
            }
        }
    },

    _seatDefence(world, rv, s, player) {
        const S = PeasantRevolts.config().seat;
        const k = _kingdom(world, s.kingdom);
        const cap = !!(k && k.capital && k.capital.q === s.q && k.capital.r === s.r);
        // (a town whose own commons joined the rising lends its walls no townsmen)
        const joined = rv.towns.includes(_key(s.q, s.r));
        let d = (joined ? 0 : _num(s.population) * _num(S.popDefence, 0.05)) + (k ? _num(k.military) * (cap ? _num(S.capitalMilitary, 0.3) : _num(S.townMilitary, 0.1)) : 0);
        if (player && rv.against === 'holding') d += Holdings.defenseRating(s);
        return d;
    },

    _storm(world, player, st, rv, day, out) {
        const C = PeasantRevolts.config();
        const S = C.seat;
        const s = _town(world, rv.target ? rv.target.key : rv.origin);
        if (!s) return PeasantRevolts._end(world, player, st, rv, 'dispersed', {}, out);
        const def = PeasantRevolts._seatDefence(world, rv, s, player);
        const roll = 0.8 + 0.5 * _roll(world, `storm|${rv.id}|${day}`);
        const vars = { ...PeasantRevolts._vars(world, rv, player), seat: s.name };
        if (rv.strength * roll <= def) {
            const text = PeasantRevolts.line('seatHolds', vars);
            PeasantRevolts._record(world, st, rv, 'holds', text);
            if (player && rv.against !== 'ai') _note(out, '🛡️', 'The Seat Holds', text, 'success');
            return PeasantRevolts._end(world, player, st, rv, 'crushed', { by: rv.against !== 'ai' && player ? 'seat' : 'ai', quiet: true }, out);
        }
        // The seat falls: the demands are taken
        s.population = Math.max(0, Math.round(_num(s.population) * (1 - _num(S.populationLoss, 0.05))));
        if (player && rv.against === 'holding') {
            const h = Holdings.ensure(s);
            h.unrest = _clamp(_num(h.unrest) + _num(S.holdingUnrest, 25), 0, 100);
            Holdings._garrisonLosses(h, _num(S.holdingGarrisonLoss, 0.3));
        }
        const k = _kingdom(world, rv.kingdomId);
        // A weak AI lord in his capital is dragged down
        if (rv.against === 'ai' && k && rv.target && rv.target.capital && PeasantRevolts._weakLord(k)) {
            const was = k.ruler || 'the king';
            const ruler = k.characterData && k.characterData.ruler;
            if (!(ruler && ruler.isPlayer)) {
                Utils.withRng(Utils.seededRandom((Utils.hashStr(`${_seed(world)}|topple|${rv.id}`) >>> 0) || 1), () => NPCLords.lordDies(k, world));
                k.stability = _clamp(_num(k.stability, 50) + _num(C.ai.toppleStability, -12), 0, 100);
                st.stats.toppled++;
                const text = PeasantRevolts.line('toppled', { lord: was, realm: Names.realm(k.name), heir: k.ruler || 'another', demands: vars.demands });
                PeasantRevolts._record(world, st, rv, 'toppled', text);
                if (Array.isArray(world.events)) world.events.push({ text, type: 'political', category: 'political', kingdom: k.id, impact: 'negative' });
                if (player) _note(out, '👑', 'A Throne Falls to the Mob', text, 'warning');
                PeasantRevolts._grant(world, player, st, rv, 'forced');
                return PeasantRevolts._end(world, player, st, rv, 'toppled', { quiet: true }, out);
            }
        }
        const text = PeasantRevolts.line('seatFalls', vars);
        PeasantRevolts._record(world, st, rv, 'won', text);
        if (Array.isArray(world.events)) world.events.push({ text, type: 'political', category: 'political', kingdom: rv.kingdomId, impact: 'negative' });
        PeasantRevolts._grant(world, player, st, rv, 'forced');
        if (player && rv.against !== 'ai') {
            const P = C.player;
            const loss = Math.min(House.getPrestige(player), _num(P.seatLostPrestige, 40));
            if (loss > 0 && player.house) House.spend(player.house, loss, `the commons stormed ${s.name}`, day);
            PeasantRevolts._lordsScorn(player, _num(P.seatLostFavour, 8));
            if (k && rv.against === 'crown') k.stability = _clamp(_num(k.stability, 50) + _num(P.seatLostStability, -8), 0, 100);
            PeasantRevolts.playerState(player).stats.lost = _num(PeasantRevolts.playerState(player).stats.lost) + 1;
            _note(out, '🔥', 'The Seat Falls', `${text} (−${loss} Prestige)`, 'error');
            Interrupts.raise(world, { reason: `The commons stormed ${s.name}`, icon: '🔥', source: 'peasantRevolts' });
        }
        return PeasantRevolts._end(world, player, st, rv, 'won', { quiet: true }, out);
    },

    _weakLord(k) {
        const A = PeasantRevolts.config().ai;
        const lord = k.lord || {};
        return _num(lord.martial, 5) <= _num(A.weakMartial, 4) || _num(k.stability, 50) < _num(A.weakStability, 35);
    },

    // ── Granting the demands ──────────────────────────

    /**
     * The demands granted to every town of the rising. how: 'player' (you
     * conceded), 'forced' (the seat fell), 'ai' (a lord conceded), 'parley'
     * (promises: a lighter relief only). Bread is paid for in coin (the
     * payer's purse or treasury into the towns').
     */
    _grant(world, player, st, rv, how) {
        const C = PeasantRevolts.config();
        const day = _day(world);
        const k = _kingdom(world, rv.kingdomId);
        for (const key of rv.towns) {
            const s = _town(world, key);
            if (!s) continue;
            const t = PeasantRevolts._townRec(st, key);
            t.relief = Array.isArray(t.relief) ? t.relief : [];
            if (how === 'parley') {
                const Pa = C.player.parley || {};
                t.relief.push({ kind: 'parley', amt: _num(Pa.relief, 10), day, until: day + _num(Pa.reliefYears, 2) * YEAR });
                continue;
            }
            for (const id of rv.demands) {
                const d = C.demands[id] || {};
                t.relief.push({ kind: id, amt: _num(d.relief, 15), day, until: day + Math.max(0.1, _num(d.reliefYears, 5)) * YEAR });
                if (d.taxCut > 0) {
                    const ch = _obj(s.charter) || { day, kinds: [] };
                    ch.taxCut = Math.max(_num(ch.taxCut), _num(d.taxCut));
                    if (!ch.kinds.includes(id)) ch.kinds.push(id);
                    ch.day = day;
                    ch.by = PeasantRevolts._lordName(world, rv, player);
                    s.charter = ch;
                }
                if (id === 'bread') PeasantRevolts._payBread(world, player, rv, s, k, how);
                if (id === 'steward' && player && rv.against !== 'ai') PeasantRevolts._dropSteward(world, player, rv, s);
            }
        }
    },

    breadCost(world, rv) {
        const d = PeasantRevolts.config().demands.bread || {};
        let n = 0;
        for (const key of rv.towns) { const s = _town(world, key); if (s) n += _num(s.population) * _num(d.perHead, 0.6); }
        return Math.round(n);
    },

    _payBread(world, player, rv, s, k, how) {
        const d = PeasantRevolts.config().demands.bread || {};
        const amt = Math.round(_num(s.population) * _num(d.perHead, 0.6));
        if (!(amt > 0)) return 0;
        // Who pays: the royal treasury (a crown), the player's purse (a holding), the AI crown
        if (player && rv.against === 'holding') {
            const pay = Math.min(amt, Math.max(0, Math.floor(_num(player.gold))));
            const paid = pay > 0 ? Economy.payTown(s, pay) : 0;
            if (paid > 0) { player.gold -= paid; Ledger.record(player, 'charity', -paid); }
            return paid;
        }
        if (k) {
            const pay = Math.min(amt, Math.max(0, Math.floor(_num(k.treasury))));
            const paid = pay > 0 ? Economy.payTown(s, pay) : 0;
            if (paid > 0) k.treasury -= paid;
            return paid;
        }
        return 0;
    },

    _dropSteward(world, player, rv, s) {
        if (rv.against === 'holding') {
            const h = Holdings.ensure(s);
            if (h && h.governor) Holdings.dismissGovernor(player, world, s.q, s.r);
            return;
        }
        const court = Kingship.court(player);
        const seat = court && court.council && court.council.steward;
        if (seat) {
            court.council.steward = null;
            if (seat.kind === 'vassal') {
                const v = (court.vassals || []).find(x => x.id === seat.id);
                if (v) v.favour = _num(v.favour) - 15;
            }
            Kingship.refresh(player, world);
        }
    },

    /** The lords call you weak: every vassal of your court thinks the less of you. */
    _lordsScorn(player, amount) {
        const court = Kingship.court(player);
        if (!court || !Array.isArray(court.vassals)) return;
        for (const v of court.vassals) if (!v.rebel) v.favour = _num(v.favour) - amount;
    },

    // ── The ending ────────────────────────────────────

    _end(world, player, st, rv, how, opts = {}, out = null) {
        const C = PeasantRevolts.config();
        const day = _day(world);
        st.revolts = st.revolts.filter(x => x !== rv);
        const unit = PeasantRevolts._unitOf(world, rv);
        if (unit) unit.destroyed = true;
        rv.ended = { day, how, by: opts.by || null };
        if (st.stats[how] != null) st.stats[how]++;
        const k = _kingdom(world, rv.kingdomId);
        const vars = PeasantRevolts._vars(world, rv, player);
        let text = null;
        if (how === 'dispersed') {
            text = PeasantRevolts.line('disperse', vars);
            for (const key of rv.towns) { const t = PeasantRevolts._townRec(st, key); t.g = _r1(_num(t.g) * 0.85); }
        } else if (how === 'crushed') {
            const by = opts.by || 'ai';
            // Those who swore to the rising on the road are remembered by the crown that broke it
            if (player && Array.isArray(rv.sworn) && rv.sworn.length && rv.kingdomId != null && player.reputation && typeof player.reputation === 'object') {
                player.reputation[rv.kingdomId] = _num(player.reputation[rv.kingdomId]) + _num((C.road && C.road.swear || {}).brokenReputation, -10);
                _note(out, '📜', 'Your Oath Remembered', `The rising of ${rv.leader.name} is broken, and the crown has the names of those who swore to it. Yours is among them.`, 'warning');
            }
            text = PeasantRevolts.line('crushed', { ...vars, by: by === 'player' ? 'you' : by === 'royal' ? 'your royal host' : by === 'seat' ? 'the walls of your seat' : (k ? `the men of ${Names.realm(k.name)}` : 'the lord\'s men') });
            if (k && by === 'ai') k.stability = _clamp(_num(k.stability, 50) + _num(C.ai.crushStability, 2), 0, 100);
            // The lord decides their fate: you (your realm or holding, or a host you broke yourself), or the realm's lord
            if (player && rv.against !== 'ai') {
                const ps = PeasantRevolts.playerState(player);
                ps.aftermath = { rvId: rv.id, day, until: day + _num(C.player.aftermathDays, 30), rv: JSON.parse(JSON.stringify(rv)) };
                ps.stats.crushed = _num(ps.stats.crushed) + 1;
            } else {
                PeasantRevolts._aiAftermath(world, player, st, rv, out);
            }
        } else if (how === 'conceded' || how === 'parleyed' || how === 'boughtOff') {
            text = opts.text || null;
        }
        if (text && !opts.quiet) {
            PeasantRevolts._record(world, st, rv, how, text);
            if (Array.isArray(world.events)) world.events.push({ text, type: 'political', category: 'political', kingdom: rv.kingdomId });
            if (player && (rv.against !== 'ai' || PeasantRevolts._near(world, player, rv, 8))) _note(out, how === 'crushed' ? '🛡️' : '🔥', how === 'crushed' ? 'The Rising Crushed' : 'The Rising Ends', text, how === 'crushed' ? 'success' : 'info');
        }
        return text;
    },

    /** An AI lord's verdict on a crushed rising, by his traits. */
    _aiAftermath(world, player, st, rv, out) {
        const k = _kingdom(world, rv.kingdomId);
        const traits = new Set(((k && k.lord && k.lord.traits) || []).map(x => x && x.id));
        let choice = 'hang_leader';
        if (['cruel', 'tyrant', 'ruthless'].some(x => traits.has(x))) choice = 'hang_ringleaders';
        else if (['just', 'generous', 'pious', 'honorable'].some(x => traits.has(x))) choice = _roll(world, `aimercy|${rv.id}`) < 0.5 ? 'mercy' : 'hang_leader';
        PeasantRevolts._applyAftermath(world, null, st, rv, choice);
    },

    /** A crushed rising's fate in every town of it. player: the lord who chose it (null: an AI lord). */
    _applyAftermath(world, player, st, rv, choice) {
        const C = PeasantRevolts.config();
        const A = C.aftermath[choice] || {};
        const day = _day(world);
        for (const key of rv.towns) {
            const t = PeasantRevolts._townRec(st, key);
            t.g = _r1(_num(t.g) * _num(A.keep, 0.7));
            if (_num(A.fear) > 0) t.fear = { amt: _num(A.fear), until: day + _num(A.fearYears) * YEAR, resent: _num(A.resent), resentUntil: day + (_num(A.fearYears) + _num(A.resentYears)) * YEAR };
            if (_num(A.hanged) > 0) {
                const n = key === rv.origin ? _num(A.hanged) : Math.ceil(_num(A.hanged) / 3);
                t.hanged = PeasantRevolts._hangedNow(t, day) + n;
                t.hangedDay = day;
            }
            if (_num(A.populationLoss) > 0) {
                const s = _town(world, key);
                if (s) s.population = Math.max(0, Math.round(_num(s.population) * (1 - _num(A.populationLoss))));
            }
        }
        // The leader's fate
        const L = rv.leader;
        if (choice === 'hang_leader' || choice === 'hang_ringleaders') {
            if (!(player && PeasantRevolts._condemn(world, player, rv, L))) PeasantRevolts._hangLeader(world, L, rv);
        } else if (choice === 'imprison' && player) {
            PeasantRevolts._takePrisoner(world, player, st, rv);
        }
        if (player) {
            player.karma = _num(player.karma) + _num(A.karma);
            player.renown = _num(player.renown) + _num(A.renown);
            if (_num(A.cruelty) > 0) Traits.recordDeed(player, 'cruelty', _num(A.cruelty));
            const ps = PeasantRevolts.playerState(player);
            if (choice === 'mercy') ps.stats.mercy = _num(ps.stats.mercy) + 1;
            if (choice.startsWith('hang')) ps.stats.hanged = _num(ps.stats.hanged) + (choice === 'hang_ringleaders' ? _num(A.hanged) : 1);
        }
        const vars = { ...PeasantRevolts._vars(world, rv, player), n: _num(A.hanged), town: rv.townNames[0] };
        const text = choice === 'mercy' ? PeasantRevolts.line('mercy', vars)
            : choice === 'hang_ringleaders' ? PeasantRevolts.line('ringleaders', vars)
                : choice === 'imprison' ? PeasantRevolts.line('taken', vars) : PeasantRevolts.line('hanged', vars);
        PeasantRevolts._record(world, st, rv, choice, text);
        return text;
    },

    /**
     * The scaffold, if it stands (systems/executions.js): the leader put on the
     * list of the condemned awaiting your word (the day, the method, the crowd
     * are the scaffold's). → true when taken; false: hang them here and now.
     */
    _condemn(world, player, rv, L, ref = null) {
        const impl = _exec || (Executions && typeof Executions.condemn === 'function' ? Executions : null);
        if (!impl || !player) return false;
        // (a leader taken off the streets to your prison walks to the scaffold from it)
        const s = L.pid != null ? _town(world, _key(L.q, L.r)) : null;
        const p = s && s.folk ? Townsfolk.get(s.folk, L.pid) : null;
        if (p && p.died == null && p.away) p.away = null;
        const person = p && p.died == null
            ? { kind: 'folk', q: L.q, r: L.r, pid: L.pid }
            : { kind: 'other', name: L.name, gender: L.gender, rank: 'commoner', q: L.q, r: L.r, kingdomId: rv.kingdomId != null ? rv.kingdomId : null };
        try {
            const res = impl.condemn(player, world, person, { crime: 'rebellion', crimeLabel: 'leading a rising of the commons', source: 'peasantRevolts', ref: ref != null ? ref : rv.id, guilty: true });
            if (!(res && res.success !== false && res.ok !== false)) return false;
            // (the sentence weighs on the town as a hanging does)
            PeasantRevolts.noteHanging(world, L.q, L.r, 1);
            return true;
        } catch (e) {
            return false;
        }
    },

    _hangLeader(world, L, rv) {
        if (L.pid != null) {
            const s = _town(world, _key(L.q, L.r));
            const folk = s && s.folk;
            const p = folk ? Townsfolk.get(folk, L.pid) : null;
            if (p && p.died == null) Townsfolk.slay(folk, p, _day(world), 'hanged for leading a rising', world);
        }
        PeasantRevolts.noteHanging(world, L.q, L.r, 1);
        L.hanged = _day(world);
    },

    _takePrisoner(world, player, st, rv) {
        const ps = PeasantRevolts.playerState(player);
        const L = rv.leader;
        const s = _town(world, rv.origin);
        let accomplices = [];
        if (s && s.folk) {
            accomplices = Townsfolk.residents(s.folk).filter(p => p.id !== L.pid && Townsfolk.age(p, _day(world)) >= 18).slice(0, 40)
                .filter((p, i) => _roll(world, `acc|${rv.id}|${i}`) < 0.08).slice(0, 3).map(p => Townsfolk.name(p));
        }
        if (L.pid != null && s && s.folk) {
            const p = Townsfolk.get(s.folk, L.pid);
            if (p && p.died == null) p.away = { d: _day(world), to: 'a lord\'s prison' };
        }
        ps.prisoners.push({
            id: ps.nextId++, kind: 'rebel_leader', name: L.name, gender: L.gender, role: L.role, pid: L.pid, town: L.town, q: L.q, r: L.r,
            kingdomId: rv.kingdomId, day: _day(world), revoltId: rv.id, crime: 'leading a rising', cause: rv.causeLabel,
            knows: { accomplices, towns: rv.townNames.slice() },
        });
        const t = PeasantRevolts._townRec(st, rv.origin);
        t.held = _num(PeasantRevolts.config().aftermath.imprison && PeasantRevolts.config().aftermath.imprison.heldPressure, 5);
    },

    /** Rebel leaders in the player's prison (the dungeon reads these: systems/interrogation.js). */
    prisoners(player) {
        return player && _obj(player.peasantRevolts) && Array.isArray(player.peasantRevolts.prisoners) ? player.peasantRevolts.prisoners : [];
    },

    /** Another system took a prisoner off the list (hanged, died under question, escaped): their town's held weight goes. */
    releasePrisoner(player, world, id, fate = 'gone') {
        const ps = PeasantRevolts.playerState(player);
        const i = ps.prisoners.findIndex(p => p.id === id);
        if (i < 0) return null;
        const pr = ps.prisoners.splice(i, 1)[0];
        const st = PeasantRevolts.state(world);
        const t = st.towns[_key(pr.q, pr.r)];
        if (t && !ps.prisoners.some(p => p.q === pr.q && p.r === pr.r)) t.held = 0;
        if (fate === 'hanged') PeasantRevolts.noteHanging(world, pr.q, pr.r, 1);
        return pr;
    },

    // ── The AI's answer ───────────────────────────────

    _aiAnswer(world, player, st, rv, day, out) {
        const A = PeasantRevolts.config().ai;
        const k = _kingdom(world, rv.kingdomId);
        rv.aiDone = true;
        if (!k) return PeasantRevolts._end(world, player, st, rv, 'dispersed', {}, out);
        const traits = new Set(((k.lord && k.lord.traits) || []).map(x => x && x.id));
        const W = A.weights || {};
        const score = {};
        for (const [opt, w] of Object.entries(W)) {
            let s = _num(w.base, 0.5);
            for (const [tr, v] of Object.entries(w)) if (tr !== 'base' && traits.has(tr)) s += _num(v);
            score[opt] = s;
        }
        // (a crown with no army can't crush, one with an empty treasury can't pay)
        if (_num(k.military) * _num(A.share, 0.3) < rv.strength * 0.4) score.crush = _num(score.crush) * 0.3;
        if (_num(k.treasury) < rv.strength * _num(A.buyPerMan, 6)) score.buyOff = 0;
        const total = Object.values(score).reduce((a, b) => a + Math.max(0, b), 0) || 1;
        let roll = _roll(world, `aipick|${rv.id}|${day}`) * total;
        let pick = 'crush';
        for (const [opt, v] of Object.entries(score)) { roll -= Math.max(0, v); if (roll <= 0) { pick = opt; break; } }
        const lord = k.ruler || 'the crown';
        const vars = PeasantRevolts._vars(world, rv, null);
        if (pick === 'crush') {
            const royal = _num(k.military) * _num(A.share, 0.3) * (1 + _num(k.lord && k.lord.martial, 5) * _num(A.perMartial, 0.04));
            const winP = _clamp(royal / Math.max(1, royal + rv.strength), 0.1, 0.92);
            if (_roll(world, `aicrush|${rv.id}|${day}`) < winP) {
                k.military = Math.max(0, Math.round(_num(k.military) - rv.strength * 0.2));
                return PeasantRevolts._end(world, player, st, rv, 'crushed', { by: 'ai' }, out);
            }
            rv.strength = rv.strength * _num(A.loseStrength, 1.25);
            k.military = Math.max(0, Math.round(_num(k.military) * (1 - _num(A.loseMilitary, 0.08))));
            k.stability = _clamp(_num(k.stability, 50) + _num(A.lostStability, -4), 0, 100);
            rv.aiDone = false;
            rv.aiReact = day + 25;
            PeasantRevolts._record(world, st, rv, 'beat', `${PeasantRevolts.hostName(rv)} beats the men of ${Names.realm(k.name)} sent against it.`);
            return null;
        }
        if (pick === 'parley' && _roll(world, `aiparley|${rv.id}`) >= _num(A.parleyChance, 0.55)) {
            rv.aiDone = false;
            rv.aiReact = day + 20;
            return null;
        }
        if (pick === 'buyOff') {
            const cost = Math.round(rv.strength * _num(A.buyPerMan, 6));
            const s = _town(world, rv.origin);
            const paid = s && _num(k.treasury) >= cost ? Economy.payTown(s, cost) : 0;
            if (paid > 0) {
                k.treasury -= paid;
                if (_roll(world, `aibuy|${rv.id}`) < _num(A.buyDisperse, 0.6)) return PeasantRevolts._end(world, player, st, rv, 'boughtOff', { text: PeasantRevolts.line('boughtOff', { ...vars, lord }) }, out);
                PeasantRevolts._newLeader(world, st, rv, day);
                rv.aiDone = false; rv.aiReact = day + 20;
                return null;
            }
            pick = 'concede';
        }
        if (pick === 'parley') {
            PeasantRevolts._grant(world, null, st, rv, 'parley');
            return PeasantRevolts._end(world, player, st, rv, 'parleyed', { text: PeasantRevolts.line('parleyed', { ...vars, lord }) }, out);
        }
        PeasantRevolts._grant(world, null, st, rv, 'ai');
        k.stability = _clamp(_num(k.stability, 50) + _num(A.concedeStability, 2), 0, 100);
        return PeasantRevolts._end(world, player, st, rv, 'conceded', { text: PeasantRevolts.line('conceded', { ...vars, lord }) }, out);
    },

    _newLeader(world, st, rv, day) {
        const s = _town(world, rv.origin);
        const old = rv.leader;
        if (s) rv.leader = PeasantRevolts._pickLeader(world, s, day, `${rv.origin}|${day}|new`);
        if (rv.leader.name === old.name) rv.leader = { ...rv.leader, name: `${rv.leader.name} the Younger` };
        const unit = PeasantRevolts._unitOf(world, rv);
        if (unit) unit.name = `${rv.leader.name}'s Rising`;
        for (const key of rv.towns) { const t = PeasantRevolts._townRec(st, key); t.g = _clamp(_num(t.g) + _num(PeasantRevolts.config().player.buyOff.betrayed, 8), 0, 100); }
        return old;
    },

    // ── The player's answer ───────────────────────────

    /** The rising against the player (their realm or holding), or null. */
    mine(player, world) {
        if (!player) return [];
        return PeasantRevolts.active(world).filter(rv => rv.against !== 'ai');
    },

    parleyChance(player, world, rv) {
        const P = PeasantRevolts.config().player.parley || {};
        const g = Math.max(...rv.towns.map(k => _num((PeasantRevolts.state(world).towns[k] || {}).g)), 0);
        const dip = _num(player.skills && player.skills.diplomacy);
        let c = _num(P.base, 0.35) + dip * _num(P.perDiplomacy, 0.04) + _num(player.charisma, 5) * _num(P.perCharisma, 0.015) + _num(player.renown) * _num(P.perRenown, 0.0008)
            - Math.max(0, g - _num(P.angerFrom, 60)) * _num(P.perAnger, 0.01);
        if (!PeasantRevolts._near(world, player, rv, _num(P.nearHexes, 3))) c += _num(P.far, -0.15);
        return _clamp(c, _num(P.min, 0.05), _num(P.max, 0.9));
    },

    buyOffCost(rv) {
        return Math.round(rv.strength * _num(PeasantRevolts.config().player.buyOff.perMan, 6));
    },

    /** The choices the player has against a rising: [{ id, icon, label, desc, ok, why, cost }]. */
    choices(player, world, rv) {
        const C = PeasantRevolts.config();
        const P = C.player;
        const day = _day(world);
        const out = [];
        const dem = _list(rv.demands.map(d => (C.demands[d] || {}).label || d));
        const k = _kingdom(world, rv.kingdomId);
        const bread = rv.demands.includes('bread') ? PeasantRevolts.breadCost(world, rv) : 0;
        const payer = rv.against === 'crown' ? 'the royal treasury' : 'your purse';
        out.push({ id: 'concede', icon: '📜', label: 'Meet their demands', desc: `Grant ${dem}${bread ? ` (bread: ${Utils.formatGold(bread)}g from ${payer})` : ''}. The commons go home, but the lords will call you weak (−${_num(P.concedePrestige, 25)} Prestige${rv.against === 'crown' ? ', every lord\'s favour' : ''}).`, ok: true });
        const pc = PeasantRevolts.parleyChance(player, world, rv);
        out.push({ id: 'parley', icon: '🕊️', label: 'Parley', desc: `Talk them down with promises (${Math.round(pc * 100)}% by your tongue and name against their anger${PeasantRevolts._near(world, player, rv, _num(P.parley.nearHexes, 3)) ? '' : '; better face to face'}). Fail, and they grow bolder.`, ok: !rv.parleyed, why: rv.parleyed ? 'They will not talk again.' : '' });
        const cost = PeasantRevolts.buyOffCost(rv);
        const purse = rv.against === 'crown' && k ? Math.max(_num(k.treasury), _num(player.gold)) : _num(player.gold);
        out.push({ id: 'buyOff', icon: '💰', label: `Buy off ${rv.leader.name}`, desc: `Pay the leader to go home${rv.against === 'crown' ? ' (from the treasury if it can, else your purse)' : ''}. They may hold — or another rises in their place.`, ok: purse >= cost, why: purse >= cost ? '' : `You need ${Utils.formatGold(cost)}g.`, cost });
        if (rv.against === 'crown' && k) {
            const wait = _num(P.royalHost.cooldownDays, 10) - (day - _num(rv.royalHostDay, -1e9));
            const royal = Math.round(_num(k.military) * _num(P.royalHost.share, 0.25));
            out.push({ id: 'royalHost', icon: '⚔️', label: 'Send the royal host', desc: `The realm's men (${royal}) against theirs (${Math.round(rv.strength)}). You will judge them after.`, ok: wait <= 0 && royal > 0, why: royal <= 0 ? 'The realm has no army.' : wait > 0 ? `The host regroups (${Math.ceil(wait)} days).` : '' });
        }
        return out;
    },

    /** The player answers a rising, or judges one crushed, or a prisoner. → { success, text } */
    act(player, world, id, arg = null) {
        if (!player || !world) return { success: false, text: 'No one to answer.' };
        const C = PeasantRevolts.config();
        const P = C.player;
        const st = PeasantRevolts.state(world);
        const ps = PeasantRevolts.playerState(player);
        const day = _day(world);
        const out = { notices: [] };
        if (AFTERMATHS.includes(id)) {
            const am = ps.aftermath;
            if (!am) return { success: false, text: 'There is no one to judge.' };
            ps.aftermath = null;
            const text = PeasantRevolts._applyAftermath(world, player, st, am.rv, id);
            return { success: true, text };
        }
        if (id === 'hangPrisoner' || id === 'freePrisoner') {
            const pr = ps.prisoners.find(p => p.id === arg);
            if (!pr) return { success: false, text: 'No such prisoner.' };
            if (id === 'hangPrisoner') {
                const handed = PeasantRevolts._condemn(world, player, { townNames: [pr.town], kingdomId: pr.kingdomId, id: pr.revoltId }, pr, `prisoner${pr.id}`);
                PeasantRevolts.releasePrisoner(player, world, pr.id, handed ? 'condemned' : 'hanged');
                if (!handed) {
                    if (pr.pid != null) {
                        const s = _town(world, _key(pr.q, pr.r));
                        const p = s && s.folk ? Townsfolk.get(s.folk, pr.pid) : null;
                        if (p && p.died == null) { p.away = null; Townsfolk.slay(s.folk, p, day, 'hanged for leading a rising', world); }
                    }
                    Traits.recordDeed(player, 'cruelty', 1);
                    // The leader's body is yours to show (systems/gibbets.js)
                    Gibbets.offerBody(player, world, { key: `revolt:${pr.id}`, name: pr.name, rank: 'rebel', source: 'rebel', how: `hanged for leading the rising at ${pr.town}`, q: pr.q, r: pr.r, kingdomId: pr.kingdomId, rebel: true, kin: pr.pid != null ? { q: pr.q, r: pr.r, pid: pr.pid } : null });
                }
                ps.stats.hanged = _num(ps.stats.hanged) + 1;
                return { success: true, text: handed ? `${pr.name} is given to the scaffold.` : PeasantRevolts.line('hanged', { leader: pr.name, town: pr.town }) };
            }
            PeasantRevolts.releasePrisoner(player, world, pr.id, 'freed');
            const s = _town(world, _key(pr.q, pr.r));
            if (pr.pid != null && s && s.folk) { const p = Townsfolk.get(s.folk, pr.pid); if (p && p.died == null) p.away = null; }
            const t = st.towns[_key(pr.q, pr.r)];
            if (t) t.g = _r1(_num(t.g) * _num(C.prisoner.releaseKeep, 0.85));
            player.karma = _num(player.karma) + _num(C.prisoner.releaseKarma, 2);
            return { success: true, text: PeasantRevolts.line('released', { leader: pr.name, town: pr.town }) };
        }
        const rv = PeasantRevolts.revolt(world, arg) || PeasantRevolts.mine(player, world)[0];
        if (!rv || rv.against === 'ai') return { success: false, text: 'There is no rising against you.' };
        const ch = PeasantRevolts.choices(player, world, rv).find(c => c.id === id);
        if (!ch) return { success: false, text: 'You cannot do that.' };
        if (!ch.ok) return { success: false, text: ch.why || 'You cannot do that now.' };
        const vars = PeasantRevolts._vars(world, rv, player);
        const k = _kingdom(world, rv.kingdomId);
        if (id === 'concede') {
            PeasantRevolts._grant(world, player, st, rv, 'player');
            const loss = Math.min(House.getPrestige(player), _num(P.concedePrestige, 25));
            if (loss > 0 && player.house) House.spend(player.house, loss, `bowed to the rising of ${rv.leader.name}`, day);
            PeasantRevolts._lordsScorn(player, _num(P.concedeFavour, 6));
            if (k) k.stability = _clamp(_num(k.stability, 50) + _num(P.concedeStability, 4), 0, 100);
            ps.stats.charters = _num(ps.stats.charters) + 1;
            const text = `You grant the rising of ${rv.leader.name} ${vars.demands}. The commons go home cheering; your lords mutter that you are weak (−${loss} Prestige).`;
            PeasantRevolts._end(world, player, st, rv, 'conceded', { text, quiet: true }, out);
            PeasantRevolts._record(world, st, rv, 'conceded', text);
            return { success: true, text };
        }
        if (id === 'parley') {
            rv.parleyed = true;
            ps.stats.parleys = _num(ps.stats.parleys) + 1;
            if (_roll(world, `parley|${rv.id}|${day}`) < PeasantRevolts.parleyChance(player, world, rv)) {
                PeasantRevolts._grant(world, player, st, rv, 'parley');
                const loss = Math.min(House.getPrestige(player), _num(P.parley.prestige, 5));
                if (loss > 0 && player.house) House.spend(player.house, loss, 'a parley with peasants', day);
                const text = `You ride out and talk with ${rv.leader.name}. Promises are made; the commons go home.`;
                PeasantRevolts._end(world, player, st, rv, 'parleyed', { text, quiet: true }, out);
                PeasantRevolts._record(world, st, rv, 'parleyed', text);
                return { success: true, text };
            }
            rv.strength = rv.strength * _num(P.parley.emboldened, 1.2);
            return { success: false, text: `${rv.leader.name} hears you out and laughs. Word goes round that the lord came begging; more men take up their bills (${Math.round(rv.strength)} strong).` };
        }
        if (id === 'buyOff') {
            const cost = PeasantRevolts.buyOffCost(rv);
            const s = _town(world, rv.origin);
            const fromTreasury = rv.against === 'crown' && k && _num(k.treasury) >= cost;
            const paid = s ? Economy.payTown(s, cost) : 0;
            if (!(paid > 0)) return { success: false, text: 'There is no one to take the coin.' };
            if (fromTreasury) k.treasury -= paid;
            else { player.gold -= paid; Ledger.record(player, 'bribes', -paid); }
            ps.stats.bought = _num(ps.stats.bought) + 1;
            if (_roll(world, `buy|${rv.id}|${day}`) < _num(P.buyOff.disperse, 0.6)) {
                const text = `${rv.leader.name} takes ${Utils.formatGold(paid)}g and goes home; without them the rising falls apart.`;
                PeasantRevolts._end(world, player, st, rv, 'boughtOff', { text, quiet: true }, out);
                PeasantRevolts._record(world, st, rv, 'boughtOff', text);
                return { success: true, text };
            }
            const old = PeasantRevolts._newLeader(world, st, rv, day);
            return { success: false, text: `${old.name} takes your ${Utils.formatGold(paid)}g — and ${rv.leader.name} takes their place, crying betrayal. The commons are angrier than before.` };
        }
        if (id === 'royalHost' && k) {
            rv.royalHostDay = day;
            const royal = _num(k.military) * _num(P.royalHost.share, 0.25);
            const winP = _clamp(royal / Math.max(1, royal + rv.strength), 0.08, 0.92);
            if (_roll(world, `royal|${rv.id}|${day}`) < winP) {
                k.military = Math.max(0, Math.round(_num(k.military) - rv.strength * 0.15));
                House.award(player.house, _num(P.crushPrestige, 10), `crushed the rising of ${rv.leader.name}`, day);
                const text = `Your royal host breaks the rising of ${rv.leader.name}. Its people are yours to judge.`;
                PeasantRevolts._end(world, player, st, rv, 'crushed', { by: 'royal', quiet: true }, out);
                PeasantRevolts._record(world, st, rv, 'crushed', text);
                return { success: true, text };
            }
            rv.strength = rv.strength * _num(P.royalHost.loseStrength, 1.3);
            k.military = Math.max(0, Math.round(_num(k.military) * (1 - _num(P.royalHost.royalLoss, 0.1))));
            k.stability = _clamp(_num(k.stability, 50) + _num(P.royalHost.stability, -3), 0, 100);
            return { success: false, text: `Your royal host is beaten back by the commons. The rising swells to ${Math.round(rv.strength)}.` };
        }
        return { success: false, text: 'You cannot do that.' };
    },

    // ── On the road (player/roadEncounters.js) ────────

    ENCOUNTER_CHOICES: ['rebelAlms', 'rebelSwear', 'rebelJoin', 'rebelPromise', 'rebelConcede'],

    /** The rising behind a peasant host unit, or null. */
    ofUnit(world, unit) {
        return unit && unit.peasantRevoltId != null ? PeasantRevolts.revolt(world, unit.peasantRevoltId) : null;
    },

    /** Do they hate this traveller on sight? Their own lord, or a known butcher. */
    hates(player, world, rv) {
        if (!player || !rv) return false;
        if (rv.against !== 'ai') return true;
        return Atrocities.butcher(player) >= _num((PeasantRevolts.config().road || {}).hatedButcher, 40);
    },

    /** Their lord in sight (within road.chaseHexes, out of a town): they march on him; else back to their road. */
    _chase(world, player, rv, unit) {
        const R = PeasantRevolts.config().road || {};
        let home;
        if (rv.target && rv.phase !== 'gather') home = rv.target;
        else { const [q, r] = _xy(rv.towns[rv.towns.length - 1]); home = { q, r }; }
        const here = player && typeof player.q === 'number' ? _tile(world, player.q, player.r) : null;
        const near = !!here && !here.settlement && PeasantRevolts.hates(player, world, rv)
            && _dist(world, player, unit) <= _num(R.chaseHexes, 3) && !(unit.sparedUntilDay != null && _day(world) < unit.sparedUntilDay);
        if (near) { unit.objectiveQ = player.q; unit.objectiveR = player.r; rv.chasing = true; }
        else if (rv.chasing) { unit.objectiveQ = home.q; unit.objectiveR = home.r; rv.chasing = false; }
    },

    _alms(player, rv) {
        const A = (PeasantRevolts.config().road || {}).alms || {};
        const min = _num(A.min, 5);
        return Math.round(Math.min(Math.max(min, _num(player.gold) * _num(A.share, 0.12)), Math.max(min, rv.strength * _num(A.capPerMan, 3))));
    },

    /**
     * The road encounter's choices against a peasant host (RoadEncounters.options
     * calls it): the toll becomes alms for the cause; a passer-by may swear to it
     * or bring their men to it; their own lord (or a butcher) gets no toll and no
     * talk of passing — only promises, or their demands met on the spot. Mutates opts.
     */
    encounterOptions(player, unit, world, opts, sit = {}) {
        const rv = PeasantRevolts.ofUnit(world, unit);
        if (!rv) return opts;
        const R = PeasantRevolts.config().road || {};
        const drop = (id) => { const i = opts.findIndex(o => o.id === id); if (i >= 0) opts.splice(i, 1); };
        const add = (o, at = 1) => opts.splice(at, 0, { chance: null, odds: 'certain', can: true, reason: '', cost: '', ...o });
        drop('toll');
        const realm = rv.kingdomId != null ? _kingdom(world, rv.kingdomId) : null;
        const crown = realm ? Names.realm(realm.name) : 'the crown';
        if (PeasantRevolts.hates(player, world, rv)) {
            drop('parley');
            const ch = PeasantRevolts.parleyChance(player, world, rv);
            add({ id: 'rebelPromise', icon: '🗣️', label: 'Promise to hear them', hint: `Face to face with ${rv.leader.name}. Fail, and they fall on you.`, chance: ch, odds: `${Math.round(ch * 100)}%`, can: !rv.parleyed, reason: rv.parleyed ? 'They will not hear your promises again' : '' });
            if (rv.against !== 'ai') {
                const dem = _list(rv.demands.map(d => (PeasantRevolts.config().demands[d] || {}).label || d));
                add({ id: 'rebelConcede', icon: '📜', label: 'Grant their demands here', hint: `${dem}, sworn before them on the road. The lords will call you weak.` });
            }
            return opts;
        }
        const alms = PeasantRevolts._alms(player, rv);
        const S = R.swear || {}, J = R.join || {};
        if (sit.hasArmy) add({ id: 'rebelJoin', icon: '🔥', label: 'Bring your men to the rising', hint: `Your soldiers march with ${rv.leader.name} on their lord's seat. ${crown} will not forget it (${_num(J.reputation, -20)} reputation).` });
        add({ id: 'rebelSwear', icon: '✊', label: 'Swear to their cause', hint: `Your word that you are with the commons; they leave you be while the rising lasts. If it is broken, ${crown} has the names (${_num(S.reputation, -10)} reputation now).` });
        const can = _num(player.gold) >= alms;
        add({ id: 'rebelAlms', icon: '💰', label: 'Give to the cause', hint: 'Bread money for the rising. They let you by with a cheer.', can, reason: can ? '' : `They ask ${Utils.formatGold(alms)} gold`, cost: `${Utils.formatGold(alms)} gold`, amount: alms });
        return opts;
    },

    /**
     * A peasant host's own road choices. → a road-encounter result, or
     * { fallOn: true, lead } when they fall on you after all (RoadEncounters fights it).
     */
    resolveEncounter(player, unit, world, choice, sit = {}) {
        const rv = PeasantRevolts.ofUnit(world, unit);
        const no = (body) => ({ kind: 'invalid', choice, success: false, notification: { title: 'No', body, type: 'error' } });
        if (!rv) return no('They are no rising any more.');
        const C = PeasantRevolts.config();
        const R = C.road || {};
        const day = _day(world);
        const st = PeasantRevolts.state(world);
        const done = (kind, title, body, type, extra = {}) => ({ kind, choice, success: true, notification: { title, body, type }, ...extra });
        const spare = (days) => { unit.targetQ = null; unit.targetR = null; unit.sparedUntilDay = day + days; };
        const hated = PeasantRevolts.hates(player, world, rv);
        const L = rv.leader.name;
        if (choice === 'rebelAlms' && !hated) {
            const A = R.alms || {};
            const amt = PeasantRevolts._alms(player, rv);
            if (_num(player.gold) < amt) return no(`They ask ${Utils.formatGold(amt)} gold.`);
            player.gold -= amt;
            Ledger.record(player, 'rebelAlms', -amt);
            // (into the rebels' packs: beat them and it is plunder again)
            unit.inventory = unit.inventory || {};
            unit.inventory.gold = _num(unit.inventory.gold) + amt;
            rv.packs = rv.packs || {};
            rv.packs.gold = _num(rv.packs.gold) + amt;
            rv.strength += amt / Math.max(1, _num(A.goldPerMan, 20));
            player.karma = _num(player.karma) + _num(A.karma, 1);
            spare(_num(A.respiteDays, 30));
            return done('paid', '💰 For the Cause', `You give ${Utils.formatGold(amt)} gold to ${L}'s rising. "Bread for the hungry!" they cry, and let you by.`, 'warning', { goldPaid: amt });
        }
        if ((choice === 'rebelSwear' || choice === 'rebelJoin') && !hated) {
            const join = choice === 'rebelJoin';
            const D = join ? (R.join || {}) : (R.swear || {});
            if (join && !sit.hasArmy) return no('You have no soldiers to bring.');
            const who = player.id || player.name || 'player';
            rv.sworn = Array.isArray(rv.sworn) ? rv.sworn : [];
            if (!rv.sworn.includes(who)) rv.sworn.push(who);
            if (rv.kingdomId != null && player.reputation && typeof player.reputation === 'object') player.reputation[rv.kingdomId] = _num(player.reputation[rv.kingdomId]) + _num(D.reputation, join ? -20 : -10);
            player.karma = _num(player.karma) + _num(D.karma, 1);
            player.renown = _num(player.renown) + _num(D.renown, 0);
            const add = join ? Math.round(_num(sit.armyStrength) * _num(D.share, 0.5)) : 0;
            if (join) {
                rv.strength += add;
                rv.joinedBy = { name: player.name || 'a lord', strength: add, day };
            }
            spare(Math.max(1, rv.startDay + _num(C.march.maxDays, 180) - day + 1));
            const text = join
                ? `You bring your men to ${L}'s rising (+${add} strength). The commons cheer a lord who stands with them.`
                : `You swear to ${L} that you are with the commons. They let you go, and will leave you be while the rising lasts.`;
            PeasantRevolts._record(world, st, rv, join ? 'joined' : 'sworn', `${player.name || 'A traveller'} ${join ? 'brings soldiers to' : 'swears to'} the rising of ${L}.`);
            return done(join ? 'joined' : 'sworn', join ? '🔥 You Join the Rising' : '✊ Sworn to the Cause', text, 'warning');
        }
        if (choice === 'rebelPromise' && hated) {
            if (rv.parleyed) return no('They will not hear your promises again.');
            rv.parleyed = true;
            const ps = PeasantRevolts.playerState(player);
            ps.stats.parleys = _num(ps.stats.parleys) + 1;
            if (_roll(world, `roadParley|${rv.id}|${day}`) < PeasantRevolts.parleyChance(player, world, rv)) {
                PeasantRevolts._grant(world, player, st, rv, 'parley');
                const loss = player.house ? Math.min(House.getPrestige(player), _num(C.player.parley.prestige, 5)) : 0;
                if (loss > 0) House.spend(player.house, loss, 'a parley with peasants on the road', day);
                const text = `You meet ${L} on the road and promise to hear the commons' grievances. They go home with your word.`;
                PeasantRevolts._end(world, player, st, rv, 'parleyed', { text, quiet: true }, { notices: [] });
                PeasantRevolts._record(world, st, rv, 'parleyed', text);
                return done('talked', '🗣️ They Go Home', text, 'success');
            }
            rv.strength *= _num(C.player.parley.emboldened, 1.2);
            return { fallOn: true, lead: `${L} spits at your promises: "We want bread, not words!"` };
        }
        if (choice === 'rebelConcede' && hated && rv.against !== 'ai') {
            const res = PeasantRevolts.act(player, world, 'concede', rv.id);
            if (!res.success) return no(res.text);
            spare(30);
            return done('conceded', '📜 Demands Granted', res.text, 'warning');
        }
        return no('That cannot be done here.');
    },

    /** PlayerMilitary.attackUnit: the player broke a rebel host in the field. */
    onHostDefeated(player, world, unit) {
        if (!unit || unit.peasantRevoltId == null) return null;
        const st = PeasantRevolts.state(world);
        const rv = st.revolts.find(x => x.id === unit.peasantRevoltId);
        if (!rv) return null;
        const P = PeasantRevolts.config().player;
        const day = _day(world);
        if (player) {
            House.recordPlayerDeed(player, world, 'battleWon', { reason: `broke ${PeasantRevolts.hostName(rv)}` });
            if (rv.against !== 'ai') House.award(player.house, _num(P.crushPrestige, 10), `crushed the rising of ${rv.leader.name}`, day);
            else {
                // Put down a rising for another's crown: they are grateful
                player.renown = _num(player.renown) + _num(P.crushRenown, 8);
                if (rv.kingdomId != null && player.reputation && typeof player.reputation === 'object') player.reputation[rv.kingdomId] = _num(player.reputation[rv.kingdomId]) + 5;
            }
        }
        PeasantRevolts._end(world, player, st, rv, 'crushed', { by: 'player' }, { notices: [] });
        return rv;
    },

    _playerDay(world, player, day, out) {
        const ps = player.peasantRevolts;
        if (!ps || !ps.aftermath) return;
        // Left unjudged, the captains let the commons go home
        if (day >= _num(ps.aftermath.until)) {
            const am = ps.aftermath;
            ps.aftermath = null;
            const text = PeasantRevolts._applyAftermath(world, player, PeasantRevolts.state(world), am.rv, 'mercy');
            _note(out, '🕊️', 'The Rebels Go Home', `You gave no word on the rebels of ${am.rv.leader.name}; your captains let them go. ${text}`, 'info');
        }
    },

    // ── For the panel ─────────────────────────────────

    /** The player's lands' grievances: [{ key, name, g, p, parts, lord }], worst first. */
    lands(player, world, limit = 10) {
        const ctx = PeasantRevolts._context(world, player);
        const st = PeasantRevolts.state(world);
        const out = [];
        for (const s of (world.getSettlementViews ? world.getSettlementViews() : [])) {
            const key = _key(s.q, s.r);
            const lord = PeasantRevolts._lordOf(ctx, s);
            if (lord.kind !== 'player') continue;
            const t = st.towns[key] || {};
            const pr = PeasantRevolts.pressure(world, s, ctx);
            out.push({ key, name: s.name, q: s.q, r: s.r, g: Math.round(_num(t.g)), p: Math.round(pr.value), parts: pr.parts, role: lord.role, charter: _obj(s.charter) });
        }
        out.sort((a, b) => b.g - a.g);
        return out.slice(0, limit);
    },

    view(player, world) {
        const st = PeasantRevolts.state(world);
        const ps = player ? PeasantRevolts.playerState(player) : null;
        const C = PeasantRevolts.config();
        const mine = player ? PeasantRevolts.mine(player, world) : [];
        return {
            boilAt: _num(C.boilAt, 62),
            mine: mine.map(rv => ({ rv, choices: PeasantRevolts.choices(player, world, rv), dist: typeof player.q === 'number' ? _dist(world, player, rv) : null, demands: rv.demands.map(d => ({ id: d, ...(C.demands[d] || {}) })) })),
            aftermath: ps ? ps.aftermath : null,
            prisoners: ps ? ps.prisoners : [],
            lands: player ? PeasantRevolts.lands(player, world) : [],
            elsewhere: st.revolts.filter(rv => rv.against === 'ai'),
            history: st.history.slice(0, 10),
            stats: st.stats,
        };
    },
};

