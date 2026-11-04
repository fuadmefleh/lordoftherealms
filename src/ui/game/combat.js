// ============================================
// COMBAT & MISC � playerPray, food purchase modal, death, hostile encounters, endDayConfirm
// ============================================

import { Camera, Renderer, Player, World, SaveLoad, Terrain, Banking, MarketDynamics, Taxation, Characters, Minimap, UI, Quests, Achievements, Technology, Relationships, Ships, Titles, Councils, InnerMap, InnerMapRenderer, InnerMapCharacters, InnerMapCombat, LightSystem, ModStore, audioManager, DataLoader, Hex, Utils, PlayerActions, PlayerEconomy, PlayerMilitary, ActionMenu, Housing, Espionage, Gossip, Tavern, Economy, TiledExport, CustomObjects, CustomBuildings, Hotbar, NpcDialog, Trading, WorldUnit } from './_gameImports.js';
import { resolveHostileEncounter } from './combat.logic.js';
import { RoadEncounters } from '../../player/roadEncounters.js';
import { FieldBattle } from '../../player/fieldBattle.js';
import { PlayerReligion } from '../../player/playerReligion.js';
import { Traits } from '../../systems/traits.js';
import { Ailments } from '../../systems/ailments.js';

export function playerPray() {
    if (!this.player) return;

    this.player.karma += 1;
    Traits.recordDeed(this.player, 'piety');
    this.ui.updateStats(this.player, this.world);
    this.ui.showNotification('Prayer', 'You take a moment to pray. ☯ +1 Karma', 'success');
    // A prayer for the sick eases a fever, and is now and then answered (systems/ailments.js)
    const healing = Ailments.pray(this.player, this.world);
    if (healing) {
        this.ui.showNotification(healing.answered ? '✨ Prayer Answered' : '🙏 Prayer for Healing', healing.message, healing.answered ? 'success' : 'info');
        this.ui.updateStats(this.player, this.world);
    }

    // At certain karma thresholds, unlock religious path
    if (this.player.karma === 10 && !this.player.religion) {
        this.ui.showNotification(
            'Spiritual Awakening',
            'You feel a deeper connection to the divine. Perhaps you could found a religion...',
            'info'
        );
    }
}

/**
 * Load PNG tile sprites from a directory
 * Call this with paths to your PNG assets
 */
export async function loadTileSprites(spriteMap) {
    // spriteMap is { terrainId: 'path/to/sprite.png', ... }
    const promises = [];
    for (const [terrainId, path] of Object.entries(spriteMap)) {
        promises.push(this.renderer.loadTileSprite(terrainId, path));
    }
    try {
        await Promise.all(promises);
        console.log('All tile sprites loaded!');
        this.minimap?.invalidate();
    } catch (err) {
        console.warn('Some tile sprites failed to load:', err);
    }
}

/**
 * Show modal offering to auto-purchase food when starting a journey with low/no food at a settlement
 */
