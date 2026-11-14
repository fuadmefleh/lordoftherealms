// ============================================
// RIVER NETS — the player's nets, set and left to fish
// ============================================
// A fishing net (the good 'fishing_net': knotted from rope at a craft bench,
// or bought from a chandler) set across a river on the street map, or out in
// a pond, a lake or the sea, stays where it was set — on the world, saved —
// and fishes while the player is away:
//
//   • across a river it catches what the current brings down into it, like a
//     weir of the player's own (systems/riverDrift.js advance: the river's own
//     flotsam, systems/riverFlotsam.js, and anything thrown in upstream), till
//     it holds nets.cap things and the rest slips by;
//   • in still water it gathers what was thrown in near it;
//   • every net takes fish day by day (the fish of its water: nets.fish), and
//     a river net snags a stray find now and then. Fish left too long in it
//     are lost (eels, crabs, rot).
//
// Nets wear: one can tear (more in a storm, more the longer it has been in
// the water) and catch nothing till mended with a rope; one left alone may be
// stolen, more readily near a town. Rolls are hashes of the world's seed, the
// net and the day — no RNG streams. The days are caught up to catchUpDays
// when time passes at a stroke. State: world.riverDrift.nets (riverDrift.js
// serializes it). Settings: data/riverDrift.json "nets".
//
// Net: { id, q, r, water: 'river' | 'pond' | 'lake' | 'sea', still, cell: { x, y }
//        (the street-map cell it was set from), run, k (its place down the
//        street map's river run), frac (0..1 down the hex's river), laid (hour),
//        lastDay, catch: [{ itemId, name, icon, qty, since (hour), fish?, … }],
//        torn, place }

import { RiverDrift } from './riverDrift.js';
import { RiverFlotsam, flotsamHash } from './riverFlotsam.js';
import { Hex } from '../core/hex.js';

const DEFAULTS = {
    enabled: true,
    maxNets: 6,
    cap: 16,
    fishRolls: 3,
    fishChance: 0.4,
    seasonMult: { spring: 1.1, summer: 1, autumn: 1, winter: 0.4 },
    snagChance: 0.2,
    fishKeepDays: 3,
    tearChance: 0.008,
    ageDays: 90,
    stormMult: 4,
    theftChance: 0.004,
    townTheft: 0.015,
    mendCost: { rope: 1 },
    stillReach: 4,
    reach: 3,
    catchUpDays: 30,
    fish: {},
    perishable: [],
};

