// ============================================
// INNER MAP COMBAT SYSTEM
// Handles player attacks on NPCs, trees, objects, and animals
// while in the inner map exploration mode.
//
// Features:
//   - Attack any adjacent NPC, custom object, or natural entity
//   - Floating damage numbers that pop up over targets
//   - Health bars shown on damaged entities
//   - Hit flash / slash burst effect at the target
//   - Player faces target during attack (idle anim)
//   - Swings and hit points come from the duel engine (systems/duels.js):
//     your weapon counts, the NPC's armour turns some of each blow
//   - NPC health tracked per-session; a townsperson's injury is kept on
//     their roster entry (settlement.folk, systems/townsfolk.js) and heals
//     day by day, and one killed dies on the roster
//   - The fallen leave their actual purse and some of the wares they carry
//   - You keep after whoever you attack: walk away from the fight to stop
//   - The victim fights back (comes at you, swinging) or runs, and a fighter
//     beaten low may break and run
//   - The dead stay where they fell (a body on the street until the next day)
//   - The street reacts (ui/innerMapReactions.js, systems/streetCrime.js):
//     witnesses bark, flee, cower or fight, the watch comes running, and the
//     assault or murder is recorded and remembered
// ============================================

import { InnerMap } from '../world/innerMap.js';
import { InnerMapRenderer } from './innerMapRenderer.js';
import { InnerMapCharacters } from './innerMapCharacters.js';
import { Relationships } from '../systems/relationships.js';
import { CustomObjects } from '../world/customObjects.js';
import { PlayerEffects } from '../player/playerEffects.js';
import { NpcDisposition } from '../systems/npcDisposition.js';
import { Ailments } from '../systems/ailments.js';
import { Duels } from '../systems/duels.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { Knockout } from '../systems/knockout.js';
import { CombatSkills } from '../systems/combatSkills.js';
import { StreetCrime } from '../systems/streetCrime.js';
import { Laws } from '../systems/laws.js';
import { MapTasks } from '../systems/mapTasks.js';
import { PlayerInventory } from '../player/inventory.js';
import { Utils } from '../core/utils.js';
import { drawGlyph } from './icons.js';
import { InnerMapReactions } from './innerMapReactions.js';
import { drawMapText, labelZoom, textPx } from './mapInk.js';
import { ParentsGuard } from './parentsGuard.js';

function _nowMs() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

/**
 * Floating combat numbers by kind: size (× camera zoom), readable floor,
 * colour, and the pop at birth ([share of life, extra scale]).
 */
const FLOAT_STYLES = {
    killed:     { size: 13, min: 12, color: '#ff5566' },
    critical:   { size: 15, min: 13, color: '#ffaa22', pop: [0.3, 0.5], bang: true },
    object:     { size: 11, min: 11, color: '#9be256' },
    player_hit: { size: 14, min: 12, color: '#ff55d0', pop: [0.25, 0.6] },
    hit:        { size: 11, min: 11, color: '#ff5f5f', pop: [0.2, 0.3] },
};


