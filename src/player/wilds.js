// ============================================
// WILDS — encounters out in the wilderness, and at the minor points of interest
// ============================================
// A wilderness inner map (no settlement) holds a few encounters — a herb
// patch, a wounded traveller, a wolf pack, a hermit's hut, a shrine in the
// trees — placed by world/innerMap/encounters.js from a hash of the world
// seed and the hex, so a revisited hex holds the same ones. The minor points
// of interest on the world map (shrines, oases, monuments, wrecks) are
// explored through the same engine: each one is an encounter picked from
// its type's set by a hash of the world seed and the hex.
//
// Each encounter (data/innerMap.json → encounters; POI sets under
// poiEncounters) poses a situation with 2–3 choices, using the delve schema
// (systems/delves.js) for odds and harm:
//   cost      stamina (today's movement), health, gold, carried items
//   requires  hard gates: items carried (kept), any companion role, any
//             trait, a skill or attribute minimum, gold in the purse
//   check     base odds + attribute/skill/craft rank, carried items,
//             companions in the party, earned traits, treasure effects
//   success / failure outcomes, drawn from the existing systems:
//     gold (Ledger 'exploration'), items (PlayerInventory.addItem — the slot
//     cap holds), forage / hunt (player/foraging.js loot tables for the
//     terrain; the trip counts toward the craft rank), health, stamina,
//     ailment / wound (systems/ailments.js), skills, deeds and traits
//     (systems/traits.js — companions react to deeds), renown, karma, lore
//     (Peoples), charts (Cartography maps), reveal (world tiles charted
//     round the hex), prices (PriceKnowledge: the nearest markets), rumour
//     (a Gossip deed the towns talk of), lead (Discovery: an uncharted
//     place nearby), fragment (a legendary artifact fragment).
//
// A choice resolves the encounter for good: player.wilds.resolved remembers
// the slot per hex (saved with the player). Walking away leaves it for later.
// All randomness flows through Utils; no import-time side effects; world and
// player are passed in.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { PlayerInventory } from './inventory.js';
import { Foraging, Hunting } from './foraging.js';
import { PlayerEffects } from './playerEffects.js';
import { Traits } from '../systems/traits.js';
import { Ailments } from '../systems/ailments.js';
import { Ledger } from '../systems/ledger.js';
import { Peoples } from '../systems/peoples.js';
import { Cartography } from '../systems/cartography.js';
import { PriceKnowledge } from '../systems/priceKnowledge.js';
import { Gossip } from '../systems/gossip.js';
import { Discovery } from '../systems/discovery.js';
import { LegendaryArtifacts } from '../systems/legendaryArtifacts.js';
import { Relationships } from '../systems/relationships.js';
import { Quests } from '../systems/quests.js';

const DEFAULT_CONFIG = {
    tileChance: 0.7,
    maxPerMap: 3,
    margin: 8,
    minFromCentre: 6,
    minApart: 14,
    statWeight: 0.05,
    skillWeight: 0.04,
    craftWeight: 0.04,
    minChance: 0.05,
    maxChance: 0.95,
    leadRadius: 18,
    priceTowns: 2,
    journal: 20,
};

export const WILDS_STATS = ['strength', 'charisma', 'intelligence', 'faith', 'luck'];
export const WILDS_SKILLS = ['combat', 'stealth', 'diplomacy', 'leadership', 'commerce', 'cartography'];
export const WILDS_CRAFTS = ['forage', 'hunt'];
export const WILDS_EFFECT_KEYS = ['battlePower', 'damageReduction', 'negotiation'];
export const WILDS_ROLES = ['artisan', 'diplomat', 'general', 'guard', 'healer', 'herbalist', 'hunter', 'knight', 'merchant', 'noble', 'priest', 'scholar', 'spymaster'];
export const WILDS_CHOICE_KEYS = ['id', 'label', 'hint', 'cost', 'requires', 'check', 'success', 'failure', 'deeds'];
export const WILDS_COST_KEYS = ['stamina', 'health', 'gold', 'items'];
export const WILDS_REQUIRE_KEYS = ['items', 'companions', 'traits', 'skills', 'stats', 'gold'];
export const WILDS_CHECK_KEYS = ['base', 'stat', 'skill', 'craft', 'items', 'companions', 'traits', 'effects'];
export const WILDS_OUTCOME_KEYS = [
    'text', 'gold', 'items', 'forage', 'hunt', 'renown', 'karma', 'health', 'stamina',
    'ailment', 'ailmentChance', 'wound', 'skills', 'deeds', 'traits', 'lore', 'chart',
    'reveal', 'prices', 'rumour', 'lead', 'fragment',
];
export const WILDS_LORE_KINDS = ['ancient', 'origin', 'founding', 'any'];
export const WILDS_CHART_KINDS = ['ancient', 'treasure'];
export const WILDS_WOUND_SOURCES = ['beast', 'ambush', 'brawl', 'hunt', 'monster'];

