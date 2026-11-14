// ============================================
// TRADE LINES — standing routes run by a caravan or a ship
// ============================================
// The player puts a caravan (hired wagons) or one of their ships on a loop
// of 2+ stops and gives each stop its rules:
//
//   buy     good, up to N aboard, if the next unit costs ≤ P
//   sell    good, if the next unit fetches ≥ Q (keeping K aboard)
//   supply  good, N a visit to my property or holding here (a workshop's
//           inputs, a held town's granary or stores)
//   load    good, from my property's store here (what it has made)
//
// and the line goes round until it is paused or wound up. Every leg uses
// the real machinery: a caravan leg is a world unit ('caravan') on the
// map (moved, robbed by raiders, road-linked — world/units.js), a ship leg
// is Ships.moveShip (storms wash cargo over the side, hostile fleets stop
// her, the crew draws wages — systems/ships.js). At each stop the line
// trades with the town as the player would: purchases pay the town's purse
// and take its stock (the price climbs with each unit), sales are paid out
// of its purse and land in its stock (each unit fetches a little less),
// the crowns take their duties, tolls and export bans (systems/
// tradePolicy.js), the guilds their tolls. The drovers' wages go to their
// home town; a wagon hired goes to the town it is hired in.
//
// Coin is the player's purse (a factor's letters of credit: nothing rides
// on the wagons but goods). Each line keeps a ledger: the run in hand and
// the last runs (sold, bought, wages, tolls, hire, crew, goods lost, net,
// notes on why goods were kept), and running totals.
//
// Away from the stops (beyond `awayRange` hexes) a line waits at its home
// stop for the player's word — unless a Master of the Lines runs it
// (systems/stewards.js seat 'trade'): their skill and standing order
// haggle better prices; a crooked one keeps back part of the takings
// (published on player.tradeLines.factorFx, drawn by Stewards weekly).
//
// State: player.tradeLines (saved with the player by SaveLoad). Daily
// processDay(world, player) from ui/game/endDay.js and the playtest
// harness. Draws no RNG of its own (the world units it spawns use Utils).

import { Hex } from '../core/hex.js';
import { DataLoader } from '../core/dataLoader.js';
import { WorldUnit } from '../world/units.js';
import { Economy } from '../world/economy.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Seasons } from '../world/seasons.js';
import { Ships } from '../systems/ships.js';
import { TradePolicy } from '../systems/tradePolicy.js';
import { PriceKnowledge } from '../systems/priceKnowledge.js';
import { Ledger } from '../systems/ledger.js';
import { LossBook } from '../systems/lossBook.js';
import { Guilds } from '../systems/guilds.js';
import { Reckoning } from '../systems/reckoning.js';
import { Underworld } from '../systems/underworld.js';
import { Holdings } from '../systems/holdings.js';
import { Stewards } from '../systems/stewards.js';
import { Infrastructure } from '../systems/infrastructure.js';
import { Technology } from '../systems/technology.js';
import { PublicWorks } from '../systems/publicWorks.js';
import { PlayerInventory } from './inventory.js';
import { PlayerEconomy, Trading } from './playerEconomy.js';
import { Names } from '../core/names.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _int = (v, d = 0) => Math.max(0, Math.floor(_num(Number(v), d)));
const _day = (world) => _num(world && world.day);
const _r2 = (v) => Math.round(v * 100) / 100;
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _name = (id) => String(id || '').replace(/_/g, ' ');

const OPS = ['buy', 'sell', 'supply', 'load'];

const DEFAULTS = {
    maxLines: 8, maxStops: 6, maxRules: 8, ledgerRuns: 12, logCap: 30, awayRange: 8,
    lossesBeforeHalt: 2, unpaidDaysBeforeHalt: 3,
    caravan: { hire: 120, wagePerDay: 3, capacity: 60, maxLegDist: 25 },
    tolls: { rate: 0.03, min: 1 },
    steward: { skillHaggle: 0.005, maxHaggle: 0.08 },
};

let _cfgSrc;
let _cfg = null;

/** Largest k in [1, hi] with pred(k) true, pred monotone (true then false); 0 if none. */
function _maxTrue(hi, pred) {
    if (!(hi >= 1) || !pred(1)) return 0;
    let lo = 1;
    let top = Math.floor(hi);
    while (lo < top) {
        const mid = Math.ceil((lo + top) / 2);
        if (pred(mid)) lo = mid; else top = mid - 1;
    }
    return lo;
}

