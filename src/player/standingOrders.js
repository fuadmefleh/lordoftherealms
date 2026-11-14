// ============================================
// STANDING ORDERS — what the day's spare hours go on
// ============================================
// The player sets an order once; at each day's end (End Turn, and every day of
// a Wait / ⏩ Week, which run the real End Turn) the character carries it out
// with the points the day left, after self-care (player/autoUpkeep.js) has had
// its share. Once a day, through the game's own actions at their own costs —
// nothing here is free:
//
//   rest      nothing more
//   work      a day's labour in town (OddJobs.complete: the pay out of the
//             town's purse by its going wage, the training, the town's own
//             gain); the job your practised trade knows comes first
//   estates   collect what your properties and herds here have stored
//             (the Collect Goods action: into your packs, if they have room)
//   train     spar with the town's trainer (Combat Training's quick path):
//             the fee into the town's purse, a chance at combat, the army drills
//   gather    the quick forage in the wilds (Foraging.quickForage), or a quick
//             fishing trip where there is water (FoodSkills.rollFish / fishXp)
//   drill     your companies drilled: experience for green men (no veterans
//             past maxLevel — battle makes those), wear on their kits
//   devotion  prayer at a church or holy site, meditation elsewhere
//             (Devotion.devote: rest, karma, an omen now and then)
//
// Each costs its action's AP and energy (Endurance.labour) and need effects.
// An order that can't run where the player stands (no town, no water, no
// soldiers, too tired, the outlaw turned away, a parents' rule…) says why and
// the character rests. Tunables: data/standingOrders.json.
//
// State: player.standingOrder = { id, last: { day, id, ran, icon, text, why,
// ap, gold } } (saved, systems/saveLoad.js). Domain rules: player / world are
// parameters; randomness through Utils (and the seeded streams of the systems
// it calls).

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { Seasons } from '../world/seasons.js';
import { Woodlands } from '../world/woodlands.js';
import { PlayerInventory } from '../core/inventory.js';
import { Economy } from '../world/economy.js';
import { Gossip } from '../systems/gossip.js';
import { Devotion } from '../systems/devotion.js';
import { FoodSkills } from '../systems/foodSkills.js';
import { PracticeSkills } from '../systems/practiceSkills.js';
import { Livestock } from '../systems/livestock.js';
import { Arms } from '../systems/arms.js';
import { OddJobs } from './oddJobs.js';
import { Foraging, Hunting } from './foraging.js';
import { Gathering } from './gathering.js';
import { HuntingBow } from './huntingBow.js';
import { Endurance } from './endurance.js';
import { SeasonalWork } from './seasonalWork.js';
import { Parentage } from './parentage.js';
import { PlayerEconomy } from './playerEconomy.js';
import { AutoUpkeep } from './autoUpkeep.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

const ORDER_IDS = ['rest', 'work', 'estates', 'train', 'gather', 'fell', 'hunt', 'drill', 'devotion'];
/** Wooded ground a tree can be felled on (the Clear Trees action's). */
const FOREST = ['woodland', 'boreal_forest', 'seasonal_forest', 'temperate_rainforest', 'tropical_rainforest', 'forest', 'dense_forest'];
/** Ground with game to hunt (the Hunt action's). */
const HUNT_GROUND = ['forest', 'dense_forest', 'woodland', 'boreal_forest', 'seasonal_forest', 'temperate_rainforest', 'tropical_rainforest', 'plains', 'grassland', 'steppe', 'savanna', 'hills', 'highlands', 'coast', 'beach'];
const WATER = ['ocean', 'deep_ocean', 'coast', 'lake', 'sea'];
const DEEP = ['ocean', 'deep_ocean', 'sea'];

const DEFAULTS = {
    enabled: true,
    minEnergy: 15,
    minHealthShare: 0.3,
    orders: {
        rest: { name: 'Rest only', icon: '🛌' },
        work: { name: 'Work in town', icon: '🔨' },
        estates: { name: 'Tend your holdings', icon: '📦' },
        train: { name: 'Train at arms', icon: '⚔️' },
        gather: { name: 'Forage or fish', icon: '🌿' },
        fell: { name: 'Fell timber', icon: '⚒️' },
        hunt: { name: 'Hunt', icon: '🏹' },
        drill: { name: 'Drill your soldiers', icon: '🎖️' },
        devotion: { name: 'Pray and study', icon: '🧘' },
    },
    work: { ap: 4, energy: 8, needs: { social: 5 }, score: 40, professionWeight: 3 },
    gather: {
        forage: { ap: 3, energy: 8, needs: { hygiene: -5, fun: 5 } },
        fish: { ap: 3, energy: 5, needs: { fun: 12, comfort: 5 }, secondChance: 0.4, luckChance: 0.08 },
        fishFirstBelow: 3,
    },
    train: { ap: 4, energy: 15, needs: { hygiene: -10, fun: 8 }, fee: { capital: 75, other: 50 }, skillChance: 0.15, armyXp: 8, keepGold: 20 },
    drill: { ap: 4, energy: 10, needs: { hygiene: -6 }, xp: 3, maxLevel: 2, levelAt: 100, kitWear: 0.5 },
    estates: { ap: 1 },
    fell: { ap: 4, needs: { hygiene: -5 }, maxSwings: 40 },
    hunt: { ap: 4, energy: 12, needs: { hygiene: -8, fun: 10 } },
    devotion: { ap: 3, needs: { comfort: 15, energy: 8, fun: 3 }, quality: 0.5 },
};

