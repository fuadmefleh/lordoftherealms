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
//   - NPC health tracked per-session (lost on re-entry)
//   - Auto-cancel when target moves out of range
// ============================================

import { InnerMap } from '../world/innerMap.js';
import { InnerMapRenderer } from './innerMapRenderer.js';
import { InnerMapCharacters } from './innerMapCharacters.js';
import { Relationships } from '../systems/relationships.js';
import { CustomObjects } from '../world/customObjects.js';


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

    // NPC types that fight back (vs. flee)
    FIGHTER_NPC_TYPES: new Set(['guard', 'blacksmith_npc', 'noble']),

    // How often a fighting NPC counter-attacks (seconds)
    NPC_ATTACK_INTERVAL: 0.7,

    // Base damage fighting NPCs deal per swing
    NPC_DAMAGE_BY_TYPE: {
        guard:          18,
        blacksmith_npc: 14,
        noble:          10,
    },

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
        // Initialise health if first encounter
        if (!this._npcHealth.has(npc.id)) {
            const maxHp = this.NPC_BASE_HEALTH[npc.type] || 60;
            this._npcHealth.set(npc.id, { current: maxHp, max: maxHp });
        }

        const dmg = this._computePlayerDamage(game.player);
        this._attackState = {
            targetType: 'npc',
            npc,
            swingTimer: 0,          // counts up — hits on each interval
            swingInterval: 0.5,     // seconds between swings
            baseDamage: dmg,
            game,
            _notified: false,
        };

        // Face the NPC immediately
        const dq = npc.q - InnerMap.playerInnerQ;
        const dr = npc.r - InnerMap.playerInnerR;
        InnerMapRenderer._playerFacing = InnerMapCharacters.getDirection(dq, dr);

        if (game && game.ui) {
            game.ui.showNotification(
                `⚔️ Attacking ${npc.name}`,
                `You start attacking ${npc.name}!`,
                'warning'
            );
        }

        // Trigger NPC reaction (fight back or flee) and apply relationship penalties
        this._initiateNPCReaction(npc, game);
        this.applyAttackRelationshipPenalties(game, npc);
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

        const variance = 0.875 + Math.random() * 0.25;
        const rawDmg   = Math.max(1, ia.baseDamage * variance);
        const dmg      = Math.round(rawDmg);
        const isCrit   = rawDmg > ia.baseDamage * 1.18;
        health.current = Math.max(0, health.current - dmg);

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

        // Small loot drop
        if (game && game.ui) {
            const loot = Math.floor(Math.random() * 12 + 2);
            if (game.player) {
                game.player.gold += loot;
                if (typeof game.ui.updateStats === 'function')
                    game.ui.updateStats(game.player, game.world);
            }
            game.ui.showNotification(
                `💀 ${npc.name} defeated!`,
                `${npc.icon || '⚔️'} ${npc.name} has fallen. You found ${loot} gold.`,
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

        if (this.FIGHTER_NPC_TYPES.has(npc.type)) {
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

            const baseDmg  = this.NPC_DAMAGE_BY_TYPE[npc.type] || 8;
            const variance = 0.75 + Math.random() * 0.5;
            const dmg      = Math.max(1, Math.round(baseDmg * variance));

            // Floor at 1 so the player can’t be outright killed by the trigger
            player.health = Math.max(1, player.health - dmg);

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
            const label = typeof Relationships.getRelationLabel === 'function'
                ? Relationships.getRelationLabel(victimRel ? victimRel.score : -35)
                : '';
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

    _computePlayerDamage(player) {
        const str  = (player && player.strength) || 5;
        const luck = (player && player.luck)     || 5;
        return Math.max(3, str * 2 + Math.floor(luck * 0.4));
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
            const fontSize = Math.max(6, Math.floor(barH * 1.0));
            ctx.font = `bold ${fontSize}px 'Inter', monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = 'rgba(0,0,0,0.9)';
            ctx.shadowBlur = 2;
            ctx.fillText(`${Math.ceil(currentHp)}/${maxHp}`, screen.x, by + barH / 2);
            ctx.shadowBlur = 0;
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

            if (fn.type === 'killed') {
                // Big "Defeated!" banner
                const fs = Math.max(10, 13 * camera.zoom);
                ctx.font = `bold ${fs}px 'Inter', sans-serif`;
                // Shadow
                ctx.fillStyle  = 'rgba(0,0,0,0.7)';
                ctx.fillText('💀 Defeated', sx + 1, sy + 1);
                ctx.fillStyle  = '#ff4455';
                ctx.fillText('💀 Defeated', sx, sy);

            } else if (fn.type === 'critical') {
                // Larger, orange "−dmg!" crit numbers
                const fs = Math.max(12, 15 * camera.zoom);
                // Subtle pop scale effect (scale up at start)
                const scale = 1.0 + Math.max(0, (0.3 - p) / 0.3) * 0.5;
                ctx.save();
                ctx.translate(sx, sy);
                ctx.scale(scale, scale);
                ctx.font = `bold ${fs}px 'Inter', sans-serif`;
                ctx.fillStyle  = 'rgba(0,0,0,0.7)';
                ctx.fillText(`−${fn.value}!`, 1, 1);
                ctx.fillStyle  = '#ffaa22';
                ctx.fillText(`−${fn.value}!`, 0, 0);
                ctx.restore();

            } else if (fn.type === 'object') {
                // Green numbers for object damage (harvesting / chopping)
                const fs = Math.max(9, 11 * camera.zoom);
                ctx.font  = `bold ${fs}px 'Inter', sans-serif`;
                ctx.fillStyle  = 'rgba(0,0,0,0.6)';
                ctx.fillText(`−${fn.value}`, sx + 1, sy + 1);
                ctx.fillStyle  = '#88dd44';
                ctx.fillText(`−${fn.value}`, sx, sy);

            } else if (fn.type === 'player_hit') {
                // Hot magenta — incoming damage ON the player from a counter-attacking NPC
                const fs = Math.max(11, 14 * camera.zoom);
                const scale = 1.0 + Math.max(0, (0.25 - p) / 0.25) * 0.6;
                ctx.save();
                ctx.translate(sx, sy);
                ctx.scale(scale, scale);
                ctx.font = `bold ${fs}px 'Inter', sans-serif`;
                ctx.fillStyle  = 'rgba(0,0,0,0.7)';
                ctx.fillText(`\u2212${fn.value}`, 1, 1);
                ctx.fillStyle  = '#ff44cc';
                ctx.fillText(`\u2212${fn.value}`, 0, 0);
                ctx.restore();

            } else {
                // Normal red damage numbers
                const fs = Math.max(9, 11 * camera.zoom);
                const scale = 1.0 + Math.max(0, (0.2 - p) / 0.2) * 0.3;
                ctx.save();
                ctx.translate(sx, sy);
                ctx.scale(scale, scale);
                ctx.font = `bold ${fs}px 'Inter', sans-serif`;
                ctx.fillStyle  = 'rgba(0,0,0,0.6)';
                ctx.fillText(`−${fn.value}`, 1, 1);
                ctx.fillStyle  = '#ff5555';
                ctx.fillText(`−${fn.value}`, 0, 0);
                ctx.restore();
            }

            ctx.restore();
        }
    },
};