export const TradeLines = {

    // ──────────── DATA ────────────

    config() {
        const gd = DataLoader._gamedata;
        const d = (gd && gd.tradeLines && gd.tradeLines.config) || null;
        if (!_cfg || d !== _cfgSrc) {
            _cfgSrc = d;
            const o = _obj(d) || {};
            _cfg = { ...DEFAULTS, ...o };
            for (const [k, v] of Object.entries(DEFAULTS)) if (_obj(v)) _cfg[k] = { ...v, ...(_obj(o[k]) || {}) };
        }
        return _cfg;
    },

    // ──────────── STATE ────────────

    _blank() {
        return {
            v: 1, nextId: 1, lines: [], log: [], factorFx: null,
            stats: { runs: 0, net: 0, revenue: 0, lost: 0, robbed: 0 },
            week: { start: 0, revenue: 0, last: 0 },
        };
    },

    /** The player's record (created and backfilled on demand). */
    state(player) {
        if (!player) return null;
        if (!_obj(player.tradeLines)) player.tradeLines = TradeLines._blank();
        const tl = player.tradeLines;
        const b = TradeLines._blank();
        if (!Array.isArray(tl.lines)) tl.lines = [];
        if (!Array.isArray(tl.log)) tl.log = [];
        if (!(tl.nextId > 0)) tl.nextId = 1;
        tl.stats = { ...b.stats, ...(_obj(tl.stats) || {}) };
        tl.week = { ...b.week, ...(_obj(tl.week) || {}) };
        for (const line of tl.lines) TradeLines._backfill(line);
        return tl;
    },

    /** A saved copy (SaveLoad keeps player.tradeLines as it stands). */
    serialize(player) {
        return player && _obj(player.tradeLines) ? JSON.parse(JSON.stringify(player.tradeLines)) : null;
    },

    loadState(player) {
        if (player && _obj(player.tradeLines)) TradeLines.state(player);
    },

    hasLines(player) {
        return !!(player && _obj(player.tradeLines) && Array.isArray(player.tradeLines.lines) && player.tradeLines.lines.length);
    },

    lines(player) {
        return TradeLines.hasLines(player) ? player.tradeLines.lines : [];
    },

    line(player, id) {
        return TradeLines.lines(player).find(l => l.id === id) || null;
    },

    _newRun(n, day) {
        return { n, startDay: day, endDay: null, legs: 0, revenue: 0, spent: 0, wages: 0, tolls: 0, duties: 0, hire: 0, crew: 0, lost: 0, supplied: 0, sold: {}, bought: {}, notes: [], why: '' };
    },

    _backfill(line) {
        if (!Array.isArray(line.stops)) line.stops = [];
        for (const s of line.stops) if (!Array.isArray(s.rules)) s.rules = [];
        if (!_obj(line.cargo)) line.cargo = {};
        if (!_obj(line.lots)) line.lots = {};
        if (!_obj(line.basis)) line.basis = {};
        if (!Array.isArray(line.history)) line.history = [];
        if (!_obj(line.run)) line.run = TradeLines._newRun(1, 0);
        if (!Array.isArray(line.run.notes)) line.run.notes = [];
        if (!_obj(line.run.sold)) line.run.sold = {};
        if (!_obj(line.run.bought)) line.run.bought = {};
        line.totals = { runs: 0, revenue: 0, spent: 0, wages: 0, tolls: 0, duties: 0, hire: 0, crew: 0, lost: 0, supplied: 0, net: 0, losses: 0, ...(_obj(line.totals) || {}) };
        if (!line.status) line.status = 'running';
        if (!line.phase) line.phase = 'port';
        return line;
    },

    _log(player, world, text) {
        const tl = TradeLines.state(player);
        tl.log.unshift({ day: _day(world), text });
        if (tl.log.length > TradeLines.config().logCap) tl.log.length = TradeLines.config().logCap;
    },

    _notice(out, icon, title, text, type = 'info') {
        if (out) out.notices.push({ icon, title, text, type });
    },

    // ──────────── PLACES & GOODS ────────────

    _tile(world, q, r) {
        return world && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
    },

    _dist(world, a, b) {
        return Hex.wrappingDistance(a.q, a.r, b.q, b.r, (world && world.width) || 0);
    },

    _good(id) {
        const G = PlayerEconomy.GOODS || {};
        return G[String(id).toUpperCase()] || Object.values(G).find(g => g && g.id === id) || null;
    },

    /** Goods a line of this kind can deal in: [{ id, name, icon }]. */
    goodsFor(kind) {
        const out = new Map();
        const add = (g) => { if (g && g.id && !out.has(g.id)) out.set(g.id, { id: g.id, name: g.name || _name(g.id), icon: g.icon || '📦' }); };
        if (kind === 'ship') for (const g of Ships._getTradeGoods()) add(g);
        for (const g of Object.values(PlayerEconomy.GOODS || {})) if (!g.noMarket) add(g);
        return [...out.values()];
    },

    goodName(id) {
        const g = TradeLines._good(id) || Ships._getTradeGoods().find(x => x.id === id);
        return (g && g.name) || _name(id);
    },

    _realm(tile) {
        if (!tile) return null;
        if (tile.settlement && tile.settlement.kingdom != null) return tile.settlement.kingdom;
        return tile.kingdom != null ? tile.kingdom : null;
    },

    _kingdom(world, id) {
        if (!world || id == null) return null;
        if (typeof world.getKingdom === 'function') return world.getKingdom(id) || null;
        return (world.kingdoms || []).find(k => k.id === id) || null;
    },

    _stopIndex(line, id) {
        return line.stops.findIndex(s => s.id === id);
    },

    _at(line) {
        const i = TradeLines._stopIndex(line, line.atId);
        return i >= 0 ? i : 0;
    },

    _nextIndex(line, from = null) {
        const i = from == null ? TradeLines._at(line) : from;
        return line.stops.length ? (i + 1) % line.stops.length : 0;
    },

    /** Every stop a settlement; a caravan's legs within reach; a ship's stops ports. → reason or null. */
    _stopsReason(world, kind, stops) {
        const cfg = TradeLines.config();
        if (stops.length < 2) return 'A line needs at least two stops.';
        if (stops.length > cfg.maxStops) return `A line has at most ${cfg.maxStops} stops.`;
        for (const s of stops) {
            const t = TradeLines._tile(world, s.q, s.r);
            if (!t || !t.settlement) return 'Every stop must be a town or village.';
            if (kind === 'ship' && !(Ships.isPortTile(world, s.q, s.r) && Ships.hasDock(world, s.q, s.r))) return `${t.settlement.name} has no harbour a ship can berth at.`;
        }
        for (let i = 0; i < stops.length; i++) {
            const a = stops[i];
            const b = stops[(i + 1) % stops.length];
            const d = TradeLines._dist(world, a, b);
            if (d < 1) return 'Two stops in a row are the same place.';
            if (kind === 'caravan' && d > cfg.caravan.maxLegDist) return `A caravan leg may be at most ${cfg.caravan.maxLegDist} hexes.`;
        }
        return null;
    },

    _rule(r) {
        const o = _obj(r) || {};
        const op = OPS.includes(o.op) ? o.op : null;
        if (!op || !o.good) return null;
        const rule = { op, good: String(o.good) };
        if (op === 'buy') { rule.qty = _int(o.qty, 20); rule.price = Math.max(0, _num(Number(o.price), 0)); }
        if (op === 'sell') { rule.price = Math.max(0, _num(Number(o.price), 0)); rule.keep = _int(o.keep, 0); }
        if (op === 'supply') rule.qty = _int(o.qty, 0); // 0: all aboard
        if (op === 'load') rule.qty = _int(o.qty, 0); // 0: as much as fits
        return rule;
    },

    _stop(line, world, s) {
        const t = TradeLines._tile(world, s.q, s.r);
        const tl = { id: `s${line.nextStop = _int(line.nextStop, 0) + 1}`, q: s.q, r: s.r, name: (t && t.settlement && t.settlement.name) || s.name || `${s.q},${s.r}`, rules: [] };
        for (const r of (s.rules || []).slice(0, TradeLines.config().maxRules)) { const x = TradeLines._rule(r); if (x) tl.rules.push(x); }
        return tl;
    },

    // ──────────── THE PLAYER'S ORDERS ────────────

    /**
     * Set up a line: spec = { kind: 'caravan'|'ship', shipId?, name?, stops: [{ q, r, rules: [...] }], reserve? }.
     * A caravan hires its wagons at the first stop when it first sets out; a
     * ship sails to the first stop if she is not there.
     */
    create(player, world, spec = {}) {
        if (!player || !world) return { success: false, reason: 'No world.' };
        const cfg = TradeLines.config();
        const tl = TradeLines.state(player);
        if (tl.lines.length >= cfg.maxLines) return { success: false, reason: `You can run at most ${cfg.maxLines} lines.` };
        const kind = spec.kind === 'ship' ? 'ship' : 'caravan';
        const raw = (spec.stops || []).filter(s => s && Number.isFinite(s.q) && Number.isFinite(s.r));
        const why = TradeLines._stopsReason(world, kind, raw);
        if (why) return { success: false, reason: why };
        let ship = null;
        if (kind === 'ship') {
            ship = Ships.getShipById(player, spec.shipId);
            if (!ship) return { success: false, reason: 'Name one of your ships for the line.' };
            if (ship.status === 'building') return { success: false, reason: `${ship.name} is still on the slipway.` };
            if (tl.lines.some(l => l.kind === 'ship' && l.shipId === ship.id)) return { success: false, reason: `${ship.name} already runs a line.` };
        }
        const id = `TL${tl.nextId++}`;
        const line = {
            id, kind, shipId: ship ? ship.id : null,
            name: String(spec.name || '').trim().slice(0, 40) || null,
            status: 'running', stallReason: null, phase: 'port',
            stops: [], atId: null, nextId: null, unitId: null, nextStop: 0,
            capacity: kind === 'caravan' ? _int(spec.capacity, cfg.caravan.capacity) || cfg.caravan.capacity : null,
            reserve: _int(spec.reserve, 0),
            wagon: false, unpaid: 0, lossStreak: 0, onceMore: false, disband: false,
            cargo: {}, lots: {}, basis: {}, pos: null,
            run: TradeLines._newRun(1, _day(world)), history: [], totals: null,
            createdDay: _day(world),
        };
        for (const s of raw) line.stops.push(TradeLines._stop(line, world, s));
        if (!line.name) line.name = `${line.stops[0].name}–${line.stops[1].name}${line.stops.length > 2 ? ' loop' : ''}`;
        line.atId = line.stops[0].id;
        TradeLines._backfill(line);
        if (ship) {
            ship.tradeLine = id;
            const home = line.stops[0];
            if (!(ship.status === 'docked' && ship.q === home.q && ship.r === home.r)) {
                // She sails to the first stop before the round begins
                line.phase = 'road';
                line.nextId = home.id;
                line.atId = line.stops[line.stops.length - 1].id;
                const res = Ships.moveShip(player, ship.id, home.q, home.r, home.name, world);
                if (!res.success) { line.phase = 'hold'; line.stallReason = res.message; line.nextId = null; line.atId = home.id; }
                else { line.cargoOut = { ...(ship.cargo || {}) }; line.run.legs = -1; } // (the passage out is no round of the line)
            }
        }
        tl.lines.push(line);
        const text = `${line.name}: a ${kind === 'ship' ? `line for ${ship.name}` : 'caravan line'} of ${line.stops.length} stops (${line.stops.map(s => s.name).join(' → ')} → back).`;
        TradeLines._log(player, world, text);
        return { success: true, line, text };
    },

    _find(player, lineId) {
        const line = TradeLines.line(player, lineId);
        return line ? TradeLines._backfill(line) : null;
    },

    rename(player, lineId, name) {
        const line = TradeLines._find(player, lineId);
        if (!line) return { success: false, reason: 'No such line.' };
        const n = String(name || '').trim().slice(0, 40);
        if (!n) return { success: false, reason: 'A line needs a name.' };
        line.name = n;
        return { success: true, text: `The line is now called ${n}.` };
    },

    pause(player, world, lineId) {
        const line = TradeLines._find(player, lineId);
        if (!line) return { success: false, reason: 'No such line.' };
        if (line.status === 'lost') return { success: false, reason: 'That line is lost.' };
        line.status = 'paused';
        line.stallReason = 'Paused by your order.';
        return { success: true, text: line.phase === 'road' ? `${line.name} will stop at ${TradeLines._destName(line)} and wait.` : `${line.name} waits where it is.` };
    },

    resume(player, world, lineId) {
        const line = TradeLines._find(player, lineId);
        if (!line) return { success: false, reason: 'No such line.' };
        if (line.status === 'lost') return { success: false, reason: 'That line is lost.' };
        line.status = 'running';
        line.lossStreak = 0;
        line.unpaid = 0;
        line.onceMore = true; // the player's word: one round even while away
        if (line.phase !== 'road') line.stallReason = null;
        return { success: true, text: `${line.name} takes the road again.` };
    },

    /** One more round while you are away and no one runs the lines. */
    sendAgain(player, world, lineId) {
        const line = TradeLines._find(player, lineId);
        if (!line) return { success: false, reason: 'No such line.' };
        if (line.status !== 'running') return TradeLines.resume(player, world, lineId);
        line.onceMore = true;
        return { success: true, text: `${line.name} goes round once more.` };
    },

    setReserve(player, lineId, gold) {
        const line = TradeLines._find(player, lineId);
        if (!line) return { success: false, reason: 'No such line.' };
        line.reserve = _int(gold, 0);
        return { success: true, text: `${line.name} will leave at least ${line.reserve}g in your purse.` };
    },

    addStop(player, world, lineId, q, r, at = null) {
        const line = TradeLines._find(player, lineId);
        if (!line) return { success: false, reason: 'No such line.' };
        const raw = line.stops.map(s => ({ q: s.q, r: s.r }));
        const idx = at == null ? raw.length : _clamp(_int(at), 0, raw.length);
        raw.splice(idx, 0, { q, r });
        const why = TradeLines._stopsReason(world, line.kind, raw);
        if (why) return { success: false, reason: why };
        const stop = TradeLines._stop(line, world, { q, r });
        line.stops.splice(idx, 0, stop);
        return { success: true, stop, text: `${stop.name} added to ${line.name}.` };
    },

    removeStop(player, world, lineId, stopId) {
        const line = TradeLines._find(player, lineId);
        if (!line) return { success: false, reason: 'No such line.' };
        const i = TradeLines._stopIndex(line, stopId);
        if (i < 0) return { success: false, reason: 'No such stop.' };
        if (stopId === line.atId || (line.phase === 'road' && stopId === line.nextId)) {
            return { success: false, reason: line.phase === 'road' && stopId === line.nextId ? 'The line is bound there now.' : 'The line stands there now.' };
        }
        const raw = line.stops.filter(s => s.id !== stopId).map(s => ({ q: s.q, r: s.r }));
        const why = TradeLines._stopsReason(world, line.kind, raw);
        if (why) return { success: false, reason: why };
        const [gone] = line.stops.splice(i, 1);
        return { success: true, text: `${gone.name} struck from ${line.name}.` };
    },

    addRule(player, lineId, stopId, rule) {
        const line = TradeLines._find(player, lineId);
        const stop = line && line.stops.find(s => s.id === stopId);
        if (!stop) return { success: false, reason: 'No such stop.' };
        const r = TradeLines._rule(rule);
        if (!r) return { success: false, reason: 'A rule needs an order and a good.' };
        if (stop.rules.length >= TradeLines.config().maxRules) return { success: false, reason: 'That stop has as many orders as a factor can keep.' };
        stop.rules.push(r);
        return { success: true, rule: r, text: `${stop.name}: ${TradeLines.describeRule(r)}.` };
    },

    updateRule(player, lineId, stopId, index, rule) {
        const line = TradeLines._find(player, lineId);
        const stop = line && line.stops.find(s => s.id === stopId);
        if (!stop || !stop.rules[index]) return { success: false, reason: 'No such order.' };
        const r = TradeLines._rule({ ...stop.rules[index], ...(rule || {}) });
        if (!r) return { success: false, reason: 'A rule needs an order and a good.' };
        stop.rules[index] = r;
        return { success: true, rule: r, text: `${stop.name}: ${TradeLines.describeRule(r)}.` };
    },

    removeRule(player, lineId, stopId, index) {
        const line = TradeLines._find(player, lineId);
        const stop = line && line.stops.find(s => s.id === stopId);
        if (!stop || !stop.rules[index]) return { success: false, reason: 'No such order.' };
        stop.rules.splice(index, 1);
        return { success: true, text: `Order struck at ${stop.name}.` };
    },

    describeRule(r) {
        const g = TradeLines.goodName(r.good).toLowerCase();
        if (r.op === 'buy') return `buy ${g} up to ${r.qty} aboard at ${r.price}g or less`;
        if (r.op === 'sell') return `sell ${g} at ${r.price}g or more${r.keep ? `, keeping ${r.keep}` : ''}`;
        if (r.op === 'supply') return `supply ${r.qty ? r.qty : 'all the'} ${g} to your property here`;
        return `load ${r.qty ? `up to ${r.qty} ` : ''}${g} from your property here`;
    },

    /**
     * Wind a line up. On the road it is wound up at the stop it reaches.
     * A caravan's goods go into your packs if you stand there, else they are
     * sold off at that stop (what no one buys is left with the town's
     * merchants: a loss); a ship keeps her hold.
     */
    remove(player, world, lineId) {
        const line = TradeLines._find(player, lineId);
        if (!line) return { success: false, reason: 'No such line.' };
        if (line.phase === 'road' && line.status !== 'lost') {
            line.disband = true;
            return { success: true, text: `${line.name} will be wound up when it reaches ${TradeLines._destName(line)}.` };
        }
        const text = TradeLines._disband(player, world, line, null);
        return { success: true, text };
    },

    _destName(line) {
        const s = line.stops.find(x => x.id === line.nextId);
        return s ? s.name : 'its next stop';
    },

    // ──────────── THE FACTOR (a steward) ────────────

    /** The Master of the Lines (systems/stewards.js seat 'trade'), or null. */
    factor(player) {
        const office = Stewards.office(player, { kind: 'trade', id: 'trade' });
        if (!office || !Stewards.person(player, office)) return null;
        const cfg = TradeLines.config().steward;
        const ff = _obj(player.tradeLines && player.tradeLines.factorFx) || {};
        const haggle = _clamp(_num(ff.haggle) + (_num(office.stewardship, 5) - 5) * _num(cfg.skillHaggle), -0.04, _num(cfg.maxHaggle, 0.08));
        return { id: office.id, name: office.name, skill: _num(office.stewardship, 5), haggle: _r2(haggle * 1000) / 1000, skim: _clamp(_num(ff.skim), 0, 0.5) };
    },

    _skim(player, earned, factor) {
        if (!factor || !(factor.skim > 0) || !(earned > 0)) return 0;
        const tl = TradeLines.state(player);
        const p = Math.floor(earned * factor.skim);
        if (p > 0) {
            if (!_obj(tl.factorFx)) tl.factorFx = { pocket: 0 };
            tl.factorFx.pocket = _r2(_num(tl.factorFx.pocket) + p);
        }
        return p;
    },

    /** Is the line free to set out from home (a factor, you near, or your word)? */
    _mayGo(player, world, line) {
        if (line.status !== 'running') return false;
        if (line.onceMore || TradeLines.factor(player)) return true;
        if (!Number.isFinite(player.q)) return false;
        const range = TradeLines.config().awayRange;
        return line.stops.some(s => TradeLines._dist(world, s, player) <= range);
    },

    // ──────────── THE DAY ────────────

    /**
     * Daily: every line moves, trades at the stop it reaches, and sets out
     * for the next. → { notices: [{ icon, title, text, type }] }.
     */
    processDay(world, player) {
        const out = { notices: [] };
        if (!world || !player || !TradeLines.hasLines(player)) return out;
        const tl = TradeLines.state(player);
        const day = _day(world);
        if (day - _num(tl.week.start) >= 7) { tl.week.last = tl.week.revenue; tl.week.revenue = 0; tl.week.start = day; }
        if (!Array.isArray(world.units)) world.units = [];
        for (const line of tl.lines.slice()) {
            if (line.status === 'lost') continue;
            if (line.kind === 'ship') TradeLines._shipDay(player, world, line, out);
            else TradeLines._caravanDay(player, world, line, out);
        }
        tl.lines = tl.lines.filter(l => !l.gone);
        return out;
    },

    _caravanDay(player, world, line, out) {
        if (line.phase === 'road') {
            const u = world.units.find(x => x && x.id === line.unitId);
            if (!u || u.destroyed) { TradeLines._lostOnRoad(player, world, line, out, u); return; }
            line.pos = { q: u.q, r: u.r };
            TradeLines._payWages(player, world, line);
            TradeLines._gateTolls(player, world, line, u);
            if (!u.arrived) return;
            // (a wagon left to wander while no one ran the lines — an interregnum —
            // is set on its road again)
            const dest = line.stops.find(s => s.id === line.nextId);
            if (dest && (u.q !== dest.q || u.r !== dest.r)) {
                u.targetQ = dest.q; u.targetR = dest.r; u.path = []; u.arrived = false;
                line.legPath = TradeLines._path(world, u.q, u.r, dest.q, dest.r);
                return;
            }
            u.destroyed = true;
            line.unitId = null;
            TradeLines._arrive(player, world, line, out);
        }
        TradeLines._atStop(player, world, line, out);
    },

    _shipDay(player, world, line, out) {
        const ship = Ships.getShipById(player, line.shipId);
        if (!ship) {
            line.status = 'lost';
            line.stallReason = 'The ship is gone: sold, sunk or taken.';
            TradeLines._closeRun(player, world, line, out, 'ship lost');
            TradeLines._notice(out, '🌊', 'A Trade Line Ends', `${line.name}: the ship is gone, and the line with her.`, 'error');
            return;
        }
        ship.tradeLine = line.id;
        if (line.phase === 'road') {
            const dest = line.stops.find(s => s.id === line.nextId);
            line.pos = { q: ship.q, r: ship.r };
            if (ship.status === 'moving') {
                line.run.crew += Ships.getDailyWages(ship) + _num((Ships.getShipType(ship.typeId) || {}).dailyUpkeep);
                return;
            }
            if (!dest) { line.phase = 'port'; } else if (ship.status === 'docked' && ship.q === dest.q && ship.r === dest.r) {
                // Storms wash cargo over the side (systems/ships.js): the ledger counts it
                const lostGoods = {};
                for (const [g, n] of Object.entries(line.cargoOut || {})) {
                    const d = n - _num((ship.cargo || {})[g]);
                    if (d > 0) lostGoods[g] = d;
                }
                line.cargoOut = null;
                const v = TradeLines._takeBasis(line, lostGoods);
                if (v > 0) {
                    line.run.lost += v;
                    line.run.notes.push(`Lost at sea: ${Object.entries(lostGoods).map(([g, n]) => `${n} ${TradeLines.goodName(g).toLowerCase()}`).join(', ')}.`);
                }
                TradeLines._arrive(player, world, line, out);
            } else if (ship.status === 'docked') {
                // Put in somewhere else (or never left): set her course again
                const res = Ships.moveShip(player, ship.id, dest.q, dest.r, dest.name, world);
                line.stallReason = res.success ? null : res.message;
                return;
            } else {
                line.stallReason = `${ship.name} is not under the line's orders (${ship.status}).`;
                return;
            }
        }
        TradeLines._atStop(player, world, line, out);
    },

    /** At a stop (or holding there): trade, close a round at home, set out again. */
    _atStop(player, world, line, out) {
        if (line.phase === 'hold') {
            const atHome = TradeLines._at(line) === 0;
            if (line.status !== 'running' || (atHome && !TradeLines._mayGo(player, world, line))) return;
            line.phase = 'port';
            line.stallReason = null;
        }
        if (line.phase !== 'port') return;
        TradeLines._visit(player, world, line, out);
        if (line.gone) return;
        if (line.disband) { TradeLines._disband(player, world, line, out); return; }
        const atHome = TradeLines._at(line) === 0;
        if (line.status !== 'running') {
            line.phase = 'hold';
            if (!line.stallReason) line.stallReason = 'Paused by your order.';
            return;
        }
        if (atHome && !TradeLines._mayGo(player, world, line)) {
            line.phase = 'hold';
            const why = `Waiting at ${line.stops[0].name} for your word: you are far from its stops. Name a Master of the Lines (Stewards) to run it while you are away.`;
            if (line.stallReason !== why) TradeLines._notice(out, '⏸️', 'A Line Waits', `${line.name}: ${why}`, 'info');
            line.stallReason = why;
            return;
        }
        TradeLines._depart(player, world, line, out);
    },

    _arrive(player, world, line, out) {
        const from = line.stops.find(s => s.id === line.atId) || null;
        const to = line.stops.find(s => s.id === line.nextId) || line.stops[0];
        line.atId = to.id;
        line.nextId = null;
        line.phase = 'port';
        line.pos = { q: to.q, r: to.r };
        line.run.legs++;
        // Tolls at the border (or a foreign harbour's dues): the realm entered takes its share of the cargo's worth
        const ra = from ? TradeLines._realm(TradeLines._tile(world, from.q, from.r)) : null;
        const rb = TradeLines._realm(TradeLines._tile(world, to.q, to.r));
        const cargo = TradeLines._cargo(player, line);
        if (rb != null && String(ra) !== String(rb) && Object.keys(cargo).length) {
            const k = TradeLines._kingdom(world, rb);
            if (k && k.isAlive !== false) {
                const T = TradeLines.config().tolls;
                let value = 0;
                let main = null, mainV = -1;
                for (const [g, n] of Object.entries(cargo)) {
                    const v = (PlayerInventory.goodValue(g) || 5) * n;
                    value += v;
                    if (v > mainV) { mainV = v; main = g; }
                }
                const rate = TradePolicy.tollRate(world, rb, ra, main, _num(T.rate, 0.03));
                const due = rate > 0 ? Math.max(_num(T.min, 1), Math.round(value * rate)) : 0;
                const paid = Math.min(Math.max(0, Math.floor(_num(player.gold))), due);
                if (paid > 0) {
                    player.gold -= paid;
                    k.treasury = _num(k.treasury) + paid;
                    TradePolicy.noteToll(world, rb, paid);
                    Ledger.record(player, 'roadTolls', -paid);
                    line.run.tolls += paid;
                }
            }
        }
        // Unpaid drovers go no further
        if (line.kind === 'caravan' && line.unpaid >= TradeLines.config().unpaidDaysBeforeHalt) {
            line.status = 'paused';
            line.stallReason = `The drovers went ${line.unpaid} days unpaid and will go no further until you pay them (resume the line).`;
            TradeLines._notice(out, '✋', 'Drovers Unpaid', `${line.name}: ${line.stallReason}`, 'warning');
        }
    },

    _depart(player, world, line, out) {
        const atI = TradeLines._at(line);
        const here = line.stops[atI];
        const to = line.stops[TradeLines._nextIndex(line, atI)];
        if (atI === 0) line.onceMore = false;
        if (line.kind === 'ship') {
            const ship = Ships.getShipById(player, line.shipId);
            let why = null;
            if (!ship) why = 'The ship is gone.';
            else if (player.boardedShip === ship.id || ship.voyage) why = `You are aboard ${ship.name}: she sails at your command, not the line's.`;
            else if (ship.status !== 'docked') why = `${ship.name} is not in port.`;
            let res = null;
            if (!why) {
                res = Ships.moveShip(player, ship.id, to.q, to.r, to.name, world);
                if (!res.success) why = res.message;
            }
            if (why) {
                if (line.stallReason !== why) TradeLines._notice(out, '⚓', 'A Ship Waits', `${line.name}: ${why}`, 'warning');
                line.phase = 'hold';
                line.stallReason = why;
                return;
            }
            line.cargoOut = { ...(ship.cargo || {}) };
        } else {
            const cfg = TradeLines.config().caravan;
            if (!line.wagon) {
                const hire = _num(cfg.hire, 120);
                if (_num(player.gold) < hire) {
                    const why = `No coin to hire wagons (${hire}g) at ${here.name}.`;
                    if (line.stallReason !== why) TradeLines._notice(out, '🐫', 'A Line Waits', `${line.name}: ${why}`, 'warning');
                    line.phase = 'hold';
                    line.stallReason = why;
                    return;
                }
                player.gold -= hire;
                // The wagonwright and the ox-dealer of the town are paid
                const ht = TradeLines._tile(world, here.q, here.r);
                if (ht && ht.settlement) Economy.payTown(ht.settlement, hire);
                Ledger.record(player, 'tradeLineHire', -hire);
                line.run.hire += hire;
                line.wagon = true;
            }
            const u = new WorldUnit('caravan', here.q, here.r, to.q, to.r);
            u.playerOwned = true;
            u.tradeLine = line.id;
            u.name = `${line.name} wagons`;
            u.maxAge = 1e9;
            // What rides on the wagons is what a robber takes (world/units.js)
            u.inventory = { ...line.cargo };
            u.goods = { ...line.cargo };
            u.speed = (u.speed || 1) * (1 + _num(Technology.getEffectTotal(player, 'caravanSpeedBonus')));
            if (Infrastructure.hasRoadConnection(world, here.q, here.r, to.q, to.r)) { u.speed += 1; u.roadLinked = true; }
            world.units.push(u);
            line.unitId = u.id;
            // The road the wagons will take, for the toll gates on it (systems/publicWorks.js)
            line.legPath = TradeLines._path(world, here.q, here.r, to.q, to.r);
            line.legGates = [];
        }
        line.nextId = to.id;
        line.phase = 'road';
        line.stallReason = null;
        line.departDay = _day(world);
    },

    /** The hexes a caravan unit steps through from (q, r) to (tq, tr) (WorldUnit.moveTowardsTarget, replayed). */
    _path(world, q, r, tq, tr) {
        const ghost = Object.assign(Object.create(WorldUnit.prototype), { type: 'caravan', q, r, targetQ: tq, targetR: tr, age: 0 });
        const out = [[q, r]];
        for (let i = 0; i < 400 && (ghost.q !== tq || ghost.r !== tr); i++) {
            const pq = ghost.q, pr = ghost.r;
            ghost.moveTowardsTarget(world);
            if (ghost.q === pq && ghost.r === pr) break;
            out.push([ghost.q, ghost.r]);
        }
        return out;
    },

    /**
     * Toll gates (toll roads, bridges, canal locks: systems/publicWorks.js) on
     * the road the wagons have come along today: each work's rate on the
     * cargo's worth, once a leg, from your purse to the work's owner. Your
     * own gates let your wagons through free.
     */
    _gateTolls(player, world, line, u) {
        const path = Array.isArray(line.legPath) ? line.legPath : [];
        let idx = -1;
        for (let i = path.length - 1; i >= 0; i--) if (path[i][0] === u.q && path[i][1] === u.r) { idx = i; break; }
        const hexes = idx >= 0 ? path.slice(0, idx + 1) : [[u.q, u.r]];
        if (!Array.isArray(line.legGates)) line.legGates = [];
        let value = -1;
        for (const [q, r] of hexes) {
            const t = TradeLines._tile(world, q, r);
            const id = t && t.tollGate;
            if (!id || line.legGates.includes(id)) continue;
            line.legGates.push(id);
            const w = PublicWorks.works(world).find(x => x.id === id);
            if (!w || !(w.tollRate > 0) || w.owner === 'player') continue;
            if (value < 0) {
                value = 0;
                for (const [g, n] of Object.entries(line.cargo)) value += (PlayerInventory.goodValue(g) || 5) * n;
            }
            const due = Math.min(Math.max(0, Math.floor(_num(player.gold))), Math.round(value * w.tollRate));
            if (!(due > 0)) continue;
            player.gold -= due;
            Ledger.record(player, 'roadTolls', -due);
            PublicWorks._payToll(world, null, w, due);
            line.run.tolls += due;
        }
    },

    _payWages(player, world, line) {
        const wage = _num(TradeLines.config().caravan.wagePerDay, 3);
        if (!(wage > 0)) return;
        const paid = Math.min(wage, Math.max(0, Math.floor(_num(player.gold))));
        if (paid > 0) {
            player.gold -= paid;
            // The drovers are folk of the line's home town: their pay goes home
            const home = line.stops[0];
            const ht = home && TradeLines._tile(world, home.q, home.r);
            if (ht && ht.settlement) Economy.payTown(ht.settlement, paid);
            Ledger.record(player, 'tradeLineWages', -paid);
            line.run.wages += paid;
        }
        line.unpaid = paid < wage ? _num(line.unpaid) + 1 : 0;
    },

    _lostOnRoad(player, world, line, out, unit) {
        const cargo = { ...line.cargo };
        const from = line.stops.find(s => s.id === line.atId);
        const to = line.stops.find(s => s.id === line.nextId);
        const place = `${from ? from.name : '?'} → ${to ? to.name : '?'}`;
        const at = line.pos || (from ? { q: from.q, r: from.r } : {});
        if (unit && !unit.destroyed) unit.destroyed = true;
        const worth = TradeLines._takeBasis(line, cargo);
        const lostAny = Object.keys(cargo).length > 0;
        if (lostAny) {
            LossBook.report(player, world, { kind: 'caravan', cause: 'robbed on the road', value: LossBook.saleValue(cargo), ref: `line:${line.id}:${line.run.n}`, place, q: at.q, r: at.r });
        }
        line.cargo = {};
        line.lots = {};
        line.unitId = null;
        line.wagon = false;
        line.nextId = null;
        line.atId = line.stops[0].id; // the survivors make their way home
        line.phase = 'hold';
        line.run.lost += worth;
        line.run.notes.push(`Robbed on the road ${place}${lostAny ? `: lost ${Object.entries(cargo).map(([g, n]) => `${n} ${TradeLines.goodName(g).toLowerCase()}`).join(', ')}` : ''}; the wagons are gone.`);
        line.totals.losses++;
        line.lossStreak = _num(line.lossStreak) + 1;
        const tl = TradeLines.state(player);
        tl.stats.robbed++;
        tl.stats.lost += worth;
        TradeLines._closeRun(player, world, line, null, 'robbed');
        let text = `${line.name}: the wagons were taken on the road ${place}${lostAny ? ` with goods worth about ${Math.round(worth)}g` : ''}. New wagons must be hired.`;
        if (line.lossStreak >= TradeLines.config().lossesBeforeHalt) {
            line.status = 'paused';
            line.stallReason = `Robbed ${line.lossStreak} times running: the drovers will not take that road again until you say so.`;
            text += ` ${line.stallReason}`;
        }
        TradeLines._notice(out, '🗡️', 'Caravan Robbed', text, 'error');
        TradeLines._log(player, world, text);
    },

    // ──────────── THE HOLD ────────────

    _ship(player, line) {
        return line.kind === 'ship' ? Ships.getShipById(player, line.shipId) : null;
    },

    _cargo(player, line) {
        if (line.kind !== 'ship') return line.cargo;
        const ship = TradeLines._ship(player, line);
        if (!ship) return {};
        if (!_obj(ship.cargo)) ship.cargo = {};
        return ship.cargo;
    },

    _lots(player, line) {
        if (line.kind !== 'ship') return line.lots;
        const ship = TradeLines._ship(player, line);
        if (!ship) return {};
        if (!_obj(ship.lots)) ship.lots = {};
        return ship.lots;
    },

    _free(player, line) {
        if (line.kind === 'ship') {
            const ship = TradeLines._ship(player, line);
            return ship ? Ships.getCargoFree(ship) : 0;
        }
        let used = 0;
        for (const n of Object.values(line.cargo)) used += _num(n);
        return Math.max(0, _num(line.capacity, TradeLines.config().caravan.capacity) - used);
    },

    _addCargo(player, line, g, n) {
        const c = TradeLines._cargo(player, line);
        c[g] = _num(c[g]) + n;
    },

    _takeCargo(player, line, g, n) {
        const c = TradeLines._cargo(player, line);
        c[g] = _num(c[g]) - n;
        if (!(c[g] > 0)) delete c[g];
    },

    /** The average cost of what the line carries (for the ledger's losses and margins). */
    _addBasis(line, g, n, cost) {
        const b = line.basis[g] || (line.basis[g] = { qty: 0, cost: 0 });
        b.qty += n;
        b.cost = _r2(b.cost + cost);
    },

    /** Take `goods` off the basis → their cost. Goods carried without a recorded cost are worth their base value. */
    _takeBasis(line, goods) {
        let v = 0;
        for (const [g, n] of Object.entries(goods || {})) {
            if (!(n > 0)) continue;
            const b = line.basis[g];
            if (b && b.qty > 0) {
                const k = Math.min(n, b.qty);
                const c = b.cost * k / b.qty;
                v += c;
                b.cost = _r2(b.cost - c);
                b.qty -= k;
                if (!(b.qty > 0)) delete line.basis[g];
                if (n > k) v += (PlayerInventory.goodValue(g) || 5) * (n - k);
            } else {
                v += (PlayerInventory.goodValue(g) || 5) * n;
            }
        }
        return _r2(v);
    },

    // ──────────── TRADING AT A STOP ────────────

    /** The day at a stop: sell and supply, close the round at home, then load and buy. */
    _visit(player, world, line, out) {
        const atI = TradeLines._at(line);
        const stop = line.stops[atI];
        const tile = TradeLines._tile(world, stop.q, stop.r);
        const s = tile && tile.settlement;
        if (!s) {
            line.run.notes.push(`${stop.name} is no more: nothing traded there.`);
            return;
        }
        const factor = TradeLines.factor(player);
        const ctx = { player, world, line, stop, tile, s, factor, haggle: factor ? factor.haggle : 0, notes: [] };
        const order = (op) => stop.rules.filter(r => r.op === op);
        for (const r of order('sell')) TradeLines._sell(ctx, r);
        for (const r of order('supply')) TradeLines._supply(ctx, r);
        if (atI === 0 && line.run.legs > 0) {
            for (const n of ctx.notes) line.run.notes.push(n);
            ctx.notes = [];
            TradeLines._closeRun(player, world, line, out, '');
            line.lossStreak = 0;
        }
        const nextS = line.stops[TradeLines._nextIndex(line, atI)];
        const nt = nextS ? TradeLines._tile(world, nextS.q, nextS.r) : null;
        ctx.next = nt && nt.settlement;
        for (const r of order('load')) TradeLines._load(ctx, r);
        for (const r of order('buy')) TradeLines._buy(ctx, r);
        for (const n of ctx.notes) line.run.notes.push(n);
        if (line.run.notes.length > 24) line.run.notes.splice(0, line.run.notes.length - 24);
    },

    _note(ctx, text) {
        ctx.notes.push(`${ctx.stop.name}: ${text}`);
    },

    _isPort(ctx) {
        return ctx.line.kind === 'ship';
    },

    _sell(ctx, rule) {
        const { player, world, line, s } = ctx;
        const g = rule.good;
        const cargo = TradeLines._cargo(player, line);
        const have = _num(cargo[g]);
        let avail = Math.floor(have - _num(rule.keep));
        if (avail <= 0) return;
        const gname = TradeLines.goodName(g).toLowerCase();
        const lots = TradeLines._lots(player, line);
        let policy = TradePolicy.consignCheck(player, world, lots, have, s, g, avail);
        if (!policy.ok) {
            avail = Math.floor(have - _num(policy.embargoed) - _num(rule.keep));
            if (avail <= 0) { TradeLines._note(ctx, `kept the ${gname}: ${policy.reason}`); return; }
            policy = TradePolicy.consignCheck(player, world, lots, have, s, g, avail);
            if (!policy.ok) { TradeLines._note(ctx, `kept the ${gname}: ${policy.reason}`); return; }
        }
        const purse = Economy.townPurse(s);
        let total, outlay;
        if (TradeLines._isPort(ctx)) {
            const closed = Ships._closedPortMessage(world, ctx.stop.q, ctx.stop.r);
            if (closed) { TradeLines._note(ctx, closed); return; }
            const entry = Ships.getPortMarket(world, ctx.stop.q, ctx.stop.r).find(e => e.id === g);
            if (!entry) { TradeLines._note(ctx, `nobody buys ${gname}.`); return; }
            total = (k) => (k <= 0 ? 0 : Math.max(0, Math.floor(k * Ships.portSaleUnitPrice(player, world, ctx.stop.q, ctx.stop.r, entry, k) * policy.mult * (1 + ctx.haggle))));
            outlay = (k) => { const e = total(k); return e + (policy.rate > 0 ? Math.round(e * policy.rate / Math.max(0.1, 1 - policy.rate)) : 0); };
        } else {
            const good = TradeLines._good(g);
            if (!good) { TradeLines._note(ctx, `no market knows ${gname}.`); return; }
            if (good.noMarket) { TradeLines._note(ctx, `no stall buys ${gname}.`); return; }
            const mono = Trading.monopolyBlock(s, g, player);
            if (mono) { TradeLines._note(ctx, mono); return; }
            const k = TradeLines._kingdom(world, s.kingdom);
            if (k && Underworld.contrabandStatus(k, g) === 'illegal') { TradeLines._note(ctx, `${gname} is contraband in ${Names.realm(k.name)}: kept aboard.`); return; }
            total = (n) => (n <= 0 ? 0 : Math.floor(Trading.saleUnitPrice(player, good, s, world, policy.mult, n) * n * (1 + ctx.haggle)));
            outlay = (n) => Trading.saleOutlay(player, s, g, total(n), policy);
        }
        const first = total(1);
        if (first < rule.price) { TradeLines._note(ctx, `kept ${avail} ${gname}: it fetched ${first}g, the line sells at ${rule.price}g or more.`); return; }
        let n = _maxTrue(avail, (k) => total(k) - total(k - 1) >= rule.price);
        const short = n;
        if (purse != null) n = Math.min(n, _maxTrue(n, (k) => outlay(k) <= purse));
        if (!TradeLines._isPort(ctx)) {
            while (n > 0 && Guilds.saleCheck(player, s, g, n)) n = Math.floor(n / 2);
        }
        if (n <= 0) { TradeLines._note(ctx, purse != null && short > 0 ? `the merchants had no coin for the ${gname}.` : `could not sell the ${gname}.`); return; }
        const earned = total(n);
        const duty = TradePolicy.consignSale(player, world, lots, s, g, n, earned, policy).duty;
        const toll = TradeLines._isPort(ctx) ? 0 : Trading._guildToll(player, s, g, earned);
        Economy.drawTown(s, earned + duty + toll);
        TradeLines._takeCargo(player, line, g, n);
        if (!TradeLines._isPort(ctx)) {
            Reckoning.noteTrade(player, s, g, n, 'sell', earned);
            SettlementMarket.add(s, g, n);
            Guilds.onSale(player, s, g, n, earned, { tollPaid: true }); // (drawn with the price above)
            if (Seasons.priceGroup(g) === 'food') {
                if (!s.economy) Economy.initSettlement(s);
                s.economy.food = _num(s.economy.food) + n;
            }
        } else if (s.market) {
            SettlementMarket.add(s, g, n);
        }
        const pocket = TradeLines._skim(player, earned, ctx.factor);
        player.gold = _num(player.gold) + earned - pocket;
        PriceKnowledge.recordSale(player, s, g, n, earned - pocket, 'tradeLines');
        TradeLines._takeBasis(line, { [g]: n });
        const run = line.run;
        run.revenue += earned - pocket;
        run.duties += duty;
        run.sold[g] = _num(run.sold[g]) + n;
        const tl = TradeLines.state(player);
        tl.week.revenue = _num(tl.week.revenue) + earned;
        if (n < avail) TradeLines._note(ctx, `sold ${n} ${gname} for ${earned}g; kept ${avail - n} (${n < short ? 'the merchants ran out of coin' : `the price fell under ${rule.price}g`}).`);
    },

    _buy(ctx, rule) {
        const { player, world, line, s, tile } = ctx;
        const g = rule.good;
        const gname = TradeLines.goodName(g).toLowerCase();
        const cargo = TradeLines._cargo(player, line);
        let want = Math.floor(_num(rule.qty) - _num(cargo[g]));
        if (want <= 0) return;
        const free = TradeLines._free(player, line);
        if (free <= 0) { TradeLines._note(ctx, `no room aboard for ${gname}.`); return; }
        want = Math.min(want, free);
        const budget = Math.max(0, Math.floor(_num(player.gold) - _num(line.reserve)));
        const banned = TradePolicy.exportBlock(player, world, s, TradeLines._isPort(ctx) ? null : ctx.next, g);
        if (banned) { TradeLines._note(ctx, banned); return; }
        if (TradeLines._isPort(ctx)) {
            const closed = Ships._closedPortMessage(world, ctx.stop.q, ctx.stop.r);
            if (closed) { TradeLines._note(ctx, closed); return; }
            const entry = Ships.getPortMarket(world, ctx.stop.q, ctx.stop.r).find(e => e.id === g);
            if (!entry || entry.buy === null) { TradeLines._note(ctx, `the port does not sell ${gname}.`); return; }
            const kept = s.market && SettlementMarket.tracks(g);
            const s0 = kept ? SettlementMarket.stock(s, g) : 0;
            const unit = (j) => Math.ceil((kept ? Math.max(entry.buy, Math.ceil(entry.buy * SettlementMarket.levelFactor(s, g, Math.max(0, s0 - j)))) : entry.buy) * (1 - ctx.haggle));
            let n = 0, cost = 0;
            while (n < want) {
                const c = unit(n);
                if (c > rule.price || cost + c > budget) break;
                cost += c;
                n++;
            }
            if (n <= 0) {
                TradeLines._note(ctx, unit(0) > rule.price ? `bought no ${gname}: it costs ${unit(0)}g, the line pays ${rule.price}g at most.` : `no coin in your purse for ${gname}.`);
                return;
            }
            player.gold -= cost;
            Economy.payTown(s, cost);
            TradeLines._addCargo(player, line, g, n);
            TradePolicy.book(TradeLines._lots(player, line), s, g, n);
            if (s.market) SettlementMarket.take(s, g, n);
            PriceKnowledge.recordBuy(player, s, g, n, cost, 'tradeLines');
            TradeLines._bought(ctx, g, n, cost, want);
            return;
        }
        const entry = Trading.getAvailableGoods(s, tile, world).find(e => e.id === g);
        if (!entry || !(entry.quantity > 0)) { TradeLines._note(ctx, `the market has no ${gname}.`); return; }
        const mono = Trading.monopolyBlock(s, g, player);
        if (mono) { TradeLines._note(ctx, mono); return; }
        want = Math.min(want, Math.floor(entry.quantity));
        const cost = (k) => (k <= 0 ? 0 : Math.ceil(Trading.buyCost(player, entry, k, s) * (1 - ctx.haggle)));
        const firstCost = cost(1);
        if (firstCost > rule.price) { TradeLines._note(ctx, `bought no ${gname}: it costs ${firstCost}g, the line pays ${rule.price}g at most.`); return; }
        let n = _maxTrue(want, (k) => cost(k) - cost(k - 1) <= rule.price);
        n = Math.min(n, _maxTrue(n, (k) => cost(k) <= budget));
        if (n <= 0) { TradeLines._note(ctx, `no coin in your purse for ${gname}.`); return; }
        const paid = cost(n);
        player.gold -= paid;
        // The crown's markup on a monopoly good is owed to the royal treasury (as Trading.buyGoods)
        const mono2 = s.monopolies && s.monopolies[g];
        let crownCut = 0;
        if (mono2 && mono2.holder === 'crown' && mono2.markup > 0) {
            crownCut = paid * mono2.markup / (1 + mono2.markup);
            mono2.revenue = _num(mono2.revenue) + crownCut;
        }
        Economy.payTown(s, paid - crownCut);
        Reckoning.noteTrade(player, s, g, n, 'buy', paid);
        SettlementMarket.take(s, g, n);
        Guilds.onBuy(player, s, g, n, paid);
        TradePolicy.book(TradeLines._lots(player, line), s, g, n);
        PriceKnowledge.recordBuy(player, s, g, n, paid, 'tradeLines');
        TradeLines._addCargo(player, line, g, n);
        TradeLines._bought(ctx, g, n, paid, want);
    },

    _bought(ctx, g, n, cost, want) {
        const run = ctx.line.run;
        run.spent += cost;
        run.bought[g] = _num(run.bought[g]) + n;
        TradeLines._addBasis(ctx.line, g, n, cost);
        if (n < want) TradeLines._note(ctx, `bought ${n} of ${want} ${TradeLines.goodName(g).toLowerCase()} for ${cost}g (the price rose past the line's limit, or the purse ran short).`);
    },

    /** Deliver to your property here (a workshop's inputs) or your holding's stores. */
    _supply(ctx, rule) {
        const { player, world, line, tile, s } = ctx;
        const g = rule.good;
        const gname = TradeLines.goodName(g).toLowerCase();
        const cargo = TradeLines._cargo(player, line);
        const have = Math.floor(_num(cargo[g]));
        if (have <= 0) return;
        const n = rule.qty > 0 ? Math.min(have, rule.qty) : have;
        const props = PlayerEconomy.getPropertiesAt(tile);
        const shop = props.find(p => {
            const recipe = p.activeRecipe && PlayerEconomy.RECIPES[p.activeRecipe];
            return PlayerEconomy.isRecipeBuilding(p.type) && recipe && recipe.input === g;
        });
        let where;
        if (shop) {
            shop.inputStorage = _num(shop.inputStorage) + n;
            where = shop.name || _name(shop.type);
        } else if (Holdings.isHolding(player, world, tile.q, tile.r)) {
            if (Seasons.priceGroup(g) === 'food') {
                if (!s.economy) Economy.initSettlement(s);
                s.economy.food = _num(s.economy.food) + n;
                where = `the granary of ${s.name}`;
            } else {
                SettlementMarket.ensure(s);
                SettlementMarket.add(s, g, n);
                where = `the stores of ${s.name}`;
            }
        } else {
            TradeLines._note(ctx, `nothing of yours here takes ${gname}.`);
            return;
        }
        TradeLines._takeCargo(player, line, g, n);
        TradePolicy.takeLots(TradeLines._lots(player, line), g, n, have);
        const v = TradeLines._takeBasis(line, { [g]: n });
        line.run.supplied += v;
        TradeLines._note(ctx, `delivered ${n} ${gname} to ${where}.`);
    },

    /** Take what your property here has made aboard. */
    _load(ctx, rule) {
        const { player, line, tile, s } = ctx;
        const g = rule.good;
        const cargo = TradeLines._cargo(player, line);
        let room = TradeLines._free(player, line);
        if (rule.qty > 0) room = Math.min(room, Math.floor(rule.qty - _num(cargo[g])));
        if (room <= 0) return;
        let n = 0;
        for (const p of PlayerEconomy.getPropertiesAt(tile)) {
            if (p.produces !== g || !(p.storage > 0)) continue;
            const k = Math.min(Math.floor(p.storage), room - n);
            if (k <= 0) continue;
            p.storage -= k;
            n += k;
        }
        if (n <= 0) return;
        TradeLines._addCargo(player, line, g, n);
        TradePolicy.book(TradeLines._lots(player, line), s || tile, g, n);
        TradeLines._addBasis(line, g, n, 0);
        TradeLines._note(ctx, `loaded ${n} ${TradeLines.goodName(g).toLowerCase()} from your property.`);
    },

    // ──────────── THE LEDGER ────────────

    _net(r) {
        return Math.round(r.revenue - r.spent - r.wages - r.tolls - r.hire - r.crew);
    },

    _closeRun(player, world, line, out, why = '') {
        const r = line.run;
        const day = _day(world);
        const touched = r.legs > 0 || r.revenue > 0 || r.spent > 0 || r.lost > 0 || r.hire > 0;
        if (touched) {
            r.endDay = day;
            r.why = why;
            r.net = TradeLines._net(r);
            r.revenue = Math.round(r.revenue);
            r.spent = Math.round(r.spent);
            r.lost = Math.round(r.lost);
            r.crew = Math.round(r.crew);
            r.supplied = Math.round(r.supplied);
            line.history.unshift(r);
            const cap = TradeLines.config().ledgerRuns;
            if (line.history.length > cap) line.history.length = cap;
            const T = line.totals;
            T.runs++;
            for (const k of ['revenue', 'spent', 'wages', 'tolls', 'duties', 'hire', 'crew', 'lost', 'supplied']) T[k] = Math.round(_num(T[k]) + _num(r[k]));
            T.net = Math.round(_num(T.net) + r.net);
            const tl = TradeLines.state(player);
            tl.stats.runs++;
            tl.stats.net = Math.round(tl.stats.net + r.net);
            tl.stats.revenue = Math.round(tl.stats.revenue + r.revenue);
            if (out && !why) {
                const days = Math.max(1, day - _num(r.startDay, day));
                const bits = [`sold ${r.revenue}g`, `bought ${r.spent}g`];
                if (r.wages) bits.push(`wages ${r.wages}g`);
                if (r.crew) bits.push(`crew ${r.crew}g`);
                if (r.tolls) bits.push(`tolls ${r.tolls}g`);
                if (r.hire) bits.push(`wagons ${r.hire}g`);
                if (r.lost) bits.push(`lost ${r.lost}g`);
                if (r.supplied) bits.push(`${r.supplied}g of goods delivered to your own`);
                TradeLines._notice(out, r.net >= 0 ? '📒' : '📉', 'A Trade Line Comes Home', `${line.name}, round ${r.n} in ${days} days: ${r.net >= 0 ? '+' : ''}${r.net}g (${bits.join(', ')}).`, r.net >= 0 ? 'success' : 'warning');
            }
        }
        line.run = TradeLines._newRun(touched ? r.n + 1 : r.n, day);
    },

    _disband(player, world, line, out) {
        const at = line.stops[TradeLines._at(line)];
        const tile = at && TradeLines._tile(world, at.q, at.r);
        const s = tile && tile.settlement;
        let text = `${line.name} is wound up at ${at ? at.name : 'its stop'}.`;
        if (line.kind === 'caravan') {
            if (line.unitId) {
                const u = (world.units || []).find(x => x && x.id === line.unitId);
                if (u) u.destroyed = true;
                line.unitId = null;
            }
            const here = Number.isFinite(player.q) && at && player.q === at.q && player.r === at.r;
            const moved = [];
            for (const [g, n] of Object.entries({ ...line.cargo })) {
                if (here && PlayerInventory.addItem(player, g, n).success) {
                    TradePolicy.givePlayerLots(player, g, TradePolicy.takeLots(line.lots, g, n, n));
                    delete line.cargo[g];
                    moved.push(`${n} ${TradeLines.goodName(g).toLowerCase()}`);
                }
            }
            if (moved.length) text += ` Into your packs: ${moved.join(', ')}.`;
            if (Object.keys(line.cargo).length && s) {
                const ctx = { player, world, line, stop: at, tile, s, factor: null, haggle: 0, notes: [] };
                const before = line.run.revenue;
                for (const g of Object.keys({ ...line.cargo })) TradeLines._sell(ctx, { op: 'sell', good: g, price: 0, keep: 0 });
                const got = Math.round(line.run.revenue - before);
                if (got > 0) text += ` The goods aboard sold for ${got}g.`;
                const left = Object.entries(line.cargo);
                if (left.length) {
                    for (const [g, n] of left) SettlementMarket.add(s, g, n);
                    line.run.lost += TradeLines._takeBasis(line, line.cargo);
                    text += ` Left unsold with the merchants of ${s.name}: ${left.map(([g, n]) => `${n} ${TradeLines.goodName(g).toLowerCase()}`).join(', ')}.`;
                    line.cargo = {};
                }
            }
        } else {
            const ship = TradeLines._ship(player, line);
            if (ship) { delete ship.tradeLine; text += ` ${ship.name} keeps her hold and waits on your orders.`; }
        }
        TradeLines._closeRun(player, world, line, null, 'wound up');
        line.gone = true;
        const tl = TradeLines.state(player);
        tl.lines = tl.lines.filter(l => l !== line);
        TradeLines._log(player, world, text);
        TradeLines._notice(out, '📕', 'A Trade Line Wound Up', text, 'info');
        return text;
    },

    /**
     * The House ends (a new life taken, an heirless death): every line is
     * wound up where it stands. Wagons on the road stop; what a caravan
     * carries goes into the estate, to be sold where it lies
     * (player/estateSettlement.js). A ship keeps her hold (she is the
     * estate's). → [{ goods, q, r }].
     */
    windUp(player, world) {
        const out = [];
        if (!TradeLines.hasLines(player)) return out;
        const tl = TradeLines.state(player);
        for (const line of tl.lines) {
            if (line.kind === 'caravan') {
                let at = line.stops.find(s => s.id === (line.phase === 'road' ? line.nextId : line.atId)) || line.stops[0];
                if (line.unitId) {
                    const u = (world && world.units || []).find(x => x && x.id === line.unitId);
                    if (u) u.destroyed = true;
                    line.unitId = null;
                }
                if (Object.keys(line.cargo).length && at) out.push({ goods: { ...line.cargo }, q: at.q, r: at.r });
                line.cargo = {};
                line.lots = {};
            } else {
                const ship = TradeLines._ship(player, line);
                if (ship) delete ship.tradeLine;
            }
            TradeLines._closeRun(player, world, line, null, 'the House ended');
        }
        tl.lines = [];
        tl.factorFx = null;
        TradeLines._log(player, world, 'The House ended: its trade lines were wound up.');
        return out;
    },

    // ──────────── READING ────────────

    /**
     * Towns a line could put in at next, nearest `from` first (a caravan's
     * within a leg's reach, a ship's only harbours): [{ q, r, name, dist }].
     */
    stopCandidates(player, world, kind, from = null, limit = 14) {
        if (!world) return [];
        const list = typeof world.getSettlementViews === 'function' ? world.getSettlementViews()
            : typeof world.getAllSettlements === 'function' ? world.getAllSettlements() : [];
        const at = from || (Number.isFinite(player && player.q) ? { q: player.q, r: player.r } : null);
        const reach = TradeLines.config().caravan.maxLegDist;
        const out = [];
        for (const s of list) {
            if (!s || !Number.isFinite(s.q)) continue;
            const t = TradeLines._tile(world, s.q, s.r);
            if (!t || !t.settlement || t.explored === false) continue;
            const dist = at ? TradeLines._dist(world, at, s) : 0;
            if (from && dist < 1) continue;
            if (kind === 'ship' ? !(Ships.isPortTile(world, s.q, s.r) && Ships.hasDock(world, s.q, s.r)) : (from && dist > reach)) continue;
            out.push({ q: s.q, r: s.r, name: t.settlement.name, dist });
        }
        out.sort((a, b) => a.dist - b.dist);
        return out.slice(0, limit);
    },

    /** What the line would pay / be paid at a stop for one unit of a good now: { buy, sell } (null where none). */
    quote(player, world, line, stop, goodId) {
        const tile = TradeLines._tile(world, stop.q, stop.r);
        const s = tile && tile.settlement;
        if (!s) return { buy: null, sell: null };
        if (line.kind === 'ship') {
            const e = Ships.getPortMarket(world, stop.q, stop.r).find(x => x.id === goodId);
            if (!e) return { buy: null, sell: null };
            return { buy: e.buy, sell: Math.floor(Ships.portSaleUnitPrice(player, world, stop.q, stop.r, e, 1)) };
        }
        const entry = Trading.getAvailableGoods(s, tile, world).find(e => e.id === goodId);
        const good = TradeLines._good(goodId);
        return {
            buy: entry && entry.quantity > 0 ? Math.ceil(Trading.buyCost(player, entry, 1, s)) : null,
            sell: good && !good.noMarket ? Math.floor(Trading.saleUnitPrice(player, good, s, world, 1, 1)) : null,
        };
    },

    /** Where a line is and what it is doing, in words. */
    whereabouts(player, line) {
        const at = line.stops.find(s => s.id === line.atId);
        const to = line.stops.find(s => s.id === line.nextId);
        if (line.status === 'lost') return line.stallReason || 'Lost.';
        if (line.phase === 'road') return `On the ${line.kind === 'ship' ? 'sea' : 'road'} to ${to ? to.name : '?'}`;
        if (line.phase === 'hold') return `At ${at ? at.name : '?'}: ${line.stallReason || 'waiting'}`;
        return `At ${at ? at.name : '?'}`;
    },

    view(player, world) {
        const tl = TradeLines.state(player);
        return {
            lines: tl.lines.map(l => {
                TradeLines._backfill(l);
                const cargo = TradeLines._cargo(player, l);
                const ship = TradeLines._ship(player, l);
                return {
                    id: l.id, name: l.name, kind: l.kind, status: l.status, phase: l.phase,
                    ship: ship ? ship.name : null, where: TradeLines.whereabouts(player, l),
                    stops: l.stops, cargo: { ...cargo }, free: TradeLines._free(player, l), reserve: l.reserve,
                    run: { ...l.run, net: TradeLines._net(l.run) }, history: l.history, totals: l.totals,
                    stallReason: l.stallReason, disband: !!l.disband,
                };
            }),
            factor: TradeLines.factor(player),
            stats: tl.stats,
            log: tl.log.slice(0, 12),
        };
    },
};
