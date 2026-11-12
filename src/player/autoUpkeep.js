// ============================================
// AUTO UPKEEP — the day's last hours spent on the character's own needs
// ============================================
// When the player ends the day with action points left, the character spends
// them on its own upkeep instead of letting them go: the most pressing need
// first, with whatever is to hand where it stands, through the game's own
// actions at their own costs and effects:
//
//   eat a meal from the pack        (player.eatMeal, 0 AP)
//   bathe at the river / well / bathhouse  (player.bathe, 2 AP, the well's or bathhouse's coin)
//   scrub the clothes at water      (player.washClothesByHand, data/hospitality.json clothes.washByHandAP)
//   make camp in the wilds          (the Rest / Camp action: a camp beats sleeping rough)
//   an inn's room, laundry, bath, supper, bathhouse or grand hall (systems/hospitality.js book / buyService)
//   talk with the locals            (the Talk to Locals action's need effects, 1 AP)
//   a campfire in the wilds         (the Build Campfire action: 2 AP, 2 wood, warmth)
//
// Nothing risky, illegal or that touches people's opinion of the player: no
// drink (vows and companions watch it), no dice, no common-room bunk (thieves).
// Coin is spent only within a modest limit (data/autoUpkeep.json coin) and
// goes to the town that gave the service (Economy.payTown, in the services
// themselves). Modes: 'full' (upkeep and leisure), 'upkeep', 'off'.
//
// Pure: everything comes in as parameters; no randomness.

import { DataLoader } from '../core/dataLoader.js';
import { Hospitality } from '../systems/hospitality.js';
import { Gossip } from '../systems/gossip.js';
import { Trading } from './playerEconomy.js';
import { Companions } from '../systems/companions.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

const DEFAULTS = {
    enabled: true,
    below: { hunger: 45, hygiene: 55, clothes: 55, energy: 45, comfort: 45, social: 50, fun: 50 },
    weight: { hunger: 1.4, hygiene: 1.0, clothes: 0.9, energy: 1.2, comfort: 0.7, social: 0.6, fun: 0.6 },
    coin: { maxPerDay: 15, purseShare: 0.2 },
    coldBath: { colderThan: -10, unless: 25 },
    bathe: { ap: 2 },
    chat: { ap: 1, needs: { social: 10, fun: 3 }, times: 2 },
    campfire: { ap: 2, wood: 2, heal: 15, needs: { comfort: 10, fun: 3 } },
    services: { laundry: 'laundry', bath: 'bath', supper: 'supper', leisure: ['bathhouse', 'fine_dining'], room: 'private' },
    food: { enabled: true, buyBelow: 2, stock: 6, purseShare: 0.5 },
    company: { ap: 1, times: 2, needs: { social: 14, fun: 5 } },
    pastime: { ap: 1, times: 2, needs: { fun: 8 }, townNeeds: { fun: 8, social: 3 }, town: [], wild: [] },
};

const ROOM_ORDER = ['common', 'private', 'suite'];

