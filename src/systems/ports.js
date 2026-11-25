// ============================================
// PORTS — the harbour as a place: harbourmaster, berths and dues, the
// shipyard's slip, careening and the dry dock, the fishing fleet, and the
// ferries' fares
// ============================================
//   Harbour   Every port town (a settlement on the sea or a lake) has a
//             harbourmaster — one of its own grown townsfolk (a merchant,
//             fisher, carter… the eldest master among them; a name from
//             data/ports.json `masters` for a town without a roster) — and
//             berths by its size. When one of your ships makes port (docked
//             at a port she wasn't at yesterday: processDay, after
//             Ships.processDaily) he takes harbour dues by her hold and crew
//             and the town's size, into the town's purse; with every berth
//             taken (the town's own ships, trading ships in, yours) she lies
//             in the roads and the lighters cost more (roadsMult). No dues in
//             a port of your own realm or holding. What you can't pay is owed
//             and taken the next day you have it.
//   Shipyard  A ship you commission (Ships.commissionShip: status 'building')
//             goes up on the slip stage by stage — keel, frames, planking,
//             deck, masts and rigging (yard.stages; stageOf). Each day
//             (yardDay, before Ships.processDaily) the shipwrights draw the
//             stage's timber, planks, pitch, rope and sailcloth out of the
//             town's market stock; when it has none to give, the day's work
//             waits (the build day is given back), at most yard.maxStall of
//             the build days. Towns build hulls of their own now and then
//             (townBuild, drawn only).
//   Careening Hull repair that takes days, the ship out of service (status
//             'careened': she cannot sail, trade or be sold): hauled down on
//             the beach anywhere with shipwrights, or in a dry dock (cities,
//             or beside a shipyard or harbour of yours) — quicker and dearer.
//             Cheaper than the yard's quick repair (Ships.repairShip).
//   Fishing   The port's boats (one per fisher on the roster) go out at dawn
//             and come back in the afternoon; a storm or the ice keeps them
//             in, and the market's fish falls by the days lost (fishCrew:
//             systems/marketDynamics.js reads it with the townsfolk's crew).
//   Ferries   (world/ferries.js) the fare at a river ferry when you step
//             across (ferryStep, from player/core/movement.js) and the strait
//             crossings between port towns (takeStrait).
//
// Randomness: none — names and the town's own builds by hashes, the
// weather is a pure function. State: settlement.harbourBook (saved with the tile);
// ship.portCall / ship.careen / ship.yardStall (saved with player.ships).
// Settings: data/ports.json.

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Utils } from '../core/utils.js';
import { Economy } from '../world/economy.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Shipcraft } from '../world/shipcraft.js';
import { Climate } from '../world/climate.js';
import { WEATHER_EFFECTS } from '../world/weather.js';
import { Rivers } from '../world/rivers.js';
import { Ferries } from '../world/ferries.js';
import { Ledger } from './ledger.js';
import { Townsfolk } from './townsfolk.js';
import { TownJobs } from './townJobs.js';
import { Technology } from './technology.js';
import { Infrastructure } from './infrastructure.js';
import { Ships } from './ships.js';

const WATER_IDS = new Set(['ocean', 'deep_ocean', 'coast', 'sea', 'lake']);
const SIZES = ['village', 'town', 'city', 'capital'];
// (the town's own ships moored at its pier: as world/innerMap/harbour.js lays them)
const TOWN_SHIPS = { village: 1, town: 2, city: 3, capital: 4 };
const AFLOAT = new Set(['moving', 'at_sea', 'anchored']);

const DEFAULTS = {
    harbour: {
        berths: { village: 2, town: 4, city: 7, capital: 10 },
        dues: { perCargo: 0.12, perCrew: 0.35, min: 2, max: 60, roadsMult: 1.5 },
        sizeMult: { village: 0.6, town: 1, city: 1.3, capital: 1.6 },
        traderBerths: 1,
        masterJobs: ['merchant', 'fisher', 'carter', 'labourer'],
    },
    yard: {
        stages: [
            { id: 'keel', name: 'Keel laid', share: 0.12, goods: { wood: 1.6 } },
            { id: 'frames', name: 'Frames raised', share: 0.28, goods: { wood: 2.2, iron: 0.2 } },
            { id: 'planked', name: 'Planked', share: 0.3, goods: { planks: 3, resin: 0.4 } },
            { id: 'decked', name: 'Decked and caulked', share: 0.16, goods: { planks: 1.2, resin: 0.5 } },
            { id: 'rigged', name: 'Masted and rigged', share: 0.14, goods: { rope: 1.2, linen: 1 } },
        ],
        maxStall: 0.5,
        townBuild: { every: 70, days: 50, minSize: 'town' },
    },
    careen: {
        beach: { name: 'Careened on the beach', rate: 6, costShare: 0.55 },
        dock: { name: 'In the dry dock', rate: 15, costShare: 0.8, towns: ['city', 'capital'] },
        goods: { planks: 0.4, resin: 0.3 },
        minDamage: 3,
    },
    fishing: { boatsBySize: { village: 2, town: 3, city: 4, capital: 5 }, maxBoats: 6, out: [5, 7], back: [14, 17], stayIn: ['storm', 'blizzard'], shoreFloor: 0.35 },
    masters: ['Osric Tallow', 'Agnes Quay', 'Bertram Moorside', 'Hild Saltmarsh', 'Godric Anchorby'],
};

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const _arr = (v) => (Array.isArray(v) ? v : []);
const _day = (world) => (world && Number.isFinite(world.day) ? world.day : 0);
const _key = (q, r) => `${q},${r}`;

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
}

