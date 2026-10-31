// ============================================
// CRAFTING — the player's own hands at the bench, the forge and the hearth
// ============================================
// Recipes live in data/crafting.json (stations: cook, craft, smelt, brew,
// tan). Every attempt can fail and every success comes out at a quality tier
// — Crude, Common, Fine or Masterwork — from:
//   - the crafter's rank (player.crafting.xp: Novice → Master Artisan),
//   - working in a fitting workshop (a blacksmith's anvil, a temple's still…;
//     better again in one the player owns),
//   - tools in the pack for the bench, the forge and the tannery (they wear),
//   - the attribute the recipe leans on (strength at the forge, wits at the
//     still), the recipe's difficulty,
//   - and, for smithing, the Forge minigame's score (ui/minigames/forge).
// A failure wastes part of the inputs (and still teaches a little).
//
// Quality travels with the goods: player.craftQuality[item] = { n, t } is
// how many tracked units are held and the sum of their tier indices. Units
// that came from anywhere else count as Common. The average tier scales the
// sale price (Trading.sellGoods), food nourishment and potion healing (the
// object-action modals) and armour's protection (PlayerEffects). Selling or
// using goods draws the tracked units down pro rata.
//
// Domain rules: player / world / context are parameters, all randomness via
// Utils, packs through PlayerInventory (the inventory cap is respected: a
// craft whose product doesn't fit is undone).

import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { PlayerInventory } from './inventory.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _r2 = (v) => Math.round(v * 100) / 100;

const DEFAULT_CONFIG = {
    ranks: [
        { min: 0, name: 'Novice', icon: '🌱' },
        { min: 20, name: 'Apprentice', icon: '🔨' },
        { min: 60, name: 'Journeyman', icon: '⚒️' },
        { min: 140, name: 'Artisan', icon: '🛠️' },
        { min: 300, name: 'Master Artisan', icon: '🏅' },
    ],
    tiers: [
        { id: 'crude', name: 'Crude', icon: '🧱', sale: 0.7, effect: 0.75, below: 0.5 },
        { id: 'common', name: 'Common', icon: '⚪', sale: 1, effect: 1, below: 1.6 },
        { id: 'fine', name: 'Fine', icon: '🔷', sale: 1.35, effect: 1.25, below: 2.6 },
        { id: 'masterwork', name: 'Masterwork', icon: '🌟', sale: 1.8, effect: 1.5, below: null },
    ],
    quality: { base: 0.6, perRank: 0.55, workshop: 0.45, tools: 0.3, perAttr: 0.05, perDifficulty: 0.3, forge: 0.9, noise: 0.7 },
    failure: { base: 0.08, perDifficulty: 0.06, perRank: 0.07, workshop: 0.04, tools: 0.03, forgePer: 0.004, min: 0.02, max: 0.6, loss: 0.5, xpShare: 0.5 },
    toolWear: 0.05,
    toolStations: ['craft', 'smelt', 'tan'],
    workshops: {},
    ownedBonus: 0.2,
};

let _src;
let _cfg = null;

function _data() {
    const gd = DataLoader._gamedata;
    return (gd && gd.crafting) || null;
}

