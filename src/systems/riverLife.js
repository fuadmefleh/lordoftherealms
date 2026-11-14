// ============================================
// RIVER LIFE — fishing as a trade, fish that spoil, spring floods
// ============================================
// Fishing rights. The water by a hex — its river, a lake beside it, the sea
// on its shore — belongs to the town that stands on it or beside it, else to
// the crown whose land it is (else it is free water). The player can lease
// the rights to it for leaseDays (the fee into the town's purse or the
// crown's treasury). On water they hold:
//   • their nets take more fish (rollBonus more chances a day: the good pools,
//     systems/riverNets.js opts.rollBonus);
//   • the lord's water bailiff walks the bank: fewer poachers.
// A net set on held water without a lease may be found by the bailiff: a
// fine (to the holder) or, with no coin to pay it, the net taken.
// Rival fishers poach the nets: part of the fish in one goes, sold on in the
// nearest town's market (a poacher caught at it, with the player there,
// drops the fish and runs).
//
// Fish spoil. Raw fish in the packs (player.fishLots) and in a boat's hold
// (riverBoat.fishLots) are counted by the day they came in; past fresh[season]
// days they rot. One salt cures saltPer raw fish into preserved fish (anywhere:
// a barrel and a knife), from the packs or from the hold.
//
// Waterside towns eat more fish: settlement.waterside is set once a session
// on towns on a river, a lake or the sea (world/settlementMarket.js reads it
// with data/markets.json watersideDemand).
//
// Spring floods. In spring a river hex may rise — more in rain and storm and
// in the thaw early in the season, more on the big lower rivers — for some
// days, its crest running on downstream a day a hex. While in flood: nets
// there are washed away or torn, the player's growing crops on it drown, a
// house of theirs to let in a town on it needs repairs (no rent till done),
// the town's granary loses grain, the river brings down a surge of flotsam,
// and its street map shows the water over its banks (ui/innerMapLayers/
// floodWater.js). River boats run quicker downstream and slower up it
// (systems/riverBoats.js).
//
// State: world.riverLife = { seq, leases: [...], floods: [...] } (saved).
// Rolls are hashes of the world's seed and the day (riverFlotsam.flotsamHash):
// no RNG streams. Settings: data/riverLife.json.

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Seasons } from '../world/seasons.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { LotBook } from '../world/lotBook.js';
import { RiverDrift } from './riverDrift.js';
import { RiverFlotsam, flotsamHash } from './riverFlotsam.js';
import { RiverNets } from './riverNets.js';
import { Ledger } from './ledger.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const SEA_IDS = new Set(['ocean', 'deep_ocean', 'coast', 'sea']);
const SHORE_IDS = new Set(['coast', 'beach']);

const DEFAULTS = {
    enabled: true,
    leaseDays: 90,
    fee: { river: 30, lake: 25, sea: 40 },
    townMult: { hamlet: 0.6, village: 0.8, town: 1.2, city: 1.6, capital: 2 },
    crownMult: 1,
    rollBonus: 2,
    bailiff: { chance: 0.02, townMult: 2.5, fine: 12 },
    poach: { chance: 0.03, leasedMult: 0.6, townMult: 1.5, share: 0.5 },
    fresh: { spring: 3, summer: 2, autumn: 3, winter: 6 },
    saltPer: 4,
    floods: {
        enabled: true, dayFrom: 1, dayTo: 26, chance: 0.0015, sizeDiv: 3, rainMult: 3, stormMult: 7,
        thawDays: 10, thawMult: 1.8, days: [3, 7], crest: 4, fall: 0.8, maxActive: 40,
        washAway: 0.6, drown: 0.55, houseChance: 0.5, repairDays: 6, grainLoss: 0.08, surge: 2, noticeReach: 6, bankCells: 3,
    },
};

/** Towns already marked waterside this session */
const _marked = new WeakSet();

