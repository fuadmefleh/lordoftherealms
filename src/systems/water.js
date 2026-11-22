// ============================================
// WATER — the towns' wells, fouled wells, and water in war
// ============================================
// Every town drinks. Its sources: its wells (by size, one more for each two
// town eras: world/townEras.js) and a river through it or a lake beside it
// (the sea is salt and doesn't count). While any source runs clean the town
// drinks; the player drinks there free (player/thirst.js).
//
// A WELL CAN BE FOULED:
//   carcasses  a besieger's dark deed (systems/atrocities.js 'wells'), or the
//              besiegers of your holding (systems/holdingSieges.js)
//   plague     a town sick of a serious plague: the dead in the well
//   agent      an enemy's agent in a town of a realm at war
//   poison     the player's poison or carrion down the well
//              (systems/townCrimes.js poisonWell — counted here as one well)
//   drought    in summer, in a drought, a town with no river or lake may find
//              its wells run dry (no sickness: no water)
// A foul well can't be drunk. With no clean source left the town's people
// drink it anyway and sicken (systems/illness.js on the town's roster, or an
// abstract sickness), it pays water carriers (its purse → the nearest town
// with water), its mood falls and some of its people leave for the next town.
// It clears in time — sooner when the well-diggers are paid (`clean`).
//
// IN WAR: a besieged town with no clean water drinks its cisterns, then
// thirsts (siegeDay: morale and garrison, read by systems/sieges.js and
// systems/holdingSieges.js); a siege camp far from a river hauls its water
// (siegeCampDay); a commanded host away at war needs water near (hostDay,
// player/generalship.js); ships carry water casks for their crews, filled free
// at a port with clean water (shipDay, systems/shipVoyages.js _feedCrews).
//
// State: settlement.water (saved with the tile: { foul: [{ cause, d, until,
// n, by, props }], dry, carried }); siege.water* on the siege; ship.waterDays.
// Cheap: per town, never per person; the weekly checks are staggered by a
// hash of the town. Hash rolls on the world seed: no shared RNG. Runs with
// player = null. Tuning: data/water.json.

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Utils } from '../core/utils.js';
import { Economy } from '../world/economy.js';
import { Seasons } from '../world/seasons.js';
import { Climate } from '../world/climate.js';
import { TownEras } from '../world/townEras.js';
import { WorldEvents } from '../world/worldEvents.js';
import { WaterSources } from '../world/waterSources.js';
import { Townsfolk } from './townsfolk.js';
import { Illness } from './illness.js';
import { TownCrimes } from './townCrimes.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = world => _num(world && world.day, 0);
const _seed = world => (world && (world.seed != null ? world.seed : (world.generationParams && world.generationParams.seed))) || 0;

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

