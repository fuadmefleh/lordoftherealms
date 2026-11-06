// ============================================
// CRAFTING — the player's own hands at the bench, the forge and the hearth
// ============================================
// Recipes live in data/crafting.json (stations: cook, craft, smelt, brew,
// tan); each belongs to a craft skill (recipe.skill, else its station's:
// smithing, carpentry, tailoring, leatherwork, cooking, brewing, alchemy,
// jewellery, pottery — data/craftGrades.json). Every attempt can fail, and
// every success comes out at a grade — Poor, Common, Fine, Excellent or
// Masterwork (core/grades.js) — rolled from a quality score:
//   - the crafter's level in the recipe's skill (player.skills[skill], 0..10,
//     raised by crafting xp through OddJobs.gainXp),
//   - working in a fitting workshop (a blacksmith's anvil, a temple's
//     still…; better again in one the player owns),
//   - tools in the pack for the bench, the forge and the tannery (steel
//     tools help more; a tool's grade scales its help; they wear),
//   - the grade of the inputs (fine leather makes finer armour),
//   - the attribute the recipe leans on, the recipe's difficulty,
//   - for smithing, the Forge minigame's score (ui/minigames/forge),
//   - and a triangular noise from the seeded RNG.
// A failure wastes part of the inputs (and still teaches a little).
//
// The grade travels with the goods (player.craftGrades beside the plain
// inventory — core/grades.js). It sets the sale price (Trading.sellGoods),
// food nourishment and potion healing (the object-action modals), armour's
// protection and a blade's cut (PlayerEffects, Duels), how long clothes stay
// fresh (player/core/needs.js) and how much tools help here.
//
// The old single crafting rank (player.crafting.xp: Novice → Master
// Artisan) still counts all the work done; old saves seed the new skills
// from it the first time they're read.
//
// Smithing, Tanning & Weaving (leatherwork + tailoring) and Brewing (brewing
// + alchemy) are practised skills in levels (systems/tradeSkills.js,
// data/skillPacks/trades.json): their level replaces the 0..10 value, their
// perks set the craftsmanship added to the roll, how much a spoiled piece
// wastes, how long a piece takes (result.hours), the forge's steadiness and
// the chance of a spare piece; a level-up comes back as result.levelUp. Old
// player.skills values migrate into their XP and are kept in step.
//
// Domain rules: player / world / context are parameters, all randomness via
// Utils, packs through PlayerInventory (the inventory cap is respected: a
// craft whose product doesn't fit is undone).

import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { Grades } from '../core/grades.js';
import { PlayerInventory } from './inventory.js';
import { OddJobs } from './oddJobs.js';
import { PracticeSkills } from '../systems/practiceSkills.js';
import { TradeSkills } from '../systems/tradeSkills.js';

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
    failure: { base: 0.08, perDifficulty: 0.06, perLevel: 0.035, workshop: 0.04, tools: 0.03, forgePer: 0.004, min: 0.02, max: 0.6, loss: 0.5, xpShare: 0.5 },
    toolWear: 0.05,
    toolStations: ['craft', 'smelt', 'tan'],
    workshops: {},
    ownedBonus: 0.2,
};
const DEFAULT_ROLL = { base: 1, perLevel: 0.22, workshop: 0.35, tools: 0.2, perAttr: 0.05, perDifficulty: 0.25, perInputGrade: 0.25, forge: 0.7, noise: 0.9 };
const DEFAULT_STATION_SKILLS = { cook: 'cooking', craft: 'carpentry', smelt: 'smithing', brew: 'alchemy', tan: 'leatherwork' };

let _src;
let _cfg = null;

function _data() {
    const gd = DataLoader._gamedata;
    return (gd && gd.crafting) || null;
}

function _gradesData() {
    return Grades.data() || {};
}

