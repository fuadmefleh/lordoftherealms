// ============================================
// DELVES — multi-stage expeditions into the great ruins and caves
// ============================================
// Minor points of interest (shrines, oases, monuments) are still searched
// with a single Explore roll (ActionMenu.explorePOI). The major ones — ruins,
// caves, and the tombs, sunken halls and abandoned mines they turn out to be
// (by the terrain they stand on) — are DELVES: 3–6 chambers drawn from a
// per-kind chamber table, the last one always a deep finale.
//
// Each chamber poses a situation with 2–3 choices. A choice may cost stamina
// (today's movement), health, gold or a carried item, and may test the
// player: an attribute (strength/charisma/intelligence/faith/luck), a skill,
// carried equipment, treasures and traits (via PlayerEffects / Traits),
// companions in the travel party and earned traits. Success and failure each
// carry an outcome: loot (through PlayerInventory.addItem, so the inventory
// cap holds), gold, renown, karma, lore (Peoples history and heritage),
// charts (ancient / treasure maps), legendary artifact fragments, harm,
// lingering injuries, a cursed idol, or an awakened guardian that roams the
// world afterwards.
//
// Between chambers the player may retreat and keep everything found so far;
// every chamber deeper raises both the danger (check penalty, harsher harm)
// and the reward (larger hauls). A delve is one-time per POI: when it ends the
// POI is marked explored and delved.
//
// Content lives in data/delves.json (DataLoader → Delves.load). State lives
// on player.delves (serialized by saveLoad). All randomness flows through
// Utils; no import-time side effects; world/player are passed in.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { PlayerInventory } from '../core/inventory.js';
import { WorldUnit } from '../world/units.js';
import { Traits } from './traits.js';
import { Quests } from './quests.js';
import { LegendaryArtifacts } from './legendaryArtifacts.js';
import { Peoples } from './peoples.js';
import { Cartography } from './cartography.js';
import { Relationships } from './relationships.js';
import { PlayerEffects } from '../player/playerEffects.js';
import { Ailments } from './ailments.js';

const DEFAULT_CONFIG = {
    minChambers: 3,
    maxChambers: 6,
    depthRisk: 0.05,
    depthReward: 0.25,
    depthHarm: 0.12,
    statWeight: 0.05,
    skillWeight: 0.04,
    minChance: 0.05,
    maxChance: 0.95,
    collapseHealth: 10,
    staminaShortfallHealth: 3,
    injuryDays: [6, 12],
    guardianDays: 60,
    curseItem: 'cursed_idol',
    curseHealthPerDay: 1,
    curseKarmaPerDay: 1,
    cursePenalty: 0.05,
    clearRenown: 10,
};

/** Attributes a check may test. */
export const DELVE_STATS = ['strength', 'charisma', 'intelligence', 'faith', 'luck'];
/** Skills a check may test (player.skills). */
export const DELVE_SKILLS = ['combat', 'stealth', 'diplomacy', 'leadership', 'commerce', 'cartography'];
/** PlayerEffects keys a check may lean on (treasures + traits). */
export const DELVE_EFFECT_KEYS = ['battlePower', 'damageReduction', 'negotiation'];
/** Keys an outcome block may carry. */
export const DELVE_OUTCOME_KEYS = [
    'text', 'gold', 'items', 'renown', 'karma', 'health', 'stamina', 'injury',
    'lore', 'chart', 'fragment', 'artifact', 'guardian', 'curse', 'skills',
    'deeds', 'insight', 'collapse', 'guardianChance',
];
/** Keys a choice may carry. */
export const DELVE_CHOICE_KEYS = ['id', 'label', 'hint', 'cost', 'check', 'success', 'failure', 'deeds'];
/** Keys a choice's cost may carry. */
export const DELVE_COST_KEYS = ['stamina', 'health', 'gold', 'items'];
/** Keys a check may carry. */
export const DELVE_CHECK_KEYS = ['base', 'stat', 'skill', 'items', 'companions', 'traits', 'effects'];
/** Lore kinds an outcome may grant. */
export const DELVE_LORE_KINDS = ['ancient', 'origin', 'founding', 'any'];
/** Chart kinds an outcome may grant. */
export const DELVE_CHART_KINDS = ['ancient', 'treasure'];

function _num(v) {
    return typeof v === 'number' && isFinite(v) ? v : 0;
}

/** A number, or a random integer from a [min, max] range. */
function _roll(v) {
    if (Array.isArray(v)) return Utils.randInt(v[0], v[1]);
    return _num(v);
}

function _key(q, r) {
    return `${q},${r}`;
}

function _day(world) {
    return (world && world.day) || 0;
}

