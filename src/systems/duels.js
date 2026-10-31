// ============================================
// DUELS — one personal-combat engine for every fight between two people
// ============================================
// Tournaments, rival duels and ambushes, combat training and inner-map
// brawls all fight with this engine. A duel is a series of exchanges: each
// round both combatants choose a move —
//
//   Strike  beats Thrust   (the heavy cut beats the point aside)
//   Thrust  beats Feint    (the point punishes the empty motion)
//   Feint   beats Guard    (draws the guard and slips past it, winding them)
//   Guard   beats Strike   (turns the cut into a riposte; recovers breath)
//
// The other pairings are contested (Strike~Feint, Thrust~Guard: a roll of
// attack against attack/defence) or mirrored. Winning the exchange is not
// a sure hit: hit chance is base + (attack − defence) × perPoint, so a
// master still beats a novice who reads him well. Every move but Guard
// costs stamina; a blown fighter's moves come slow.
//
// Combatants are built from real state:
//   fromPlayer — combat skill, strength, luck, the best weapon carried
//                (data weapons table over player.inventory, or
//                player.equipped.weapon), shield, armour, earned traits'
//                battlePower, wounds and sickness (Ailments.battleMultiplier),
//                energy (needs) for stamina, current health for the pool;
//                opts.mods carries mood/treasure effects from the player layer
//                (PlayerEffects.duelModifiers).
//   fromRival  — prowess, cunning, level, faith edge, archetype temperament
//   fromNpc    — the NPC type's profile, temperament from personality traits
//   fromProfile — any stat block (trainers, tournament knights)
//
// The opponent AI picks by temperament (aggressive / cautious / tricky /
// balanced), reads the other side's habits, guards when winded and yields
// when beaten (if the mode allows). autoResolve() plays both sides (the
// player by an instinct policy scaled with combat skill) for headless use.
//
// The duel's HP is a bout pool, not the player's health: callers turn the
// share of the pool lost into real harm (Duels.harm) so each feature keeps
// its own balance. All randomness comes from opts.rng or the seeded Utils RNG.
// Content and tuning: data/duels.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Traits } from './traits.js';
import { Ailments } from './ailments.js';

const MOVE_IDS = ['strike', 'thrust', 'feint', 'guard'];

/** Fallbacks for the mechanics (data/duels.json overrides and extends them). */
const DEFAULTS = {
    moves: {
        strike: { label: 'Strike', icon: '⚔️', cost: 3, dmg: 1.35 },
        thrust: { label: 'Thrust', icon: '🗡️', cost: 2, dmg: 1.0 },
        feint: { label: 'Feint', icon: '🌀', cost: 2, dmg: 0.75, drain: 3, opening: 1.5 },
        guard: { label: 'Guard', icon: '🛡️', cost: -2, dmg: 0.6 },
    },
    beats: { strike: 'thrust', thrust: 'feint', feint: 'guard', guard: 'strike' },
    hit: { base: 0.6, perPoint: 0.05, min: 0.12, max: 0.95, cleanBonus: 0.1 },
    regen: 1,
    tiredPenalty: 2,
    exhaustedPenalty: 1,
    modes: {
        spar: { rounds: 5, yield: true, aiYieldAt: 0 },
        tournament: { rounds: 10, yield: true, aiYieldAt: 0.2 },
        firstBlood: { rounds: 12, yield: true, aiYieldAt: 0.25 },
        toDeath: { rounds: 30, yield: false, aiYieldAt: 0 },
        ambush: { rounds: 14, yield: true, aiYieldAt: 0.2 },
    },
    temperaments: {
        aggressive: { label: 'Aggressive', icon: '🔥', weights: { strike: 4, thrust: 3, feint: 1, guard: 1.5 }, read: 0.2, yield: 0.1 },
        cautious: { label: 'Cautious', icon: '🛡️', weights: { strike: 1.5, thrust: 2.5, feint: 1, guard: 4 }, read: 0.25, yield: 0.6 },
        tricky: { label: 'Tricky', icon: '🦊', weights: { strike: 1.5, thrust: 2, feint: 3.5, guard: 2 }, read: 0.45, yield: 0.4 },
        balanced: { label: 'Steady', icon: '⚖️', weights: { strike: 2.5, thrust: 2.5, feint: 2, guard: 2.5 }, read: 0.25, yield: 0.3 },
    },
    rivalTemperaments: {},
    folkTemperaments: {},
    weapons: { fists: { name: 'bare fists', icon: '✊', dmg: 0, attack: -1, rank: 0 } },
    shields: { shield: { name: 'shield', icon: '🛡️', guard: 1.5, riposte: 0.4 } },
    armour: { leather_armor: 0.2, dragonscale_armor: 0.35, amulet: 0.1 },
    maxArmour: 0.7,
    npcs: { villager: { attack: 1, defense: 1.5, power: 5, hp: 22, stamina: 10, armour: 0, weapon: 'bare fists' } },
    trainers: {},
    tournament: {
        tiers: [{ title: 'Knight', attack: [3, 6], defense: [3, 5], power: [6, 9], hp: [26, 34], stamina: [10, 13] }],
        firstNames: ['Aldric'], epithets: ['the Bold'],
        renownPerWin: 2, championRenown: 5, runnerUpShare: 0.4, harm: [4, 14], boutRecovery: 0.5,
        skillUpBase: 0.2, skillUpPerWin: 0.1,
    },
    brawl: {
        base: 2, perStrength: 1.2, perWeaponDmg: 2, minDamage: 3, purse: {}, itemsTaken: [1, 2], healPerDay: 0.12,
        npcHitScale: 1.6,
        stance: { fightAt: 5, temperament: { aggressive: 2, cautious: -2, tricky: 0, balanced: 0 }, playerAttackFree: 4, perPlayerAttack: 0.5, fleeBelowHp: 0.35 },
    },
    lines: {},
};

