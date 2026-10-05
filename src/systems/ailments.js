// ============================================
// AILMENTS — wounds, sickness and medicine
// ============================================
// Health used to be one HP number. The player now also carries personal
// conditions (player.ailments.list):
//
//   • WOUNDS from ambushes, beasts, battles, sea fights, duels, hunts and
//     delves (gash, broken arm, cracked ribs, head wound, arrow in the leg…).
//     Each one costs attributes / skills / movement / battle power while it
//     lasts, heals a little every day (faster resting at an inn or at home,
//     with treatment, a healer in the party or a hospital), and an untreated
//     wound can turn infected — an infected wound stops mending, drains health
//     and may fester into Wound Fever. A few leave a permanent mark, recorded
//     as a deed that earns a trait (Scarred, Lame: data/traits.json), which
//     changes how NPCs react.
//   • DISEASES caught from exposure (WEATHER_EFFECTS exposure), raw food, the
//     swamps, plague-struck lands (crowded cities worst), the lean season and
//     long sea voyages without fresh food. A disease runs through stages; at
//     the end of each stage it either passes or worsens, and the last stage
//     can kill. Care (rest, treatment, healer companions, blessings, a
//     hospital, herbalism) cuts both the chance to worsen and to die.
//     Contagious diseases spread to travel companions and the crew of the
//     ship the player sails.
//   • MEDICINE: physicians and herbalists in settlements (better in cities and
//     with medicine techs), temple healing rites, remedies from the pack
//     (herbs, salves, potions, holy water), prayer, and the Divine Healing
//     miracle.
//
// The old delve injuries (player.delves.injuries) are folded in here: delves
// inflict ailments, and legacy injury records are migrated on load.
//
// Domain rules: no globals — player / world are passed in; all randomness via
// Utils. processDay only REPORTS a death ({ died }); the UI triggers it.
// Content: data/ailments.json (DataLoader → Ailments.load, or read lazily).

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { WorldEvents } from '../world/worldEvents.js';
import { Seasons } from '../world/seasons.js';
import { Traits } from './traits.js';
import { Technology } from './technology.js';
import { Relationships } from './relationships.js';
import { Companions } from './companions.js';

export const AILMENT_ATTRS = ['strength', 'charisma', 'intelligence', 'faith', 'luck'];
export const AILMENT_SKILLS = ['combat', 'stealth', 'diplomacy', 'leadership', 'commerce', 'cartography'];
export const AILMENT_EFFECT_KEYS = ['attrs', 'skills', 'movement', 'battlePower', 'healthDrain'];
const REST_TYPES = ['inn', 'ownHouse', 'camp', 'outdoors'];

/** Old delve injury ids → ailment ids. */
const DELVE_INJURY_MAP = { broken_arm: 'broken_arm', concussion: 'concussion', scarred_face: 'slashed_face', dark_dreams: 'dark_dreams' };

function _num(v) {
    return typeof v === 'number' && isFinite(v) ? v : 0;
}

function _day(world) {
    return (world && world.day) || 0;
}

function _roll(range) {
    if (Array.isArray(range)) return Utils.randInt(range[0], range[1]);
    return Math.max(1, Math.round(_num(range)) || 1);
}

function _weightedPick(pool) {
    const entries = Object.entries(pool || {}).filter(([, w]) => w > 0);
    if (!entries.length) return null;
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let x = Utils.random() * total;
    for (const [id, w] of entries) {
        x -= w;
        if (x < 0) return id;
    }
    return entries[entries.length - 1][0];
}

