// ============================================
// ARMS — weapons, shields and armour: worn, wielded, worn out and issued
// ============================================
// The catalogue is data/arms.json: every weapon (daggers, swords, axes,
// maces, spears, polearms, bows), shield (buckler to pavise), helm and body
// armour (gambeson to plate), each with its slot, class, material and stats
// (cut / pierce / blunt, reach, weight, handling, armour penetration, block,
// cover, protection by damage type). The pieces themselves are ordinary
// goods in the packs (player.inventory, graded by core/grades.js) — forged
// at the anvil (data/crafting.json station `arms`), bought, looted, ordered
// from a town smith (systems/commissions.js).
//
// The player's equipment: player.equipment = { main, off, head, body }, each
//   undefined — nothing chosen: the best piece carried for the slot is taken
//               up (and recorded) the first time it is asked for;
//   null      — deliberately empty (fists, no shield...);
//   { id, cond, edge } — the piece worn: its condition and its edge (0..100).
// The piece stays in the packs (sold, stolen or dropped, the slot empties);
// a stack of several is worn at its best grade. A two-handed weapon leaves
// no hand for a shield.
//
// Wear: a duel dulls the blade and dents the harness (wearFromDuel, from
// Duels.result), harm on the road wears the armour (PlayerEffects.scaleDamage),
// a battle the commander's gear and every soldier's kit. Worn pieces work
// less well; at 0 a piece breaks and is gone. Mending takes the item's own
// repair goods at an anvil (yourself) or a town smith's fee with the goods
// bought out of the town's stock; a whetstone or the smith's grindstone puts
// the edge back.
//
// Troops: a recruit is issued a kit (unit.kit = { main, off, head, body,
// g: { slot: grade index }, cond }) for his unit type (data/arms.json troops):
// from the player's packs first, else bought from the town's market stock at
// its price (the coin to the town's purse), else he comes with what he owns.
// A unit's worth in battle is scaled by unitFactor (Common iron kit = 1, a
// bare man `bare`, Fine steel above 1). Units without a kit record (older
// saves, mercenaries, ships, siege engines) fight as they always did (1).
//
// Pure domain module: player / world / settlement are parameters; the only
// randomness (a whetstone cracking) is the seeded Utils RNG.

import { DataLoader } from '../core/dataLoader.js';
import { Grades } from '../core/grades.js';
import { Utils } from '../core/utils.js';
import { PlayerInventory } from '../core/inventory.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Economy } from '../world/economy.js';
import { Ledger } from './ledger.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _r2 = (v) => Math.round(v * 100) / 100;
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

export const ARMS_SLOTS = ['main', 'off', 'head', 'body'];

const DEFAULT_WEAR = {
    edgePerBlow: 2.5, condPerBlow: 0.5, condPerHit: 1.2, sparShare: 0.25, guardPerBlock: 0.4,
    perHarm: 0.35, battle: 4, kitBattle: 6, worn: 50, brokenMult: 0.5, edgeMult: 0.6,
    whetstoneBreak: 0.2, grindFee: 3, mendFee: 0.12, mendFeeMin: 4, kitMendShare: 0.15,
};
const DEFAULT_DUEL = { reachPerPoint: 0.03, heavyAt: 2.5, heavyCost: 1, staminaPerKg: 0.12, freeKg: 8, npcReach: 1 };

let _src;
let _cfg = null;

function _data() {
    const gd = DataLoader._gamedata;
    return (gd && _obj(gd.arms)) || {};
}

function _goodsTable() {
    const pe = DataLoader._gamedata && DataLoader._gamedata.playerEconomy;
    return (pe && pe.GOODS) || {};
}

function _withArticle(name) {
    const n = String(name || '').toLowerCase();
    return /^[aeiou]/.test(n) ? `an ${n}` : `a ${n}`;
}

