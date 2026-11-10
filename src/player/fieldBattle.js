// ============================================
// FIELD BATTLE — a battle fought in three phases, with a stance for each
// ============================================
// The player's own battles (attacking a unit on the road, standing to fight
// a hostile that closes in) are not one roll but three phases:
//
//   OPENING   the skirmish: archers and the weather matter most
//   MELEE     the lines meet: pikes, counters and morale decide it
//   PURSUIT   one side gives way: horse rides the beaten down
//
// Before each phase the player picks a stance — Aggressive, Hold the line,
// Feigned retreat (needs horse or a practised commander) or Commit reserves
// (once a battle) — and between phases may Withdraw at a reduced cost. Every
// phase reuses the one-shot battle's multipliers (counters, terrain, weather,
// morale from leadership and the real force ratio, traits, artifacts, techs,
// unit specials) and takes casualties from the phase's force ratio, not a
// flat share: a close fight bleeds both sides, a lopsided one breaks the
// weaker. A side that falls under `rout.strengthShare` of its starting
// strength, or whose morale breaks, routs and the battle ends.
//
// The one-shot PlayerMilitary.combat stays the API of AI/auto paths, sieges,
// the playtest bot and the headless encounter; this is a layer over it that
// shares its aftermath (PlayerMilitary._applyCasualties / _battleSpoils) and,
// for a world unit, its consequences (PlayerMilitary.attackUnit with a
// precomputed combatResult). auto() fights a battle through with the default
// stances. estimate() shows the odds of a stance before the player commits:
// a Monte Carlo of the rest of the battle on its own seeded stream, so it
// never moves the game's dice.
//
// Pure domain logic: explicit params, Utils RNG, no DOM. A battle in progress
// is a plain object the caller keeps (the UI holds it on the game).
// Tuning: data/military.json → fieldBattle.

import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { Difficulty } from '../core/difficulty.js';
import { PlayerMilitary } from './playerMilitary.js';
import { PlayerEffects } from './playerEffects.js';
import { Technology } from '../systems/technology.js';
import { Housing } from '../systems/housing.js';
import { Culture } from '../systems/culture.js';
import { Traits } from '../systems/traits.js';
import { Companions } from '../systems/companions.js';
import { HeirAgency } from '../systems/heirAgency.js';
import { Ledger } from '../systems/ledger.js';
import { CombatSkills } from '../systems/combatSkills.js';
import { Duels } from '../systems/duels.js';
import { Arms } from '../systems/arms.js';

const DEFAULTS = {
    phases: [
        { id: 'opening', name: 'Opening skirmish', icon: '🏹', lossBase: 0.05, score: 0.25, counterWeight: 0.5, weights: { archer: 0.35, cavalry: 0.05, pikeman: 0 } },
        { id: 'melee', name: 'Melee', icon: '⚔️', lossBase: 0.12, score: 0.5, counterWeight: 1, weights: { archer: 0, cavalry: 0.1, pikeman: 0.25 } },
        { id: 'pursuit', name: 'Pursuit', icon: '🐎', lossBase: 0.08, score: 0.25, counterWeight: 0.5, weights: { archer: 0.1, cavalry: 0.45, pikeman: 0 } },
    ],
    stances: {
        aggressive: { name: 'Aggressive', icon: '🔥', power: 1.1, ownLoss: 1.3, enemyLoss: 1.2, text: 'Press hard: more blows struck and taken.' },
        hold: { name: 'Hold the line', icon: '🛡️', power: 0.9, ownLoss: 0.7, enemyLoss: 0.85, pikemanPower: 0.25, defendingPower: 0.1, text: 'Shields locked: fewer losses; pikemen and defenders stand firmer.' },
        feint: { name: 'Feigned retreat', icon: '🎭', power: 1, ownLoss: 0.9, enemyLoss: 1.1, needsCavalry: 0.15, needsLeadership: 5, successBase: 0.3, perLeadership: 0.04, perCavalry: 0.6, successMax: 0.85, successEnemyPower: 0.65, successEnemyLoss: 1.5, failPower: 0.75, failOwnLoss: 1.3, text: 'Fall back to draw them out, then turn on them.' },
        reserves: { name: 'Commit reserves', icon: '🐎', power: 1.25, cavalryPower: 0.4, ownLoss: 1, enemyLoss: 1.2, fatigue: 0.9, text: 'Throw in the reserve and the horse at once. Once per battle.' },
    },
    defaultStances: { opening: 'hold', melee: 'aggressive', pursuit: 'reserves' },
    rollSpread: 0.15,
    fortuneSpread: 0.25,
    ambushPower: 1.15,
    rout: { strengthShare: 0.45, lossMult: 1.6, winnerLossMult: 0.5 },
    commanderSlainPower: 0.8,
    withdraw: { lossShare: 0.06, enemyCavalry: 0.5, ownCavalry: 0.5, cowardiceRatio: 1.2, spareDays: 3 },
    estimateRuns: 150,
};