export function _showFoodPurchaseModal(pathLen, foodCount, tile, targetHex) {
    // Don't stack modals
    if (document.getElementById('foodPurchaseModal')) return;

    // Pause movement while modal is open
    this.player.isMoving = false;

    const settlement = tile.settlement;
    const deficit = pathLen - foodCount;

    // Find cheapest available food at this settlement
    const goods = (typeof Trading !== 'undefined') ? Trading.getAvailableGoods(settlement, tile) : [];
    const foodGoods = goods.filter(g => Player.FOOD_TYPES.includes(g.id) && g.quantity > 0);
    foodGoods.sort((a, b) => a.price - b.price); // cheapest first

    // Calculate how much food we can buy and at what cost
    let totalCost = 0;
    let totalFood = 0;
    const purchasePlan = [];

    let remaining = deficit;
    for (const fg of foodGoods) {
        if (remaining <= 0) break;
        // Each unit costs a little more than the last as the stall empties
        const purse = { ...this.player, gold: Math.max(0, (this.player.gold || 0) - totalCost) };
        const qty = Trading.affordable(purse, fg, settlement, remaining);
        if (qty > 0) {
            const cost = Trading.buyCost(this.player, fg, qty, settlement);
            purchasePlan.push({ good: fg, qty, cost });
            totalCost += cost;
            totalFood += qty;
            remaining -= qty;
        }
    }

    const canFullyProvision = totalFood >= deficit;
    const hasAnyFood = foodGoods.length > 0 && totalFood > 0;

    const overlay = document.createElement('div');
    overlay.id = 'foodPurchaseModal';
    overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 1200;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(4px);
        animation: fadeIn 0.2s ease;
    `;

    const box = document.createElement('div');
    box.style.cssText = `
        background: rgba(20, 24, 32, 0.98);
        border: 2px solid var(--gold);
        border-radius: 8px;
        padding: 28px 36px;
        min-width: 340px;
        max-width: 440px;
        text-align: center;
        box-shadow: 0 10px 40px rgba(0,0,0,0.8), 0 0 20px rgba(245,197,66,0.15);
    `;

    // Build purchase breakdown
    let breakdownHtml = '';
    if (hasAnyFood) {
        for (const p of purchasePlan) {
            breakdownHtml += `<div style="display:flex; justify-content:space-between; font-size:12px; padding:2px 0;">
                <span>${p.good.icon || '🍽️'} ${p.good.name} ×${p.qty}</span>
                <span style="color:var(--gold);">${p.cost} gold</span>
            </div>`;
        }
    }

    box.innerHTML = `
        <div style="font-size: 32px; margin-bottom: 8px;">🍽️</div>
        <h3 style="margin: 0 0 6px; font-family: var(--font-display); color: var(--gold); letter-spacing: 2px; text-transform: uppercase;">Low on Food</h3>
        <p style="color: var(--text-secondary); font-size: 13px; margin: 0 0 14px; line-height: 1.5;">
            Your journey is <span style="color:#4fc3f7;">${pathLen} tiles</span> but you only have
            <span style="color:${foodCount === 0 ? '#f44336' : '#ff9800'};">${foodCount} food</span>.
            You need <span style="color:#ff9800;">${deficit} more</span> to avoid starving.
        </p>

        ${hasAnyFood ? `
            <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:6px; padding:10px; margin-bottom:14px; text-align:left;">
                <div style="font-size:11px; color:#888; text-transform:uppercase; margin-bottom:6px;">Auto-Purchase from ${settlement.name}</div>
                ${breakdownHtml}
                <div style="border-top:1px solid rgba(255,255,255,0.08); margin-top:6px; padding-top:6px; display:flex; justify-content:space-between; font-weight:bold;">
                    <span style="color:#aaa;">Total: ${totalFood} food</span>
                    <span style="color:var(--gold);">${totalCost} gold</span>
                </div>
                ${!canFullyProvision ? `<div style="color:#ff9800; font-size:11px; margin-top:4px;">⚠️ Can only buy ${totalFood} of ${deficit} needed (${remaining > 0 ? (this.player.gold < totalCost + remaining ? 'not enough gold' : 'not enough in stock') : ''})</div>` : ''}
            </div>
            <div style="color:#666; font-size:11px; margin-bottom:12px;">
                💰 Your gold: <span style="color:var(--gold);">${this.player.gold}</span>
                → After purchase: <span style="color:${this.player.gold - totalCost < 50 ? '#ff9800' : 'var(--gold)'};">${this.player.gold - totalCost}</span>
            </div>
        ` : `
            <div style="background:rgba(244,67,54,0.1); border:1px solid rgba(244,67,54,0.2); border-radius:6px; padding:10px; margin-bottom:14px;">
                <div style="color:#f44336; font-size:12px;">No food available at this settlement, or you can't afford any.</div>
            </div>
        `}

        <div style="display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;">
            <button id="foodCancel" style="
                padding: 10px 18px; border-radius: 6px; cursor: pointer;
                background: rgba(255,255,255,0.05); border: 1px solid var(--border-color);
                color: var(--text-secondary); font-family: var(--font-body); font-size: 13px;
                transition: all 0.2s;
            ">Cancel Journey</button>
            <button id="foodSkip" style="
                padding: 10px 18px; border-radius: 6px; cursor: pointer;
                background: rgba(255,152,0,0.1); border: 1px solid rgba(255,152,0,0.3);
                color: #ff9800; font-family: var(--font-body); font-size: 13px;
                transition: all 0.2s;
            ">Travel Hungry</button>
            ${hasAnyFood ? `<button id="foodBuy" style="
                padding: 10px 18px; border-radius: 6px; cursor: pointer;
                background: rgba(76,175,80,0.15); border: 1px solid rgba(76,175,80,0.4);
                color: #4caf50; font-family: var(--font-body); font-size: 13px;
                font-weight: 600; transition: all 0.2s;
            ">Buy & Go (${totalCost}g)</button>` : ''}
        </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const cleanup = () => {
        overlay.remove();
        window.removeEventListener('keydown', keyHandler, true);
    };

    const cancelJourney = () => {
        cleanup();
        this.player.cancelTravel();
    };

    const skipAndGo = () => {
        cleanup();
        // Resume movement — it was paused
        if (this.player.path) {
            this.player.isMoving = true;
        }
    };

    const buyAndGo = () => {
        cleanup();
        // Execute purchases
        let failReason = null;
        for (const p of purchasePlan) {
            const r = Trading.buyGoods(this.player, p.good, p.qty, settlement);
            if (!r.success) failReason = r.reason;
        }
        if (failReason) {
            this.ui.showNotification('🍞 Some Food Not Bought', failReason, 'warning');
        } else {
            this.ui.showNotification('🍞 Food Purchased',
                `Bought ${totalFood} food for ${totalCost} gold. Safe travels!`, 'success');
        }
        this.ui.updateStats(this.player, this.world);
        // Resume movement
        if (this.player.path) {
            this.player.isMoving = true;
        }
    };

    // Click outside to cancel journey
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) cancelJourney();
    });

    document.getElementById('foodCancel').addEventListener('click', cancelJourney);
    document.getElementById('foodSkip').addEventListener('click', skipAndGo);
    if (hasAnyFood) {
        document.getElementById('foodBuy').addEventListener('click', buyAndGo);
    }

    // Keyboard: Enter to buy (if available), Escape to cancel. Captured and
    // stopped so the game's own Escape (cancel travel, leave the inner map)
    // does not act on the same key press.
    const keyHandler = (e) => {
        if (e.key === 'Enter' && hasAnyFood) {
            e.preventDefault();
            e.stopPropagation();
            buyAndGo();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            cancelJourney();
        }
    };
    window.addEventListener('keydown', keyHandler, true);
}

