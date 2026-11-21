// ============================================
// FISH TRAPS — wicker baskets set in the edge water, checked later
// ============================================
// A wicker fish trap (the good 'fish_trap': woven from reeds or willow withies
// at a craft bench, or bought from a chandler's stall or the market — the coin to
// the seller, like any good) is set in the edge water by a bank on the street
// map: the shallows, or water no more than bankReach cells from dry land. It
// stays where it was set — on the world, saved — and fishes hour by hour,
// whether the player is by or not:
//
//   • one fish an hour at most, with a chance by its water (perHour), the
//     hour (dawn and dusk are the feeding times), the season (few in winter,
//     none while the water is frozen over: world/streetSeasons.js), a river's
//     current (the fish run along the bank into the mouth) and bait in it
//     (bread, meat, a cut-up fry… from the packs: it lasts baitHours);
//   • the fish are the divers' species of that water (data/diving.json
//     fish.species, by weight), landed as the goods of speciesItem — fish
//     come new into the world from the wild, as a line's do; now and then a
//     crayfish instead;
//   • a full trap (cap catches) takes no more till it is hauled up.
//
// Losses, once a day (hash rolls: no RNG streams): a poacher at night takes
// the catch (more near a town, more the longer it is left unchecked) — the
// fish go to the thief's household, sold on in the nearest town's market;
// now and then he takes the trap too. On the street map you may see him at
// it in the dark: come near and he runs, the fish left (poacherAt, scare). An
// otter raids the catch and tears the wicker; a river in flood (systems/
// riverLife.js) washes a trap away; the wicker wears and in the end falls
// apart until mended with reeds.
//
// State: world.fishTraps = { seq, traps: [trap] } (saved: systems/saveLoad.js).
// trap = { id, q, r (world hex), x, y (street-map cell), water, current,
//          set (hour), lastHour, checked (hour), bait: { item, until } | null,
//          catch: [{ itemId, species, qty }], wear (0..1), place, news: [] }
// Settings: data/fishTraps.json. The street map's half: ui/innerMapFishTraps.js.

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { PlayerInventory } from '../core/inventory.js';
import { Seasons } from '../world/seasons.js';
import { StreetSeasons } from '../world/streetSeasons.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { flotsamHash } from './riverFlotsam.js';
import { RiverLife } from './riverLife.js';

const DEFAULTS = {
    enabled: true,
    maxTraps: 8,
    perHex: 4,
    spacing: 2,
    bankReach: 1,
    reach: 2,
    cap: 6,
    catchUpDays: 20,
    perHour: { river: 0.05, lake: 0.035, pond: 0.04, sea: 0.03 },
    current: 1.4,
    hours: { dawn: [4, 8, 2.2], dusk: [17, 21, 2], night: [21, 4, 1], day: [8, 17, 0.5] },
    seasons: { spring: 1.1, summer: 1, autumn: 0.85, winter: 0.25 },
    baitMult: 1.9,
    baitHours: 36,
    baits: { bread: 'a heel of bread', meat: 'a scrap of meat' },
    speciesItem: {},
    speciesName: {},
    crayfish: 0.18,
    wearPerDay: 0.012,
    mendCost: { reeds: 2 },
    poach: { chance: 0.05, townMult: 2.5, ageDays: 6, takeTrap: 0.15 },
    scareReach: 5,
    otter: { chance: 0.03, townMult: 0.3, otterEats: 0.6, otterWear: 0.15 },
    flood: 0.7,
};

const WATERS = ['river', 'lake', 'pond', 'sea'];
const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _iced = t => !!(t && t.subTerrain && (t.subTerrain.frozen || /frozen|ice/.test(t.subTerrain.id || '')));

/** Water a trap can stand in: wet, open, nothing built over it, not ice */
function _trapWater(t) {
    return !!(t && (t._wet || t._sea) && !t._bridge && !t._pier && !t._deck && !t._ford
        && !t.isRoad && !t.customObject && !t.customObjectPart && !t.building && !_iced(t));
}

/** Dry land a bank is made of (not water of any kind, not a pier or a deck) */
function _dry(t) {
    return !!(t && !t._wet && !t._sea && !t._pier && !t._deck && !t._bridge);
}