export const RiverLife = {
    _cfgSrc: null,
    _cfg: null,

    config() {
        const src = DataLoader._gamedata && DataLoader._gamedata.riverLife;
        if (this._cfgSrc !== src || !this._cfg) {
            this._cfgSrc = src;
            const s = src || {};
            const c = { ...DEFAULTS, ...s };
            for (const k of ['fee', 'townMult', 'bailiff', 'poach', 'fresh', 'floods']) c[k] = { ...DEFAULTS[k], ...(s[k] || {}) };
            this._cfg = c;
        }
        return this._cfg;
    },

    state(world, create = true) {
        if (!world) return null;
        if (!world.riverLife || typeof world.riverLife !== 'object') {
            if (!create) return null;
            world.riverLife = { seq: 0, leases: [], floods: [] };
        }
        const st = world.riverLife;
        if (!Array.isArray(st.leases)) st.leases = [];
        if (!Array.isArray(st.floods)) st.floods = [];
        return st;
    },

    _tile(world, q, r) {
        return RiverDrift._tile(world, q, r);
    },

    _day(world) {
        return _num(world && world.day);
    },

    _season(day) {
        return String(Seasons.seasonOf(day) || 'Summer').toLowerCase();
    },

    // ── Waters & who holds them ──────────────────────────

    /** The water a hex fishes: 'river' | 'lake' | 'sea' | null */
    waterAt(world, q, r) {
        const t = this._tile(world, q, r);
        if (!t) return null;
        if (RiverDrift.isRiverHex(t)) return 'river';
        let sea = !!(t.terrain && SHORE_IDS.has(t.terrain.id)), lake = false;
        for (const n of Hex.neighbors(q, r)) {
            const nt = this._tile(world, n.q, n.r);
            const id = nt && nt.terrain && nt.terrain.id;
            if (id === 'lake') lake = true;
            else if (id && SEA_IDS.has(id)) sea = true;
        }
        return lake ? 'lake' : sea ? 'sea' : null;
    },

    /**
     * Who holds the water at (q, r): { kind: 'town', q, r, name, settlement }
     * (a town on the hex or beside it), { kind: 'crown', kid, name } (the
     * realm's land), or null (free water).
     */
    holderOf(world, q, r) {
        const t = this._tile(world, q, r);
        if (!t) return null;
        if (t.settlement) return { kind: 'town', q, r, name: t.settlement.name || 'the town', settlement: t.settlement };
        for (const n of Hex.neighbors(q, r)) {
            const nt = this._tile(world, n.q, n.r);
            if (nt && nt.settlement) {
                const W = world.width > 0 ? world.width : 0;
                return { kind: 'town', q: W ? Hex.wrapQ(n.q, W) : n.q, r: n.r, name: nt.settlement.name || 'the town', settlement: nt.settlement };
            }
        }
        if (t.kingdom != null && world && typeof world.getKingdom === 'function') {
            const k = world.getKingdom(t.kingdom);
            if (k) return { kind: 'crown', kid: k.id, name: k.name || 'the crown', kingdom: k };
        }
        return null;
    },

    /** The fee to lease the water at (q, r), or 0 where it can't be leased */
    leaseFee(world, q, r) {
        const water = this.waterAt(world, q, r);
        const h = water ? this.holderOf(world, q, r) : null;
        if (!h) return 0;
        const cfg = this.config();
        const base = _num(cfg.fee[water], 30);
        const m = h.kind === 'town' ? _num(cfg.townMult[h.settlement.type], 1) : _num(cfg.crownMult, 1);
        return Math.max(1, Math.round(base * m));
    },

    /** The player's lease of the water at (q, r) still running today, or null */
    leaseAt(world, q, r, day = null) {
        const st = this.state(world, false);
        if (!st) return null;
        const d = day == null ? this._day(world) : day;
        return st.leases.find(l => l.q === q && l.r === r && l.until >= d) || null;
    },

    leases(world) {
        const st = this.state(world, false);
        const d = this._day(world);
        return st ? st.leases.filter(l => l.until >= d) : [];
    },

    /** Lease (or extend) the fishing rights here. → { ok, reason?, lease? } */
    lease(world, player, q, r) {
        const cfg = this.config();
        if (!cfg.enabled) return { ok: false, reason: 'Nobody leases the water here.' };
        const water = this.waterAt(world, q, r);
        if (!water) return { ok: false, reason: 'There is no water here to fish.' };
        const h = this.holderOf(world, q, r);
        if (!h) return { ok: false, reason: 'This is free water: nobody holds it, and you may fish it as you please.' };
        const fee = this.leaseFee(world, q, r);
        if (_num(player && player.gold) < fee) return { ok: false, reason: `The lease is ${fee}g.` };
        player.gold -= fee;
        if (h.kind === 'town') {
            const s = h.settlement;
            if (!s.economy || typeof s.economy !== 'object') s.economy = {};
            s.economy.gold = _num(s.economy.gold) + fee;
        } else if (h.kingdom) {
            h.kingdom.treasury = _num(h.kingdom.treasury) + fee;
        }
        Ledger.record(player, 'fishingRights', -fee);
        const st = this.state(world);
        const day = this._day(world);
        const days = Math.max(1, _num(cfg.leaseDays, 90));
        let l = this.leaseAt(world, q, r, day);
        if (l) l.until += days;
        else {
            st.seq = _num(st.seq) + 1;
            st.leases = st.leases.filter(x => !(x.q === q && x.r === r));
            l = { id: `fr${st.seq}`, q, r, water, holder: h.kind === 'town' ? { kind: 'town', q: h.q, r: h.r, name: h.name } : { kind: 'crown', kid: h.kid, name: h.name }, fee, from: day, until: day + days - 1 };
            st.leases.push(l);
        }
        return { ok: true, lease: l, fee };
    },

    /** Extra chances a day for a fish in this net (riverNets opts.rollBonus) */
    netRollBonus(world, net) {
        return net && this.leaseAt(world, net.q, net.r) ? Math.max(0, Math.round(_num(this.config().rollBonus, 2))) : 0;
    },

    // ── The nets: bailiffs and poachers ─────────────────

    _seed(world) {
        return RiverFlotsam._seed(world);
    },

    _nearestTown(world, q, r) {
        const h = this.holderOf(world, q, r);
        return h && h.kind === 'town' ? h.settlement : null;
    },

    /** One day of the bailiff and the poachers at the player's nets → notices */
    _netsDay(world, player, day, notices) {
        const st = RiverDrift.state(world, false);
        if (!st || !st.nets || !st.nets.length) return;
        const cfg = this.config();
        const seed = this._seed(world);
        const gone = new Set();
        for (const net of st.nets) {
            const key = `${seed}|rl|${net.id}|${day}`;
            const here = !!(player && player.q === net.q && player.r === net.r);
            const h = this.holderOf(world, net.q, net.r);
            const leased = !!this.leaseAt(world, net.q, net.r, day);
            const town = h && h.kind === 'town';
            // The water bailiff: a net on held water without a lease
            if (h && !leased) {
                const p = _num(cfg.bailiff.chance) * (town ? _num(cfg.bailiff.townMult, 1) : 1);
                if (flotsamHash(key, 'bailiff') < p) {
                    const fine = Math.max(1, Math.round(_num(cfg.bailiff.fine, 12)));
                    if (player && _num(player.gold) >= fine) {
                        player.gold -= fine;
                        if (town) { const s = h.settlement; if (!s.economy) s.economy = {}; s.economy.gold = _num(s.economy.gold) + fine; } else if (h.kingdom) h.kingdom.treasury = _num(h.kingdom.treasury) + fine;
                        Ledger.record(player, 'fines', -fine);
                        notices.push({ icon: '⚖️', title: 'The Water Bailiff', text: `The bailiff of ${h.name} found your net ${net.place || 'by the water'} on water you hold no rights to: fined ${fine}g. Lease the fishing rights and he will leave it be.`, type: 'warning' });
                    } else {
                        gone.add(net.id);
                        notices.push({ icon: '⚖️', title: 'Net Seized', text: `The bailiff of ${h.name} took up your net ${net.place || 'by the water'}: no lease, and no coin for the fine.`, type: 'warning' });
                        continue;
                    }
                }
            }
            // Poachers at the catch
            const fish = (net.catch || []).filter(e => this._isFish(e));
            if (!fish.length) continue;
            const p = _num(cfg.poach.chance) * (leased ? _num(cfg.poach.leasedMult, 1) : 1) * (this._nearTown(world, net.q, net.r) ? _num(cfg.poach.townMult, 1) : 1);
            if (flotsamHash(key, 'poach') >= p) continue;
            if (here) {
                notices.push({ icon: '🎣', title: 'A Poacher', text: `You catch a man at your net ${net.place || 'by the water'}, hands in it to the wrist. He drops the fish and runs.`, type: 'info' });
                continue;
            }
            const take = Math.max(1, Math.round(fish.length * _num(cfg.poach.share, 0.5)));
            const taken = new Set(fish.slice(0, take));
            let qty = 0;
            for (const e of taken) qty += Math.max(1, _num(e.qty, 1));
            net.catch = net.catch.filter(e => !taken.has(e));
            // (the poached fish are sold on in the nearest town)
            const s = this._nearestTown(world, net.q, net.r) || this._townDownstream(world, net.q, net.r);
            if (s && SettlementMarket.tracks('fish')) SettlementMarket.add(s, 'fish', qty);
            net.poached = _num(net.poached) + qty;
            notices.push({ icon: '🎣', title: 'Poachers', text: `Someone has been at your net ${net.place || 'by the water'}: ${qty} fish gone${leased ? ', even on water you lease' : ''}.`, type: 'warning' });
        }
        if (gone.size) st.nets = st.nets.filter(n => !gone.has(n.id));
    },

    /** Is this thing in a net a fish (the nets' fish tables, data/riverDrift.json nets.fish)? */
    _isFish(e) {
        if (!e) return false;
        if (e.fish) return true;
        const src = RiverNets.config().fish;
        if (this._fishSrc !== src || !this._fishIds) {
            this._fishSrc = src;
            this._fishIds = new Set(['fish']);
            for (const table of Object.values(src || {})) for (const f of Array.isArray(table) ? table : []) if (f && f.item) this._fishIds.add(f.item);
        }
        return this._fishIds.has(e.itemId);
    },

    _nearTown(world, q, r) {
        const t = this._tile(world, q, r);
        if (t && t.settlement) return true;
        return Hex.neighbors(q, r).some(n => { const nt = this._tile(world, n.q, n.r); return !!(nt && nt.settlement); });
    },

    /** The first town down the river from (q, r), a few hexes at most */
    _townDownstream(world, q, r) {
        let cq = q, cr = r;
        for (let i = 0; i < 8; i++) {
            const d = RiverDrift.downstream(world, cq, cr);
            if (d.kind !== 'river') return null;
            cq = d.q; cr = d.r;
            const t = this._tile(world, cq, cr);
            if (t && t.settlement) return t.settlement;
        }
        return null;
    },

    // ── Fish that spoil, and salt ───────────────────────

    freshDays(day) {
        return Math.max(1, Math.round(_num(this.config().fresh[this._season(day)], 3)));
    },

    /** Keep the lots in step with the count: more → a new lot today, fewer → the oldest went first */
    _reconcile(lots, have, day) {
        let sum = 0;
        for (const l of lots) sum += l.n;
        if (have > sum) lots.push({ d: day, n: have - sum });
        else if (have < sum) this._consume(lots, sum - have);
        return lots;
    },

    _consume(lots, n) {
        let left = n;
        while (left > 0 && lots.length) {
            const l = lots[0];
            const k = Math.min(l.n, left);
            l.n -= k;
            left -= k;
            if (l.n <= 0) lots.shift();
        }
    },

    /** Rot what is too old: → how many fish went bad */
    _rot(lots, day) {
        const keep = this.freshDays(day);
        let bad = 0;
        while (lots.length && day - lots[0].d >= keep) bad += lots.shift().n;
        return bad;
    },

    /** The fish in the packs and the hold: { packs: {n, oldest}, hold: {n, oldest}, keep } */
    fishView(world, player) {
        const day = this._day(world);
        const keep = this.freshDays(day);
        const one = (lots, n) => {
            const l = Array.isArray(lots) && lots.length ? lots[0] : null;
            return { n, daysLeft: n > 0 ? Math.max(0, keep - (l ? day - l.d : 0)) : null };
        };
        const b = player && player.riverBoat;
        return {
            packs: one(player && player.fishLots, Math.floor(_num(player && player.inventory && player.inventory.fish))),
            hold: b ? one(b.fishLots, Math.floor(_num(b.cargo && b.cargo.fish))) : null,
            keep,
            salt: Math.floor(_num(player && player.inventory && player.inventory.salt)) + (b ? Math.floor(_num(b.cargo && b.cargo.salt)) : 0),
            saltPer: Math.max(1, _num(this.config().saltPer, 4)),
        };
    },

    /** The day's spoiling: → notices */
    _fishDay(world, player, day, notices) {
        if (!player) return;
        const inv = player.inventory || {};
        if (!Array.isArray(player.fishLots)) player.fishLots = [];
        this._reconcile(player.fishLots, Math.floor(_num(inv.fish)), day);
        const bad = this._rot(player.fishLots, day);
        if (bad > 0) {
            inv.fish = Math.max(0, _num(inv.fish) - bad);
            if (inv.fish <= 0) delete inv.fish;
            notices.push({ icon: '🐟', title: 'Fish Gone Bad', text: `${bad} of your fish ${bad === 1 ? 'has' : 'have'} turned: you throw ${bad === 1 ? 'it' : 'them'} out. Salt your catch (a salt to every ${this.config().saltPer}) and it keeps.`, type: 'warning' });
        }
        const b = player.riverBoat;
        if (b && b.cargo) {
            if (!Array.isArray(b.fishLots)) b.fishLots = [];
            this._reconcile(b.fishLots, Math.floor(_num(b.cargo.fish)), day);
            const hb = this._rot(b.fishLots, day);
            if (hb > 0) {
                b.cargo.fish = Math.max(0, _num(b.cargo.fish) - hb);
                if (b.cargo.fish <= 0) delete b.cargo.fish;
                notices.push({ icon: '🐟', title: 'Fish Gone Bad', text: `${hb} fish in your boat's hold ${hb === 1 ? 'has' : 'have'} gone off and over the side.`, type: 'warning' });
            }
        }
    },

    /**
     * Salt raw fish into preserved fish. where: 'packs' | 'hold'. Salt comes
     * from the same place, else from the other. → { ok, reason?, fish, salt }
     */
    saltFish(world, player, where = 'packs') {
        const per = Math.max(1, Math.round(_num(this.config().saltPer, 4)));
        const b = player && player.riverBoat;
        const store = where === 'hold' ? (b && b.cargo) : (player && player.inventory);
        if (!store) return { ok: false, reason: where === 'hold' ? 'You have no boat.' : 'You carry nothing.' };
        const other = where === 'hold' ? player.inventory || {} : (b && (b.aboard || (b.q === player.q && b.r === player.r)) ? b.cargo : {});
        const batches0 = Math.floor(_num(store.fish) / per);
        if (!(batches0 > 0)) return { ok: false, reason: `You need ${per} raw fish to a salt.` };
        const salt = Math.floor(_num(store.salt)) + Math.floor(_num(other.salt));
        const batches = Math.min(batches0, salt);
        if (!(batches > 0)) return { ok: false, reason: 'You have no salt.' };
        let s = batches;
        const fromHere = Math.min(s, Math.floor(_num(store.salt)));
        store.salt = _num(store.salt) - fromHere; s -= fromHere;
        if (store.salt <= 0) delete store.salt;
        if (s > 0) { other.salt = _num(other.salt) - s; if (other.salt <= 0) delete other.salt; }
        const fish = batches * per;
        store.fish -= fish;
        if (store.fish <= 0) delete store.fish;
        store.preserved_fish = _num(store.preserved_fish) + fish;
        const lots = where === 'hold' ? b.fishLots : player.fishLots;
        if (Array.isArray(lots)) this._consume(lots, fish);
        return { ok: true, fish, salt: batches };
    },

    // ── Waterside towns ─────────────────────────────────

    /** Mark the towns on a river, a lake or the sea (once a session per world) */
    markWaterside(world) {
        if (!world || typeof world.getSettlementViews !== 'function' || _marked.has(world)) return 0;
        _marked.add(world);
        let n = 0;
        for (const s of world.getSettlementViews()) {
            const w = this.waterAt(world, s.q, s.r) ? 1 : 0;
            if ((s.waterside ? 1 : 0) !== w) s.waterside = w;
            n += w;
        }
        return n;
    },

    // ── Floods ──────────────────────────────────────────

    /** How high the flood is at (q, r) on `day` (0: none, else 0..1) */
    floodAt(world, q, r, day = null) {
        const st = world && world.riverLife;
        if (!st || !Array.isArray(st.floods) || !st.floods.length) return 0;
        const d = day == null ? this._day(world) : day;
        let sev = 0;
        for (const f of st.floods) if (f.q === q && f.r === r && f.from <= d && f.until >= d && f.sev > sev) sev = f.sev;
        return sev;
    },

    /** The floods on now: [{ q, r, sev, until, name }] */
    floodsNow(world) {
        const st = this.state(world, false);
        const d = this._day(world);
        return st ? st.floods.filter(f => f.from <= d && f.until >= d) : [];
    },

    _weather(world, q, r, day) {
        const wx = world && world.weather;
        if (!wx || typeof wx.getWeather !== 'function') return null;
        try { return wx.getWeather(q, r, day); } catch { return null; }
    },

    _placeName(world, q, r) {
        const t = this._tile(world, q, r);
        if (t && t.settlement && t.settlement.name) return `at ${t.settlement.name}`;
        for (const n of Hex.neighbors(q, r)) {
            const nt = this._tile(world, n.q, n.r);
            if (nt && nt.settlement && nt.settlement.name) return `near ${nt.settlement.name}`;
        }
        return 'in the wilds';
    },

    /** The day's new floods (spring only) */
    _raiseFloods(world, day, st) {
        const F = this.config().floods;
        if (!F.enabled || this._season(day) !== 'spring') return [];
        const dis = Seasons.dayInSeason(day);
        if (dis < _num(F.dayFrom, 1) || dis > _num(F.dayTo, 26)) return [];
        const active = st.floods.filter(f => f.until >= day).length;
        if (active >= _num(F.maxActive, 40)) return [];
        const rv = RiverFlotsam.rivers(world, day);
        if (!rv.list.length) return [];
        const seed = this._seed(world);
        const thaw = dis <= _num(F.thawDays, 10) ? _num(F.thawMult, 1) : 1;
        const maxW = Math.max(_num(F.rainMult, 1), _num(F.stormMult, 1), 1);
        const out = [];
        let room = _num(F.maxActive, 40) - active;
        for (const e of rv.list) {
            if (room <= 0) break;
            const base = _num(F.chance) * (1 + Math.sqrt(e.up || 0) / Math.max(0.1, _num(F.sizeDiv, 3))) * thaw;
            const u = flotsamHash(seed, 'flood', e.q, e.r, day);
            if (u >= base * maxW) continue;
            // (only the few that might rise ask the weather)
            const w = this._weather(world, e.q, e.r, day);
            const m = w && w.type === 'storm' ? _num(F.stormMult, 1) : w && w.type === 'rain' ? _num(F.rainMult, 1) : 1;
            if (u >= base * m) continue;
            if (this.floodAt(world, e.q, e.r, day) > 0) continue;
            const sev = 0.6 + 0.4 * flotsamHash(seed, 'fsev', e.q, e.r, day);
            const span = F.days || [3, 7];
            const len = Math.round(_num(span[0], 3) + flotsamHash(seed, 'flen', e.q, e.r, day) * (_num(span[1], 7) - _num(span[0], 3)));
            // The crest runs on down the river, a day a hex, lower each time
            let q = e.q, r = e.r, s = sev;
            for (let i = 0; i <= Math.max(0, _num(F.crest, 4)) && room > 0; i++) {
                if (i > 0) {
                    const d = RiverDrift.downstream(world, q, r);
                    if (d.kind !== 'river') break;
                    q = d.q; r = d.r;
                    s *= _num(F.fall, 0.8);
                    if (s < 0.25) break;
                }
                const f = { q, r, from: day + i, until: day + i + Math.max(1, len - i) - 1, sev: Math.round(s * 100) / 100, hit: false, place: this._placeName(world, q, r) };
                st.floods.push(f);
                out.push(f);
                room--;
            }
        }
        return out;
    },

    /** The water rises at a hex: what it does there → notices */
    _hit(world, player, f, day, notices) {
        const F = this.config().floods;
        const seed = this._seed(world);
        const key = `${seed}|fhit|${f.q},${f.r}|${day}`;
        const mine = [];
        // Nets washed away or torn
        const rd = RiverDrift.state(world, false);
        if (rd && rd.nets && rd.nets.length) {
            const lost = new Set();
            for (const net of rd.nets) {
                if (net.q !== f.q || net.r !== f.r) continue;
                if (flotsamHash(key, 'net', net.id) < _num(F.washAway, 0.6) * f.sev) { lost.add(net.id); mine.push('your net was swept away'); } else if (!net.torn) { net.torn = true; mine.push('your net was torn'); }
            }
            if (lost.size) rd.nets = rd.nets.filter(n => !lost.has(n.id));
        }
        // Crops drowned
        const plot = player && player.farmPlots && player.farmPlots[`${f.q},${f.r}`];
        if (plot && plot.cells) {
            let drowned = 0;
            for (const [ck, cell] of Object.entries(plot.cells)) {
                if (!cell || !cell.crop || cell.dead) continue;
                if (flotsamHash(key, 'crop', ck) < _num(F.drown, 0.5) * f.sev) { cell.dead = 'flood'; drowned++; }
            }
            if (drowned) mine.push(`${drowned} of your crop${drowned === 1 ? '' : 's'} drowned in the field`);
        }
        const t = this._tile(world, f.q, f.r);
        const s = t && t.settlement;
        if (s) {
            // Houses of the player's in the town take the water
            for (const h of (player && player.lotHoldings) || []) {
                if (!h || h.kind !== 'lot' || h.q !== f.q || h.r !== f.r) continue;
                const rec = LotBook.lot(s, h.id);
                const b = rec && rec.built;
                if (!b || b.kind !== 'house' || !LotBook.isPlayer(rec)) continue;
                if (flotsamHash(key, 'house', h.id) >= _num(F.houseChance, 0.5) * f.sev) continue;
                b.readyDay = Math.max(_num(b.readyDay), day + Math.max(1, _num(F.repairDays, 6)));
                mine.push(`the water got into your house there: ${F.repairDays} days of repairs, and no rent till they are done`);
            }
            // The granary
            if (SettlementMarket.tracks('grain')) {
                const have = SettlementMarket.stock(s, 'grain');
                const loss = have * _num(F.grainLoss, 0.08) * f.sev;
                if (loss > 0.5) SettlementMarket.take(s, 'grain', loss);
            }
        }
        // The river brings down what it tore loose
        const n = Math.floor(_num(F.surge, 2) * f.sev * 2 + flotsamHash(key, 'surge'));
        for (let i = 0; i < n; i++) {
            const def = RiverFlotsam.pick(flotsamHash(key, 'find', i), { wet: 3, town: !!s });
            if (!def) continue;
            RiverDrift.throwIn(world, f.q, f.r, RiverFlotsam.make(def, `${key}|${i}`), day * 24 - flotsamHash(key, 'h', i) * 12, { frac: flotsamHash(key, 'fr', i) * 0.8 });
        }
        // Word of it
        const near = player && Number.isFinite(player.q) && world.width > 0
            ? Hex.wrappingOffsetDistance(player.q, player.r, f.q, f.r, world.width) <= _num(F.noticeReach, 6) : false;
        if (mine.length) notices.push({ icon: '🌊', title: 'Flood', text: `The river is over its banks ${f.place}: ${mine.join('; ')}.`, type: 'warning' });
        else if (near && !notices.some(n => n.title === 'The River in Flood')) notices.push({ icon: '🌊', title: 'The River in Flood', text: `The spring flood is up ${f.place}: brown water over the banks, the fields under it, wrack coming down.`, type: 'info' });
    },

    _floodsDay(world, player, day, notices) {
        const st = this.state(world);
        st.floods = st.floods.filter(f => f.until >= day);
        this._raiseFloods(world, day, st);
        for (const f of st.floods) {
            if (f.hit || f.from > day) continue;
            f.hit = true;
            this._hit(world, player, f, day, notices);
        }
    },

    // ── The day ─────────────────────────────────────────

    /**
     * The daily tick (ui/game/endDay.js, after the nets have fished):
     * floods, bailiffs and poachers, fish going off. → { notices }
     */
    processDay(world, player, day = null) {
        const notices = [];
        const cfg = this.config();
        if (!cfg.enabled || !world) return { notices };
        const d = day == null ? this._day(world) : day;
        this.markWaterside(world);
        this._floodsDay(world, player, d, notices);
        this._netsDay(world, player, d, notices);
        this._fishDay(world, player, d, notices);
        this._boatDay(world, player, notices);
        return { notices: notices.slice(0, 4) };
    },

    /**
     * Carried off the water while aboard (taken, sent, set down elsewhere): the
     * boat stays moored where it last was, and you are ashore.
     */
    _boatDay(world, player, notices) {
        const b = player && player.riverBoat;
        if (!b || !b.aboard || !Number.isFinite(player.q)) return;
        if (b.q === player.q && b.r === player.r) return;
        b.aboard = false;
        notices.push({ icon: '⚓', title: 'Your Boat', text: `Your boat lies moored ${this._placeName(world, b.q, b.r)}, where you left the water.`, type: 'info' });
    },

    serialize(world) {
        const st = this.state(world, false);
        if (!st || (!st.leases.length && !st.floods.length)) return null;
        return JSON.parse(JSON.stringify(st));
    },

    restore(data, world) {
        if (!world) return;
        if (data && typeof data === 'object') {
            world.riverLife = {
                seq: _num(data.seq),
                leases: Array.isArray(data.leases) ? data.leases.filter(l => l && Number.isFinite(l.q) && Number.isFinite(l.until)) : [],
                floods: Array.isArray(data.floods) ? data.floods.filter(f => f && Number.isFinite(f.q) && Number.isFinite(f.until)) : [],
            };
        } else {
            world.riverLife = { seq: 0, leases: [], floods: [] };
        }
    },
};
