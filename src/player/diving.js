// ============================================
// DIVING — under the water of an inner map, scavenging the bottom
// ============================================
//
// The player swims out (world/innerMap/swimming.js, player/swimming.js) and
// dives: down on one breath, groping along the bottom for what lies there.
// Where the Dive is offered and how it looks is ui/innerMapDiving.js; what a
// dive brings up and what it costs is here:
//
//   • breath(player): seconds you can stay down, longer as you get used to
//     the water (player.swimPractice, the same practice swimming builds).
//   • waterOf(tile): the water body (sea, lake, river, pond: tile._waterKind)
//     and its depth (tile._deep), which pick the table.
//   • plan(player, length): a quick dive, a full one or one pushed past your
//     breath → { bottom, breath, over, grabs, minutes, realSeconds }.
//   • rollFind(player, water, opts): one grab of the bottom: nothing, a find
//     from the tables (food, shells, junk, lost things) or, rarely, treasure
//     (likelier in the deep sea, with luck, and by a wreck).
//   • dive(player, world, worldTile, opts): the whole dive: the finds into the
//     packs (PlayerInventory.addItem; what won't fit is let go), gold from a
//     sunken chest, energy and practice, a wash; past your breath, hurt, and
//     a chance to black out and lose the haul; cold water hurts more.
//
// Numbers and tables in data/diving.json. Randomness through Utils; player and
// world passed in.

import { DataLoader } from '../core/dataLoader.js';
import { PlayerInventory } from '../core/inventory.js';
import { Utils } from '../core/utils.js';
import { Containers } from '../systems/containers.js';
import { Swimming } from './swimming.js';

const DEFAULTS = {
    breath: { base: 30, perPractice: 60 },
    grabSeconds: 10,
    lengths: {
        quick: { share: 0.5, minutes: 5 },
        full: { share: 0.9, minutes: 10 },
        push: { share: 1.4, minutes: 15 },
    },
    realSeconds: { base: 1.5, perGrab: 0.5, max: 7 },
    energy: 5,
    practiceEnergyCut: 0.5,
    minEnergy: 15,
    hygiene: 6,
    comfort: -3,
    practicePerDive: 5,
    overHealthPerSecond: 0.5,
    blackout: { chance: 0.08, perOverSecond: 0.004, health: 25 },
    cold: { mult: 2, health: 3, comfort: -8, blackout: 0.06 },
    repeatCut: 0.6,
    wreckRange: 3,
    treasure: { chance: {}, wreckMult: 4, luckPer: 0.05, finds: [] },
    tables: {},
};

const KINDS = ['sea', 'lake', 'river', 'pond'];

function _num(v, d) { return typeof v === 'number' && Number.isFinite(v) ? v : d; }

function _qty(q) {
    if (Array.isArray(q)) return Utils.randInt(Math.round(q[0]), Math.round(q[1]));
    return Math.max(1, Math.round(_num(q, 1)));
}

function _pick(list, weightOf) {
    const total = list.reduce((s, e) => s + Math.max(0, weightOf(e)), 0);
    if (!(total > 0)) return null;
    let roll = Utils.random() * total;
    for (const e of list) {
        roll -= Math.max(0, weightOf(e));
        if (roll <= 0) return e;
    }
    return list[list.length - 1];
}