/** A small seeded stream (mulberry32) for the day's sickness: never the shared RNG. */
function _stream(str) {
    let a = _hash(str) || 1;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const DEFAULTS = {
    enabled: true,
    town: {
        wells: { village: 1, town: 2, city: 4, capital: 5 }, perEra: 0.5,
        foul: { carcasses: 24, plague: 18, agent: 14, poison: 8, drought: 21 },
        clean: { pricePerWell: 30, days: 2 },
        noWater: { happiness: -0.6, dailySick: 0.02, partSick: 0.004, carrierPer100: 0.4, fleeShare: 0.02 },
        someFoulHappiness: -0.15,
        drought: { wetBelow: -0.06, weekChance: 0.2, days: [15, 30] },
        plague: { weekChance: 0.25 },
        agent: { weekChance: 0.003 },
        noticeRange: 6,
    },
    siege: { cisternDays: { village: 1, town: 3, city: 6, capital: 8 }, stoneEraDays: 3, thirstMorale: 9, thirstGarrisonLoss: 0.05, holdingFoul: { foulDay: 6, chance: 0.4 }, camp: { campMorale: 1 } },
    army: { graceDays: 1, unitShare: 0.1 },
    host: { moraleLoss: 4, desertShare: 0.02 },
    aiArmy: { graceDays: 2, strengthShare: 0.03, dryAttack: 0.9, dryDefense: 0.8, dryAttrition: 0.004 },
    ship: { capDays: 20, graceDays: 1, thirstMorale: 12, crewShare: 0.05 },
};

const CAUSE_WORDS = {
    carcasses: 'carcasses thrown down it',
    plague: 'the plague dead',
    agent: "an enemy's poison",
    poison: 'poison',
    drought: 'the drought',
};

let _cfg = null;
let _cfgSrc;

export const Water = {
    DEFAULTS,

    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.water : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            const sub = (a, b) => {
                const o = { ...a };
                for (const [k, v] of Object.entries(_obj(b) || {})) o[k] = _obj(v) && _obj(a[k]) ? { ...a[k], ...v } : v;
                return o;
            };
            _cfg = {
                enabled: d.enabled !== false,
                town: sub(DEFAULTS.town, d.town),
                siege: sub(DEFAULTS.siege, d.siege),
                army: { ...DEFAULTS.army, ...(_obj(d.army) || {}) },
                host: { ...DEFAULTS.host, ...(_obj(d.host) || {}) },
                aiArmy: { ...DEFAULTS.aiArmy, ...(_obj(d.aiArmy) || {}) },
                ship: { ...DEFAULTS.ship, ...(_obj(d.ship) || {}) },
                player: _obj(d.player) || {},
                lines: _obj(d.lines) || {},
            };
        }
        return _cfg;
    },

    enabled() { return Water.config().enabled; },

    causeWord(cause) { return CAUSE_WORDS[cause] || 'filth'; },

    // ── Sources ───────────────────────────────────────

    /** The town's wells: by size, and one more for each two eras it has stood through (world/waterSources.js). */
    wellsOf(s) {
        return WaterSources.wellsOf(s);
    },

    /** The stone era or later (cisterns cut in the rock). */
    _stoneAge(s) {
        const st = TownEras.state(s);
        const H = st && Array.isArray(st.history) ? st.history : null;
        return !!(H && H.length && TownEras.eraIndex(H[H.length - 1][0]) >= 2);
    },

    /** Fresh water on or beside a hex: 'river', 'lake' or null (the sea is salt; world/waterSources.js). */
    freshAt(world, q, r) {
        return WaterSources.freshAt(world, q, r);
    },

    /** The town's water record (created when asked). */
    state(s, create = false) {
        if (!s) return null;
        if (_obj(s.water)) return s.water;
        if (!create) return null;
        s.water = { foul: [], dry: null };
        return s.water;
    },

    /** Wells foul today by the records (and the town crime's poisoned well). */
    _fouled(s, day) {
        const w = Water.state(s);
        let n = 0;
        if (w && Array.isArray(w.foul)) for (const f of w.foul) if (day <= _num(f.until, -1)) n += Math.max(1, _num(f.n, 1));
        try { if (TownCrimes.wellFoul(s, day)) n += 1; } catch { /* none */ }
        return n;
    },

    /** Are the wells run dry today? */
    _dry(s, day) {
        const w = Water.state(s);
        return !!(w && w.dry && day <= _num(w.dry.until, -1));
    },

    /**
     * The town's water today: { wells, fouled, clean, fresh, sources, ok, dry,
     * causes: [{ cause, until, n }], until } — `ok` while any source runs clean.
     */
    view(world, s) {
        const day = _day(world);
        const wells = Water.wellsOf(s);
        const dry = Water._dry(s, day);
        const fouled = dry ? wells : Math.min(wells, Water._fouled(s, day));
        const clean = Math.max(0, wells - fouled);
        const fresh = s ? Water.freshAt(world, s.q, s.r) : null;
        const causes = [];
        const w = Water.state(s);
        if (w && Array.isArray(w.foul)) for (const f of w.foul) if (day <= _num(f.until, -1)) causes.push({ cause: f.cause, until: f.until, n: Math.max(1, _num(f.n, 1)), by: f.by || null });
        try {
            if (TownCrimes.wellFoul(s, day)) causes.push({ cause: 'poison', until: s.townCrimes.well.until, n: 1, by: null });
        } catch { /* none */ }
        if (dry) causes.push({ cause: 'drought', until: w.dry.until, n: wells, by: null });
        const until = causes.reduce((m, c) => Math.max(m, _num(c.until)), -1);
        return { wells, fouled, clean, fresh, sources: clean + (fresh ? 1 : 0), ok: clean > 0 || !!fresh, dry, causes, until };
    },

    /** Can the town (and a traveller in it) drink clean water today? */
    canDrink(world, s) {
        // (most towns keep no water record and no poisoned well: clean, without a look)
        if (!s) return false;
        if (!_obj(s.water) && !(s.townCrimes && s.townCrimes.well)) return true;
        return Water.view(world, s).ok;
    },

    /**
     * The water a traveller finds at a hex: { kind: 'well'|'river'|'lake',
     * label, foul, settlement } or null. In a town whose wells are all foul
     * and no river: { kind: 'well', foul: true }.
     */
    sourceAt(world, q, r) {
        if (!world || typeof world.getTile !== 'function') return null;
        const tile = world.getTile(q, r);
        if (!tile) return null;
        const fresh = Water.freshAt(world, q, r);
        const s = tile.settlement || null;
        if (s) {
            const v = Water.view(world, s);
            if (v.clean > 0) return { kind: 'well', label: `the well of ${s.name}`, foul: false, settlement: s };
            if (fresh) return { kind: fresh, label: `the ${fresh} by ${s.name}`, foul: false, settlement: s };
            return { kind: 'well', label: `the well of ${s.name}`, foul: true, dry: v.dry, settlement: s };
        }
        if (fresh) return { kind: fresh, label: `the ${fresh}`, foul: false, settlement: null };
        return null;
    },

    // ── Fouling and cleaning ──────────────────────────

    /**
     * Foul `n` of a town's wells (default one) for the cause's days (opts.days).
     * opts: { n, days, by, prop } — prop: the street-map well ("x,y") fouled.
     * → the record, or null.
     */
    foul(world, s, cause, opts = {}) {
        if (!s || !Water.enabled()) return null;
        const T = Water.config().town;
        const day = _day(world);
        const w = Water.state(s, true);
        if (cause === 'drought') {
            const days = _num(opts.days, _num(T.foul.drought, 21));
            w.dry = { d: day, until: day + days };
            return w.dry;
        }
        const wells = Water.wellsOf(s);
        const n = Math.max(1, Math.min(wells, Math.round(_num(opts.n, 1))));
        const days = Math.max(1, Math.round(_num(opts.days, _num((T.foul || {})[cause], 14))));
        w.foul = (w.foul || []).filter(f => day <= _num(f.until, -1));
        const rec = { cause, d: day, until: day + days, n, by: opts.by || null, props: opts.prop ? [String(opts.prop)] : [] };
        w.foul.push(rec);
        if (w.foul.length > 6) w.foul.shift();
        return rec;
    },

    /** What the well-diggers ask to clear the town's foul wells now: { wells, price } or null. */
    cleanQuote(world, s) {
        const v = Water.view(world, s);
        const w = Water.state(s);
        const own = w && Array.isArray(w.foul) ? w.foul.filter(f => _day(world) <= _num(f.until, -1)) : [];
        const n = own.reduce((a, f) => a + Math.max(1, _num(f.n, 1)), 0);
        if (!n || v.dry) return null;
        const C = Water.config().town.clean;
        return { wells: Math.min(n, v.wells), price: Math.max(1, Math.round(Math.min(n, v.wells) * _num(C.pricePerWell, 30))), days: _num(C.days, 2) };
    },

    /**
     * Pay the well-diggers to clear the foul wells (the coin to the town's purse:
     * its own people do the work). → { success, text } or { success: false, reason }.
     */
    clean(world, player, s) {
        const q = Water.cleanQuote(world, s);
        if (!q) return { success: false, reason: 'No well here is foul with anything a well-digger can haul out.' };
        if (_num(player && player.gold) < q.price) return { success: false, reason: `The well-diggers want ${q.price} gold.` };
        player.gold = Utils.cents(_num(player.gold) - q.price);
        Economy.payTown(s, q.price);
        const day = _day(world);
        for (const f of Water.state(s).foul) if (day <= _num(f.until, -1)) f.until = Math.min(f.until, day + q.days);
        return { success: true, price: q.price, text: `You pay the well-diggers of ${s.name} ${q.price} gold. They go down on ropes, haul up the filth and bail the ${q.wells === 1 ? 'well' : `${q.wells} wells`} out: clean in ${q.days} day${q.days === 1 ? '' : 's'}.` };
    },

    /**
     * Which of the street map's wells are foul: the anchors fouled by hand first,
     * then the rest in order up to the town's foul count. anchors: ["x,y", …].
     */
    fouledProps(world, s, anchors) {
        const list = (anchors || []).slice().sort();
        if (!list.length || !s) return new Set();
        const v = Water.view(world, s);
        if (v.dry) return new Set(list);
        const want = Math.min(list.length, Math.round(list.length * (v.fouled / Math.max(1, v.wells))) || (v.fouled > 0 ? 1 : 0));
        const out = new Set();
        const w = Water.state(s);
        const day = _day(world);
        // (the well the player fouled by hand: systems/townCrimes.js poisonWell from the street map)
        if (w && w.hand && day <= _num(w.hand.until, -1) && list.includes(w.hand.prop) && want > 0) out.add(w.hand.prop);
        if (w && Array.isArray(w.foul)) {
            for (const f of w.foul) {
                if (day > _num(f.until, -1)) continue;
                for (const p of f.props || []) if (list.includes(p) && out.size < want) out.add(p);
            }
        }
        for (const p of list) { if (out.size >= want) break; out.add(p); }
        return out;
    },

    /** The street map's well the player fouled by hand (the town crime's own record keeps the rest). */
    markHand(world, s, prop, until) {
        const w = Water.state(s, true);
        w.hand = { prop: String(prop), until: _num(until, _day(world) + 8) };
    },

    // ── The days ──────────────────────────────────────

    _views(world) {
        return world && typeof world.getSettlementViews === 'function' ? world.getSettlementViews().filter(Boolean) : [];
    },

    _near(player, s) {
        const R = _num(Water.config().town.noticeRange, 6);
        return !!player && Number.isFinite(player.q) && Math.abs(_num(player.q) - s.q) + Math.abs(_num(player.r) - s.r) <= R;
    },

    /** The nearest other town that has water (and a purse), or null. */
    _nearestWet(world, s) {
        const w = world.width || 0;
        const near = [];
        for (const o of Water._views(world)) {
            if (o === s || (o.q === s.q && o.r === s.r) || !Number.isFinite(o.q)) continue;
            near.push([Hex.wrappingDistance(s.q, s.r, o.q, o.r, w), o]);
        }
        near.sort((a, b) => a[0] - b[0]);
        for (const [, o] of near) if (Water.canDrink(world, o)) return o;
        return null;
    },

    /** Strike `share` of the town's healthy with the flux (its roster), or an abstract sickness. */
    _sicken(world, s, day, share, rnd) {
        if (!(share > 0) || !Illness.on()) return 0;
        const folk = s.folk;
        if (folk && Array.isArray(folk.people)) {
            try { Illness.state(world, s, folk, day); } catch { /* fresh roster */ }
            const open = Townsfolk.residents(folk).filter(p => !p.ill && !Illness._immune(p, 'flux', day));
            let n = Math.min(open.length, Math.floor(open.length * share));
            if (n === 0 && open.length && rnd() < open.length * share) n = 1;
            let struck = 0;
            for (let i = 0; i < n && open.length; i++) {
                const p = open.splice(Math.floor(rnd() * open.length) % open.length, 1)[0];
                if (p && Illness._infect(folk, p, 'flux', day, rnd, 'foul water')) struck++;
            }
            return struck;
        }
        const k = Illness.townSickness(s, day);
        if (!k) s.sickness = { k: 'flux', d: day, until: day + 7, abs: true, share: Math.min(0.3, Math.round(share * 500) / 100), from: null };
        return 0;
    },

    /**
     * One day for every town: the foul wells' effects, the dry wells, and (a
     * town's day of the week, staggered) the drought, the plague dead and the
     * enemy's agents. → { notices }
     */
    processDay(world, player = null) {
        const out = { notices: [] };
        if (!world || !Water.enabled()) return out;
        const day = _day(world);
        const seed = _seed(world);
        const T = Water.config().town;
        let atWar = null;
        const summer = Seasons.seasonOf(day) === 'Summer';
        for (const s of Water._views(world)) {
            if (!Number.isFinite(s.q)) continue;
            // (a well poisoned by the town crime counts too: systems/townCrimes.js)
            const w = Water.state(s) || (s.townCrimes && TownCrimes.wellFoul(s, day) ? Water.state(s, true) : null);
            if (w) Water._townDay(world, player, s, w, day, seed, out);
            // The week's checks, one town in seven a day
            if ((_hash(`${s.q},${s.r}`) + day) % 7 !== 0) continue;
            const roll = key => _frac(`${seed}|water|${key}|${s.q},${s.r}|${day}`);
            const fresh = Water.freshAt(world, s.q, s.r);
            // Drought: the wells of a town with no river or lake run dry
            if (summer && !fresh && !Water._dry(s, day)) {
                const D = T.drought || {};
                let dryAge = false;
                try { dryAge = Climate.wetAt(world, s.q, s.r, day) < _num(D.wetBelow, -0.06); } catch { dryAge = false; }
                if (!dryAge) {
                    const tile = world.getTile(s.q, s.r);
                    for (const ev of world.activeEvents || []) {
                        if (ev && /drought/.test(String(ev.id || '')) && WorldEvents._eventReaches(ev, tile)) { dryAge = true; break; }
                    }
                }
                if (dryAge && roll('drought') < _num(D.weekChance, 0.2)) {
                    const days = Math.round(_num((D.days || [15])[0], 15) + roll('dd') * (_num((D.days || [15, 30])[1], 30) - _num((D.days || [15])[0], 15)));
                    Water.foul(world, s, 'drought', { days });
                    if (Water._near(player, s)) out.notices.push({ icon: '🏜️', title: `The Wells of ${s.name} Run Dry`, text: `The drought has drunk the wells of ${s.name} down to mud. Its people cart water from afar and pay for every barrel.`, type: 'warning' });
                }
            }
            // The plague dead in a well
            const k = Illness.townSickness(s, day);
            const def = k && k.k ? Illness.def(k.k) : null;
            if (def && def.plague && roll('plague') < _num((T.plague || {}).weekChance, 0.25)) {
                Water.foul(world, s, 'plague');
                if (Water._near(player, s)) out.notices.push({ icon: '🐀', title: `A Foul Well in ${s.name}`, text: `The plague dead have fouled a well of ${s.name}. The people draw from the others, and pray.`, type: 'info' });
            }
            // An enemy's agent in a town of a realm at war
            if (atWar === null) {
                atWar = new Set();
                for (const kd of world.kingdoms || []) if (kd && Array.isArray(kd.wars) && kd.wars.length) atWar.add(String(kd.id));
            }
            if (s.kingdom != null && atWar.has(String(s.kingdom)) && roll('agent') < _num((T.agent || {}).weekChance, 0.003)) {
                Water.foul(world, s, 'agent', { by: 'an enemy agent' });
                if (Water._near(player, s)) out.notices.push({ icon: '🗡️', title: `Poison in ${s.name}`, text: `An enemy's agent has poisoned a well of ${s.name}. The watch has sealed it.`, type: 'info' });
            }
        }
        return out;
    },

    _townDay(world, player, s, w, day, seed, out) {
        const T = Water.config().town;
        // The records that have run out go; the cleared wells told
        if (Array.isArray(w.foul) && w.foul.length) {
            const keep = w.foul.filter(f => day <= _num(f.until, -1));
            if (keep.length < w.foul.length && !keep.length && Water._near(player, s)) {
                out.notices.push({ icon: '💧', title: `The Wells of ${s.name}`, text: `The wells of ${s.name} run clean again.`, type: 'info' });
            }
            w.foul = keep;
        }
        if (w.dry && day > _num(w.dry.until, -1)) {
            w.dry = null;
            if (Water._near(player, s)) out.notices.push({ icon: '💧', title: `Water in ${s.name}`, text: `The wells of ${s.name} fill again.`, type: 'info' });
        }
        if (w.hand && day > _num(w.hand.until, -1)) delete w.hand;
        const crime = TownCrimes.wellFoul(s, day);
        if (!w.foul.length && !w.dry && !w.hand && !crime) {
            if (!w.carried) delete s.water;
            else if (day - _num(w.carried.d) > 30) delete s.water;
            return;
        }
        const v = Water.view(world, s);
        const N = T.noWater || {};
        if (v.ok) {
            // Some wells foul: crowded at the rest, a few drank before they knew
            s.happiness = Math.max(0, Math.min(100, _num(s.happiness, 50) + _num(T.someFoulHappiness, -0.15)));
            const fresh = w.foul.some(f => day - _num(f.d) <= 1 && f.cause !== 'drought');
            if (fresh) Water._sicken(world, s, day, _num(N.partSick, 0.004), _stream(`${seed}|wsick|${s.q},${s.r}|${day}`));
            return;
        }
        // No clean water at all
        s.happiness = Math.max(0, Math.min(100, _num(s.happiness, 50) + _num(N.happiness, -0.6)));
        // (the poisoned well's own sick are the town crime's: systems/townCrimes.js)
        if (!v.dry && w.foul.length) Water._sicken(world, s, day, _num(N.dailySick, 0.02), _stream(`${seed}|wsick|${s.q},${s.r}|${day}`));
        // Water carted in from the nearest town with water: the purse pays its carriers
        const pop = Math.max(0, _num(s.population));
        const cost = Utils.cents(pop / 100 * _num(N.carrierPer100, 0.4));
        // (the town with water: looked for once a week, kept on the record)
        let to = null;
        if (w.to && day - _num(w.to.d) < 7) to = (world.getTile(w.to.q, w.to.r) || {}).settlement || null;
        if (!to || !Water.canDrink(world, to)) {
            to = Water._nearestWet(world, s);
            w.to = to ? { q: to.q, r: to.r, d: day } : null;
        }
        if (cost > 0 && s.economy) {
            const paid = to ? Economy.drawTown(s, cost) : 0;
            if (paid > 0) Economy.payTown(to, paid);
            w.carried = { d: day, from: to ? to.name : null, paid: Utils.cents(_num(w.carried && w.carried.d === day - 1 ? w.carried.paid : 0) + paid) };
        }
        // Each week some leave for a town with water (fewer mouths, the same stores)
        if ((_hash(`${s.q},${s.r}|flee`) + day) % 7 === 0 && pop > 60) {
            const n = Math.floor(pop * _num(N.fleeShare, 0.02));
            if (to && n > 0) {
                s.population = pop - n;
                to.population = _num(to.population) + n;
                if (Water._near(player, s)) out.notices.push({ icon: '🚶', title: `Thirsty ${s.name}`, text: `${n} people of ${s.name} have left for ${to.name}, where the water is clean.`, type: 'info' });
            }
        }
    },

    // ── War ───────────────────────────────────────────

    /** Days a besieged town's cisterns hold once its wells are lost. */
    cisternDays(s) {
        const S = Water.config().siege;
        return _num((S.cisternDays || {})[s && s.type || 'village'], 2) + (Water._stoneAge(s) ? _num(S.stoneEraDays, 3) : 0);
    },

    /**
     * A day of a siege for the town's water (systems/sieges.js and
     * systems/holdingSieges.js _defendersDay). opts: { log(text), enemyFoul,
     * notice(title, text, type) }. The besiegers of a holding may foul its
     * wells (enemyFoul). → the defenders' morale change (≤ 0); the garrison's
     * thirst losses are taken here.
     */
    siegeDay(world, siege, settlement, opts = {}) {
        if (!siege || !settlement || !Water.enabled()) return 0;
        const S = Water.config().siege;
        const day = _day(world);
        if (opts.enemyFoul && !siege.waterFouled) {
            const H = S.holdingFoul || {};
            if (day - _num(siege.startDay, day) >= _num(H.foulDay, 6)) {
                siege.waterFouled = true;
                if (_frac(`${_seed(world)}|hsfoul|${settlement.q},${settlement.r}|${_num(siege.startDay)}`) < _num(H.chance, 0.4)) {
                    Water.foul(world, settlement, 'carcasses', { n: Water.wellsOf(settlement), by: 'the besiegers' });
                    const text = `The besiegers have thrown carcasses down the wells of ${settlement.name}.`;
                    if (opts.log) opts.log(text);
                    if (opts.notice) opts.notice('🐀 The Wells Fouled', `${text} ${Water.freshAt(world, settlement.q, settlement.r) ? 'The river still runs through it.' : `It drinks from its cisterns now: ${Water.cisternDays(settlement)} days.`}`, 'warning');
                }
            }
        }
        if (Water.canDrink(world, settlement)) {
            siege.waterLeft = null;
            return 0;
        }
        if (!Number.isFinite(siege.waterLeft)) {
            siege.waterLeft = Water.cisternDays(settlement);
            if (opts.log) opts.log(`No clean well left in ${settlement.name}: the town drinks its cisterns (${siege.waterLeft} days).`);
        }
        if (siege.waterLeft > 0) {
            siege.waterLeft = Math.max(0, siege.waterLeft - 1);
            return 0;
        }
        siege.thirstDays = _num(siege.thirstDays) + 1;
        siege.garrison = Math.max(0, Math.floor(_num(siege.garrison) * (1 - _num(S.thirstGarrisonLoss, 0.05))));
        if (siege.thirstDays === 1) {
            const text = `The cisterns of ${settlement.name} are dry. The garrison thirsts on the walls.`;
            if (opts.log) opts.log(text);
            if (opts.notice) opts.notice('🏜️ Thirst in the Town', text, 'info');
        }
        return -_num(S.thirstMorale, 9);
    },

    /** A siege camp far from a river or lake hauls its water: the camp's morale lost today. */
    siegeCampDay(world, siege) {
        if (!siege || !Water.enabled()) return 0;
        if (Water.freshAt(world, siege.q, siege.r)) return 0;
        for (const n of Hex.neighbors(siege.q, siege.r)) if (Water.freshAt(world, n.q, n.r)) return 0;
        return _num((Water.config().siege.camp || {}).campMorale, 1);
    },

    /**
     * A commanded host away at war (player/generalship.js): with no water
     * at or beside where it stands, it loses heart and men. → { dry, gone }.
     */
    hostDay(world, q, r, host) {
        if (!host || !Water.enabled()) return { dry: false, gone: 0 };
        const tile = world && world.getTile ? world.getTile(q, r) : null;
        if (Water.freshAt(world, q, r) || (tile && tile.settlement && Water.canDrink(world, tile.settlement))) {
            host.dryDays = 0;
            return { dry: false, gone: 0 };
        }
        for (const n of Hex.neighbors(q, r)) if (Water.freshAt(world, n.q, n.r)) { host.dryDays = 0; return { dry: false, gone: 0 }; }
        host.dryDays = _num(host.dryDays) + 1;
        if (host.dryDays <= 1) return { dry: true, gone: 0 };
        const H = Water.config().host;
        host.morale = Math.max(0, Math.min(100, _num(host.morale) - _num(H.moraleLoss, 4)));
        const gone = Math.ceil(_num(host.men) * _num(H.desertShare, 0.02));
        host.men = Math.max(0, _num(host.men) - gone);
        return { dry: true, gone };
    },

    /**
     * A war host on the map (a world unit: a realm's host against you,
     * systems/realmWars.js; a relief host, systems/sieges.js): with no water
     * on or beside its hex past graceDays, its men thirst and fall away.
     * rec: the record that keeps its strength, if any. → strength lost.
     */
    armyUnitDay(world, unit, rec = null) {
        if (!unit || unit.destroyed || !Water.enabled()) return 0;
        const tile = world && world.getTile ? world.getTile(unit.q, unit.r) : null;
        if (WaterSources.nearFresh(world, unit.q, unit.r) || (tile && tile.settlement && Water.canDrink(world, tile.settlement))) {
            unit.dryDays = 0;
            return 0;
        }
        unit.dryDays = _num(unit.dryDays) + 1;
        const A = Water.config().aiArmy;
        if (unit.dryDays <= _num(A.graceDays, 2)) return 0;
        const share = _num(A.strengthShare, 0.03);
        const lost = Math.max(1, Math.round(_num(unit.strength) * share));
        unit.strength = Math.max(1, _num(unit.strength) - lost);
        if (rec && Number.isFinite(rec.strength)) rec.strength = Math.max(1, Math.round(rec.strength * (1 - share)));
        return lost;
    },

    /**
     * The realms' own battles (world/kingdomAI.js simulateBattle reads
     * WaterSources the same way): a factor on an attack in dry country, a
     * defence in a town with no clean water. Kept here for the panel and spec.
     */
    campaignFactor(world, q, r, side) {
        const A = Water.config().aiArmy;
        const tile = world && world.getTile ? world.getTile(q, r) : null;
        if (side === 'defend') return tile && tile.settlement && WaterSources.townDry(world, tile.settlement) ? _num(A.dryDefense, 0.8) : 1;
        return WaterSources.nearFresh(world, q, r) || (tile && tile.settlement) ? 1 : _num(A.dryAttack, 0.9);
    },

    // ── Ships ─────────────────────────────────────────

    /** Days of water a ship can carry for its crew. */
    shipCap() { return Math.max(1, _num(Water.config().ship.capDays, 20)); },

    /** Days of water aboard (an old save's ship: full). */
    shipWater(ship) {
        if (!ship) return 0;
        if (!Number.isFinite(ship.waterDays)) ship.waterDays = Water.shipCap();
        return ship.waterDays;
    },

    /**
     * A ship's day for water (systems/shipVoyages.js _feedCrews). In port at a
     * town with clean water the casks are filled free; away, the crew drinks a
     * day; dry past graceDays costs morale and men. setMorale(ship, m) and
     * getMorale(ship) are the Ships object's. → { daysLeft, dry, lost }.
     */
    shipDay(world, ship, away, crew, setMorale, getMorale) {
        const out = { daysLeft: Water.shipWater(ship), dry: false, lost: 0 };
        if (!Water.enabled() || !ship) return out;
        const C = Water.config().ship;
        if (!away) {
            const tile = world && world.getTile ? world.getTile(ship.q, ship.r) : null;
            const s = tile && tile.settlement;
            if (ship.status === 'docked' && (!s || Water.canDrink(world, s))) ship.waterDays = Water.shipCap();
            ship.thirstyDays = 0;
            out.daysLeft = ship.waterDays;
            return out;
        }
        if (!(crew > 0)) return out;
        if (ship.waterDays >= 1) {
            ship.waterDays = Math.max(0, ship.waterDays - 1);
            ship.thirstyDays = 0;
            out.daysLeft = ship.waterDays;
            return out;
        }
        ship.waterDays = 0;
        ship.thirstyDays = _num(ship.thirstyDays) + 1;
        out.dry = true;
        out.daysLeft = 0;
        if (ship.thirstyDays > _num(C.graceDays, 1)) {
            if (typeof setMorale === 'function') setMorale(ship, _num(typeof getMorale === 'function' ? getMorale(ship) : ship.morale, 50) - _num(C.thirstMorale, 12));
            const lost = Math.min(Math.max(0, Math.floor(crew) - 1), Math.ceil(crew * _num(C.crewShare, 0.05)));
            if (lost > 0 && Number.isFinite(ship.crew)) { ship.crew = Math.max(1, ship.crew - lost); out.lost = lost; }
        }
        return out;
    },

    /** Stow fresh water from a port with clean water (a ship that left port short). */
    fillShip(world, ship) {
        if (!ship) return 0;
        const before = Water.shipWater(ship);
        ship.waterDays = Water.shipCap();
        return ship.waterDays - before;
    },
};