export const Crafting = {
    /** Tuning (data/crafting.json config over the defaults). */
    config() {
        const d = _data();
        if (!_cfg || d !== _src) {
            _src = d;
            const o = (d && d.config) || {};
            _cfg = {
                ...DEFAULT_CONFIG, ...o,
                quality: { ...DEFAULT_CONFIG.quality, ...(o.quality || {}) },
                failure: { ...DEFAULT_CONFIG.failure, ...(o.failure || {}) },
                workshops: { ...DEFAULT_CONFIG.workshops, ...(o.workshops || {}) },
            };
        }
        return _cfg;
    },

    /** Every recipe, or those of one station. */
    recipes(station = null) {
        const d = _data();
        const all = (d && Array.isArray(d.recipes)) ? d.recipes : [];
        return station ? all.filter(r => r.station === station) : all;
    },

    recipe(id) {
        return Crafting.recipes().find(r => r.id === id) || null;
    },

    station(id) {
        const d = _data();
        return (d && d.stations && d.stations[id]) || { label: id, icon: '🔨' };
    },

    // ── Rank ─────────────────────────────────────────────

    _state(player) {
        if (!player.crafting || typeof player.crafting !== 'object') player.crafting = { xp: 0, made: 0, failed: 0, masterworks: 0 };
        return player.crafting;
    },

    /** { level, name, icon, xp, next: { name, at } | null } */
    rank(player) {
        const xp = _num(player && player.crafting && player.crafting.xp);
        const ranks = Crafting.config().ranks;
        let level = 0;
        for (let i = 0; i < ranks.length; i++) if (xp >= ranks[i].min) level = i;
        const next = ranks[level + 1] || null;
        return { level, ...ranks[level], xp, next: next ? { name: next.name, at: next.min } : null };
    },

    // ── Odds ─────────────────────────────────────────────

    canCraft(player, recipe) {
        const inv = (player && player.inventory) || {};
        if (!recipe) return false;
        for (const [item, amt] of Object.entries(recipe.ingredients || {})) {
            if ((inv[item] || 0) < amt) return false;
        }
        return true;
    },

    /** Does this building suit the recipe's station? 0, 1 (a fitting workshop) or 1 + ownedBonus (one the player owns). */
    workshopBonus(recipe, building) {
        if (!recipe || !building) return 0;
        const type = String(building.type || '').replace(/^player_/, '');
        const list = Crafting.config().workshops[recipe.station] || [];
        if (!list.includes(type)) return 0;
        const owned = !!(building.isPlayerOwned || building.isPlayerProperty || String(building.type || '').startsWith('player_'));
        return 1 + (owned ? _num(Crafting.config().ownedBonus) : 0);
    },

    _hasTools(player, recipe) {
        return Crafting.config().toolStations.includes(recipe.station) && _num(player.inventory && player.inventory.tools) > 0;
    },

    /**
     * The odds of an attempt: { fail, score (expected quality score), tier
     * (expected tier), parts } — ctx: { building, forgeScore (0..100) }.
     */
    odds(player, recipe, ctx = {}) {
        const C = Crafting.config();
        const Q = C.quality;
        const F = C.failure;
        const rank = Crafting.rank(player).level;
        const shop = Crafting.workshopBonus(recipe, ctx.building);
        const tools = Crafting._hasTools(player, recipe) ? 1 : 0;
        const diff = Math.max(1, _num(recipe.difficulty, 1));
        const attr = _num(player[recipe.attr || 'intelligence'], 5);
        const forge = ctx.forgeScore != null ? _clamp(_num(ctx.forgeScore), 0, 100) : null;
        let score = Q.base + rank * Q.perRank + shop * Q.workshop + tools * Q.tools + (attr - 5) * Q.perAttr - (diff - 1) * Q.perDifficulty;
        if (forge != null) score += ((forge - 50) / 50) * Q.forge;
        let fail = F.base + diff * F.perDifficulty - rank * F.perRank - shop * F.workshop - tools * F.tools;
        if (forge != null) fail += (50 - forge) * F.forgePer;
        fail = _clamp(fail, F.min, F.max);
        return { fail: _r2(fail), score: _r2(score), tier: Crafting.tierOfScore(score), parts: { rank, shop, tools, diff, forge } };
    },

    /** Tier index (0 crude … 3 masterwork) for a quality score. */
    tierOfScore(score) {
        const tiers = Crafting.config().tiers;
        for (let i = 0; i < tiers.length; i++) {
            if (tiers[i].below == null || score < tiers[i].below) return i;
        }
        return tiers.length - 1;
    },

    tier(idx) {
        const tiers = Crafting.config().tiers;
        return tiers[_clamp(Math.round(_num(idx, 1)), 0, tiers.length - 1)];
    },

    // ── The attempt ──────────────────────────────────────

    /**
     * Try a recipe. ctx: { building, forgeScore, world }.
     * Returns { success, failed?, reason?, recipe, tier, tierName, results,
     * lost, xp, rankUp, toolWorn, full? }. success:false with `full` means
     * nothing happened (the product wouldn't fit); with `failed` the attempt
     * was made and spoiled.
     */
    craft(player, recipeOrId, ctx = {}) {
        const recipe = typeof recipeOrId === 'string' ? Crafting.recipe(recipeOrId) : recipeOrId;
        if (!player || !recipe) return { success: false, reason: 'No such recipe.' };
        if (!Crafting.canCraft(player, recipe)) return { success: false, reason: 'You lack the materials.' };
        const C = Crafting.config();
        const st = Crafting._state(player);
        const odds = Crafting.odds(player, recipe, ctx);
        const before = Crafting.rank(player).level;
        const xpFull = _num(recipe.xp, 2 + Math.max(1, _num(recipe.difficulty, 1)) * 3);
        const inv = player.inventory;

        // Tools wear with use
        let toolWorn = false;
        const wearTools = () => {
            if (odds.parts.tools && Utils.random() < _num(C.toolWear)) {
                inv.tools = Math.max(0, _num(inv.tools) - 1);
                if (inv.tools <= 0) delete inv.tools;
                toolWorn = true;
            }
        };

        if (Utils.random() < odds.fail) {
            // Spoiled: part of every input is wasted
            const lost = {};
            for (const [item, amt] of Object.entries(recipe.ingredients || {})) {
                const n = Math.max(1, Math.ceil(amt * _num(C.failure.loss, 0.5)));
                const take = Math.min(n, _num(inv[item]));
                if (take > 0) {
                    Crafting._drawQuality(player, item, take);
                    inv[item] -= take;
                    if (inv[item] <= 0) delete inv[item];
                    lost[item] = take;
                }
            }
            wearTools();
            const xp = Math.round(xpFull * _num(C.failure.xpShare, 0.5) * 10) / 10;
            st.xp = _r2(_num(st.xp) + xp);
            st.failed = _num(st.failed) + 1;
            const after = Crafting.rank(player);
            return { success: false, failed: true, recipe, lost, xp, rankUp: after.level > before ? after : null, toolWorn, odds };
        }

        // Success: the quality of the work
        const Q = C.quality;
        const score = odds.score + Utils.randFloat(-_num(Q.noise), _num(Q.noise));
        const tierIdx = recipe.quality === false ? 1 : Crafting.tierOfScore(score);
        const snapshot = { ...inv };
        const snapQ = player.craftQuality ? JSON.parse(JSON.stringify(player.craftQuality)) : undefined;
        for (const [item, amt] of Object.entries(recipe.ingredients || {})) {
            Crafting._drawQuality(player, item, amt);
            inv[item] = _num(inv[item]) - amt;
            if (inv[item] <= 0) delete inv[item];
        }
        const given = PlayerInventory.addItems(player, recipe.result || {});
        if (given.full) {
            player.inventory = snapshot;
            if (snapQ !== undefined) player.craftQuality = snapQ;
            return { success: false, full: true, recipe, reason: PlayerInventory.fullMessage(player) };
        }
        if (recipe.quality !== false) {
            for (const [item, qty] of Object.entries(recipe.result || {})) Crafting.noteQuality(player, item, qty, tierIdx);
        }
        wearTools();
        st.xp = _r2(_num(st.xp) + xpFull);
        st.made = _num(st.made) + 1;
        if (tierIdx >= 3 && recipe.quality !== false) st.masterworks = _num(st.masterworks) + 1;
        const tier = Crafting.tier(tierIdx);
        const after = Crafting.rank(player);
        return {
            success: true, recipe, tier: tierIdx, tierName: tier.name, tierIcon: tier.icon, quality: recipe.quality !== false,
            results: { ...recipe.result }, xp: xpFull, rankUp: after.level > before ? after : null, toolWorn, odds,
        };
    },

    // ── Quality of goods held ────────────────────────────

    _rec(player, item) {
        const q = player && player.craftQuality;
        const rec = q && q[item];
        return rec && _num(rec.n) > 0 ? rec : null;
    },

    /** Note `qty` units of `item` just added to the packs at tier `tierIdx`. */
    noteQuality(player, item, qty, tierIdx) {
        if (!player || !(qty > 0)) return;
        if (!player.craftQuality || typeof player.craftQuality !== 'object') player.craftQuality = {};
        const held = _num(player.inventory && player.inventory[item]);
        const rec = player.craftQuality[item] || { n: 0, t: 0 };
        // Tracked units can't outnumber what was held before these were added
        const prior = Math.max(0, held - qty);
        if (rec.n > prior) {
            const k = rec.n > 0 ? prior / rec.n : 0;
            rec.n *= k;
            rec.t *= k;
        }
        rec.n = _r2(rec.n + qty);
        rec.t = _r2(rec.t + qty * tierIdx);
        player.craftQuality[item] = rec;
    },

    /** The average tier (0..3, Common = 1) of the `item` the player holds. */
    averageTier(player, item) {
        const inv = _num(player && player.inventory && player.inventory[item]);
        const rec = Crafting._rec(player, item);
        if (!(inv > 0) || !rec) return 1;
        const n = Math.min(rec.n, inv);
        const t = rec.t * (n / rec.n);
        return (t + (inv - n) * 1) / inv;
    },

    _interp(kind, avg) {
        const tiers = Crafting.config().tiers;
        const lo = _clamp(Math.floor(avg), 0, tiers.length - 1);
        const hi = Math.min(tiers.length - 1, lo + 1);
        const f = avg - lo;
        return _num(tiers[lo][kind], 1) * (1 - f) + _num(tiers[hi][kind], 1) * f;
    },

    /** Price multiplier for selling the `item` held (1 for ordinary goods). */
    saleMult(player, item) {
        return Crafting._rec(player, item) ? _r2(Crafting._interp('sale', Crafting.averageTier(player, item))) : 1;
    },

    /** Effect multiplier (nourishment, healing, protection) of the `item` held. */
    effectMult(player, item) {
        return Crafting._rec(player, item) ? _r2(Crafting._interp('effect', Crafting.averageTier(player, item))) : 1;
    },

    /** A label for the held stack's quality ('Fine'), or null for ordinary goods. */
    qualityLabel(player, item) {
        if (!Crafting._rec(player, item)) return null;
        return Crafting.tier(Crafting.averageTier(player, item)).name;
    },

    /**
     * A short tag for showing the held stack's quality in a row ('🔷 Fine'),
     * or '' for ordinary goods and stacks that average out to Common.
     */
    qualityTag(player, item) {
        if (!Crafting._rec(player, item)) return '';
        const t = Crafting.tier(Crafting.averageTier(player, item));
        if (!t || t.id === 'common') return '';
        return `${t.icon} ${t.name}`;
    },

    /**
     * `qty` units of `item` are about to leave the packs (sold, eaten, used):
     * the tracked units go down pro rata. Call BEFORE the inventory is
     * decremented. Returns the effect/sale multipliers those units carried.
     */
    _drawQuality(player, item, qty) {
        const rec = Crafting._rec(player, item);
        if (!rec) return { sale: 1, effect: 1 };
        const out = { sale: Crafting.saleMult(player, item), effect: Crafting.effectMult(player, item) };
        const inv = _num(player.inventory && player.inventory[item]);
        const frac = inv > 0 ? _clamp(qty / inv, 0, 1) : 1;
        const n = Math.min(rec.n, inv);
        const t = rec.t * (rec.n > 0 ? n / rec.n : 0);
        rec.n = _r2(n * (1 - frac));
        rec.t = _r2(t * (1 - frac));
        if (rec.n < 0.01) delete player.craftQuality[item];
        return out;
    },

    /** Use up `qty` of `item` (eaten, drunk, applied): returns its effect multiplier. */
    consume(player, item, qty = 1) {
        return Crafting._drawQuality(player, item, qty).effect;
    },

    /** Sell `qty` of `item`: returns its sale multiplier. */
    takeForSale(player, item, qty) {
        return Crafting._drawQuality(player, item, qty).sale;
    },
};