/**
 * Trigger death with animation (if on inner map) then show death screen.
 * @param {string} [cause] - Death cause passed to showDeathScreen
 */
export function _triggerDeath(cause) {
    // Cheats: god mode turns death away
    if (this._cheats && this._cheats.godMode) {
        this.isProcessingTurn = false;
        document.body.style.cursor = 'default';
        this.player.health = this.player.maxHealth;
        this.ui.showNotification('🛡️ God mode', `You shrug off death${cause ? ` (${cause})` : ''}.`, 'info');
        return;
    }
    if (typeof Relationships !== 'undefined') Relationships.prepareForSave(this.player);
    this.isProcessingTurn = false;
    document.body.style.cursor = 'default';

    if (InnerMap.active) {
        // A full exit, not just active = false: otherwise the inner map's
        // toolbar, hotbar, context menu and dialog outlive it, and an heir who
        // carries on finds a "Return to World Map" button that does nothing
        this.exitInnerMap({ quiet: true });
    }
    this.player._isDead = true;
    setTimeout(() => ActionMenu.showDeathScreen(this, cause), 1200);
}

/**
 * Check if any hostile units (raiders/pirates/beasts/war hosts) have reached
 * the player. With a UI the player chooses what to do (ActionMenu.showEncounter:
 * flee, pay, parley, hide or fight — player/roadEncounters.js); headless, or
 * when the last encounter / battle was walked away from, it resolves with the
 * defaults.
 */
export function _checkHostileEncounters() {
    if (!this.world || !this.player) return;
    this._settlePendingCombat();
    if (this.player.indenturedServitude) return; // Already captive
    // Holy Sanctuary: no blood may be shed on consecrated ground
    if (PlayerReligion.isInSanctuary(this.player, this.player.q, this.player.r, this.world.width)) return;
    // Nor inside a town or a crown's village: bands strike on the open road
    // and in villages no realm protects (WorldUnit.isSafeHaven)
    if (WorldUnit.isSafeHaven(this.world, this.player.q, this.player.r)) return;

    const day = this.world.day;
    const hostiles = this.world.units.filter(u =>
        !u.destroyed &&
        !u.sparesPlayer && // a lair's riders under a bargain (systems/outlawLairs.js)
        !RoadEncounters.isSparing(u, day) && // paid off, talked down, driven off
        WorldUnit.isHostile(u) &&
        Hex.wrappingDistance(u.q, u.r, this.player.q, this.player.r, this.world.width) <= 1
    );

    if (hostiles.length === 0) return;

    // Pick the strongest adjacent hostile
    const attacker = hostiles.reduce((a, b) => b.strength > a.strength ? b : a, hostiles[0]);

    // Play combat SFX and switch to combat music
    audioManager.playSFX('combat_hit');
    audioManager.setScene('combat');

    if (this.ui && typeof this.ui.showCustomPanel === 'function' && typeof document !== 'undefined') {
        // The player decides (the odds are shown); see ActionMenu.encounterAct
        this.player.isMoving = false;
        this._pendingEncounter = { unitId: attacker.id, day };
        ActionMenu.showEncounter(this, attacker.id);
    } else {
        // Headless: the old automatic resolution (pure logic — mutates state, returns effects)
        const outcome = resolveHostileEncounter(this.player, attacker, this.world);
        this.ui.showNotification(outcome.notification.title, outcome.notification.body, outcome.notification.type);
    }

    // Restore music scene after combat
    setTimeout(() => {
        audioManager.updateSceneFromGameState(this);
    }, 3000);
}