let _cfg = null;
let _cfgSrc;

function _num(v, d = 0) {
    return typeof v === 'number' && isFinite(v) ? v : d;
}

function _obj(v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}

function _clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function _fill(text, vars) {
    let s = String(text || '');
    for (const [k, v] of Object.entries(vars || {})) s = s.split(`{${k}}`).join(v);
    return s;
}

function _rngOf(opts) {
    return (opts && typeof opts.rng === 'function') ? opts.rng : () => Utils.random();
}

function _between(range, rng) {
    if (Array.isArray(range)) return range[0] + (range[1] - range[0]) * rng();
    return _num(range);
}

function _weighted(weights, rng) {
    const entries = Object.entries(weights).filter(([, w]) => w > 0);
    const total = entries.reduce((t, [, w]) => t + w, 0);
    if (!entries.length) return 'guard';
    let roll = rng() * total;
    for (const [k, w] of entries) {
        roll -= w;
        if (roll <= 0) return k;
    }
    return entries[entries.length - 1][0];
}

export const Duels = {
    MOVES: MOVE_IDS,

    // ──────────── DATA ────────────

    config() {
        const src = DataLoader.get ? DataLoader.get('duels') : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            const out = { ...DEFAULTS, ...d };
            // One level of merging for the tables, so data can add without restating
            for (const k of Object.keys(DEFAULTS)) {
                if (_obj(DEFAULTS[k])) out[k] = { ...DEFAULTS[k], ...(_obj(d[k]) || {}) };
            }
            _cfg = out;
        }
        return _cfg;
    },

    move(id) {
        return Duels.config().moves[id] || null;
    },

    mode(id) {
        const m = Duels.config().modes;
        return m[id] || m.firstBlood || DEFAULTS.modes.firstBlood;
    },

    temperament(id) {
        const t = Duels.config().temperaments;
        return t[id] || t.balanced || DEFAULTS.temperaments.balanced;
    },

    /** The move that beats `id`. */
    counterTo(id) {
        const beats = Duels.config().beats;
        return MOVE_IDS.find(m => beats[m] === id) || 'guard';
    },

    // ──────────── COMBATANTS ────────────

    /** A combatant from a plain stat block. */
    fromProfile(p = {}) {
        const maxHp = Math.max(1, Math.round(_num(p.hp, 24)));
        const maxStamina = Math.max(3, Math.round(_num(p.stamina, 10)));
        return {
            id: p.id || 'npc',
            name: p.name || 'Stranger',
            icon: p.icon || '🧍',
            kind: p.kind || 'npc',
            attack: _num(p.attack, 2),
            defense: _num(p.defense, 2),
            power: Math.max(1, _num(p.power, 6)),
            armour: _clamp(_num(p.armour), 0, Duels.config().maxArmour),
            riposte: _num(p.riposte),
            weapon: p.weapon || 'bare fists',
            weaponDmg: _num(p.weaponDmg),
            shield: p.shield || null,
            temperament: p.temperament || 'balanced',
            maxHp,
            hp: Math.max(1, Math.min(maxHp, Math.round(_num(p.hpNow, maxHp)))),
            maxStamina,
            stamina: Math.max(0, Math.min(maxStamina, Math.round(_num(p.staminaNow, maxStamina)))),
            skill: _num(p.skill, 3),
            ref: p.ref || null,
        };
    },

    /**
     * The best weapon the player carries (or has equipped): { id, name, icon,
     * dmg, attack, quality }. `quality` is the player layer's map of crafted
     * quality multipliers ({ itemId: effectMult }, PlayerEffects.duelModifiers
     * via Crafting.effectMult): a Fine sword cuts deeper, a Crude one less.
     */
    playerWeapon(player, quality = null) {
        const W = Duels.config().weapons;
        const inv = (player && player.inventory) || {};
        const eq = player && player.equipped && player.equipped.weapon;
        let pick = null;
        if (eq && W[eq] && (inv[eq] > 0 || !(eq in inv))) pick = { id: eq, ...W[eq] };
        if (!pick) {
            for (const [id, w] of Object.entries(W)) {
                if (id === 'fists' || !(inv[id] > 0)) continue;
                if (!pick || _num(w.rank) > _num(pick.rank)) pick = { id, ...w };
            }
        }
        if (!pick) return { id: 'fists', ...(W.fists || DEFAULTS.weapons.fists), quality: 1 };
        const q = Duels._quality(quality, pick.id);
        return { ...pick, dmg: _num(pick.dmg) * q, attack: _num(pick.attack) > 0 ? _num(pick.attack) * q : _num(pick.attack), quality: q };
    },

    /** A crafted item's quality multiplier from the map the player layer passes (1 if none). */
    _quality(quality, id) {
        const q = quality && quality[id];
        return typeof q === 'number' && Number.isFinite(q) && q > 0 ? q : 1;
    },

    /** The shield the player carries, or null (its guard scaled by crafted quality). */
    playerShield(player, quality = null) {
        const inv = (player && player.inventory) || {};
        for (const [id, s] of Object.entries(Duels.config().shields)) {
            if (inv[id] > 0) {
                const q = Duels._quality(quality, id);
                return { id, ...s, guard: _num(s.guard) * q, quality: q };
            }
        }
        return null;
    },

    /** Share of each blow the player's armour stops (0..maxArmour); crafted armour by its quality. */
    playerArmour(player, extraReduction = 0, quality = null) {
        const C = Duels.config();
        if (player && player.blessings && player.blessings.protection > 0) return C.maxArmour;
        const inv = (player && player.inventory) || {};
        let keep = 1;
        for (const [id, red] of Object.entries(C.armour)) {
            if (inv[id] > 0) keep *= 1 - _clamp(_num(red) * Duels._quality(quality, id), 0, 0.9);
        }
        keep *= 1 - _clamp(_num(extraReduction), 0, 0.9);
        return _clamp(1 - keep, 0, C.maxArmour);
    },

    /**
     * The player as a combatant. opts.mods = { attackMult, damageReduction, quality }
     * from the player layer (mood, carried treasures); opts.fresh ignores
     * current health (a blunted sparring bout).
     */
    fromPlayer(player, opts = {}) {
        const mods = opts.mods || {};
        const skill = _num(player.skills && player.skills.combat, 1) || 1;
        const str = _num(player.strength, 5);
        const luck = _num(player.luck, 5);
        const weapon = Duels.playerWeapon(player, mods.quality);
        const shield = Duels.playerShield(player, mods.quality);
        const traitMult = Math.max(0.5, 1 + _num(Traits.effect(player, 'battlePower')));
        const ail = Ailments.battleMultiplier(player);
        const mult = traitMult * ail * _num(mods.attackMult, 1);
        const energy = player.needsEnabled && player.needs ? _clamp(_num(player.needs.energy, 100) / 100, 0, 1) : 1;
        const lame = Traits.has(player, 'lame') ? 1 : 0;
        const maxHp = Math.round(20 + str + skill * 1.5);
        const maxHealth = Math.max(1, _num(player.maxHealth, 100));
        const healthFrac = opts.fresh ? 1 : _clamp(_num(player.health, maxHealth) / maxHealth, 0, 1);
        const maxStamina = Math.max(4, Math.round(8 + str * 0.4 + 4 * energy - lame));
        return Duels.fromProfile({
            id: 'player',
            kind: 'player',
            name: player.name || 'You',
            icon: '🧑',
            attack: (skill + (str - 5) * 0.3 + (luck - 5) * 0.1 + _num(weapon.attack)) * mult,
            defense: (skill * 0.7 + luck * 0.15 + (shield ? _num(shield.guard) : 0) - lame * 0.5) * ail,
            power: (4 + str * 0.6 + _num(weapon.dmg)) * mult,
            armour: Duels.playerArmour(player, mods.damageReduction, mods.quality),
            riposte: shield ? _num(shield.riposte) : 0,
            weapon: weapon.name,
            weaponDmg: _num(weapon.dmg),
            shield: shield ? shield.name : null,
            temperament: 'balanced',
            hp: maxHp,
            hpNow: Math.round(maxHp * (0.5 + 0.5 * healthFrac)),
            stamina: maxStamina,
            staminaNow: maxStamina - _num(opts.staminaLoss),
            skill,
            ref: player,
        });
    },

    /**
     * A rival adventurer as a combatant. opts: { archetype (its data, for
     * duelist flair), faith (roll edge), retainers (ambush help) }.
     */
    fromRival(rival, opts = {}) {
        const s = rival.stats || {};
        const prowess = _num(s.prowess, 5);
        const cunning = _num(s.cunning, 5);
        const level = _num(rival.level, 1);
        const C = Duels.config();
        let temperament = C.rivalTemperaments[rival.archetype];
        if (!temperament) temperament = cunning >= 7 ? 'tricky' : prowess >= 7 ? 'aggressive' : 'balanced';
        const help = _num(opts.retainers);
        return Duels.fromProfile({
            id: rival.id,
            kind: 'rival',
            name: rival.name,
            icon: rival.icon || '🧭',
            attack: prowess * 0.8 + level * 0.3 + cunning * 0.2 + _num(opts.faith) + help,
            defense: prowess * 0.5 + cunning * 0.35 + help * 0.5,
            power: 6 + prowess * 0.7,
            armour: 0.1,
            weapon: (opts.archetype && opts.archetype.duelist) ? 'a duelling rapier' : 'a sword',
            weaponDmg: 2,
            temperament,
            hp: 20 + prowess * 1.6 + level,
            stamina: 8 + prowess * 0.5,
            skill: prowess,
            ref: rival,
        });
    },

    /** Temperament from a townsperson's personality traits. */
    npcTemperament(npc) {
        const map = Duels.config().folkTemperaments;
        for (const t of (npc && npc.personalityTraits) || []) {
            if (map[t]) return map[t];
        }
        return 'balanced';
    },

    /** An inner-map NPC as a combatant (profile by type). opts.hpNow: carried injury. */
    fromNpc(npc, opts = {}) {
        const C = Duels.config();
        const prof = C.npcs[npc && npc.type] || C.npcs.villager || DEFAULTS.npcs.villager;
        return Duels.fromProfile({
            ...prof,
            id: npc && npc.id != null ? `npc_${npc.id}` : 'npc',
            kind: 'npc',
            name: (npc && (npc.fullName || npc.name)) || 'Stranger',
            icon: (npc && npc.icon) || '🧍',
            temperament: Duels.npcTemperament(npc),
            hpNow: opts.hpNow,
            ref: npc || null,
        });
    },

    /** The trainer at a settlement's practice yard. */
    trainer(settlement) {
        const T = Duels.config().trainers;
        const key = settlement && settlement.type === 'capital' ? 'capital' : 'town';
        const prof = T[key] || { name: key === 'capital' ? 'Royal Swordmaster' : 'Militia Sergeant', attack: 4, defense: 4, power: 6, hp: 28, stamina: 12 };
        return Duels.fromProfile({ ...prof, id: `trainer_${key}`, kind: 'trainer' });
    },

    // ──────────── THE DUEL ────────────

    /** Start a duel between `a` (usually the player) and `b`. */
    create(a, b, opts = {}) {
        const modeId = opts.mode || 'firstBlood';
        const mode = Duels.mode(modeId);
        return {
            a, b,
            mode: modeId,
            maxRounds: Math.max(1, Math.round(_num(opts.rounds, mode.rounds || 12))),
            canYield: mode.yield !== false,
            aiYieldAt: _num(mode.aiYieldAt),
            round: 0,
            over: false,
            winner: null,
            draw: false,
            yielded: null,
            opening: { a: 0, b: 0 },
            history: { a: [], b: [] },
            log: [],
            startHp: { a: a.hp, b: b.hp },
        };
    },

    /** The AI's (or autopilot's) move for side 'a' or 'b'. */
    aiMove(state, side, rng = () => Utils.random()) {
        const me = state[side];
        const other = side === 'a' ? 'b' : 'a';
        const T = Duels.temperament(me.temperament);
        const C = Duels.config();
        // Beaten and allowed to stop: some temperaments yield
        if (state.canYield && side === 'b' && state.aiYieldAt > 0 && me.hp / me.maxHp <= state.aiYieldAt
            && rng() < _num(T.yield)) {
            return 'yield';
        }
        // Read the opponent's habit and counter it
        const seen = state.history[other];
        const read = _clamp(_num(T.read) + (me.kind === 'player' ? 0.15 + me.skill * 0.04 : me.skill * 0.015), 0, 0.85);
        if (seen.length >= 2 && rng() < read) {
            const counts = {};
            for (const m of seen.slice(-4)) counts[m] = (counts[m] || 0) + 1;
            const habit = Object.entries(counts).sort((x, y) => y[1] - x[1])[0][0];
            const counter = Duels.counterTo(habit);
            if (me.stamina >= _num(C.moves[counter] && C.moves[counter].cost) || counter === 'guard') return counter;
        }
        const w = { ...T.weights };
        for (const id of MOVE_IDS) {
            const cost = _num(C.moves[id] && C.moves[id].cost);
            if (cost > 0 && me.stamina < cost) w[id] = _num(w[id]) * 0.25;
        }
        if (me.stamina <= 2) w.guard = _num(w.guard) * 3;
        return _weighted(w, rng);
    },

    _hitChance(att, def, bonus = 0) {
        const H = Duels.config().hit;
        return _clamp(H.base + (att - def) * H.perPoint + bonus, H.min, H.max);
    },

    _effAttack(state, side) {
        const c = state[side];
        const C = Duels.config();
        let att = c.attack + _num(state.opening[side]);
        if (c._tired) att -= C.tiredPenalty;
        if (c.stamina <= 0) att -= C.exhaustedPenalty;
        return att;
    },

    _effDefense(state, side) {
        const c = state[side];
        return c.defense - (c.stamina <= 0 ? Duels.config().exhaustedPenalty : 0);
    },

    /** Try to land a blow from side `from`; returns damage dealt (0 on a miss). */
    _blow(state, from, moveId, mult, bonus, rng, entry) {
        const to = from === 'a' ? 'b' : 'a';
        const att = state[from];
        const def = state[to];
        const chance = Duels._hitChance(Duels._effAttack(state, from), Duels._effDefense(state, to), bonus);
        if (!(rng() < chance)) {
            entry.notes.push(_fill(Duels.config().lines.miss || '{b} twists away.', { a: att.name, b: def.name }));
            return 0;
        }
        const move = Duels.move(moveId) || { dmg: 1 };
        const variance = 0.85 + rng() * 0.3;
        const raw = att.power * _num(move.dmg, 1) * mult * variance;
        const dmg = Math.max(1, Math.round(raw * (1 - def.armour)));
        def.hp = Math.max(0, def.hp - dmg);
        entry[from === 'a' ? 'dmgToB' : 'dmgToA'] += dmg;
        return dmg;
    },

    /**
     * Play one exchange. aMove: the player's move ('yield' allowed); bMove
     * defaults to the AI's choice. Returns the log entry.
     */
    exchange(state, aMove, opts = {}) {
        if (state.over) return null;
        const rng = _rngOf(opts);
        const C = Duels.config();
        const bMove = opts.bMove || Duels.aiMove(state, 'b', rng);
        state.round++;
        const entry = { round: state.round, aMove, bMove, dmgToA: 0, dmgToB: 0, text: '', notes: [] };
        const names = { a: state.a.name, b: state.b.name };

        // Yielding ends it at once
        if (aMove === 'yield' || bMove === 'yield') {
            const side = aMove === 'yield' ? 'a' : 'b';
            if (state.canYield || side === 'a') {
                entry.text = _fill(C.lines.yield || '{a} yields.', { a: names[side] });
                state.log.push(entry);
                Duels._finish(state, side === 'a' ? 'b' : 'a', side);
                return entry;
            }
        }
        const moves = { a: MOVE_IDS.includes(aMove) ? aMove : 'guard', b: MOVE_IDS.includes(bMove) ? bMove : 'guard' };
        entry.aMove = moves.a;
        entry.bMove = moves.b;

        // Breath: pay for the move (Guard recovers); a blown fighter's move comes slow
        for (const side of ['a', 'b']) {
            const c = state[side];
            const cost = _num(C.moves[moves[side]].cost);
            c._tired = cost > 0 && c.stamina < cost;
            c.stamina = _clamp(c.stamina - cost, 0, c.maxStamina);
            if (c._tired) entry.notes.push(_fill(C.lines.tired || '{a} is blown.', { a: c.name }));
            state.history[side].push(moves[side]);
        }
        const opening = { ...state.opening };
        state.opening = { a: 0, b: 0 };

        const beats = C.beats;
        const winSide = beats[moves.a] === moves.b ? 'a' : beats[moves.b] === moves.a ? 'b' : null;
        if (winSide) {
            const lose = winSide === 'a' ? 'b' : 'a';
            const wm = moves[winSide];
            const lm = moves[lose];
            const key = `${wm}>${lm}`;
            entry.text = _fill(C.lines[key] || `{a}'s ${wm} beats {b}'s ${lm}.`, { a: names[winSide], b: names[lose] });
            if (wm === 'guard') {
                // A turned strike: riposte (better with a shield) and the striker is winded
                state[lose].stamina = Math.max(0, state[lose].stamina - 1);
                Duels._blow(state, winSide, 'guard', 1 + _num(state[winSide].riposte), C.hit.cleanBonus, rng, entry);
            } else if (wm === 'feint') {
                const mv = C.moves.feint;
                state[lose].stamina = Math.max(0, state[lose].stamina - _num(mv.drain, 3));
                Duels._blow(state, winSide, 'feint', 1, C.hit.cleanBonus, rng, entry);
                state.opening[winSide] = _num(mv.opening, 1.5);
            } else {
                Duels._blow(state, winSide, wm, 1, C.hit.cleanBonus + _num(opening[winSide]) * 0.02, rng, entry);
            }
        } else if (moves.a === moves.b) {
            const m = moves.a;
            entry.text = _fill(C.lines[`${m}=${m}`] || 'The fighters trade.', { a: names.a, b: names.b });
            if (m === 'strike' || m === 'thrust') {
                Duels._blow(state, 'a', m, 0.7, 0, rng, entry);
                Duels._blow(state, 'b', m, 0.7, 0, rng, entry);
            } else if (m === 'guard') {
                state.a.stamina = Math.min(state.a.maxStamina, state.a.stamina + 1);
                state.b.stamina = Math.min(state.b.maxStamina, state.b.stamina + 1);
            }
        } else {
            // Contested: Strike~Feint or Thrust~Guard — a roll of skill decides
            const attSide = (moves.a === 'strike' || moves.a === 'thrust') && moves.b !== 'strike' ? 'a' : 'b';
            const defSide = attSide === 'a' ? 'b' : 'a';
            const key = `${moves[attSide]}~${moves[defSide]}`;
            entry.text = _fill(C.lines[key] || 'Steel scrapes on steel.', { a: names[attSide], b: names[defSide] });
            const atRoll = Duels._effAttack(state, attSide) + rng() * 6;
            const defStat = moves[defSide] === 'guard' ? Duels._effDefense(state, defSide) + 1 : Duels._effAttack(state, defSide);
            const dfRoll = defStat + rng() * 6;
            if (atRoll >= dfRoll) {
                Duels._blow(state, attSide, moves[attSide], 0.6, 0, rng, entry);
            } else if (moves[defSide] === 'guard') {
                state[attSide].stamina = Math.max(0, state[attSide].stamina - 1);
            } else {
                Duels._blow(state, defSide, moves[defSide], 0.8, 0, rng, entry);
            }
        }
        // A breath between exchanges
        for (const side of ['a', 'b']) {
            const c = state[side];
            if (moves[side] !== 'guard') c.stamina = Math.min(c.maxStamina, c.stamina + _num(C.regen, 1));
            c._tired = false;
        }
        if (entry.dmgToB) entry.notes.push(_fill(C.lines.hit || '{b} takes it ({dmg}).', { b: names.b, dmg: entry.dmgToB }));
        if (entry.dmgToA) entry.notes.push(_fill(C.lines.hit || '{b} takes it ({dmg}).', { b: names.a, dmg: entry.dmgToA }));
        state.log.push(entry);

        if (state.a.hp <= 0 || state.b.hp <= 0) {
            const winner = state.a.hp <= 0 && state.b.hp <= 0
                ? (state.a.hp / state.a.maxHp >= state.b.hp / state.b.maxHp ? 'a' : 'b')
                : state.a.hp <= 0 ? 'b' : 'a';
            Duels._finish(state, winner, null);
        } else if (state.round >= state.maxRounds) {
            const fa = state.a.hp / state.a.maxHp;
            const fb = state.b.hp / state.b.maxHp;
            if (Math.abs(fa - fb) < 0.02 && state.mode === 'spar') Duels._finish(state, null, null, true);
            else if (Math.abs(fa - fb) < 1e-9) Duels._finish(state, rng() < 0.5 ? 'a' : 'b', null);
            else Duels._finish(state, fa > fb ? 'a' : 'b', null);
        }
        return entry;
    },

    _finish(state, winner, yielded, draw = false) {
        state.over = true;
        state.winner = winner;
        state.yielded = yielded;
        state.draw = !!draw;
    },

    /** Summary of a finished (or abandoned) duel. */
    result(state) {
        const lost = (side) => {
            const start = Math.max(1, state.startHp[side]);
            return _clamp((start - state[side].hp) / state[side].maxHp, 0, 1);
        };
        return {
            mode: state.mode,
            winner: state.winner,
            draw: state.draw,
            playerWon: state.winner === 'a',
            yielded: state.yielded,
            rounds: state.round,
            aLost: lost('a'),
            bLost: lost('b'),
            aHp: state.a.hp, bHp: state.b.hp,
            dealt: state.log.reduce((t, e) => t + e.dmgToB, 0),
            taken: state.log.reduce((t, e) => t + e.dmgToA, 0),
            log: state.log,
            a: state.a, b: state.b,
        };
    },

    /** Fight the whole duel without input: the player's side plays by instinct. */
    autoResolve(a, b, opts = {}) {
        const rng = _rngOf(opts);
        const state = Duels.create(a, b, opts);
        let guard = 0;
        while (!state.over && guard++ < 200) {
            let aMove = Duels.aiMove(state, 'a', rng);
            // The instinct policy yields a hopeless non-lethal bout
            if (state.canYield && opts.playerYieldAt && a.hp / a.maxHp <= opts.playerYieldAt) aMove = 'yield';
            Duels.exchange(state, aMove, { rng });
        }
        if (!state.over) Duels._finish(state, a.hp / a.maxHp >= b.hp / b.maxHp ? 'a' : 'b', null);
        return Duels.result(state);
    },

    /** Finish an interactive duel by instinct from where it stands. */
    autoFinish(state, opts = {}) {
        const rng = _rngOf(opts);
        let guard = 0;
        while (!state.over && guard++ < 200) Duels.exchange(state, Duels.aiMove(state, 'a', rng), { rng });
        if (!state.over) Duels._finish(state, state.a.hp >= state.b.hp ? 'a' : 'b', null);
        return Duels.result(state);
    },

    /** Real harm from a share of the bout pool lost: lerp over [min, max]. */
    harm(lostFrac, range) {
        const [lo, hi] = Array.isArray(range) ? range : [range, range];
        return Math.round(lo + (hi - lo) * _clamp(_num(lostFrac), 0, 1));
    },

    // ──────────── TOURNAMENTS ────────────

    /**
     * The three-bout bracket at a settlement: `entrants` are combatants who
     * enter by name (rivals), the rest are knights drawn from the tiers.
     * Sorted weakest-first: the opening bout, the semi-final, the final.
     */
    tournamentField(settlement, entrants = [], opts = {}) {
        const rng = _rngOf(opts);
        const T = Duels.config().tournament;
        const tiers = T.tiers && T.tiers.length ? T.tiers : DEFAULTS.tournament.tiers;
        const field = [];
        const used = new Set();
        for (let i = 0; i < 3; i++) {
            const tier = tiers[Math.min(i, tiers.length - 1)];
            let first = 'Aldric';
            for (let k = 0; k < 6; k++) {
                first = T.firstNames[Math.floor(rng() * T.firstNames.length)];
                if (!used.has(first)) break;
            }
            used.add(first);
            const epithet = T.epithets[Math.floor(rng() * T.epithets.length)];
            const temperament = ['aggressive', 'cautious', 'tricky', 'balanced'][Math.floor(rng() * 4)];
            field.push(Duels.fromProfile({
                id: `knight_${i}`,
                kind: 'knight',
                name: `Ser ${first} ${epithet}`,
                title: tier.title,
                icon: '🛡️',
                attack: _between(tier.attack, rng),
                defense: _between(tier.defense, rng),
                power: _between(tier.power, rng),
                hp: _between(tier.hp, rng),
                stamina: _between(tier.stamina, rng),
                armour: 0.15,
                weapon: 'a blunted lance-sword',
                temperament,
                skill: 3 + i * 2,
            }));
            field[i].title = tier.title;
        }
        // Named entrants take the places of the lesser knights
        const named = entrants.slice(0, 2);
        for (let i = 0; i < named.length; i++) {
            named[i].title = named[i].title || 'Rival';
            field[i] = named[i];
        }
        const strength = (c) => c.attack + c.defense * 0.6 + c.power * 0.3 + c.maxHp * 0.05;
        return field.sort((x, y) => strength(x) - strength(y));
    },

    /**
     * Apply a tournament's outcome to the player. bouts: [{ opponent, result }]
     * in order (the bracket stops at the first loss). Returns
     * { wins, champion, finalist, gold, renown, harm, wounds, skillUp, lines }.
     * opts: { prizePool, armour (0..1, the player's), world, rng }.
     */
    settleTournament(player, opts = {}) {
        const rng = _rngOf(opts);
        const T = Duels.config().tournament;
        const bouts = opts.bouts || [];
        const wins = bouts.filter(b => b.result && b.result.playerWon).length;
        const champion = bouts.length >= 3 && wins === 3;
        const finalist = !champion && wins === 2;
        const prize = _num(opts.prizePool);
        const out = { wins, champion, finalist, gold: 0, renown: 0, harm: 0, wounds: [], skillUp: false };
        out.renown = wins * _num(T.renownPerWin, 2) + (champion ? _num(T.championRenown, 5) : 0);
        if (champion) out.gold = prize;
        else if (finalist) out.gold = Math.floor(prize * _num(T.runnerUpShare, 0.4));
        const protectedNow = !!(player.blessings && player.blessings.protection > 0);
        for (const b of bouts) {
            const r = b.result;
            if (!r) continue;
            const raw = Duels.harm(r.aLost, T.harm);
            const dealt = protectedNow ? 0 : Math.max(0, Math.round(raw * (1 - _clamp(_num(opts.armour), 0, 0.9))));
            out.harm += dealt;
            if (!r.playerWon && !protectedNow) {
                const wound = Ailments.maybeWound(player, opts.world || null, 'duel', { chanceMult: 0.5 + r.aLost });
                if (wound) out.wounds.push(wound);
            }
        }
        player.gold = _num(player.gold) + out.gold;
        player.renown = _num(player.renown) + out.renown;
        player.health = Math.max(1, _num(player.health, 1) - out.harm);
        if (out.gold && player.financeToday) {
            player.financeToday.income = player.financeToday.income || {};
            player.financeToday.income.tournament = (player.financeToday.income.tournament || 0) + out.gold;
        }
        if (player.skills && rng() < _num(T.skillUpBase, 0.2) + wins * _num(T.skillUpPerWin, 0.1)) {
            player.skills.combat = Math.min(10, (player.skills.combat || 1) + 1);
            out.skillUp = true;
        }
        return out;
    },

    // ──────────── BRAWLS (the inner map) ────────────

    /**
     * Base damage of one real-time inner-map swing by a combatant: strength
     * and the weapon (which counts double), times the combatant's own
     * multipliers (traits, wounds, mood, treasures) folded into its power.
     */
    swingBase(c) {
        const B = Duels.config().brawl;
        const player = c.kind === 'player' ? c.ref : null;
        const str = player ? _num(player.strength, 5) : Math.max(1, (c.power - 4 - c.weaponDmg) / 0.6);
        const baseline = 4 + str * 0.6 + c.weaponDmg;
        const mult = baseline > 0 ? c.power / baseline : 1;
        const base = (_num(B.base, 2) + str * _num(B.perStrength, 1.2) + c.weaponDmg * _num(B.perWeaponDmg, 2)) * mult;
        return Math.max(_num(B.minDamage, 3), Math.round(base));
    },

    /**
     * One inner-map counter-blow by a townsperson, before the player's armour:
     * the swing of their duel profile (data/duels.json npcs.*) scaled to the
     * inner map's health numbers (brawl.npcHitScale). `rng` adds ±25%.
     */
    npcSwing(npc, rng = () => Utils.random()) {
        const B = Duels.config().brawl;
        const base = Duels.swingBase(Duels.fromNpc(npc)) * _num(B.npcHitScale, 1.6);
        return Math.max(1, Math.round(base * (0.75 + rng() * 0.5)));
    },

    /**
     * Does an attacked townsperson stand and fight, or run? From their duel
     * profile (attack + defence), their temperament (folkTemperaments: the
     * bold stand, the cautious run), how dangerous the player looks
     * (opts.playerAttack, a combatant's attack) and how hurt they already are
     * (opts.hpFrac). Returns { stance: 'fight' | 'flee', score, need }.
     */
    brawlStance(npc, opts = {}) {
        const B = Duels.config().brawl;
        const S = { ...DEFAULTS.brawl.stance, ...(_obj(B.stance) || {}) };
        const c = Duels.fromNpc(npc);
        const temps = { ...DEFAULTS.brawl.stance.temperament, ...(_obj(S.temperament) || {}) };
        let score = c.attack + c.defense + _num(temps[c.temperament]);
        score -= Math.max(0, _num(opts.playerAttack) - _num(S.playerAttackFree, 4)) * _num(S.perPlayerAttack, 0.5);
        const need = _num(S.fightAt, 5);
        const hurt = opts.hpFrac != null && _num(opts.hpFrac, 1) < _num(S.fleeBelowHp, 0.35) && c.temperament !== 'aggressive';
        return { stance: !hurt && score >= need ? 'fight' : 'flee', score: Math.round(score * 10) / 10, need, temperament: c.temperament };
    },

    /** An NPC's hit points for a brawl, from its profile (scaled to the inner map's numbers). */
    npcBrawlHp(npc) {
        const c = Duels.fromNpc(npc);
        return Math.round(c.maxHp * 3.5);
    },

    /** Items an NPC carries that a victor can take: [{ id, qty }] from its wares. */
    brawlSpoils(npc, rng = () => Utils.random()) {
        const B = Duels.config().brawl;
        const wares = npc && npc.shopInventory ? Object.entries(npc.shopInventory).filter(([, v]) => v && v.qty > 0) : [];
        if (!wares.length) return [];
        const [lo, hi] = Array.isArray(B.itemsTaken) ? B.itemsTaken : [1, 2];
        const n = Math.min(wares.length, lo + Math.floor(rng() * (hi - lo + 1)));
        const out = [];
        const pool = wares.slice();
        for (let i = 0; i < n && pool.length; i++) {
            const [id, v] = pool.splice(Math.floor(rng() * pool.length), 1)[0];
            const qty = Math.max(1, Math.ceil(v.qty / 2));
            out.push({ id, qty });
        }
        return out;
    },

    /** The purse range [lo, hi] an NPC type carries. */
    purseRange(type) {
        const p = Duels.config().brawl.purse || {};
        return p[type] || p.villager || [2, 12];
    },
};
