// ============================================
// FURNITURE ACTIONS — using the furniture inside buildings
// ============================================
// What the player may do with a piece of furniture indoors, whether they may,
// and what it does. The menu is ui/objectActions (OBJECT_ACTIONS: the keys
// sit, sleep, sleep_trespass, warm, read, order_meal, eat_home, wash_basin,
// bathe_tub); this is the rule and the effect, so it is the same for the menu,
// the tests and anything else that asks.
//
//   offers(type, building, furniture)   the extra action keys a piece offers:
//                                        by its type and building (data
//                                        'offers' / 'byBuilding') and what
//                                        stands on it (tile._decor: books → Read,
//                                        mugs in a tavern → Have a Drink)
//   standing(building)                   whose the place is: own, lodging,
//                                        public, home (someone else's house),
//                                        business, outdoors
//   bedAccess(ctx)                       sleeping here: own / rented / permitted
//                                        / public / trespass / lodging (take a
//                                        room first), and how well you sleep
//   usable(key, furniture)               a broken piece (furniture.broken) is
//                                        no use: only looked into or emptied
//   check(key, ctx)                      → { ok, reason } (the menu greys the
//                                        action out with the reason)
//   apply(key, ctx)                      → { ok, text, hours, ... } — mutates the
//                                        player; the caller passes the hours on
//                                        the clock
//   sitGains / standUp                   sitting a while: energy and comfort by
//                                        the hour sat (up to maxHours), settled
//                                        when you get up (world/innerMap/
//                                        furnitureUse.js stands you up on a move)
//   trespassOdds / trespassSleep         a night in a stranger's bed: seen or not
//                                        (one Utils.random roll); caught → fine,
//                                        standing, a trespass on the realm's
//                                        charge sheet (systems/underworld.js)
//
// ctx: { player, world, type, furniture, building, hour, scene: { witnesses,
// ownerInside, ownerName }, permitted, homeStores: [storage objects],
// foodTable: { goodId: { hunger, energy, fun, comfort, social } }, tile (the
// settlement's world tile), kingdom }.
// Randomness only through Utils; world/player passed in; no import-time
// effects. Numbers and words: data/furnitureActions.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Underworld } from '../systems/underworld.js';
import { Laws } from '../systems/laws.js';
import { Ledger } from '../systems/ledger.js';
import { Fame } from '../systems/fame.js';
import { Economy } from '../world/economy.js';
import { pieceUsable } from '../world/furnitureUsable.js';
import { Wetness } from './wetness.js';
import { Tavern } from './tavern/index.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _day = world => (world && Number.isFinite(world.day) ? world.day : 0);
const _fill = (s, vars) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));

const DEFAULTS = {
    offers: {},
    byBuilding: {},
    decorOffers: {},
    homes: ['house', 'cottage', 'farm', 'manor', 'castle'],
    lodgings: ['tavern', 'inn', 'guest_house', 'hotel', 'roadhouse'],
    public: ['church', 'temple', 'chapel', 'library', 'bathhouse', 'town_hall'],
    privateFurniture: ['bed', 'washstand', 'tub', 'cradle'],
    sit: { types: ['chair', 'bench', 'stool', 'pew', 'table', 'desk'], perHour: { energy: 4, comfort: 7, fun: 1 }, maxHours: 3, minMinutes: 5, text: 'You get up after {time}: {gains}.' },
    sleep: {
        own: 1, permitted: 0.95, trespass: 0.8, rented: { common: 0.85, private: 1.1, suite: 1.3 },
        trespassOdds: { base: 0.2, perWitness: 0.18, ownerInside: 0.3, night: 0.1, nightFrom: 22, nightTo: 6, perStealth: -0.03, min: 0.05, max: 0.95 },
        trespassFine: { min: 4, max: 25, perHour: 2 }, trespassReputation: 2,
        notYours: "This isn't your bed. The household hasn't offered it.",
        caught: '{who} finds you in their bed and throws you out. Fined {fine}g for trespass{rep}.',
        unseen: "Nobody found you in a stranger's bed.",
    },
    warm: { types: ['fireplace', 'oven', 'forge', 'cauldron'], hours: 0.5, effects: { comfort: 12, fun: 3, energy: 2 }, dry: 45, coldComfort: 10, unlit: "The fire is out: there's no warmth in it.", text: 'You warm your hands at the {what}.', dried: ' Your clothes steam dry ({before}% → {after}% wet).', thawed: ' The chill goes out of your bones.' },
    read: { decor: ['books', 'papers'], hours: 2 },
    order_meal: { cost: 8, hours: 0.75, seatedComfort: 3, poor: "A meal is {cost} gold, and you haven't got it." },
    eat_home: { hours: 0.5, seatedComfort: 4, foods: ['cooked_meal', 'meat_pie', 'cooked_meat', 'bread', 'cheese'], empty: "There's nothing to eat in the house.", notHome: 'Only at your own table.' },
    wash_basin: { hours: 0.25, effects: { hygiene: 18, comfort: 3 }, notYours: "It's the household's washstand, not yours.", text: 'You splash your face and scrub your hands at the basin.' },
    bathe_tub: { hours: 1, effects: { hygiene: 55, comfort: 15, energy: 4, fun: 4 }, clothes: 70, notYours: "It's the household's bathtub, not yours.", text: 'You fill the tub and soak until the water goes cold.' },
    broken: {
        allow: ['look_inside', 'store', 'shop', 'buy_shelf', 'pray', 'give_alms'],
        text: 'The {what} is broken: no use to anyone until it is mended.',
        byType: {},
    },
};