export const Arms = {
    SLOTS: ARMS_SLOTS,

    // ── The catalogue ─────────────────────────────────

    config() {
        const d = _data();
        if (!_cfg || d !== _src) {
            _src = d;
            const items = {};
            for (const [id, it] of Object.entries(_obj(d.items) || {})) {
                if (!_obj(it) || id.startsWith('_')) continue;
                items[id] = { id, ...it };
            }
            const troops = _obj(d.troops) || {};
            _cfg = {
                items,
                slots: _obj(d.slots) || {},
                classes: _obj(d.classes) || {},
                wear: { ...DEFAULT_WEAR, ...(_obj(d.wear) || {}) },
                duel: { ...DEFAULT_DUEL, ...(_obj(d.duel) || {}) },
                kits: _obj(troops.kits) || {},
                market: _obj(troops.market) || {},
                maxFactor: _num(troops.maxFactor, 1.45),
                spoils: { per: 40, max: 6, goods: ['weapons'], ...(_obj(d.spoils) || {}) },
                ammo: {
                    goods: { bow: 'arrows', crossbow: 'bolts' }, units: {}, dryMult: 0.35, recover: 0.3, fieldVolley: 0.4,
                    ...(_obj(d.ammo) || {}),
                },
            };
        }
        return _cfg;
    },

    /** Every arms item: { id: def }. */
    items() {
        return Arms.config().items;
    },

    /** One item's definition, or null. */
    item(id) {
        return (id && Arms.config().items[id]) || null;
    },

    isArms(id) {
        return !!Arms.item(id);
    },

    /** The goods' display name (data/playerEconomy.json GOODS), else the catalogue's. */
    nameOf(id) {
        const def = Arms.item(id);
        if (def && def.name) return def.name;
        const g = _goodsTable()[String(id).toUpperCase()];
        return (g && g.name) || String(id || '').replace(/_/g, ' ');
    },

    iconOf(id) {
        const g = _goodsTable()[String(id).toUpperCase()];
        if (g && g.icon) return g.icon;
        const def = Arms.item(id);
        const s = def && Arms.config().slots[def.slot];
        return (s && s.icon) || '⚔️';
    },

    basePrice(id) {
        const g = _goodsTable()[String(id).toUpperCase()];
        return g && g.basePrice > 0 ? g.basePrice : 0;
    },

    /**
     * What the renderers need to draw a piece (soldiers on the inner map,
     * the player): { id, slot, class, material, weaponClass, layer, layers,
     * hands } — layer/layers are LPC paths under assets/lpc/Characters (null
     * when the art is still to be made: draw by weaponClass).
     */
    spriteOf(id) {
        const def = Arms.item(id);
        if (!def) return null;
        const s = _obj(def.sprite) || {};
        const layer = s.layer || null;
        return {
            id, slot: def.slot, class: def.class, material: def.material || null,
            weaponClass: s.weaponClass || def.class, layer,
            layers: Array.isArray(s.layers) ? s.layers.slice() : (layer ? [layer] : []),
            hands: _num(def.hands, 1),
        };
    },

    /** The arms items of a slot (optionally of some classes). */
    itemsFor(slot, classes = null) {
        return Object.values(Arms.items()).filter(d => d.slot === slot && (!classes || classes.includes(d.class)));
    },

    // ── Stats ─────────────────────────────────────────

    /** Effect of a piece's condition (1 above `worn`, down to brokenMult at 0). */
    condMult(cond) {
        const W = Arms.config().wear;
        const c = _clamp(_num(cond, 100), 0, 100);
        if (c >= W.worn) return 1;
        return _r2(W.brokenMult + (1 - W.brokenMult) * (c / Math.max(1, W.worn)));
    },

    /** Effect of a blade's edge (1 sharp, edgeMult blunt). */
    edgeMult(edge) {
        const W = Arms.config().wear;
        return _r2(W.edgeMult + (1 - W.edgeMult) * _clamp(_num(edge, 100), 0, 100) / 100);
    },

    /**
     * A piece's working stats at a grade (index or id), condition and edge:
     * { id, name, slot, class, hands, melee, dmg, dtype, attack, reach,
     *   weight, pen, block, riposte, cover, prot, vs, effect }.
     * dmg = the best of cut/pierce/blunt ÷ 2 (the duel's weapon damage).
     */
    stats(id, grade = Grades.COMMON, cond = 100, edge = 100) {
        const def = Arms.item(id);
        if (!def) return null;
        const gi = grade == null ? Grades.COMMON : grade;
        const effect = Grades.effectMult(gi);
        const cm = Arms.condMult(cond);
        const em = def.edge ? Arms.edgeMult(edge) : 1;
        const types = { cut: _num(def.cut), pierce: _num(def.pierce), blunt: _num(def.blunt) };
        let dtype = null;
        let best = 0;
        for (const [t, v] of Object.entries(types)) if (v > best) { best = v; dtype = t; }
        // (a dull blade still bludgeons: the edge works on cut and point only)
        const edgeOn = dtype === 'blunt' ? 1 : em;
        return {
            id, name: Arms.nameOf(id), slot: def.slot, class: def.class, material: def.material || null,
            hands: _num(def.hands, 1), melee: def.melee !== false && def.slot === 'main',
            dmg: _r2((best / 2) * effect * cm * edgeOn), dtype,
            attack: _r2(_num(def.attack) > 0 ? _num(def.attack) * (effect > 1 ? 1 + (effect - 1) * 0.5 : effect) : _num(def.attack)),
            reach: _num(def.reach, 1), weight: _num(def.weight), pen: _clamp(_num(def.pen), 0, 0.9),
            block: _r2(_num(def.block) * effect * cm), riposte: _num(def.riposte),
            cover: _r2(_clamp(_num(def.cover) * effect * cm, 0, 0.6)),
            prot: _r2(_clamp(_num(def.prot) * effect * cm, 0, 0.6)),
            vs: { cut: 1, pierce: 1, blunt: 1, ...(_obj(def.vs) || {}) },
            effect, cond: _num(cond, 100), edge: def.edge ? _num(edge, 100) : null, tier: _num(def.tier, 1),
        };
    },

    // ── The player's equipment ────────────────────────

    _eq(player) {
        if (!player) return {};
        let eq = player.equipment;
        if (!_obj(eq)) {
            eq = player.equipment = {};
            // (the old single choice: player.equipped.weapon)
            const old = player.equipped && player.equipped.weapon;
            if (old && Arms.isArms(old)) eq.main = { id: old, cond: 100, edge: 100 };
        }
        return eq;
    },

    _held(player, id) {
        return Math.floor(_num(player && player.inventory && player.inventory[id]) + 1e-9);
    },

    /** How much a piece is worth to wear in its slot (to pick the best carried). */
    _value(id, grade) {
        const s = Arms.stats(id, grade);
        if (!s) return 0;
        if (s.slot === 'main') return s.melee ? s.dmg * 2 + s.attack * 1.5 + s.reach * 0.3 : 0.1;
        if (s.slot === 'off') return s.block + s.cover * 4;
        return s.prot * 10;
    },

    /** The pieces carried that fit a slot, best first: [{ id, grade, count, value }]. */
    candidates(player, slot) {
        const out = [];
        for (const def of Arms.itemsFor(slot)) {
            const n = Arms._held(player, def.id);
            if (!(n > 0)) continue;
            const g = Grades.bestIndex(player, def.id);
            out.push({ id: def.id, grade: g == null ? Grades.COMMON : g, count: n, value: Arms._value(def.id, g == null ? Grades.COMMON : g) });
        }
        return out.sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
    },

    /**
     * What the player wears in a slot: { id, grade, cond, edge, stats } or
     * null. An empty unchosen slot takes up the best piece carried (written,
     * so wear has a piece to land on); a piece no longer carried empties it.
     */
    equipped(player, slot) {
        if (!player || !ARMS_SLOTS.includes(slot)) return null;
        const eq = Arms._eq(player);
        let e = eq[slot];
        if (e && (!Arms.isArms(e.id) || Arms._held(player, e.id) <= 0 || Arms.item(e.id).slot !== slot)) {
            delete eq[slot];
            e = undefined;
        }
        if (e === undefined) {
            if (slot === 'off') {
                const m = Arms.equipped(player, 'main');
                if (m && m.stats.hands >= 2) return null;
            }
            const best = Arms.candidates(player, slot).find(c => slot !== 'main' || Arms.stats(c.id).melee);
            if (!best) return null;
            e = eq[slot] = { id: best.id, cond: 100, edge: 100 };
        }
        if (!e) return null;
        const g = Grades.bestIndex(player, e.id);
        const grade = g == null ? Grades.COMMON : g;
        return { id: e.id, grade, cond: _num(e.cond, 100), edge: _num(e.edge, 100), stats: Arms.stats(e.id, grade, e.cond, e.edge) };
    },

    /** { main, off, head, body } as equipped() gives them. */
    loadout(player) {
        const out = {};
        for (const s of ARMS_SLOTS) out[s] = Arms.equipped(player, s);
        return out;
    },

    /** Take up a carried piece in its slot (a two-hander frees the off hand). */
    equip(player, id) {
        const def = Arms.item(id);
        if (!player || !def) return { success: false, reason: 'That is not something to wield or wear.' };
        if (Arms._held(player, id) <= 0) return { success: false, reason: `You carry no ${Arms.nameOf(id).toLowerCase()}.` };
        const eq = Arms._eq(player);
        if (def.slot === 'off') {
            const m = Arms.equipped(player, 'main');
            if (m && m.stats.hands >= 2) return { success: false, reason: `Your ${m.stats.name.toLowerCase()} takes both hands.` };
        }
        const cur = eq[def.slot];
        if (cur && cur.id === id) return { success: true, text: `You already have your ${Arms.nameOf(id).toLowerCase()}.` };
        eq[def.slot] = { id, cond: 100, edge: 100 };
        if (def.slot === 'main' && _num(def.hands, 1) >= 2) eq.off = null;
        if (player.equipped && player.equipped.weapon && def.slot === 'main') player.equipped.weapon = id;
        return { success: true, text: `You take up the ${Arms.nameOf(id).toLowerCase()}.` };
    },

    /** Is this piece the one worn in its slot? */
    isEquipped(player, id) {
        const def = Arms.item(id);
        if (!player || !def) return false;
        const p = Arms.equipped(player, def.slot);
        return !!p && p.id === id;
    },

    /**
     * The hotbar's and the packs' one click on a piece: take it up in its
     * slot (a two-hander puts the shield on your back), or — already worn —
     * put it away. → { success, text | reason, slot, label, equipped }
     */
    toggleEquip(player, id) {
        const def = Arms.item(id);
        if (!player || !def) return { success: false, reason: 'That is not something to wield or wear.' };
        const label = (Arms.config().slots[def.slot] || {}).label || def.slot;
        const out = (r, equipped) => ({ ...r, slot: def.slot, label, equipped });
        if (Arms.isEquipped(player, id)) return out(Arms.unequip(player, def.slot), false);
        const offBefore = def.slot === 'main' && _num(def.hands, 1) >= 2 ? Arms.equipped(player, 'off') : null;
        const r = Arms.equip(player, id);
        if (!r.success) return out(r, false);
        let text = `${r.text.replace(/\.$/, '')} (${label.toLowerCase()}).`;
        if (offBefore) text += ` It takes both hands: your ${Arms.nameOf(offBefore.id).toLowerCase()} goes on your back.`;
        return out({ success: true, text }, true);
    },

    /** Put a slot's piece away and leave it empty (bare hands, no shield...). */
    unequip(player, slot) {
        if (!player || !ARMS_SLOTS.includes(slot)) return { success: false, reason: 'No such slot.' };
        const eq = Arms._eq(player);
        const cur = eq[slot];
        eq[slot] = null;
        if (slot === 'main' && player.equipped) delete player.equipped.weapon;
        return { success: true, text: cur ? `You put away the ${Arms.nameOf(cur.id).toLowerCase()}.` : 'Nothing to put away.' };
    },

    /** Let a slot take up the best carried piece again. */
    autoEquip(player, slot) {
        const eq = Arms._eq(player);
        delete eq[slot];
        return Arms.equipped(player, slot);
    },

    // ── What the gear does for the player ─────────────

    /**
     * The player's fighting gear for a duel: { weapon, shield, armour,
     * armourVs, weight } — weapon/shield null when none (bare hands),
     * armour the share of a blow stopped overall, armourVs the share by
     * damage type (cut / pierce / blunt).
     */
    personal(player) {
        const lo = Arms.loadout(player);
        const w = lo.main && lo.main.stats.melee ? lo.main : null;
        const keep = { all: 1, cut: 1, pierce: 1, blunt: 1 };
        let weight = 0;
        for (const slot of ['head', 'body']) {
            const p = lo[slot];
            if (!p) continue;
            weight += p.stats.weight;
            keep.all *= 1 - p.stats.prot;
            for (const t of ['cut', 'pierce', 'blunt']) keep[t] *= 1 - _clamp(p.stats.prot * _num(p.stats.vs[t], 1), 0, 0.7);
        }
        if (lo.off) weight += lo.off.stats.weight;
        if (lo.main) weight += lo.main.stats.weight;
        return {
            weapon: w ? { ...w.stats, id: w.id, name: _withArticle(w.stats.name), icon: Arms.iconOf(w.id), grade: w.grade } : null,
            mainId: lo.main ? lo.main.id : null,
            shield: lo.off ? { id: lo.off.id, name: lo.off.stats.name.toLowerCase(), icon: Arms.iconOf(lo.off.id), guard: lo.off.stats.block, riposte: lo.off.stats.riposte, cover: lo.off.stats.cover, grade: lo.off.grade } : null,
            armour: _r2(1 - keep.all),
            armourVs: { cut: _r2(1 - keep.cut), pierce: _r2(1 - keep.pierce), blunt: _r2(1 - keep.blunt) },
            weight: _r2(weight),
            loadout: lo,
        };
    },

    /** Was the player's main hand deliberately emptied (fists)? */
    barehanded(player) {
        const eq = player && _obj(player.equipment);
        return !!eq && eq.main === null;
    },

    /**
     * Multiplier on harm the player takes from his armour and shield (each
     * piece by its grade and condition, at most 0.45 apiece — as the old
     * pack-armour rule).
     */
    harmMultiplier(player) {
        let mult = 1;
        const lo = Arms.loadout(player);
        for (const slot of ['head', 'body']) if (lo[slot]) mult *= 1 - Math.min(0.45, lo[slot].stats.prot);
        if (lo.off) mult *= 1 - Math.min(0.45, lo.off.stats.cover);
        return mult;
    },

    // ── Wear ──────────────────────────────────────────

    /**
     * Wear a slot's piece: `cond` points of condition and `edge` of its edge
     * (× the item's wear rate). At 0 condition it breaks: one of the stack
     * (the best, the one worn) is gone. → { id, broke } or null.
     */
    wear(player, slot, cond = 0, edge = 0) {
        const p = Arms.equipped(player, slot);
        if (!p) return null;
        const def = Arms.item(p.id);
        const rate = _num(def.wear, 1);
        if (!(rate > 0)) return { id: p.id, broke: false };
        const e = Arms._eq(player)[slot];
        if (def.edge && edge > 0) e.edge = _r2(Math.max(0, _num(e.edge, 100) - edge * rate));
        if (cond > 0) e.cond = _r2(Math.max(0, _num(e.cond, 100) - cond * rate));
        if (e.cond <= 0) {
            Grades.remove(player, p.id, 1, { order: 'best' });
            if (Arms._held(player, p.id) > 0) { e.cond = 100; e.edge = 100; } else delete Arms._eq(player)[slot];
            return { id: p.id, broke: true };
        }
        return { id: p.id, broke: false };
    },

    /** Harm taken on the road: the armour and shield take their share. → [broken ids] */
    wearArmour(player, harm) {
        const W = Arms.config().wear;
        const pts = Math.max(0, _num(harm)) * W.perHarm;
        if (!(pts > 0)) return [];
        const broke = [];
        for (const slot of ['body', 'head', 'off']) {
            const r = Arms.wear(player, slot, slot === 'body' ? pts : pts * 0.6);
            if (r && r.broke) broke.push(r.id);
        }
        return broke;
    },

    /**
     * A duel fought: blows landed dull the blade, blows taken dent the
     * harness, guards wear the shield. opts.spar: blunted (wears less).
     */
    wearFromDuel(player, opts = {}) {
        const W = Arms.config().wear;
        const k = opts.spar ? W.sparShare : 1;
        const landed = Math.max(0, _num(opts.landed));
        const taken = Math.max(0, _num(opts.taken));
        const guarded = Math.max(0, _num(opts.guarded));
        const broke = [];
        const push = (r) => { if (r && r.broke) broke.push(r.id); };
        if (landed > 0 && !Arms.barehanded(player)) push(Arms.wear(player, 'main', landed * W.condPerBlow * k, landed * W.edgePerBlow * k));
        if (taken > 0) {
            push(Arms.wear(player, 'body', taken * W.condPerHit * k));
            push(Arms.wear(player, 'head', taken * W.condPerHit * 0.5 * k));
        }
        if (guarded > 0) push(Arms.wear(player, 'off', guarded * W.guardPerBlock * k));
        return broke;
    },

    /** A battle fought: the commander's own gear takes its knocks. */
    wearFromBattle(player) {
        const W = Arms.config().wear;
        const broke = [];
        for (const slot of ARMS_SLOTS) {
            const r = Arms.wear(player, slot, W.battle, slot === 'main' ? W.battle * 2 : 0);
            if (r && r.broke) broke.push(r.id);
        }
        return broke;
    },

    // ── Sharpening and mending ────────────────────────

    /** Does the town have a smith (a town or bigger keeps a smithy)? */
    hasSmith(settlement) {
        return !!settlement && ['town', 'city', 'capital'].includes(settlement.type);
    },

    /** The goods a mending of this piece takes. */
    repairGoods(id) {
        const def = Arms.item(id);
        return (def && _obj(def.repair)) || {};
    },

    /**
     * Put the edge back on the main-hand blade: with a whetstone from the
     * packs (it may crack), else at the town smith's grindstone for a fee.
     * opts: { settlement }. → { success, text, reason }
     */
    sharpen(player, opts = {}) {
        const W = Arms.config().wear;
        const p = Arms.equipped(player, 'main');
        if (!p || !Arms.item(p.id).edge) return { success: false, reason: 'You have no edged weapon in hand.' };
        if (p.edge >= 99.5) return { success: false, reason: 'The edge is already keen.' };
        const e = Arms._eq(player).main;
        if (Arms._held(player, 'whetstone') > 0) {
            e.edge = 100;
            const cracked = Utils.random() < W.whetstoneBreak;
            if (cracked) Grades.remove(player, 'whetstone', 1, { order: 'worst' });
            return { success: true, text: `You hone the ${Arms.nameOf(p.id).toLowerCase()} on the whetstone until it shaves.${cracked ? ' The stone cracks.' : ''}`, hours: 0.5 };
        }
        const s = opts.settlement;
        if (!Arms.hasSmith(s)) return { success: false, reason: 'You need a whetstone, or a town smith\'s grindstone.' };
        const fee = Math.max(1, Math.round(W.grindFee));
        if (_num(player.gold) < fee) return { success: false, reason: `The smith wants ${fee} gold for the grindstone.` };
        player.gold -= fee;
        Economy.payTown(s, fee);
        Ledger.record(player, 'armsKit', -fee);
        e.edge = 100;
        return { success: true, text: `The smith puts your ${Arms.nameOf(p.id).toLowerCase()} to the grindstone (${fee} gold).`, fee, hours: 0.25 };
    },

    /** The unit worth of a good at a town (its market value, else the base price). */
    _worth(world, settlement, id) {
        const base = Arms.basePrice(id) || PlayerInventory.goodValue(id) || 5;
        if (settlement && settlement.market && SettlementMarket.tracks(id)) {
            const tile = world && typeof world.getTile === 'function' && Number.isFinite(settlement.q) ? world.getTile(settlement.q, settlement.r) : null;
            const v = SettlementMarket.value(world, settlement, tile, id, base);
            if (v > 0) return v;
        }
        return base;
    },

    /**
     * What mending a slot's piece takes: { id, goods, self (can mend it
     * yourself: you carry the goods), smith: { fee, goods cost, total,
     * short (goods the town lacks) } | null }.
     */
    mendQuote(player, slot, settlement = null, world = null) {
        const p = Arms.equipped(player, slot);
        if (!p) return null;
        const goods = Arms.repairGoods(p.id);
        const inv = player.inventory || {};
        const self = Object.entries(goods).every(([g, n]) => _num(inv[g]) >= n);
        let smith = null;
        if (Arms.hasSmith(settlement)) {
            const W = Arms.config().wear;
            let goodsCost = 0;
            const short = [];
            for (const [g, n] of Object.entries(goods)) {
                if (SettlementMarket.tracks(g) && settlement.market && SettlementMarket.available(settlement, g) < n) short.push(g);
                goodsCost += n * Arms._worth(world, settlement, g);
            }
            const fee = Math.max(_num(W.mendFeeMin, 4), Math.round(Arms.basePrice(p.id) * W.mendFee * (1 - p.cond / 100)));
            smith = { fee, goodsCost: Math.round(goodsCost), total: fee + Math.round(goodsCost), short };
        }
        return { id: p.id, cond: p.cond, goods, self, smith };
    },

    /**
     * Mend a slot's piece to full: yourself (opts.self — the repair goods
     * from the packs; a little Smithing practice for the caller to add), or
     * by the town smith (fee + the goods bought from the town's stock).
     */
    mend(player, slot, opts = {}) {
        const q = Arms.mendQuote(player, slot, opts.settlement, opts.world);
        if (!q) return { success: false, reason: 'Nothing worn there.' };
        if (q.cond >= 99.5) return { success: false, reason: 'It needs no mending.' };
        const e = Arms._eq(player)[slot];
        if (opts.self) {
            if (!q.self) return { success: false, reason: `Mending it takes ${PlayerInventory.describe(q.goods)}.` };
            for (const [g, n] of Object.entries(q.goods)) Grades.remove(player, g, n, { order: 'worst' });
            e.cond = 100;
            return { success: true, text: `You mend the ${Arms.nameOf(q.id).toLowerCase()} (${PlayerInventory.describe(q.goods)}).`, hours: 1, self: true };
        }
        const s = opts.settlement;
        if (!q.smith) return { success: false, reason: 'There is no smith here.' };
        if (q.smith.short.length) return { success: false, reason: `The smith has no ${q.smith.short.join(', ').replace(/_/g, ' ')} to mend it with.` };
        if (_num(player.gold) < q.smith.total) return { success: false, reason: `The smith wants ${q.smith.total} gold.` };
        for (const [g, n] of Object.entries(q.goods)) if (SettlementMarket.tracks(g) && s.market) SettlementMarket.take(s, g, n);
        player.gold -= q.smith.total;
        Economy.payTown(s, q.smith.total);
        Ledger.record(player, 'armsKit', -q.smith.total);
        e.cond = 100;
        if (e.edge != null) e.edge = 100;
        return { success: true, text: `The smith mends your ${Arms.nameOf(q.id).toLowerCase()} (${q.smith.total} gold).`, cost: q.smith.total };
    },

    // ── Troops ────────────────────────────────────────

    /** The kit a unit type is issued (data/arms.json troops.kits), or null (fights as it comes). */
    kitSpec(unitType) {
        return Arms.config().kits[String(unitType || '').toLowerCase()] || null;
    },

    /** A unit's worth from its kit: 1 without a kit record; bare..maxFactor with one. */
    unitFactor(unit) {
        if (!unit || !_obj(unit.kit)) return 1;
        const spec = Arms.kitSpec(unit.type);
        if (!spec) return 1;
        const bare = _clamp(_num(spec.bare, 0.55), 0.1, 1);
        const cm = Arms.condMult(_num(unit.kit.cond, 100));
        let sum = 0;
        for (const [slot, s] of Object.entries(spec.slots || {})) {
            const id = unit.kit[slot];
            const def = Arms.item(id);
            if (!def) continue;
            const g = unit.kit.g && unit.kit.g[slot] != null ? unit.kit.g[slot] : Grades.COMMON;
            sum += _num(s.w) * _num(def.tier, 1) * Grades.effectMult(g) * cm;
        }
        return _r2(_clamp(bare + (1 - bare) * sum, bare, Arms.config().maxFactor));
    },

    /** Which slots of a unit's kit are empty. */
    kitGaps(unit) {
        const spec = Arms.kitSpec(unit && unit.type);
        if (!spec) return [];
        const kit = _obj(unit.kit) || {};
        return Object.keys(spec.slots || {}).filter(s => !Arms.item(kit[s]));
    },

    /** "Iron Spear, Round Shield, Gambeson" for a unit's kit ('' when none). */
    kitLabel(unit) {
        const kit = _obj(unit && unit.kit);
        if (!kit) return '';
        return ARMS_SLOTS.filter(s => kit[s]).map(s => {
            const g = kit.g && kit.g[s] != null ? Grades.get(kit.g[s]) : null;
            return `${g && g.id !== 'common' ? g.name + ' ' : ''}${Arms.nameOf(kit[s])}`;
        }).join(', ');
    },

    /** Item ids of a unit's kit by slot ({ main, off, head, body }; null when bare) — for the renderers. */
    kitView(unit) {
        const kit = _obj(unit && unit.kit) || {};
        const out = {};
        for (const s of ARMS_SLOTS) out[s] = Arms.item(kit[s]) ? kit[s] : null;
        return out;
    },

    /**
     * Fit a soldier's LPC layer recipe (bottom to top, paths under
     * assets/lpc/Characters) to the kit he was issued (kitView: { main, off,
     * head, body }): the arming-sword layers take the sword's metal or go
     * when his weapon is no sword (no art yet for axes, maces, spears, bows),
     * the shield layers go when he has none (any shield shows as the heater
     * until there is art for the others), the helm takes his helm's layer or
     * goes. A recipe for a unit without a kit record is left as it is.
     */
    lookLayers(layers, kit) {
        if (!Array.isArray(layers) || !kit) return layers;
        const SWORD = 'Props/Sword 01 - Arming Sword/';
        const main = Arms.item(kit.main);
        const swordLayer = main && main.class === 'sword' && main.sprite && main.sprite.layer;
        const metal = swordLayer && swordLayer.startsWith(SWORD) ? swordLayer.slice(SWORD.length) : null;
        const helm = Arms.item(kit.head);
        const helmLayer = helm && helm.sprite && helm.sprite.layer;
        const out = [];
        for (const l of layers) {
            if (l.startsWith(SWORD)) {
                if (!metal) continue;
                out.push(l.startsWith(SWORD + '_Behind/') ? `${SWORD}_Behind/${metal}` : `${SWORD}${metal}`);
            } else if (l.startsWith('Props/Shield ')) {
                if (Arms.item(kit.off)) out.push(l);
            } else if (l.startsWith('Head Accessories/Helm Accessory')) {
                if (helmLayer && /Bascinet/.test(helmLayer) && /Bascinet/.test(l)) out.push(l);
            } else if (l.startsWith('Head Accessories/Helm ')) {
                if (helmLayer) out.push(helmLayer);
            } else out.push(l);
        }
        return out;
    },

    /** The best piece in the packs for a kit slot: { id, grade, value } or null. */
    _packPick(player, slot, classes, used = null) {
        let best = null;
        for (const def of Arms.itemsFor(slot, classes)) {
            const held = Arms._held(player, def.id) - _num(used && used[def.id]);
            if (!(held > 0)) continue;
            // (the equipped piece stays with the player unless there are spares)
            const worn = player.equipment && player.equipment[slot] && player.equipment[slot].id === def.id;
            if (worn && held <= 1) continue;
            const g = Grades.peek(player, def.id, 1, { order: 'worst' }).index;
            const value = _num(def.tier, 1) * Grades.effectMult(Math.round(g));
            if (!best || value > best.value) best = { id: def.id, grade: Math.round(g), value };
        }
        return best;
    },

    /** The cheapest market good the town has in stock for a kit slot: { id, price } or null. */
    _marketPick(world, settlement, slot, classes) {
        if (!settlement || !settlement.market) return null;
        const goods = Arms.config().market[slot] || [];
        const G = _goodsTable();
        const tile = world && typeof world.getTile === 'function' && Number.isFinite(settlement.q) ? world.getTile(settlement.q, settlement.r) : null;
        let best = null;
        for (const id of goods) {
            const def = Arms.item(id);
            if (!def || !classes.includes(def.class)) continue;
            if (!SettlementMarket.tracks(id) || SettlementMarket.available(settlement, id) < 1) continue;
            const good = G[id.toUpperCase()];
            if (!good) continue;
            const price = Math.max(1, Economy.marketPrice(good, settlement, tile, world));
            if (!best || price < best.price) best = { id, price };
        }
        return best;
    },

    /**
     * What arming a soldier of `unitType` here would take: { slots: { slot:
     * { from: 'pack'|'market'|null, id, price } }, cost, factor } — read only.
     */
    kitQuote(player, unitType, settlement = null, world = null, opts = {}) {
        const spec = Arms.kitSpec(unitType);
        if (!spec) return null;
        const out = { slots: {}, cost: 0 };
        const kit = { g: {} };
        const usedPack = {};
        for (const [slot, s] of Object.entries(spec.slots || {})) {
            const classes = Array.isArray(s.classes) ? s.classes : [];
            const pick = opts.noPack ? null : Arms._packPick(player, slot, classes, usedPack);
            if (pick) {
                usedPack[pick.id] = _num(usedPack[pick.id]) + 1;
                out.slots[slot] = { from: 'pack', id: pick.id };
                kit[slot] = pick.id; kit.g[slot] = pick.grade;
                continue;
            }
            const m = opts.buy === false ? null : Arms._marketPick(world, settlement, slot, classes);
            if (m) {
                out.slots[slot] = { from: 'market', id: m.id, price: m.price };
                out.cost += m.price;
                kit[slot] = m.id; kit.g[slot] = Grades.COMMON;
            } else out.slots[slot] = { from: null, id: null };
        }
        out.factor = Arms.unitFactor({ type: unitType, kit: { ...kit, cond: 100 } });
        // A bowman's quiver: from the packs, else bought here
        const good = Arms.ammoGood({ type: unitType, kit });
        if (good) {
            const want = Arms.quiverOf({ type: unitType }).quiver;
            const pack = opts.noPack ? 0 : Math.min(want, Arms._held(player, good));
            const G = _goodsTable()[good.toUpperCase()];
            const tile = world && settlement && typeof world.getTile === 'function' && Number.isFinite(settlement.q) ? world.getTile(settlement.q, settlement.r) : null;
            const avail = settlement && settlement.market && G && opts.buy !== false ? Math.min(want - pack, SettlementMarket.available(settlement, good)) : 0;
            const price = avail > 0 ? Math.max(1, Economy.marketPrice(G, settlement, tile, world)) : 0;
            out.ammo = { good, want, pack, buy: avail, price };
            out.cost += avail * price;
            if (pack + avail < want) out.factor = _r2(out.factor * (Arms.config().ammo.dryMult + (1 - Arms.config().ammo.dryMult) * Math.min(1, (pack + avail) / Arms.quiverOf({ type: unitType }).perBattle)));
        }
        return out;
    },

    /**
     * Issue a kit to a unit (filling only its empty slots): the packs
     * first, then the town's market (opts.buy, paid at its price into the
     * town's purse, while the player's gold lasts). A unit with no kit
     * record gets one. → { kit, fromPack: {id: n}, bought: {id: n}, cost }
     */
    issueKit(player, unit, opts = {}) {
        const spec = Arms.kitSpec(unit && unit.type);
        const res = { kit: null, fromPack: {}, bought: {}, cost: 0 };
        if (!spec || !player) return res;
        const s = opts.settlement || null;
        const world = opts.world || null;
        if (!_obj(unit.kit)) unit.kit = { g: {}, cond: 100 };
        const kit = unit.kit;
        if (!_obj(kit.g)) kit.g = {};
        for (const [slot, sp] of Object.entries(spec.slots || {})) {
            if (Arms.item(kit[slot])) continue;
            const classes = Array.isArray(sp.classes) ? sp.classes : [];
            const pick = opts.noPack ? null : Arms._packPick(player, slot, classes);
            if (pick) {
                const drawn = Grades.remove(player, pick.id, 1, { order: 'worst' });
                kit[slot] = pick.id;
                kit.g[slot] = Math.round(_num(drawn.index, Grades.COMMON));
                res.fromPack[pick.id] = _num(res.fromPack[pick.id]) + 1;
                continue;
            }
            if (!opts.buy) continue;
            const m = Arms._marketPick(world, s, slot, classes);
            if (!m || _num(player.gold) < m.price) continue;
            if (SettlementMarket.take(s, m.id, 1) < 1) continue;
            player.gold -= m.price;
            Economy.payTown(s, m.price);
            res.cost += m.price;
            kit[slot] = m.id;
            kit.g[slot] = Grades.COMMON;
            res.bought[m.id] = _num(res.bought[m.id]) + 1;
        }
        if (res.cost > 0) Ledger.record(player, 'armsKit', -res.cost);
        res.kit = kit;
        // A bowman's quiver: a fresh recruit (opts.recruit) brings none of his own
        if (Arms.ammoGood(unit)) {
            if (opts.recruit && unit.ammo == null) unit.ammo = 0;
            const q = Arms.supplyQuivers(player, { units: [unit], settlement: s, world, buy: !!opts.buy });
            for (const [k, n] of Object.entries(q.fromPack)) res.fromPack[k] = _num(res.fromPack[k]) + n;
            for (const [k, n] of Object.entries(q.bought)) res.bought[k] = _num(res.bought[k]) + n;
            res.cost += q.cost;
        }
        return res;
    },

    /**
     * Arm the whole army: every unit's empty kit slots filled from the packs
     * (and, with opts.buy, the town's market). Units with no kit record are
     * given one only with opts.all (they fight as they always did).
     * → { units, fromPack, bought, cost }
     */
    armArmy(player, opts = {}) {
        const out = { units: 0, fromPack: {}, bought: {}, cost: 0 };
        for (const unit of (player && player.army) || []) {
            if (!Arms.kitSpec(unit.type) || unit.mercenary) continue;
            if (!_obj(unit.kit) && !opts.all) continue;
            if (!Arms.kitGaps(unit).length && _obj(unit.kit)) continue;
            const r = Arms.issueKit(player, unit, opts);
            let any = false;
            for (const [k, n] of Object.entries(r.fromPack)) { out.fromPack[k] = _num(out.fromPack[k]) + n; any = true; }
            for (const [k, n] of Object.entries(r.bought)) { out.bought[k] = _num(out.bought[k]) + n; any = true; }
            out.cost += r.cost;
            if (any) out.units++;
        }
        return out;
    },

    /** The army's kits taking their knocks in a battle. */
    wearKits(player, amount = null) {
        const pts = amount == null ? Arms.config().wear.kitBattle : _num(amount);
        for (const unit of (player && player.army) || []) {
            if (!_obj(unit.kit)) continue;
            unit.kit.cond = _r2(Math.max(0, _num(unit.kit.cond, 100) - pts));
        }
    },

    /** What mending every worn kit at a town smith costs: { units, cost, iron (goods taken) }. */
    kitMendQuote(player, settlement = null, world = null) {
        const W = Arms.config().wear;
        let cost = 0, units = 0, iron = 0;
        for (const unit of (player && player.army) || []) {
            const kit = _obj(unit.kit);
            if (!kit || _num(kit.cond, 100) >= 99.5) continue;
            let worth = 0;
            for (const s of ARMS_SLOTS) if (Arms.item(kit[s])) worth += Arms.basePrice(kit[s]);
            const lost = 1 - _num(kit.cond, 100) / 100;
            cost += Math.max(1, Math.round(worth * W.kitMendShare * lost));
            iron += lost * 0.5;
            units++;
        }
        const ironN = Math.ceil(iron - 1e-9);
        const ironCost = ironN > 0 && settlement ? Math.round(ironN * Arms._worth(world, settlement, 'iron')) : 0;
        return { units, fee: cost, iron: ironN, ironCost, total: cost + ironCost };
    },

    /** Mend every worn kit at the town's smith: the fee and the iron (out of the town's stock) paid. */
    mendKits(player, settlement, world = null) {
        if (!Arms.hasSmith(settlement)) return { success: false, reason: 'There is no smith here.' };
        const q = Arms.kitMendQuote(player, settlement, world);
        if (!q.units) return { success: false, reason: 'Your soldiers\' arms need no mending.' };
        if (q.iron > 0 && settlement.market && SettlementMarket.available(settlement, 'iron') < q.iron) {
            return { success: false, reason: `The smiths of ${settlement.name} have no iron to spare (${q.iron} wanted).` };
        }
        if (_num(player.gold) < q.total) return { success: false, reason: `The smiths want ${q.total} gold.` };
        if (q.iron > 0 && settlement.market) SettlementMarket.take(settlement, 'iron', q.iron);
        player.gold -= q.total;
        Economy.payTown(settlement, q.total);
        Ledger.record(player, 'armsKit', -q.total);
        for (const unit of player.army || []) if (_obj(unit.kit)) unit.kit.cond = 100;
        return { success: true, cost: q.total, text: `The smiths of ${settlement.name} mend ${q.units} soldiers' arms (${q.total} gold).` };
    },

    /** A dismissed soldier hands his kit back (into the packs, as far as they hold it). */
    returnKit(player, unit) {
        const kit = _obj(unit && unit.kit);
        if (!kit || !player) return {};
        const back = {};
        for (const s of ARMS_SLOTS) {
            if (!Arms.item(kit[s])) continue;
            // (what doesn't fit in the packs goes home with the man)
            if (!PlayerInventory.addItem(player, kit[s], 1).success) continue;
            Grades.add(player, kit[s], 1, kit.g && kit.g[s] != null ? kit.g[s] : Grades.COMMON);
            back[kit[s]] = _num(back[kit[s]]) + 1;
        }
        delete unit.kit;
        return back;
    },

    /**
     * A won battle strips the beaten of their arms: per `per` points of the
     * enemy's strength one of each spoils good (at most `max` each), into
     * the packs (what doesn't fit is left on the field). → { good: n }
     */
    battleSpoils(player, enemyStrength) {
        const S = Arms.config().spoils;
        const n = Math.min(_num(S.max, 6), Math.floor(Math.max(0, _num(enemyStrength)) / Math.max(1, _num(S.per, 40))));
        const got = {};
        if (!(n > 0) || !player) return got;
        for (const g of Array.isArray(S.goods) ? S.goods : []) {
            if (!PlayerInventory.canAdd(player, g)) continue;
            PlayerInventory.addItem(player, g, n);
            got[g] = n;
        }
        return got;
    },

    // ── Arrows and bolts ──────────────────────────────

    /**
     * What a soldier shoots: 'arrows' | 'bolts' | null (no shooter). A unit
     * issued a bow or crossbow shoots its missile; one with no kit record
     * by its type (data/arms.json ammo.units: crossbowmen bolts, the rest
     * arrows; a scout only with a bow issued).
     */
    ammoGood(unit) {
        if (!unit) return null;
        const A = Arms.config().ammo;
        const kit = _obj(unit.kit);
        const main = kit && Arms.item(kit.main);
        if (main) return A.goods[main.class] || null;
        const type = String(unit.type || '').toLowerCase();
        if (!_obj(A.units[type]) || type === 'scout') return null;
        if (kit) return null; // (a kit record with no weapon: he has no bow to shoot)
        return type === 'crossbowman' ? (A.goods.crossbow || 'bolts') : (A.goods.bow || 'arrows');
    },

    /** A shooter's quiver and his battle's share: { quiver, perBattle }. */
    quiverOf(unit) {
        const A = Arms.config().ammo;
        const u = _obj(A.units[String(unit && unit.type || '').toLowerCase()]) || {};
        const quiver = Math.max(1, Math.round(_num(u.quiver, 12)));
        return { quiver, perBattle: Math.max(1, Math.min(quiver, Math.round(_num(u.perBattle, quiver / 2)))) };
    },

    /**
     * A shooter's worth by his quiver: 1 with a battle's worth of missiles
     * (or no quiver record: he came with his own), down to dryMult with none.
     */
    ammoFactor(unit) {
        if (!Arms.ammoGood(unit) || unit.ammo == null) return 1;
        const dry = _clamp(_num(Arms.config().ammo.dryMult, 0.35), 0, 1);
        return _r2(dry + (1 - dry) * _clamp(_num(unit.ammo) / Arms.quiverOf(unit).perBattle, 0, 1));
    },

    /** A battle report's line on the arrows (a spendQuivers result): '' when none were loosed. */
    quiverNote(q) {
        if (!q || !q.loosed) return '';
        const loosed = Object.entries(q.loosed).filter(([, n]) => n > 0);
        if (!loosed.length && !q.dry) return '';
        const name = (g, n) => `${n} ${Arms.nameOf(g).toLowerCase()}`;
        let t = loosed.length ? `🏹 ${loosed.map(([g, n]) => name(g, n)).join(' and ')} loosed` : '🏹 No arrows loosed';
        const back = Object.entries(q.recovered || {}).filter(([, n]) => n > 0);
        if (back.length) t += ` (${back.map(([g, n]) => name(g, n)).join(', ')} picked up off the field)`;
        if (q.dry) t += `; ${q.dry} of your shooters ran short and fought at ${Math.round(Arms.dryMult() * 100)}%`;
        return `${t}.`;
    },

    /** What a shooter out of missiles is worth (data/arms.json ammo.dryMult). */
    dryMult() {
        return _clamp(_num(Arms.config().ammo.dryMult, 0.35), 0, 1);
    },

    /**
     * The volleys a battlefield company of these units can loose before its
     * quivers are empty (each volley spends fieldVolley missiles a shooter);
     * null when none of them shoots (not counted).
     */
    fieldVolleys(units) {
        let shooters = 0, missiles = 0;
        for (const u of units || []) {
            if (!Arms.ammoGood(u)) continue;
            shooters++;
            missiles += u.ammo == null ? Arms.quiverOf(u).quiver : Math.max(0, Math.floor(_num(u.ammo)));
        }
        if (!shooters) return null;
        const per = shooters * Math.max(0.01, _num(Arms.config().ammo.fieldVolley, 0.4));
        return Math.floor(missiles / per + 1e-9);
    },

    /**
     * Fill the shooters' quivers: from the packs (the baggage), then, with
     * opts.buy, the town's market (opts.settlement) at its price into the
     * town's purse while the gold lasts. A shooter with no quiver record is
     * filled once, free (he came with his own). opts.units: only these.
     * → { fromPack: {good: n}, bought: {good: n}, cost, short: n (missiles still wanted) }
     */
    supplyQuivers(player, opts = {}) {
        const out = { fromPack: {}, bought: {}, cost: 0, short: 0 };
        if (!player) return out;
        const s = opts.settlement || null;
        const world = opts.world || null;
        const units = Array.isArray(opts.units) ? opts.units : (player.army || []);
        const G = _goodsTable();
        const tile = s && world && typeof world.getTile === 'function' && Number.isFinite(s.q) ? world.getTile(s.q, s.r) : null;
        for (const unit of units) {
            const good = Arms.ammoGood(unit);
            if (!good || unit.mercenary) continue;
            const { quiver } = Arms.quiverOf(unit);
            if (unit.ammo == null) { unit.ammo = quiver; continue; }
            let want = Math.max(0, quiver - Math.floor(_num(unit.ammo)));
            if (!(want > 0)) continue;
            const have = Arms._held(player, good);
            const fromPack = Math.min(want, have);
            if (fromPack > 0) {
                Grades.remove(player, good, fromPack, { order: 'worst' });
                unit.ammo = _num(unit.ammo) + fromPack;
                out.fromPack[good] = _num(out.fromPack[good]) + fromPack;
                want -= fromPack;
            }
            if (want > 0 && opts.buy && s && s.market && SettlementMarket.tracks(good) && G[good.toUpperCase()]) {
                const price = Math.max(1, Economy.marketPrice(G[good.toUpperCase()], s, tile, world));
                const n = Math.min(want, SettlementMarket.available(s, good), Math.floor(_num(player.gold) / price));
                const got = n > 0 ? Math.floor(SettlementMarket.take(s, good, n) + 1e-9) : 0;
                if (got > 0) {
                    player.gold -= got * price;
                    Economy.payTown(s, got * price);
                    out.cost += got * price;
                    unit.ammo = _num(unit.ammo) + got;
                    out.bought[good] = _num(out.bought[good]) + got;
                    want -= got;
                }
            }
            out.short += want;
        }
        if (out.cost > 0) Ledger.record(player, 'armsKit', -out.cost);
        return out;
    },

    /** Missiles the shooters lack to fill their quivers, and what buying them here would cost: { good: { want, price } }. */
    quiverQuote(player, settlement = null, world = null) {
        const out = {};
        const G = _goodsTable();
        const tile = settlement && world && typeof world.getTile === 'function' && Number.isFinite(settlement.q) ? world.getTile(settlement.q, settlement.r) : null;
        for (const unit of (player && player.army) || []) {
            const good = Arms.ammoGood(unit);
            if (!good || unit.mercenary || unit.ammo == null) continue;
            const want = Math.max(0, Arms.quiverOf(unit).quiver - Math.floor(_num(unit.ammo)));
            if (!(want > 0)) continue;
            const o = out[good] || (out[good] = { want: 0, price: null, stock: 0 });
            o.want += want;
        }
        for (const [good, o] of Object.entries(out)) {
            if (settlement && settlement.market && G[good.toUpperCase()]) {
                o.price = Math.max(1, Economy.marketPrice(G[good.toUpperCase()], settlement, tile, world));
                o.stock = SettlementMarket.available(settlement, good);
            }
        }
        return out;
    },

    /**
     * A battle fought: every shooter looses his battle's share (opts.units:
     * the survivors who fought; opts.volleys: [{ units, n }] — on the
     * battlefield (player/battlefield.js) each company's volleys loosed, at
     * fieldVolley missiles a unit a volley, in place of the battle's share).
     * A won field (opts.victory) gives back `recover` of what was loosed,
     * into the packs; then the quivers are filled from the packs again.
     * → { loosed: {good: n}, recovered: {good: n}, dry: shooters who ran out }
     */
    spendQuivers(player, opts = {}) {
        const A = Arms.config().ammo;
        const out = { loosed: {}, recovered: {}, dry: 0 };
        if (!player) return out;
        const units = Array.isArray(opts.units) ? opts.units : (player.army || []);
        const field = new Map();
        const onField = Array.isArray(opts.volleys);
        if (onField) {
            for (const v of opts.volleys) {
                for (const u of (v && v.units) || []) field.set(u, _num(field.get(u)) + _num(v.n) * _num(A.fieldVolley, 0.4));
            }
        }
        for (const unit of units) {
            const good = Arms.ammoGood(unit);
            if (!good) continue;
            const q = Arms.quiverOf(unit);
            if (unit.ammo == null) unit.ammo = q.quiver;
            const want = onField ? Math.round(_num(field.get(unit))) : q.perBattle;
            const n = Math.min(Math.floor(_num(unit.ammo)), Math.max(0, want));
            unit.ammo = Math.max(0, Math.floor(_num(unit.ammo)) - n);
            if (n > 0) out.loosed[good] = _num(out.loosed[good]) + n;
            if (want > n) out.dry++;
        }
        if (opts.victory) {
            for (const [good, n] of Object.entries(out.loosed)) {
                const back = Math.floor(n * _clamp(_num(A.recover, 0.3), 0, 1));
                if (back > 0 && PlayerInventory.addItem(player, good, back).success) out.recovered[good] = back;
            }
        }
        Arms.supplyQuivers(player, { units });
        return out;
    },
};