const _num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
const _roll = (v) => (Array.isArray(v) ? Utils.randInt(v[0], v[1]) : _num(v));
const _day = (world) => (world && world.day) || 0;
const _key = (q, r) => `${q},${r}`;
const _name = (id) => String(id).replace(/_/g, ' ');

/** A well-mixed 32-bit hash of the parts (Utils.hashStr + a murmur finaliser). */
function _hash(...parts) {
    let h = Utils.hashStr(parts.join('|'));
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
}

export const Wilds = {
    CONFIG: { ...DEFAULT_CONFIG },
    ENCOUNTERS: {},
    BIOMES: {},
    POI_SETS: {},
    _loaded: false,

    /** Install content from data/innerMap.json (encounters, biome lists, poiEncounters, wilds config). */
    load(data) {
        if (!data) return;
        Wilds.CONFIG = { ...DEFAULT_CONFIG, ...(data.wilds || {}) };
        Wilds.ENCOUNTERS = data.encounters || {};
        Wilds.POI_SETS = data.poiEncounters || {};
        Wilds.BIOMES = {};
        for (const [id, st] of Object.entries(data.subTerrains || {})) {
            if (st && Array.isArray(st.encounters)) Wilds.BIOMES[id] = st.encounters.slice();
        }
        Wilds._loaded = true;
    },

    _ensureLoaded() {
        if (Wilds._loaded && Object.keys(Wilds.ENCOUNTERS).length) return;
        const g = DataLoader._gamedata;
        const data = (g && (g.innerMap || g['innerMap.json'])) || null;
        if (data) Wilds.load(data);
    },

    def(id) {
        Wilds._ensureLoaded();
        return (id && Wilds.ENCOUNTERS[id]) || null;
    },

    // ──────────── STATE ────────────

    _blank() {
        return { resolved: {}, stats: { met: 0, resolved: 0, passed: 0, failed: 0, poi: 0 }, journal: [] };
    },

    getState(player) {
        if (!player) return null;
        let st = player.wilds;
        if (!st || typeof st !== 'object' || Array.isArray(st)) {
            player.wilds = Wilds._blank();
            return player.wilds;
        }
        const blank = Wilds._blank();
        if (!st.resolved || typeof st.resolved !== 'object') st.resolved = {};
        if (!st.stats || typeof st.stats !== 'object') st.stats = blank.stats;
        for (const [k, v] of Object.entries(blank.stats)) if (typeof st.stats[k] !== 'number') st.stats[k] = v;
        if (!Array.isArray(st.journal)) st.journal = [];
        return st;
    },

    serialize(player) {
        return player && player.wilds ? JSON.parse(JSON.stringify(player.wilds)) : null;
    },

    loadState(player) {
        if (player && player.wilds) Wilds.getState(player);
    },

    /** Has this hex's encounter slot been dealt with? */
    isResolved(player, wq, wr, slot) {
        const st = player && player.wilds;
        const list = st && st.resolved && st.resolved[_key(wq, wr)];
        return Array.isArray(list) && list.includes(slot);
    },

    /** Note that an encounter was come upon (first sight). */
    noteMet(player) {
        Wilds.getState(player).stats.met++;
    },

    // ──────────── POINTS OF INTEREST ────────────

    /** The world's seed string for the hashes. */
    seed(world) {
        return String((world && world.generationParams && world.generationParams.seed) || 'world');
    },

    /** The encounter a minor point of interest holds (by its type), or null. */
    poiEncounterId(world, tile) {
        Wilds._ensureLoaded();
        const poi = tile && tile.improvement;
        if (!poi || !poi.type) return null;
        const set = (Wilds.POI_SETS[poi.type] || []).filter(id => Wilds.ENCOUNTERS[id]);
        if (!set.length) return null;
        return set[_hash(Wilds.seed(world), 'poi', tile.q, tile.r, poi.type) % set.length];
    },

    // ──────────── CHECKS ────────────

    _occupations(player) {
        if (!player || !Array.isArray(player.travelParty) || !player.travelParty.length) return [];
        try {
            return Relationships.getTravelPartyMembers(player).map(n => n && n.occupation).filter(Boolean);
        } catch (e) {
            return [];
        }
    },

    _carries(player, item, qty = 1) {
        return !!(player && player.inventory && player.inventory[item] >= qty);
    },

    _craftLevel(player, craft) {
        if (craft === 'forage') return Foraging.skill(player).level;
        if (craft === 'hunt') return Hunting.skill(player).level;
        return 0;
    },

    /** Success chance of a choice (0..1), or null when it is not a test. */
    chance(player, choice) {
        const check = choice && choice.check;
        if (!check) return null;
        const cfg = Wilds.CONFIG;
        let p = typeof check.base === 'number' ? check.base : 0.5;
        if (check.stat) p += (_num(player[check.stat]) - 5) * cfg.statWeight;
        if (check.skill) p += _num(player.skills && player.skills[check.skill]) * cfg.skillWeight;
        if (check.craft) p += Wilds._craftLevel(player, check.craft) * cfg.craftWeight;
        for (const [item, bonus] of Object.entries(check.items || {})) {
            if (Wilds._carries(player, item)) p += _num(bonus);
        }
        if (check.companions) {
            const occ = Wilds._occupations(player);
            for (const [role, bonus] of Object.entries(check.companions)) if (occ.includes(role)) p += _num(bonus);
        }
        for (const [trait, bonus] of Object.entries(check.traits || {})) {
            if (Traits.has(player, trait)) p += _num(bonus);
        }
        for (const [key, weight] of Object.entries(check.effects || {})) {
            p += (_num(PlayerEffects.treasureBonus(player, key)) + _num(Traits.effect(player, key))) * _num(weight);
        }
        return Math.max(cfg.minChance, Math.min(cfg.maxChance, p));
    },

    /** Can the player take this choice? { ok, reason } (stamina and health never block). */
    canChoose(player, choice) {
        const cost = (choice && choice.cost) || {};
        const req = (choice && choice.requires) || {};
        if (cost.gold > 0 && _num(player.gold) < cost.gold) return { ok: false, reason: `Needs ${cost.gold} gold` };
        for (const [item, qty] of Object.entries(cost.items || {})) {
            if (!Wilds._carries(player, item, qty)) return { ok: false, reason: `Needs ${qty} ${_name(item)}` };
        }
        if (req.gold > 0 && _num(player.gold) < req.gold) return { ok: false, reason: `Needs ${req.gold} gold in your purse` };
        for (const [item, qty] of Object.entries(req.items || {})) {
            if (!Wilds._carries(player, item, qty)) return { ok: false, reason: `Needs ${qty > 1 ? qty + ' ' : ''}${_name(item)} in your packs` };
        }
        if (Array.isArray(req.companions) && req.companions.length) {
            const occ = Wilds._occupations(player);
            if (!req.companions.some(r => occ.includes(r))) return { ok: false, reason: `Needs a ${req.companions.join(' or ')} in your party` };
        }
        if (Array.isArray(req.traits) && req.traits.length) {
            if (!req.traits.some(t => Traits.has(player, t))) {
                const names = req.traits.map(t => (Traits.TRAITS[t] && Traits.TRAITS[t].name) || t);
                return { ok: false, reason: `Only the ${names.join(' or ')} would` };
            }
        }
        for (const [s, min] of Object.entries(req.skills || {})) {
            if (_num(player.skills && player.skills[s]) < min) return { ok: false, reason: `Needs ${s} ${min}` };
        }
        for (const [s, min] of Object.entries(req.stats || {})) {
            if (_num(player[s]) < min) return { ok: false, reason: `Needs ${s} ${min}` };
        }
        return { ok: true };
    },

    oddsLabel(chance) {
        if (chance === null || chance === undefined) return 'certain';
        if (chance >= 0.8) return 'very likely';
        if (chance >= 0.6) return 'likely';
        if (chance >= 0.4) return 'even odds';
        if (chance >= 0.2) return 'risky';
        return 'desperate';
    },

    /** What a choice leans on, for the UI ("strength · rope helps · a hunter helps"). */
    _checkText(check) {
        if (!check) return '';
        const parts = [];
        if (check.stat) parts.push(check.stat);
        if (check.skill) parts.push(`${check.skill} skill`);
        if (check.craft) parts.push(check.craft === 'forage' ? 'foraging craft' : 'hunting craft');
        for (const item of Object.keys(check.items || {})) parts.push(`${_name(item)} helps`);
        for (const role of Object.keys(check.companions || {})) parts.push(`a ${role} helps`);
        for (const t of Object.keys(check.traits || {})) parts.push(`${(Traits.TRAITS[t] && Traits.TRAITS[t].name) || t}`);
        return parts.join(' · ');
    },

    /** The encounter as the UI shows it: { id, name, icon, text, choices: [...] }. */
    describe(player, id) {
        const enc = Wilds.def(id);
        if (!enc) return null;
        const choices = (enc.choices || []).map(c => {
            const chance = Wilds.chance(player, c);
            const cost = c.cost || {};
            const parts = [];
            if (cost.stamina) parts.push(`${cost.stamina} stamina`);
            if (cost.health) parts.push(`${cost.health} health`);
            if (cost.gold) parts.push(`${cost.gold} gold`);
            for (const [item, qty] of Object.entries(cost.items || {})) parts.push(`${qty} ${_name(item)}`);
            return {
                id: c.id, label: c.label, hint: c.hint || '',
                chance, odds: Wilds.oddsLabel(chance),
                can: Wilds.canChoose(player, c),
                costText: parts.join(', '),
                checkText: Wilds._checkText(c.check),
            };
        });
        return { id, name: enc.name, icon: enc.icon, text: enc.text || enc.description || '', choices };
    },

    // ──────────── RESOLVING ────────────

    /**
     * Take a choice. ctx: { id, wq, wr, slot?, terrain?, poi? }.
     * Pays the cost, rolls the check, applies the outcome, marks the encounter
     * resolved. Returns { success, passed, chance, text, lines, encounter, choice }.
     */
    resolve(player, world, ctx, choiceId) {
        if (!player || !ctx) return { success: false, reason: 'Nothing to resolve.' };
        const enc = Wilds.def(ctx.id);
        if (!enc) return { success: false, reason: 'There is nothing here.' };
        if (ctx.slot != null && Wilds.isResolved(player, ctx.wq, ctx.wr, ctx.slot)) {
            return { success: false, reason: 'You have already dealt with this.' };
        }
        const choice = (enc.choices || []).find(c => c.id === choiceId);
        if (!choice) return { success: false, reason: 'No such choice.' };
        const can = Wilds.canChoose(player, choice);
        if (!can.ok) return { success: false, reason: can.reason };
        if (!player.inventory) player.inventory = {};

        const lines = [];
        const cost = choice.cost || {};
        if (cost.stamina > 0) {
            const have = Math.max(0, _num(player.movementRemaining));
            const paid = Math.min(have, cost.stamina);
            player.movementRemaining = have - paid;
            const short = cost.stamina - paid;
            if (short > 0) {
                const hurt = short * 3;
                player.health = Math.max(1, _num(player.health) - hurt);
                lines.push(`Too tired for it, you push on anyway (-${hurt} health)`);
            }
        }
        if (cost.health > 0) player.health = Math.max(1, _num(player.health) - cost.health);
        if (cost.gold > 0) {
            player.gold = _num(player.gold) - cost.gold;
            Ledger.record(player, 'exploration', -cost.gold);
            lines.push(`-${cost.gold} gold`);
        }
        for (const [item, qty] of Object.entries(cost.items || {})) {
            player.inventory[item] -= qty;
            if (player.inventory[item] <= 0) delete player.inventory[item];
            lines.push(`-${qty} ${_name(item)}`);
        }
        if (choice.deeds) Traits.recordDeeds(player, choice.deeds);

        const chance = Wilds.chance(player, choice);
        const passed = chance === null ? true : Utils.random() < chance;
        const outcome = (passed ? choice.success : choice.failure) || {};
        lines.push(...Wilds._applyOutcome(player, world, ctx, enc, outcome));

        const st = Wilds.getState(player);
        if (ctx.slot != null) {
            const k = _key(ctx.wq, ctx.wr);
            if (!Array.isArray(st.resolved[k])) st.resolved[k] = [];
            if (!st.resolved[k].includes(ctx.slot)) st.resolved[k].push(ctx.slot);
        }
        st.stats.resolved++;
        if (chance !== null) st.stats[passed ? 'passed' : 'failed']++;
        if (ctx.poi) st.stats.poi++;
        st.journal.push({ day: _day(world), icon: enc.icon, name: enc.name, choice: choice.label, passed, text: outcome.text || '' });
        if (st.journal.length > Wilds.CONFIG.journal) st.journal.splice(0, st.journal.length - Wilds.CONFIG.journal);
        Traits.recordDeed(player, 'travel', 0.25);
        Quests.track(player, 'wilds_encounters');

        if (_num(player.health) < 1) player.health = 1;
        return { success: true, passed, chance, text: outcome.text || '', lines, encounter: enc, choice };
    },

    _applyOutcome(player, world, ctx, enc, o) {
        const lines = [];
        if (o.gold) {
            const g = Math.round(_roll(o.gold));
            if (g > 0) {
                player.gold = _num(player.gold) + g;
                Ledger.record(player, 'exploration', g);
                lines.push(`+${g} gold`);
            } else if (g < 0) {
                const lost = Math.min(_num(player.gold), -g);
                player.gold = _num(player.gold) - lost;
                if (lost) {
                    Ledger.record(player, 'exploration', -lost);
                    lines.push(`-${lost} gold`);
                }
            }
        }
        for (const [item, range] of Object.entries(o.items || {})) {
            const qty = Math.max(1, Math.round(_roll(range)));
            const r = PlayerInventory.addItem(player, item, qty);
            lines.push(r.success ? `+${qty} ${_name(item)}` : `${qty} ${_name(item)} left behind — your packs are full`);
        }
        if (o.forage) lines.push(...Wilds._forage(player, ctx, _roll(o.forage)));
        if (o.hunt) lines.push(...Wilds._hunt(player, ctx));
        if (o.renown) {
            const n = _roll(o.renown);
            player.renown = _num(player.renown) + n;
            lines.push(`${n >= 0 ? '+' : ''}${n} renown`);
        }
        if (o.karma) {
            const n = _roll(o.karma);
            player.karma = _num(player.karma) + n;
            lines.push(`${n >= 0 ? '+' : ''}${n} karma`);
        }
        if (o.health) {
            const raw = _roll(o.health);
            if (raw < 0) {
                const harm = PlayerEffects.scaleDamage(player, -raw);
                player.health = Math.max(1, _num(player.health) - harm);
                lines.push(harm > 0 ? `-${harm} health` : 'Divine protection turns the harm aside');
            } else if (raw > 0) {
                const before = _num(player.health);
                player.health = Math.min(player.maxHealth || 100, before + raw);
                if (player.health > before) lines.push(`+${player.health - before} health`);
            }
        }
        if (o.stamina) {
            const n = _roll(o.stamina);
            const before = Math.max(0, _num(player.movementRemaining));
            const cap = Math.max(_num(player.stamina) || 10, before);
            player.movementRemaining = n > 0 ? Math.min(cap, before + n) : Math.max(0, before + n);
            const d = player.movementRemaining - before;
            if (d) lines.push(`${d > 0 ? '+' : ''}${d} stamina`);
        }
        if (o.ailment && (o.ailmentChance == null || Utils.random() < _num(o.ailmentChance))) {
            const rep = Ailments.inflict(player, world, o.ailment, { source: 'wilds' });
            if (rep) lines.push(`${rep.icon || '🩹'} ${rep.name}${rep.days ? ` (${rep.days} days)` : ''}`);
        }
        if (o.wound) {
            const rep = Ailments.maybeWound(player, world, o.wound);
            if (rep) lines.push(`${rep.icon || '🩹'} Wounded: ${rep.name}`);
        }
        for (const [skill, amt] of Object.entries(o.skills || {})) {
            if (!player.skills) player.skills = {};
            const before = _num(player.skills[skill]);
            player.skills[skill] = Math.min(10, before + _num(amt));
            if (player.skills[skill] > before) lines.push(`${skill} skill improves`);
        }
        if (o.deeds) Traits.recordDeeds(player, o.deeds);
        if (Array.isArray(o.traits) && o.traits.length) {
            for (const id of Traits.grantTraits(player, o.traits)) {
                lines.push(`Earned the trait ${(Traits.TRAITS[id] && Traits.TRAITS[id].name) || id}`);
            }
        }
        if (o.lore) {
            const entry = Wilds._lore(player, world, o.lore);
            if (entry) lines.push(`📜 Lore (year ${entry.year}): ${entry.text}`);
        }
        if (o.chart) {
            const map = Wilds._chart(player, world, ctx, o.chart);
            if (map) lines.push(`🗺️ Found: ${map.name}`);
        }
        if (o.reveal) {
            const n = Wilds._reveal(world, ctx, _roll(o.reveal));
            if (n) lines.push(`🧭 ${n} hexes of country charted`);
        }
        if (o.prices) {
            for (const name of Wilds._prices(player, world, ctx, _roll(o.prices) || Wilds.CONFIG.priceTowns)) {
                lines.push(`⚖️ You learn the prices at ${name}`);
            }
        }
        if (o.rumour) {
            const type = typeof o.rumour === 'string' ? o.rumour : o.rumour.type;
            const victim = (o.rumour && o.rumour.victim) || `the ${enc.name.toLowerCase()}`;
            const rm = Gossip.spreadDeed(player, world, type, { q: ctx.wq, r: ctx.wr, victim });
            if (rm) lines.push(`🗣️ Word of it will reach ${rm.locationName}`);
        }
        if (o.lead) {
            const lead = Discovery.leadNear(player, world, ctx.wq, ctx.wr, { radius: Wilds.CONFIG.leadRadius, source: enc.name });
            if (lead) lines.push(`🧭 ${lead.text}`);
        }
        if (o.fragment && Utils.random() < _num(o.fragment)) {
            const found = LegendaryArtifacts.grantFragment(player, (ctx.poi && ctx.poi.type) || 'ruins');
            if (found && found.found) lines.push(`🧩 ${found.artifact.name} fragment (${found.fragmentsOwned}/${found.fragmentsRequired})`);
        }
        return lines;
    },

    _forageData() {
        return (DataLoader.earlyJobs && DataLoader.earlyJobs.foraging)
            || (DataLoader._gamedata && DataLoader._gamedata.earlyJobs && DataLoader._gamedata.earlyJobs.foraging) || null;
    },

    _huntData() {
        return (DataLoader.earlyJobs && DataLoader.earlyJobs.hunting)
            || (DataLoader._gamedata && DataLoader._gamedata.earlyJobs && DataLoader._gamedata.earlyJobs.hunting) || null;
    },

    _bankLines(trip) {
        const lines = [];
        for (const k of trip.kept || []) lines.push(`+${k.qty} ${(k.entry && k.entry.name) || _name(k.entry && k.entry.item)}`);
        for (const l of trip.lost || []) lines.push(`${l.qty} ${(l.entry && l.entry.name) || _name(l.entry && l.entry.item)} left behind — your packs are full`);
        if (trip.rankUp) lines.push(`${trip.rankUp.icon || ''} ${trip.rankUp.name}`.trim());
        return lines;
    },

    /** n finds from the terrain's forage table (counts as a foraging trip). */
    _forage(player, ctx, n) {
        const table = Foraging.lootTableFor({ terrain: { id: ctx.terrain } }, Wilds._forageData());
        if (!table || n <= 0) return [];
        const found = [];
        for (let i = 0; i < n; i++) {
            let entry = null;
            for (let a = 0; a < 5 && !entry; a++) entry = Foraging.rollFind(table, player);
            if (!entry) entry = table[0];
            found.push({ entry, qty: Foraging.rollQty(entry, player) });
        }
        return Wilds._bankLines(Foraging.finishTrip(player, found));
    },

    /** A clean kill from the terrain's hunt table (counts as a hunting trip). */
    _hunt(player, ctx) {
        const fd = Wilds._forageData();
        const hd = Wilds._huntData();
        const cat = fd && fd.terrain_mapping ? fd.terrain_mapping[ctx.terrain] : null;
        const table = hd && hd.loot_table ? (hd.loot_table[cat] || hd.loot_table.forest) : null;
        if (!table || !table.length) return [];
        return Wilds._bankLines(Hunting.finishTrip(player, Hunting.strikeLoot(table, player)));
    },

    _lore(player, world, kind) {
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

    _chart(player, world, ctx, kind) {
        if (!world || !world.getTile) return null;
        let map = null;
        try {
            map = kind === 'treasure' ? Cartography.generateTreasureMap(world) : Cartography.generateAncientMap(world, ctx.wq, ctx.wr);
        } catch (e) {
            map = null;
        }
        if (!map) return null;
        if (!Array.isArray(player.maps)) player.maps = [];
        player.maps.push(map);
        return map;
    },

    /** Mark the world hexes within radius explored. Returns how many were new. */
    _reveal(world, ctx, radius) {
        if (!world || !world.getTile || !(radius > 0)) return 0;
        const W = world.width || 0;
        let n = 0;
        for (const h of Hex.hexesInRange(ctx.wq, ctx.wr, radius)) {
            const t = world.getTile(W ? Hex.wrapQ(h.q, W) : h.q, h.r);
            if (t && !t.explored) {
                t.explored = true;
                n++;
            }
        }
        return n;
    },

    _settlements(world) {
        if (!world) return [];
        try {
            if (typeof world.getSettlementViews === 'function') return world.getSettlementViews() || [];
            if (typeof world.getAllSettlements === 'function') return world.getAllSettlements() || [];
        } catch (e) {
            return [];
        }
        return [];
    },

    /** Learn the markets of the nearest n towns (a traveller's or a trader's word). Returns their names. */
    _prices(player, world, ctx, n) {
        const W = (world && world.width) || 0;
        const dist = (s) => (W ? Hex.wrappingDistance(ctx.wq, ctx.wr, s.q, s.r, W) : Hex.distance(ctx.wq, ctx.wr, s.q, s.r));
        const towns = Wilds._settlements(world).filter(s => s && Number.isFinite(s.q)).sort((a, b) => dist(a) - dist(b));
        const names = [];
        for (const s of towns) {
            if (names.length >= n) break;
            const tile = world.getTile(s.q, s.r);
            const town = (tile && tile.settlement) || s;
            SettlementMarket.ensure(town);
            if (PriceKnowledge.observe(player, world, town, 'c') > 0) names.push(town.name || s.name || 'a nearby town');
        }
        return names;
    },

    // ──────────── POI FINISH ────────────

    /**
     * After a minor POI's encounter: mark it explored, pick up maps hidden
     * there, maybe a legendary relic, and what it says of the realm's
     * peoples and faith. Returns { lines, artifact }.
     */
    finishPoi(player, world, tile) {
        const out = { lines: [], artifact: null };
        const poi = tile && tile.improvement;
        if (!poi) return out;
        poi.explored = true;
        if (Array.isArray(poi.loot) && poi.loot.length) {
            if (!Array.isArray(player.maps)) player.maps = [];
            for (const m of poi.loot) {
                if (m && m.type && m.tiles) {
                    player.maps.push(m);
                    out.lines.push(`🗺️ Found: ${m.name}`);
                }
            }
            poi.loot = [];
        }
        const found = LegendaryArtifacts.discoverFromPOI(player, world, tile, poi);
        if (found && found.found) {
            out.artifact = found;
            out.lines.push(found.type === 'artifact'
                ? `${found.artifact.icon || '🏺'} ${found.artifact.name} recovered intact!`
                : `🧩 ${found.artifact.name} fragment (${found.fragmentsOwned}/${found.fragmentsRequired})`);
        }
        const kingdom = tile.kingdom || (tile.settlement && tile.settlement.kingdom) || null;
        if (kingdom && typeof player.learnAboutKingdom === 'function') {
            player.learnAboutKingdom(kingdom, poi.type === 'shrine' ? ['religion'] : ['peoples', 'religion']);
        }
        return out;
    },

    // ──────────── CONTENT INTEGRITY ────────────

    /** Problems in the encounter content (empty when valid). Used by tests. */
    validate() {
        Wilds._ensureLoaded();
        const errs = [];
        const goods = (DataLoader._gamedata && DataLoader._gamedata.playerEconomy && DataLoader._gamedata.playerEconomy.GOODS) || {};
        const isGood = id => !!goods[String(id).toUpperCase()];
        const gossipTypes = (DataLoader._gamedata && DataLoader._gamedata.gossip && DataLoader._gamedata.gossip.rumorTypes) || {};
        const checkOutcome = (where, o) => {
            if (!o) return;
            for (const k of Object.keys(o)) if (!WILDS_OUTCOME_KEYS.includes(k)) errs.push(`${where}: unknown outcome key ${k}`);
            if (!o.text) errs.push(`${where}: missing text`);
            for (const item of Object.keys(o.items || {})) if (!isGood(item)) errs.push(`${where}: unknown item ${item}`);
            for (const s of Object.keys(o.skills || {})) if (!WILDS_SKILLS.includes(s)) errs.push(`${where}: unknown skill ${s}`);
            for (const d of Object.keys(o.deeds || {})) if (!Traits.DEEDS[d]) errs.push(`${where}: unknown deed ${d}`);
            for (const t of o.traits || []) if (!Traits.TRAITS[t]) errs.push(`${where}: unknown trait ${t}`);
            if (o.lore && !WILDS_LORE_KINDS.includes(o.lore)) errs.push(`${where}: unknown lore ${o.lore}`);
            if (o.chart && !WILDS_CHART_KINDS.includes(o.chart)) errs.push(`${where}: unknown chart ${o.chart}`);
            if (o.ailment && !Ailments.def(o.ailment)) errs.push(`${where}: unknown ailment ${o.ailment}`);
            if (o.wound && !WILDS_WOUND_SOURCES.includes(o.wound)) errs.push(`${where}: unknown wound source ${o.wound}`);
            if (o.rumour) {
                const type = typeof o.rumour === 'string' ? o.rumour : o.rumour.type;
                const def = gossipTypes[type];
                if (!def || !(def.deed || def.talk)) errs.push(`${where}: rumour ${type} is not a deed rumour`);
            }
        };
        const checkMap = (where, map, valid, label) => {
            for (const k of Object.keys(map || {})) if (!valid(k)) errs.push(`${where}: unknown ${label} ${k}`);
        };
        for (const [id, enc] of Object.entries(Wilds.ENCOUNTERS)) {
            const choices = enc.choices || [];
            if (!enc.name || !enc.icon || !enc.description) errs.push(`${id}: missing name/icon/description`);
            if (!enc.text) errs.push(`${id}: missing text`);
            if (choices.length < 2 || choices.length > 3) errs.push(`${id}: needs 2–3 choices`);
            const seen = new Set();
            for (const c of choices) {
                const w = `${id}.${c.id}`;
                if (!c.id || seen.has(c.id)) errs.push(`${w}: missing or duplicate id`);
                seen.add(c.id);
                if (!c.label) errs.push(`${w}: missing label`);
                for (const k of Object.keys(c)) if (!WILDS_CHOICE_KEYS.includes(k)) errs.push(`${w}: unknown choice key ${k}`);
                for (const k of Object.keys(c.cost || {})) if (!WILDS_COST_KEYS.includes(k)) errs.push(`${w}: unknown cost key ${k}`);
                checkMap(w, c.cost && c.cost.items, isGood, 'cost item');
                for (const d of Object.keys(c.deeds || {})) if (!Traits.DEEDS[d]) errs.push(`${w}: unknown deed ${d}`);
                const req = c.requires;
                if (req) {
                    for (const k of Object.keys(req)) if (!WILDS_REQUIRE_KEYS.includes(k)) errs.push(`${w}: unknown requires key ${k}`);
                    checkMap(w, req.items, isGood, 'required item');
                    for (const r of req.companions || []) if (!WILDS_ROLES.includes(r)) errs.push(`${w}: unknown role ${r}`);
                    for (const t of req.traits || []) if (!Traits.TRAITS[t]) errs.push(`${w}: unknown trait ${t}`);
                    checkMap(w, req.skills, s => WILDS_SKILLS.includes(s), 'skill');
                    checkMap(w, req.stats, s => WILDS_STATS.includes(s), 'stat');
                }
                if (c.check) {
                    const ch = c.check;
                    for (const k of Object.keys(ch)) if (!WILDS_CHECK_KEYS.includes(k)) errs.push(`${w}: unknown check key ${k}`);
                    if (ch.stat && !WILDS_STATS.includes(ch.stat)) errs.push(`${w}: unknown stat ${ch.stat}`);
                    if (ch.skill && !WILDS_SKILLS.includes(ch.skill)) errs.push(`${w}: unknown skill ${ch.skill}`);
                    if (ch.craft && !WILDS_CRAFTS.includes(ch.craft)) errs.push(`${w}: unknown craft ${ch.craft}`);
                    checkMap(w, ch.items, isGood, 'check item');
                    checkMap(w, ch.companions, r => WILDS_ROLES.includes(r), 'role');
                    checkMap(w, ch.traits, t => !!Traits.TRAITS[t], 'trait');
                    checkMap(w, ch.effects, e => WILDS_EFFECT_KEYS.includes(e), 'effect');
                    if (!c.failure) errs.push(`${w}: a check needs a failure outcome`);
                }
                if (!c.success) errs.push(`${w}: missing success outcome`);
                checkOutcome(`${w}.success`, c.success);
                checkOutcome(`${w}.failure`, c.failure);
            }
        }
        for (const [biome, list] of Object.entries(Wilds.BIOMES)) {
            for (const id of list) if (!Wilds.ENCOUNTERS[id]) errs.push(`biome ${biome}: unknown encounter ${id}`);
        }
        for (const [type, list] of Object.entries(Wilds.POI_SETS)) {
            if (!Array.isArray(list) || !list.length) errs.push(`poi ${type}: empty set`);
            for (const id of list || []) if (!Wilds.ENCOUNTERS[id]) errs.push(`poi ${type}: unknown encounter ${id}`);
        }
        return errs;
    },
};