export const Crafting = {
    /** Tuning (data/crafting.json config over the defaults). */
    config() {
        const d = _data();
        if (!_cfg || d !== _src) {
            _src = d;
            const o = (d && d.config) || {};
            const failure = { ...DEFAULT_CONFIG.failure, ...(o.failure || {}) };
            // (old data tuned failure per rank: a rank was two levels)
            if (o.failure && o.failure.perLevel == null && o.failure.perRank != null) failure.perLevel = o.failure.perRank / 2;
            _cfg = {
                ...DEFAULT_CONFIG, ...o,
                failure,
                workshops: { ...DEFAULT_CONFIG.workshops, ...(o.workshops || {}) },
            };
        }
        return _cfg;
    },

    /** The quality roll's tuning (data/craftGrades.json roll). */
    rollConfig() {
        return { ...DEFAULT_ROLL, ...(_gradesData().roll || {}) };
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

    // ── Overall rank (all the work done) ─────────────────

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

    // ── Craft skills ─────────────────────────────────────

    /** Every craft skill: { id: { name, icon, desc } }. */
    skills() {
        return _gradesData().skills || {};
    },

    skillDef(id) {
        const pid = TradeSkills.forCraft(id);
        const pd = pid && PracticeSkills.def(pid);
        if (pd) return { name: pd.name || pid, icon: pd.icon || '🔨', desc: pd.desc || '', practice: pid };
        return Crafting.skills()[id] || { name: String(id || 'craft'), icon: '🔨', desc: '' };
    },

    /** The practised skill (systems/tradeSkills.js) a craft skill is worked through, or null */
    practiceOf(skill) {
        return TradeSkills.forCraft(skill);
    },

    /** A practised craft's perk for the player at a craft skill (0 when the skill is not practised) */
    perk(player, skill, perkId) {
        const pid = TradeSkills.forCraft(skill);
        if (!pid || !player) return 0;
        TradeSkills.migrate(player);
        return PracticeSkills.perk(player, pid, perkId);
    },

    /** Hours a piece of this recipe takes the player (a practised craft's minutes; else an hour) */
    hoursFor(player, recipe) {
        const m = Crafting.perk(player, Crafting.skillOf(recipe), 'minutes');
        return m > 0 ? Math.round((m / 60) * 100) / 100 : 1;
    },

    /** The XP a craft's `xp` gives its skill (a practised craft's own rate; shown in notices) */
    practiceXp(skill, xp) {
        const pid = TradeSkills.forCraft(skill);
        return pid ? Math.round(_num(xp) * TradeSkills.xpRate(pid, 'craft', 2) * 10) / 10 : _num(xp);
    },

    /** Extra steadiness at the anvil (the forge minigame's strength) from Smithing */
    forgeBonus(player, recipe) {
        return Crafting.perk(player, Crafting.skillOf(recipe), 'forge');
    },

    /** The skill a recipe trains and leans on. */
    skillOf(recipe) {
        if (!recipe) return 'carpentry';
        if (recipe.skill) return recipe.skill;
        const map = { ...DEFAULT_STATION_SKILLS, ...(_gradesData().stationSkills || {}) };
        return map[recipe.station] || 'carpentry';
    },

    /** Old saves: the craft skills start from the old single rank, once. */
    _seedFromRank(player) {
        const st = player && player.crafting;
        if (!st || st.seeded) return;
        st.seeded = true;
        const rank = Crafting.rank(player).level;
        if (!(rank > 0)) return;
        if (!player.skills || typeof player.skills !== 'object') player.skills = {};
        const lvl = Math.min(10, _r2(rank * _num(_gradesData().legacyPerRank, 1.5)));
        for (const id of Object.keys(Crafting.skills())) {
            if (typeof player.skills[id] !== 'number') player.skills[id] = lvl;
        }
    },

    /** The player's level (0..10) in a craft skill. */
    skillLevel(player, skill) {
        if (!player) return 0;
        Crafting._seedFromRank(player);
        const pid = TradeSkills.forCraft(skill);
        if (pid) {
            TradeSkills.migrate(player);
            return _clamp(TradeSkills.craftLevel(player, pid), 0, 10);
        }
        return _clamp(_num(player.skills && player.skills[skill]), 0, 10);
    },

    /** The title of a skill level (Novice … Grandmaster). */
    skillTitle(level) {
        const titles = _gradesData().titles || [{ min: 0, name: 'Novice' }];
        let out = titles[0] ? titles[0].name : 'Novice';
        for (const t of titles) if (level >= _num(t.min)) out = t.name;
        return out;
    },

    /** { id, name, icon, level, title, xp, need } for a craft skill. */
    skillInfo(player, skill) {
        const def = Crafting.skillDef(skill);
        const level = Crafting.skillLevel(player, skill);
        if (def.practice) {
            const p = PracticeSkills.progress(player || {}, def.practice);
            return {
                id: def.practice, name: def.name, icon: def.icon, level, title: p.levelName,
                practice: def.practice, practiceLevel: p.level, xp: p.into, need: p.need,
            };
        }
        return {
            id: skill, name: def.name, icon: def.icon, level, title: Crafting.skillTitle(level),
            xp: _num(player && player.skillXp && player.skillXp[skill]), need: _r2(2 + level * 0.5),
        };
    },

    /** Every craft skill the player has any level in, best first. */
    skillList(player) {
        const seen = new Set();
        return Object.keys(Crafting.skills()).map(id => Crafting.skillInfo(player, id))
            .filter(s => {
                if (seen.has(s.id)) return false;
                seen.add(s.id);
                return s.level > 0 || s.xp > 0;
            }).sort((a, b) => b.level - a.level);
    },

    /** Craft xp into a skill (× data xpScale). → [{ id, by }] the levels gained. */
    trainSkill(player, skill, xp) {
        if (!player || !(xp > 0)) return [];
        Crafting._seedFromRank(player);
        const pid = TradeSkills.forCraft(skill);
        if (pid) {
            const up = TradeSkills.gain(player, pid, xp * TradeSkills.xpRate(pid, 'craft', 2));
            return up ? [{ id: pid, kind: 'practice', by: up.to - up.from, event: up }] : [];
        }
        if (!player.skills || typeof player.skills !== 'object') player.skills = {};
        if (player.skills[skill] == null) player.skills[skill] = 0;
        return OddJobs.gainXp(player, { skills: { [skill]: 1 } }, xp * _num(_gradesData().xpScale, 0.6));
    },

    /** The skill's info when it passed a whole level since `before`, else null (for a notice). */
    _levelUp(player, skill, before) {
        if (TradeSkills.forCraft(skill)) return null; // announced as result.levelUp
        const now = Crafting.skillLevel(player, skill);
        return Math.floor(now + 1e-9) > Math.floor(_num(before) + 1e-9) ? Crafting.skillInfo(player, skill) : null;
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

    /**
     * The tools the player would work with at this recipe's station: the
     * best set carried → { item, power, grade (index), effect } or null.
     */
    toolsFor(player, recipe) {
        if (!recipe || !Crafting.config().toolStations.includes(recipe.station)) return null;
        const powers = _gradesData().tools || { tools: 1 };
        let best = null;
        for (const [item, power] of Object.entries(powers)) {
            if (!(_num(player && player.inventory && player.inventory[item]) > 0)) continue;
            const grade = Grades.bestIndex(player, item);
            const effect = Grades.effectMult(grade == null ? Grades.COMMON : grade);
            const value = _num(power, 1) * effect;
            if (!best || value > best.value) best = { item, power: _num(power, 1), grade: grade == null ? Grades.COMMON : grade, effect, value };
        }
        return best;
    },

    _hasTools(player, recipe) {
        return !!Crafting.toolsFor(player, recipe);
    },

    /** The average grade index of the inputs a craft would use (best first; Common when none is graded). */
    inputGrade(player, recipe) {
        let n = 0, sum = 0;
        for (const [item, amt] of Object.entries((recipe && recipe.ingredients) || {})) {
            if (!Grades.gradeable(item)) continue;
            const p = Grades.peek(player, item, amt, { order: 'best' });
            if (!(p.n > 0)) continue;
            n += p.n;
            sum += p.index * p.n;
        }
        return n > 0 ? _r2(sum / n) : Grades.COMMON;
    },

    /**
     * The odds of an attempt: { fail, score (quality score), tier (the
     * likeliest grade index), dist (the odds of each grade), skill, level,
     * parts } — ctx: { building, forgeScore (0..100) }.
     */
    odds(player, recipe, ctx = {}) {
        const F = Crafting.config().failure;
        const R = Crafting.rollConfig();
        const skill = Crafting.skillOf(recipe);
        const level = Crafting.skillLevel(player, skill);
        const shop = Crafting.workshopBonus(recipe, ctx.building);
        const tool = Crafting.toolsFor(player, recipe);
        const tools = tool ? 1 : 0;
        const diff = Math.max(1, _num(recipe.difficulty, 1));
        const attr = _num(player[recipe.attr || 'intelligence'], 5);
        const forge = ctx.forgeScore != null ? _clamp(_num(ctx.forgeScore), 0, 100) : null;
        const input = Crafting.inputGrade(player, recipe);
        // A practised craft's levels give their craftsmanship perk in place of level x perLevel
        const practised = !!TradeSkills.forCraft(skill);
        const skillScore = practised ? Crafting.perk(player, skill, 'quality') : level * R.perLevel;
        let score = R.base + skillScore + shop * R.workshop + (tool ? R.tools * tool.power * tool.effect : 0)
            + (attr - 5) * R.perAttr - (diff - 1) * R.perDifficulty + (input - Grades.COMMON) * R.perInputGrade;
        if (forge != null) score += ((forge - 50) / 50) * R.forge;
        let fail = F.base + diff * F.perDifficulty - level * F.perLevel - shop * F.workshop - tools * F.tools;
        if (forge != null) fail += (50 - forge) * F.forgePer;
        fail = _clamp(fail, F.min, F.max);
        const dist = recipe.quality === false ? Grades.list().map((g, i) => (i === Grades.COMMON ? 1 : 0)) : Grades.distribution(score, R.noise);
        let tier = Grades.COMMON;
        for (let i = 0; i < dist.length; i++) if (dist[i] > dist[tier]) tier = i;
        const waste = practised ? Crafting.perk(player, skill, 'waste') / 100 : _num(F.loss, 0.5);
        return { fail: _r2(fail), score: _r2(score), tier, dist, skill, level, waste: _r2(waste), parts: { level, shop, tools, tool, diff, forge, input, skillScore: _r2(skillScore) } };
    },

    /** Grade index (0 poor … 4 masterwork) for a quality score. */
    tierOfScore(score) {
        return Grades.indexOfScore(score);
    },

    /** A grade by index: { id, name, icon, color, price, effect } (sale = price, for older callers). */
    tier(idx) {
        const g = Grades.get(Math.round(_num(idx, Grades.COMMON)));
        return { ...g, sale: g.price };
    },

    // ── The attempt ──────────────────────────────────────

    /**
     * Try a recipe. ctx: { building, forgeScore, world }.
     * Returns { success, failed?, reason?, recipe, tier, tierName, results,
     * lost, xp, skill, skillUp, rankUp, toolWorn, full? }. success:false
     * with `full` means nothing happened (the product wouldn't fit); with
     * `failed` the attempt was made and spoiled.
     */
    craft(player, recipeOrId, ctx = {}) {
        const recipe = typeof recipeOrId === 'string' ? Crafting.recipe(recipeOrId) : recipeOrId;
        if (!player || !recipe) return { success: false, reason: 'No such recipe.' };
        if (!Crafting.canCraft(player, recipe)) return { success: false, reason: 'You lack the materials.' };
        const C = Crafting.config();
        const st = Crafting._state(player);
        const odds = Crafting.odds(player, recipe, ctx);
        const skill = odds.skill;
        const before = Crafting.rank(player).level;
        const xpFull = _num(recipe.xp, 2 + Math.max(1, _num(recipe.difficulty, 1)) * 3);
        const inv = player.inventory;

        // Tools wear with use (a better set lasts longer)
        let toolWorn = false;
        const wearTools = () => {
            const tool = odds.parts.tool;
            if (tool && Utils.random() < _num(C.toolWear) / Math.max(0.5, tool.effect)) {
                Grades.remove(player, tool.item, 1, { order: 'best' });
                toolWorn = true;
            }
        };

        if (Utils.random() < odds.fail) {
            // Spoiled: part of every input is wasted (the worst of it first)
            const lost = {};
            for (const [item, amt] of Object.entries(recipe.ingredients || {})) {
                const n = Math.max(1, Math.ceil(amt * _num(odds.waste, _num(C.failure.loss, 0.5)) - 1e-9));
                const take = Math.min(n, _num(inv[item]));
                if (take > 0) {
                    Grades.remove(player, item, take, { order: 'worst' });
                    lost[item] = take;
                }
            }
            wearTools();
            const xp = Math.round(xpFull * _num(C.failure.xpShare, 0.5) * 10) / 10;
            st.xp = _r2(_num(st.xp) + xp);
            st.failed = _num(st.failed) + 1;
            const upF = Crafting.trainSkill(player, skill, xp);
            const after = Crafting.rank(player);
            return {
                success: false, failed: true, recipe, lost, xp, skill, skillUp: Crafting._levelUp(player, skill, odds.level),
                levelUp: Crafting._practiceEvent(upF), hours: Crafting.hoursFor(player, recipe), rankUp: after.level > before ? after : null, toolWorn, odds,
            };
        }

        // Success: the grade of the work
        const tierIdx = recipe.quality === false ? Grades.COMMON : Grades.roll(odds.score, Crafting.rollConfig().noise);
        const snapshot = { ...inv };
        const snapG = player.craftGrades ? JSON.parse(JSON.stringify(player.craftGrades)) : undefined;
        for (const [item, amt] of Object.entries(recipe.ingredients || {})) Grades.remove(player, item, amt, { order: 'best' });
        const given = PlayerInventory.addItems(player, recipe.result || {});
        if (given.full) {
            player.inventory = snapshot;
            if (snapG !== undefined) player.craftGrades = snapG;
            else delete player.craftGrades;
            return { success: false, full: true, recipe, reason: PlayerInventory.fullMessage(player) };
        }
        if (recipe.quality !== false) {
            for (const [item, qty] of Object.entries(recipe.result || {})) Grades.add(player, item, qty, tierIdx);
        }
        // A practised hand sometimes gets a spare piece out of the same stuff
        let spare = null;
        const spareChance = Crafting.perk(player, skill, 'spare') / 100;
        if (spareChance > 0 && Utils.random() < spareChance) {
            const [item] = Object.keys(recipe.result || {});
            if (item && !PlayerInventory.addItems(player, { [item]: 1 }).full) {
                if (recipe.quality !== false) Grades.add(player, item, 1, tierIdx);
                spare = item;
            }
        }
        wearTools();
        st.xp = _r2(_num(st.xp) + xpFull);
        st.made = _num(st.made) + 1;
        if (tierIdx >= Grades.index('masterwork') && recipe.quality !== false) st.masterworks = _num(st.masterworks) + 1;
        const hours = Crafting.hoursFor(player, recipe);
        const up = Crafting.trainSkill(player, skill, xpFull);
        const skillUp = Crafting._levelUp(player, skill, odds.level);
        const tier = Crafting.tier(tierIdx);
        const after = Crafting.rank(player);
        return {
            success: true, recipe, tier: tierIdx, tierName: tier.name, tierIcon: tier.icon, tierColor: tier.color, quality: recipe.quality !== false,
            results: spare ? { ...recipe.result, [spare]: _num(recipe.result[spare]) + 1 } : { ...recipe.result }, spare, xp: xpFull, skill, skillUp,
            levelUp: Crafting._practiceEvent(up), hours,
            rankUp: after.level > before ? after : null, toolWorn, odds,
        };
    },

    /** The level-up event out of trainSkill's gains, or null */
    _practiceEvent(gains) {
        const g = Array.isArray(gains) ? gains.find(x => x && x.kind === 'practice' && x.event) : null;
        return g ? g.event : null;
    },

    // ── Grades of goods held (core/grades.js) ────────────

    /** Note `qty` units of `item` just added to the packs at grade index `tierIdx` (or a grade id). */
    noteQuality(player, item, qty, tierIdx) {
        Grades.add(player, item, qty, tierIdx);
    },

    /** The average grade index (0..4, Common = 1) of the `item` the player holds. */
    averageTier(player, item) {
        const held = Math.floor(_num(player && player.inventory && player.inventory[item]));
        if (!(held > 0)) return Grades.COMMON;
        return Grades.peek(player, item, held).index;
    },

    /** Price multiplier for selling `qty` of the `item` held (sold without naming a grade: Common first). */
    saleMult(player, item, qty = 1, grade = null) {
        return Grades.peek(player, item, qty, grade ? { grade } : { order: 'sale' }).price;
    },

    /** Effect multiplier of the `item` held: the best of it is what you wear, wield or use. */
    effectMult(player, item) {
        const i = Grades.bestIndex(player, item);
        return i == null ? 1 : Grades.effectMult(i);
    },

    /** The best grade held (a tier object; Common when none is held). */
    bestTier(player, item) {
        const i = Grades.bestIndex(player, item);
        return Crafting.tier(i == null ? Grades.COMMON : i);
    },

    /** The name of the best grade held ('Fine'), or null when the stack is all Common. */
    qualityLabel(player, item) {
        if (!Grades.hasGraded(player, item)) return null;
        return Grades.get(Grades.bestIndex(player, item)).name;
    },

    /** A short tag for the held stack's grades ('🔵 Fine', '2 Fine · 1 Poor'), or '' when all Common. */
    qualityTag(player, item) {
        return Grades.tag(player, item);
    },

    /** The same as coloured chips (UI). */
    qualityHtml(player, item) {
        return Grades.tagHtml(player, item);
    },

    /**
     * `qty` units of `item` are about to leave the packs: the graded record
     * goes down with them. Call BEFORE the inventory is decremented.
     * Returns the price/effect multipliers those units carried.
     */
    _drawQuality(player, item, qty, order = 'best') {
        const r = Grades.take(player, item, qty, { order });
        return { sale: r.price, effect: r.effect, drawn: r.drawn };
    },

    /** Use up `qty` of `item` (eaten, drunk, applied; the best first): returns its effect multiplier. */
    consume(player, item, qty = 1) {
        return Grades.take(player, item, qty, { order: 'best' }).effect;
    },

    /** Sell `qty` of `item` (a grade, or Common first): returns its price multiplier. */
    takeForSale(player, item, qty, grade = null) {
        return Grades.take(player, item, qty, grade ? { grade } : { order: 'sale' }).price;
    },
};