export const InnerMapCombat = {

    // ── Floating damage numbers ─────────────────────────────
    // { worldX, worldY, offsetY, value, type, label, age, maxAge }
    _floatNumbers: [],

    // ── Hit flash effects ────────────────────────────────────
    // { worldX, worldY, age, maxAge, angle }
    _hitFlashes: [],

    // ── Current NPC attack state ──────────────────────────────
    // null, or { targetType, npc, swingTimer, swingInterval, baseDamage, game, _notified }
    _attackState: null,

    // ── NPC health map (session-persistent) ──────────────────
    // Maps npc.id → { current, max }
    _npcHealth: new Map(),

    // ── NPC reaction states ───────────────────────────────────
    // Maps npc.id → { mode:'fight'|'flee', attackTimer }
    _npcReactions: new Map(),

    // ── The dead, lying where they fell ───────────────────────
    // { name, type, preset, q, r, side, at, day, key }
    _corpses: [],
    _today: 0,
    // The body the player is carrying (ui/innerMapDigging.js moves it along)
    _carrying: null,
    // How many bodies are kept at once (oldest carried off first)
    MAX_CORPSES: 40,

    // ── Constants ─────────────────────────────────────────────
    FLOAT_DURATION:       1.6,   // seconds a damage number lives
    FLOAT_RISE_SPEED:     52,    // screen-pixels per second the number rises
    HIT_FLASH_DURATION:   0.28,  // seconds a hit flash lasts

    // Whether an NPC fights back or flees, and how hard it hits, come from its
    // duel profile and temperament (Duels.brawlStance / Duels.npcSwing).

    // How often a fighting NPC counter-attacks (seconds)
    NPC_ATTACK_INTERVAL: 0.7,

    // NPC base HP by type
    NPC_BASE_HEALTH: {
        guard:           150,
        merchant:         60,
        farmer:           70,
        priest:           50,
        blacksmith_npc:   90,
        villager:         60,
        child:            35,
        noble:            80,
        traveler:         65,
        beggar:           45,
        // catch-all fallback handled below
    },

    // ══════════════════════════════════════════════
    // ATTACK INITIATION
    // ══════════════════════════════════════════════

    /**
     * Start attacking an NPC.
     * If the player is too far away, queues a _pendingCombat walk-then-attack.
     */
    startAttackNPC(game, npc) {
        // Setting on someone is crime to a child's parents (a job's bout is not: ui/parentsGuard.js)
        if (npc && !npc._taskFoe && !ParentsGuard.ok(game, 'assault', null, { each: true })) return;
        // Cancel whatever was happening before
        if (this._attackState) this.cancelAttack();
        InnerMap._activeInteraction = null;
        InnerMap._pendingCombat = null;

        const dist = Math.max(
            Math.abs(InnerMap.playerInnerQ - npc.q),
            Math.abs(InnerMap.playerInnerR - npc.r)
        );

        if (dist > 1) {
            // Go after them (following as they move), and strike on reaching them
            this._attackState = { targetType: 'npc', npc, game, pending: true, chaseTimer: 0, chasePath: null };
            this._chase(this._attackState);
            return;
        }

        this._beginNPCAttack(game, npc);
    },

    /**
     * Start attacking a custom object (tree, rock, bush, etc.).
     * Delegates to the existing InnerMap.startInteraction system,
     * and from then on onObjectHit() is called each swing.
     */
    startAttackObject(game, anchorQ, anchorR, defId) {
        if (this._attackState) this.cancelAttack();

        const def = (typeof CustomObjects !== 'undefined') ? CustomObjects.getDef(defId) : null;
        if (!def) return;

        const adj = InnerMap.findAdjacentToObject(anchorQ, anchorR, def);
        if (!adj) {
            game.ui.showNotification('⚠️ Blocked', 'Cannot reach that object from here!', 'error');
            return;
        }

        if (InnerMap.playerInnerQ === adj.q && InnerMap.playerInnerR === adj.r) {
            const dmg = InnerMap._computeObjectDamage(game.player, def);
            InnerMap.startInteraction(anchorQ, anchorR, defId, dmg);
            const dir = InnerMap.getDirectionTowardObject(anchorQ, anchorR, def);
            InnerMapRenderer._playerFacing = dir;
            // Track that we're in object-combat so we can spawn float numbers
            this._attackState = {
                targetType: 'object', targetQ: anchorQ, targetR: anchorR, defId, game
            };
        } else {
            InnerMap._pendingInteraction = { anchorQ, anchorR, defId };
            InnerMap._pendingCombat = null;
            InnerMap.movePlayerTo(adj.q, adj.r);
        }
    },

    /** Begin the NPC attack loop from the current player position. */
    _beginNPCAttack(game, npc) {
        // Initialise health if first encounter (a townsperson may still be hurt from last time)
        if (!this._npcHealth.has(npc.id)) {
            const maxHp = Duels.npcBrawlHp(npc) || this.NPC_BASE_HEALTH[npc.type] || 60;
            const hurt = npc._person ? Townsfolk.injury(npc._person, this._day(game), Duels.config().brawl.healPerDay) : null;
            const current = hurt ? Math.max(1, Math.round(maxHp * hurt.hp / hurt.max)) : maxHp;
            this._npcHealth.set(npc.id, { current, max: maxHp });
        }

        // Who threw the first blow (systems/knockout.js weighs it when the player goes down)
        // (One who set on the player before, and has since let it go, is this time the one struck first)
        if (!npc._struckPlayerFirst || !this._npcReactions.has(npc.id)) {
            npc._struckPlayerFirst = false;
            npc._provokedBy = 'player';
            this._playerStruckOn = InnerMap.tiles;
        }

        const dmg = this._computePlayerDamage(game.player);
        const foe = Duels.fromNpc(npc, { world: game && game.world });
        this._attackState = {
            targetType: 'npc',
            npc,
            swingTimer: 0,          // counts up — hits on each interval
            swingInterval: 0.5,     // seconds between swings
            baseDamage: dmg,
            npcArmour: foe.armour,
            // Blades or Brawling: the weapon in hand (systems/combatSkills.js)
            skill: this._playerFightSkill(game.player),
            foeGuard: this._npcGuard(npc, foe, game),
            game,
            _notified: false,
            chaseTimer: 0,
            chasePath: null,
        };

        // Face the NPC immediately
        const dq = npc.q - InnerMap.playerInnerQ;
        const dr = npc.r - InnerMap.playerInnerR;
        InnerMapRenderer._playerFacing = InnerMapCharacters.getDirection(dq, dr);

        // The first blow sets off several things at once (the victim's reaction,
        // the reputation hit, kin turning on you, witnesses, the watch). Gather
        // their notices and show them as one, rather than a stack of five.
        const ui = game && game.ui;
        const notes = [];
        const original = ui && ui.showNotification;
        if (ui && typeof original === 'function') {
            ui.showNotification = (title, body, kind) => { notes.push({ title, body, kind }); };
        }
        try {
            // Trigger NPC reaction (fight back or flee) and apply relationship penalties
            this._initiateNPCReaction(npc, game);
            // A job's opponent (a brawler on the watch round, an arena bout): fair game, no crime
            if (npc._taskFoe) return;
            this.applyAttackRelationshipPenalties(game, npc);

            // Family & friends turn against the player (once per NPC per assault)
            if (!npc._assaultRippled) {
                npc._assaultRippled = true;
                const ripple = NpcDisposition.onNpcHarmed(npc, InnerMap.npcs || [], 'assault');
                if (ripple.affected.length > 0) {
                    notes.push({ title: '😠', body: `${ripple.affected.length} of ${npc.name}'s kin and friends think less of you.`, kind: 'warning' });
                }
                // The street sees it: witnesses react, the assault is recorded and remembered
                InnerMapReactions.onViolence(game, npc, 'assault');
            }
        } finally {
            if (ui && typeof original === 'function') ui.showNotification = original;
        }
        if (ui && typeof original === 'function') {
            const kind = notes.some(n => n.kind === 'error') ? 'error' : 'warning';
            const lines = notes.map(n => String(n.body || n.title || '').trim()).filter(Boolean);
            ui.showNotification(`⚔️ You attack ${npc.name}`, lines.join(' '), kind);
        }
    },

    /** Cancel any active attack (and stop chasing). */
    cancelAttack() {
        const ia = this._attackState;
        if (ia && ia.chasePath && InnerMap._playerPath === ia.chasePath) InnerMap.cancelPlayerWalk();
        this._attackState = null;
    },

    /**
     * Walk after the target. Keeps the walk under way while it still ends
     * beside them, so the player does not stutter re-planning every step.
     * @returns {boolean} whether the player is (still) on the way
     */
    _chase(ia) {
        const npc = ia.npc;
        ia.chaseTimer = 0.3;
        const path = InnerMap._playerPath;
        if (InnerMap._playerWalking && path && path === ia.chasePath) {
            const end = path[path.length - 1];
            if (end && Math.max(Math.abs(end.q - npc.q), Math.abs(end.r - npc.r)) <= 1) return true;
        }
        const res = InnerMap.movePlayerTo(npc.q, npc.r);
        ia.chasePath = res && res.started ? InnerMap._playerPath : null;
        return !!ia.chasePath;
    },

    /** The target is out of reach (gone indoors, off the map, too far): stop. */
    _lostTarget(ia, game, name) {
        this.cancelAttack();
        const g = game || ia.game;
        if (!ia.pending && g && g.ui && typeof g.ui.showNotification === 'function') {
            g.ui.showNotification('🏃 Got away', `${name || 'They'} got away.`, 'info');
        }
    },

    // ══════════════════════════════════════════════
    // UPDATE — called each frame from game.js
    // ══════════════════════════════════════════════

    update(deltaTime, game) {
        if (InnerMap._insideBuilding && this._householdChecked !== InnerMap.tiles) this._checkHousehold(game);
        this._today = this._day(game);
        // ── Advance float numbers (screen-space rise) ──
        for (const fn of this._floatNumbers) {
            fn.age += deltaTime;
            fn.offsetY -= this.FLOAT_RISE_SPEED * deltaTime;
        }
        this._floatNumbers = this._floatNumbers.filter(fn => fn.age < fn.maxAge);

        // ── Advance hit flashes ──
        for (const hf of this._hitFlashes) hf.age += deltaTime;
        this._hitFlashes = this._hitFlashes.filter(hf => hf.age < hf.maxAge);

        // ── NPC combat tick ──
        if (this._attackState && this._attackState.targetType === 'npc') {
            this._updateNPCAttack(deltaTime, game);
        }

        // ── NPC reaction ticks (fight-back or flee follow-up) ──
        this._updateNPCReactions(deltaTime, game);

        // ── The knocked-out come round in their own time ──
        this._updateKnockedOut(game);

        // ── The street's reaction: guards and kin coming for the player ──
        InnerMapReactions.update(deltaTime, game);

        // ── Object combat: float numbers are spawned by onObjectHit ──
    },

    _updateNPCAttack(deltaTime, game) {
        const ia = this._attackState;
        if (!ia) return;

        // Still about? (Gone off the map, or indoors where the player is not)
        const npc = InnerMap.npcs && InnerMap.npcs.find(n => n.id === ia.npc.id);
        if (!npc || npc.state === 'gone' || (npc.state === 'inside_building' && !InnerMap._insideBuilding)) {
            this._lostTarget(ia, game, ia.npc && ia.npc.name);
            return;
        }

        // Re-sync npc reference (position may have changed)
        ia.npc = npc;

        // The fight goes on: whoever comes within sight of it now reacts too
        if (!ia.pending && !npc._taskFoe) {
            ia.watchTimer = (ia.watchTimer || 0) - deltaTime;
            if (ia.watchTimer <= 0) {
                ia.watchTimer = 0.8;
                InnerMapReactions.onOngoing(game || ia.game, npc);
            }
        }

        // The player walked off somewhere else: that ends the fight
        if (InnerMap._playerWalking && InnerMap._playerPath && InnerMap._playerPath !== ia.chasePath) {
            this._attackState = null;
            return;
        }

        const dist = Math.max(
            Math.abs(InnerMap.playerInnerQ - npc.q),
            Math.abs(InnerMap.playerInnerR - npc.r)
        );
        if (dist > 1) {
            // After them
            if (dist > 30) { this._lostTarget(ia, game, npc.name); return; }
            ia.chaseTimer = (ia.chaseTimer || 0) - deltaTime;
            if (ia.chaseTimer <= 0 && !this._chase(ia)) {
                ia.stuck = (ia.stuck || 0) + 1;
                if (ia.stuck > 8) this._lostTarget(ia, game, npc.name);
            }
            return;
        }

        // Within reach: stop chasing and strike
        ia.stuck = 0;
        if (ia.chasePath) {
            if (InnerMap._playerPath === ia.chasePath) InnerMap.cancelPlayerWalk();
            ia.chasePath = null;
        }
        if (ia.pending) {
            this._beginNPCAttack(game || ia.game, npc);
            return;
        }

        // Keep facing the NPC
        const dq = npc.q - InnerMap.playerInnerQ;
        const dr = npc.r - InnerMap.playerInnerR;
        InnerMapRenderer._playerFacing = InnerMapCharacters.getDirection(dq, dr);

        ia.swingTimer += deltaTime;
        if (ia.swingTimer < ia.swingInterval) return;
        ia.swingTimer -= ia.swingInterval;

        // ── Land a swing ──
        const health = this._npcHealth.get(npc.id);
        if (!health) { this.cancelAttack(); return; }

        const g = game || ia.game;
        const player = g && g.player;
        const T = InnerMapRenderer.TILE_SIZE;
        const sk = ia.skill;
        // Does it land? Your skill's aim against their parry or footwork
        const roll = sk && player ? Utils.random() : 0;
        if (sk && player && roll >= this._playerHitChance(player, sk, ia.foeGuard)) {
            // Wide of them, or turned by their parry / slipped by their footwork
            const guarded = ia.foeGuard && ia.foeGuard.chance > 0 && roll < this._playerHitChance(player, sk, null);
            this._spawnFloat(npc.q * T + T / 2, npc.r * T + T * 0.1, 0, 'normal', guarded ? ia.foeGuard.word : 'Miss');
            this._skillXp(g, sk, 'miss');
            return;
        }

        const variance = 0.875 + Utils.random() * 0.25;
        let rawDmg     = Math.max(1, ia.baseDamage * variance);
        // A Blades hand's power swing: a heavy cut
        let label = null;
        if (sk === 'blades' && player) {
            const pw = CombatSkills.chance(player, 'blades', 'powerSwing');
            if (pw > 0 && Utils.random() < pw) {
                rawDmg *= Number(CombatSkills.config().inner.powerMult) || 1.8;
                label = 'Power swing!';
            }
        }
        // The NPC's armour (a guard's mail) turns part of the blow
        const dmg      = Math.max(1, Math.round(rawDmg * (1 - (ia.npcArmour || 0))));
        const isCrit   = !!label || rawDmg > ia.baseDamage * 1.09;
        health.current = Math.max(0, health.current - dmg);
        this._skillXp(g, sk, 'hit');
        // A brawler's moves: a haymaker fells one already reeling, a stagger costs them their next blow
        if (sk === 'brawling' && player && health.current > 0) {
            const hay = CombatSkills.chance(player, 'brawling', 'haymaker');
            if (hay > 0 && health.current < health.max * hay && !npc._taskFoe) {
                health.current = 0;
                label = 'Haymaker!';
            } else {
                const st = CombatSkills.chance(player, 'brawling', 'stagger');
                const reaction = this._npcReactions.get(npc.id);
                if (st > 0 && reaction && reaction.mode === 'fight' && Utils.random() < st) {
                    reaction.attackTimer += this.NPC_ATTACK_INTERVAL;
                    label = 'Staggered';
                }
            }
        }
        // A townsperson carries the beating with them (healed day by day)
        if (npc._person && health.current > 0) Townsfolk.injure(npc._person, this._day(game || ia.game), health.current, health.max);

        this._spawnFloat(
            npc.q * T + T / 2,
            npc.r * T + T * 0.1,
            dmg,
            isCrit ? 'critical' : 'normal',
            label
        );
        this._spawnHitFlash(npc.q * T + T / 2, npc.r * T + T / 2);

        // A job's opponent gives up before it comes to killing (ui/innerMapTasks.js)
        if (npc._taskFoe && health.current <= health.max * this._taskYieldAt()) {
            this.cancelAttack();
            npc._taskFoe.onYield();
            return;
        }
        if (health.current <= 0) {
            // Beaten senseless, not dead: the player chooses what comes next (systems/knockout.js)
            this.cancelAttack();
            this._skillXp(g, sk, 'knockout');
            this._knockOutNPC(npc, game || ia.game);
            return;
        }
        // While the fight lasts, a fighter keeps coming; one beaten low may break and run
        const resp = InnerMapReactions._responders.get(npc.id);
        if (resp) resp.until = Math.max(resp.until, _nowMs() + 20000);
        this._maybeBreak(npc, game || ia.game);
    },

    /** A fighter beaten low (and not the aggressive kind) breaks and runs. */
    _maybeBreak(npc, game) {
        const reaction = this._npcReactions.get(npc.id);
        if (!reaction || reaction.mode !== 'fight' || npc._taskFoe || npc._broke) return;
        const hp = this._npcHealth.get(npc.id);
        if (!hp) return;
        // Only once badly hurt (the stance's fleeBelowHp), and never the aggressive
        const stance = (Duels.config().brawl || {}).stance || {};
        const breakAt = Number(stance.fleeBelowHp) || 0.35;
        if (hp.current / hp.max >= breakAt || Duels.fromNpc(npc).temperament === 'aggressive') return;
        npc._broke = true;
        InnerMapReactions._responders.delete(npc.id);
        this._npcReactions.set(npc.id, { mode: 'flee' });
        InnerMapReactions.bark(npc, 'Enough! Enough!', 2.5);
        InnerMapReactions._flee(npc, { indoors: !!InnerMap._insideBuilding });
    },

    // ══════════════════════════════════════════════
    // KNOCKED OUT — 0 health is senseless, not dead (systems/knockout.js)
    // ══════════════════════════════════════════════

    /** The NPC collapses where they stand: lying senseless until they come round. */
    _knockOutNPC(npc, game) {
        const wake = Knockout.npcWake();
        npc.state = 'unconscious';
        npc.path = null;
        npc.moveProgress = 0;
        npc._targetBuilding = null;
        npc._activity = null;
        npc._bark = null;
        npc._ko = { at: _nowMs(), until: _nowMs() + wake.seconds * 1000, hpShare: wake.hpShare, side: InnerMap.playerInnerQ > npc.q ? -1 : 1 };
        InnerMapReactions._responders.delete(npc.id);
        this._npcReactions.delete(npc.id);
        const T = InnerMapRenderer.TILE_SIZE;
        this._spawnFloat(npc.q * T + T / 2, npc.r * T, 0, 'killed', 'Knocked out');
        if (game && game.ui && typeof game.ui.showNotification === 'function') {
            game.ui.showNotification(`💫 ${npc.name} goes down`,
                `${npc.name} collapses, senseless. Click them to finish them off or go through their pockets, or leave them be — they'll come round.`, 'warning');
        }
    },

    /** Kill a knocked-out NPC where they lie: a murder, seen or unseen. */
    finishOff(npc, game) {
        if (!npc || npc.state !== 'unconscious') return false;
        if (!ParentsGuard.ok(game, 'assault', null, { each: true })) return false;
        npc.state = 'idle';
        npc._ko = null;
        this._killNPC(npc, game);
        return true;
    },

    /** Go through a knocked-out NPC's pockets (once). */
    robKnockedOut(npc, game) {
        if (!npc || npc.state !== 'unconscious' || npc._koSearched) return null;
        if (!ParentsGuard.ok(game, 'theft', null, { each: true })) return null;
        npc._koSearched = true;
        const { gold, items } = this._takeSpoils(npc, game);
        const parts = [];
        if (gold > 0) parts.push(`${gold} gold`);
        for (const it of items) parts.push(`${it.qty} ${String(it.id).replace(/_/g, ' ')}`);
        // They'll know who did it when they come round
        NpcDisposition.adjustDisposition(npc, -15, game && game.player);
        if (game && game.ui) {
            if (typeof game.ui.updateStats === 'function' && game.player) game.ui.updateStats(game.player, game.world);
            game.ui.showNotification(`🖐️ ${npc.name}'s pockets`, parts.length ? `You take ${parts.join(', ')}.` : 'Their pockets are empty.', parts.length ? 'success' : 'info');
        }
        return { gold, items };
    },

    /** The knocked-out come round in their own time: hurt, shaken, and away from the player. */
    _updateKnockedOut(game) {
        const now = _nowMs();
        for (const npc of InnerMap.npcs || []) {
            if (npc.state !== 'unconscious' || !npc._ko || now < npc._ko.until) continue;
            const ko = npc._ko;
            npc._ko = null;
            npc.state = 'idle';
            npc.idleTimer = 2;
            const hp = this._npcHealth.get(npc.id);
            if (hp) {
                hp.current = Math.max(1, Math.round(hp.max * ko.hpShare));
                if (npc._person) Townsfolk.injure(npc._person, this._day(game), hp.current, hp.max);
            }
            const line = Knockout.wakeLine();
            if (line) InnerMapReactions.bark(npc, line, 3.5);
            // Shaken: away from the one who did it
            npc._broke = true;
            InnerMapReactions._flee(npc, { indoors: !!InnerMap._insideBuilding });
        }
    },

    /**
     * The player is beaten to 0: they black out, and whoever downed them
     * decides — the cells, the knife, their purse, or nothing. Then they come
     * round, hours later, at a little health (or not at all).
     */
    _knockOutPlayer(game, attacker) {
        if (!game || !game.player || this._playerOut) return;
        this._playerOut = true;
        const player = game.player;
        player.health = 0;
        // Every fight stops while they lie there
        if (this._attackState) this.cancelAttack();
        this._npcReactions.clear();
        for (const id of [...InnerMapReactions._responders.keys()]) InnerMapReactions.release(id);
        InnerMap.cancelPlayerWalk();
        InnerMap._pendingCombat = null;
        InnerMap._pendingDialog = null;

        const day = this._day(game);
        const wt = InnerMap.currentWorldTile || {};
        const settlement = (InnerMap._currentWorldTileRef && InnerMap._currentWorldTileRef.settlement) || wt.settlement || null;
        const wanted = StreetCrime.pendingAt(player, `${wt.q},${wt.r}`, day);
        // Who started it: they set on the player, or the player on them (or on someone, here)
        const starter = !attacker ? null
            : attacker._struckPlayerFirst ? 'npc'
                : (attacker._provokedBy === 'player' || this._playerStruckOn === InnerMap.tiles) ? 'player' : null;
        const kingdom = settlement ? settlement.kingdom : null;
        const campName = attacker ? `${attacker.name}'s prison camp` : 'a prison camp';
        // A job's opponent (an arena bout) only wins the bout
        const verdict = attacker && attacker._taskFoe
            ? { act: 'leave', line: 'Stay down.', chance: 0, why: 'A fair bout.' }
            : Knockout.attackerVerdict(attacker, player, {
                wanted, starter, hasWatch: !!settlement, campName,
                campsAllowed: Knockout.privatePrisonsAllowed(game.world, kingdom),
                deter: Laws.punishment(game.world, kingdom).deter,
            });
        if (verdict.line && attacker) InnerMapReactions.bark(attacker, verdict.line, 3.5);
        const who = (attacker && attacker.name) || 'Your attacker';
        const town = (settlement && settlement.name) || 'the street';

        this._blackout(game, 2600, () => {
            this._playerOut = false;
            if (verdict.act === 'finish') {
                if (typeof game._triggerDeath === 'function') game._triggerDeath(`beaten to death by ${who} in ${town}`);
                return;
            }
            const res = Knockout.playerWakes(player, verdict);
            InnerMap.passHours(res.hours);
            if (attacker) {
                attacker._broke = true;
                InnerMapReactions._flee(attacker, { indoors: !!InnerMap._insideBuilding });
            }
            const hrs = `${res.hours} hour${res.hours === 1 ? '' : 's'}`;
            // Taken for their own prison camp (the realm allows it): servitude, off the town map
            if (verdict.act === 'capture') {
                const cap = Knockout.capturePlayer(player, verdict, { campName, keeper: who, kingdom });
                if (typeof game.ui.hideCustomPanel === 'function') game.ui.hideCustomPanel();
                game.ui.showNotification('⛓️ Taken Prisoner', `${who} set on you, and while you lay senseless had you chained and carted off to ${campName}. ${town}'s law lets a free man keep prisoners. ${cap.days} days of their labour${cap.took ? `, and ${cap.took} gold taken` : ''} — unless you buy your way out or slip your chains.`, 'error');
                if (typeof game.exitInnerMap === 'function') game.exitInnerMap({ force: true });
                if (typeof game.ui.updateStats === 'function') game.ui.updateStats(player, game.world);
                return;
            }
            // The player started it: they ran for the watch. A charge if there's none yet (they swear to it)
            let charge = verdict.act === 'arrest' ? wanted : null;
            if (verdict.act === 'fetch') {
                charge = wanted || (StreetCrime.record(player, game.world, {
                    crime: 'assault', victim: attacker, witnesses: [], q: wt.q, r: wt.r,
                    scene: { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR },
                }) || {}).incident || null;
            }
            if (charge) {
                const out = StreetCrime.answerWatch(player, game.world, charge.id, 'submit', settlement);
                if (typeof game.ui.hideCustomPanel === 'function') game.ui.hideCustomPanel();
                const how = verdict.act === 'fetch'
                    ? `You started it, and lost. While you lay senseless ${who} ran for the watch, and they hauled you off.`
                    : `${who} beat you senseless and dragged you off.`;
                game.ui.showNotification('⛓️ You Wake in the Cells', `${how} ${out.jailed ? `${out.jailed} days in the cells.` : ''}`, 'error');
                // Into the jail map (ui/innerMapJail.js); off the street map if it can't be had
                if (typeof game.enterJailMap === 'function') {
                    game.enterJailMap().then(ok => { if (!ok && typeof game.exitInnerMap === 'function') game.exitInnerMap({ force: true }); });
                } else if (typeof game.exitInnerMap === 'function') game.exitInnerMap();
            } else {
                const what = verdict.act === 'rob'
                    ? (res.stolen > 0 ? `${who} went through your purse: ${res.stolen} gold gone.` : `${who} went through your purse and found nothing.`)
                    : verdict.act === 'warn' ? `${who} left you with a warning.` : `${who} left you lying there.`;
                game.ui.showNotification('💫 You Come Round', `You were out for ${hrs}. ${what} You ache all over.`, verdict.act === 'rob' ? 'error' : 'warning');
            }
            if (typeof game.ui.updateStats === 'function') game.ui.updateStats(player, game.world);
        });
    },

    /** The health share a job's opponent yields at (data/mapTasks.json yieldAt). */
    _taskYieldAt() {
        const v = MapTasks.data().yieldAt;
        return typeof v === 'number' && v >= 0 && v < 1 ? v : 0.2;
    },

    /** The punishment law of the realm whose town this is (systems/laws.js deter; 1 outside a realm). */
    _lawDeter(game) {
        const wt = InnerMap.currentWorldTile || {};
        const s = (InnerMap._currentWorldTileRef && InnerMap._currentWorldTileRef.settlement) || wt.settlement || null;
        return Laws.punishment(game && game.world, s ? s.kingdom : null).deter;
    },

    /**
     * Walking into a house where someone hates the player (a grudge, or bad
     * blood): they may set on them there and then — and so the fight is theirs
     * (systems/knockout.js: a kill, or their prison camp where the law allows).
     */
    _checkHousehold(game) {
        this._householdChecked = InnerMap.tiles;
        const b = InnerMap._insideBuilding;
        if (!b || !game || !game.player || b.isPlayerOwned || b.isPlayerProperty || (InnerMap.inJail && InnerMap.inJail())) return;
        for (const npc of InnerMap.npcs || []) {
            const lives = (npc._home && npc._home.q === b.q && npc._home.r === b.r) || (b.ownerId != null && npc.id === b.ownerId);
            if (!lives || npc.state === 'unconscious' || npc._ko) continue;
            const v = Knockout.householderAttacks(npc, undefined, this._lawDeter(game));
            if (!v.attacks) continue;
            npc._struckPlayerFirst = true;
            npc._provokedBy = null;
            if (!this._npcHealth.has(npc.id)) {
                const maxHp = Duels.npcBrawlHp(npc) || this.NPC_BASE_HEALTH[npc.type] || 60;
                this._npcHealth.set(npc.id, { current: maxHp, max: maxHp });
            }
            if (v.line) InnerMapReactions.bark(npc, v.line, 3.5);
            InnerMapReactions._respond(npc, 'fight', null);
            this._npcReactions.set(npc.id, { mode: 'fight', attackTimer: this.NPC_ATTACK_INTERVAL * 1.5 });
            if (game.ui) game.ui.showNotification(`⚔️ ${npc.name} Sets on You!`, `"${v.line}" ${v.why} Fight, or get out the door.`, 'error');
            return;
        }
    },

    /** Fade to black for `ms`, block the street map meanwhile, then run `then`. */
    _blackout(game, ms, then) {
        if (typeof document === 'undefined' || !document.body) { then(); return; }
        const el = document.createElement('div');
        el.className = 'im-blackout';
        el.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;transition:opacity 900ms ease;z-index:9000;display:flex;align-items:center;justify-content:center;color:#c9b9a6;font:600 20px Cinzel,serif;letter-spacing:0.08em;pointer-events:all;';
        el.textContent = 'You black out…';
        document.body.appendChild(el);
        requestAnimationFrame(() => { el.style.opacity = '0.94'; });
        setTimeout(() => {
            try { then(); } finally {
                el.style.opacity = '0';
                setTimeout(() => el.remove(), 950);
            }
        }, ms);
    },

    /** Is the player lying senseless? (Input and blows wait.) */
    playerKnockedOut() { return !!this._playerOut; },

    _killNPC(npc, game) {
        // Remove from inner map NPC list: the body is left where they fell
        if (InnerMap.npcs) {
            const idx = InnerMap.npcs.findIndex(n => n.id === npc.id);
            if (idx >= 0) InnerMap.npcs.splice(idx, 1);
        }
        this._leaveBody(npc, game);
        InnerMapReactions._responders.delete(npc.id);

        // "Defeated" text
        const T = InnerMapRenderer.TILE_SIZE;
        this._spawnFloat(npc.q * T + T / 2, npc.r * T, 0, 'killed', npc.name);

        // Clean up health and reaction state
        this._npcHealth.delete(npc.id);
        this._npcReactions.delete(npc.id);

        // ── Family ripple: relatives grieve and hate the killer ──
        const ripple = NpcDisposition.onNpcHarmed(npc, InnerMap.npcs || [], 'murder');
        if (ripple.affected.length > 0 && game && game.ui) {
            const kin = ripple.affected.filter(a => a.relation !== 'friend').length;
            game.ui.showNotification('🖤 A Family Grieves',
                `${npc.name}'s ${kin > 0 ? `family (${kin})` : 'friends'} will never forgive you.`, 'warning');
        }

        // ── The street sees it (or doesn't): witnesses react, the murder is
        //    recorded (rumour with the real witnesses, heat, karma) and remembered ──
        const seen = game && game.player && game.world ? InnerMapReactions.onViolence(game, npc, 'murder') : null;

        // A townsperson dies on the town's roster: they will not be about next visit
        if (npc._person && npc._folk) {
            const by = seen && seen.witnessed ? `at the hands of ${(game && game.player && game.player.name) || 'a stranger'}` : 'killed in the street by someone no one saw';
            Townsfolk.slay(npc._folk, npc._person, this._day(game), by);
            // ...and the town's annals keep it, so the folk tell of it (townNews)
            Townsfolk.record(npc._folk, game && game.world, this._day(game), { k: 'died', a: npc._person.id, x: by });
        }

        // What they carried stays on the body until someone searches it
        if (game && game.ui) {
            game.ui.showNotification(
                `💀 ${npc.name} has fallen`,
                `${npc.name} lies dead in the street. Click the body to search it, carry it off or bury it.`,
                'warning'
            );
        }
    },

    /** Go through a body's pockets: the coin they carried and some of their wares. */
    searchBody(body, game) {
        if (!body || body.searched) return null;
        body.searched = true;
        const npc = body._npc;
        const { gold, items } = npc ? this._takeSpoils(npc, game) : { gold: 0, items: [] };
        const parts = [];
        if (gold > 0) parts.push(`${gold} gold`);
        for (const it of items) parts.push(`${it.qty} ${String(it.id).replace(/_/g, ' ')}`);
        if (game && game.ui) {
            if (typeof game.ui.updateStats === 'function' && game.player) game.ui.updateStats(game.player, game.world);
            game.ui.showNotification(`🖐️ ${body.name}'s pockets`,
                parts.length ? `You take ${parts.join(', ')}.` : 'Their pockets are empty.', parts.length ? 'success' : 'info');
        }
        return { gold, items };
    },

    /** Take a body off the street (buried). */
    removeBody(body) {
        const i = this._corpses.indexOf(body);
        if (i >= 0) this._corpses.splice(i, 1);
        if (this._carrying === body) this._carrying = null;
    },

    /** Put a body (dug back up) on the street again, already fallen. */
    restoreBody(body, q, r, day) {
        const b = { ...body, q, r, day, key: this._mapKey(), at: _nowMs() - 60000 };
        this._corpses.push(b);
        return b;
    },

    // ══════════════════════════════════════════════
    // OBJECT HIT HOOK
    // Called from game.js when InnerMap.updateInteraction
    // returns { hit, damage, healthPct }
    // ══════════════════════════════════════════════

    onObjectHit(anchorQ, anchorR, damage, healthPct) {
        const T = InnerMapRenderer.TILE_SIZE;
        this._spawnFloat(
            anchorQ * T + T / 2,
            anchorR * T + T * 0.1,
            damage,
            'object'
        );
        this._spawnHitFlash(anchorQ * T + T / 2, anchorR * T + T / 2);
    },

    // ══════════════════════════════════════════════
    // NPC REACTION AI
    // ══════════════════════════════════════════════

    /**
     * Decide whether the NPC fights back or flees, and set up the initial state.
     * Called once at the start of each new NPC attack.
     */
    _initiateNPCReaction(npc, game) {
        if (this._npcReactions.has(npc.id)) return; // already reacting

        // Stand or run: the townsperson's duel profile and temperament against
        // how dangerous the player looks and how hurt they already are
        const me = game && game.player ? Duels.fromPlayer(game.player, { mods: PlayerEffects.duelModifiers(game.player), fresh: true }) : null;
        const hp = this._npcHealth.get(npc.id);
        const { stance } = npc._taskFoe ? { stance: 'fight' } : Duels.brawlStance(npc, { playerAttack: me ? me.attack : 0, hpFrac: hp && hp.max ? hp.current / hp.max : 1 });
        if (stance === 'fight') {
            // ── Fighter: attack back ──
            this._npcReactions.set(npc.id, {
                mode: 'fight',
                attackTimer: this.NPC_ATTACK_INTERVAL, // delay before first counter-hit
            });
            // Stop whatever they were doing, turn on the player, and keep coming
            npc.path = null;
            npc.moveProgress = 0;
            npc._targetBuilding = null;
            if (npc.state === 'walking') npc.state = 'idle';
            npc.idleTimer = Math.max(npc.idleTimer || 0, 5);
            npc.facing = InnerMapCharacters.getDirection(InnerMap.playerInnerQ - npc.q, InnerMap.playerInnerR - npc.r);
            if (!npc._taskFoe) InnerMapReactions._respond(npc, 'fight', null);
            if (game && game.ui) {
                game.ui.showNotification(
                    `⚔️ ${npc.name} fights back!`,
                    `${npc.name} draws their weapon and retaliates!`,
                    'error'
                );
            }
        } else {
            // ── Coward: run for the edge of the map (at a run) ──
            this._npcReactions.set(npc.id, { mode: 'flee' });
            InnerMapReactions._flee(npc, { indoors: !!InnerMap._insideBuilding });

            if (game && game.ui) {
                game.ui.showNotification(
                    `🏃 ${npc.name} flees!`,
                    `${npc.name} turns and runs away in fear!`,
                    'warning'
                );
            }
        }
    },

    /**
     * Tick NPC reaction states every frame.
     * Handles fighting NPCs counter-attacking and cleaning up gone NPCs.
     */
    _updateNPCReactions(deltaTime, game) {
        if (this._npcReactions.size === 0) return;

        const toRemove = [];
        for (const [npcId, reaction] of this._npcReactions) {
            // Check NPC still exists on the map
            const npc = InnerMap.npcs && InnerMap.npcs.find(n => n.id === npcId);
            if (!npc) { toRemove.push(npcId); continue; }

            if (reaction.mode === 'flee') {
                // Path is already assigned; just wait for natural removal
                continue;
            }

            // mode === 'fight' — counter-attack the player
            const dist = Math.max(
                Math.abs(InnerMap.playerInnerQ - npc.q),
                Math.abs(InnerMap.playerInnerR - npc.r)
            );
            if (dist > 1) {
                // Player moved out of range; NPC stops pursuing
                toRemove.push(npcId);
                continue;
            }

            reaction.attackTimer -= deltaTime;
            if (reaction.attackTimer > 0) continue;
            reaction.attackTimer = this.NPC_ATTACK_INTERVAL;

            // Deal damage to the player
            const player = game && game.player;
            if (!player) continue;
            npc._swingAt = _nowMs();

            // Their aim (their level in what they fight with) against your
            // parry (Blades) or footwork (Brawling)
            const T0 = InnerMapRenderer.TILE_SIZE;
            if (Utils.random() >= this._npcAttackChance(npc, game)) {
                this._spawnFloat(InnerMap.playerInnerQ * T0 + T0 / 2, InnerMap.playerInnerR * T0 + T0 * 0.1, 0, 'normal', 'Miss');
                continue;
            }
            const guard = this._playerDefence(player);
            if (guard.chance > 0 && Utils.random() < guard.chance) {
                this._spawnFloat(InnerMap.playerInnerQ * T0 + T0 / 2, InnerMap.playerInnerR * T0 + T0 * 0.1, 0, 'normal', guard.word);
                this._skillXp(game, guard.skill, guard.skill === 'blades' ? 'parry' : 'dodge');
                // A master answers a parry at once
                const ia = this._attackState;
                if (guard.riposte && ia && ia.npc && ia.npc.id === npc.id) ia.swingTimer = ia.swingInterval;
                continue;
            }

            // The blow comes from their duel profile (strength, weapon); armour
            // and Divine Protection soften it
            const dmg      = PlayerEffects.scaleDamage(player, Duels.npcSwing(npc));

            // Beaten to nothing, the player blacks out — and the attacker decides (systems/knockout.js)
            player.health = Math.max(0, player.health - dmg);
            if (player.health <= 0) {
                this._knockOutPlayer(game, npc);
                return;
            }
            // A hard blow can leave a lasting wound (systems/ailments.js)
            const wound = dmg > 0 ? Ailments.maybeWound(player, game.world, 'brawl') : null;
            if (wound && game.ui && typeof game.ui.showNotification === 'function') {
                game.ui.showNotification(`${wound.icon} Wounded`, `${npc.name || 'Your attacker'} leaves you with ${/^[aeiou]/i.test(wound.name) ? 'an' : 'a'} ${wound.name.toLowerCase()}.`, 'warning');
            }

            // Refresh HUD
            if (game.ui && typeof game.ui.updateStats === 'function') {
                game.ui.updateStats(player, game.world);
            }

            // Floating hit on the player
            const T = InnerMapRenderer.TILE_SIZE;
            this._spawnFloat(
                InnerMap.playerInnerQ * T + T / 2,
                InnerMap.playerInnerR * T + T * 0.1,
                dmg,
                'player_hit'
            );
            this._spawnHitFlash(
                InnerMap.playerInnerQ * T + T / 2,
                InnerMap.playerInnerR * T + T / 2
            );

            // NPC faces the player
            const dq = InnerMap.playerInnerQ - npc.q;
            const dr = InnerMap.playerInnerR - npc.r;
            if (typeof InnerMapCharacters !== 'undefined') {
                npc.facing = InnerMapCharacters.getDirection(dq, dr);
            }
        }

        for (const id of toRemove) this._npcReactions.delete(id);
    },

    /**
     * Apply relationship score penalties when the player attacks an NPC.
     * Victim loses ~35 points; witnesses within 3 tiles each lose ~15 points.
     * Called once per new attack, not once per swing.
     */
    applyAttackRelationshipPenalties(game, attackedNpc) {
        if (!game || !game.player || typeof Relationships === 'undefined') return;

        const player         = game.player;
        const VICTIM_PENALTY  = -35;
        const WITNESS_PENALTY = -15;
        const WITNESS_RADIUS  = 3;
        const day = (game.world && game.world.day) || 0;

        // ── Victim penalty ──
        const victimRel = Relationships.getRelationship(player, attackedNpc.id);
        if (victimRel) {
            victimRel.score = Math.max(-100, victimRel.score + VICTIM_PENALTY);
            if (Array.isArray(victimRel.history)) {
                victimRel.history.push({ day, event: 'player_attacked_me', delta: VICTIM_PENALTY });
            }
        }

        // ── Witness penalties ──
        let witnessCount = 0;
        for (const witness of (InnerMap.npcs || [])) {
            if (witness.id === attackedNpc.id) continue;
            const dist = Math.max(
                Math.abs(witness.q - attackedNpc.q),
                Math.abs(witness.r - attackedNpc.r)
            );
            if (dist > WITNESS_RADIUS) continue;

            const witRel = Relationships.getRelationship(player, witness.id);
            if (witRel) {
                witRel.score = Math.max(-100, witRel.score + WITNESS_PENALTY);
                if (Array.isArray(witRel.history)) {
                    witRel.history.push({ day, event: 'witnessed_player_attack', delta: WITNESS_PENALTY });
                }
                witnessCount++;
            }
        }

        // ── Notify the player ──
        if (game.ui) {
            const rl = typeof Relationships.getRelationLabel === 'function'
                ? Relationships.getRelationLabel(victimRel ? victimRel.score : -35)
                : null;
            const label = rl && typeof rl === 'object' ? rl.label : (rl || '');
            const witMsg = witnessCount > 0
                ? ` ${witnessCount} witness${witnessCount > 1 ? 'es' : ''} also react negatively.`
                : '';
            game.ui.showNotification(
                '😡 Reputation damaged',
                `Your relationship with ${attackedNpc.name} has worsened${label ? ` (${label})` : ''}!${witMsg}`,
                'error'
            );
        }
    },

    // ══════════════════════════════════════════════
    // HELPERS
    // ══════════════════════════════════════════════

    /**
     * Base damage of the player's swing, from the duel engine: strength and
     * the best weapon carried (counted double), times traits, wounds and
     * sickness, mood and carried treasures.
     */
    _computePlayerDamage(player) {
        if (!player) return 3;
        const me = Duels.fromPlayer(player, { mods: PlayerEffects.duelModifiers(player), fresh: true });
        return Duels.swingBase(me);
    },

    _day(game) {
        return (game && game.world && game.world.day) || 0;
    },

    // ── Practised fighting skills (systems/combatSkills.js) ─────

    /** Blades or Brawling: what the player fights with now (null without the skills). */
    _playerFightSkill(player) {
        if (!player || !CombatSkills.has('blades')) return null;
        return CombatSkills.weaponSkill(Duels.playerWeapon(player).id);
    },

    /** An NPC's guard against the player's swings: { chance, word } from their parry or footwork. */
    _npcGuard(npc, foe, game) {
        if (!npc || !CombatSkills.has('blades')) return { chance: 0, word: null };
        const sk = (foe && foe.fightSkill) || 'blades';
        const perk = sk === 'brawling' ? 'dodge' : 'parry';
        return { chance: CombatSkills.npcPerk(npc, sk, perk, game && game.world) / 100, word: sk === 'brawling' ? 'Slipped' : 'Parried' };
    },

    /** The share of the player's swings that land. */
    _playerHitChance(player, sk, guard) {
        const I = CombatSkills.config().inner;
        const c = CombatSkills.chance(player, sk, 'hit') - (guard ? guard.chance : 0);
        return Math.max(I.minHit, Math.min(I.maxHit, c));
    },

    /** The share of an NPC's blows that would land (before the player's parry/slip). */
    _npcAttackChance(npc, game) {
        if (!CombatSkills.has('blades')) return 1;
        const I = CombatSkills.config().inner;
        const foe = Duels.fromNpc(npc, { world: game && game.world });
        const sk = foe.fightSkill || 'blades';
        const c = CombatSkills.npcPerk(npc, sk, 'hit', game && game.world) / 100 + (Number(I.npcHitBonus) || 0);
        return Math.max(I.minHit, Math.min(I.maxHit, c));
    },

    /** The player's guard against a blow: { chance, word, skill, riposte }. */
    _playerDefence(player) {
        const sk = this._playerFightSkill(player);
        if (!sk) return { chance: 0 };
        if (sk === 'brawling') return { chance: CombatSkills.chance(player, 'brawling', 'dodge'), word: 'Slipped', skill: sk, riposte: false };
        return { chance: CombatSkills.chance(player, 'blades', 'parry'), word: 'Parried', skill: sk, riposte: CombatSkills.perk(player, 'blades', 'riposte') > 0 };
    },

    /** XP for a fighting skill by what happened (data skills.<id>.xp), and the level-up announced. */
    _skillXp(game, sk, key) {
        const player = game && game.player;
        if (!sk || !player) return;
        this._announceSkill(game, CombatSkills.trainBy(player, sk, key));
    },

    _announceSkill(game, ev) {
        if (!ev || !game || !game.ui || typeof game.ui.showNotification !== 'function') return;
        game.ui.showNotification(`${ev.icon} ${ev.name} Improved`, ev.text, 'success');
    },

    /** Take a fallen NPC's purse (kept on a townsperson's roster entry) and some wares. */
    _takeSpoils(npc, game) {
        const player = game && game.player;
        const range = Duels.purseRange(npc.type);
        let gold = 0;
        if (npc._person && npc._folk) {
            gold = Townsfolk.takePurse(npc._folk, npc._person, game.world, range);
        } else {
            if (typeof npc._purse !== 'number') npc._purse = Utils.randInt(range[0], range[1]);
            gold = npc._purse;
            npc._purse = 0;
        }
        const items = [];
        if (player) {
            player.gold = (player.gold || 0) + gold;
            for (const it of Duels.brawlSpoils(npc)) {
                const r = PlayerInventory.addItem(player, it.id, it.qty);
                if (r.success) {
                    items.push(it);
                    if (npc.shopInventory && npc.shopInventory[it.id]) npc.shopInventory[it.id].qty -= it.qty;
                }
            }
        }
        return { gold, items };
    },

    _spawnFloat(worldX, worldY, value, type = 'normal', label = null) {
        this._floatNumbers.push({
            worldX, worldY,
            offsetY: 0,       // screen-space extra Y applied at render
            value,
            type,
            label,
            age: 0,
            maxAge: this.FLOAT_DURATION,
        });
    },

    _spawnHitFlash(worldX, worldY) {
        this._hitFlashes.push({
            worldX, worldY,
            age: 0,
            maxAge: this.HIT_FLASH_DURATION,
            angle: Math.random() * Math.PI * 2,
        });
    },

    /** Which map a body lies on: the town (or wild tile), and the building if indoors. */
    _mapKey() {
        const wt = InnerMap.currentWorldTile || {};
        const b = InnerMap._insideBuilding;
        return `${wt.q},${wt.r}|${b ? `${b.q},${b.r}` : 'out'}`;
    },

    /** Leave a body where the NPC fell. */
    _leaveBody(npc, game) {
        this._corpses.push({
            name: npc.name, type: npc.type, icon: npc.icon,
            preset: npc.preset || (InnerMapCharacters.isReady() ? InnerMapCharacters.getPresetForNPC(npc.type, npc.id, npc.gender) : null),
            q: npc.q, r: npc.r,
            // Fall away from the player
            side: InnerMap.playerInnerQ > npc.q ? -1 : 1,
            at: _nowMs(), day: this._day(game), key: this._mapKey(),
            _npc: npc, searched: false,
        });
        if (this._corpses.length > this.MAX_CORPSES) this._corpses.splice(this._corpses.findIndex(c => c !== this._carrying), 1);
    },

    /** Bodies on the map the player is on (one found is carried off by the day after next). */
    corpsesHere() {
        const key = this._mapKey();
        this._corpses = this._corpses.filter(c => c === this._carrying || this._today - c.day <= 1);
        return this._corpses.filter(c => c.key === key);
    },

    /**
     * A body held over the player's shoulders: lying crosswise, centred on
     * (sx, sy) (the shoulders), no blood and no name.
     */
    drawCarriedCorpse(ctx, camera, c, sx, sy) {
        const T = InnerMapRenderer.TILE_SIZE;
        const ds = T * camera.zoom;
        const scale = (c.type === 'child' ? 0.7 : 1) * 0.8;
        ctx.save();
        if (c.preset && InnerMapCharacters.isReady() && InnerMapCharacters.getComposited(c.preset)) {
            const cw = ds * 1.2 * scale, ch = ds * 1.8 * scale;
            ctx.translate(sx, sy);
            ctx.rotate(c.side * (Math.PI / 2));
            ctx.filter = 'grayscale(0.45) brightness(0.75)';
            InnerMapCharacters.drawCharacter(ctx, c.preset, 'idle', InnerMapCharacters.DIR_DOWN, 0, -cw / 2, -ch / 2, cw, ch);
            ctx.filter = 'none';
        } else {
            drawGlyph(ctx, 'skull', sx, sy, Math.max(10, ds * 0.35), '#d8cfc4', 2);
        }
        ctx.restore();
    },

    /** A body lying on the ground: falls over, a pool of blood spreads under it. */
    drawCorpse(ctx, camera, c, sx, sy) {
        const T = InnerMapRenderer.TILE_SIZE;
        const ds = T * camera.zoom;
        const age = _nowMs() - c.at;
        const fall = Math.min(1, age / 450);
        const ease = 1 - (1 - fall) * (1 - fall);
        // The blood stays where they fell: a body carried elsewhere leaves none
        const pool = c.moved ? 0 : Math.min(1, age / 3000);
        const scale = c.type === 'child' ? 0.7 : 1;
        ctx.save();
        if (pool > 0) {
            ctx.beginPath();
            // Spreads out from under the body (lying across its own tile)
            ctx.ellipse(sx, sy + ds * 0.12, ds * 0.62 * pool * scale, ds * 0.3 * pool * scale, 0, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(120, 10, 10, 0.72)';
            ctx.fill();
        }
        const useSprite = c.preset && InnerMapCharacters.isReady() && InnerMapCharacters.getComposited(c.preset);
        if (useSprite) {
            // Falls over to lie across its own tile (centred on it, so a click
            // anywhere on the body is a click on its tile)
            const cw = ds * 1.2 * scale * 0.85, ch = ds * 1.8 * scale * 0.85;
            ctx.translate(sx, sy - ds * 0.35 * (1 - ease));
            ctx.rotate(c.side * (Math.PI / 2) * ease);
            ctx.filter = `grayscale(${0.45 * ease}) brightness(${1 - 0.25 * ease})`;
            InnerMapCharacters.drawCharacter(ctx, c.preset, 'idle', InnerMapCharacters.DIR_DOWN, 0, -cw / 2, -ch / 2, cw, ch);
            ctx.filter = 'none';
        } else {
            ctx.globalAlpha = 0.85;
            drawGlyph(ctx, 'skull', sx, sy, Math.max(10, ds * 0.4), '#d8cfc4', 2);
        }
        ctx.restore();
        if (camera.zoom > 0.7 && fall >= 1) {
            drawMapText(ctx, `\u2020 ${c.name}`, sx, sy + ds * 0.3, {
                size: 10 * labelZoom(camera.zoom), min: 9, weight: 600, family: 'body', baseline: 'top', color: 'rgba(214, 196, 186, 0.7)',
            });
        }
    },

    /**
     * Someone beaten senseless: fallen across their own tile like a body, but
     * no blood and no greying — and little stars turning over them.
     */
    drawKnockedOut(ctx, camera, npc, sx, sy) {
        const T = InnerMapRenderer.TILE_SIZE;
        const ds = T * camera.zoom;
        const ko = npc._ko || { at: 0, side: 1 };
        const fall = Math.min(1, (_nowMs() - ko.at) / 400);
        const ease = 1 - (1 - fall) * (1 - fall);
        const scale = npc.type === 'child' ? 0.7 : 1;
        ctx.save();
        const useSprite = npc.preset && InnerMapCharacters.isReady() && InnerMapCharacters.getComposited(npc.preset);
        if (useSprite) {
            const cw = ds * 1.2 * scale * 0.85, ch = ds * 1.8 * scale * 0.85;
            ctx.translate(sx, sy - ds * 0.35 * (1 - ease));
            ctx.rotate(ko.side * (Math.PI / 2) * ease);
            InnerMapCharacters.drawCharacter(ctx, npc.preset, 'idle', InnerMapCharacters.DIR_DOWN, 0, -cw / 2, -ch / 2, cw, ch);
        } else {
            ctx.globalAlpha = 0.85;
            drawGlyph(ctx, 'skull', sx, sy, Math.max(10, ds * 0.4), '#d8cfc4', 2);
        }
        ctx.restore();
        if (fall >= 1) {
            // Stars circling the head (the head lies toward the side they fell)
            const t = _nowMs() / 1000;
            const hx = sx + ko.side * ds * 0.45 * scale, hy = sy - ds * 0.15;
            ctx.save();
            ctx.fillStyle = '#ffe08a';
            ctx.font = `${Math.max(9, Math.round(ds * 0.22))}px sans-serif`;
            ctx.textAlign = 'center';
            for (let i = 0; i < 3; i++) {
                const a = t * 2.4 + i * (Math.PI * 2 / 3);
                ctx.globalAlpha = 0.6 + 0.4 * Math.sin(a);
                ctx.fillText('✦', hx + Math.cos(a) * ds * 0.22, hy + Math.sin(a) * ds * 0.08 - ds * 0.12);
            }
            ctx.restore();
        }
        if (camera.zoom > 0.7 && fall >= 1) {
            drawMapText(ctx, `${npc.name} (senseless)`, sx, sy + ds * 0.3, {
                size: 10 * labelZoom(camera.zoom), min: 9, weight: 600, family: 'body', baseline: 'top', color: 'rgba(255, 224, 138, 0.8)',
            });
        }
    },

    getNPCHealth(npcId) {
        return this._npcHealth.get(npcId) || null;
    },

    // ══════════════════════════════════════════════
    // RENDERING
    // ══════════════════════════════════════════════

    /**
     * Render health bar above an entity's screen position.
     * worldX/Y: world-pixel center-top of the entity (where feet meet ground for NPCs).
     * charH:    screen-pixel height of the character sprite.
     */
    renderHealthBar(ctx, camera, worldX, worldY, currentHp, maxHp, charH) {
        const pct = Math.max(0, Math.min(1, currentHp / maxHp));
        if (pct >= 1.0) return;   // hide full-health bars

        const screen = camera.worldToScreen(worldX, worldY);
        const T = InnerMapRenderer.TILE_SIZE;
        const ds = T * camera.zoom;

        const barW  = ds * 0.95;
        const barH  = Math.max(3, ds * 0.075);
        const bx    = screen.x - barW / 2;
        const by    = screen.y - (charH || ds * 1.4) - barH - 2;

        // Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);

        // Empty
        ctx.fillStyle = '#330d0d';
        ctx.fillRect(bx, by, barW, barH);

        // Filled
        const color = pct > 0.6 ? '#3dcc3d' : pct > 0.3 ? '#cc9922' : '#cc2222';
        ctx.fillStyle = color;
        ctx.fillRect(bx, by, barW * pct, barH);

        // Gloss top strip
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.fillRect(bx, by, barW * pct, Math.max(1, barH * 0.35));

        // HP text (only if bar is wide enough)
        if (barW >= 30) {
            drawMapText(ctx, `${Math.ceil(currentHp)}/${maxHp}`, screen.x, by + barH / 2, {
                size: barH, min: 9, weight: 700, family: 'body', color: '#ffffff',
            });
        }
    },

    /**
     * Render health bar for a custom object above its anchor tile.
     */
    renderObjectHealthBar(ctx, camera, anchorQ, anchorR, currentHealthPct) {
        if (currentHealthPct == null || currentHealthPct >= 100) return;
        const T = InnerMapRenderer.TILE_SIZE;
        const ds = T * camera.zoom;
        const screen = camera.worldToScreen(anchorQ * T + T / 2, anchorR * T);

        const barW  = ds * 1.1;
        const barH  = Math.max(3, ds * 0.075);
        const bx    = screen.x - barW / 2;
        const by    = screen.y - ds * 0.15 - barH;
        const pct   = Math.max(0, Math.min(1, currentHealthPct / 100));

        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);

        ctx.fillStyle = '#2a1000';
        ctx.fillRect(bx, by, barW, barH);

        const color = pct > 0.6 ? '#70cc40' : pct > 0.3 ? '#ddaa22' : '#dd3322';
        ctx.fillStyle = color;
        ctx.fillRect(bx, by, barW * pct, barH);

        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(bx, by, barW * pct, Math.max(1, barH * 0.35));
    },

    /**
     * Render all floating damage numbers and hit flash effects.
     * Call this AFTER the depth-sorted sprite pass so it sits on top.
     */
    render(ctx, camera) {
        if (!InnerMap.active) return;

        const T  = InnerMapRenderer.TILE_SIZE;

        // ── Hit flashes ──────────────────────────────────────
        for (const hf of this._hitFlashes) {
            const p      = hf.age / hf.maxAge;
            const alpha  = Math.max(0, 1 - p);
            const screen = camera.worldToScreen(hf.worldX, hf.worldY);
            const ds     = T * camera.zoom;
            const radius = (6 + p * 18) * camera.zoom;

            ctx.save();
            ctx.globalAlpha = alpha * 0.75;

            // Radial burst
            const grad = ctx.createRadialGradient(screen.x, screen.y, 0, screen.x, screen.y, radius);
            grad.addColorStop(0,   'rgba(255, 140, 70, 0.95)');
            grad.addColorStop(0.4, 'rgba(255, 210, 100, 0.70)');
            grad.addColorStop(1,   'rgba(255, 60,  30,  0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
            ctx.fill();

            // Slash lines (two crossing arcs)
            ctx.globalAlpha = alpha * 0.85;
            ctx.strokeStyle = 'rgba(255, 230, 160, 1)';
            ctx.lineWidth   = Math.max(1, 2.0 * camera.zoom);
            ctx.lineCap     = 'round';

            const sl = radius * 0.85;
            const a  = hf.angle;
            ctx.beginPath();
            ctx.moveTo(screen.x + Math.cos(a)         * sl * 0.2, screen.y + Math.sin(a)         * sl * 0.2);
            ctx.lineTo(screen.x + Math.cos(a + Math.PI) * sl,     screen.y + Math.sin(a + Math.PI) * sl);
            ctx.moveTo(screen.x + Math.cos(a + 0.9)   * sl * 0.15, screen.y + Math.sin(a + 0.9)  * sl * 0.15);
            ctx.lineTo(screen.x + Math.cos(a + 0.9 + Math.PI) * sl * 0.9,
                        screen.y + Math.sin(a + 0.9 + Math.PI) * sl * 0.9);
            ctx.stroke();

            ctx.restore();
        }

        // ── Floating damage numbers ───────────────────────────
        for (const fn of this._floatNumbers) {
            const p      = fn.age / fn.maxAge;
            // Fade in first 10%, stay full opacity until 70%, then fade out
            const alpha  = p < 0.10 ? p / 0.10
                         : p < 0.70 ? 1.0
                         : 1.0 - (p - 0.70) / 0.30;

            const screen = camera.worldToScreen(fn.worldX, fn.worldY);
            const sx = screen.x;
            const sy = screen.y + fn.offsetY;

            ctx.save();
            ctx.globalAlpha = Math.max(0, alpha);
            ctx.textAlign   = 'center';
            ctx.textBaseline = 'middle';

            const style = FLOAT_STYLES[fn.type] || FLOAT_STYLES.hit;
            const size = style.size * labelZoom(camera.zoom);
            const pop = style.pop ? 1.0 + Math.max(0, (style.pop[0] - p) / style.pop[0]) * style.pop[1] : 1;
            ctx.translate(sx, sy);
            ctx.scale(pop, pop);
            if (fn.type === 'killed') {
                // Banner: a skull and "Defeated"
                const px = textPx(size, style.min);
                ctx.font = `800 ${px}px 'Inter', sans-serif`;
                const left = -(px * 1.6 + ctx.measureText('Defeated').width) / 2;
                drawGlyph(ctx, 'skull', left + px * 0.65, 0, px * 1.3, style.color, 2.2);
                drawMapText(ctx, 'Defeated', left + px * 1.6, 0, { size, min: style.min, family: 'body', weight: 800, color: style.color, align: 'left' });
            } else if (fn.label && !fn.value) {
                // A miss, a parry, a slip (systems/combatSkills.js)
                drawMapText(ctx, fn.label, 0, 0, { size, min: style.min, family: 'body', weight: 800, color: '#d8e4ee' });
            } else if (fn.label) {
                // A move that landed: the number and what it was (a power swing, a stagger)
                drawMapText(ctx, `\u2212${fn.value}`, 0, 0, { size, min: style.min, family: 'body', weight: 800, color: style.color });
                drawMapText(ctx, fn.label, 0, textPx(size, style.min) * 1.05, { size: size * 0.8, min: style.min - 2, family: 'body', weight: 800, color: '#ffd27a' });
            } else {
                drawMapText(ctx, `\u2212${fn.value}${style.bang ? '!' : ''}`, 0, 0, {
                    size, min: style.min, family: 'body', weight: 800, color: style.color,
                });
            }

            ctx.restore();
        }

        // ── Witnesses' barks over their heads ──
        InnerMapReactions.render(ctx, camera);
    },
};
