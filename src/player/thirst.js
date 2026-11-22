// ============================================
// THIRST — the player needs to drink
// ============================================
// player.water.thirst: 100 slaked .. 0 parched. It falls a world day's
// `drain` (data/water.json player), faster in heat (the tile's temperature
// with its season and the climate's era — world/climate.js — and in desert
// country), on a long march and on a day of fighting.
//
// Drinking, mostly without being told:
//   - passing water: every hex walked onto with a river, a lake beside it or a
//     town whose water runs clean (systems/water.js sourceAt) slakes you and
//     fills the skins (passHex, from Player.processMovement);
//   - at the day's end where you stand: the same;
//   - from the skins (a waterskin holds skin.draughts, a barrel in the pack
//     cask.draughts) below autoBelow;
//   - aboard ship, from her casks (ship.waterDays, systems/water.js);
//   - in a town whose wells are all foul: water carried in, bought by the
//     draught (to the town's purse: its water carriers), else ale, cider, mead,
//     wine or milk from the pack; and at the last, the foul water itself
//     (the flux: systems/ailments.js);
//   - a day of rain: a little, and a little into the skins;
//   - an inn's drink or meal (player/tavern/actions.js slake).
// On the street map a well, a pump, a fountain, a river or a lake is drunk
// from by hand (ui/innerMapWater.js); the Water panel (ui/actionMenu/water.js)
// shows it all.
//
// Parched: below parched.below the day is shorter (movement), below
// badBelow shorter still and tiring; at 0 each day costs health fast —
// death in three or four days (endDay's death 'thirst'). The player's army
// drinks from the land too: a dry day past graceDays costs it men.
//
// In jail or bound in service the captors give water. State on player.water
// (saved: { thirst, held, parched, lastSource, given, told }); transient
// counters (hexes walked, fights) on player._thirstDay. No randomness but a
// hash of the world seed for the foul water's flux.

import { DataLoader } from '../core/dataLoader.js';
import { Interrupts } from '../core/interrupts.js';
import { Utils } from '../core/utils.js';
import { Climate } from '../world/climate.js';
import { Seasons } from '../world/seasons.js';
import { WaterSources } from '../world/waterSources.js';
import { Economy } from '../world/economy.js';
import { Ailments } from '../systems/ailments.js';
import { Ships } from '../systems/ships.js';
import { Water } from '../systems/water.js';
import { HandBuilding } from '../world/handBuilding.js';
import { Ledger } from '../systems/ledger.js';
import { Trading } from './playerEconomy.js';
import { PlayerMilitary } from './playerMilitary.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = world => _num(world && world.day, 0);

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    return h >>> 0;
}
const _frac = str => _hash(str) / 4294967296;

const DEFAULTS = {
    drain: 32,
    heat: { hotAbove: 0.62, perHeat: 2.2, max: 2.2, coldBelow: 0.25, coldMult: 0.85, terrain: { desert: 1.6, savanna: 1.2 } },
    march: { hexes: 2, mult: 1.2 },
    fight: { mult: 1.15 },
    draught: 35,
    autoBelow: 70,
    skin: { good: 'waterskin', draughts: 2 },
    cask: { good: 'barrel', draughts: 12 },
    drinks: { beer: 30, cider: 30, mead: 22, wine: 22, milk: 25 },
    drinksBelow: 40,
    parched: { below: 30, moveMult: 0.8, badBelow: 12, badMoveMult: 0.6, badEnergy: 10, healthPerDay: [12, 25, 40, 60] },
    foulWater: { fluxChance: 0.55, ailment: 'flux', desperateBelow: 15 },
    rain: { thirst: 20, draughts: 1 },
    buyWater: { price: 1 },
    buySkin: { enabled: true, purseShare: 0.3, keep: 2 },
    land: { default: 0.6, terrain: { desert: 0.05, savanna: 0.35, woodland: 0.9 }, season: { Summer: 0.85 }, droughtBelow: -0.06, droughtMult: 0.5, perSkill: 0.02, skillMax: 0.15, kinds: { default: ['a stream'] } },
    startSkins: 1,
};