const WATERS = ['river', 'pond', 'lake', 'sea'];
const _num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export const RiverNets = {
    _cfgSrc: null,
    _cfg: null,

    config() {
        const src = RiverDrift.config().nets;
        if (this._cfgSrc !== src || !this._cfg) {
            this._cfgSrc = src;
            const c = { ...DEFAULTS, ...(src || {}) };
            c.seasonMult = { ...DEFAULTS.seasonMult, ...((src && src.seasonMult) || {}) };
            this._cfg = c;
        }
        return this._cfg;
    },

    /** The player's nets (made when asked) */
    list(world) {
        const st = RiverDrift.state(world, true);
        return st ? st.nets : [];
    },

    at(world, q, r) {
        return RiverDrift.netAt(world, q, r);
    },

    find(world, id) {
        const st = RiverDrift.state(world, false);
        return st && st.nets ? st.nets.find(n => n.id === id) || null : null;
    },

    /** The name of where a net is (the town by it, else the land) */
    placeName(world, q, r) {
        const t = RiverDrift._tile(world, q, r);
        if (t && t.settlement && t.settlement.name) return `at ${t.settlement.name}`;
        for (const n of Hex.neighbors(q, r)) {
            const nt = RiverDrift._tile(world, n.q, n.r);
            if (nt && nt.settlement && nt.settlement.name) return `near ${nt.settlement.name}`;
        }
        const id = t && t.terrain && t.terrain.id;
        return id ? `in the ${String(id).replace(/_/g, ' ')}` : 'out in the wilds';
    },

    /**
     * Set a net from the packs on hex (q, r).
     * spot: { water, cell: { x, y }, run, k, frac } — where on the street map.
     * → { ok, net?, reason? }
     */
    lay(world, player, q, r, spot, now) {
        const cfg = this.config();
        if (!cfg.enabled) return { ok: false, reason: 'Nets are not in use.' };
        if (!world || !player) return { ok: false, reason: 'Nobody to set it.' };
        const inv = player.inventory || {};
        if (!(inv.fishing_net > 0)) return { ok: false, reason: 'You have no fishing net.' };
        if (this.at(world, q, r)) return { ok: false, reason: 'You already have a net set here.' };
        const st = RiverDrift.state(world);
        if (st.nets.length >= cfg.maxNets) return { ok: false, reason: `You can tend no more than ${cfg.maxNets} nets.` };
        const water = WATERS.includes(spot && spot.water) ? spot.water : 'river';
        if (water === 'river' && !RiverDrift.isRiverHex(RiverDrift._tile(world, q, r))) return { ok: false, reason: 'There is no river here.' };
        inv.fishing_net--;
        if (inv.fishing_net <= 0) delete inv.fishing_net;
        st.netSeq = (Number(st.netSeq) || 0) + 1;
        const net = {
            id: `net${st.netSeq}`,
            q, r, water, still: water !== 'river',
            cell: spot && spot.cell ? { x: spot.cell.x, y: spot.cell.y } : { x: 0, y: 0 },
            run: Number.isInteger(spot && spot.run) ? spot.run : 0,
            k: _num(spot && spot.k, 0),
            frac: Math.max(0, Math.min(1, _num(spot && spot.frac, 0.5))),
            laid: now,
            lastDay: Math.floor(now / 24),
            catch: [],
            torn: false,
            place: this.placeName(world, q, r),
        };
        st.nets.push(net);
        return { ok: true, net };
    },

    /** How many things are in it */
    count(net) {
        return net && net.catch ? net.catch.length : 0;
    },

    /**
     * Take what is in a net into the packs (as much as they hold).
     * → { ok, got: [{ itemId, name, icon, qty }], coins, notes: [text], left }
     */
    haul(world, player, id) {
        const net = this.find(world, id);
        if (!net) return { ok: false, reason: 'The net is gone.' };
        const got = [], notes = [], keep = [];
        let coins = 0;
        for (const e of net.catch || []) {
            const res = RiverFlotsam.receive(world, player, e, net);
            if (!res.ok) { keep.push(e); continue; }
            got.push({ itemId: e.itemId, name: e.name, icon: e.icon, qty: e.qty || 1 });
            coins += res.coins || 0;
            if (res.note) notes.push(res.note);
        }
        net.catch = keep;
        return { ok: true, got, coins, notes, left: keep.length, net };
    },

    /** Take the net up: its catch, and the net itself (a torn one comes up as a tangle of rope) */
    takeUp(world, player, id) {
        const res = this.haul(world, player, id);
        if (!res.ok) return res;
        if (res.left) return { ...res, ok: false, reason: 'Your packs are too full to take it all.' };
        const st = RiverDrift.state(world);
        st.nets = st.nets.filter(n => n.id !== id);
        const back = res.net.torn ? 'rope' : 'fishing_net';
        if (!player.inventory) player.inventory = {};
        player.inventory[back] = (player.inventory[back] || 0) + 1;
        return { ...res, back };
    },

    /** Mend a torn net (nets.mendCost from the packs) → { ok, reason? } */
    mend(world, player, id) {
        const net = this.find(world, id);
        if (!net) return { ok: false, reason: 'The net is gone.' };
        if (!net.torn) return { ok: false, reason: 'It is whole.' };
        const inv = (player && player.inventory) || {};
        const cost = this.config().mendCost || {};
        for (const [g, n] of Object.entries(cost)) if (!((inv[g] || 0) >= n)) return { ok: false, reason: `Mending it takes ${n} ${g.replace(/_/g, ' ')}.` };
        for (const [g, n] of Object.entries(cost)) { inv[g] -= n; if (inv[g] <= 0) delete inv[g]; }
        net.torn = false;
        return { ok: true };
    },

    _weatherAt(world, q, r, day) {
        const wx = world && world.weather;
        if (!wx || typeof wx.getWeather !== 'function') return null;
        try { return wx.getWeather(q, r, day); } catch { return null; }
    },

    _nearTown(world, q, r) {
        const t = RiverDrift._tile(world, q, r);
        if (t && t.settlement) return true;
        return Hex.neighbors(q, r).some(n => { const nt = RiverDrift._tile(world, n.q, n.r); return !!(nt && nt.settlement); });
    },

    /** One day in the water for one net. → { tore?, stolen? } */
    _day(world, net, day, ctx) {
        const cfg = this.config();
        const seed = RiverFlotsam._seed(world);
        const key = `${seed}|net|${net.id}|${day}`;
        const out = {};
        const wx = this._weatherAt(world, net.q, net.r, day);
        const storm = !!(wx && (wx.type === 'storm' || wx.type === 'blizzard'));
        // Stolen while nobody is by
        if (!ctx.here) {
            const p = ctx.town ? cfg.townTheft : cfg.theftChance;
            if (flotsamHash(key, 'theft') < p) { out.stolen = true; return out; }
        }
        // Torn
        if (!net.torn) {
            const age = Math.max(0, day - Math.floor(_num(net.laid, day * 24) / 24));
            const p = cfg.tearChance * (1 + age / Math.max(1, cfg.ageDays)) * (storm ? cfg.stormMult : 1);
            if (flotsamHash(key, 'tear') < p) {
                net.torn = true;
                out.tore = true;
                // half the catch goes out through the hole
                if (net.catch && net.catch.length) net.catch = net.catch.filter((e, i) => flotsamHash(key, 'hole', i) < 0.5);
            }
        }
        // Fish left too long are lost
        const perish = new Set(cfg.perishable || []);
        const keepH = Math.max(1, cfg.fishKeepDays) * 24;
        const dayEnd = (day + 1) * 24;
        if (net.catch && net.catch.length) net.catch = net.catch.filter(e => !(perish.has(e.itemId) && dayEnd - _num(e.since, dayEnd) > keepH));
        if (net.torn) return out;
        // The day's fish
        const season = RiverFlotsam._season(world);
        const sm = _num(cfg.seasonMult[season], 1) * (wx && wx.type === 'blizzard' ? 0.3 : 1);
        const table = (cfg.fish && cfg.fish[net.water]) || (cfg.fish && cfg.fish.river) || [];
        const tw = table.reduce((a, f) => a + _num(f.w, 0), 0);
        for (let i = 0; i < cfg.fishRolls && tw > 0; i++) {
            if (flotsamHash(key, 'fish', i) >= cfg.fishChance * sm) continue;
            let x = flotsamHash(key, 'kind', i) * tw, f = table[table.length - 1];
            for (const t of table) { x -= _num(t.w, 0); if (x < 0) { f = t; break; } }
            const lo = Math.floor(_num(f.qty && f.qty[0], 1)), hi = Math.floor(_num(f.qty && f.qty[1], lo));
            const qty = lo + Math.floor(flotsamHash(key, 'qty', i) * (Math.max(lo, hi) - lo + 1));
            const good = ctx.goodOf ? ctx.goodOf(f.item) : { name: f.item, icon: '🐟' };
            const entry = { itemId: f.item, name: good.name, icon: good.icon, qty: Math.max(1, qty), since: day * 24 + 6 + i * 4, fish: true };
            if (!RiverDrift.snare(world, entry, net, entry.since)) break;
        }
        // A stray find snagged in a river net
        if (net.water === 'river' && flotsamHash(key, 'snag') < cfg.snagChance) {
            const def = RiverFlotsam.pick(flotsamHash(key, 'snagfind'), { town: ctx.town, wet: RiverFlotsam.wetness(world, net.q, net.r, day) });
            if (def) {
                const what = RiverFlotsam.make(def, `${key}|snag`);
                RiverDrift.snare(world, { ...what }, net, day * 24 + 12);
            }
        }
        return out;
    },

    /**
     * The daily tick (ui/game/endDay.js): every net fishes the days since it
     * was last seen to (catchUpDays at most). opts.goodOf(id) → { name, icon }
     * names the fish. → { notices }
     */
    processDay(world, player, day, opts = {}) {
        const cfg = this.config();
        const st = RiverDrift.state(world, false);
        const notices = [];
        if (!cfg.enabled || !st || !st.nets || !st.nets.length || !Number.isFinite(day)) return { notices };
        const gone = new Set();
        for (const net of st.nets) {
            const from = Math.max(_num(net.lastDay, day - 1) + 1, day - Math.max(1, cfg.catchUpDays) + 1);
            const ctx = {
                here: !!(player && player.q === net.q && player.r === net.r),
                town: this._nearTown(world, net.q, net.r),
                goodOf: opts.goodOf,
            };
            for (let d = from; d <= day; d++) {
                const res = this._day(world, net, d, ctx);
                if (res.stolen) {
                    gone.add(net.id);
                    notices.push({ icon: '🥅', title: 'Net Stolen', text: `Your net ${net.place || 'by the water'} is gone, and whatever was in it. Someone helped themselves.`, type: 'warning' });
                    break;
                }
                if (res.tore) notices.push({ icon: '🥅', title: 'Net Torn', text: `Your net ${net.place || 'by the water'} has torn${d === day ? '' : ' while you were away'}. It will catch nothing till it is mended.`, type: 'info' });
            }
            net.lastDay = day;
        }
        if (gone.size) st.nets = st.nets.filter(n => !gone.has(n.id));
        return { notices: notices.slice(0, 2) };
    },
};