function _tileOf(player, world) {
    return world && typeof world.getTile === 'function' ? world.getTile(player.q, player.r) : null;
}

function _needs(player, needs) {
    if (typeof player.modifyNeed !== 'function') return;
    for (const [need, amt] of Object.entries(_obj(needs))) player.modifyNeed(need, _num(amt));
}

function _labour(player, energy) {
    if (energy > 0 && player.needs) Endurance.labour(player, energy);
}

const _goodName = (id) => String(id || '').replace(/_/g, ' ');

export const StandingOrders = {
    ORDERS: ORDER_IDS,

    config() {
        const d = _obj(DataLoader._gamedata && DataLoader._gamedata.standingOrders);
        const merge = (k) => ({ ...DEFAULTS[k], ..._obj(d[k]) });
        const orders = {};
        for (const id of ORDER_IDS) orders[id] = { ...DEFAULTS.orders[id], ..._obj(_obj(d.orders)[id]) };
        const gather = merge('gather');
        gather.forage = { ...DEFAULTS.gather.forage, ..._obj(_obj(d.gather).forage) };
        gather.fish = { ...DEFAULTS.gather.fish, ..._obj(_obj(d.gather).fish) };
        return {
            enabled: d.enabled !== false,
            minEnergy: _num(d.minEnergy, DEFAULTS.minEnergy),
            minHealthShare: _num(d.minHealthShare, DEFAULTS.minHealthShare),
            orders,
            work: merge('work'), gather, train: merge('train'), fell: merge('fell'), hunt: merge('hunt'), drill: merge('drill'), estates: merge('estates'), devotion: merge('devotion'),
        };
    },

    /** The order's display: { id, name, icon, desc }. */
    def(id) {
        const o = StandingOrders.config().orders[id] || StandingOrders.config().orders.rest;
        return { id: ORDER_IDS.includes(id) ? id : 'rest', name: o.name, icon: o.icon, desc: o.desc || '' };
    },

    /** Every order, in menu order. */
    list() {
        return ORDER_IDS.map(id => StandingOrders.def(id));
    },

    /** The player's order id ('rest' unless one is set). */
    get(player) {
        const s = player && player.standingOrder;
        return s && ORDER_IDS.includes(s.id) ? s.id : 'rest';
    },

    /** Set the order. → { ok, id } (an unknown id is refused). */
    set(player, id) {
        if (!player || !ORDER_IDS.includes(id)) return { ok: false, id: StandingOrders.get(player) };
        const s = _obj(player.standingOrder);
        player.standingOrder = { ...s, id };
        return { ok: true, id };
    },

    /** Why nothing can be done tonight whatever the order, or null. */
    blocked(player, world) {
        if (!player) return 'no one';
        if (player.jailState) return 'You are in a cell.';
        if (player.indenturedServitude) return 'Your days are your master\'s.';
        if (player.interregnum || player._isDead) return 'You are gone from the world.';
        if (!(_num(player.health, 1) > 0)) return 'You are dying.';
        if (player.sieges && player.sieges.active) return 'You are at a siege.';
        if (player.delves && player.delves.active) return 'You are below ground.';
        if (player.dive) return 'You are under water.';
        if (player.boardedShip) return 'You are aboard ship.';
        if (player.isMoving || player.queuedPath) {
            const c = typeof player.crossingStatus === 'function' ? player.crossingStatus(world) : null;
            return c && c.longHex ? `You are crossing ${c.name}.` : 'You are on the road.';
        }
        return null;
    },

    /** Too worn to work: low energy or health (work orders only). → reason or null */
    _worn(player, cfg) {
        const share = _num(player.health, 100) / Math.max(1, _num(player.maxHealth, 100));
        if (share < cfg.minHealthShare) return 'You are too hurt to work; you rest instead.';
        if (player.needs && _num(player.needs.energy, 100) < cfg.minEnergy) return 'You are too worn out; you rest instead.';
        return null;
    },

    /** A parents' rule against it (a standing order never defies them). → reason or null */
    _parents(player, world, type) {
        let c = null;
        try { c = Parentage.check(player, world, type); } catch { c = null; }
        if (!c) return null;
        return c.refused ? c.text : 'Your parents forbid it, and an order is not worth their anger.';
    },

    /** The settlement here that will serve the player, or a reason. */
    _town(player, world, tile, refusable) {
        if (!tile || !tile.settlement) return { why: 'There is no town here.' };
        if (refusable) {
            try {
                const v = Gossip.refusesService(player, player.q, player.r, world);
                if (v && v.refused) return { why: v.reason || 'The town turns you away.' };
            } catch { /* no gossip state: served */ }
        }
        return { town: tile.settlement };
    },

    // ── The orders, each → { ap, label, run() → step } or { why } ──

    /** The day's job for this player in this town: their trade's first, then what suits them. */
    pickJob(player, world, settlement, cfg = StandingOrders.config()) {
        const tier = settlement.type === 'capital' ? 'capital' : (settlement.type === 'town' || settlement.type === 'city' ? 'town' : 'village');
        const oj = _obj(DataLoader.earlyJobs && DataLoader.earlyJobs.oddJobs);
        const lists = _obj(oj.settlement_jobs);
        const base = Array.isArray(lists[tier]) ? lists[tier] : (Array.isArray(lists.village) ? lists.village : []);
        const jobs = [...SeasonalWork.jobsFor(tier, _num(world && world.day, 1), oj), ...base];
        if (!jobs.length) return null;
        const pw = _num(cfg.work.professionWeight, 3);
        let best = null, bestScore = -Infinity;
        jobs.forEach((job, i) => {
            let trade = 0;
            for (const id of Object.keys(_obj(job.practice))) {
                try { trade = Math.max(trade, _num(PracticeSkills.level(player, id))); } catch { /* unknown skill */ }
            }
            const pay = (_num(job.pay && job.pay.min) + _num(job.pay && job.pay.max)) / 2;
            const fit = OddJobs.statValue(player, job.stat) * 1.5 * OddJobs.wageFactor(settlement, job.sector);
            // (a seasonal job when it's in season, as the board lists it first; ties by the board's order)
            const score = trade * pw * 10 + pay * OddJobs.wageFactor(settlement, job.sector) + fit + (job.seasonal ? 5 : 0) - i * 0.001;
            if (score > bestScore) { bestScore = score; best = job; }
        });
        return best;
    },

    _work(player, world, tile, cfg) {
        const W = cfg.work;
        const t = StandingOrders._town(player, world, tile, true);
        if (t.why) return { why: t.why };
        const p = StandingOrders._parents(player, world, 'odd_jobs');
        if (p) return { why: p };
        const job = StandingOrders.pickJob(player, world, t.town, cfg);
        if (!job) return { why: 'No one is hiring here.' };
        return {
            ap: _num(W.ap, 4), label: `${job.icon || '🔨'} ${job.name}`,
            run: () => {
                _labour(player, _num(W.energy, 8));
                _needs(player, W.needs);
                const res = OddJobs.complete(player, world, t.town, job, _num(W.score, 40));
                const town = t.town.name || 'town';
                const learnt = res.gains.filter(g => g.kind !== 'practice' || g.event).map(g => g.kind === 'practice' ? g.event.text : `${g.id} +${g.by}`);
                let text = `worked as ${/^[aeiou]/i.test(job.name) ? 'an' : 'a'} ${job.name.toLowerCase()} in ${town} for ${res.pay} gold`;
                if (res.factors && res.factors.short) text += ` (the town could not pay the rest)`;
                if (res.contribution) text += `; the work brought ${res.contribution.qty} ${_goodName(res.contribution.good)} to its market`;
                if (learnt.length) text += ` (${learnt.join(', ')})`;
                return { icon: job.icon || '🔨', text, gold: res.pay };
            },
        };
    },

    _gather(player, world, tile, cfg) {
        const G = cfg.gather;
        if (!tile || !tile.terrain || !tile.terrain.passable) return { why: 'There is nothing to gather here.' };
        const forageData = DataLoader.earlyJobs && DataLoader.earlyJobs.foraging;
        const canForage = !tile.settlement && !!Foraging.lootTableFor(tile, forageData);
        const fish = StandingOrders._fishSpot(world, tile);
        const forageWhy = StandingOrders._parents(player, world, 'forage');
        const fishWhy = StandingOrders._parents(player, world, 'fish');
        const food = typeof player.getFoodCount === 'function' ? player.getFoodCount() : 99;
        const fishFirst = fish && !fishWhy && food < _num(G.fishFirstBelow, 3);
        if (canForage && !forageWhy && !fishFirst) {
            return {
                ap: _num(G.forage.ap, 3), label: '🌿 Forage',
                run: () => {
                    _labour(player, _num(G.forage.energy, 8));
                    _needs(player, G.forage.needs);
                    const res = Foraging.quickForage(player, tile, forageData);
                    if (!res.success) return { icon: '🌿', text: 'searched the land and found nothing' };
                    const name = `${res.qty} ${String(res.entry.name || _goodName(res.entry.item)).toLowerCase()}`;
                    let text = res.added ? `foraged ${name}` : `foraged ${name} but had no room to carry it`;
                    if (res.rankUp) text += ` (${res.rankUp.name})`;
                    return { icon: res.entry.icon || '🌿', text };
                },
            };
        }
        if (fish && !fishWhy) {
            return {
                ap: _num(G.fish.ap, 3), label: '🎣 Fish',
                run: () => {
                    _labour(player, _num(G.fish.energy, 5));
                    _needs(player, G.fish.needs);
                    return StandingOrders._fishTrip(player, fish, G.fish);
                },
            };
        }
        if (forageWhy || fishWhy) return { why: forageWhy || fishWhy };
        return { why: tile.settlement ? 'There is no water to fish here, and nothing grows to forage in town.' : 'Nothing grows here worth gathering, and there is no water to fish.' };
    },

    /** Water to fish from this tile, as Go Fishing finds it → { depth } or null. */
    _fishSpot(world, tile) {
        if (!tile || !tile.terrain || !tile.terrain.passable) return null;
        const near = Hex.neighbors(tile.q, tile.r).map(n => world.getTile(n.q, n.r)).filter(t => t && t.terrain);
        const isCoast = ['coast', 'beach'].includes(tile.terrain.id);
        if (!isCoast && !near.some(t => WATER.includes(t.terrain.id))) return null;
        const deepSea = near.some(t => DEEP.includes(t.terrain.id));
        const seaShore = isCoast || near.some(t => t.terrain.id === 'coast');
        return { isCoast, deepSea, seaShore };
    },

    /** The quick fishing trip (Go Fishing's quick path): 1–2 catches into the packs, XP. */
    _fishTrip(player, spot, F) {
        const deep = FoodSkills.canFishDeep(player, spot.deepSea, spot.seaShore);
        const depth = deep ? 'deep' : (spot.isCoast ? 'mid' : 'shallow');
        const angler = FoodSkills.fishing(player);
        const luck = _num(player.luck, 5);
        const tries = 1 + (Utils.random() < _num(F.secondChance, 0.4) + angler.bites ? 1 : 0);
        const landed = [];
        const names = [];
        for (let i = 0; i < tries; i++) {
            const fish = FoodSkills.rollFish(player, depth, () => Utils.random(), luck);
            if (!fish || !fish.name || !(fish.value > 0)) continue;
            if (!PlayerInventory.addItem(player, fish.name, 1).success) continue;
            landed.push(fish);
            names.push(String(fish.label || _goodName(fish.name)).toLowerCase() + (fish.bigger ? ' (a big one)' : ''));
        }
        let text = names.length ? `fished and landed ${names.join(' and ')}` : 'fished, but nothing was biting';
        if (Utils.random() < _num(F.luckChance, 0.08)) {
            player.luck = luck + 1;
            text += '; luck smiled on you (+1 luck)';
        }
        const up = FoodSkills.fishXp(player, { casts: tries, catches: landed, quick: true });
        if (up && up.name) text += ` (${up.name})`;
        return { icon: '🎣', text };
    },

    /**
     * A tree of these woods, as the inner map's scatter would put one down
     * (data/townProps.json: a wild tree with a fell block), drawn by its weight
     * → a def like world/townProps.js builds: { id, name, objectType, resource, resistance, gives }
     */
    pickTree() {
        const props = ((DataLoader._gamedata && DataLoader._gamedata.townProps) || {}).props || [];
        const trees = props.filter(p => p && (p.tags || []).includes('tree') && !(p.tags || []).includes('palm') && p.wild && p.fell);
        if (!trees.length) return { id: 'tree', name: 'Tree', objectType: 'tree', resource: { type: 'wood', amount: 40 }, resistance: 25, gives: [] };
        const total = trees.reduce((t, p) => t + Math.max(0, _num(p.wild.weight, 0.1)), 0);
        let roll = Utils.random() * total;
        let pick = trees[trees.length - 1];
        for (const p of trees) {
            roll -= Math.max(0, _num(p.wild.weight, 0.1));
            if (roll < 0) { pick = p; break; }
        }
        const w = pick.wild, f = pick.fell;
        const amount = w.amount != null ? w.amount : w.wood != null ? w.wood : f.wood != null ? f.wood : 40;
        return { id: pick.id, name: pick.name || 'Tree', objectType: 'tree', resource: { type: w.give || 'wood', amount }, resistance: _num(f.hardness, 0), gives: Array.isArray(f.gives) ? f.gives : [], stump: f.stump || null };
    },

    /** Swings to bring a tree down: the inner map's blow (strength, luck, the tree's hardness) × Gathering.damageMult (skill, axe, a logging camp here). */
    swingsFor(player, def, tile) {
        // (the inner map's blow, world/woodlands.js — the same function its swings use)
        const blow = Woodlands.blowDamage(player, def) * Gathering.damageMult(player, def, tile);
        return Math.max(1, Math.ceil(100 / Math.max(1, blow)));
    },

    _fell(player, world, tile, cfg) {
        const F = cfg.fell;
        if (!tile || !tile.terrain || tile.settlement || !FOREST.includes(tile.terrain.id) || !Woodlands.stock(tile.terrain.id)) return { why: 'There are no woods to fell here.' };
        // (the hex's trees: every felling on it — by hand, the town's woodcutters, this order — holds one back until it grows again)
        const standing = Woodlands.standing(world, tile.q, tile.r, tile.terrain.id);
        if (standing <= 0) return { why: 'The woods here are cut over; they will grow back in time.' };
        const p = StandingOrders._parents(player, world, 'clear_trees');
        if (p) return { why: p };
        const camp = Gathering.campBoost(player, { objectType: 'tree' }, tile);
        return {
            ap: _num(F.ap, 4), label: `⚒️ Fell a tree (${standing} standing)${camp ? ` (your ${camp.name})` : ''}`,
            run: () => {
                const def = StandingOrders.pickTree();
                const swings = Math.min(_num(F.maxSwings, 40), StandingOrders.swingsFor(player, def, tile));
                // every blow tires and teaches as it does on the map (Gathering.swing)
                const ups = [];
                for (let i = 0; i < swings; i++) {
                    const sw = Gathering.swing(player, def);
                    if (sw && sw.levelUp) ups.push(sw.levelUp);
                }
                _needs(player, F.needs);
                const season = world && Number.isFinite(world.day) ? Seasons.seasonOf(world.day) : null;
                const got = Gathering.felled(player, def, def.resource, tile.terrain.id, season, tile);
                // the tree is gone from the hex until it grows back (world.felled, as the inner map keeps its own)
                Woodlands.fell(world, tile.q, tile.r, def.id, def.stump, _num(world && world.day));
                ups.push(...got.levelUps);
                const res = def.resource.type;
                const kept = PlayerInventory.addItem(player, res, got.amount).success;
                const more = [];
                for (const g of got.gives || []) {
                    if (PlayerInventory.addItem(player, g.item, g.qty).success) more.push(`${g.qty} ${_goodName(g.item)}`);
                }
                const a = /^[aeiou]/i.test(def.name) ? 'an' : 'a';
                let text = kept
                    ? `felled ${a} ${String(def.name).toLowerCase()} in ${swings} swings for ${got.amount} ${_goodName(res)}`
                    : `felled ${a} ${String(def.name).toLowerCase()}, but had no room for the ${_goodName(res)}`;
                if (kept && got.campExtra) text += ` (${got.campExtra} more from your ${got.camp.name})`;
                if (more.length) text += `, and ${more.join(', ')}`;
                const named = ups.map(u => u && u.name).filter(Boolean);
                if (named.length) text += ` (${named.join(', ')})`;
                return { icon: '⚒️', text };
            },
        };
    },

    _hunt(player, world, tile, cfg) {
        const H = cfg.hunt;
        if (!tile || !tile.terrain || tile.settlement || !HUNT_GROUND.includes(tile.terrain.id)) return { why: 'There is no game to hunt here.' };
        const forageData = DataLoader.earlyJobs && DataLoader.earlyJobs.foraging;
        const huntData = DataLoader.earlyJobs && DataLoader.earlyJobs.hunting;
        const category = ((forageData && forageData.terrain_mapping) || {})[tile.terrain.id];
        const table = category && huntData && huntData.loot_table && huntData.loot_table[category];
        if (!Array.isArray(table) || !table.length) return { why: 'There is no game to hunt here.' };
        const gear = HuntingBow.gear(player);
        if (!gear.ok) return { why: gear.reason };
        const p = StandingOrders._parents(player, world, 'hunt');
        if (p) return { why: p };
        return {
            ap: _num(H.ap, 4), label: `🏹 Hunt (${HuntingBow.arrows(player)} to loose)`,
            run: () => {
                _labour(player, _num(H.energy, 12));
                _needs(player, H.needs);
                // The quick hunt (ui/actionMenu/jobs.js _huntQuick): a few shots at one quarry
                const prey = Hunting.pickPrey(table, player) || table[0];
                const shots = HuntingBow.quickShots(player, prey);
                if (!shots.ok) return { icon: '🏹', text: 'went out to hunt, but had nothing to shoot with', fail: true };
                const name = String(prey.name || 'quarry').toLowerCase();
                let text;
                if (shots.fumble) player.health = Math.max(1, _num(player.health, 1) - _num(shots.fumble.damage));
                if (!shots.killed) {
                    // (a day in the field is still experience)
                    Hunting.finishTrip(player, []);
                    text = shots.wounded ? `hunted and wounded a ${name}, but it got away` : `hunted a ${name}, but it got away`;
                } else {
                    const res = Hunting.quickHunt(player, table, prey);
                    const got = `${res.qty} ${String(res.entry.name || _goodName(res.entry.item)).toLowerCase()}`;
                    text = res.added ? `hunted and took ${got}` : `hunted and took ${got}, but had no room to carry it`;
                    if (res.rankUp) text += ` (${res.rankUp.name})`;
                }
                text += ` (${shots.shots} ${shots.shots === 1 ? 'shot' : 'shots'} loosed${shots.recovered ? `, ${shots.recovered} recovered` : ''})`;
                if (shots.fumble) text += `; the string lashed your arm (-${shots.fumble.damage} health)`;
                if (shots.broke) text += '; your bow broke';
                return { icon: '🏹', text };
            },
        };
    },

    /** The trainer's fee in this town. */
    trainFee(settlement, cfg = StandingOrders.config()) {
        const F = _obj(cfg.train.fee);
        return settlement && settlement.type === 'capital' ? _num(F.capital, 75) : _num(F.other, 50);
    },

    /**
     * Pay the town's trainer (Combat Training, by hand or by order): the fee
     * out of the purse and into the town's. → { ok, fee } (ok false: can't pay).
     */
    payTrainer(player, settlement, cfg = StandingOrders.config()) {
        const fee = StandingOrders.trainFee(settlement, cfg);
        if (!player || _num(player.gold) < fee) return { ok: false, fee };
        player.gold = _num(player.gold) - fee;
        Economy.payTown(settlement, fee);
        if (player.financeToday) {
            player.financeToday.expenses = player.financeToday.expenses || {};
            player.financeToday.expenses.training = _num(player.financeToday.expenses.training) + fee;
        }
        return { ok: true, fee };
    },

    _train(player, world, tile, cfg) {
        const T = cfg.train;
        const t = StandingOrders._town(player, world, tile, true);
        if (t.why) return { why: t.why };
        const p = StandingOrders._parents(player, world, 'train_combat');
        if (p) return { why: p };
        const fee = StandingOrders.trainFee(t.town, cfg);
        if (_num(player.gold) - fee < _num(T.keepGold, 20)) return { why: `The trainer wants ${fee} gold, and your purse can't spare it.` };
        return {
            ap: _num(T.ap, 4), label: `⚔️ Spar (${fee}g)`,
            run: () => {
                // (the fee to the town's trainer: into its purse)
                StandingOrders.payTrainer(player, t.town, cfg);
                _labour(player, _num(T.energy, 15));
                _needs(player, T.needs);
                let text = `sparred with the trainer in ${t.town.name || 'town'} (${fee}g)`;
                if (Utils.random() < _num(T.skillChance, 0.15)) {
                    player.skills = player.skills || {};
                    player.skills.combat = Math.min(10, _num(player.skills.combat, 1) + 1);
                    text += '; your combat improved';
                }
                const army = Array.isArray(player.army) ? player.army : [];
                if (army.length && _num(T.armyXp) > 0) {
                    for (const unit of army) unit.experience = _num(unit.experience) + _num(T.armyXp);
                    text += `; your soldiers drilled alongside (+${_num(T.armyXp)} xp)`;
                }
                return { icon: '⚔️', text, gold: -fee };
            },
        };
    },

    _drill(player, world, tile, cfg) {
        const D = cfg.drill;
        const army = (Array.isArray(player.army) ? player.army : []).filter(u => u && _num(u.count, 1) > 0);
        if (!army.length) return { why: 'You have no soldiers to drill.' };
        if (!army.some(u => _num(u.level, 1) < _num(D.maxLevel, 2))) return { why: 'Your soldiers are seasoned past anything drill can teach them; battle makes veterans.' };
        const p = StandingOrders._parents(player, world, 'drill');
        if (p) return { why: p };
        return {
            ap: _num(D.ap, 4), label: `🎖️ Drill ${army.length} ${army.length === 1 ? 'company' : 'companies'}`,
            run: () => {
                _labour(player, _num(D.energy, 10));
                _needs(player, D.needs);
                const maxLevel = _num(D.maxLevel, 2);
                const at = _num(D.levelAt, 100);
                let green = 0, rose = 0;
                for (const unit of army) {
                    if (_num(unit.level, 1) >= maxLevel) continue;
                    green++;
                    unit.experience = _num(unit.experience) + _num(D.xp, 3);
                    if (unit.experience >= at) {
                        unit.level = _num(unit.level, 1) + 1;
                        unit.experience = 0;
                        if (Number.isFinite(unit.strength)) unit.strength = Math.floor(unit.strength * 1.2);
                        rose++;
                    }
                }
                // (the drill knocks the kit about: mending it at a smith costs coin, systems/arms.js)
                try { Arms.wearKits(player, _num(D.kitWear, 0.5)); } catch { /* no arms data */ }
                let text = `drilled your soldiers (+${_num(D.xp, 3)} xp to ${green} green ${green === 1 ? 'company' : 'companies'})`;
                if (rose) text += `; ${rose} ${rose === 1 ? 'company is' : 'companies are'} no longer green`;
                return { icon: '🎖️', text };
            },
        };
    },

    /** What is stored here for the taking: { props, herds }. */
    _stored(player, tile) {
        const props = tile ? PlayerEconomy.getPropertiesAt(tile).filter(p => p.produces && p.produces !== 'gold' && p.storage > 0) : [];
        let herds = [];
        try { herds = Object.keys(Livestock.storeAt(player, tile.q, tile.r)); } catch { herds = []; }
        return { props, herds };
    },

    /**
     * Collect stored goods from every property and herd on this tile into the
     * packs (the Collect Goods action). → { parts: ['3 Grain', …], full }
     */
    collectHere(player, world, tile) {
        if (!player.inventory) player.inventory = {};
        const parts = [];
        let full = false;
        for (const prop of PlayerEconomy.getPropertiesAt(tile)) {
            // Taverns pay out directly; their storage only tallies earnings
            if (!prop.produces || prop.produces === 'gold' || !(prop.storage > 0)) continue;
            const good = prop.produces;
            // No room for a new kind of good — it waits in the property's storage
            if (!PlayerInventory.addItem(player, good, prop.storage).success) { full = true; continue; }
            const goodDef = PlayerEconomy.GOODS[good.toUpperCase()];
            parts.push(`${prop.storage} ${goodDef ? goodDef.name : good}`);
            prop.storage = 0;
        }
        // ...and the eggs, milk, wool and feathers of your beasts kept here (systems/livestock.js)
        const herd = Livestock.collectAt(world, player, tile.q, tile.r);
        for (const [good, n] of Object.entries(herd.taken)) {
            const goodDef = PlayerEconomy.GOODS[good.toUpperCase()];
            parts.push(`${n} ${goodDef ? goodDef.name : good}`);
        }
        if (herd.full) full = true;
        return { parts, full };
    },

    _estates(player, world, tile, cfg) {
        if (!tile) return { why: 'You hold nothing here.' };
        const own = PlayerEconomy.getPropertiesAt(tile).length > 0;
        const s = StandingOrders._stored(player, tile);
        if (!own && !s.herds.length) return { why: 'You hold no property or beasts here.' };
        if (!s.props.length && !s.herds.length) return { why: 'Nothing is waiting in storage here today.' };
        return {
            ap: _num(cfg.estates.ap, 1), label: '📦 Collect the stores',
            run: () => {
                const r = StandingOrders.collectHere(player, world, tile);
                if (!r.parts.length) return { icon: '🎒', text: 'went to collect your stores, but your packs are full', fail: true };
                return { icon: '📦', text: `collected ${r.parts.join(', ')} from your holdings${r.full ? ' (some stays in storage: your packs are full)' : ''}` };
            },
        };
    },

    _devotion(player, world, tile, cfg) {
        const V = cfg.devotion;
        if (!tile || !tile.terrain || !tile.terrain.passable) return { why: 'There is no quiet ground here.' };
        const p = StandingOrders._parents(player, world, 'meditate');
        if (p) return { why: p };
        const place = tile.holySite ? 'holy' : (tile.religiousBuilding ? 'temple' : 'field');
        const kind = place === 'field' ? 'meditate' : 'pray';
        return {
            ap: _num(V.ap, 3), label: kind === 'pray' ? '🙏 Pray' : '🧘 Meditate',
            run: () => {
                _needs(player, V.needs);
                const res = Devotion.devote(player, world, { kind, place, tile, quality: _num(V.quality, 0.5) });
                const bits = [];
                if (res.heal > 0) bits.push(`+${res.heal} health`);
                if (res.karma > 0) bits.push(`+${res.karma} karma`);
                if (res.faith > 0) bits.push('deeper faith');
                if (res.intelligence > 0) bits.push('a clearer mind');
                let text = `${kind === 'pray' ? 'prayed' : 'meditated'}${place === 'holy' ? ' at the holy site' : place === 'temple' ? ' in the church' : ''}${bits.length ? ` (${bits.join(', ')})` : ''}`;
                if (res.omen && res.omen.text) text += `. ${res.omen.text}`;
                if (res.harm > 0) text += `; it cost you ${res.harm} health`;
                return { icon: kind === 'pray' ? '🙏' : '🧘', text };
            },
        };
    },

    /**
     * What the order would do here now → { id, ok, ap, label, why, run? }.
     * `ap` is the points it takes; `ok` false with `why` when it can't run.
     */
    plan(player, world, opts = {}) {
        const cfg = opts.cfg || StandingOrders.config();
        const id = opts.id || StandingOrders.get(player);
        if (id === 'rest') return { id, ok: false, rest: true, why: null };
        const blocked = StandingOrders.blocked(player, world);
        if (blocked) return { id, ok: false, why: blocked };
        if (id !== 'devotion' && id !== 'estates') {
            const worn = StandingOrders._worn(player, cfg);
            if (worn) return { id, ok: false, why: worn };
        }
        const tile = _tileOf(player, world);
        const fn = { work: '_work', estates: '_estates', train: '_train', gather: '_gather', fell: '_fell', hunt: '_hunt', drill: '_drill', devotion: '_devotion' }[id];
        const r = fn ? StandingOrders[fn](player, world, tile, cfg) : { why: 'Unknown order.' };
        if (r.why) return { id, ok: false, why: r.why };
        const ap = Math.max(0, Math.floor(_num(opts.ap != null ? opts.ap : player.actionPoints)));
        if (r.ap > ap) return { id, ok: false, ap: r.ap, label: r.label, why: `It takes ${r.ap} AP and the day left you ${ap}.`, short: true };
        return { id, ok: true, ap: r.ap, label: r.label, run: r.run };
    },

    /**
     * Carry out the order with the day's spare points (after AutoUpkeep).
     * opts: { ap (default player.actionPoints) }.
     * → null for 'rest' (nothing to tell), else { id, ran, icon, text, why, ap, gold, title }
     * and the same is kept on player.standingOrder.last.
     */
    run(player, world, opts = {}) {
        const cfg = StandingOrders.config();
        if (!cfg.enabled || !player) return null;
        const id = StandingOrders.get(player);
        if (id === 'rest') return null;
        const day = _num(world && world.day);
        const def = StandingOrders.def(id);
        const plan = StandingOrders.plan(player, world, { cfg, id, ap: opts.ap });
        let out;
        if (!plan.ok) {
            out = { id, ran: false, icon: def.icon, text: `${def.name}: ${plan.why} You rested.`, why: plan.why, ap: 0, gold: 0 };
        } else {
            const goldBefore = _num(player.gold);
            const step = plan.run() || { icon: def.icon, text: 'did nothing of note' };
            const ran = !step.fail;
            if (ran) player.actionPoints = Math.max(0, _num(player.actionPoints) - plan.ap);
            const gold = Math.round(_num(player.gold) - goldBefore);
            const text = step.text.charAt(0).toUpperCase() + step.text.slice(1);
            out = { id, ran, icon: step.icon || def.icon, text: `With the spare hours you ${step.text}.`, line: text, why: null, ap: ran ? plan.ap : 0, gold };
        }
        out.day = day;
        out.title = `${def.icon} Standing Order`;
        player.standingOrder = { ..._obj(player.standingOrder), id, last: { day, id, ran: out.ran, icon: out.icon, text: out.text, why: out.why, ap: out.ap, gold: out.gold } };
        return out;
    },

    /**
     * The day's last hours in order: self-care (AutoUpkeep), then the standing
     * order with what is left. With an order set and leisure on ('full'), the
     * needs that matter come first (food, a wash, clean clothes, a bed: the
     * 'upkeep' pass), then the order, then leisure with any points still left.
     * → { upkeep: AutoUpkeep result (steps merged) | null, order: run() | null }
     */
    endOfDay(player, world, opts = {}) {
        const mode = AutoUpkeep.mode(opts.upkeepMode);
        const id = StandingOrders.get(player);
        if (id === 'rest' || mode !== 'full') {
            const upkeep = mode === 'off' ? null : AutoUpkeep.run(player, world, { mode });
            return { upkeep, order: StandingOrders.run(player, world) };
        }
        const first = AutoUpkeep.run(player, world, { mode: 'upkeep' });
        const order = StandingOrders.run(player, world);
        const after = AutoUpkeep.run(player, world, { mode: 'full' });
        const steps = [...((first && first.steps) || []), ...((after && after.steps) || [])];
        const upkeep = steps.length ? {
            steps,
            apSpent: _num(first && first.apSpent) + _num(after && after.apSpent),
            coinSpent: _num(first && first.coinSpent) + _num(after && after.coinSpent),
            text: AutoUpkeep.describe(steps),
        } : null;
        return { upkeep, order };
    },
};