export const Ailments = {
    CONFIG: {},
    DEFS: {},
    _loaded: false,

    /** Install content from data/ailments.json. */
    load(data) {
        if (!data) return;
        Ailments.CONFIG = data.config || {};
        Ailments.DEFS = data.ailments || {};
        Ailments._loaded = true;
    },

    _ensureLoaded() {
        if (Ailments._loaded) return;
        const data = DataLoader.ailments || (DataLoader.get && DataLoader.get('ailments'));
        if (data) Ailments.load(data);
    },

    cfg() {
        Ailments._ensureLoaded();
        return Ailments.CONFIG;
    },

    def(id) {
        Ailments._ensureLoaded();
        return Ailments.DEFS[id] || null;
    },

    // ──────────── STATE ────────────

    _blank() {
        return {
            list: [],
            nextKey: 1,
            daysAtSea: 0,
            freshDays: 0,
            party: {},
            crews: {},
            prayedDay: -1,
            stats: { wounds: 0, diseases: 0, healed: 0, scars: 0, infections: 0, treatments: 0 },
            deathCause: null,
            notices: [],
        };
    },

    /** Get (creating/backfilling) the player's ailment record. */
    getState(player) {
        if (!player) return null;
        let st = player.ailments;
        if (!st || typeof st !== 'object' || Array.isArray(st)) {
            player.ailments = Ailments._blank();
            return player.ailments;
        }
        const blank = Ailments._blank();
        if (!Array.isArray(st.list)) st.list = [];
        if (!(st.nextKey > 0)) st.nextKey = st.list.length + 1;
        if (typeof st.daysAtSea !== 'number') st.daysAtSea = 0;
        if (typeof st.freshDays !== 'number') st.freshDays = 0;
        if (!st.party || typeof st.party !== 'object') st.party = {};
        if (!st.crews || typeof st.crews !== 'object') st.crews = {};
        if (typeof st.prayedDay !== 'number') st.prayedDay = -1;
        if (!st.stats || typeof st.stats !== 'object') st.stats = blank.stats;
        for (const [k, v] of Object.entries(blank.stats)) if (typeof st.stats[k] !== 'number') st.stats[k] = v;
        if (st.deathCause === undefined) st.deathCause = null;
        if (!Array.isArray(st.notices)) st.notices = [];
        return st;
    },

    serialize(player) {
        return player && player.ailments ? JSON.parse(JSON.stringify(player.ailments)) : null;
    },

    /** Backfill after load; folds legacy delve injuries into ailments. */
    loadState(player, world = null) {
        Ailments.getState(player);
        Ailments._migrateDelveInjuries(player, world ? _day(world) : null);
    },

    /**
     * Legacy delve injuries already lowered an attribute; carry each over as a
     * wound with the same applied amount and the days it had left.
     */
    _migrateDelveInjuries(player, day) {
        const d = player && player.delves;
        if (!d || !Array.isArray(d.injuries) || !d.injuries.length) return 0;
        const st = Ailments.getState(player);
        let n = 0;
        for (const inj of d.injuries) {
            const id = DELVE_INJURY_MAP[inj.id] || inj.id;
            const def = Ailments.def(id);
            const left = day == null ? 6 : Math.max(1, _num(inj.untilDay) - day);
            const applied = { attrs: {}, skills: {} };
            if (inj.stat && _num(inj.amount) > 0) applied.attrs[inj.stat] = _num(inj.amount);
            st.list.push({
                key: `a${st.nextKey++}`, id, kind: 'wound',
                name: (def && def.name) || inj.name || id, icon: (def && def.icon) || '🩹',
                daysLeft: left, totalDays: left, infected: false, treated: 0, dressedUntil: -1,
                source: 'delve', sinceDay: day == null ? 0 : day, applied,
            });
            n++;
        }
        d.injuries = [];
        return n;
    },

    /** Conditions the player has now (live records). */
    list(player) {
        return (player && player.ailments && Array.isArray(player.ailments.list)) ? player.ailments.list : [];
    },

    has(player, id) {
        return Ailments.list(player).some(a => a.id === id);
    },

    /** Wipe all conditions without restoring stats (a new heir takes over). */
    onSuccession(player) {
        if (!player) return;
        const st = Ailments.getState(player);
        st.list = [];
        st.party = {};
        st.deathCause = null;
        if (player.delves && Array.isArray(player.delves.injuries)) player.delves.injuries = [];
    },

    // ──────────── EFFECTS ────────────

    _effectsOf(rec) {
        const def = Ailments.def(rec.id);
        if (!def) return {};
        if (def.kind === 'disease') {
            const stage = (def.stages || [])[rec.stage || 0];
            return (stage && stage.effects) || {};
        }
        return def.effects || {};
    },

    /** Lower attributes/skills for a record; remembers exactly what was taken. */
    _apply(player, rec, effects) {
        const minAttr = _num(Ailments.cfg().minAttribute) || 1;
        rec.applied = rec.applied || { attrs: {}, skills: {} };
        rec.applied.attrs = rec.applied.attrs || {};
        rec.applied.skills = rec.applied.skills || {};
        for (const [stat, delta] of Object.entries(effects.attrs || {})) {
            if (!(delta < 0)) continue;
            const amount = Math.max(0, Math.min(-delta, _num(player[stat]) - minAttr));
            if (amount > 0) {
                player[stat] = _num(player[stat]) - amount;
                rec.applied.attrs[stat] = _num(rec.applied.attrs[stat]) + amount;
            }
        }
        if (player.skills) {
            for (const [skill, delta] of Object.entries(effects.skills || {})) {
                if (!(delta < 0)) continue;
                const amount = Math.max(0, Math.min(-delta, _num(player.skills[skill])));
                if (amount > 0) {
                    player.skills[skill] = _num(player.skills[skill]) - amount;
                    rec.applied.skills[skill] = _num(rec.applied.skills[skill]) + amount;
                }
            }
        }
    },

    /** Give back what a record took. */
    _unapply(player, rec) {
        const a = rec.applied || {};
        for (const [stat, amount] of Object.entries(a.attrs || {})) player[stat] = _num(player[stat]) + _num(amount);
        if (player.skills) {
            for (const [skill, amount] of Object.entries(a.skills || {})) player.skills[skill] = _num(player.skills[skill]) + _num(amount);
        }
        rec.applied = { attrs: {}, skills: {} };
    },

    /** Movement lost each day to conditions (and a permanent limp). */
    movementPenalty(player) {
        let pen = 0;
        for (const rec of Ailments.list(player)) pen += -Math.min(0, _num(Ailments._effectsOf(rec).movement));
        if (Traits.has(player, 'lame')) pen += 1;
        return pen;
    },

    /** Multiplier on the player's battle power and personal melee damage. */
    battleMultiplier(player) {
        let m = 1;
        for (const rec of Ailments.list(player)) {
            m *= 1 + Math.min(0, _num(Ailments._effectsOf(rec).battlePower));
            if (rec.infected) m *= 0.95;
        }
        return Math.max(0.4, m);
    },

    /** Daily health a record drains. */
    _drain(rec) {
        let d = _num(Ailments._effectsOf(rec).healthDrain);
        if (rec.infected) d += _num(Ailments.cfg().wound && Ailments.cfg().wound.infectedDrain);
        return d;
    },

    // ──────────── INFLICTING ────────────

    /**
     * Give the player a condition. Wounds of the same kind extend the old one;
     * a disease already caught is not caught twice.
     * opts: { source, days (wound duration override), stage, silent }
     * Returns { key, id, kind, name, icon, days, stat, amount, text } or null.
     */
    inflict(player, world, id, opts = {}) {
        const def = Ailments.def(id);
        if (!player || !def) return null;
        const st = Ailments.getState(player);
        const day = _day(world);
        if (def.kind === 'disease') {
            if (st.list.some(a => a.id === id)) return null;
            const stage = Math.max(0, Math.min((def.stages || []).length - 1, _num(opts.stage)));
            const rec = {
                key: `a${st.nextKey++}`, id, kind: 'disease', name: def.name, icon: def.icon,
                stage, dayInStage: 0, stageDays: _roll(def.stages[stage].days),
                treated: 0, easedUntil: -1, easeMult: 1, source: opts.source || null, sinceDay: day,
                applied: { attrs: {}, skills: {} },
            };
            Ailments._apply(player, rec, Ailments._effectsOf(rec));
            st.list.push(rec);
            st.stats.diseases++;
            return Ailments._report(rec, def, rec.stageDays);
        }
        const days = opts.days != null ? _roll(opts.days) : _roll(def.days);
        const existing = st.list.find(a => a.id === id && a.kind === 'wound');
        if (existing) {
            existing.daysLeft = Math.max(existing.daysLeft, days);
            existing.totalDays = Math.max(existing.totalDays || 0, existing.daysLeft);
            return Ailments._report(existing, def, days);
        }
        const rec = {
            key: `a${st.nextKey++}`, id, kind: 'wound', name: def.name, icon: def.icon,
            daysLeft: days, totalDays: days, infected: false, treated: 0, dressedUntil: -1,
            source: opts.source || null, sinceDay: day, applied: { attrs: {}, skills: {} },
        };
        Ailments._apply(player, rec, def.effects || {});
        st.list.push(rec);
        st.stats.wounds++;
        return Ailments._report(rec, def, days);
    },

    _report(rec, def, days) {
        const attrs = (rec.applied && rec.applied.attrs) || {};
        const stat = Object.keys(attrs)[0] || null;
        return {
            key: rec.key, id: rec.id, kind: rec.kind, name: rec.kind === 'disease' ? Ailments.stageName(rec) : rec.name,
            icon: rec.kind === 'disease' ? Ailments.stageIcon(rec) : rec.icon,
            days, stat, amount: stat ? attrs[stat] : 0,
            text: Ailments.effectText(Ailments._effectsOf(rec)) || def.description || '',
        };
    },

    /**
     * Roll for a wound from a source in data (ambush, beast, monster,
     * battle_win, battle_loss, sea_battle, duel, brawl, hunt, kick).
     * Armour and Divine Protection lower the odds. Returns the wound or null.
     */
    maybeWound(player, world, source, opts = {}) {
        const src = ((Ailments.cfg().woundSources) || {})[source];
        if (!player || !src) return null;
        if (player.blessings && player.blessings.protection > 0) return null;
        let chance = _num(src.chance) * (opts.chanceMult != null ? opts.chanceMult : 1);
        const inv = player.inventory || {};
        for (const [item, red] of Object.entries(Ailments.cfg().armour || {})) {
            if (inv[item] > 0) chance *= 1 - _num(red);
        }
        if (!(Utils.random() < chance)) return null;
        const id = _weightedPick(src.pool);
        return id ? Ailments.inflict(player, world, id, { source }) : null;
    },

    /** After a battle the player fought in: maybe a wound. */
    afterBattle(player, world, victory, opts = {}) {
        return Ailments.maybeWound(player, world, opts.sea ? 'sea_battle' : (victory ? 'battle_win' : 'battle_loss'));
    },

    /** Chance multiplier for catching a disease (a strong constitution helps). */
    _catchMult(player) {
        const cfg = Ailments.cfg();
        const strength = _num(player.strength) || 5;
        return Math.max(0.3, (_num(cfg.sicknessMult) || 1) * (1 - (strength - 5) * _num(cfg.strengthResist)));
    },

    /** Try to catch a disease with a base chance. Returns the report or null. */
    _tryCatch(player, world, diseaseId, chance, source, out) {
        if (!diseaseId || Ailments.has(player, diseaseId)) return null;
        if (!(Utils.random() < chance * Ailments._catchMult(player))) return null;
        const rep = Ailments.inflict(player, world, diseaseId, { source });
        if (rep && out) out.caught.push({ ...rep, source });
        return rep;
    },

    // ──────────── CARE ────────────

    _restType(player) {
        const r = player && player._lastRestType;
        return REST_TYPES.includes(r) ? r : 'outdoors';
    },

    /** Occupations of the travel party. */
    _party(player) {
        if (!player || !Array.isArray(player.travelParty) || !player.travelParty.length) return [];
        try {
            return Relationships.getTravelPartyMembers(player).filter(Boolean);
        } catch (e) {
            return [];
        }
    },

    _hasHospital(player, world) {
        if (!world || typeof world.getTile !== 'function' || typeof player.q !== 'number') return false;
        try {
            return Technology.hasBuildingNear(player, world, 'hospital_building', player.q, player.r, 2);
        } catch (e) {
            return false;
        }
    },

    _knows(player, techId) {
        try {
            return !!(player.technology && Technology.isImplemented(player, techId));
        } catch (e) {
            return false;
        }
    },

    /**
     * How well the player is being looked after (multiplier on a disease's
     * chance to worsen or kill — lower is better). Breakdown for the UI.
     */
    careFactor(player, world, rec = null) {
        const c = Ailments.cfg().care || {};
        const parts = [];
        let m = 1;
        const rest = Ailments._restType(player);
        const restM = _num((c.rest || {})[rest]) || 1;
        m *= restM;
        if (restM < 1) parts.push(rest === 'inn' ? 'an inn bed' : rest === 'ownHouse' ? 'your own bed' : 'a proper camp');
        let best = 1;
        let healerName = null;
        for (const npc of Ailments._party(player)) {
            const v = _num((c.companions || {})[npc.occupation]);
            if (v > 0 && v < best) { best = v; healerName = npc.firstName || npc.occupation; }
        }
        if (best < 1) { m *= best; parts.push(`${healerName}'s care`); }
        if (player.blessings && player.blessings.temple_blessing > 0 && c.blessing) { m *= c.blessing; parts.push('a blessing'); }
        if (Ailments._hasHospital(player, world) && c.hospital) { m *= c.hospital; parts.push('a hospital'); }
        if (Ailments._knows(player, 'herbalism') && c.herbalism) { m *= c.herbalism; parts.push('herb-lore'); }
        if (rec) {
            if (rec.treated > 0) { m *= 1 - 0.6 * rec.treated; parts.push('treatment'); }
            if (rec.easedUntil >= _day(world) && rec.easeMult > 0 && rec.easeMult < 1) { m *= rec.easeMult; parts.push('remedies'); }
            const def = Ailments.def(rec.id);
            if (def && def.ashoreCare && !player.boardedShip && Ailments._freshOrTown(player, world)) { m *= def.ashoreCare; parts.push('fresh food ashore'); }
        }
        return { mult: Math.max(_num(c.min) || 0.1, m), parts };
    },

    _freshOrTown(player, world) {
        const fresh = (((Ailments.cfg().sources || {}).scurvy) || {}).fresh || [];
        if (fresh.some(f => player.inventory && player.inventory[f] > 0)) return true;
        const tile = world && world.getTile ? world.getTile(player.q, player.r) : null;
        return !!(tile && tile.settlement);
    },

    _healerBonus(player) {
        return Ailments._party(player).some(n => ['healer', 'herbalist'].includes(n.occupation));
    },

    // ──────────── DAILY ────────────

    /**
     * The day's course of every condition, new sickness, contagion among
     * companions and crew. ctx: { exposure (health lost to weather tonight),
     * weather (type) }. Returns
     * { caught, worsened, eased, healed, infected, festered, scarred, drained,
     *   companions, crews, notices, died: null | { cause, name, icon } }.
     * Never triggers death itself — the caller does.
     */
    processDay(world, player, ctx = {}) {
        const out = { caught: [], worsened: [], eased: [], healed: [], infected: [], festered: [], scarred: [], drained: 0, movementLost: 0, companions: [], crews: [], died: null };
        if (!player) return out;
        Ailments._ensureLoaded();
        if (!Object.keys(Ailments.DEFS).length) return out;
        const st = Ailments.getState(player);
        const day = _day(world);
        Ailments._migrateDelveInjuries(player, day);

        // ── New sickness ──
        Ailments._catchNew(player, world, ctx, out);

        // ── Course of each condition ──
        const cfgW = Ailments.cfg().wound || {};
        const rest = Ailments._restType(player);
        const hospital = Ailments._hasHospital(player, world);
        const healer = Ailments._healerBonus(player);
        for (const rec of st.list.slice()) {
            const def = Ailments.def(rec.id);
            if (!def) { Ailments._remove(player, rec); continue; }
            if (rec.kind === 'wound') Ailments._woundDay(player, world, rec, def, { cfgW, rest, hospital, healer, day }, out);
            else Ailments._diseaseDay(player, world, rec, def, out);
            if (out.died) break;
        }

        // ── Health drain ──
        if (!out.died) {
            let drain = 0;
            for (const rec of st.list) drain += Ailments._drain(rec);
            if (drain > 0) {
                player.health = _num(player.health) - drain;
                out.drained = drain;
                if (player.health <= 0) {
                    player.health = 0;
                    const worst = Ailments._worst(player);
                    out.died = { cause: worst && worst.kind === 'wound' ? 'wounds' : 'illness', name: worst ? Ailments.displayName(worst) : 'sickness', icon: worst ? Ailments.displayIcon(worst) : '💀' };
                }
            }
        }

        // ── Slower on the road ──
        const pen = Ailments.movementPenalty(player);
        if (pen > 0 && _num(player.movementRemaining) > 1) {
            const before = player.movementRemaining;
            player.movementRemaining = Math.max(1, before - pen);
            out.movementLost = before - player.movementRemaining;
        }

        // ── Companions and crews ──
        if (!out.died) {
            Ailments._companionsDay(player, world, out);
            Ailments._crewsDay(player, world, out);
        }

        if (out.died) st.deathCause = { ...out.died, day };
        return out;
    },

    _worst(player) {
        let best = null;
        let score = -1;
        for (const rec of Ailments.list(player)) {
            const def = Ailments.def(rec.id);
            const s = _num(def && def.severity) + (rec.kind === 'disease' ? _num(rec.stage) * 2 : 0) + (rec.infected ? 2 : 0);
            if (s > score) { score = s; best = rec; }
        }
        return best;
    },

    _remove(player, rec) {
        Ailments._unapply(player, rec);
        const st = Ailments.getState(player);
        st.list = st.list.filter(a => a !== rec);
    },

    _woundDay(player, world, rec, def, env, out) {
        const { cfgW, rest, hospital, healer, day } = env;
        if (!rec.infected) {
            // Infection risk for an open wound
            let inf = _num(def.infection);
            if (inf > 0) {
                if (rec.treated > 0) inf *= _num(cfgW.treatedInfectionMult) || 0.1;
                else if (rec.dressedUntil >= day) inf *= _num(cfgW.dressedInfectionMult) || 0.25;
                inf *= _num((cfgW.restInfectionMult || {})[rest]) || 1;
                if (healer) inf *= _num(cfgW.healerInfectionMult) || 0.5;
                if (Utils.random() < inf) {
                    rec.infected = true;
                    Ailments.getState(player).stats.infections++;
                    out.infected.push(rec.name);
                    return;
                }
            }
            // Mending
            let heal = _num(cfgW.baseHeal) || 1;
            heal += _num((cfgW.restHeal || {})[rest]);
            if (rec.treated > 0) heal += _num(cfgW.treatedHeal);
            if (healer) heal += _num(cfgW.healerHeal);
            if (hospital) heal += _num(cfgW.hospitalHeal);
            rec.daysLeft = _num(rec.daysLeft) - heal;
            if (rec.daysLeft <= 0) {
                Ailments._remove(player, rec);
                Ailments.getState(player).stats.healed++;
                out.healed.push(rec.name);
                // A lasting mark?
                const perm = def.permanent;
                if (perm && perm.deed) {
                    let chance = _num(perm.chance);
                    if (rec.treated > 0) chance *= _num(cfgW.treatedScarMult) || 0.5;
                    if (Utils.random() < chance) {
                        const before = new Set(Traits.getEarned(player));
                        Traits.recordDeed(player, perm.deed, 1);
                        const gained = Traits.getEarned(player).filter(t => !before.has(t));
                        Ailments.getState(player).stats.scars++;
                        out.scarred.push({ wound: rec.name, deed: perm.deed, traits: gained });
                    }
                }
            }
            return;
        }
        // Infected: no mending; it may clear by itself, or fester into a fever
        const clear = _num((cfgW.infectionClear || {})[rest]) * (healer ? 2 : 1);
        if (Utils.random() < clear) {
            rec.infected = false;
            return;
        }
        // A wound festers into a fever at most once
        if (rec.festered) return;
        const care = Ailments.careFactor(player, world).mult;
        if (Utils.random() < _num(cfgW.festerChance) * care) {
            const rep = Ailments.inflict(player, world, 'wound_fever', { source: rec.id });
            if (rep) {
                rec.festered = true;
                out.festered.push({ wound: rec.name, ...rep });
            }
        }
    },

    _diseaseDay(player, world, rec, def, out) {
        const stages = def.stages || [];
        const stage = stages[rec.stage] || stages[0];
        if (!stage) { Ailments._remove(player, rec); return; }
        const care = Ailments.careFactor(player, world, rec).mult;
        // The deadly stage
        if (_num(stage.deathChance) > 0 && Utils.random() < _num(stage.deathChance) * care) {
            out.died = { cause: 'illness', name: stage.name || def.name, icon: stage.icon || def.icon };
            return;
        }
        rec.dayInStage = _num(rec.dayInStage) + 1;
        if (rec.dayInStage < _num(rec.stageDays)) return;
        // The crisis: worse, or it passes
        const next = stages[rec.stage + 1];
        if (next && Utils.random() < _num(stage.worsen) * care) {
            Ailments._setStage(player, rec, rec.stage + 1);
            out.worsened.push({ key: rec.key, name: def.name, stage: next.name, icon: next.icon || def.icon });
            return;
        }
        Ailments._remove(player, rec);
        Ailments.getState(player).stats.healed++;
        out.healed.push(def.name);
    },

    _setStage(player, rec, stage) {
        const def = Ailments.def(rec.id);
        Ailments._unapply(player, rec);
        rec.stage = stage;
        rec.dayInStage = 0;
        rec.stageDays = _roll(def.stages[stage].days);
        Ailments._apply(player, rec, Ailments._effectsOf(rec));
    },

    /** Step a disease down one stage (or cure it from the first). */
    _stepDown(player, rec) {
        if (rec.kind !== 'disease') return false;
        if (rec.stage > 0) {
            Ailments._setStage(player, rec, rec.stage - 1);
        } else {
            Ailments._remove(player, rec);
            Ailments.getState(player).stats.healed++;
        }
        return true;
    },

    _catchNew(player, world, ctx, out) {
        const src = Ailments.cfg().sources || {};
        const st = Ailments.getState(player);
        const day = _day(world);
        const tile = world && typeof world.getTile === 'function' && typeof player.q === 'number' ? world.getTile(player.q, player.r) : null;
        const rest = Ailments._restType(player);

        // Exposure: a night in the open in a storm, blizzard or heat wave
        if (src.exposure && _num(ctx.exposure) > 0) {
            const id = (src.exposure.byWeather || {})[ctx.weather] || src.exposure.disease;
            Ailments._tryCatch(player, world, id, _num(src.exposure.perHealthLost) * _num(ctx.exposure), 'exposure', out);
        }

        // Bad food: the day's ration eaten raw
        if (src.rawFood && (src.rawFood.foods || []).includes(player._lastFood)) {
            Ailments._tryCatch(player, world, src.rawFood.disease, _num(src.rawFood.chance), 'food', out);
        }

        // Swamps and steaming jungles
        if (src.swamp && tile && tile.terrain && !player.boardedShip) {
            const base = _num((src.swamp.terrains || {})[tile.terrain.id]);
            if (base > 0) {
                let chance = base * (_num((src.swamp.season || {})[world.season]) || 1);
                if (tile.settlement) chance *= _num(src.swamp.settlementMult) || 1;
                if (rest === 'camp') chance *= _num(src.swamp.campMult) || 1;
                if (rest === 'inn' || rest === 'ownHouse') chance *= _num(src.swamp.shelterMult) || 1;
                Ailments._tryCatch(player, world, src.swamp.disease, chance, 'swamp', out);
            }
        }

        // Plague-struck lands, worst in crowded cities
        if (src.plague && tile && world && Array.isArray(world.activeEvents) && world.activeEvents.length) {
            let plague = null;
            try { plague = WorldEvents.getEventsAt(world, tile).find(ev => ev.id === 'plague'); } catch (e) { plague = null; }
            if (plague) {
                const crowd = _num((src.plague.crowd || {})[tile.settlement ? tile.settlement.type : 'wild']) || 1;
                let resist = 0;
                try { resist = Technology.getPlagueResistance(player); } catch (e) { resist = 0; }
                Ailments._tryCatch(player, world, src.plague.disease, _num(src.plague.chance) * crowd * (1 - resist), 'plague', out);
            }
        }

        // The lean season: hunger and crowds breed fevers
        if (src.lean && world && Seasons.isLean(day)) {
            let chance = _num(src.lean.chance);
            if (_num(player.starvationDays) > 0) chance *= _num(src.lean.starvingMult) || 1;
            else if (player.needsEnabled && player.needs && _num(player.needs.hunger) < _num(src.lean.hungerBelow)) chance *= _num(src.lean.hungryMult) || 1;
            if (tile && tile.settlement) chance *= _num(src.lean.crowdMult) || 1;
            Ailments._tryCatch(player, world, src.lean.disease, chance, 'lean', out);
        }

        // Long voyages: scurvy without fresh food
        const sc = src.scurvy;
        if (player.boardedShip) {
            st.daysAtSea++;
            const fresh = sc ? (sc.fresh || []).find(f => player.inventory && player.inventory[f] > 0) : null;
            if (fresh) {
                st.freshDays++;
                if (st.freshDays >= (_num(sc.freshEvery) || 3)) {
                    st.freshDays = 0;
                    player.inventory[fresh]--;
                    if (player.inventory[fresh] <= 0) delete player.inventory[fresh];
                }
            } else if (sc && st.daysAtSea > _num(sc.graceDays)) {
                const chance = Math.min(_num(sc.max), (st.daysAtSea - _num(sc.graceDays)) * _num(sc.perDay));
                Ailments._tryCatch(player, world, sc.disease, chance, 'sea', out);
            }
        } else {
            st.daysAtSea = 0;
            st.freshDays = 0;
        }
    },

    // ──────────── CONTAGION ────────────

    _companionsDay(player, world, out) {
        const st = Ailments.getState(player);
        const cfg = Ailments.cfg();
        const con = cfg.contagion || {};
        const members = Ailments._party(player);
        const ids = new Set(members.map(n => n.id));
        // Companions who left the party take their sickness with them
        for (const id of Object.keys(st.party)) if (!ids.has(id)) delete st.party[id];
        if (!members.length) return;
        const healer = Ailments._healerBonus(player) ? _num(con.healerMult) || 1 : 1;
        // Player → companions
        for (const rec of Ailments.list(player)) {
            const def = Ailments.def(rec.id);
            if (!def || !(def.contagion > 0)) continue;
            for (const npc of members) {
                if (st.party[npc.id]) continue;
                if (Utils.random() < def.contagion * _num(con.toCompanion) * healer) {
                    st.party[npc.id] = { id: rec.id, daysLeft: _roll((cfg.companionSickness || {}).days || [4, 10]) };
                    out.companions.push({ npcId: npc.id, name: npc.firstName, disease: def.name, event: 'caught' });
                }
            }
        }
        // Each sick companion: may pass it on to the player, may die, recovers in time
        const care = Ailments.careFactor(player, world).mult;
        for (const npc of members) {
            const sick = st.party[npc.id];
            if (!sick) continue;
            const def = Ailments.def(sick.id);
            if (!def) { delete st.party[npc.id]; continue; }
            if (def.contagion > 0 && !Ailments.has(player, sick.id)
                && Utils.random() < def.contagion * _num(con.fromCompanion) * healer * Ailments._catchMult(player)) {
                const rep = Ailments.inflict(player, world, sick.id, { source: 'companion' });
                if (rep) out.caught.push({ ...rep, source: 'companion', from: npc.firstName });
            }
            if (Utils.random() < _num(def.companionDeath) * care) {
                delete st.party[npc.id];
                try { Companions.fall(player, npc, world, def.name.toLowerCase()); } catch (e) { /* companion bookkeeping unavailable */ }
                out.companions.push({ npcId: npc.id, name: npc.firstName, disease: def.name, event: 'died' });
                continue;
            }
            sick.daysLeft--;
            if (sick.daysLeft <= 0) {
                delete st.party[npc.id];
                out.companions.push({ npcId: npc.id, name: npc.firstName, disease: def.name, event: 'recovered' });
            }
        }
    },

    /**
     * Start an outbreak of disease `id` among a ship's crew (a starving crew
     * gets scurvy; a fouled derelict, the flux). False if one is already
     * running or the disease is unknown.
     */
    startCrewOutbreak(player, ship, id) {
        if (!player || !ship || !Ailments.def(id)) return false;
        const st = Ailments.getState(player);
        const key = String(ship.id);
        if (st.crews[key]) return false;
        st.crews[key] = { id, daysLeft: _roll((Ailments.cfg().crew || {}).days || [5, 10]) };
        return true;
    },

    _crewsDay(player, world, out) {
        const st = Ailments.getState(player);
        const cfg = Ailments.cfg();
        const crewCfg = cfg.crew || {};
        const ships = Array.isArray(player.ships) ? player.ships : [];
        const live = new Set(ships.map(s => String(s.id)));
        for (const id of Object.keys(st.crews)) if (!live.has(id)) delete st.crews[id];
        // A sick captain aboard can start an outbreak; so can a long voyage without fresh food
        const boarded = player.boardedShip != null ? ships.find(s => s.id === player.boardedShip) : null;
        if (boarded && (boarded.crew || 0) > 0 && !st.crews[String(boarded.id)]) {
            for (const rec of Ailments.list(player)) {
                const def = Ailments.def(rec.id);
                if (!def || !(def.contagion > 0)) continue;
                if (Utils.random() < def.contagion * _num((cfg.contagion || {}).toCrew)) {
                    st.crews[String(boarded.id)] = { id: rec.id, daysLeft: _roll(crewCfg.days || [5, 10]) };
                    out.crews.push({ shipId: boarded.id, name: boarded.name, disease: def.name, event: 'outbreak' });
                    break;
                }
            }
            const fresh = (((cfg.sources || {}).scurvy) || {}).fresh || [];
            // Fruit in the captain's packs or in the ship's hold keeps scurvy off
            const hasFresh = fresh.some(f => (player.inventory && player.inventory[f] > 0) || (boarded.cargo && boarded.cargo[f] > 0));
            if (!st.crews[String(boarded.id)] && !hasFresh && st.daysAtSea > _num(crewCfg.scurvyGraceDays)
                && Utils.random() < Math.min(0.3, (st.daysAtSea - _num(crewCfg.scurvyGraceDays)) * _num(crewCfg.scurvyPerDay))) {
                st.crews[String(boarded.id)] = { id: 'scurvy', daysLeft: _roll(crewCfg.days || [5, 10]) };
                out.crews.push({ shipId: boarded.id, name: boarded.name, disease: 'Scurvy', event: 'outbreak' });
            }
        }
        // Outbreaks run their course: morale sinks, sailors die, a harbour helps
        for (const ship of ships) {
            const ob = st.crews[String(ship.id)];
            if (!ob) continue;
            const def = Ailments.def(ob.id);
            const deadly = def ? 1 + 10 * _num(def.companionDeath) : 1;
            if (typeof ship.morale === 'number') ship.morale = Math.max(0, ship.morale - _num(crewCfg.moraleLoss));
            if ((ship.crew || 0) > 0 && Utils.random() < _num(crewCfg.sailorDeathChance) * deadly) {
                ship.crew -= 1;
                out.crews.push({ shipId: ship.id, name: ship.name, disease: def ? def.name : ob.id, event: 'sailorDied' });
            }
            ob.daysLeft -= ship.status === 'docked' ? _num(crewCfg.dockedRecovery) || 1 : 1;
            if (ob.daysLeft <= 0 || (ship.crew || 0) <= 0) {
                delete st.crews[String(ship.id)];
                out.crews.push({ shipId: ship.id, name: ship.name, disease: def ? def.name : ob.id, event: 'over' });
            }
        }
    },

    // ──────────── MEDICINE ────────────

    /** Treatment quality a settlement's physician offers this player (0..1). */
    physicianQuality(player, settlement, kind) {
        const t = Ailments.cfg().treatment || {};
        let q = _num((t.quality || {})[settlement && settlement.type]) || 0.5;
        for (const [tech, bonus] of Object.entries(t.techQuality || {})) {
            if (!Ailments._knows(player, tech)) continue;
            q += _num(bonus.any) + _num(bonus[kind]);
        }
        return Math.min(_num(t.maxQuality) || 0.95, q);
    },

    /** Severity used for pricing: disease stages count up. */
    severity(rec) {
        const def = Ailments.def(rec.id);
        const base = _num(def && def.severity) || 1;
        return base + (rec.kind === 'disease' ? _num(rec.stage) : 0) + (rec.infected ? 1 : 0);
    },

    treatmentCost(player, settlement, rec, temple = false) {
        const t = Ailments.cfg().treatment || {};
        const size = _num((t.sizePrice || {})[settlement && settlement.type]) || 1;
        const mult = temple ? _num((t.temple || {}).costMult) || 1 : 1;
        return Math.max(1, Math.round(Ailments.severity(rec) * _num(t.costPerSeverity) * size * mult));
    },

    /** Temple healing rites: faith matters more than learning. Diseases only. */
    templeQuality(player) {
        const t = (Ailments.cfg().treatment || {}).temple || {};
        return Math.min(0.85, _num(t.base) + _num(t.perFaith) * _num(player.faith));
    },

    /**
     * What a physician (or the temple) can do for each condition here:
     * [{ key, name, icon, kind, cost, quality, can, reason }].
     */
    treatmentOptions(player, world, settlement, temple = false) {
        return Ailments.list(player).map(rec => {
            const quality = temple ? Ailments.templeQuality(player) : Ailments.physicianQuality(player, settlement, rec.kind);
            const cost = Ailments.treatmentCost(player, settlement, rec, temple);
            let reason = null;
            if (temple && rec.kind !== 'disease') reason = 'The priests tend the sick, not the wounded.';
            else if (rec.treated >= quality - 1e-9 && !rec.infected && rec.kind === 'wound') reason = 'Already treated as well as can be here.';
            else if ((player.gold || 0) < cost) reason = `Costs ${cost} gold.`;
            return { key: rec.key, name: Ailments.displayName(rec), icon: Ailments.displayIcon(rec), kind: rec.kind, cost, quality, can: !reason, reason };
        });
    },

    /**
     * Pay a physician (or the temple) to treat one condition.
     * Wounds: cleaned and set (no infection, mends faster, scars less).
     * Diseases: tended (less likely to worsen or kill) and may ease a stage.
     */
    treat(player, world, settlement, key, temple = false) {
        const st = Ailments.getState(player);
        const rec = st.list.find(a => a.key === key);
        if (!rec) return { success: false, reason: 'That has already passed.' };
        const opt = Ailments.treatmentOptions(player, world, settlement, temple).find(o => o.key === key);
        if (!opt || !opt.can) return { success: false, reason: (opt && opt.reason) || 'Nothing to be done here.' };
        const t = Ailments.cfg().treatment || {};
        player.gold -= opt.cost;
        if (player.financeToday) {
            player.financeToday.expenses = player.financeToday.expenses || {};
            player.financeToday.expenses.medicine = (player.financeToday.expenses.medicine || 0) + opt.cost;
        }
        st.stats.treatments++;
        const name = Ailments.displayName(rec);
        player.health = Math.min(player.maxHealth || 100, _num(player.health) + _num(t.healthRestore));
        const lines = [];
        if (rec.kind === 'wound') {
            if (rec.infected) { rec.infected = false; lines.push('the infection is cut out'); }
            const cut = Math.round(_num(rec.daysLeft) * _num(t.woundDaysCut) * opt.quality);
            rec.daysLeft = Math.max(1, _num(rec.daysLeft) - cut);
            rec.treated = Math.max(rec.treated || 0, opt.quality);
            lines.push(`cleaned and set (about ${Math.ceil(rec.daysLeft)} days to mend)`);
        } else {
            rec.treated = Math.max(rec.treated || 0, opt.quality);
            if (Utils.random() < _num(t.stageDownChance) * opt.quality) {
                const wasLast = rec.stage === 0;
                Ailments._stepDown(player, rec);
                lines.push(wasLast ? 'the sickness breaks' : 'the worst of it eases');
            } else {
                lines.push('tended and dosed — it should be less likely to worsen');
            }
        }
        if (temple) player.karma = _num(player.karma) + _num((t.temple || {}).karma);
        const who = temple ? 'The priests' : (settlement && settlement.type === 'village' ? 'The village herbalist' : 'The physician');
        return { success: true, cost: opt.cost, quality: opt.quality, message: `${who} sees to your ${name.toLowerCase()}: ${lines.join(', ')}. (${opt.cost}g)` };
    },

    /** Cost to have a physician see to a sick companion. */
    companionTreatmentCost(player, settlement, npcId) {
        const sick = player && player.ailments && player.ailments.party && player.ailments.party[npcId];
        if (!sick) return 0;
        const t = Ailments.cfg().treatment || {};
        const size = _num((t.sizePrice || {})[settlement && settlement.type]) || 1;
        const def = Ailments.def(sick.id);
        return Math.max(1, Math.round((_num(def && def.severity) || 1) * _num(t.costPerSeverity) * size));
    },

    /** A physician nurses a sick companion back to health. */
    treatCompanion(player, settlement, npcId) {
        const st = Ailments.getState(player);
        const sick = st.party[npcId];
        if (!sick) return { success: false, reason: 'They are well.' };
        const cost = Ailments.companionTreatmentCost(player, settlement, npcId);
        if ((player.gold || 0) < cost) return { success: false, reason: `Costs ${cost} gold.` };
        player.gold -= cost;
        if (player.financeToday) {
            player.financeToday.expenses = player.financeToday.expenses || {};
            player.financeToday.expenses.medicine = (player.financeToday.expenses.medicine || 0) + cost;
        }
        const def = Ailments.def(sick.id);
        delete st.party[npcId];
        st.stats.treatments++;
        let name = 'your companion';
        try { const npc = Relationships.getNPC(npcId); if (npc) name = npc.firstName; } catch (e) { /* unknown NPC */ }
        return { success: true, cost, message: `The physician nurses ${name} through the ${def ? def.name.toLowerCase() : 'sickness'}. (${cost}g)` };
    },

    /** Remedies the player carries that would help: [{ item, name, qty, def }]. */
    remediesHeld(player) {
        const rem = Ailments.cfg().remedies || {};
        return Object.entries(rem)
            .filter(([item]) => player.inventory && player.inventory[item] > 0)
            .map(([item, def]) => ({ item, name: def.name || item, qty: player.inventory[item], def }));
    },

    /** Is a remedy any use against this condition? */
    remedyFits(def, rec) {
        if (!def || !rec) return false;
        if (rec.kind === 'wound') return !!(def.dress || def.mend || def.clearInfection);
        return !!(def.ease || def.stageDown);
    },

    /** Use a remedy from the pack on one condition. */
    useRemedy(player, world, item, key) {
        const def = (Ailments.cfg().remedies || {})[item];
        const st = Ailments.getState(player);
        const rec = st.list.find(a => a.key === key);
        if (!def) return { success: false, reason: 'That is no remedy.' };
        if (!rec) return { success: false, reason: 'That has already passed.' };
        if (!(player.inventory && player.inventory[item] > 0)) return { success: false, reason: `You have no ${def.name || item}.` };
        if (!Ailments.remedyFits(def, rec)) return { success: false, reason: `${def.name} won't help with that.` };
        player.inventory[item]--;
        if (player.inventory[item] <= 0) delete player.inventory[item];
        const day = _day(world);
        const lines = [];
        const name = Ailments.displayName(rec);
        if (rec.kind === 'wound') {
            if (def.dress) { rec.dressedUntil = Math.max(rec.dressedUntil || -1, day + def.dress); lines.push(`dressed for ${def.dress} days`); }
            if (def.mend) { rec.daysLeft = Math.max(1, _num(rec.daysLeft) - def.mend); lines.push('it knits faster'); }
            if (rec.infected && def.clearInfection && Utils.random() < def.clearInfection) { rec.infected = false; lines.push('the infection is drawn out'); }
        } else {
            if (def.ease) {
                rec.easeMult = Math.min(rec.easedUntil >= day ? rec.easeMult || 1 : 1, def.ease);
                rec.easedUntil = Math.max(rec.easedUntil || -1, day + (def.easeDays || 3));
                lines.push('the fever is eased');
            }
            const down = _num(def.stageDown) + _num(def.stageDownPerFaith) * _num(player.faith);
            if (down > 0 && Utils.random() < down) {
                const wasFirst = rec.stage === 0;
                Ailments._stepDown(player, rec);
                lines.push(wasFirst ? 'the sickness lifts' : 'the worst of it passes');
            }
        }
        if (def.health) player.health = Math.min(player.maxHealth || 100, _num(player.health) + def.health);
        return { success: true, message: `You use ${def.name} on your ${name.toLowerCase()}${lines.length ? `: ${lines.join(', ')}` : ''}.` };
    },

    /**
     * A prayer for the sick (once a day): the worst disease is eased a little,
     * and the faithful are sometimes answered outright.
     * Returns null when there is nothing to pray over.
     */
    pray(player, world) {
        const st = Ailments.getState(player);
        const day = _day(world);
        const sick = st.list.filter(a => a.kind === 'disease');
        if (!sick.length || st.prayedDay === day) return null;
        st.prayedDay = day;
        const p = Ailments.cfg().prayer || {};
        const rec = sick.sort((a, b) => Ailments.severity(b) - Ailments.severity(a))[0];
        rec.easeMult = Math.min(rec.easedUntil >= day ? rec.easeMult || 1 : 1, _num(p.ease) || 0.85);
        rec.easedUntil = Math.max(rec.easedUntil || -1, day + (_num(p.easeDays) || 2));
        let chance = _num(p.miracleBase) + _num(p.miraclePerFaith) * _num(player.faith);
        if (_num(player.karma) >= _num(p.miracleKarma)) chance += _num(p.miracleKarmaBonus);
        const name = Ailments.displayName(rec);
        if (Utils.random() < chance) {
            Ailments._stepDown(player, rec);
            return { answered: true, message: `Your prayer is answered — the ${name.toLowerCase()} loosens its grip.` };
        }
        return { answered: false, message: `You pray over your ${name.toLowerCase()}. It feels a little easier to bear.` };
    },

    /** Divine Healing: every condition is lifted (stats restored). Returns how many. */
    cureAll(player) {
        const st = Ailments.getState(player);
        const n = st.list.length;
        for (const rec of st.list.slice()) Ailments._remove(player, rec);
        st.stats.healed += n;
        return n;
    },

    // ──────────── DISPLAY ────────────

    stageName(rec) {
        const def = Ailments.def(rec.id);
        if (!def) return rec.name || rec.id;
        if (rec.kind !== 'disease') return def.name;
        const s = (def.stages || [])[rec.stage || 0];
        return (s && s.name) || def.name;
    },

    stageIcon(rec) {
        const def = Ailments.def(rec.id);
        if (!def) return rec.icon || '🩹';
        if (rec.kind !== 'disease') return def.icon;
        const s = (def.stages || [])[rec.stage || 0];
        return (s && s.icon) || def.icon;
    },

    displayName(rec) {
        const n = Ailments.stageName(rec);
        return rec.infected ? `Infected ${n}` : n;
    },

    displayIcon(rec) {
        return rec.infected ? '🧫' : Ailments.stageIcon(rec);
    },

    /** Readable effects: "-1 strength, -2 movement, -5% battle power, -3 health a day". */
    effectText(effects) {
        const parts = [];
        for (const [k, v] of Object.entries((effects && effects.attrs) || {})) parts.push(`${v} ${k}`);
        for (const [k, v] of Object.entries((effects && effects.skills) || {})) parts.push(`${v} ${k} skill`);
        if (effects && effects.movement) parts.push(`${effects.movement} movement`);
        if (effects && effects.battlePower) parts.push(`${Math.round(effects.battlePower * 100)}% battle power`);
        if (effects && effects.healthDrain) parts.push(`-${effects.healthDrain} health a day`);
        return parts.join(', ');
    },

    /**
     * Everything the UI shows about current conditions:
     * [{ key, id, kind, name, icon, effects, timeText, note, infected, treated, contagious, description }].
     */
    describe(player, world = null) {
        const day = _day(world);
        return Ailments.list(player).map(rec => {
            const def = Ailments.def(rec.id) || {};
            const effects = Ailments.effectText(Ailments._effectsOf(rec));
            let timeText;
            let note = '';
            if (rec.kind === 'wound') {
                timeText = rec.infected ? 'not mending (infected)' : `about ${Math.max(1, Math.ceil(_num(rec.daysLeft)))} day(s) to mend at the base rate`;
                if (rec.infected) note = 'Infected: drains health and may turn to wound fever. A physician, a salve or rest indoors will help.';
                else if (rec.treated > 0) note = 'Treated: mends faster and is unlikely to fester.';
                else if (rec.dressedUntil >= day) note = `Dressed for ${rec.dressedUntil - day} more day(s).`;
                else if (def.infection > 0) note = 'Untreated: it may turn infected.';
            } else {
                const stages = def.stages || [];
                const left = Math.max(1, _num(rec.stageDays) - _num(rec.dayInStage));
                const last = rec.stage >= stages.length - 1;
                timeText = last ? `crisis in about ${left} day(s)` : `turns in about ${left} day(s) — it will pass or worsen`;
                const stage = stages[rec.stage] || {};
                if (stage.deathChance) note = 'This stage can kill. Rest indoors and get treatment.';
                else if (stages.length > 1 && !last) note = `Can worsen to ${stages[rec.stage + 1].name}.`;
                if (rec.treated > 0) note += (note ? ' ' : '') + 'Under treatment.';
            }
            return {
                key: rec.key, id: rec.id, kind: rec.kind, name: Ailments.displayName(rec), icon: Ailments.displayIcon(rec),
                effects: effects + (rec.infected ? `${effects ? ', ' : ''}-${_num((Ailments.cfg().wound || {}).infectedDrain)} health a day` : ''),
                timeText, note, infected: !!rec.infected, treated: rec.treated || 0,
                contagious: _num(def.contagion) > 0, description: def.description || '',
            };
        });
    },

    /** One-line tooltip for a HUD icon. */
    tooltip(info) {
        return [`${info.icon} ${info.name}`, info.effects, info.timeText, info.note].filter(Boolean).join('\n');
    },

    /** Sick companions: [{ npcId, disease, daysLeft }]. */
    sickCompanions(player) {
        const st = player && player.ailments;
        if (!st || !st.party) return [];
        return Object.entries(st.party).map(([npcId, s]) => ({ npcId, disease: (Ailments.def(s.id) || {}).name || s.id, daysLeft: s.daysLeft }));
    },

    /** Validate content (used by tests). Returns a list of problems. */
    validate() {
        Ailments._ensureLoaded();
        const errs = [];
        const cfg = Ailments.CONFIG;
        const checkFx = (where, fx) => {
            for (const k of Object.keys(fx || {})) if (!AILMENT_EFFECT_KEYS.includes(k)) errs.push(`${where}: unknown effect ${k}`);
            for (const s of Object.keys((fx && fx.attrs) || {})) if (!AILMENT_ATTRS.includes(s)) errs.push(`${where}: unknown attribute ${s}`);
            for (const s of Object.keys((fx && fx.skills) || {})) if (!AILMENT_SKILLS.includes(s)) errs.push(`${where}: unknown skill ${s}`);
        };
        for (const [id, def] of Object.entries(Ailments.DEFS)) {
            if (!['wound', 'disease'].includes(def.kind)) errs.push(`${id}: bad kind ${def.kind}`);
            if (def.kind === 'wound') {
                checkFx(id, def.effects);
                if (!Array.isArray(def.days)) errs.push(`${id}: wound needs days [min,max]`);
                if (def.permanent && !(Traits.DEEDS && Traits.DEEDS[def.permanent.deed])) errs.push(`${id}: unknown deed ${def.permanent.deed}`);
            } else {
                if (!Array.isArray(def.stages) || !def.stages.length) errs.push(`${id}: disease needs stages`);
                (def.stages || []).forEach((s, i) => {
                    checkFx(`${id}[${i}]`, s.effects);
                    if (!Array.isArray(s.days)) errs.push(`${id}[${i}]: needs days`);
                });
            }
        }
        for (const [src, w] of Object.entries(cfg.woundSources || {})) {
            for (const id of Object.keys(w.pool || {})) {
                const d = Ailments.DEFS[id];
                if (!d || d.kind !== 'wound') errs.push(`woundSources.${src}: ${id} is not a wound`);
            }
        }
        for (const [src, s] of Object.entries(cfg.sources || {})) {
            const ids = [s.disease, ...Object.values(s.byWeather || {})].filter(Boolean);
            for (const id of ids) if (!Ailments.DEFS[id] || Ailments.DEFS[id].kind !== 'disease') errs.push(`sources.${src}: ${id} is not a disease`);
        }
        if (!Ailments.DEFS.wound_fever) errs.push('wound_fever is required (infected wounds fester into it)');
        return errs;
    },
};