function _inHours(h, span) {
    const a = span[0], b = span[1];
    return a <= b ? h >= a && h < b : h >= a || h < b;
}

function _seed(world) {
    const gp = world && world.generationParams;
    return (gp && gp.seed != null ? gp.seed : (world && world.seed)) || 0;
}

function _tile(world, q, r) {
    return world && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
}

export const FishTraps = {
    _cfgSrc: undefined,
    _cfg: null,

    config() {
        const g = DataLoader._gamedata;
        const src = g && g.fishTraps;
        if (this._cfgSrc !== src || !this._cfg) {
            this._cfgSrc = src;
            const o = src || {};
            this._cfg = {
                ...DEFAULTS, ...o,
                perHour: { ...DEFAULTS.perHour, ...(o.perHour || {}) },
                hours: { ...DEFAULTS.hours, ...(o.hours || {}) },
                seasons: { ...DEFAULTS.seasons, ...(o.seasons || {}) },
                poach: { ...DEFAULTS.poach, ...(o.poach || {}) },
                otter: { ...DEFAULTS.otter, ...(o.otter || {}) },
            };
        }
        return this._cfg;
    },

    state(world, create = true) {
        if (!world) return null;
        if (!world.fishTraps || !Array.isArray(world.fishTraps.traps)) {
            if (!create) return null;
            world.fishTraps = { seq: 0, traps: [] };
        }
        return world.fishTraps;
    },

    list(world) {
        const st = this.state(world, false);
        return st ? st.traps : [];
    },

    /** The traps on world hex (q, r) */
    at(world, q, r) {
        return this.list(world).filter(t => t.q === q && t.r === r);
    },

    find(world, id) {
        return this.list(world).find(t => t.id === id) || null;
    },

    /** The trap of yours within `within` cells of cell (x, y) on hex (q, r), or null */
    near(world, q, r, x, y, within = 1) {
        let best = null, bd = Infinity;
        for (const t of this.at(world, q, r)) {
            const d = Math.max(Math.abs(t.x - x), Math.abs(t.y - y));
            if (d <= within && d < bd) { bd = d; best = t; }
        }
        return best;
    },

    /** The name of where a trap is (the town by it, else the land) */
    placeName(world, q, r) {
        const t = _tile(world, q, r);
        if (t && t.settlement && t.settlement.name) return `at ${t.settlement.name}`;
        for (const n of Hex.neighbors(q, r)) {
            const nt = _tile(world, n.q, n.r);
            if (nt && nt.settlement && nt.settlement.name) return `near ${nt.settlement.name}`;
        }
        return 'by the water';
    },

    // ── Where one can go ──

    /**
     * Can a trap be set at cell (x, y) of a street map's tiles? Edge water only:
     * the shallows, or open water within bankReach cells of dry land or the shallows — not deep
     * out, not on land, ice, a ford, a bridge or a pier. opts.traps: the traps
     * already on this map (kept spacing apart).
     * → { ok, water, current, why }
     */
    spotAt(tiles, x, y, opts = {}) {
        const cfg = this.config();
        const H = tiles ? tiles.length : 0, W = H ? tiles[0].length : 0;
        const t = x >= 0 && y >= 0 && x < W && y < H ? tiles[y][x] : null;
        if (!t) return { ok: false, why: 'nowhere' };
        if (_iced(t) && (t._wet || t._sea || t._ssOrigSub)) return { ok: false, why: 'the water is frozen over' };
        if (!(t._wet || t._sea)) return { ok: false, why: 'not in water' };
        if (!_trapWater(t)) return { ok: false, why: t._ford ? 'not on the ford' : 'not under that' };
        const reach = Math.max(1, Math.floor(_num(cfg.bankReach, 1)));
        let bank = !!t._shallow;
        for (let d = 1; d <= reach && !bank; d++) {
            for (let dy = -d; dy <= d && !bank; dy++) {
                for (let dx = -d; dx <= d; dx++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
                    const nx = x + dx, ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                    // (the shallows are the bank's own edge: the water just off them is edge water too)
                    const n = tiles[ny][nx];
                    if (_dry(n) || (n && n._shallow)) { bank = true; break; }
                }
            }
        }
        if (!bank) return { ok: false, why: 'too far out: set it in the edge water by a bank' };
        const sp = Math.max(0, _num(cfg.spacing, 2));
        for (const o of opts.traps || []) {
            if (Math.max(Math.abs(o.x - x), Math.abs(o.y - y)) < sp) return { ok: false, why: 'too close to your other trap' };
        }
        let water = t._waterKind || (t._sea ? 'sea' : 'pond');
        if (!WATERS.includes(water)) water = 'pond';
        // A river's current: this cell's flow, or the channel's beside it
        let current = water === 'river' && !!(t._flow && (t._flow.x || t._flow.y));
        if (water === 'river' && !current) {
            for (const [dx, dy] of N8) {
                const n = tiles[y + dy] && tiles[y + dy][x + dx];
                if (n && n._flow && (n._flow.x || n._flow.y)) { current = true; break; }
            }
        }
        return { ok: true, water, current, why: null };
    },

    // ── Setting, baiting, hauling ──

    /**
     * Set a trap from the packs at cell (x, y) of world hex (q, r).
     * spot: spotAt's answer. → { ok, trap?, reason? }
     */
    lay(world, player, q, r, x, y, spot, now) {
        const cfg = this.config();
        if (!cfg.enabled) return { ok: false, reason: 'Fish traps are not in use.' };
        if (!world || !player) return { ok: false, reason: 'Nobody to set it.' };
        const inv = player.inventory || {};
        if (!(_num(inv.fish_trap) >= 1)) return { ok: false, reason: 'You have no fish trap.' };
        if (!spot || !spot.ok) return { ok: false, reason: `Not there: ${(spot && spot.why) || 'no water for a trap'}.` };
        const st = this.state(world);
        if (st.traps.length >= cfg.maxTraps) return { ok: false, reason: `You can tend no more than ${cfg.maxTraps} traps.` };
        const here = this.at(world, q, r);
        if (here.length >= cfg.perHex) return { ok: false, reason: `You have ${cfg.perHex} traps set on this stretch already.` };
        const sp = Math.max(0, _num(cfg.spacing, 2));
        if (here.some(o => Math.max(Math.abs(o.x - x), Math.abs(o.y - y)) < sp)) return { ok: false, reason: 'Too close to your other trap.' };
        inv.fish_trap -= 1;
        if (inv.fish_trap <= 0) delete inv.fish_trap;
        st.seq = _num(st.seq) + 1;
        const h = Math.floor(_num(now));
        const trap = {
            id: `trap${st.seq}`, q, r, x, y,
            water: WATERS.includes(spot.water) ? spot.water : 'pond',
            current: !!spot.current,
            set: h, lastHour: h, checked: h,
            bait: null, catch: [], wear: 0,
            place: this.placeName(world, q, r),
            news: [],
        };
        st.traps.push(trap);
        return { ok: true, trap };
    },

    /** How many fish are in it */
    count(trap) {
        let n = 0;
        for (const e of (trap && trap.catch) || []) n += Math.max(1, _num(e.qty, 1));
        return n;
    },

    isFull(trap) {
        return this.count(trap) >= Math.max(1, _num(this.config().cap, 6));
    },

    isBroken(trap) {
        return _num(trap && trap.wear) >= 1;
    },

    /** The baits in the packs: [{ id, what, have }] */
    baitsInPacks(player) {
        const baits = this.config().baits || {};
        const inv = (player && player.inventory) || {};
        return Object.keys(baits).filter(id => id !== '_doc' && _num(inv[id]) >= 1).map(id => ({ id, what: baits[id], have: Math.floor(_num(inv[id])) }));
    },

    /** Bait a trap with one `itemId` from the packs. → { ok, reason? } */
    bait(world, player, id, itemId, now) {
        const cfg = this.config();
        const trap = this.find(world, id);
        if (!trap) return { ok: false, reason: 'The trap is gone.' };
        if (!cfg.baits || !cfg.baits[itemId]) return { ok: false, reason: 'That makes no bait.' };
        const inv = (player && player.inventory) || {};
        if (!(_num(inv[itemId]) >= 1)) return { ok: false, reason: 'You have none of that left.' };
        this.settle(world, trap, now);
        inv[itemId] -= 1;
        if (inv[itemId] <= 0) delete inv[itemId];
        trap.bait = { item: itemId, until: Math.floor(_num(now)) + Math.max(1, Math.round(_num(cfg.baitHours, 36))) };
        return { ok: true, what: cfg.baits[itemId] };
    },

    /** Is the trap baited at hour h? */
    baited(trap, h) {
        return !!(trap && trap.bait && h < _num(trap.bait.until, -1));
    },

    /**
     * Haul the trap up and take what is in it into the packs (as much as they
     * hold; the rest stays in it). The trap goes back in the water.
     * → { ok, got: { itemId: qty }, left, news: [text] }
     */
    haul(world, player, id, now) {
        const trap = this.find(world, id);
        if (!trap) return { ok: false, reason: 'The trap is gone.' };
        if (now != null) this.settle(world, trap, now);
        const got = {}, keep = [];
        for (const e of trap.catch || []) {
            const n = Math.max(1, _num(e.qty, 1));
            const res = PlayerInventory.addItem(player, e.itemId, n);
            if (!res.success) { keep.push(e); continue; }
            got[e.itemId] = _num(got[e.itemId]) + n;
        }
        trap.catch = keep;
        if (now != null) trap.checked = Math.floor(_num(now));
        const news = (trap.news || []).slice(-3);
        trap.news = [];
        return { ok: true, got, left: this.count(trap), news, trap };
    },

    /** Take the trap up: its catch, and the trap itself back into the packs (a broken one comes up as reeds) */
    takeUp(world, player, id, now) {
        const res = this.haul(world, player, id, now);
        if (!res.ok) return res;
        if (res.left) return { ...res, ok: false, reason: 'Your packs are too full to take it all.' };
        const back = this.isBroken(res.trap) ? 'reeds' : 'fish_trap';
        if (!PlayerInventory.canAdd(player, back)) return { ...res, ok: false, reason: PlayerInventory.fullMessage(player) };
        const st = this.state(world);
        st.traps = st.traps.filter(t => t.id !== id);
        PlayerInventory.addItem(player, back, back === 'reeds' ? 2 : 1);
        // (a lantern hung at it comes back with it: systems/carriedLight.js)
        if (res.trap.lantern) { delete res.trap.lantern; PlayerInventory.addItem(player, 'lantern', 1, { force: true }); }
        return { ...res, back };
    },

    /** Mend a worn trap (mendCost from the packs) → { ok, reason? } */
    mend(world, player, id) {
        const trap = this.find(world, id);
        if (!trap) return { ok: false, reason: 'The trap is gone.' };
        if (_num(trap.wear) < 0.5) return { ok: false, reason: 'It is sound enough.' };
        const inv = (player && player.inventory) || {};
        const cost = this.config().mendCost || {};
        for (const [g, n] of Object.entries(cost)) if (!(_num(inv[g]) >= n)) return { ok: false, reason: `Mending it takes ${n} ${g.replace(/_/g, ' ')}.` };
        for (const [g, n] of Object.entries(cost)) { inv[g] -= n; if (inv[g] <= 0) delete inv[g]; }
        trap.wear = 0;
        return { ok: true };
    },

    // ── The catch, hour by hour ──

    /** The hour's draw on the fish: its span's multiplier */
    hourMult(h) {
        const hours = this.config().hours || {};
        const hod = ((Math.floor(h) % 24) + 24) % 24;
        for (const k of ['dawn', 'dusk', 'night', 'day']) {
            const s = hours[k];
            if (Array.isArray(s) && s.length >= 3 && _inHours(hod, s)) return _num(s[2], 1);
        }
        return 1;
    },

    _seasonOf(world, day) {
        if (world && Number.isFinite(world.day)) return Seasons.seasonOf(Math.max(1, day)).toLowerCase();
        return String((world && world.season) || 'summer').toLowerCase();
    },

    seasonMult(world, day) {
        const s = this._seasonOf(world, day);
        const m = this.config().seasons || {};
        for (const k in m) if (k !== '_doc' && s.includes(k)) return _num(m[k], 1);
        return 1;
    },

    /** Is the trap's water frozen over on this day? (ctx.frozen overrides: the street map's own ice) */
    _frozen(world, trap, day, ctx) {
        if (ctx && typeof ctx.frozen === 'function') {
            const v = ctx.frozen(trap, day);
            if (v != null) return !!v;
        }
        if (trap.water === 'sea') return false;
        if (!/winter|autumn|spring/.test(this._seasonOf(world, day))) return false;
        if (!world || typeof world.getTile !== 'function' || !world.getTile(trap.q, trap.r)) return false;
        try {
            const st = StreetSeasons.state(world, trap.q, trap.r, day);
            return !!st && StreetSeasons.iceOn(st, trap.water).state !== 'none';
        } catch { return false; }
    },

    /** The chance of a fish in hour h (before cap, wear and ice) */
    chanceAt(world, trap, h) {
        const cfg = this.config();
        const day = Math.floor(h / 24);
        let p = _num(cfg.perHour[trap.water], 0.03) * this.hourMult(h) * this.seasonMult(world, day);
        if (trap.water === 'river' && trap.current) p *= _num(cfg.current, 1);
        if (this.baited(trap, h)) p *= _num(cfg.baitMult, 1);
        return Math.max(0, Math.min(0.95, p));
    },

    /** One fish of the trap's water (hashed): { itemId, species } */
    _pickFish(world, trap, h) {
        const cfg = this.config();
        const key = `${_seed(world)}|ft|${trap.id}|${h}`;
        if (trap.water !== 'sea' && flotsamHash(key, 'cray') < _num(cfg.crayfish, 0)) return { itemId: 'crayfish', species: 'crayfish' };
        const g = DataLoader._gamedata;
        const list = ((g && g.diving && g.diving.fish && g.diving.fish.species) || []).filter(s => !s.waters || s.waters.includes(trap.water));
        const map = cfg.speciesItem || {};
        let total = 0;
        for (const s of list) total += Math.max(0, _num(s.weight, 1));
        if (!total) return { itemId: 'fish', species: 'fish' };
        let x = flotsamHash(key, 'sp') * total, pick = list[list.length - 1];
        for (const s of list) { x -= Math.max(0, _num(s.weight, 1)); if (x < 0) { pick = s; break; } }
        return { itemId: map[pick.id] || 'fish', species: pick.id };
    },

    _addCatch(trap, f) {
        const e = trap.catch.find(c => c.itemId === f.itemId && c.species === f.species);
        if (e) e.qty = Math.max(1, _num(e.qty, 1)) + 1;
        else trap.catch.push({ itemId: f.itemId, species: f.species, qty: 1 });
    },

    _note(trap, text) {
        if (!trap.news) trap.news = [];
        trap.news.push(text);
        if (trap.news.length > 6) trap.news.shift();
    },

    /** The nearest town to a hex (on it, or beside it) → settlement or null */
    townNear(world, q, r) {
        const t = _tile(world, q, r);
        if (t && t.settlement) return t.settlement;
        for (const n of Hex.neighbors(q, r)) {
            const nt = _tile(world, n.q, n.r);
            if (nt && nt.settlement) return nt.settlement;
        }
        return null;
    },

    /** The hour of the night (day d) a poacher would come: 22:00 to 03:00 */
    poachHour(world, trap, d) {
        return d * 24 + 22 + Math.floor(flotsamHash(`${_seed(world)}|ftph|${trap.id}|${d}`) * 6);
    },

    /** The chance a poacher robs this trap on night d */
    poachChance(world, trap, d) {
        const P = this.config().poach || {};
        const days = Math.max(0, d - Math.floor(_num(trap.checked, d * 24) / 24));
        let p = _num(P.chance) * (1 + days / Math.max(1, _num(P.ageDays, 6)));
        if (this.townNear(world, trap.q, trap.r)) p *= _num(P.townMult, 1);
        return Math.min(0.9, p);
    },

    /** Is a poacher at this trap in hour h (one with fish in it)? → the night's day, or -1 */
    poacherAt(world, trap, h) {
        if (!trap || !trap.catch || !trap.catch.length) return -1;
        const hh = Math.floor(h);
        // A lantern hung at it, burning (systems/carriedLight.js hangLantern): no poacher comes near
        const lan = trap.lantern;
        if (lan && hh >= Math.floor(_num(lan.from)) && hh < _num(lan.until)) return -1;
        for (const d of [Math.floor(hh / 24), Math.floor(hh / 24) - 1]) {
            if (this.poachHour(world, trap, d) !== hh) continue;
            if (flotsamHash(`${_seed(world)}|ftp|${trap.id}|${d}`) < this.poachChance(world, trap, d)) return d;
        }
        return -1;
    },

    /** You came on the poacher at his work in hour h: he runs, the fish left */
    scare(world, trap, h) {
        if (!trap) return false;
        trap.scared = Math.floor(h);
        return true;
    },

    /** The poacher's haul: the fish to his household (sold on in the town's market); maybe the trap too */
    _rob(world, trap, d, out) {
        const P = this.config().poach || {};
        const town = this.townNear(world, trap.q, trap.r);
        let qty = 0;
        for (const e of trap.catch) {
            const n = Math.max(1, _num(e.qty, 1));
            qty += n;
            if (town && SettlementMarket.tracks(e.itemId)) SettlementMarket.add(town, e.itemId, n);
            else if (town && SettlementMarket.tracks('fish')) SettlementMarket.add(town, 'fish', n);
            // (no town about: a wanderer's supper)
        }
        trap.catch = [];
        const who = this._thief(world, town, `${trap.id}|${d}`);
        const takeTrap = flotsamHash(`${_seed(world)}|fttk|${trap.id}|${d}`) < _num(P.takeTrap);
        if (takeTrap) {
            if (town && SettlementMarket.tracks('fish_trap')) SettlementMarket.add(town, 'fish_trap', 1);
            // (and the lantern hung at it, burnt out, with it)
            if (trap.lantern && town && SettlementMarket.tracks('lantern')) SettlementMarket.add(town, 'lantern', 1);
            out.gone = true;
        }
        const name = who ? `${who}${town ? ` of ${town.name}` : ''}` : 'Someone';
        const text = takeTrap
            ? `Your fish trap ${trap.place || 'by the water'} is gone, fish and all. ${name} had it away in the night${town ? '; the fish went to market' : ''}.`
            : `${name} had been at your trap ${trap.place || 'by the water'} in the night: ${qty} fish gone${town ? ', sold on in the market' : ''}.`;
        out.notices.push({ icon: '🧺', title: takeTrap ? 'Trap Stolen' : 'Trap Robbed', text, type: 'warning' });
        if (!takeTrap) this._note(trap, `${name} had been at it in the night (${qty} fish gone).`);
        trap.poached = _num(trap.poached) + qty;
    },

    /** A name for the thief: a living grown townsman from the town's roster (systems/townsfolk.js), or none */
    _thief(world, town, key) {
        const people = town && town.folk && Array.isArray(town.folk.people) ? town.folk.people : [];
        const day = _num(world && world.day, 0);
        const adults = people.filter(p => p && !p.died && !p.away && p.first && Number.isFinite(p.born) && day - p.born >= 16 * 120);
        const pool = adults.length ? adults : people.filter(p => p && !p.died && p.first);
        if (!pool.length) return null;
        const p = pool[Math.floor(flotsamHash(`${_seed(world)}|ftwho|${key}`) * pool.length) % pool.length];
        return `${p.first}${p.last ? ` ${p.last}` : ''}`;
    },

    /** The day's other losses (at the day's turn): wear, an otter, a flood. → true when the trap is gone */
    _dayLosses(world, trap, d, out) {
        const cfg = this.config();
        const key = `${_seed(world)}|ftd|${trap.id}|${d}`;
        // A river in flood takes it
        if (trap.water === 'river') {
            let sev = 0;
            try { sev = RiverLife.floodAt(world, trap.q, trap.r, d); } catch { sev = 0; }
            if (sev > 0 && flotsamHash(key, 'flood') < _num(cfg.flood) * sev) {
                out.notices.push({ icon: '🌊', title: 'Trap Washed Away', text: `The river in flood has taken your fish trap ${trap.place || 'by the water'}, and all in it.`, type: 'warning' });
                return true;
            }
        }
        // The wicker wears
        const was = _num(trap.wear);
        trap.wear = Math.min(1, was + Math.max(0, _num(cfg.wearPerDay)));
        // An otter at the catch
        const O = cfg.otter || {};
        if (trap.catch.length && trap.water !== 'sea') {
            const p = _num(O.chance) * (this.townNear(world, trap.q, trap.r) ? _num(O.townMult, 1) : 1);
            if (flotsamHash(key, 'otter') < p) {
                const n = this.count(trap);
                let eat = Math.max(1, Math.ceil(n * _num(O.otterEats, 0.5)));
                const ate = eat;
                for (const e of trap.catch) { const k = Math.min(eat, Math.max(1, _num(e.qty, 1))); e.qty = Math.max(1, _num(e.qty, 1)) - k; eat -= k; if (eat <= 0) break; }
                trap.catch = trap.catch.filter(e => e.qty > 0);
                trap.wear = Math.min(1, trap.wear + _num(O.otterWear));
                this._note(trap, `An otter has been at it: ${ate} fish eaten, the wicker torn.`);
            }
        }
        if (was < 1 && trap.wear >= 1) {
            out.notices.push({ icon: '🧺', title: 'Trap Fallen Apart', text: `Your fish trap ${trap.place || 'by the water'} has come apart in the water. It will take nothing till it is mended with reeds.`, type: 'info' });
            this._note(trap, 'The wicker has come apart.');
        }
        return false;
    },

    /**
     * Bring a trap up to hour `now`: each hour since it was last seen to
     * (catchUpDays at most) its chance of a fish, its night's poacher, its
     * day's wear, otter and flood. ctx.frozen(trap, day) → true/false/null
     * (the street map's ice). → { notices, gone }
     */
    settle(world, trap, now, ctx = {}) {
        const out = { notices: [], gone: false };
        const cfg = this.config();
        if (!trap || !cfg.enabled || !Number.isFinite(now)) return out;
        const end = Math.floor(now);
        let h = Math.max(Math.floor(_num(trap.lastHour, end)), end - Math.max(1, cfg.catchUpDays) * 24);
        const cap = Math.max(1, _num(cfg.cap, 6));
        let frozenDay = null, frozen = false;
        for (; h < end; h++) {
            const d = Math.floor(h / 24);
            if (h % 24 === 0 && h > _num(trap.set, -1) && this._dayLosses(world, trap, d, out)) { out.gone = true; break; }
            // The night's poacher (unless you saw him off)
            const pd = this.poacherAt(world, trap, h);
            if (pd >= 0 && trap.scared !== h) {
                this._rob(world, trap, pd, out);
                if (out.gone) break;
            }
            if (trap.bait && h >= _num(trap.bait.until, 0)) trap.bait = null;
            if (this.isBroken(trap) || this.count(trap) >= cap) continue;
            if (frozenDay !== d) { frozenDay = d; frozen = this._frozen(world, trap, d, ctx); }
            if (frozen) continue;
            if (flotsamHash(`${_seed(world)}|fth|${trap.id}|${h}`) < this.chanceAt(world, trap, h)) this._addCatch(trap, this._pickFish(world, trap, h));
        }
        trap.lastHour = Math.max(_num(trap.lastHour, end), Math.min(end, h));
        if (out.gone) {
            const st = this.state(world, false);
            if (st) st.traps = st.traps.filter(t => t !== trap);
        }
        return out;
    },

    /**
     * The daily tick (ui/game/endDay.js): every trap fishes the hours since it
     * was last seen to. opts.now: the hour to bring them to (default the day's
     * start). → { notices }
     */
    processDay(world, player, day, opts = {}) {
        const notices = [];
        const st = this.state(world, false);
        if (!this.config().enabled || !st || !st.traps.length || !Number.isFinite(day)) return { notices };
        const now = Number.isFinite(opts.now) ? opts.now : day * 24;
        for (const trap of st.traps.slice()) notices.push(...this.settle(world, trap, now, opts).notices);
        return { notices: notices.slice(0, 3) };
    },

    // ── Kept with the game ──

    serialize(world) {
        const st = this.state(world, false);
        return st ? JSON.parse(JSON.stringify(st)) : null;
    },

    restore(data, world) {
        if (!world) return;
        if (data && typeof data === 'object' && Array.isArray(data.traps)) {
            world.fishTraps = { seq: _num(data.seq), traps: data.traps.filter(t => t && t.id && Number.isFinite(t.q) && Number.isFinite(t.r)).map(t => ({ catch: [], news: [], wear: 0, bait: null, ...t })) };
        } else {
            delete world.fishTraps;
        }
    },
};