let _cfg = null;
let _cfgSrc;

export const Thirst = {
    DEFAULTS,

    config() {
        const src = DataLoader._gamedata && DataLoader._gamedata.water ? DataLoader._gamedata.water.player : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            const out = { ...DEFAULTS };
            for (const [k, v] of Object.entries(d)) out[k] = _obj(v) && _obj(DEFAULTS[k]) ? { ...DEFAULTS[k], ...v } : v;
            out.heat = { ...DEFAULTS.heat, ...(_obj(d.heat) || {}), terrain: { ...DEFAULTS.heat.terrain, ...((_obj(d.heat) || {}).terrain || {}) } };
            _cfg = out;
        }
        return _cfg;
    },

    /** Is thirst on for this player (the needs system on, water on)? */
    on(player) {
        return !!player && player.needsEnabled !== false && !!player.needs && Water.enabled();
    },

    /**
     * The player's water record (created on first touch: slaked, with the
     * starting waterskin(s) — everyone sets out with a skin — filled).
     */
    state(player) {
        if (!player) return null;
        if (_obj(player.water) && Number.isFinite(player.water.thirst)) {
            // (an heir takes up the life slaked: the last one's thirst died with them)
            const w0 = player.water;
            if (player.name && w0.who !== player.name) {
                if (w0.who) { w0.thirst = 100; w0.parched = 0; w0.armyDry = 0; }
                w0.who = player.name;
            }
            return w0;
        }
        const C = Thirst.config();
        const w = { thirst: 100, held: 0, parched: 0, lastSource: null, given: false, told: {}, who: player.name || null };
        if (_obj(player.water)) Object.assign(w, player.water, { thirst: _num(player.water.thirst, 100) });
        player.water = w;
        if (!w.given) {
            w.given = true;
            if (!player.inventory) player.inventory = {};
            const skin = C.skin.good;
            const want = Math.max(0, Math.floor(_num(C.startSkins, 1)));
            if (want > 0 && !(_num(player.inventory[skin]) > 0)) player.inventory[skin] = want;
            w.held = Thirst.capacity(player);
        }
        return w;
    },

    /** Thirst 0..100 (100 slaked). */
    level(player) {
        return Math.round(Thirst.on(player) ? Thirst.state(player).thirst : 100);
    },

    /** { label, icon, tone } for the HUD and panels. */
    label(player) {
        const t = Thirst.level(player);
        const P = Thirst.config().parched;
        if (t >= 70) return { label: 'Slaked', icon: '💧', tone: 'good' };
        if (t >= _num(P.below, 30)) return { label: 'Thirsty', icon: '💧', tone: '' };
        if (t > 0) return { label: t < _num(P.badBelow, 12) ? 'Parched' : 'Very thirsty', icon: '🥵', tone: 'warn' };
        return { label: 'Dying of thirst', icon: '💀', tone: 'bad' };
    },

    /** Draughts the skins and casks in the pack can hold. */
    capacity(player) {
        const C = Thirst.config();
        const inv = (player && player.inventory) || {};
        return Math.max(0, Math.floor(_num(inv[C.skin.good])) * _num(C.skin.draughts, 2) + Math.floor(_num(inv[C.cask.good])) * _num(C.cask.draughts, 12));
    },

    /** Draughts carried (never more than the skins hold). */
    held(player) {
        const w = Thirst.state(player);
        const cap = Thirst.capacity(player);
        if (w.held > cap) w.held = cap;
        return Math.max(0, w.held);
    },

    // ── Where to drink ────────────────────────────────

    /**
     * Water where the player stands: { kind: 'well'|'river'|'lake'|'ship',
     * label, foul, settlement } or null (systems/water.js sourceAt; aboard
     * ship, her casks).
     */
    sourceHere(player, world) {
        if (!player || !world) return null;
        if (player.boardedShip != null) {
            const ship = Ships.getShipById(player, player.boardedShip);
            if (ship && Water.shipWater(ship) > 0) return { kind: 'ship', label: `the casks of ${ship.name}`, foul: false, ship };
        }
        const src = Water.sourceAt(world, player.q, player.r);
        if (src && !src.foul) return src;
        // A well of your own here: dug by hand (world/handBuilding.js), or your seat's —
        // your colony, your House's seat, your crown's capital — clean whatever the town's are
        return Thirst.ownWell(player, world, player.q, player.r) || src;
    },

    /** A private well of the player's at a hex: { kind: 'well', label, foul: false, own: true } or null. */
    ownWell(player, world, q, r) {
        if (!player || !world) return null;
        try {
            if (HandBuilding.at(world, q, r).some(x => x && x.kind === 'well' && x.done)) return { kind: 'well', label: 'your own well', foul: false, own: true };
        } catch { /* no hand-built record */ }
        const tile = world.getTile(q, r);
        const s = tile && tile.settlement;
        if (!s) return null;
        const lib = player.library;
        const seat = (s.colony && s.colony.isPlayerColony) || (player.colonies || []).some(c => c && c.q === q && c.r === r)
            || !!(lib && lib.holdsSeat && lib.seat && lib.seat.q === q && lib.seat.r === r);
        let crown = false;
        const ruling = player.throne && player.throne.ruling;
        if (!seat && ruling && ruling.kingdomId != null) {
            const k = world.getKingdom ? world.getKingdom(ruling.kingdomId) : null;
            crown = !!(k && k.capital && k.capital.q === q && k.capital.r === r);
        }
        return seat || crown ? { kind: 'well', label: `the well of your seat in ${s.name}`, foul: false, own: true, settlement: s } : null;
    },

    /** Drink deep and fill the skins at clean water. → draughts filled. */
    _slakeAt(player, world, src) {
        const w = Thirst.state(player);
        w.thirst = 100;
        w.parched = 0;
        w.lastSource = _day(world);
        if (src && src.kind === 'ship') return 0;
        const before = w.held;
        w.held = Thirst.capacity(player);
        return Math.max(0, w.held - before);
    },

    /** Raise thirst by `amount` (an inn's drink, a mug at the well). */
    slake(player, amount) {
        if (!Thirst.on(player)) return 0;
        const w = Thirst.state(player);
        const before = w.thirst;
        w.thirst = Math.max(0, Math.min(100, w.thirst + _num(amount)));
        if (w.thirst > 0) w.parched = 0;
        return w.thirst - before;
    },

    /** A hex walked onto (Player.processMovement): water there slakes you and fills the skins. Cheap. */
    passHex(player, world, tile) {
        if (!Thirst.on(player) || !tile) return;
        const t = (player._thirstDay && player._thirstDay.d === _day(world)) ? player._thirstDay : (player._thirstDay = { d: _day(world), hexes: 0, fights: 0 });
        t.hexes++;
        const src = Water.sourceAt(world, tile.q, tile.r);
        if (src && !src.foul) Thirst._slakeAt(player, world, src);
    },

    /** A fight today (PlayerMilitary.combat): thirstier work. */
    exert(player, world = null) {
        if (!player) return;
        const d = world ? _day(world) : (player._thirstDay ? player._thirstDay.d : 0);
        if (!player._thirstDay || player._thirstDay.d !== d) player._thirstDay = { d, hexes: 0, fights: 0 };
        player._thirstDay.fights++;
    },

    /** Drink from the skins up to `upTo` thirst. → draughts drunk. */
    drinkCarried(player, upTo = 90) {
        const C = Thirst.config();
        const w = Thirst.state(player);
        let n = 0;
        while (w.thirst < upTo && Thirst.held(player) >= 1) {
            w.held -= 1;
            w.thirst = Math.min(100, w.thirst + _num(C.draught, 35));
            n++;
        }
        if (n) w.parched = 0;
        return n;
    },

    /** Ale, cider, mead, wine or milk from the pack. → the good drunk, or null. */
    drinkFromPack(player) {
        const C = Thirst.config();
        const inv = player.inventory || {};
        for (const [good, v] of Object.entries(C.drinks || {})) {
            if (_num(inv[good]) >= 1) {
                inv[good] -= 1;
                if (inv[good] <= 0) delete inv[good];
                Thirst.slake(player, _num(v, 25));
                return good;
            }
        }
        return null;
    },

    /** Water carried in by the town's water carriers: the price of a draught. */
    waterPrice() {
        return Math.max(0, _num(Thirst.config().buyWater.price, 1));
    },

    /** Buy a draught (or `n`) from the water carriers of a town whose wells are foul. → { success, text } */
    buyWater(player, world, n = 3) {
        const tile = world && world.getTile(player.q, player.r);
        const s = tile && tile.settlement;
        if (!s) return { success: false, reason: 'There are no water carriers here.' };
        const price = Thirst.waterPrice();
        const w = Thirst.state(player);
        const want = Math.max(1, Math.min(n, Math.ceil((100 - w.thirst) / _num(Thirst.config().draught, 35)) + Math.max(0, Thirst.capacity(player) - Thirst.held(player))));
        const k = price > 0 ? Math.min(want, Math.floor(_num(player.gold) / price)) : want;
        if (k <= 0) return { success: false, reason: `A draught of carried water costs ${Utils.formatGold(price)}g.` };
        const cost = Utils.cents(k * price);
        if (cost > 0) {
            player.gold = Utils.cents(_num(player.gold) - cost);
            Economy.payTown(s, cost);
            Ledger.record(player, 'larder', -cost);
        }
        let left = k;
        const C = Thirst.config();
        while (left > 0 && w.thirst < 95) { w.thirst = Math.min(100, w.thirst + _num(C.draught, 35)); left--; }
        w.held = Math.min(Thirst.capacity(player), w.held + left);
        w.parched = 0;
        return { success: true, cost, n: k, text: `The water carriers of ${s.name} sell you ${k} draught${k === 1 ? '' : 's'} carted in from clean wells, for ${Utils.formatGold(cost)}g.` };
    },

    /**
     * Drink where you stand (the Water panel, the street map's well or river).
     * opts: { anyway } — a foul well drunk anyway risks the flux.
     * → { success, text } or { success: false, reason }.
     */
    drinkHere(player, world, opts = {}) {
        if (!Thirst.on(player)) return { success: false, reason: 'You are not thirsty.' };
        const src = opts.source || Thirst.sourceHere(player, world);
        if (!src) {
            if (Thirst.held(player) >= 1) {
                const n = Thirst.drinkCarried(player, 100);
                return { success: true, text: `You drink ${n} draught${n === 1 ? '' : 's'} from your skins.` };
            }
            return { success: false, reason: 'There is no water here, and your skins are empty.' };
        }
        if (src.foul && !opts.anyway) return { success: false, reason: src.dry ? `The wells of ${src.settlement.name} are dry.` : `${src.label} is foul. Drink it anyway, buy water, or find another.` };
        if (src.foul) {
            if (src.dry) return { success: false, reason: 'There is nothing but mud at the bottom.' };
            Thirst.slake(player, 100);
            const sick = Thirst._foulRisk(player, world, 'hand');
            return { success: true, sick, text: `${Water.config().lines.foulDrink || 'The water stinks, and you drink it anyway.'}${sick ? ' Your belly turns within the hour: the flux.' : ''}` };
        }
        const filled = Thirst._slakeAt(player, world, src);
        return { success: true, filled, text: src.kind === 'ship' ? `You drink from ${src.label}.` : `You drink your fill from ${src.label}${filled ? ` and fill your skins (${filled} draught${filled === 1 ? '' : 's'})` : ''}.` };
    },

    /** Fill the skins here (clean water only). → { success, text } */
    fillSkins(player, world, source = null) {
        const src = source || Thirst.sourceHere(player, world);
        const cap = Thirst.capacity(player);
        if (cap <= 0) return { success: false, reason: 'You have no waterskin or cask to fill.' };
        if (!src || src.kind === 'ship') return { success: false, reason: 'There is no water here to fill them from.' };
        if (src.foul) return { success: false, reason: 'You will not carry foul water.' };
        const w = Thirst.state(player);
        const n = cap - Thirst.held(player);
        if (n <= 0) return { success: false, reason: 'Your skins are full.' };
        w.held = cap;
        return { success: true, n, text: `You fill your skins at ${src.label} (${n} draught${n === 1 ? '' : 's'}).` };
    },

    /** The foul water's flux: a hash roll. → the ailment report, or null. */
    _foulRisk(player, world, tag) {
        const F = Thirst.config().foulWater;
        const seed = world && (world.seed != null ? world.seed : (world.generationParams && world.generationParams.seed));
        if (_frac(`${seed || 0}|foulDrink|${tag}|${_day(world)}|${player.q},${player.r}`) >= _num(F.fluxChance, 0.55)) return null;
        try { return Ailments.inflict(player, world, F.ailment || 'flux', { source: 'foul water' }); } catch { return null; }
    },

    /** Buy a waterskin from the town's stalls (the cheapest), within purseShare of the purse. → name bought, or null. */
    _buySkin(player, world, tile) {
        const C = Thirst.config();
        if (!C.buySkin || C.buySkin.enabled === false || !tile || !tile.settlement) return null;
        let goods;
        try { goods = Trading.getAvailableGoods(tile.settlement, tile, world) || []; } catch { return null; }
        const g = goods.find(x => x && x.id === C.skin.good && x.quantity > 0);
        if (!g) return null;
        const cap = Math.floor(_num(player.gold) * _num(C.buySkin.purseShare, 0.3));
        if (Trading.buyCost(player, g, 1, tile.settlement) > cap) return null;
        const res = Trading.buyGoods(player, g, 1, tile.settlement);
        return res && res.success ? (g.name || 'a waterskin') : null;
    },

    // ── The day ───────────────────────────────────────

    /**
     * Water off the land where you stop for the night, with no river, lake or
     * town here (data/water.json player.land): a river or lake a hex off (a
     * short walk), else a stream, a spring, snowmelt or a pool — a hash roll by
     * the terrain's chance (wet woods most days, the desert hardly ever), less
     * in summer and in a drought age, more for a practised hunter or forager.
     * → a source { kind, label } or null.
     */
    landWater(player, world, tile) {
        if (!tile || !tile.terrain || !tile.terrain.passable || player.boardedShip != null) return null;
        const L = Thirst.config().land || {};
        if (L.enabled === false) return null;
        if (WaterSources.nearFresh(world, tile.q, tile.r)) return { kind: 'river', label: 'the river a short walk off', foul: false };
        const day = _day(world);
        let p = _num((L.terrain || {})[tile.terrain.id], _num(L.default, 0.6));
        const season = Seasons.seasonOf(day);
        p *= _num((L.season || {})[season], 1);
        try { if (Climate.wetAt(world, tile.q, tile.r, day) < _num(L.droughtBelow, -0.06)) p *= _num(L.droughtMult, 0.5); } catch { /* settled climate */ }
        const sk = player.skills || {};
        p += Math.min(_num(L.skillMax, 0.15), (_num(sk.hunting) + _num(sk.foraging) + _num(sk.survival)) * _num(L.perSkill, 0.02));
        const seed = world && (world.seed != null ? world.seed : (world.generationParams && world.generationParams.seed));
        if (_frac(`${seed || 0}|landWater|${tile.q},${tile.r}|${day}`) >= Math.min(0.98, p)) return null;
        const kinds = L.kinds && L.kinds[tile.terrain.id] ? L.kinds[tile.terrain.id] : (L.kinds && L.kinds.default) || ['a stream'];
        return { kind: 'stream', label: kinds[_hash(`${tile.q},${tile.r}|${day}`) % kinds.length], foul: false };
    },

    /** How fast thirst comes today: heat, desert, the march, the fighting. */
    drainMult(player, world) {
        const C = Thirst.config();
        const H = C.heat;
        const tile = world && world.getTile ? world.getTile(player.q, player.r) : null;
        let m = 1;
        let temp = 0.5;
        try { temp = Climate.seasonalTemp(world, tile, _day(world)); } catch { temp = _num(tile && tile.temperature, 0.5); }
        if (temp > _num(H.hotAbove, 0.62)) m *= Math.min(_num(H.max, 2.2), 1 + (temp - _num(H.hotAbove, 0.62)) * _num(H.perHeat, 2.2));
        else if (temp < _num(H.coldBelow, 0.25)) m *= _num(H.coldMult, 0.85);
        const tid = tile && tile.terrain && tile.terrain.id;
        if (tid && H.terrain && _num(H.terrain[tid]) > 0) m *= H.terrain[tid];
        const t = player._thirstDay && player._thirstDay.d === _day(world) ? player._thirstDay : null;
        if (t && t.hexes >= _num(C.march.hexes, 2)) m *= _num(C.march.mult, 1.2);
        if (t && t.fights > 0) m *= _num(C.fight.mult, 1.15);
        return Math.round(m * 100) / 100;
    },

    /**
     * The day's end (ui/game/endDay.js, after Player.endDay): the drain, drinking
     * what is to hand, parched days and their cost, the army's water.
     * ctx: { weather }. → { notices, died, drank: [] }
     */
    processDay(player, world, ctx = {}) {
        const out = { notices: [], died: false, drank: [] };
        if (!Thirst.on(player) || !world || player.interregnum || player._isDead) return out;
        const C = Thirst.config();
        const P = C.parched;
        const w = Thirst.state(player);
        const day = _day(world);
        const captive = !!(player.jailState || player.indenturedServitude);
        // The day's drain
        w.thirst = Math.max(0, w.thirst - _num(C.drain, 32) * Thirst.drainMult(player, world));
        player._thirstDay = null;
        if (captive) {
            // The captors give water: no one dies of thirst in a cell
            w.thirst = Math.max(w.thirst, 60);
            w.parched = 0;
            return out;
        }
        // Rain: a mouthful, and a little in the skins
        if (/rain|storm|drizzle|thunder|shower/.test(String(ctx.weather || ''))) {
            Thirst.slake(player, _num(C.rain.thirst, 20));
            w.held = Math.min(Thirst.capacity(player), w.held + _num(C.rain.draughts, 1));
        }
        const tile = world.getTile(player.q, player.r);
        const src = Thirst.sourceHere(player, world);
        if (src && !src.foul) {
            if (w.thirst < 100 || Thirst.held(player) < Thirst.capacity(player)) Thirst._slakeAt(player, world, src);
            if (src.kind === 'ship') w.thirst = 100;
        } else {
            // Out in the country: a river or lake a short walk off, else the land's own water —
            // a stream, a spring, snowmelt, a pool — found more often in wet country than dry
            const land = !src ? Thirst.landWater(player, world, tile) : null;
            if (land) {
                Thirst._slakeAt(player, world, land);
                out.drank.push(`water from ${land.label}`);
            }
            if (w.thirst < _num(C.autoBelow, 70)) {
                const n = Thirst.drinkCarried(player, 90);
                if (n) out.drank.push(`${n} draught${n === 1 ? '' : 's'} from your skins`);
            }
            if (src && src.foul && w.thirst < _num(C.autoBelow, 70)) {
                // A town of foul wells: carried water bought, else what's in the pack, else the foul water
                const r = Thirst.buyWater(player, world, 3);
                if (r.success) out.drank.push(`water from the carriers of ${src.settlement.name}`);
                else if (w.thirst < _num(C.drinksBelow, 40)) {
                    const good = Thirst.drinkFromPack(player);
                    if (good) out.drank.push(`a ${good.replace(/_/g, ' ')} from your pack`);
                    else if (w.thirst < _num(C.foulWater.desperateBelow, 15) && !src.dry) {
                        Thirst.slake(player, 100);
                        const sick = Thirst._foulRisk(player, world, 'auto');
                        out.notices.push({ icon: '🤢', title: 'Foul Water', text: `With no coin for the carriers you drink from the foul well of ${src.settlement.name}.${sick ? ' The flux takes you.' : ''}`, type: 'warning' });
                    }
                }
            } else if (w.thirst < _num(C.drinksBelow, 40)) {
                const good = Thirst.drinkFromPack(player);
                if (good) out.drank.push(`a ${good.replace(/_/g, ' ')} from your pack`);
            }
        }
        // In a town with too few skins for the road: buy one, as one buys bread
        const skins = Math.floor(_num(player.inventory && player.inventory[C.skin.good]));
        if (tile && tile.settlement && skins < Math.max(1, _num(C.buySkin.keep, 2)) && (src && !src.foul || Thirst.capacity(player) <= 0)) {
            const bought = Thirst._buySkin(player, world, tile);
            if (bought) {
                w.held = Thirst.capacity(player);
                out.drank.push(`bought ${bought.toLowerCase()} and filled it`);
            }
        }
        Thirst.held(player);
        // Parched: a shorter day, then the body pays
        if (w.thirst <= 0) {
            w.parched = _num(w.parched) + 1;
            const hp = P.healthPerDay || [12, 25, 40, 60];
            const dmg = _num(hp[Math.min(hp.length - 1, w.parched - 1)], 40);
            player.health = Math.max(0, _num(player.health) - dmg);
            out.notices.push({ icon: '💀', title: w.parched >= 2 ? 'Dying of Thirst' : 'Parched', text: `${w.parched === 1 ? 'A day without water.' : `${w.parched} days without water.`} Health ${Math.round(player.health)}/${_num(player.maxHealth, 100)}. ${Water.config().lines.parched || 'Find water.'}`, type: 'error' });
            if (player.health <= 0) out.died = true;
        } else {
            w.parched = 0;
        }
        if (w.thirst < _num(P.below, 30) && player.movementRemaining > 0) {
            const bad = w.thirst < _num(P.badBelow, 12);
            player.movementRemaining = Math.round(player.movementRemaining * _num(bad ? P.badMoveMult : P.moveMult, 0.8) * 100) / 100;
            if (bad && typeof player.modifyNeed === 'function') player.modifyNeed('energy', -_num(P.badEnergy, 10));
            // (parched: a time skip stops for it — core/interrupts.js)
            if (bad) Interrupts.raise(world, { reason: 'You are parched: find water', icon: '🥵', source: 'thirst' });
            if (w.thirst > 0 && w.told.warn !== day && (!w.told.warn || day - w.told.warn >= 2)) {
                w.told.warn = day;
                out.notices.push({ icon: '🥵', title: 'Thirsty', text: `${Water.config().lines.parched || 'Find water.'}${Thirst.capacity(player) > 0 ? '' : ' You carry no waterskin.'}`, type: 'warning' });
            }
        }
        // The army drinks from the land
        const army = Thirst._armyDay(player, world, src);
        if (army) out.notices.push(army);
        return out;
    },

    /** The player's land army with no water where it camps: a grace day, then men lost. → a notice or null. */
    _armyDay(player, world, src) {
        const land = (player.army || []).filter(u => u && !PlayerMilitary.isNavalUnit(u));
        const w = Thirst.state(player);
        if (!land.length || player.boardedShip != null || (src && !src.foul)) { w.armyDry = 0; return null; }
        w.armyDry = _num(w.armyDry) + 1;
        const A = Water.config().army;
        if (w.armyDry <= _num(A.graceDays, 1)) return null;
        const n = Math.max(1, Math.round(land.length * _num(A.unitShare, 0.1)));
        let lost = 0;
        for (let i = player.army.length - 1; i >= 0 && lost < n; i--) {
            const u = player.army[i];
            if (!u || PlayerMilitary.isNavalUnit(u)) continue;
            player.army.splice(i, 1);
            lost++;
        }
        return lost ? { icon: '🏜️', title: 'A Dry March', text: `${w.armyDry} days without water for your army: ${lost} compan${lost === 1 ? 'y' : 'ies'} fall out or slip away. Camp by a river or a town.`, type: 'warning' } : null;
    },
};