/**
 * An encounter dialog closed without a choice, or a battle left mid-way: the
 * hostile falls on the player as of old, the battle is fought out with the
 * default stances.
 */
export function _settlePendingCombat() {
    const b = this._fieldBattle;
    if (b && !b.done) {
        FieldBattle.auto(this.player, b, this.world);
        // Your captains fight it to its end without you (reported by _settleFieldBattle)
        ActionMenu._settleFieldBattle(this);
    }
    if (b && b.done) {
        this._fieldBattle = null;
        this._fieldBattleSource = null;
    }
    const pending = this._pendingEncounter;
    if (!pending) return;
    this._pendingEncounter = null;
    const unit = this.world.units.find(u => u.id === pending.unitId && !u.destroyed);
    if (!unit) return;
    const outcome = RoadEncounters.resolve(this.player, unit, this.world, RoadEncounters.autoChoice(), { auto: true, legacy: true });
    if (outcome.notification) this.ui.showNotification(outcome.notification.title, outcome.notification.body, outcome.notification.type);
}

/**
 * Show a custom modal to confirm ending the day
 */
export function _showEndDayConfirm() {
    // Don't stack modals
    if (document.getElementById('endDayConfirmModal')) return;

    const overlay = document.createElement('div');
    overlay.id = 'endDayConfirmModal';
    overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 1200;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(4px);
        animation: fadeIn 0.2s ease;
    `;

    const box = document.createElement('div');
    box.style.cssText = `
        background: rgba(20, 24, 32, 0.98);
        border: 2px solid var(--gold);
        border-radius: 8px;
        padding: 28px 36px;
        min-width: 320px;
        max-width: 400px;
        text-align: center;
        box-shadow: 0 10px 40px rgba(0,0,0,0.8), 0 0 20px rgba(245,197,66,0.15);
    `;

    const ap = this.player.actionPoints != null ? this.player.actionPoints : 0;
    const maxAp = this.player.maxActionPoints || 10;
    const stam = this.player.movementRemaining != null ? this.player.movementRemaining : 0;

    box.innerHTML = `
        <div style="font-size: 28px; margin-bottom: 8px;">🌙</div>
        <h3 style="margin: 0 0 8px; font-family: var(--font-display); color: var(--gold); letter-spacing: 2px; text-transform: uppercase;">End Day ${this.world.day}?</h3>
        <p style="color: var(--text-secondary); font-size: 13px; margin: 0 0 16px; line-height: 1.5;">
            Resting will advance to the next day.<br>
            <span style="color: ${ap > 0 ? '#ff9800' : '#666'};">⚡ ${ap}/${maxAp} AP remaining</span>
            &nbsp;·&nbsp;
            <span style="color: ${stam > 0 ? '#4fc3f7' : '#666'};">🏃 ${stam} stamina left</span>
        </p>
        <div style="display: flex; gap: 12px; justify-content: center;">
            <button id="endDayCancel" style="
                padding: 10px 24px; border-radius: 6px; cursor: pointer;
                background: rgba(255,255,255,0.05); border: 1px solid var(--border-color);
                color: var(--text-secondary); font-family: var(--font-body); font-size: 13px;
                transition: all 0.2s;
            ">Cancel</button>
            <button id="endDayConfirm" style="
                padding: 10px 24px; border-radius: 6px; cursor: pointer;
                background: rgba(245,197,66,0.15); border: 1px solid var(--gold);
                color: var(--gold); font-family: var(--font-body); font-size: 13px;
                font-weight: 600; transition: all 0.2s;
            ">Rest & End Day</button>
        </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    // Every way out removes the key handler too — a handler left behind by a
    // mouse close would end the day (unconfirmed) on the next Enter anywhere
    const close = () => {
        overlay.remove();
        window.removeEventListener('keydown', keyHandler, true);
    };
    const confirm = () => {
        close();
        this._endDayConfirmed = true;
        this.endDay();
    };

    // Click outside to cancel
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });

    document.getElementById('endDayCancel').addEventListener('click', close);
    document.getElementById('endDayConfirm').addEventListener('click', confirm);

    // Keyboard: Enter to confirm, Escape to cancel (captured and stopped, so
    // Escape does not also cancel travel or leave the inner map)
    const keyHandler = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            confirm();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close();
        }
    };
    window.addEventListener('keydown', keyHandler, true);
}