export const Diving = {
    config() {
        const g = DataLoader._gamedata;
        const d = (g && g.diving) || {};
        return {
            ...DEFAULTS, ...d,
            breath: { ...DEFAULTS.breath, ...(d.breath || {}) },
            lengths: { ...DEFAULTS.lengths, ...(d.lengths || {}) },
            realSeconds: { ...DEFAULTS.realSeconds, ...(d.realSeconds || {}) },
            blackout: { ...DEFAULTS.blackout, ...(d.blackout || {}) },
            cold: { ...DEFAULTS.cold, ...(d.cold || {}) },
            treasure: { ...DEFAULTS.treasure, ...(d.treasure || {}) },
            tables: d.tables || DEFAULTS.tables,
        };
    },

    /** Seconds the player can stay under on one breath. */
    breath(player) {
        const C = Diving.config();
        return Math.round(C.breath.base + Swimming.practice(player) * C.breath.perPractice);
    },

    /** The water at a map tile: { kind: 'sea'|'lake'|'river'|'pond', deep } */
    waterOf(tile) {
        const kind = tile && KINDS.includes(tile._waterKind) ? tile._waterKind : (tile && tile._sea ? 'sea' : 'pond');
        return { kind, deep: !!(tile && tile._deep) };
    },

    /** May the player dive now? → { ok, reason } (as for a swim, and not too tired to hold a breath) */
    canDive(player) {
        const swim = Swimming.canSwim(player);
        if (!swim.ok) return swim;
        const energy = player.needs ? _num(player.needs.energy, 100) : 100;
        if (energy < Diving.config().minEnergy) return { ok: false, reason: 'You are too tired to hold your breath and go down. Rest first.' };
        return { ok: true, reason: null };
    },

    /**
     * How a dive of `length` ('quick' | 'full' | 'push') goes for this player:
     * { length, breath, bottom, over, grabs, minutes, realSeconds } (seconds).
     */
    plan(player, length = 'full') {
        const C = Diving.config();
        const L = C.lengths[length] || C.lengths.full;
        const breath = Diving.breath(player);
        const bottom = Math.round(breath * _num(L.share, 0.9));
        const over = Math.max(0, bottom - breath);
        const grabs = Math.max(1, Math.floor(bottom / Math.max(1, C.grabSeconds)));
        const R = C.realSeconds;
        const realSeconds = Math.min(_num(R.max, 7), _num(R.base, 1.5) + grabs * _num(R.perGrab, 0.5));
        return { length: C.lengths[length] ? length : 'full', breath, bottom, over, grabs, minutes: _num(L.minutes, 10), realSeconds };
    },

    /** The common finds for this water (deep water with no table of its own uses the shallows'). */
    table(water) {
        const t = Diving.config().tables[water.kind] || {};
        return (water.deep ? t.deep || t.shallow : t.shallow || t.deep) || [];
    },

    /** The chance a grab turns up treasure here. */
    treasureChance(player, water, { nearWreck = false } = {}) {
        const T = Diving.config().treasure;
        const byKind = (T.chance && T.chance[water.kind]) || {};
        let p = _num(water.deep ? byKind.deep : byKind.shallow, 0);
        if (nearWreck) p *= _num(T.wreckMult, 1);
        const luck = _num(player && player.luck, 5);
        p *= Math.max(0.5, 1 + (luck - 5) * _num(T.luckPer, 0));
        return Math.max(0, Math.min(0.5, p));
    },

    /** The treasures that can lie in this water. */
    treasures(water) {
        return (Diving.config().treasure.finds || []).filter(f =>
            (!f.kinds || f.kinds.includes(water.kind)) && (!f.deep || water.deep));
    },

    /**
     * One grab of the bottom → a find { item, qty, gold, name, icon, rare, text } or null.
     * opts: { nearWreck, picked (dives at this spot today) }
     */
    rollFind(player, water, { nearWreck = false, picked = 0 } = {}) {
        const C = Diving.config();
        // A spot already picked over today: often there is nothing left to find
        if (picked > 0 && Utils.random() >= Math.pow(_num(C.repeatCut, 0.6), picked)) return null;
        if (Utils.random() < Diving.treasureChance(player, water, { nearWreck })) {
            const f = _pick(Diving.treasures(water), e => (nearWreck && e.wreckWeight != null ? e.wreckWeight : _num(e.weight, 1)));
            if (f) return Diving._find(f, true);
        }
        const e = _pick(Diving.table(water), x => _num(x.weight, 1));
        return e && e.item ? Diving._find(e, false) : null;
    },

    _find(e, rare) {
        if (Array.isArray(e.gold)) {
            return { item: null, qty: 1, gold: Utils.randInt(e.gold[0], e.gold[1]), name: e.name || 'Sunken Chest', icon: e.icon || '🧰', rare, text: e.text || null };
        }
        const g = Containers.good(e.item);
        return { item: e.item, qty: _qty(e.qty), gold: 0, name: e.name || g.name, icon: e.icon || g.icon, rare, text: e.text || null };
    },

    /**
     * The whole dive, applied to the player.
     * opts: { kind, deep, length, nearWreck, picked, fraction (0..1: cut short) }
     * → { plan, finds[], added{}, dropped{}, gold, hurt, cold, blackout, drowned, practice }
     */
    dive(player, world, worldTile, opts = {}) {
        const C = Diving.config();
        const water = { kind: KINDS.includes(opts.kind) ? opts.kind : 'pond', deep: !!opts.deep };
        const plan = Diving.plan(player, opts.length);
        const frac = Math.max(0, Math.min(1, _num(opts.fraction, 1)));
        const bottom = plan.bottom * frac;
        const over = Math.max(0, bottom - plan.breath);
        const grabs = frac >= 1 ? plan.grabs : Math.floor(bottom / Math.max(1, C.grabSeconds));
        const cold = Swimming.isCold(world, worldTile);
        const out = { plan, water, finds: [], added: {}, dropped: {}, gold: 0, hurt: 0, cold, blackout: false, drowned: false, practice: 0 };

        // The bottom, a grab at a time
        const finds = [];
        for (let i = 0; i < grabs; i++) {
            const f = Diving.rollFind(player, water, { nearWreck: !!opts.nearWreck, picked: _num(opts.picked, 0) });
            if (f) finds.push(f);
        }

        // Past your breath: it hurts, and you may black out
        let hurt = 0;
        if (over > 0) {
            hurt += over * C.overHealthPerSecond * (cold ? _num(C.cold.mult, 1) : 1);
            const pBlack = _num(C.blackout.chance, 0) + over * _num(C.blackout.perOverSecond, 0) + (cold ? _num(C.cold.blackout, 0) : 0);
            if (Utils.random() < pBlack) {
                out.blackout = true;
                hurt += _num(C.blackout.health, 25);
            }
        }
        if (cold) hurt += _num(C.cold.health, 0);

        // Costs and practice
        const prac = Swimming.practice(player);
        const SC = Swimming.config();
        if (typeof player.modifyNeed === 'function' && player.needs) {
            const share = Math.max(0.3, plan.bottom / Math.max(1, plan.breath)) * frac;
            player.modifyNeed('energy', -C.energy * share * (1 - prac * C.practiceEnergyCut));
            if (_num(player.needs.hygiene, 100) < SC.hygieneMax) player.modifyNeed('hygiene', Math.min(C.hygiene, SC.hygieneMax - player.needs.hygiene));
            player.modifyNeed('comfort', C.comfort + (cold ? _num(C.cold.comfort, 0) : 0));
        }
        const before = _num(player.swimPractice, 0);
        player.swimPractice = Math.min(SC.practiceMax, before + C.practicePerDive);
        out.practice = player.swimPractice - before;
        player.dives = _num(player.dives, 0) + 1;

        out.hurt = Math.round(hurt * 10) / 10;
        player.health = Math.max(0, _num(player.health, 100) - out.hurt);
        out.drowned = player.health <= 0;

        // Blacked out: you come to on the surface, the haul let go
        if (out.blackout || out.drowned) return out;

        for (const f of finds) {
            out.finds.push(f);
            if (f.gold > 0) {
                player.gold = _num(player.gold, 0) + f.gold;
                out.gold += f.gold;
                continue;
            }
            if (PlayerInventory.addItem(player, f.item, f.qty).success) out.added[f.item] = (out.added[f.item] || 0) + f.qty;
            else out.dropped[f.item] = (out.dropped[f.item] || 0) + f.qty;
        }
        if (out.finds.some(f => f.rare)) player.diveTreasures = _num(player.diveTreasures, 0) + 1;
        return out;
    },
};