export const AutoUpkeep = {
    MODES: ['full', 'upkeep', 'off'],

    config() {
        const d = _obj(DataLoader._gamedata && DataLoader._gamedata.autoUpkeep);
        const merge = (k) => ({ ...DEFAULTS[k], ..._obj(d[k]) });
        return {
            enabled: d.enabled !== false,
            below: merge('below'), weight: merge('weight'), coin: merge('coin'), coldBath: merge('coldBath'),
            bathe: merge('bathe'), chat: merge('chat'), campfire: merge('campfire'), services: merge('services'), food: merge('food'), company: merge('company'), pastime: merge('pastime'),
        };
    },

    /** A saved setting → a mode ('full' unless it says 'upkeep' or 'off'). */
    mode(setting) {
        return AutoUpkeep.MODES.includes(setting) ? setting : 'full';
    },

    /** Why the character can't see to itself tonight, or null. */
    blocked(player) {
        if (!player || !player.needs || player.needsEnabled === false) return 'no needs';
        if (player.jailState) return 'in jail';
        if (player.indenturedServitude) return 'in servitude';
        if (player.interregnum) return 'dead';
        if (!(_num(player.health, 1) > 0)) return 'dying';
        if (player.sieges && player.sieges.active) return 'at a siege';
        if (player.delves && player.delves.active) return 'below ground';
        if (player.dive) return 'under water';
        return null;
    },

    /** The coin the character will spend on itself tonight. */
    budget(player, cfg = AutoUpkeep.config()) {
        const gold = Math.max(0, _num(player && player.gold));
        return Math.max(0, Math.min(_num(cfg.coin.maxPerDay, 15), Math.floor(gold * _num(cfg.coin.purseShare, 0.2))));
    },

    /** How far a need is under its line, weighted (0 when it's fine). */
    _short(player, need, cfg) {
        const line = _num(cfg.below[need], 50);
        const v = need === 'clothes'
            ? (typeof player.getClothesFreshness === 'function' ? player.getClothesFreshness() : 100)
            : _num(player.needs && player.needs[need], 100);
        if (!(line > 0) || v >= line) return 0;
        return ((line - v) / line) * _num(cfg.weight[need], 1);
    },

    _washAP() {
        const C = DataLoader._gamedata && DataLoader._gamedata.hospitality && DataLoader._gamedata.hospitality.clothes;
        return C && Number.isFinite(C.washByHandAP) ? Math.max(0, C.washByHandAP) : 3;
    },

    _freshAt() {
        const C = DataLoader._gamedata && DataLoader._gamedata.hospitality && DataLoader._gamedata.hospitality.clothes;
        return C && Number.isFinite(C.freshAt) ? C.freshAt : 60;
    },

    /** The town's inns and hotels the character may use (none to an outlaw turned away). */
    _houses(player, world, tile) {
        if (!tile || !tile.settlement || !Hospitality.enabled()) return [];
        try {
            if (Gossip.refusesService(player, player.q, player.r, world).refused) return [];
        } catch { /* no gossip state: served */ }
        return Hospitality.listAt(world, player, player.q, player.r)
            .filter(v => v && !v.underConstruction && (v.owner === 'player' || (v.q === tile.q && v.r === tile.r)));
    },

    /** The cheapest open offer of a service in town → { house, price } or null. */
    _service(world, player, houses, sid, budget) {
        let best = null;
        for (const v of houses) {
            if (!v.services.includes(sid)) continue;
            const q = Hospitality.quote(world, player, v.id);
            const s = q && q.services.find(x => x.id === sid);
            if (!s || !s.ok || s.morning || s.price > budget) continue;
            if (!best || s.price < best.price) best = { house: v, price: s.price };
        }
        return best;
    },

    /** The cheapest safe room in town (no common-room bunk) → { house, tier, price } or null. */
    _room(world, player, houses, minTier, budget) {
        const min = Math.max(0, ROOM_ORDER.indexOf(minTier));
        let best = null;
        for (const v of houses) {
            const q = Hospitality.quote(world, player, v.id);
            if (!q || q.booked) continue;
            for (const t of q.tiers) {
                if (!t.ok || ROOM_ORDER.indexOf(t.id) < min || t.price > budget) continue;
                if (!best || t.price < best.price) best = { house: v, tier: t, price: t.price };
            }
        }
        return best;
    },

    /**
     * A market run for food when the pack runs thin in a town → run() or null.
     * Buys the cheapest edible goods on the stalls (Trading.buyGoods: the coin
     * goes to the town's market) up to cfg.food.stock meals, within
     * cfg.food.purseShare of the purse.
     */
    _marketFood(player, world, tile, cfg) {
        const F = cfg.food || {};
        if (F.enabled === false || !tile || !tile.settlement) return null;
        if (typeof player.getFoodCount !== 'function') return null;
        const have = player.getFoodCount();
        if (have > _num(F.buyBelow, 2)) return null;
        const edible = (player.constructor && player.constructor.FOOD_TYPES) || [];
        if (!edible.length) return null;
        let goods;
        try { goods = Trading.getAvailableGoods(tile.settlement, tile, world) || []; } catch { return null; }
        const stalls = goods.filter(g => g && edible.includes(g.id) && g.quantity > 0)
            .sort((a, b) => (a.price || 0) - (b.price || 0));
        if (!stalls.length) return null;
        return () => {
            const want = Math.max(1, Math.floor(_num(F.stock, 6)) - player.getFoodCount());
            const allowance = Math.max(0, Math.floor(_num(player.gold) * _num(F.purseShare, 0.5)));
            if (allowance <= 0) return null;
            const bought = [];
            let left = want;
            for (const g of stalls) {
                if (left <= 0) break;
                const before = _num(player.gold);
                const cap = allowance - Math.max(0, Math.round(_num(bought._spent)));
                let qty = Trading.affordable(player, g, tile.settlement, left);
                while (qty > 0 && Trading.buyCost(player, g, qty, tile.settlement) > cap) qty--;
                if (qty <= 0) continue;
                const res = Trading.buyGoods(player, g, qty, tile.settlement);
                if (!res || !res.success) continue;
                bought._spent = _num(bought._spent) + Math.max(0, before - _num(player.gold));
                bought.push(`${qty} ${(g.name || g.id).toLowerCase().replace(/_/g, ' ')}`);
                left -= qty;
            }
            if (!bought.length) return null;
            return { icon: '🧺', text: `bought ${bought.join(' and ')} at the ${tile.settlement.name || 'town'} market` };
        };
    },

    /** What could be done now, each { id, ap, cost, score, leisure, run() → step | null }. */
    options(player, world, ctx) {
        const { cfg, mode, ap, budget, done } = ctx;
        const tile = world && typeof world.getTile === 'function' ? world.getTile(player.q, player.r) : null;
        const s = (need) => AutoUpkeep._short(player, need, cfg);
        const out = [];
        const town = tile && tile.settlement;
        const ownHouse = (player.houses || []).some(h => h.q === player.q && h.r === player.r);
        const wild = tile && tile.terrain && tile.terrain.passable && !town && !player.boardedShip;
        const houses = AutoUpkeep._houses(player, world, tile);
        const freshAt = AutoUpkeep._freshAt();
        const add = (o) => { if (o.ap <= ap && o.cost <= budget && o.score > 0) out.push(o); };

        // ── Food ──
        if (s('hunger') > 0 && typeof player.getFoodCount === 'function' && player.getFoodCount() > 0 && !done.eat) {
            add({ id: 'eat', ap: 0, cost: 0, score: s('hunger'), run: () => {
                const r = player.eatMeal();
                return r.success ? { icon: '🍖', text: `ate some ${r.food.replace(/_/g, ' ')} from your pack` } : null;
            } });
        } else if (s('hunger') > 0 && !done.supper) {
            const offer = AutoUpkeep._service(world, player, houses, cfg.services.supper, budget);
            if (offer) add({ id: 'supper', ap: 0, cost: offer.price, score: s('hunger') * 0.9, run: () => AutoUpkeep._buy(world, player, offer, cfg.services.supper, 'had a hot supper at') });
        }
        // Provisions: in a town with a thin pack, buy a few days' food at the market (0 AP;
        // food has its own allowance — no one starves to save a few coins for a bath)
        const market = AutoUpkeep._marketFood(player, world, tile, cfg);
        if (market && !done.market) {
            const score = Math.max(s('hunger') * 1.2, 0.5);
            out.push({ id: 'market', ap: 0, cost: 0, score, run: market });
        }

        // ── Body and clothes ──
        const dirtyClothes = s('clothes');
        const place = typeof player.bathePlace === 'function' ? player.bathePlace(world) : null;
        if (place && !done.bathe && (s('hygiene') > 0 || (dirtyClothes > 0 && player.getClothesFreshness() < freshAt))) {
            const cold = AutoUpkeep._coldOf(place, world);
            const tooCold = cold <= _num(cfg.coldBath.colderThan, -10) && _num(player.needs.hygiene) >= _num(cfg.coldBath.unless, 25);
            if (!tooCold) {
                const score = s('hygiene') + (player.getClothesFreshness() < freshAt ? dirtyClothes : 0);
                add({ id: 'bathe', ap: _num(cfg.bathe.ap, 2), cost: place.cost || 0, score, run: () => {
                    const r = player.bathe(world);
                    if (!r.success) return null;
                    const where = r.kind === 'wild' ? `bathed in ${r.where}` : r.kind === 'well' ? `washed at ${r.where}` : `had a bath at ${r.where}`;
                    return { icon: r.kind === 'bathhouse' ? '🛁' : '🧼', text: `${r.clothes > 0 ? 'scrubbed your clothes and ' : ''}${where}`, cost: r.cost || 0 };
                } });
            }
        }
        const washWhere = typeof player.washWaterHere === 'function' ? player.washWaterHere(world) : null;
        if (dirtyClothes > 0 && washWhere && !done.wash) {
            add({ id: 'wash', ap: AutoUpkeep._washAP(), cost: 0, score: dirtyClothes, run: () => {
                const r = player.washClothesByHand(world);
                return r.success ? { icon: '🧺', text: `washed your clothes at ${r.where}` } : null;
            } });
        }
        if (dirtyClothes > 0 && !done.wash && !done.laundry) {
            const offer = AutoUpkeep._service(world, player, houses, cfg.services.laundry, budget);
            if (offer) add({ id: 'laundry', ap: 0, cost: offer.price, score: dirtyClothes * 0.85, run: () => AutoUpkeep._buy(world, player, offer, cfg.services.laundry, 'had your clothes laundered at') });
        }
        if (s('hygiene') > 0 && !done.bathe && !done.bath) {
            const offer = AutoUpkeep._service(world, player, houses, cfg.services.bath, budget);
            if (offer) add({ id: 'bath', ap: 0, cost: offer.price, score: s('hygiene') * 0.8, run: () => AutoUpkeep._buy(world, player, offer, cfg.services.bath, 'had a hot bath at') });
        }

        // ── A bed ──
        const booked = player._restTypeOverride === 'inn' || (player.lodging && player.lodging.night === _num(world && world.day));
        if (town && !ownHouse && !booked && !done.room && (s('energy') > 0 || s('comfort') > 0)) {
            const offer = AutoUpkeep._room(world, player, houses, cfg.services.room, budget);
            if (offer) add({ id: 'room', ap: 0, cost: offer.price, score: s('energy') + s('comfort'), run: () => {
                const r = Hospitality.book(world, player, offer.house.id, offer.tier.id);
                return r.ok ? { icon: '🛏️', text: `took ${String(offer.tier.name || 'a room').toLowerCase()} at ${offer.house.name}`, cost: r.cost || 0 } : null;
            } });
        }
        if (wild && !ownHouse && !player._restTypeOverride && !done.camp) {
            // Making camp on purpose always beats sleeping rough (the Rest / Camp action)
            add({ id: 'camp', ap: 0, cost: 0, score: 0.05 + s('energy') + s('comfort'), run: () => {
                player._restTypeOverride = 'camp';
                return { icon: '⛺', text: 'made a proper camp for the night' };
            } });
        }
        const fire = cfg.campfire;
        if (wild && _num(player.inventory && player.inventory.wood) >= _num(fire.wood, 2) && !done.campfire) {
            const hurt = _num(player.health, 100) < _num(player.maxHealth, 100) * 0.7 ? 0.3 : 0;
            const score = s('comfort') + hurt + (mode === 'full' ? s('fun') : 0);
            add({ id: 'campfire', ap: _num(fire.ap, 2), cost: 0, score, run: () => {
                player.inventory.wood -= _num(fire.wood, 2);
                if (player.inventory.wood <= 0) delete player.inventory.wood;
                player.health = Math.min(_num(player.maxHealth, 100), _num(player.health, 100) + _num(fire.heal, 15));
                for (const [need, amt] of Object.entries(_obj(fire.needs))) player.modifyNeed(need, amt);
                return { icon: '🔥', text: 'sat by a campfire' };
            } });
        }

        if (mode !== 'full') return out;

        // ── Leisure ──
        const chat = cfg.chat;
        if (town && (done.chat || 0) < _num(chat.times, 2) && (s('social') > 0 || s('fun') > 0)) {
            add({ id: 'chat', ap: _num(chat.ap, 1), cost: 0, leisure: true, score: s('social') + s('fun') * 0.5, run: () => {
                for (const [need, amt] of Object.entries(_obj(chat.needs))) player.modifyNeed(need, amt);
                return { icon: '🗣️', text: `talked with the folk of ${town.name}`, merge: 'chat' };
            } });
        }
        // Company on the road: a talk by the fire with a travelling companion (Companions.talk: their approval too)
        const comp = cfg.company;
        if ((s('social') > 0 || s('fun') > 0) && (done.company || 0) < _num(comp.times, 2)) {
            let mates = [];
            try { mates = Companions.members(player, world) || []; } catch { mates = []; }
            const day = _num(world && world.day);
            const mate = mates.find(n => n && n.isAlive !== false && !(n.companion && n.companion.lastTalkDay === day));
            if (mate) {
                add({ id: 'company', ap: _num(comp.ap, 1), cost: 0, leisure: true, score: (s('social') + s('fun') * 0.6) * 1.1, run: () => {
                    const r = Companions.talk(player, mate.id, world);
                    if (!r || !r.success) return null;
                    for (const [need, amt] of Object.entries(_obj(comp.needs))) player.modifyNeed(need, amt);
                    return { icon: '🔥', text: `passed the evening talking with ${mate.firstName || 'a companion'}` };
                } });
            }
        }
        // A pastime of one's own, anywhere: a tune, a carving, the street players, a walk
        const past = cfg.pastime;
        if (s('fun') > 0 && (done.pastime || 0) < _num(past.times, 2)) {
            const lines = town ? past.town : past.wild;
            const list = Array.isArray(lines) && lines.length ? lines : ['passed an hour at an idle pastime'];
            const n = done.pastime || 0;
            const text = list[(_num(world && world.day) + n) % list.length];
            const needs = _obj(town ? past.townNeeds : past.needs);
            add({ id: 'pastime', ap: _num(past.ap, 1), cost: 0, leisure: true, score: s('fun') * 0.8 + (town ? s('social') * 0.2 : 0), run: () => {
                for (const [need, amt] of Object.entries(needs)) player.modifyNeed(need, amt);
                return { icon: '🎶', text: String(text).replace('{town}', (town && town.name) || 'the town'), merge: 'pastime' };
            } });
        }
        if (s('fun') > 0 && !done.leisure) {
            for (const sid of cfg.services.leisure || []) {
                const offer = AutoUpkeep._service(world, player, houses, sid, budget);
                if (!offer) continue;
                const S = Hospitality.service(sid) || {};
                const n = _obj(S.needs);
                const score = (s('fun') + (n.social ? s('social') : 0) + (n.hygiene ? s('hygiene') : 0) + (n.hunger ? s('hunger') : 0)) * 0.9;
                add({ id: 'leisure', key: sid, ap: 0, cost: offer.price, leisure: true, score, run: () => AutoUpkeep._buy(world, player, offer, sid, 'spent the evening at') });
            }
        }
        return out;
    },

    _coldOf(place, world) {
        if (!place || place.kind !== 'wild') return 0;
        const B = DataLoader._gamedata && DataLoader._gamedata.hospitality && DataLoader._gamedata.hospitality.bathing;
        const cold = _obj(B && B.cold);
        const season = (world && world.season) || 'Summer';
        return _num(cold[season], { Spring: -4, Summer: 0, Autumn: -6, Winter: -14 }[season] || 0);
    },

    _buy(world, player, offer, sid, verb) {
        const r = Hospitality.buyService(world, player, offer.house.id, sid);
        if (!r.ok) return null;
        const S = Hospitality.service(sid) || {};
        return { icon: S.icon || '🛎️', text: `${verb} ${offer.house.name}`, cost: r.cost || 0 };
    },

    /**
     * Spend the day's leftover points on the character's upkeep.
     * opts: { mode: 'full'|'upkeep'|'off', ap (default player.actionPoints) }
     * → { steps: [{ id, icon, text, ap, cost }], apSpent, coinSpent, text } or null when nothing was done.
     */
    run(player, world, opts = {}) {
        const cfg = AutoUpkeep.config();
        const mode = AutoUpkeep.mode(opts.mode);
        if (!cfg.enabled || mode === 'off' || AutoUpkeep.blocked(player)) return null;
        // (no points left still lets the character eat and buy food: both take none)
        let ap = Math.max(0, Math.floor(_num(opts.ap != null ? opts.ap : player.actionPoints)));
        let budget = AutoUpkeep.budget(player, cfg);
        const done = {};
        const steps = [];
        let apSpent = 0, coinSpent = 0;
        for (let guard = 0; guard < 12; guard++) {
            const opts2 = AutoUpkeep.options(player, world, { cfg, mode, ap, budget, done });
            if (!opts2.length) break;
            // Most pressing first; then free before paid, then the quicker
            opts2.sort((a, b) => (b.score - a.score) || (a.cost - b.cost) || (a.ap - b.ap));
            const pick = opts2[0];
            const goldBefore = _num(player.gold);
            const step = pick.run();
            done[pick.id] = (done[pick.id] || 0) + 1;
            if (!step) continue;
            const paid = Math.max(0, Math.round(goldBefore - _num(player.gold)));
            ap -= pick.ap;
            // (provisions have their own allowance: they don't eat the evening's comforts budget)
            if (pick.id !== 'market') budget = Math.max(0, budget - paid);
            apSpent += pick.ap;
            coinSpent += paid;
            const last = steps[steps.length - 1];
            if (step.merge && last && last.merge === step.merge) { last.ap += pick.ap; continue; }
            steps.push({ id: pick.id, icon: step.icon, text: step.text, ap: pick.ap, cost: paid, merge: step.merge || null });
        }
        if (!steps.length) return null;
        player.actionPoints = Math.max(0, _num(player.actionPoints) - apSpent);
        return { steps, apSpent, coinSpent, text: AutoUpkeep.describe(steps) };
    },

    /** "With the day's last hours you washed your clothes at the river and took a private room at the Gilded Goose (11g)." */
    describe(steps) {
        const bits = steps.map(s => s.text + (s.cost > 0 ? ` (${s.cost}g)` : ''));
        const list = bits.length > 1 ? `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}` : bits[0];
        return `With the day's last hours you ${list}.`;
    },
};