function _merge(base, over) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
        if (k.startsWith('_')) continue;
        out[k] = (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]))
            ? _merge(base[k], v) : v;
    }
    return out;
}

let _cfgCache = null;
let _cfgSource = null;
let _battleSeq = 0;

const _r2 = (v) => Math.round(v * 100) / 100;
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const FieldBattle = {
    DEFAULTS,

    /** Tuning: the defaults with data/military.json → fieldBattle laid over them. */
    config() {
        const src = DataLoader.military && DataLoader.military.fieldBattle;
        if (!_cfgCache || _cfgSource !== src) {
            _cfgCache = _merge(DEFAULTS, src || {});
            _cfgSource = src;
        }
        return _cfgCache;
    },

    phaseDef(index) {
        return FieldBattle.config().phases[index] || null;
    },

    /**
     * Draw up a battle against `enemy` = { strength, name, type?, unitId?,
     * composition? }. ctx: { terrainId, theatre, defending, ambushed, weather,
     * enemyMoraleBonus }. Draws from Utils only for unit specials (assassins).
     * Returns the battle, or { success:false, reason } with nothing to fight with.
     */
    start(player, enemy, world, ctx = {}) {
        const theatre = ctx.theatre || 'land';
        const parts = PlayerMilitary.getTheatreStrengthBreakdown(player, theatre);
        if (parts.total <= 0) {
            const onlyShips = theatre === 'land' && (player.army || []).length > 0
                && (player.army || []).every(u => PlayerMilitary.isNavalUnit(u));
            return { success: false, reason: onlyShips ? 'Your war galleys cannot fight on land — recruit soldiers.' : 'No army to fight with!' };
        }
        const cfg = FieldBattle.config();
        const enemyStrength = Math.max(1, enemy.strength || 1);
        const enemyName = enemy.name || 'Bandits';
        const context = { ...ctx, theatre, world };
        const terrainId = ctx.terrainId || null;
        const pComp = PlayerMilitary.getArmyComposition(player);
        const eComp = PlayerMilitary.inferEnemyComposition(enemyStrength, enemyName,
            enemy.composition ? { enemyComposition: enemy.composition } : {});
        const weather = PlayerMilitary._battleWeather(player, context);

        // The commander's spirit: leadership, a festival, theatres owned, events, the Sword
        const festival = (player.festivals?.moraleBoostDays > 0) ? (player.festivals?.moraleBoostValue || 0) : 0;
        const leadership = (player.skills?.leadership || 1) * 0.015 + festival
            + Culture.getMoraleBonus(player, world)
            + PlayerMilitary._worldEventMorale(player, context)
            + PlayerEffects.artifactBonus(player, 'moraleBonus');

        // Everything about the player's side that does not change mid-battle
        let pMult = PlayerMilitary._terrainMultiplier(terrainId, pComp) * PlayerMilitary._weatherMultiplier(weather, pComp);
        pMult *= 1 + PlayerEffects.companionBonus(player, 'power');
        pMult *= 1 + PlayerEffects.artifactBonus(player, 'battlePower');
        pMult *= 1 + PlayerEffects.treasureBonus(player, 'battlePower');
        pMult *= PlayerEffects.moodCombatMultiplier(player);
        pMult *= PlayerEffects.faithBattleMultiplier(player);
        pMult *= PlayerEffects.traitBattleMultiplier(player);
        // A child of the House commanding the company — or a regent's captains (systems/heirAgency.js)
        pMult *= HeirAgency.commandMultiplier(player);
        pMult *= PlayerEffects.ailmentBattleMultiplier(player);
        if (ctx.defending) pMult *= 1 + Technology.getDefenseBonus(player);
        if (ctx.defending) pMult *= 1 + Housing.getTotalBonuses(player).defense / 100;
        let eMult = PlayerMilitary._terrainMultiplier(terrainId, eComp) * PlayerMilitary._weatherMultiplier(weather, eComp);

        const specials = PlayerMilitary.getBattleSpecials(player, context, pComp, eComp);
        pMult *= specials.playerMult;
        eMult *= specials.enemyMult;
        if (specials.commanderSlain) eMult *= cfg.commanderSlainPower;
        eMult *= Difficulty.mult(player, 'enemyStrength'); // the difficulty (1 on Normal)

        let pCasMult = Math.max(0, 1 - Technology.getEffectTotal(player, 'battleCasualtyReduction'));
        pCasMult *= PlayerEffects.casualtyMultiplier(player);
        pCasMult *= specials.casualtyMult;

        _battleSeq++;
        return {
            id: `fb${(world && world.day) || 0}_${_battleSeq}`,
            seed: (Math.abs(Utils.hashStr(`${enemyName}:${enemyStrength}:${(world && world.day) || 0}:${parts.total}`)) % 200000) + 1,
            enemyName,
            enemyType: enemy.type || null,
            enemyIcon: enemy.icon || '⚔️',
            unitId: enemy.unitId || null,
            theatre,
            terrainId,
            weather,
            defending: !!ctx.defending,
            ambushed: !!ctx.ambushed,
            pComp,
            eComp,
            leadership,
            leadershipSkill: player.skills?.leadership || 1,
            enemyMoraleBonus: (ctx.enemyMoraleBonus || 0) - (specials.commanderSlain ? 0.2 : 0),
            pMult,
            eMult,
            pCasMult,
            // Your own hand in it, by phase (systems/combatSkills.js): your bow in the opening volley, your blade in the melee
            personal: FieldBattle.personalEdge(player),
            pCounter: PlayerMilitary._counterMultiplier(pComp, eComp),
            eCounter: PlayerMilitary._counterMultiplier(eComp, pComp),
            pTerrain: PlayerMilitary._terrainMultiplier(terrainId, pComp),
            eTerrain: PlayerMilitary._terrainMultiplier(terrainId, eComp),
            commanderSlain: !!specials.commanderSlain,
            // The battle's luck: hidden from the odds, felt in every phase
            fortune: Utils.randFloat(1 - cfg.fortuneSpread, 1 + cfg.fortuneSpread),
            navalSupport: parts.naval,
            shipSupport: parts.ship,
            pStr0: parts.total,
            eStr0: enemyStrength,
            sim: { pStr: parts.total, eStr: enemyStrength, phase: 0, score: 0, reservesUsed: false, routed: null },
            log: [],
            casualties: 0,
            wounded: 0,
            outcome: null, // 'victory' | 'defeat' | 'withdrew'
            done: false,
            result: null,
        };
    },

    /**
     * The commander's own hand by phase: { opening, melee, pursuit } multipliers.
     * A bow carried adds your Archery draw (× volleyWeight) to the opening;
     * your level in what you fight with adds meleePerLevel a level over 1 to
     * the melee (half that to the pursuit). All 1 for a beginner.
     */
    personalEdge(player) {
        const out = { opening: 1, melee: 1, pursuit: 1 };
        if (!player || !CombatSkills.has('blades')) return out;
        const F = { volleyWeight: 0.5, meleePerLevel: 0.01, ...(CombatSkills.config().field || {}) };
        const inv = player.inventory || {};
        if (inv.bow > 0) out.opening = 1 + CombatSkills.perk(player, 'archery', 'draw') / 100 * Number(F.volleyWeight);
        const sk = CombatSkills.weaponSkill(Duels.playerWeapon(player).id);
        const lv = CombatSkills.level(player, sk);
        out.melee = 1 + (lv - 1) * Number(F.meleePerLevel);
        out.pursuit = 1 + (lv - 1) * Number(F.meleePerLevel) / 2;
        return out;
    },

    /** What a fought battle taught you: Blades/Brawling, and Archery with a bow carried. → [level-up events] */
    _battleSkills(player) {
        if (!CombatSkills.has('blades')) return [];
        const out = [];
        const sk = CombatSkills.weaponSkill(Duels.playerWeapon(player).id);
        const a = CombatSkills.train(player, sk, CombatSkills.xpFor('blades', 'battle'));
        if (a) out.push(a);
        if ((player.inventory || {}).bow > 0) {
            const b = CombatSkills.trainBy(player, 'archery', 'battle');
            if (b) out.push(b);
        }
        return out;
    },

    /** The battle's current phase definition (null once it is over). */
    currentPhase(battle) {
        return battle && !battle.done ? FieldBattle.phaseDef(battle.sim.phase) : null;
    },

    /** Can the player take `stanceId` now? { can, reason } */
    stanceAllowed(battle, stanceId) {
        const st = FieldBattle.config().stances[stanceId];
        if (!st) return { can: false, reason: 'Unknown stance' };
        if (stanceId === 'reserves' && battle.sim.reservesUsed) return { can: false, reason: 'Your reserve is already committed' };
        if (stanceId === 'feint' && (battle.pComp.cavalry || 0) < st.needsCavalry && battle.leadershipSkill < st.needsLeadership) {
            return { can: false, reason: `Needs horse (${Math.round(st.needsCavalry * 100)}% cavalry) or leadership ${st.needsLeadership}` };
        }
        return { can: true, reason: '' };
    },

    /** Chance a feigned retreat draws the enemy out (0..1). */
    feintChance(battle) {
        const st = FieldBattle.config().stances.feint;
        return _clamp(st.successBase + battle.leadershipSkill * st.perLeadership + (battle.pComp.cavalry || 0) * st.perCavalry, 0, st.successMax);
    },

    /** The default stance for the battle's current phase (auto-resolve). */
    defaultStance(battle) {
        const ph = FieldBattle.currentPhase(battle);
        const want = (ph && FieldBattle.config().defaultStances[ph.id]) || 'aggressive';
        if (FieldBattle.stanceAllowed(battle, want).can) return want;
        return want === 'feint' ? 'hold' : 'aggressive';
    },

    _compWeight(comp, weights) {
        return 1 + (weights.archer || 0) * (comp.archer || 0) + (weights.cavalry || 0) * (comp.cavalry || 0) + (weights.pikeman || 0) * (comp.pikeman || 0);
    },

    /**
     * Roll one phase on the numbers in `sim` (no player state touched).
     * Returns { r, pLoss, eLoss, feint } — r is the player's share of the
     * phase's power, losses are shares of each side's current strength.
     */
    _rollPhase(battle, sim, stanceId) {
        const cfg = FieldBattle.config();
        const ph = cfg.phases[sim.phase];
        const st = cfg.stances[stanceId] || cfg.stances.aggressive;
        const pMorale = PlayerMilitary._moraleValue(sim.pStr, sim.eStr, battle.leadership);
        const eMorale = PlayerMilitary._moraleValue(sim.eStr, sim.pStr, battle.enemyMoraleBonus);
        const cw = ph.counterWeight == null ? 1 : ph.counterWeight;

        let stancePower = st.power || 1;
        if (stanceId === 'hold') stancePower += (st.pikemanPower || 0) * (battle.pComp.pikeman || 0) + (battle.defending ? (st.defendingPower || 0) : 0);
        if (stanceId === 'reserves') stancePower += (st.cavalryPower || 0) * (battle.pComp.cavalry || 0);
        if (sim.reservesUsed && stanceId !== 'reserves') stancePower *= cfg.stances.reserves.fatigue || 1;
        let ownLoss = st.ownLoss || 1;
        let enemyLoss = st.enemyLoss || 1;
        let enemyPower = 1;
        let feint = null;
        if (stanceId === 'feint') {
            feint = Utils.random() < FieldBattle.feintChance(battle);
            if (feint) { enemyPower *= st.successEnemyPower; enemyLoss *= st.successEnemyLoss; } else { stancePower *= st.failPower; ownLoss *= st.failOwnLoss; }
        }
        if (battle.ambushed && ph.id === 'opening') enemyPower *= cfg.ambushPower;

        const spread = cfg.rollSpread;
        const pPow = sim.pStr * battle.pMult * (1 + (battle.pCounter - 1) * cw) * FieldBattle._compWeight(battle.pComp, ph.weights)
            * pMorale * stancePower * (sim.fortune || battle.fortune || 1) * ((battle.personal && battle.personal[ph.id]) || 1)
            * Utils.randFloat(1 - spread, 1 + spread);
        const ePow = sim.eStr * battle.eMult * (1 + (battle.eCounter - 1) * cw) * FieldBattle._compWeight(battle.eComp, ph.weights)
            * eMorale * enemyPower * Utils.randFloat(1 - spread, 1 + spread);
        const r = pPow / Math.max(1e-6, pPow + ePow);

        let pLoss = ph.lossBase * 2 * (1 - r) * ownLoss * battle.pCasMult;
        let eLoss = ph.lossBase * 2 * r * enemyLoss;
        if (ph.id === 'pursuit') {
            if (r < 0.5) { pLoss *= cfg.rout.lossMult; eLoss *= cfg.rout.winnerLossMult; } else { eLoss *= cfg.rout.lossMult; pLoss *= cfg.rout.winnerLossMult; }
        }
        return { r, pLoss: _clamp(pLoss, 0, 0.9), eLoss: _clamp(eLoss, 0, 0.9), feint, pMorale, eMorale };
    },

    /** After a phase's losses: does a side rout? 'enemy' | 'player' | null. */
    _routCheck(battle, sim, r) {
        const cfg = FieldBattle.config();
        if (sim.eStr <= battle.eStr0 * cfg.rout.strengthShare) return 'enemy';
        if (sim.pStr <= battle.pStr0 * cfg.rout.strengthShare) return 'player';
        if (r >= 0.5) {
            const eMorale = PlayerMilitary._moraleValue(sim.eStr, sim.pStr, battle.enemyMoraleBonus);
            if (PlayerMilitary._checkMoraleBreak(sim.eStr, sim.pStr, eMorale)) return 'enemy';
        } else {
            const pMorale = PlayerMilitary._moraleValue(sim.pStr, sim.eStr, battle.leadership);
            if (PlayerMilitary._checkMoraleBreak(sim.pStr, sim.eStr, pMorale)) return 'player';
        }
        return null;
    },

    /** Simulate the rest of the battle on numbers only; returns the final sim. */
    _simulate(battle, firstStance) {
        const cfg = FieldBattle.config();
        const sim = { ...battle.sim };
        // The odds cannot know the battle's luck: each run draws its own
        sim.fortune = Utils.randFloat(1 - cfg.fortuneSpread, 1 + cfg.fortuneSpread);
        let stance = firstStance;
        while (sim.phase < cfg.phases.length && !sim.routed) {
            if (stance === 'reserves' && sim.reservesUsed) stance = 'aggressive';
            const roll = FieldBattle._rollPhase(battle, sim, stance);
            if (stance === 'reserves') sim.reservesUsed = true;
            sim.pStr *= 1 - roll.pLoss;
            sim.eStr *= 1 - roll.eLoss;
            sim.score += (cfg.phases[sim.phase].score || 0) * roll.r;
            sim.routed = FieldBattle._routCheck(battle, sim, roll.r);
            if (sim.routed) {
                const extra = cfg.phases[cfg.phases.length - 1].lossBase * cfg.rout.lossMult;
                if (sim.routed === 'enemy') sim.eStr *= 1 - extra; else sim.pStr *= 1 - extra * battle.pCasMult;
            }
            sim.phase++;
            const next = cfg.phases[sim.phase];
            stance = next ? (cfg.defaultStances[next.id] || 'aggressive') : stance;
            if (stance === 'feint' && !FieldBattle.stanceAllowed({ ...battle, sim }, 'feint').can) stance = 'hold';
        }
        sim.victory = sim.routed ? sim.routed === 'enemy' : sim.score > 0.5;
        return sim;
    },

    /**
     * Odds of fighting on with `stanceId` now (default stances after):
     * { win, loss, enemyLoss } — win chance, and the expected share of your
     * current strength and of theirs lost. Its own seeded stream: the game's
     * dice do not move, and the same question gives the same answer.
     */
    estimate(battle, stanceId) {
        if (!battle || battle.done) return { win: 0, loss: 0, enemyLoss: 0 };
        const runs = Math.max(10, FieldBattle.config().estimateRuns | 0);
        const seed = (Math.abs(Utils.hashStr(`${battle.seed}:${battle.sim.phase}:${stanceId}`)) % 200000) + 1;
        return Utils.withRng(Utils.seededRandom(seed), () => {
            let wins = 0, loss = 0, eLoss = 0;
            for (let i = 0; i < runs; i++) {
                const sim = FieldBattle._simulate(battle, stanceId);
                if (sim.victory) wins++;
                loss += 1 - sim.pStr / Math.max(1, battle.sim.pStr);
                eLoss += 1 - sim.eStr / Math.max(1, battle.sim.eStr);
            }
            return { win: _r2(wins / runs), loss: _r2(loss / runs), enemyLoss: _r2(eLoss / runs) };
        });
    },

    /** The share of the fighting force a withdrawal now would cost. */
    withdrawLoss(battle) {
        const w = FieldBattle.config().withdraw;
        const ratio = _clamp(battle.sim.eStr / Math.max(1, battle.sim.pStr), 0.5, 2);
        return _r2(_clamp(w.lossShare * ratio * (1 + (battle.eComp.cavalry || 0) * w.enemyCavalry)
            * (1 - (battle.pComp.cavalry || 0) * w.ownCavalry) * battle.pCasMult, 0, 0.5));
    },

    /** Can the player withdraw now? (between phases: not before the first) */
    canWithdraw(battle) {
        return !!battle && !battle.done && battle.sim.phase > 0;
    },

    /**
     * The choices before the current phase, with odds:
     * [{ id, name, icon, text, can, reason, win, loss }], plus the withdraw
     * option ({ id:'withdraw', loss }) once the first phase is fought.
     */
    options(battle) {
        if (!battle || battle.done) return [];
        const cfg = FieldBattle.config();
        const out = [];
        for (const [id, st] of Object.entries(cfg.stances)) {
            const ok = FieldBattle.stanceAllowed(battle, id);
            const est = ok.can ? FieldBattle.estimate(battle, id) : null;
            let text = st.text || '';
            if (id === 'feint' && ok.can) text += ` (${Math.round(FieldBattle.feintChance(battle) * 100)}% they take the bait)`;
            out.push({ id, name: st.name, icon: st.icon, text, can: ok.can, reason: ok.reason, win: est ? est.win : null, loss: est ? est.loss : null, isDefault: id === FieldBattle.defaultStance(battle) });
        }
        if (FieldBattle.canWithdraw(battle)) {
            out.push({ id: 'withdraw', name: 'Withdraw', icon: '🏳️', text: 'Break off under a rear-guard. No loot, no capture.', can: true, reason: '', win: 0, loss: FieldBattle.withdrawLoss(battle) });
        }
        return out;
    },

    /** Turn a strength share into soldiers lost (the remainder is a roll). */
    _lossToUnits(player, battle, share) {
        const n = (player.army || []).filter(u => PlayerMilitary._theatreParticipant(u, battle.theatre)).length;
        const expected = n * share;
        let count = Math.floor(expected);
        if (expected - count > 0 && Utils.random() < expected - count) count++;
        return count;
    },

    _takeLosses(player, battle, share) {
        const count = FieldBattle._lossToUnits(player, battle, share);
        const { casualties, woundedUnits } = PlayerMilitary._applyCasualties(player, battle.theatre, count);
        battle.casualties += casualties;
        battle.wounded += woundedUnits.length;
        battle.sim.pStr = PlayerMilitary.getTheatreStrength(player, battle.theatre);
        return casualties + woundedUnits.length;
    },

    /**
     * Fight the current phase with `stanceId` (or withdraw). Mutates the
     * player's army and the battle; when the battle ends, applies its
     * aftermath (finish) and sets battle.result. Returns the phase's log entry.
     */
    play(player, battle, stanceId, world) {
        if (!battle || battle.done) return null;
        if (stanceId === 'withdraw') return FieldBattle.withdraw(player, battle, world);
        const cfg = FieldBattle.config();
        if (!FieldBattle.stanceAllowed(battle, stanceId).can) stanceId = FieldBattle.defaultStance(battle);
        const ph = cfg.phases[battle.sim.phase];
        const sim = battle.sim;
        const roll = FieldBattle._rollPhase(battle, sim, stanceId);
        if (stanceId === 'reserves') sim.reservesUsed = true;
        const enemyBefore = sim.eStr;
        sim.eStr = Math.max(0, sim.eStr * (1 - roll.eLoss));
        const lost = FieldBattle._takeLosses(player, battle, roll.pLoss);
        sim.score += (ph.score || 0) * roll.r;
        sim.routed = FieldBattle._routCheck(battle, sim, roll.r);
        let routLost = 0;
        if (sim.routed === 'enemy') {
            sim.eStr *= 1 - cfg.phases[cfg.phases.length - 1].lossBase * cfg.rout.lossMult;
        } else if (sim.routed === 'player') {
            routLost = FieldBattle._takeLosses(player, battle, cfg.phases[cfg.phases.length - 1].lossBase * cfg.rout.lossMult * battle.pCasMult);
        }
        const entry = {
            phase: ph.id, name: ph.name, icon: ph.icon, stance: stanceId,
            stanceName: (cfg.stances[stanceId] || {}).name || stanceId,
            share: _r2(roll.r), lost: lost + routLost, enemyLost: Math.round(enemyBefore - sim.eStr),
            feint: roll.feint, routed: sim.routed,
            pStr: Math.round(sim.pStr), eStr: Math.round(sim.eStr),
        };
        battle.log.push(entry);
        sim.phase++;
        if (sim.routed || sim.phase >= cfg.phases.length) {
            battle.outcome = (sim.routed ? sim.routed === 'enemy' : sim.score > 0.5) ? 'victory' : 'defeat';
            FieldBattle.finish(player, battle, world);
        }
        return entry;
    },

    /** Break off between phases: a rear-guard's losses, no loot and no capture. */
    withdraw(player, battle, world) {
        if (!FieldBattle.canWithdraw(battle)) return null;
        const share = FieldBattle.withdrawLoss(battle);
        const lost = FieldBattle._takeLosses(player, battle, share);
        // Leaving a field you were not losing is noticed
        if (battle.sim.eStr / Math.max(1, battle.sim.pStr) < FieldBattle.config().withdraw.cowardiceRatio) {
            Traits.recordDeed(player, 'cowardice', 1);
        }
        const entry = { phase: 'withdraw', name: 'Withdrawal', icon: '🏳️', stance: 'withdraw', stanceName: 'Withdraw', share: 0, lost, enemyLost: 0, routed: null, pStr: Math.round(battle.sim.pStr), eStr: Math.round(battle.sim.eStr) };
        battle.log.push(entry);
        battle.outcome = 'withdrew';
        FieldBattle.finish(player, battle, world);
        return entry;
    },

    /** Fight the rest of the battle with the default stances. Returns battle.result. */
    auto(player, battle, world) {
        let guard = 10;
        while (battle && !battle.done && guard-- > 0) FieldBattle.play(player, battle, FieldBattle.defaultStance(battle), world);
        return battle ? battle.result : null;
    },

    /**
     * The battle is over: the one-shot battle's aftermath (companions, loot,
     * experience, renown, capture) and, against a world unit, its
     * consequences by unit type (PlayerMilitary.attackUnit). Sets and returns
     * battle.result, shaped like PlayerMilitary.combat's result plus
     * { phased:true, phases, withdrew }.
     */
    finish(player, battle, world) {
        if (battle.done) return battle.result;
        battle.done = true;
        const victory = battle.outcome === 'victory';
        const withdrew = battle.outcome === 'withdrew';
        const context = { theatre: battle.theatre, world };
        if (!withdrew) Companions.onBattle(player, victory, { enemyName: battle.enemyName, roleOf: n => PlayerEffects.companionRole(n) }, world);
        // The commanding child's record and fate (wounded, captured, killed)
        if (!withdrew) HeirAgency.onBattle(player, world, victory, battle.enemyName);
        if (battle.sim.routed === 'player') Traits.recordDeed(player, 'cowardice', 2); // the army broke and ran
        // The bowmen loosed their arrows and bolts (on the battlefield, the volleys each company
        // loosed: battle.volleys, player/battlefield.js); a won field gives some back (systems/arms.js)
        const quivers = Arms.spendQuivers(player, {
            units: (player.army || []).filter(u => PlayerMilitary._theatreParticipant(u, battle.theatre)),
            victory, volleys: battle.volleys || null,
        });

        // (battle.lootPurse: the beaten side's own purse, when the battle knows it — player/battlefield.js)
        const spoilsCtx = battle.lootPurse !== undefined ? { ...context, lootPurse: battle.lootPurse } : context;
        const spoils = withdrew ? { loot: 0 } : PlayerMilitary._battleSpoils(player, victory, battle.eStr0, spoilsCtx, battle.enemyName);
        if (spoils.loot > 0) Ledger.record(player, 'plunder', spoils.loot);
        if (spoils.goldConfiscated > 0) Ledger.record(player, 'robbery', -spoils.goldConfiscated);

        const pMorale = PlayerMilitary._moraleValue(battle.pStr0, battle.eStr0, battle.leadership);
        const eMorale = PlayerMilitary._moraleValue(battle.eStr0, battle.pStr0, battle.enemyMoraleBonus);
        let result = {
            victory,
            withdrew,
            phased: true,
            phases: battle.log.slice(),
            casualties: battle.casualties,
            wounded: battle.wounded,
            loot: spoils.loot || 0,
            armsTaken: spoils.armsTaken || null, // the beaten's arms stripped off the field (systems/arms.js)
            quivers,
            enemyName: battle.enemyName,
            playerStrength: battle.pStr0,
            enemyStrength: battle.eStr0,
            enemyRemaining: Math.round(battle.sim.eStr),
            commanderSlain: battle.commanderSlain,
            theatre: battle.theatre,
            navalSupport: battle.navalSupport,
            shipSupport: battle.shipSupport,
            tactics: {
                terrainId: battle.terrainId,
                weather: battle.weather,
                moraleBreak: battle.sim.routed,
                playerMorale: _r2(pMorale),
                enemyMorale: _r2(eMorale),
                playerCounterMult: _r2(battle.pCounter),
                enemyCounterMult: _r2(battle.eCounter),
                playerTerrainMult: _r2(battle.pTerrain),
                enemyTerrainMult: _r2(battle.eTerrain),
            },
        };
        if (spoils.captured) {
            Object.assign(result, { captured: true, servitudeDays: spoils.servitudeDays, goldConfiscated: spoils.goldConfiscated });
        }
        if (!withdrew) result.skillUps = FieldBattle._battleSkills(player);

        // A world unit: its losses stand, and its fate follows the usual rules
        const unit = battle.unitId && world && Array.isArray(world.units)
            ? world.units.find(u => u.id === battle.unitId && !u.destroyed) : null;
        if (unit) {
            if (!victory) unit.strength = Math.max(1, Math.round(battle.sim.eStr));
            if (withdrew) {
                unit.targetQ = null;
                unit.targetR = null;
                // The band lets you go: it won't seek you out again for a few days
                // (unit.sparedUntilDay, read by world/units.js and the road encounters)
                unit.sparedUntilDay = (Number(world.day) || 0) + Math.max(0, Number(FieldBattle.config().withdraw.spareDays) || 0);
                if (world.events) world.events.push({ text: `${player.name || 'The player'} withdrew from battle with a ${unit.name}.`, type: 'military' });
                result = { ...result, enemyName: unit.name, karmaChange: 0, renownChange: 0, inventoryLoot: {} };
            } else {
                result = PlayerMilitary.attackUnit(player, unit, world, { defending: battle.defending, combatResult: result });
            }
        }
        battle.result = result;
        return result;
    },

    /**
     * The odds of the whole battle before it starts (default stances), drawn
     * up on a private stream so a preview never moves the game's dice:
     * { win, loss, enemyLoss } or null with nothing to fight with.
     */
    preview(player, enemy, world, ctx = {}) {
        const seed = (Math.abs(Utils.hashStr(`preview:${enemy.name}:${enemy.strength}:${(world && world.day) || 0}`)) % 200000) + 1;
        const battle = Utils.withRng(Utils.seededRandom(seed), () => FieldBattle.start(player, enemy, world, ctx));
        if (!battle || battle.success === false) return null;
        _battleSeq--; // a preview is not a battle
        return FieldBattle.estimate(battle, FieldBattle.defaultStance(battle));
    },

    /** Battle setup against a world unit (terrain, theatre, composition). */
    unitEnemy(player, unit, world) {
        const unitTile = world && typeof world.getTile === 'function' ? world.getTile(unit.q, unit.r) : null;
        const here = world && typeof world.getTile === 'function' && typeof player.q === 'number' ? world.getTile(player.q, player.r) : unitTile;
        return {
            enemy: { strength: unit.strength, name: unit.name, type: unit.type, icon: unit.icon, unitId: unit.id, composition: PlayerMilitary._getWorldUnitComposition(unit) },
            ctx: { terrainId: unitTile?.terrain?.id, theatre: PlayerMilitary.tileTheatre(here, player) },
        };
    },

    /** Odds label for a chance (shared with the road encounter). */
    oddsLabel(chance) {
        if (chance === null || chance === undefined) return 'certain';
        if (chance >= 0.8) return 'very likely';
        if (chance >= 0.6) return 'likely';
        if (chance >= 0.4) return 'even odds';
        if (chance >= 0.2) return 'risky';
        return 'desperate';
    },
};