function _bType(building) {
    return building ? String(building.type || '').replace(/^player_/, '') : null;
}

function _mod(player, effects, mult = 1) {
    const out = {};
    if (!player || !effects) return out;
    for (const [need, amt] of Object.entries(effects)) {
        const v = Math.round(_num(amt) * mult);
        if (!v) continue;
        if (typeof player.modifyNeed === 'function') player.modifyNeed(need, v);
        out[need] = v;
    }
    return out;
}

function _gainsText(g) {
    const parts = Object.entries(g).filter(([, v]) => v).map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${k}`);
    return parts.length ? parts.join(', ') : 'a rest for your legs';
}

export const FurnitureActions = {
    data() {
        return (DataLoader.get && DataLoader.get('furnitureActions')) || {};
    },

    /** One section of the data over its defaults. */
    cfg(key) {
        const d = FurnitureActions.data();
        const def = DEFAULTS[key];
        const v = d[key];
        if (def && typeof def === 'object' && !Array.isArray(def) && v && typeof v === 'object' && !Array.isArray(v)) return { ...def, ...v };
        return v != null ? v : def;
    },

    /**
     * What stands on a piece (tile._decor, the layout's): a list of kinds
     * ('books', 'mugs', ...). Takes a string, a list of strings or of
     * { type } / { kind }, or { items: [...] }; [] when there's none.
     */
    decor(furniture, tile = null) {
        const raw = (furniture && furniture._decor) || (tile && tile._decor) || (furniture && furniture.decor) || null;
        if (!raw) return [];
        const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : Array.isArray(raw.items) ? raw.items : [raw];
        const out = [];
        for (const d of list) {
            const k = typeof d === 'string' ? d : d && (d.type || d.kind || d.id);
            if (k && !out.includes(k)) out.push(String(k));
        }
        return out;
    },

    /** Whose a building is: 'own' | 'lodging' | 'public' | 'home' | 'business' | 'outdoors'. */
    standing(building) {
        if (!building) return 'outdoors';
        if (building.isPlayerOwned || building.isPlayerProperty || String(building.type || '').startsWith('player_')) return 'own';
        const bt = _bType(building);
        if (FurnitureActions.cfg('lodgings').includes(bt)) return 'lodging';
        if (FurnitureActions.cfg('public').includes(bt)) return 'public';
        if (FurnitureActions.cfg('homes').includes(bt)) return 'home';
        return 'business';
    },

    /**
     * Action keys from the data for a piece: { building: keys | null (this
     * building's list for the type: replaces every other), type: keys | null
     * (the type's list: replaces the built-in default), add: keys (for what
     * stands on it) }.
     */
    offers(type, building, furniture = null) {
        const bt = _bType(building);
        const by = FurnitureActions.cfg('byBuilding') || {};
        const offers = FurnitureActions.cfg('offers') || {};
        const inBuilding = (bt && by[bt] && by[bt][type]) || null;
        const ofType = offers[type] || null;
        const add = [];
        const dOff = FurnitureActions.cfg('decorOffers') || {};
        for (const d of FurnitureActions.decor(furniture)) {
            const o = dOff[d];
            const keys = Array.isArray(o) ? o : (o && bt && o[bt]) || [];
            for (const k of keys) if (!add.includes(k)) add.push(k);
        }
        return { building: inBuilding ? [...inBuilding] : null, type: ofType ? [...ofType] : null, add };
    },

    /** The room the player has taken in this house of hospitality tonight: the tier id, or null. */
    rentedHere(player, world, building) {
        const L = player && player.lodging;
        if (!L || !building) return null;
        const id = building.establishmentId;
        if (id != null && L.id !== id) return null;
        if (id == null && L.name && building.name && L.name !== building.name) return null;
        // (taken today, slept in tonight: Hospitality._morning clears it the next day)
        if (_num(L.night, -1) < _day(world) - 1) return null;
        return L.tier || 'private';
    },

    /**
     * Sleeping in this bed: { mode, mult, reason }.
     *   own        your own house                        → sleep
     *   rented     a room you've taken here tonight      → sleep (by the room)
     *   permitted  the household has offered it         → sleep
     *   public     a monastery's cot, a barracks bunk    → sleep
     *   lodging    an inn's bed you haven't taken        → take a room first
     *   trespass   someone else's                        → only as a trespass
     */
    bedAccess(ctx) {
        const S = FurnitureActions.cfg('sleep');
        const st = FurnitureActions.standing(ctx.building);
        if (st === 'own' || st === 'outdoors') return { mode: 'own', mult: _num(S.own, 1) };
        if (st === 'lodging') {
            const tier = FurnitureActions.rentedHere(ctx.player, ctx.world, ctx.building);
            if (tier) return { mode: 'rented', tier, mult: _num((S.rented || {})[tier], 1) };
            return { mode: 'lodging', mult: 0, reason: 'Take a room first: the beds here are let.' };
        }
        if (ctx.permitted) return { mode: 'permitted', mult: _num(S.permitted, 0.95) };
        if (st === 'public') return { mode: 'public', mult: _num(S.permitted, 0.95) };
        return { mode: 'trespass', mult: _num(S.trespass, 0.8), reason: S.notYours };
    },

    /** May the player use the household's own washstand or tub here? */
    _mayWash(ctx) {
        const st = FurnitureActions.standing(ctx.building);
        if (st === 'own' || st === 'outdoors' || st === 'public' || ctx.permitted) return true;
        if (st === 'lodging') return !!FurnitureActions.rentedHere(ctx.player, ctx.world, ctx.building);
        return false;
    },

    /** Is the fire in it lit? (a piece the layout marks lit: false is cold) */
    isLit(furniture) {
        if (!furniture) return true;
        if (furniture.lit === false || furniture.unlit === true || furniture.cold === true) return false;
        return true;
    },

    /** The first food the house has put by (in the order of data eat_home.foods): { id, store } or null. */
    homeFood(stores) {
        const foods = FurnitureActions.cfg('eat_home').foods || [];
        for (const id of foods) {
            for (const s of stores || []) {
                if (s && _num(s[id]) > 0) return { id, store: s };
            }
        }
        return null;
    },

    /**
     * Can a piece be used for this at all? A broken one (furniture.broken: wrecked in a
     * raid or a fire, world/innerMap/interiorState.js) is no bed, seat, fire or bench any
     * more: only looked into, emptied, or prayed at (data broken.allow). → { ok, reason }
     */
    usable(key, furniture) {
        const B = FurnitureActions.cfg('broken');
        // (the same rule the townsfolk go by: world/furnitureUsable.js)
        if (pieceUsable(furniture, key, B.allow || [])) return { ok: true };
        const type = String(furniture.type || '');
        const what = type.replace(/_/g, ' ') || 'piece';
        const by = (B.byType || {})[type];
        return { ok: false, reason: _fill(by || B.text, { what }) };
    },

    /** May the player do this here? → { ok, reason } */
    check(key, ctx) {
        const p = ctx.player || {};
        const u = FurnitureActions.usable(key, ctx.furniture);
        if (!u.ok) return u;
        switch (key) {
            case 'sleep': {
                const a = FurnitureActions.bedAccess(ctx);
                return a.mode === 'trespass' || a.mode === 'lodging' ? { ok: false, reason: a.reason } : { ok: true };
            }
            case 'sleep_trespass': {
                const a = FurnitureActions.bedAccess(ctx);
                return a.mode === 'trespass' ? { ok: true } : { ok: false, reason: 'You may sleep here openly.' };
            }
            case 'warm': {
                const W = FurnitureActions.cfg('warm');
                return FurnitureActions.isLit(ctx.furniture) ? { ok: true } : { ok: false, reason: W.unlit };
            }
            case 'order_meal': {
                const M = FurnitureActions.cfg('order_meal');
                const free = ctx.tile && ctx.world ? Fame.innFree(p, ctx.world, ctx.tile, 'meal') : false;
                if (!ctx.tile || !ctx.tile.settlement) return { ok: false, reason: 'Only in a town.' };
                if (!free && _num(p.gold) < _num(M.cost, 8)) return { ok: false, reason: _fill(M.poor, { cost: Utils.formatGold(_num(M.cost, 8)) }) };
                return { ok: true };
            }
            case 'eat_home': {
                const E = FurnitureActions.cfg('eat_home');
                if (FurnitureActions.standing(ctx.building) !== 'own') return { ok: false, reason: E.notHome };
                return FurnitureActions.homeFood(ctx.homeStores) ? { ok: true } : { ok: false, reason: E.empty };
            }
            case 'wash_basin': case 'bathe_tub': {
                const C = FurnitureActions.cfg(key);
                return FurnitureActions._mayWash(ctx) ? { ok: true } : { ok: false, reason: C.notYours };
            }
            default:
                return { ok: true };
        }
    },

    /** Energy, comfort and fun for `hours` sat (capped at maxHours; nothing under minMinutes). */
    sitGains(hours) {
        const S = FurnitureActions.cfg('sit');
        const h = Math.min(Math.max(0, _num(hours)), _num(S.maxHours, 3));
        if (h * 60 < _num(S.minMinutes, 5)) return {};
        const out = {};
        for (const [need, per] of Object.entries(S.perHour || {})) {
            const v = Math.round(_num(per) * h);
            if (v) out[need] = v;
        }
        return out;
    },

    /** Up out of the seat: the gains of the hours sat (now and since are absolute game hours). → { hours, gains, text } */
    standUp(player, seat, now) {
        const hours = Math.max(0, _num(now) - _num(seat && seat.since, now));
        const gains = FurnitureActions.sitGains(hours);
        _mod(player, gains);
        const mins = Math.round(hours * 60);
        const time = mins >= 90 ? `${Math.round(hours * 10) / 10} hours` : `${mins} minute${mins === 1 ? '' : 's'}`;
        const S = FurnitureActions.cfg('sit');
        return { hours, gains, text: Object.keys(gains).length ? _fill(S.text, { time, gains: _gainsText(gains) }) : null };
    },

    /** Odds of being found asleep in a stranger's bed (0..1). scene { witnesses, ownerInside }, hour. */
    trespassOdds(player, scene = {}, hour = 12) {
        const T = FurnitureActions.cfg('sleep').trespassOdds || DEFAULTS.sleep.trespassOdds;
        let c = _num(T.base, 0.2);
        c += Math.max(0, _num(scene.witnesses)) * _num(T.perWitness, 0.18);
        if (scene.ownerInside) c += _num(T.ownerInside, 0.3);
        // (the household comes home to bed: a night in their bed is more likely found)
        if (hour >= _num(T.nightFrom, 22) || hour < _num(T.nightTo, 6)) c += _num(T.night, 0.1);
        const stealth = _num(player && player.skills && player.skills.stealth);
        c += stealth * _num(T.perStealth, -0.03);
        return Math.min(_num(T.max, 0.95), Math.max(_num(T.min, 0.05), c));
    },

    /**
     * Lie down in someone else's bed for `hours`: one roll (Utils.random).
     * Caught → no sleep, a fine into the town's purse, standing lost, a caught
     * trespass on the charge sheet. Unseen → sleep (at the trespass mult) and a
     * trespass the realm half knows of. → { caught, fine, mult, text }
     */
    trespassSleep(player, world, ctx, hours = 8) {
        const S = FurnitureActions.cfg('sleep');
        const scene = ctx.scene || {};
        const chance = FurnitureActions.trespassOdds(player, scene, _num(ctx.hour, 12));
        const kingdom = ctx.kingdom || null;
        const where = { kingdom, q: ctx.worldQ, r: ctx.worldR };
        if (Utils.random() < chance) {
            const F = S.trespassFine || {};
            const law = Laws.punishment(world, kingdom);
            const want = Math.round((_num(F.min, 4) + _num(F.perHour, 2) * Math.max(1, _num(hours))) * law.fine);
            const fine = Math.min(_num(player.gold), Math.min(_num(F.max, 25), Math.max(_num(F.min, 4), want)));
            if (fine > 0) {
                player.gold = _num(player.gold) - fine;
                if (world) Economy.payNearest(world, ctx.worldQ != null ? ctx.worldQ : player.q, ctx.worldR != null ? ctx.worldR : player.r, fine);
                Ledger.record(player, 'fines', -fine);
            }
            const rep = _num(S.trespassReputation, 2);
            if (kingdom && player.reputation && rep) player.reputation[kingdom] = _num(player.reputation[kingdom]) - rep;
            Underworld.recordCrime(player, world, 'trespass', {
                ...where, caught: true,
                victim: { name: scene.ownerName || (ctx.building && ctx.building.name) || 'the household', type: 'villager', icon: '🧑' },
            });
            const text = _fill(S.caught, { who: scene.ownerName || 'The householder', fine: Utils.formatGold(fine), rep: kingdom && rep ? `, −${rep} standing in the realm` : '' });
            return { caught: true, chance, fine, mult: 0, text };
        }
        Underworld.recordCrime(player, world, 'trespass', { kingdom, caught: false, scale: 0.5 });
        return { caught: false, chance, fine: 0, mult: _num(S.trespass, 0.8), text: S.unseen };
    },

    /** Do it: → { ok, text, hours, ... } (the caller advances the clock by `hours`). */
    apply(key, ctx) {
        const chk = FurnitureActions.check(key, ctx);
        if (!chk.ok) return { ok: false, text: chk.reason, hours: 0 };
        const p = ctx.player;
        switch (key) {
            case 'warm': {
                const W = FurnitureActions.cfg('warm');
                const gains = _mod(p, W.effects);
                const before = Math.round(Wetness.get(p));
                let text = _fill(W.text, { what: String((ctx.furniture && ctx.furniture.name) || ctx.type || 'fire').toLowerCase() });
                if (before > 0) {
                    p.wetness = Math.max(0, before - _num(W.dry, 45));
                    text += _fill(W.dried, { before, after: Math.round(p.wetness) });
                }
                if (_num(p._soakedColdHours) > 0 || before >= 40) {
                    p._soakedColdHours = 0;
                    _mod(p, { comfort: _num(W.coldComfort, 10) });
                    text += W.thawed;
                }
                return { ok: true, text, hours: _num(W.hours, 0.5), gains, dried: before - Math.round(Wetness.get(p)) };
            }
            case 'wash_basin': case 'bathe_tub': {
                const C = FurnitureActions.cfg(key);
                let extra = 0;
                let clothes = 0;
                let soap = false;
                if (key === 'bathe_tub') {
                    const s = typeof p.useSoap === 'function' ? p.useSoap() : null;
                    if (s) { soap = true; extra = _num(s.hygiene); }
                    if (typeof p.washClothes === 'function' && typeof p.getClothesFreshness === 'function' && p.getClothesFreshness() < _num(C.clothes, 70)) {
                        clothes = Math.round(p.washClothes(_num(C.clothes, 70) + (s ? _num(s.clothes) : 0)) || 0);
                    }
                }
                const gains = _mod(p, { ...C.effects, hygiene: _num((C.effects || {}).hygiene) + extra });
                const text = `${C.text}${clothes > 0 ? ' Your clothes get a scrub too.' : ''}${soap ? ' (A cake of soap.)' : ''}`;
                return { ok: true, text, hours: _num(C.hours, 0.5), gains, clothes, soap };
            }
            case 'order_meal': {
                const M = FurnitureActions.cfg('order_meal');
                const res = Tavern.handleAction('buy_meal', p, ctx.tile, ctx.world) || [];
                _mod(p, { comfort: _num(M.seatedComfort, 3) });
                const r = res[0] || {};
                return { ok: true, text: r.text || 'You eat a hot meal at the table.', title: r.title, hours: _num(M.hours, 0.75) };
            }
            case 'eat_home': {
                const E = FurnitureActions.cfg('eat_home');
                const found = FurnitureActions.homeFood(ctx.homeStores);
                found.store[found.id] = _num(found.store[found.id]) - 1;
                if (found.store[found.id] <= 0) delete found.store[found.id];
                const def = (ctx.foodTable || {})[found.id] || { hunger: 15 };
                const gains = _mod(p, { hunger: def.hunger, energy: def.energy, fun: def.fun, social: def.social, comfort: _num(def.comfort) + _num(E.seatedComfort, 4) });
                const name = def.label || String(found.id).replace(/_/g, ' ');
                return { ok: true, text: `You sit down at your own table to ${name.toLowerCase()} from the larder.`, hours: _num(E.hours, 0.5), food: found.id, gains };
            }
            default:
                return { ok: true, text: null, hours: 0 };
        }
    },
};