function _ruledId(player) {
    const r = player && player.throne && player.throne.ruling;
    return r && r.kingdomId != null ? r.kingdomId : null;
}

let _cfgSrc;
let _cfg = null;

export const Ports = {
    config() {
        const g = DataLoader._gamedata;
        const d = g && g.ports;
        if (_cfg && _cfgSrc === d) return _cfg;
        const o = _obj(d);
        const H = _obj(o.harbour), Y = _obj(o.yard), K = _obj(o.careen), F = _obj(o.fishing);
        _cfgSrc = d;
        _cfg = {
            harbour: {
                ...DEFAULTS.harbour, ...H,
                berths: { ...DEFAULTS.harbour.berths, ..._obj(H.berths) },
                dues: { ...DEFAULTS.harbour.dues, ..._obj(H.dues) },
                sizeMult: { ...DEFAULTS.harbour.sizeMult, ..._obj(H.sizeMult) },
                masterJobs: _arr(H.masterJobs).length ? H.masterJobs : DEFAULTS.harbour.masterJobs,
            },
            yard: {
                ...DEFAULTS.yard, ...Y,
                stages: _arr(Y.stages).length ? Y.stages : DEFAULTS.yard.stages,
                townBuild: { ...DEFAULTS.yard.townBuild, ..._obj(Y.townBuild) },
            },
            careen: {
                ...DEFAULTS.careen, ...K,
                beach: { ...DEFAULTS.careen.beach, ..._obj(K.beach) },
                dock: { ...DEFAULTS.careen.dock, ..._obj(K.dock) },
                goods: { ...DEFAULTS.careen.goods, ..._obj(K.goods) },
            },
            fishing: { ...DEFAULTS.fishing, ...F, boatsBySize: { ...DEFAULTS.fishing.boatsBySize, ..._obj(F.boatsBySize) } },
            masters: _arr(o.masters).length ? o.masters : DEFAULTS.masters,
        };
        return _cfg;
    },

    // ── The port ─────────────────────────────────────────

    _tile(world, q, r) {
        return world && typeof world.getTile === 'function' ? world.getTile(q, r) || null : null;
    },

    /** The water beside (q, r): 'sea' | 'lake' | null */
    waterBeside(world, q, r) {
        let lake = false;
        for (const n of Hex.neighbors(q, r)) {
            const t = this._tile(world, n.q, n.r);
            const id = t && t.terrain && t.terrain.id;
            if (!id || !WATER_IDS.has(id)) continue;
            if (id !== 'lake') return 'sea';
            lake = true;
        }
        return lake ? 'lake' : null;
    },

    /** The settlement at (q, r) if it is a port (on the sea or a lake), else null. */
    portAt(world, q, r) {
        const t = this._tile(world, q, r);
        if (!t || !t.settlement) return null;
        return this.waterBeside(world, q, r) ? t.settlement : null;
    },

    /** The port's book: settlement.harbourBook (made on first use). */
    state(settlement) {
        if (!settlement) return null;
        const p = settlement.harbourBook;
        if (!p || typeof p !== 'object' || !p.v) {
            settlement.harbourBook = { v: 1, masterId: null, masterName: null, dues: 0, calls: 0, owed: 0, handled: 0, handledDay: null };
        }
        return settlement.harbourBook;
    },

    _size(settlement) {
        const t = settlement && settlement.type;
        return SIZES.includes(t) ? t : 'village';
    },

    /** Does the player keep this port (a holding of theirs, or their own realm's)? */
    ownPort(player, settlement) {
        if (!player || !settlement) return false;
        if (settlement.holding) return true;
        const k = _ruledId(player);
        return k != null && settlement.kingdom === k;
    },

    /**
     * The harbourmaster: { name, id, person } — the eldest master among the
     * town's merchants, fishers, carters and labourers (kept while he lives
     * there), else a name for the place.
     */
    master(world, settlement, day = _day(world)) {
        if (!settlement) return null;
        const st = this.state(settlement);
        const folk = settlement.folk;
        if (folk && Array.isArray(folk.people)) {
            const cur = st.masterId != null ? Townsfolk.get(folk, st.masterId) : null;
            if (cur && Townsfolk.isHere(cur) && Townsfolk.age(cur, day) >= 20) return { id: cur.id, name: Townsfolk.name(cur), person: cur };
            const jobs = this.config().harbour.masterJobs;
            let best = null, bestScore = -Infinity;
            for (const p of folk.people) {
                if (!Townsfolk.isHere(p)) continue;
                const age = Townsfolk.age(p, day);
                if (age < 25 || age > 70) continue;
                const j = p.job && p.job.id;
                const ji = jobs.indexOf(j);
                if (ji < 0) continue;
                const rank = p.job.rank === 'master' ? 2 : p.job.rank === 'journeyman' ? 1 : 0;
                const score = rank * 100 + (jobs.length - ji) * 10 + Math.min(age, 60) / 10;
                if (score > bestScore) { best = p; bestScore = score; }
            }
            if (best) {
                st.masterId = best.id;
                st.masterName = Townsfolk.name(best);
                return { id: best.id, name: st.masterName, person: best };
            }
        }
        const names = this.config().masters;
        const name = st.masterName || names[_hash(`hm:${settlement.name}:${settlement.q},${settlement.r}`) % names.length];
        st.masterName = name;
        return { id: null, name, person: null };
    },

    /** Trading ships lying at (or by) the port: world units of type trade_ship within a hex. */
    _tradersIn(world, q, r) {
        const units = world && Array.isArray(world.units) ? world.units : [];
        let n = 0;
        for (const u of units) {
            if (!u || u.destroyed || u.type !== 'trade_ship') continue;
            const d = world.width > 0 ? Hex.wrappingOffsetDistance(q, r, u.q, u.r, world.width) : Hex.offsetDistance(q, r, u.q, u.r);
            if (d <= 1) n++;
        }
        return n;
    },

    /** Your ships lying at (q, r) in harbour (docked, careened or on the slip). */
    _yoursIn(player, q, r, except = null) {
        return _arr(player && player.ships).filter(s => s && s !== except && s.q === q && s.r === r && (s.status === 'docked' || s.status === 'careened' || s.status === 'building'));
    },

    /** Berths: { total, town, traders, yours, free } — free may be below 0 (lying in the roads). */
    berths(world, player, q, r, except = null) {
        const s = this.portAt(world, q, r);
        if (!s) return null;
        const size = this._size(s);
        const C = this.config().harbour;
        const total = Math.max(1, Math.round(_num(C.berths[size], 2)));
        const town = TOWN_SHIPS[size] || 1;
        const traders = this._tradersIn(world, q, r) * Math.max(0, _num(C.traderBerths, 1));
        const yours = this._yoursIn(player, q, r, except).length;
        return { total, town, traders, yours, free: total - town - traders - yours };
    },

    /**
     * The dues on a ship making port at (q, r): { fee, roads, own, master }
     * — by her hold and crew and the town's size; lying in the roads (no
     * berth free) the lighters cost roadsMult more; nothing in your own port.
     */
    duesFor(world, player, ship, q, r) {
        const s = this.portAt(world, q, r);
        if (!s || !ship) return null;
        const C = this.config().harbour;
        const stats = Ships.getShipEffectiveStats(ship);
        const b = this.berths(world, player, q, r, ship);
        const roads = !!b && b.free <= 0;
        const base = (_num(stats.cargoCapacity) * _num(C.dues.perCargo) + _num(stats.crewRequired) * _num(C.dues.perCrew)) * _num(C.sizeMult[this._size(s)], 1);
        let fee = Math.max(_num(C.dues.min, 2), Math.min(_num(C.dues.max, 60), base));
        if (roads) fee *= Math.max(1, _num(C.dues.roadsMult, 1.5));
        const own = this.ownPort(player, s);
        return { fee: own ? 0 : Math.round(fee), roads, own, master: this.master(world, s), berths: b, settlement: s };
    },

    /** Pay `fee` (or what the purse holds; the rest owed) for `ship` into the port's purse. → { paid, owed } */
    _collect(world, player, s, fee, ship = null) {
        const st = this.state(s);
        const pay = Math.max(0, Math.min(Math.floor(_num(player.gold)), Math.round(fee)));
        if (pay > 0) {
            player.gold -= pay;
            Economy.payTown(s, pay);
            Ledger.record(player, 'ships', -pay);
            if (player.financeToday && player.financeToday.expenses) player.financeToday.expenses.ships = (player.financeToday.expenses.ships || 0) + pay;
            st.dues = Utils.cents(_num(st.dues) + pay);
        }
        const owed = Math.max(0, Math.round(fee) - pay);
        if (owed > 0) {
            st.owed = Math.round(_num(st.owed) + owed);
            if (ship) ship.duesOwed = { q: s.q, r: s.r, amount: Math.round(_num(ship.duesOwed && ship.duesOwed.amount) + owed) };
        }
        return { paid: pay, owed };
    },

    /** Pay what you owe the harbourmaster of (q, r). → { ok, paid, reason } */
    payOwed(world, player, q, r) {
        const s = this.portAt(world, q, r);
        if (!s) return { ok: false, reason: 'There is no harbour here.' };
        const st = this.state(s);
        const owed = Math.round(_num(st.owed));
        if (!(owed > 0)) return { ok: false, reason: 'You owe the harbour nothing.' };
        const pay = Math.min(owed, Math.floor(_num(player.gold)));
        if (!(pay > 0)) return { ok: false, reason: 'You have no coin to pay with.' };
        player.gold -= pay;
        Economy.payTown(s, pay);
        Ledger.record(player, 'ships', -pay);
        st.owed = owed - pay;
        st.dues = Utils.cents(_num(st.dues) + pay);
        let left = pay;
        for (const ship of _arr(player.ships)) {
            const o = ship && ship.duesOwed;
            if (!o || o.q !== q || o.r !== r || !(left > 0)) continue;
            const x = Math.min(left, _num(o.amount));
            left -= x;
            o.amount = _num(o.amount) - x;
            if (!(o.amount > 0)) delete ship.duesOwed;
        }
        return { ok: true, paid: pay, left: st.owed };
    },

    /** Ships of yours that made port today (were not docked here yesterday): dues taken. */
    _arrivals(world, player, notices) {
        for (const ship of _arr(player && player.ships)) {
            if (!ship) continue;
            if (AFLOAT.has(ship.status) || ship.voyage) {
                if (ship.portCall) ship.portCall = null;
                continue;
            }
            if (ship.status !== 'docked') continue;
            const at = _key(ship.q, ship.r);
            // (first sight of her: launched, bought or loaded here — no arrival)
            if (ship.portCall === undefined) { ship.portCall = at; continue; }
            if (ship.portCall === at) continue;
            ship.portCall = at;
            const d = this.duesFor(world, player, ship, ship.q, ship.r);
            if (!d) continue;
            const st = this.state(d.settlement);
            st.calls = _num(st.calls) + 1;
            if (d.own) continue;
            const got = this._collect(world, player, d.settlement, d.fee, ship);
            const town = d.settlement.name || 'the port';
            const where = d.roads ? `Every berth at ${town} is taken: she lies in the roads and the lighters bring her in.` : `She ties up at a berth at ${town}.`;
            notices.push({
                icon: '⚓', title: 'Harbour Dues',
                text: `${where} ${d.master.name}, the harbourmaster, takes ${got.paid}g in dues for the ${ship.name}${got.owed > 0 ? `; ${got.owed}g is owed` : ''}.`,
                type: got.owed > 0 ? 'warning' : 'info',
            });
        }
    },

    /** What you owe a harbour is taken the next day you have the coin and a ship of yours lies there. */
    _settleOwed(world, player, notices) {
        const seen = new Set();
        for (const ship of _arr(player && player.ships)) {
            const o = ship && ship.duesOwed;
            if (!o || ship.status !== 'docked' || ship.q !== o.q || ship.r !== o.r) continue;
            const k = _key(o.q, o.r);
            if (seen.has(k)) continue;
            seen.add(k);
            if (!(Math.floor(_num(player.gold)) > 0)) continue;
            const res = this.payOwed(world, player, o.q, o.r);
            if (res.ok) {
                const s = this.portAt(world, o.q, o.r);
                notices.push({ icon: '⚓', title: 'Dues Paid', text: `The harbourmaster of ${(s && s.name) || 'the port'} takes the ${res.paid}g you owed him${res.left > 0 ? ` (${res.left}g still owed)` : ''}.`, type: 'info' });
            }
        }
    },

    // ── The shipyard ─────────────────────────────────────

    stages() {
        return this.config().yard.stages;
    },

    /** How far a ship on the slip has come: { progress 0..1, index, stage, within 0..1 } (null if she is not building). */
    stageOf(ship) {
        if (!ship || ship.status !== 'building') return null;
        const st = Ships.getShipType(ship.typeId);
        const total = Math.max(1, _num(ship.buildDays, _num(st && st.buildDays, 10)));
        const left = Math.max(0, Math.min(total, _num(ship.buildDaysLeft, total)));
        return this.stageAt((total - left) / total);
    },

    /** The stage at `progress` (0..1) of a build. */
    stageAt(progress) {
        const stages = this.stages();
        const p = Math.max(0, Math.min(1, _num(progress)));
        const sum = stages.reduce((a, s) => a + Math.max(0, _num(s.share)), 0) || 1;
        let acc = 0;
        for (let i = 0; i < stages.length; i++) {
            const w = Math.max(0, _num(stages[i].share)) / sum;
            if (p < acc + w || i === stages.length - 1) return { progress: p, index: i, stage: stages[i], within: w > 0 ? Math.max(0, Math.min(1, (p - acc) / w)) : 1 };
            acc += w;
        }
        return { progress: p, index: 0, stage: stages[0], within: 0 };
    },

    /** The goods a day of the stage asks of the town's market: { goodId: units } */
    stageNeeds(ship, stage) {
        const st = Ships.getShipType(ship && ship.typeId);
        if (!st || !stage) return {};
        const total = Math.max(1, _num(ship.buildDays, _num(st.buildDays, 10)));
        const sum = this.stages().reduce((a, s) => a + Math.max(0, _num(s.share)), 0) || 1;
        const days = Math.max(1, total * Math.max(0, _num(stage.share)) / sum);
        const scale = _num(st.baseCost, 200) / 100;
        const out = {};
        for (const [g, per] of Object.entries(_obj(stage.goods))) {
            const n = Math.round(_num(per) * scale / days * 100) / 100;
            if (n > 0) out[g] = n;
        }
        return out;
    },

    /**
     * The shipwrights' day on your ships on the slip (before
     * Ships.processDaily counts the day): the stage's goods drawn from the
     * town's market; with none to be had the day's work waits (the build
     * day given back), up to yard.maxStall of the build days.
     */
    yardDay(world, player) {
        const notices = [];
        for (const ship of _arr(player && player.ships)) {
            if (!ship || ship.status !== 'building') continue;
            const st = Ships.getShipType(ship.typeId);
            if (!st) continue;
            if (!(_num(ship.buildDays) > 0)) ship.buildDays = Math.max(1, _num(st.buildDays, 10));
            const t = this._tile(world, ship.q, ship.r);
            const s = t && t.settlement;
            if (!s || !s.market) continue;
            const now = this.stageOf(ship);
            if (!now) continue;
            const need = this.stageNeeds(ship, now.stage);
            let short = null;
            for (const [g, n] of Object.entries(need)) {
                if (!SettlementMarket.tracks(g)) continue;
                if (SettlementMarket.stock(s, g) < n * 0.5) { short = g; break; }
            }
            const cap = Math.floor(_num(ship.buildDays) * Math.max(0, _num(this.config().yard.maxStall, 0.5)));
            if (short && _num(ship.yardStall) < cap) {
                ship.yardStall = _num(ship.yardStall) + 1;
                // (Ships.processDaily takes the day off again: the slip stands still)
                ship.buildDaysLeft = _num(ship.buildDaysLeft, 1) + 1;
                if (ship.yardWaiting !== short) {
                    const g = SettlementMarket.good(short);
                    notices.push({ icon: '🌲', title: 'The Slip Waits', text: `The shipwrights at ${s.name || 'the yard'} have no ${(g && g.name) || short} for the ${ship.name}: the work on her waits till the market has some.`, type: 'warning' });
                }
                ship.yardWaiting = short;
                continue;
            }
            delete ship.yardWaiting;
            const used = ship.yardUsed || (ship.yardUsed = {});
            for (const [g, n] of Object.entries(need)) {
                const got = SettlementMarket.take(s, g, n);
                if (got > 0) used[g] = Math.round((_num(used[g]) + got) * 100) / 100;
            }
        }
        return { notices };
    },

    /**
     * What stands on the port's slip today: your ships building there
     * ({ ship, ...stageOf }) and, now and then, a hull of the town's own
     * (by a hash of the place and the day; drawn only). → [{ kind, name, progress, index, stage, within, typeId }]
     */
    slipAt(world, player, q, r, day = _day(world)) {
        const out = [];
        for (const ship of _arr(player && player.ships)) {
            if (!ship || ship.status !== 'building' || ship.q !== q || ship.r !== r) continue;
            const at = this.stageOf(ship);
            if (at) out.push({ kind: 'yours', name: ship.name, typeId: ship.typeId, waiting: ship.yardWaiting || null, ...at });
        }
        if (out.length) return out;
        const s = this.portAt(world, q, r);
        const TB = this.config().yard.townBuild;
        if (!s || SIZES.indexOf(this._size(s)) < SIZES.indexOf(TB.minSize || 'town')) return out;
        const craft = Shipcraft.townKnows(world, s);
        if (!craft.includes('shipbuilding')) return out;
        const every = Math.max(10, Math.round(_num(TB.every, 70)));
        const days = Math.max(5, Math.min(every, Math.round(_num(TB.days, 50))));
        const ph = (_num(day) + (_hash(`yard:${q},${r}`) % every)) % every;
        if (ph < days) out.push({ kind: 'town', name: `${s.name || 'the town'}'s new hull`, typeId: SIZES.indexOf(this._size(s)) >= 2 ? 'cog' : 'fishing_vessel', ...this.stageAt(ph / days) });
        return out;
    },

    // ── Careening and the dry dock ───────────────────────

    /** Can the yard at this port give a dry dock (a city, or your own shipyard or harbour beside it)? */
    _hasDock(world, player, s, q, r) {
        if (this.config().careen.dock.towns.includes(this._size(s))) return true;
        try {
            if (player && Technology.hasBuildingNear(player, world, 'shipyard', q, r, 1)) return true;
        } catch (e) { /* (a bare test player) */ }
        return !!(s.holding && s.holding.fx && s.holding.fx.port > 0);
    },

    /** The ways to mend a ship's hull here: [{ kind, name, days, cost, ok, reason }] */
    careenOptions(world, player, ship) {
        if (!ship) return [];
        const C = this.config().careen;
        const s = this.portAt(world, ship.q, ship.r);
        const damage = Math.max(0, 100 - _num(ship.condition, 100));
        const out = [];
        for (const kind of ['beach', 'dock']) {
            const K = C[kind];
            const days = Math.max(1, Math.ceil(damage / Math.max(1, _num(K.rate, 6))));
            const cost = Math.max(1, Math.round(Ships.getRepairCost(ship) * _num(K.costShare, 0.6)));
            let reason = null;
            if (!s) reason = 'There is no harbour here.';
            else if (ship.status !== 'docked') reason = 'She must be lying in harbour.';
            else if (damage < _num(C.minDamage, 3)) reason = 'Her hull is sound.';
            else if (!Shipcraft.townKnows(world, s).includes('shipbuilding')) reason = `${s.name} has no shipwrights.`;
            else if (kind === 'dock' && !this._hasDock(world, player, s, ship.q, ship.r)) reason = 'Only a city, or your own shipyard or harbour, has a dry dock.';
            else if (_num(player && player.gold) < cost) reason = `It costs ${cost}g.`;
            out.push({ kind, name: K.name, days, cost, ok: !reason, reason });
        }
        return out;
    },

    /** Haul her down: paid now, out of service for the days. → { ok, days, cost, reason } */
    careen(world, player, shipId, kind = 'beach') {
        const ship = Ships.getShipById(player, shipId);
        if (!ship) return { ok: false, reason: 'Ship not found.' };
        const opt = this.careenOptions(world, player, ship).find(o => o.kind === kind);
        if (!opt) return { ok: false, reason: 'Not here.' };
        if (!opt.ok) return { ok: false, reason: opt.reason };
        const s = this.portAt(world, ship.q, ship.r);
        player.gold -= opt.cost;
        Economy.payTown(s, opt.cost);
        Ledger.record(player, 'ships', -opt.cost);
        if (player.financeToday && player.financeToday.expenses) player.financeToday.expenses.ships = (player.financeToday.expenses.ships || 0) + opt.cost;
        // (the yard's planks and pitch, out of the market's stock)
        const damage = 100 - _num(ship.condition, 100);
        for (const [g, per] of Object.entries(this.config().careen.goods)) SettlementMarket.take(s, g, Math.round(_num(per) * damage / 10 * 100) / 100);
        ship.status = 'careened';
        ship.careen = { kind, q: ship.q, r: ship.r, days: opt.days, left: opt.days, from: _num(ship.condition, 100), start: _day(world) };
        return { ok: true, days: opt.days, cost: opt.cost, kind };
    },

    /** A day of the yard on each careened ship; floated off when her hull is whole. */
    _careenDay(world, player, notices) {
        for (const ship of _arr(player && player.ships)) {
            if (!ship || ship.status !== 'careened') continue;
            const c = ship.careen;
            if (!c) { ship.status = 'docked'; continue; }
            c.left = Math.max(0, _num(c.left, 1) - 1);
            const done = c.days - c.left;
            ship.condition = Math.min(100, Math.round(_num(c.from) + (100 - _num(c.from)) * done / Math.max(1, c.days)));
            if (c.left <= 0) {
                ship.condition = 100;
                ship.status = 'docked';
                delete ship.careen;
                notices.push({ icon: '🛠️', title: 'Afloat Again', text: `The ${ship.name} is floated off, her hull scraped, caulked and sound. She is ready for sea.`, type: 'success' });
            }
        }
    },

    // ── The fishing fleet ────────────────────────────────

    /** The weather keeps the boats in at (q, r) on `day`? → reason or null */
    keptIn(world, q, r, day) {
        try {
            if (Climate.icebound(world, q, r, day)) return 'ice';
        } catch (e) { /* (a bare world) */ }
        const w = world && world.weather && typeof world.weather.getWeather === 'function' ? world.weather.getWeather(q, r, day) : null;
        if (w && this.config().fishing.stayIn.includes(w.type)) return w.type;
        return null;
    },

    /**
     * The fishing boats of the town at (q, r): { boats, fishers, water, kept }
     * — one per fisher on its roster (boatsBySize without one); null where the
     * town is on no water (sea, lake or a river big enough for a boat).
     */
    fleet(world, q, r, day = _day(world)) {
        const t = this._tile(world, q, r);
        const s = t && t.settlement;
        if (!s) return null;
        const water = this.waterBeside(world, q, r) || (t.hasRiver && Rivers.boatable(world, q, r) ? 'river' : null);
        if (!water) return null;
        const F = this.config().fishing;
        let fishers = null;
        const folk = s.folk;
        if (folk && Array.isArray(folk.people)) {
            try {
                fishers = (TownJobs.holders(folk, day).fisher || []).length;
            } catch (e) { fishers = null; }
        }
        const boats = Math.max(0, Math.min(_num(F.maxBoats, 6), fishers != null ? fishers : _num(F.boatsBySize[this._size(s)], 2)));
        return { boats, fishers, water, kept: this.keptIn(world, q, r, day) };
    },

    /** The share of the days in (day − span, day] the boats of (q, r) went out (1: every day). */
    outShare(world, q, r, day, span = 1) {
        const n = Math.max(1, Math.floor(_num(span, 1)));
        if (!world || !world.weather) return 1;
        let out = 0;
        for (let i = 0; i < n; i++) if (!this.keptIn(world, q, r, _num(day) - i)) out++;
        return out / n;
    },

    /**
     * The market's crew (systems/townJobs.js crew: { g, r, occ }) with the
     * fish scaled by the days the boats were kept in (the shore still fishes:
     * shoreFloor). The same object back when nothing changes; a copy
     * otherwise (the townsfolk's crew is cached).
     */
    fishCrew(crew, world, settlement, q, r, day, span = 1) {
        if (!settlement || !Number.isFinite(day)) return crew;
        const fl = this.fleet(world, q, r, day);
        if (!fl || !(fl.boats > 0) || fl.water === 'river') return crew;
        const share = this.outShare(world, q, r, day, span);
        if (share >= 1) return crew;
        const floor = Math.max(0, Math.min(1, _num(this.config().fishing.shoreFloor, 0.35)));
        const f = floor + (1 - floor) * share;
        const g = { ...((crew && crew.g) || {}) };
        g.fish = _num(g.fish, 1) * f;
        return { ...(crew || { r: {}, occ: {} }), g };
    },

    /** The fish the port's market brings in a day (its production of fish; for the quay's catch). */
    catchPerDay(settlement) {
        const m = settlement && settlement.market;
        if (!m || !Array.isArray(m.prod)) return 0;
        const i = SettlementMarket.config().idx.fish;
        return i !== undefined ? Math.max(0, _num(m.prod[i])) : 0;
    },

    // ── Dock work ────────────────────────────────────────

    /**
     * Cargo moved over the quay today by your ships here (the difference in
     * their holds since yesterday, counted in processDay) and by the town's
     * trade (its market's last trade in and out): { yours, trade, ships }.
     */
    dockWork(world, player, q, r) {
        const s = this.portAt(world, q, r);
        if (!s) return null;
        const st = this.state(s);
        const today = _day(world);
        const m = s.market;
        const trade = m && m.trade ? _num(m.trade.in) + _num(m.trade.out) : 0;
        const ships = this._yoursIn(player, q, r).filter(x => x.status === 'docked').length;
        return { yours: st.handledDay === today || st.handledDay === today - 1 ? _num(st.handled) : 0, trade: Math.round(trade * 10) / 10, ships };
    },

    /** Note cargo over the quay at (q, r) (the street map's dockers carry it). */
    noteCargo(world, q, r, units) {
        const s = this.portAt(world, q, r);
        if (!s || !(units > 0)) return;
        const st = this.state(s);
        const today = _day(world);
        if (st.handledDay !== today) { st.handledDay = today; st.handled = 0; }
        st.handled = Math.round((_num(st.handled) + units) * 10) / 10;
    },

    _cargoDiffs(world, player) {
        for (const ship of _arr(player && player.ships)) {
            if (!ship) continue;
            const n = Ships.getCargoUsed(ship);
            if (ship.status === 'docked' && Number.isFinite(ship.portCargo) && ship.portCargo !== n && ship.portCall === _key(ship.q, ship.r)) {
                this.noteCargo(world, ship.q, ship.r, Math.abs(n - ship.portCargo));
            }
            ship.portCargo = n;
        }
    },

    // ── Ferries ──────────────────────────────────────────

    /** The ferry the player would take into (tq, tr) from (fq, fr), if any and affordable: { ferry, fare, extra, wade } */
    ferryLeg(world, player, fq, fr, tq, tr, asHost = false) {
        const who = asHost ? 'host' : 'player';
        const wade = Rivers.crossExtra(world, fq, fr, tq, tr, who);
        if (!(wade > 0)) return null;
        const ferry = Ferries.at(world, tq, tr);
        if (!ferry) return null;
        const fare = Ferries.fareFor(ferry, player, asHost);
        if (_num(player && player.gold) < fare) return null;
        return { ferry, fare, wade, extra: Ferries.soften(ferry, wade, who) };
    },

    /**
     * The player stepped from (fq, fr) into (tq, tr) on foot: at a ferry, the
     * fare to the ferryman (the town's purse). → { paid, ferry } or null
     */
    ferryStep(world, player, fq, fr, tq, tr, asHost = false) {
        if (!world || !player || player.boardedShip) return null;
        const leg = this.ferryLeg(world, player, fq, fr, tq, tr, asHost);
        if (!leg) return null;
        const town = this._tile(world, leg.ferry.town.q, leg.ferry.town.r);
        if (leg.fare > 0) {
            player.gold -= leg.fare;
            if (town && town.settlement) Economy.payTown(town.settlement, leg.fare);
            else Economy.payNearest(world, tq, tr, leg.fare);
            Ledger.record(player, 'roadTolls', -leg.fare);
        }
        player.lastFerry = { id: leg.ferry.id, day: _day(world), fare: leg.fare, ferryman: leg.ferry.ferryman, town: leg.ferry.town.name };
        // (told as you come ashore: player/core/movement.js queues it, ui/game/gameLoop.js shows it)
        // (the time as the road takes it: bridging craft and a Grand Bridge's wardens shorten
        // every crossing — Infrastructure.riverCrossFactor, as player/core/movement.js counts it)
        const factor = Infrastructure.riverCrossFactor(player);
        const extra = leg.extra * factor;
        const wade = leg.wade * factor;
        const span = (d) => {
            const h = Math.max(1, Math.round(d * 24));
            if (d < 1) return `${h} hour${h === 1 ? '' : 's'}`;
            const n = Math.round(d * 10) / 10;
            return `${n} day${n === 1 ? '' : 's'}`;
        };
        const text = `${leg.ferry.ferryman} takes you over the great river on the ferry${leg.fare > 0 ? ` for ${leg.fare}g, to ${leg.ferry.town.name}'s purse` : ' and asks nothing for it'}. `
            + `With the wait for the boat it took ${span(extra)}; wading across would have taken ${span(wade)}.`;
        return { paid: leg.fare, ferry: leg.ferry, extra, wade, text };
    },

    /** The strait ferries from where the player stands: [{ ferry, to, fare, ok, reason }] */
    straitOffers(world, player) {
        if (!player) return [];
        return Ferries.straitsFrom(world, player.q, player.r).map(({ ferry, to }) => {
            const fare = Ferries.fareFor(ferry, player, Array.isArray(player.army) && player.army.length > 0);
            let reason = null;
            if (player.boardedShip) reason = 'You are aboard your own ship.';
            else if (_num(player.gold) < fare) reason = `The fare is ${fare}g.`;
            return { ferry, to, fare, ok: !reason, reason };
        });
    },

    /**
     * Cross a strait on the ferry from the port where the player stands to
     * the port across: the fare to the town she sails from, the day spent.
     * → { ok, to, fare, reason }
     */
    takeStrait(world, player, ferryId) {
        const offer = this.straitOffers(world, player).find(o => o.ferry.id === ferryId);
        if (!offer) return { ok: false, reason: 'No ferry runs from here to there.' };
        if (!offer.ok) return { ok: false, reason: offer.reason };
        const from = this._tile(world, player.q, player.r);
        if (offer.fare > 0) {
            player.gold -= offer.fare;
            if (from && from.settlement) Economy.payTown(from.settlement, offer.fare);
            Ledger.record(player, 'roadTolls', -offer.fare);
        }
        player.prevQ = player.q;
        player.prevR = player.r;
        player.q = offer.to.q;
        player.r = offer.to.r;
        player.path = null;
        // (the day is the crossing's)
        player.movementRemaining = 0;
        player.lastFerry = { id: offer.ferry.id, day: _day(world), fare: offer.fare, ferryman: offer.ferry.ferryman, town: offer.to.name };
        return { ok: true, to: offer.to, fare: offer.fare, days: offer.ferry.days };
    },

    // ── The day ──────────────────────────────────────────

    /** The day's end (after Ships.processDaily): dues at arrival, what is owed, careening, the quay's cargo. */
    processDay(world, player) {
        const notices = [];
        if (!world || !player) return { notices };
        this._careenDay(world, player, notices);
        this._arrivals(world, player, notices);
        this._settleOwed(world, player, notices);
        this._cargoDiffs(world, player);
        return { notices };
    },
};