export const Delves = {
    CONFIG: { ...DEFAULT_CONFIG },
    KINDS: {},
    KIND_ORDER: [],
    CHAMBERS: {},
    INJURIES: {},
    GUARDIANS: {},

    /** Live guardian units this session, by guardian record id (the units are saved with the world; this map is rebuilt from them). */
    _live: new Map(),

    /** Install content from data/delves.json. */
    load(data) {
        if (!data) return;
        Delves.CONFIG = { ...DEFAULT_CONFIG, ...(data.config || {}) };
        Delves.KINDS = data.kinds || {};
        Delves.KIND_ORDER = Array.isArray(data.kindOrder) ? data.kindOrder : Object.keys(Delves.KINDS);
        Delves.CHAMBERS = data.chambers || {};
        Delves.INJURIES = data.injuries || {};
        Delves.GUARDIANS = data.guardians || {};
    },

    /** Lazily install content when DataLoader has it but load() was never called. */
    _ensureLoaded() {
        if (Object.keys(Delves.KINDS).length) return;
        const data = DataLoader.delves || (DataLoader.get && DataLoader.get('delves'));
        if (data) Delves.load(data);
    },

    // ──────────── STATE ────────────

    _blank() {
        return {
            active: null,
            completed: [],
            injuries: [],
            guardians: [],
            nextGuardianId: 1,
            stats: { delves: 0, chambers: 0, deepest: 0, retreats: 0, collapses: 0, cleared: 0 },
        };
    },

    /** Get (creating/backfilling) the player's delve record. */
    getState(player) {
        if (!player) return null;
        let st = player.delves;
        if (!st || typeof st !== 'object' || Array.isArray(st)) {
            player.delves = Delves._blank();
            return player.delves;
        }
        const blank = Delves._blank();
        if (st.active === undefined) st.active = null;
        if (!Array.isArray(st.completed)) st.completed = [];
        if (!Array.isArray(st.injuries)) st.injuries = [];
        if (!Array.isArray(st.guardians)) st.guardians = [];
        if (!(st.nextGuardianId > 0)) st.nextGuardianId = st.guardians.length + 1;
        if (!st.stats || typeof st.stats !== 'object') st.stats = blank.stats;
        for (const [k, v] of Object.entries(blank.stats)) if (typeof st.stats[k] !== 'number') st.stats[k] = v;
        return st;
    },

    serialize(player) {
        return player && player.delves ? JSON.parse(JSON.stringify(player.delves)) : null;
    },

    /** Backfill after load (older saves have no delve record). */
    loadState(player) {
        Delves.getState(player);
        Delves._live = new Map();
    },

    /** The delve in progress, or null. */
    active(player) {
        return (player && player.delves && player.delves.active) || null;
    },

    // ──────────── SITES ────────────

    /** The delve kind id for a POI on a tile, or null for a minor POI. */
    kindFor(tile) {
        Delves._ensureLoaded();
        const poi = tile && tile.improvement;
        if (!poi || !poi.type) return null;
        const terrain = tile.terrain && tile.terrain.id;
        for (const id of Delves.KIND_ORDER) {
            const k = Delves.KINDS[id];
            if (!k || !Array.isArray(k.poiTypes) || !k.poiTypes.includes(poi.type)) continue;
            if (Array.isArray(k.terrains) && k.terrains.length && !k.terrains.includes(terrain)) continue;
            return id;
        }
        return null;
    },

    /** Is this tile's POI a delve site (major POI, not yet explored)? */
    isDelveSite(tile) {
        const poi = tile && tile.improvement;
        return !!(poi && !poi.explored && Delves.kindFor(tile));
    },

    /** Display info for a site's kind ({ name, icon, intro }). */
    siteInfo(tile) {
        const id = Delves.kindFor(tile);
        const k = id && Delves.KINDS[id];
        return k ? { kind: id, name: k.name, icon: k.icon, intro: k.intro } : null;
    },

    // ──────────── STARTING ────────────

    /**
     * Begin a delve at the tile's POI. Draws the chamber plan.
     * @returns {{success:boolean, reason?:string, delve?:object}}
     */
    start(player, world, tile) {
        Delves._ensureLoaded();
        const st = Delves.getState(player);
        if (!tile || !tile.improvement) return { success: false, reason: 'There is nothing here to delve into.' };
        const key = _key(tile.q, tile.r);
        if (st.active) {
            if (st.active.key === key) return { success: true, delve: st.active, resumed: true };
            return { success: false, reason: 'You are already in the middle of another delve.' };
        }
        const poi = tile.improvement;
        if (poi.explored || st.completed.includes(key)) return { success: false, reason: 'This place has already been delved.' };
        const kindId = Delves.kindFor(tile);
        const kind = kindId && Delves.KINDS[kindId];
        if (!kind) return { success: false, reason: 'This place holds no depths worth delving.' };

        const cfg = Delves.CONFIG;
        const count = Utils.randInt(cfg.minChambers, cfg.maxChambers);
        const pool = (kind.chambers || []).filter(id => Delves.CHAMBERS[id]);
        const plan = [];
        const bag = pool.slice();
        while (plan.length < count - 1 && bag.length) {
            const idx = Math.floor(Utils.random() * bag.length);
            plan.push(bag.splice(idx, 1)[0]);
        }
        const finales = (kind.finales || []).filter(id => Delves.CHAMBERS[id]);
        if (finales.length) plan.push(Utils.randPick(finales));

        st.active = {
            key, q: tile.q, r: tile.r,
            kind: kindId,
            poiType: poi.type,
            name: poi.name || kind.name,
            plan,
            index: 0,
            phase: 'chamber',
            insight: 0,
            startedDay: _day(world),
            haul: { gold: 0, items: {}, leftBehind: {}, renown: 0, karma: 0, lore: [], maps: [], fragments: [], injuries: [], curse: false, guardian: null },
            log: [],
        };
        // Partly looted by a rival adventurer: thinner hauls (systems/rivals.js)
        if (poi.rivalLooted && poi.rivalLooted.lootFactor > 0) {
            st.active.lootFactor = poi.rivalLooted.lootFactor;
            st.active.lootedBy = poi.rivalLooted.by || null;
        }
        if (poi.type === 'ruins') Quests.track(player, 'ruins_explored');
        return { success: true, delve: st.active };
    },

    /** The chamber the player currently faces (or just left), or null. */
    currentChamber(player) {
        const a = Delves.active(player);
        if (!a) return null;
        const id = a.plan[a.index];
        return id ? { id, ...Delves.CHAMBERS[id], deep: a.index === a.plan.length - 1 } : null;
    },

    // ──────────── CHECKS ────────────

    _companionOccupations(player) {
        if (!player || !Array.isArray(player.travelParty) || !player.travelParty.length) return [];
        try {
            return Relationships.getTravelPartyMembers(player).map(n => n && n.occupation).filter(Boolean);
        } catch (e) {
            return [];
        }
    },

    _carries(player, itemId) {
        return !!(player && player.inventory && player.inventory[itemId] > 0);
    },

    /** Is the player carrying the cursed idol? */
    isCursed(player) {
        return Delves._carries(player, Delves.CONFIG.curseItem);
    },

    /** Lingering delve injuries' total penalty to an attribute. */
    injuryPenalty(player, stat) {
        const st = player && player.delves;
        if (!st || !Array.isArray(st.injuries)) return 0;
        return st.injuries.filter(i => i.stat === stat).reduce((s, i) => s + _num(i.amount), 0);
    },

    /**
     * Success chance of a choice for this player at this depth (0..1), or
     * null when the choice is not a test (it always succeeds).
     */
    chance(player, choice, depth = 0, insight = 0) {
        const check = choice && choice.check;
        if (!check) return null;
        const cfg = Delves.CONFIG;
        let p = typeof check.base === 'number' ? check.base : 0.5;
        if (check.stat) p += (_num(player[check.stat]) - 5) * cfg.statWeight;
        if (check.skill) p += _num(player.skills && player.skills[check.skill]) * cfg.skillWeight;
        for (const [item, bonus] of Object.entries(check.items || {})) {
            if (Delves._carries(player, item)) p += _num(bonus);
        }
        if (check.companions) {
            const occ = Delves._companionOccupations(player);
            for (const [role, bonus] of Object.entries(check.companions)) {
                if (occ.includes(role)) p += _num(bonus);
            }
        }
        for (const [trait, bonus] of Object.entries(check.traits || {})) {
            if (Traits.has(player, trait)) p += _num(bonus);
        }
        for (const [key, weight] of Object.entries(check.effects || {})) {
            const v = _num(PlayerEffects.treasureBonus(player, key)) + _num(Traits.effect(player, key));
            p += v * _num(weight);
        }
        p -= depth * cfg.depthRisk;
        p += _num(insight);
        // A rival adventurer delving at your side (systems/rivals.js team-up)
        p += Delves.partnerBonus(player);
        if (Delves.isCursed(player)) p -= cfg.cursePenalty;
        return Math.max(cfg.minChance, Math.min(cfg.maxChance, p));
    },

    /** Can the player pay this choice's cost? { ok, reason } (stamina/health never block). */
    canChoose(player, choice) {
        const cost = (choice && choice.cost) || {};
        if (cost.gold > 0 && (player.gold || 0) < cost.gold) return { ok: false, reason: `Needs ${cost.gold} gold` };
        for (const [item, qty] of Object.entries(cost.items || {})) {
            if (!((player.inventory && player.inventory[item]) >= qty)) return { ok: false, reason: `Needs ${qty} ${item.replace(/_/g, ' ')}` };
        }
        return { ok: true };
    },

    /**
     * The choices of the current chamber, with odds and availability for the
     * UI: [{ id, label, hint, chance, odds, can, costText }].
     */
    describeChoices(player) {
        const a = Delves.active(player);
        const ch = Delves.currentChamber(player);
        if (!a || !ch) return [];
        return (ch.choices || []).map(c => {
            const chance = Delves.chance(player, c, a.index, a.insight);
            const can = Delves.canChoose(player, c);
            const cost = c.cost || {};
            const parts = [];
            if (cost.stamina) parts.push(`${cost.stamina} stamina`);
            if (cost.health) parts.push(`${cost.health} health`);
            if (cost.gold) parts.push(`${cost.gold} gold`);
            for (const [item, qty] of Object.entries(cost.items || {})) parts.push(`${qty} ${item.replace(/_/g, ' ')}`);
            return {
                id: c.id, label: c.label, hint: c.hint || '',
                chance, odds: Delves.oddsLabel(chance),
                can, costText: parts.join(', '),
            };
        });
    },

    oddsLabel(chance) {
        if (chance === null || chance === undefined) return 'certain';
        if (chance >= 0.8) return 'very likely';
        if (chance >= 0.6) return 'likely';
        if (chance >= 0.4) return 'even odds';
        if (chance >= 0.2) return 'risky';
        return 'desperate';
    },

    // ──────────── RESOLVING ────────────

    /**
     * Take a choice in the current chamber. Pays the cost, rolls the check,
     * applies the outcome. Returns { success, passed, lines, ended, result? }.
     */
    choose(player, world, choiceId) {
        const st = Delves.getState(player);
        const a = st.active;
        if (!a) return { success: false, reason: 'You are not delving.' };
        if (a.phase !== 'chamber') return { success: false, reason: 'Decide first whether to press on or turn back.' };
        const ch = Delves.currentChamber(player);
        const choice = ch && (ch.choices || []).find(c => c.id === choiceId);
        if (!choice) return { success: false, reason: 'No such choice.' };
        const can = Delves.canChoose(player, choice);
        if (!can.ok) return { success: false, reason: can.reason };

        const lines = [];
        const cfg = Delves.CONFIG;
        const depth = a.index;

        // Cost
        const cost = choice.cost || {};
        if (cost.stamina > 0) {
            const have = Math.max(0, _num(player.movementRemaining));
            const paid = Math.min(have, cost.stamina);
            player.movementRemaining = have - paid;
            const short = cost.stamina - paid;
            if (short > 0) {
                const hurt = short * cfg.staminaShortfallHealth;
                player.health = Math.max(1, _num(player.health) - hurt);
                lines.push(`Exhausted, you push on anyway (-${hurt} health).`);
            }
        }
        if (cost.health > 0) player.health = Math.max(1, _num(player.health) - cost.health);
        if (cost.gold > 0) player.gold = _num(player.gold) - cost.gold;
        for (const [item, qty] of Object.entries(cost.items || {})) {
            player.inventory[item] -= qty;
            if (player.inventory[item] <= 0) delete player.inventory[item];
        }

        // Deeds of the choice itself (bravery, cunning, piety, …)
        if (choice.deeds) Traits.recordDeeds(player, choice.deeds);

        // Check
        const chance = Delves.chance(player, choice, depth, a.insight);
        a.insight = 0;
        const passed = chance === null ? true : Utils.random() < chance;
        const outcome = (passed ? choice.success : choice.failure) || {};
        const applied = Delves._applyOutcome(player, world, outcome, depth);
        lines.push(...applied.lines);

        st.stats.chambers++;
        a.log.push({ chamber: ch.id, choice: choice.id, passed });
        a.index++;
        st.stats.deepest = Math.max(st.stats.deepest, a.index);

        let ended = null;
        if (applied.collapse) ended = 'collapse';
        else if (_num(player.health) <= cfg.collapseHealth) ended = 'collapse';
        else if (a.index >= a.plan.length) ended = 'cleared';

        const res = { success: true, passed, chance, text: outcome.text || '', lines, chamber: ch, choice };
        if (ended) {
            res.ended = ended;
            res.result = Delves.finish(player, world, ended);
        } else {
            a.phase = 'between';
        }
        return res;
    },

    /** Go on to the next chamber. */
    pressOn(player) {
        const a = Delves.active(player);
        if (!a) return { success: false, reason: 'You are not delving.' };
        if (a.phase !== 'between') return { success: false, reason: 'Deal with this chamber first.' };
        a.phase = 'chamber';
        return { success: true, chamber: Delves.currentChamber(player) };
    },

    /** Turn back and keep the haul. Before the first chamber it costs nothing. */
    retreat(player, world) {
        const a = Delves.active(player);
        if (!a) return { success: false, reason: 'You are not delving.' };
        if (a.index === 0) {
            player.delves.active = null;
            return { success: true, abandoned: true };
        }
        return { success: true, result: Delves.finish(player, world, 'retreat') };
    },

    /** Scale a reward by depth. */
    _rewardMult(depth) {
        return 1 + depth * Delves.CONFIG.depthReward;
    },

    _applyOutcome(player, world, o, depth) {
        const a = player.delves.active;
        const haul = a.haul;
        const lines = [];
        // A site a rival adventurer already picked over yields less (systems/rivals.js)
        const mult = Delves._rewardMult(depth) * (a.lootFactor > 0 ? a.lootFactor : 1);
        const out = { lines, collapse: false };

        if (o.gold) {
            const g = Math.round(_roll(o.gold) * mult);
            if (g > 0) {
                player.gold = _num(player.gold) + g;
                haul.gold += g;
                lines.push(`+${g} gold`);
            } else if (g < 0) {
                player.gold = Math.max(0, _num(player.gold) + g);
                lines.push(`${g} gold`);
            }
        }
        for (const [item, range] of Object.entries(o.items || {})) {
            const qty = Math.max(1, Math.round(_roll(range) * mult));
            if (!player.inventory) player.inventory = {};
            const r = PlayerInventory.addItem(player, item, qty);
            if (r.success) {
                haul.items[item] = (haul.items[item] || 0) + qty;
                lines.push(`+${qty} ${item.replace(/_/g, ' ')}`);
            } else {
                haul.leftBehind[item] = (haul.leftBehind[item] || 0) + qty;
                lines.push(`${qty} ${item.replace(/_/g, ' ')} left behind — your packs are full`);
            }
        }
        if (o.renown) {
            const n = Math.round(_roll(o.renown) * (o.renown > 0 || Array.isArray(o.renown) ? mult : 1));
            player.renown = _num(player.renown) + n;
            haul.renown += n;
            lines.push(`${n >= 0 ? '+' : ''}${n} renown`);
        }
        if (o.karma) {
            const n = _roll(o.karma);
            player.karma = _num(player.karma) + n;
            haul.karma += n;
            lines.push(`${n >= 0 ? '+' : ''}${n} karma`);
        }
        if (o.health) {
            const raw = _roll(o.health);
            if (raw < 0) {
                const harm = PlayerEffects.scaleDamage(player, Math.round(-raw * (1 + depth * Delves.CONFIG.depthHarm)));
                player.health = Math.max(1, _num(player.health) - harm);
                if (harm > 0) lines.push(`-${harm} health`);
                else lines.push('Divine protection turns the harm aside.');
            } else if (raw > 0) {
                const max = player.maxHealth || 100;
                const before = _num(player.health);
                player.health = Math.min(max, before + raw);
                lines.push(`+${player.health - before} health`);
            }
        }
        if (o.stamina) {
            const n = _roll(o.stamina);
            const cap = Math.max(_num(player.stamina) || 10, _num(player.movementRemaining));
            const before = Math.max(0, _num(player.movementRemaining));
            player.movementRemaining = n > 0 ? Math.min(cap, before + n) : Math.max(0, before + n);
            const d = player.movementRemaining - before;
            if (d) lines.push(`${d > 0 ? '+' : ''}${d} stamina`);
        }
        for (const [skill, amt] of Object.entries(o.skills || {})) {
            if (!player.skills) player.skills = {};
            player.skills[skill] = Math.min(10, _num(player.skills[skill]) + _num(amt));
            lines.push(`${skill} skill improves`);
        }
        if (o.deeds) Traits.recordDeeds(player, o.deeds);
        if (o.insight) {
            a.insight = _num(a.insight) + _num(o.insight);
            lines.push('You will know better what lies ahead.');
        }
        if (o.injury && Utils.random() < _num(o.injury)) {
            const inj = Delves._injure(player, world);
            if (inj) {
                haul.injuries.push(inj.name);
                lines.push(`Injured: ${inj.name} (-${inj.amount} ${inj.stat} for ${inj.days} days)`);
            }
        }
        if (o.lore) {
            const entry = Delves._discoverLore(player, world, o.lore);
            if (entry) {
                haul.lore.push({ year: entry.year, text: entry.text });
                lines.push(`Lore discovered (year ${entry.year})`);
            }
        }
        if (o.chart) {
            const map = Delves._chart(player, world, o.chart);
            if (map) {
                haul.maps.push(map.name);
                lines.push(`Found: ${map.name}`);
            }
        }
        if (o.fragment && Utils.random() < _num(o.fragment)) {
            const kind = Delves.KINDS[a.kind] || {};
            const found = LegendaryArtifacts.grantFragment(player, kind.artifactBias || a.poiType);
            if (found && found.found) {
                haul.fragments.push(`${found.artifact.name} (${found.fragmentsOwned}/${found.fragmentsRequired})`);
                lines.push(`🧩 ${found.artifact.name} fragment (${found.fragmentsOwned}/${found.fragmentsRequired})`);
            }
        }
        if (o.artifact) {
            const found = LegendaryArtifacts.discoverFromPOI(player, world, null, { type: a.poiType });
            if (found && found.found) {
                if (found.type === 'artifact') {
                    haul.fragments.push(`${found.artifact.name} (whole)`);
                    lines.push(`${found.artifact.icon || '🏺'} ${found.artifact.name} recovered intact!`);
                } else {
                    haul.fragments.push(`${found.artifact.name} (${found.fragmentsOwned}/${found.fragmentsRequired})`);
                    lines.push(`🧩 ${found.artifact.name} fragment (${found.fragmentsOwned}/${found.fragmentsRequired})`);
                }
            }
        }
        if (o.curse && Utils.random() < _num(o.curse)) {
            const id = Delves.CONFIG.curseItem;
            if (!player.inventory) player.inventory = {};
            // A curse clings: it finds room in the packs whether there is any or not
            const r = PlayerInventory.addItem(player, id, 1, { force: true });
            if (r.success) {
                haul.curse = true;
                lines.push('A cursed idol has found its way into your packs...');
            }
        }
        if (o.guardian && Utils.random() < (o.guardianChance != null ? _num(o.guardianChance) : 1)) {
            const g = Delves._awaken(player, world, o.guardian);
            if (g) {
                haul.guardian = g.name;
                lines.push(`${g.icon} ${g.name} awakens and stalks out into the world!`);
            }
        }
        if (o.collapse) out.collapse = true;
        return out;
    },

    _injure(player, world) {
        const ids = Object.keys(Delves.INJURIES);
        if (!ids.length) return null;
        const id = Utils.randPick(ids);
        const def = Delves.INJURIES[id];
        const st = Delves.getState(player);
        const [lo, hi] = Delves.CONFIG.injuryDays;
        const days = Utils.randInt(lo, hi);
        // Delve injuries are ailments (systems/ailments.js): one place for
        // wounds, their effects, healing, infection and treatment
        if (def.ailment && Ailments.def(def.ailment)) {
            const rep = Ailments.inflict(player, world, def.ailment, { source: 'delve', days });
            if (rep) return { name: rep.name, stat: rep.stat || def.stat, amount: rep.amount, days: rep.days };
        }
        const until = _day(world) + days;
        const existing = st.injuries.find(i => i.id === id);
        if (existing) {
            existing.untilDay = Math.max(existing.untilDay, until);
            return { name: def.name, stat: def.stat, amount: existing.amount, days };
        }
        const amount = Math.max(0, Math.min(_num(def.amount) || 1, _num(player[def.stat]) - 1));
        player[def.stat] = _num(player[def.stat]) - amount;
        st.injuries.push({ id, name: def.name, stat: def.stat, amount, untilDay: until });
        return { name: def.name, stat: def.stat, amount, days };
    },

    _discoverLore(player, world, kind) {
        if (!world) return null;
        const opts = {};
        if (kind === 'ancient') opts.eraRange = [0, 450];
        else if (kind === 'origin') opts.type = 'tribal_origin';
        else if (kind === 'founding') opts.type = 'kingdom_formation';
        try {
            const found = Peoples.discoverLore(player, world, opts);
            return found && found.length ? found[0] : null;
        } catch (e) {
            return null;
        }
    },

    _chart(player, world, kind) {
        if (!world || !world.getTile) return null;
        const a = player.delves.active;
        let map = null;
        try {
            map = kind === 'treasure'
                ? Cartography.generateTreasureMap(world)
                : Cartography.generateAncientMap(world, a.q, a.r);
        } catch (e) {
            map = null;
        }
        if (!map) return null;
        if (!Array.isArray(player.maps)) player.maps = [];
        player.maps.push(map);
        return map;
    },

    _awaken(player, world, guardianId) {
        const def = Delves.GUARDIANS[guardianId];
        if (!def) return null;
        const st = Delves.getState(player);
        const a = st.active;
        if (st.guardians.some(g => g.key === a.key && !g.slain && !g.gone)) return null; // one per site
        const rec = {
            id: st.nextGuardianId++,
            type: guardianId,
            key: a.key, q: a.q, r: a.r,
            name: def.name, icon: def.icon,
            strength: _roll(def.strength) || 60,
            untilDay: _day(world) + Delves.CONFIG.guardianDays,
            slain: false, gone: false,
        };
        st.guardians.push(rec);
        if (world && Array.isArray(world.units)) Delves._spawnGuardian(world, rec);
        return rec;
    },

    _spawnGuardian(world, rec) {
        const unit = new WorldUnit('monster', rec.q, rec.r);
        unit.name = rec.name;
        unit.icon = rec.icon;
        unit.strength = rec.strength;
        unit.population = 1;
        unit.maxAge = 1e9;
        unit.delveGuardianId = rec.id;
        world.units.push(unit);
        Delves._live.set(rec.id, unit);
        return unit;
    },

    // ──────────── ENDING ────────────

    /**
     * End the delve ('cleared' | 'retreat' | 'collapse' | 'left'). Marks the
     * POI delved, picks up any map loot left there, rolls for a relic, records
     * deeds. Returns a summary { reason, chambers, total, haul, artifact }.
     */
    finish(player, world, reason) {
        const st = Delves.getState(player);
        const a = st.active;
        if (!a) return null;
        const tile = world && world.getTile ? world.getTile(a.q, a.r) : null;
        const poi = tile && tile.improvement;
        const kind = Delves.KINDS[a.kind] || {};
        const summary = { reason, kind: a.kind, name: a.name, chambers: a.index, total: a.plan.length, haul: a.haul, artifact: null, extra: [] };

        if (poi) {
            poi.explored = true;
            poi.delved = { day: _day(world), depth: a.index, of: a.plan.length, reason };
            // Ancient maps the Cartography system hid here
            if (Array.isArray(poi.loot) && poi.loot.length) {
                if (!Array.isArray(player.maps)) player.maps = [];
                for (const m of poi.loot) {
                    if (m && m.type && m.tiles) {
                        player.maps.push(m);
                        a.haul.maps.push(m.name);
                        summary.extra.push(`Found: ${m.name}`);
                    }
                }
                poi.loot = [];
            }
            // The relic roll the old single Explore made, for any delve that got somewhere
            if (a.index > 0) {
                const found = LegendaryArtifacts.discoverFromPOI(player, world, tile, poi);
                if (found && found.found) summary.artifact = found;
            }
            if (tile.kingdom && typeof player.learnAboutKingdom === 'function') {
                player.learnAboutKingdom(tile.kingdom, ['peoples', 'religion']);
            }
        }
        if (!st.completed.includes(a.key)) st.completed.push(a.key);

        st.stats.delves++;
        if (reason === 'retreat') st.stats.retreats++;
        if (reason === 'collapse') st.stats.collapses++;
        if (reason === 'cleared') {
            st.stats.cleared++;
            Quests.track(player, `delve_cleared_${a.kind}`); // quest board / Every Dark Place
            const bonus = Math.round(_num(Delves.CONFIG.clearRenown) * Delves._rewardMult(a.plan.length - 1));
            player.renown = _num(player.renown) + bonus;
            a.haul.renown += bonus;
            summary.extra.push(`+${bonus} renown for reaching the bottom`);
            Traits.recordDeeds(player, { valor: 1, travel: 1 });
        } else {
            Traits.recordDeed(player, 'travel', 1);
            // Turning back at once from a delve is a coward's choice
            if (reason === 'retreat' && a.index <= 1 && a.plan.length > 3) Traits.recordDeed(player, 'cowardice', 0.5);
        }
        if (kind.lore && a.index >= 2) {
            const entry = Delves._discoverLore(player, world, kind.lore);
            if (entry) {
                a.haul.lore.push({ year: entry.year, text: entry.text });
                summary.extra.push(`Lore discovered (year ${entry.year})`);
            }
        }
        // A rival adventurer who delved at your side takes their share of the gold
        const partner = Delves._partner(player);
        if (partner && a.haul.gold > 0) {
            const cut = Math.min(_num(player.gold), Math.round(a.haul.gold * _num(partner.share)));
            if (cut > 0) {
                player.gold = _num(player.gold) - cut;
                partner.earned = _num(partner.earned) + cut;
                summary.extra.push(`${partner.name} takes a ${Math.round(_num(partner.share) * 100)}% share: ${cut} gold`);
            }
            partner.delves = _num(partner.delves) + 1;
            partner.lastSite = a.name;
        }
        if (_num(player.health) < 1) player.health = 1;
        st.active = null;
        return summary;
    },

    /** An active delving partner (a rival adventurer — systems/rivals.js), or null. */
    _partner(player) {
        const p = player && player.rivals && player.rivals.partner;
        return p && p.id ? p : null;
    },

    /** Check bonus from a delving partner at your side. */
    partnerBonus(player) {
        const p = Delves._partner(player);
        return p ? _num(p.bonus) : 0;
    },

    // ──────────── DAILY ────────────

    /**
     * Daily upkeep: an unfinished delve ends (you camp outside with your haul),
     * injuries mend, the cursed idol bites, awakened guardians roam (and are
     * re-raised after a load) until slain or their time passes.
     * Returns { healed:[names], curse:{health,karma}|null, slain:[names], ended }.
     */
    processDay(world, player) {
        const out = { healed: [], curse: null, slain: [], faded: [], ended: null };
        if (!player) return out;
        const st = Delves.getState(player);
        const day = _day(world);

        if (st.active) {
            const leftSite = player.q != null && (player.q !== st.active.q || player.r !== st.active.r);
            if (st.active.index === 0) st.active = null;
            else out.ended = Delves.finish(player, world, leftSite ? 'left' : 'retreat');
        }

        // Injuries mend
        st.injuries = st.injuries.filter(inj => {
            if (day < inj.untilDay) return true;
            player[inj.stat] = _num(player[inj.stat]) + _num(inj.amount);
            out.healed.push(inj.name);
            return false;
        });

        // The cursed idol
        if (Delves.isCursed(player)) {
            const cfg = Delves.CONFIG;
            const hp = Math.min(_num(cfg.curseHealthPerDay), Math.max(0, _num(player.health) - 1));
            player.health = _num(player.health) - hp;
            player.karma = _num(player.karma) - _num(cfg.curseKarmaPerDay);
            out.curse = { health: hp, karma: cfg.curseKarmaPerDay };
        }

        // Awakened guardians
        if (world && Array.isArray(world.units)) {
            for (const g of st.guardians) {
                if (g.slain || g.gone) continue;
                let unit = Delves._live.get(g.id);
                if (!unit) {
                    // After a load the guardian comes back with the saved world
                    // units: pick it up rather than raising a second one
                    unit = world.units.find(u => u && u.delveGuardianId === g.id) || null;
                    if (unit) Delves._live.set(g.id, unit);
                }
                if (unit && unit.destroyed) {
                    g.slain = true;
                    out.slain.push(g.name);
                    Delves._live.delete(g.id);
                    continue;
                }
                if (day >= g.untilDay) {
                    g.gone = true;
                    if (unit) unit.destroyed = true;
                    Delves._live.delete(g.id);
                    out.faded.push(g.name);
                    continue;
                }
                if (!unit || !world.units.includes(unit)) Delves._spawnGuardian(world, g);
            }
        }
        return out;
    },

    // ──────────── CONTENT INTEGRITY ────────────

    /** Problems in the delve content (empty when valid). Used by tests. */
    validate() {
        Delves._ensureLoaded();
        const errs = [];
        const goods = (DataLoader._gamedata && DataLoader._gamedata.playerEconomy && DataLoader._gamedata.playerEconomy.GOODS) || {};
        const isGood = id => !!goods[String(id).toUpperCase()];
        const checkOutcome = (where, o) => {
            if (!o) return;
            for (const k of Object.keys(o)) {
                if (!DELVE_OUTCOME_KEYS.includes(k)) errs.push(`${where}: unknown outcome key ${k}`);
            }
            for (const item of Object.keys(o.items || {})) if (!isGood(item)) errs.push(`${where}: unknown item ${item}`);
            for (const s of Object.keys(o.skills || {})) if (!DELVE_SKILLS.includes(s)) errs.push(`${where}: unknown skill ${s}`);
            for (const d of Object.keys(o.deeds || {})) if (!Traits.DEEDS[d]) errs.push(`${where}: unknown deed ${d}`);
            if (o.lore && !DELVE_LORE_KINDS.includes(o.lore)) errs.push(`${where}: unknown lore ${o.lore}`);
            if (o.chart && !DELVE_CHART_KINDS.includes(o.chart)) errs.push(`${where}: unknown chart ${o.chart}`);
            if (o.guardian && !Delves.GUARDIANS[o.guardian]) errs.push(`${where}: unknown guardian ${o.guardian}`);
        };
        for (const [id, ch] of Object.entries(Delves.CHAMBERS)) {
            const choices = ch.choices || [];
            if (!ch.name || !ch.text) errs.push(`${id}: missing name/text`);
            if (choices.length < 2 || choices.length > 3) errs.push(`${id}: needs 2–3 choices`);
            const seen = new Set();
            for (const c of choices) {
                const w = `${id}.${c.id}`;
                if (!c.id || seen.has(c.id)) errs.push(`${w}: missing or duplicate id`);
                seen.add(c.id);
                if (!c.label) errs.push(`${w}: missing label`);
                for (const k of Object.keys(c)) if (!DELVE_CHOICE_KEYS.includes(k)) errs.push(`${w}: unknown choice key ${k}`);
                for (const k of Object.keys(c.cost || {})) if (!DELVE_COST_KEYS.includes(k)) errs.push(`${w}: unknown cost key ${k}`);
                for (const item of Object.keys((c.cost && c.cost.items) || {})) if (!isGood(item)) errs.push(`${w}: unknown cost item ${item}`);
                for (const d of Object.keys(c.deeds || {})) if (!Traits.DEEDS[d]) errs.push(`${w}: unknown deed ${d}`);
                if (c.check) {
                    for (const k of Object.keys(c.check)) if (!DELVE_CHECK_KEYS.includes(k)) errs.push(`${w}: unknown check key ${k}`);
                    if (c.check.stat && !DELVE_STATS.includes(c.check.stat)) errs.push(`${w}: unknown stat ${c.check.stat}`);
                    if (c.check.skill && !DELVE_SKILLS.includes(c.check.skill)) errs.push(`${w}: unknown skill ${c.check.skill}`);
                    for (const item of Object.keys(c.check.items || {})) if (!isGood(item)) errs.push(`${w}: unknown check item ${item}`);
                    for (const t of Object.keys(c.check.traits || {})) if (!Traits.TRAITS[t]) errs.push(`${w}: unknown trait ${t}`);
                    for (const e of Object.keys(c.check.effects || {})) if (!DELVE_EFFECT_KEYS.includes(e)) errs.push(`${w}: unknown effect ${e}`);
                    if (!c.failure) errs.push(`${w}: a check needs a failure outcome`);
                }
                if (!c.success) errs.push(`${w}: missing success outcome`);
                checkOutcome(`${w}.success`, c.success);
                checkOutcome(`${w}.failure`, c.failure);
            }
        }
        for (const [id, k] of Object.entries(Delves.KINDS)) {
            for (const c of k.chambers || []) if (!Delves.CHAMBERS[c]) errs.push(`kind ${id}: unknown chamber ${c}`);
            for (const c of k.finales || []) if (!Delves.CHAMBERS[c]) errs.push(`kind ${id}: unknown finale ${c}`);
            if ((k.chambers || []).length < Delves.CONFIG.maxChambers - 1) errs.push(`kind ${id}: too few chambers for a full delve`);
            if ((k.finales || []).length < 2 || (k.finales || []).length > 3) errs.push(`kind ${id}: needs 2–3 finales`);
            if (k.lore && !DELVE_LORE_KINDS.includes(k.lore)) errs.push(`kind ${id}: unknown lore ${k.lore}`);
        }
        for (const [id, inj] of Object.entries(Delves.INJURIES)) {
            if (!DELVE_STATS.includes(inj.stat)) errs.push(`injury ${id}: unknown stat ${inj.stat}`);
        }
        if (!isGood(Delves.CONFIG.curseItem)) errs.push(`config: curse item ${Delves.CONFIG.curseItem} is not a good`);
        return errs;
    },
};
