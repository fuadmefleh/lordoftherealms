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
//   - Auto-cancel when target moves out of range
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
import { PlayerInventory } from '../player/inventory.js';
import { Utils } from '../core/utils.js';
import { drawGlyph } from './icons.js';
import { InnerMapReactions } from './innerMapReactions.js';
import { drawMapText, labelZoom, textPx } from './mapInk.js';

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
        // Cancel whatever was happening before
        if (this._attackState) this.cancelAttack();
        InnerMap._activeInteraction = null;

        const dist = Math.max(
            Math.abs(InnerMap.playerInnerQ - npc.q),
            Math.abs(InnerMap.playerInnerR - npc.r)
        );

        if (dist > 1) {
            // Walk toward the NPC, then attack on arrival
            InnerMap._pendingCombat = { type: 'npc', npc, game };
            InnerMap.movePlayerTo(npc.q, npc.r);
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
            const dir = InnerMap.getDirectionToward(anchorQ, anchorR);
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

        const dmg = this._computePlayerDamage(game.player);
        this._attackState = {
            targetType: 'npc',
            npc,
            swingTimer: 0,          // counts up — hits on each interval
            swingInterval: 0.5,     // seconds between swings
            baseDamage: dmg,
            npcArmour: Duels.fromNpc(npc).armour,
            game,
            _notified: false,
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

    /** Cancel any active attack. */
    cancelAttack() {
        this._attackState = null;
    },

    // ══════════════════════════════════════════════
    // UPDATE — called each frame from game.js
    // ══════════════════════════════════════════════

    update(deltaTime, game) {
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

        // ── The street's reaction: guards and kin coming for the player ──
        InnerMapReactions.update(deltaTime, game);

        // ── Object combat: float numbers are spawned by onObjectHit ──
    },

    _updateNPCAttack(deltaTime, game) {
        const ia = this._attackState;
        if (!ia) return;

        // Check NPC still exists
        const npc = InnerMap.npcs && InnerMap.npcs.find(n => n.id === ia.npc.id);
        if (!npc) { this.cancelAttack(); return; }

        // Re-sync npc reference (position may have changed)
        ia.npc = npc;

        // Distance check — must be adjacent
        const dist = Math.max(
            Math.abs(InnerMap.playerInnerQ - npc.q),
            Math.abs(InnerMap.playerInnerR - npc.r)
        );
        if (dist > 1) {
            // NPC moved away — cancel silently
            this.cancelAttack();
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

        const variance = 0.875 + Utils.random() * 0.25;
        const rawDmg   = Math.max(1, ia.baseDamage * variance);
        // The NPC's armour (a guard's mail) turns part of the blow
        const dmg      = Math.max(1, Math.round(rawDmg * (1 - (ia.npcArmour || 0))));
        const isCrit   = rawDmg > ia.baseDamage * 1.09;
        health.current = Math.max(0, health.current - dmg);
        // A townsperson carries the beating with them (healed day by day)
        if (npc._person && health.current > 0) Townsfolk.injure(npc._person, this._day(game || ia.game), health.current, health.max);

        const T = InnerMapRenderer.TILE_SIZE;
        this._spawnFloat(
            npc.q * T + T / 2,
            npc.r * T + T * 0.1,
            dmg,
            isCrit ? 'critical' : 'normal'
        );
        this._spawnHitFlash(npc.q * T + T / 2, npc.r * T + T / 2);

        if (health.current <= 0) {
            this._killNPC(npc, game || ia.game);
            this.cancelAttack();
        }
    },

    _killNPC(npc, game) {
        // Remove from inner map NPC list
        if (InnerMap.npcs) {
            const idx = InnerMap.npcs.findIndex(n => n.id === npc.id);
            if (idx >= 0) InnerMap.npcs.splice(idx, 1);
        }

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

        // Loot: the coin they actually carried, and some of their wares
        if (game && game.ui) {
            const { gold, items } = this._takeSpoils(npc, game);
            const parts = [];
            if (gold > 0) parts.push(`${gold} gold`);
            for (const it of items) parts.push(`${it.qty} ${String(it.id).replace(/_/g, ' ')}`);
            if (typeof game.ui.updateStats === 'function' && game.player) game.ui.updateStats(game.player, game.world);
            game.ui.showNotification(
                `💀 ${npc.name} defeated!`,
                `${npc.icon || '⚔️'} ${npc.name} has fallen. ${parts.length ? `You take ${parts.join(', ')}.` : 'Their pockets are empty.'}`,
                'success'
            );
        }
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
        const { stance } = Duels.brawlStance(npc, { playerAttack: me ? me.attack : 0, hpFrac: hp && hp.max ? hp.current / hp.max : 1 });
        if (stance === 'fight') {
            // ── Fighter: attack back ──
            this._npcReactions.set(npc.id, {
                mode: 'fight',
                attackTimer: this.NPC_ATTACK_INTERVAL, // delay before first counter-hit
            });
            if (game && game.ui) {
                game.ui.showNotification(
                    `⚔️ ${npc.name} fights back!`,
                    `${npc.name} draws their weapon and retaliates!`,
                    'error'
                );
            }
        } else {
            // ── Coward: flee toward map edge ──
            this._npcReactions.set(npc.id, { mode: 'flee' });

            const edge = InnerMap._findNearestEdgeTile(npc.q, npc.r);
            if (edge) {
                const path = InnerMap._findPath(npc.q, npc.r, edge.q, edge.r);
                if (path && path.length > 1) {
                    npc.departing   = true; // auto-remove on arrival
                    npc.path        = path.slice(1);
                    npc.pathIndex   = 0;
                    npc.moveProgress = 0;
                    npc.prevQ       = npc.q;
                    npc.prevR       = npc.r;
                    npc.state       = 'walking';
                }
            }

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

            // The blow comes from their duel profile (strength, weapon); armour
            // and Divine Protection soften it
            const dmg      = PlayerEffects.scaleDamage(player, Duels.npcSwing(npc));

            // Floor at 1 so the player can’t be outright killed by the trigger
            player.health = Math.max(1, player.health - dmg);
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
