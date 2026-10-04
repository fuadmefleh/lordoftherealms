// ============================================
// COMBAT LOGIC (pure) — hostile-encounter resolution
// ============================================
//
// The state-mutating core of a hostile encounter, split out from the UI mixin
// in combat.js so it can be unit-tested in isolation. It mutates player /
// attacker / world state and RETURNS a descriptor of the effects the UI should
// render (a notification). No DOM, no audio, no setTimeout, no `this` — and all
// randomness flows through the seedable Utils RNG, so outcomes are reproducible
// under Utils.setSeed(n).

import { Utils } from '../../core/utils.js';
import { PlayerMilitary } from '../../player/playerMilitary.js';
import { PlayerEffects } from '../../player/playerEffects.js';

/**
 * Resolve a hostile encounter between the player and an adjacent attacker unit.
 * Mutates player/attacker/world in place.
 *
 * @returns {{kind:'robbed'|'victory'|'defeat',
 *            notification:{title:string, body:string, type:string},
 *            goldStolen?:number, healthLost?:number, stolenItems?:object,
 *            result?:object}}
 */
export function resolveHostileEncounter(player, attacker, world) {
    const playerArmySize = player.army ? player.army.length : 0;

    if (playerArmySize === 0 && (attacker.type === 'beast' || attacker.type === 'monster')) {
        // --- No army vs. a creature: mauled, nothing stolen ---
        // Armour and Divine Protection soften the blow
        const healthLost = PlayerEffects.scaleDamage(player, attacker.type === 'monster' ? Utils.randInt(25, 45) : Utils.randInt(8, 18));
        player.health = Math.max(1, player.health - healthLost);
        attacker.targetQ = null;
        attacker.targetR = null;
        return {
            kind: 'robbed',
            goldStolen: 0,
            healthLost,
            stolenItems: {},
            notification: {
                title: `${attacker.icon || '🐺'} ${attacker.name} Attack!`,
                body: `A ${attacker.name} fell on you! Without an army you barely escaped. You lost ${healthLost} health.`,
                type: 'error',
            },
        };
    }

    if (playerArmySize === 0) {
        // --- No army: player is robbed / roughed up ---
        const goldStolen = Math.min(player.gold, Math.floor(player.gold * Utils.randFloat(0.15, 0.4)));
        const healthLost = PlayerEffects.scaleDamage(player, Utils.randInt(5, 15));

        player.gold -= goldStolen;
        player.health = Math.max(1, player.health - healthLost);

        // Steal random inventory items
        const stolenItems = {};
        if (player.inventory) {
            const itemKeys = Object.keys(player.inventory).filter(
                (k) => k !== 'quest' && player.inventory[k] > 0
            );
            const itemsToSteal = Math.min(itemKeys.length, Utils.randInt(1, 3));
            for (let i = 0; i < itemsToSteal; i++) {
                const key = Utils.randPick(itemKeys);
                const qty = Math.min(
                    player.inventory[key],
                    Utils.randInt(1, Math.ceil(player.inventory[key] * 0.5))
                );
                if (qty > 0) {
                    player.inventory[key] -= qty;
                    stolenItems[key] = qty;
                    if (player.inventory[key] <= 0) delete player.inventory[key];
                }
            }
        }

        // Transfer stolen goods to attacker
        attacker.inventory['gold'] = (attacker.inventory['gold'] || 0) + goldStolen;
        for (const [item, qty] of Object.entries(stolenItems)) {
            attacker.inventory[item] = (attacker.inventory[item] || 0) + qty;
        }

        // Build notification message
        let msg = `A ${attacker.name} ambushed you! Without an army you were defenseless.`;
        if (goldStolen > 0) msg += ` They stole ${goldStolen} gold.`;
        const stolenList = Object.entries(stolenItems)
            .map(([k, v]) => `${v} ${k}`)
            .join(', ');
        if (stolenList) msg += ` They also took: ${stolenList}.`;
        msg += ` You lost ${healthLost} health.`;

        if (world && world.events) {
            world.events.push({
                text: `${player.name || 'A traveller'} was robbed by a ${attacker.name}!`,
                type: 'military',
            });
        }

        // The raider moves on after robbing (pick new target)
        attacker.targetQ = null;
        attacker.targetR = null;

        return {
            kind: 'robbed',
            goldStolen,
            healthLost,
            stolenItems,
            notification: { title: `⚔️ ${attacker.name} Attack!`, body: msg, type: 'error' },
        };
    }

    // --- Player has army: full combat ---
    const result = PlayerMilitary.attackUnit(player, attacker, world, { defending: true });

    if (result.victory) {
        let lootMsg = `Victory! You defeated the ${attacker.name}!`;
        if (result.casualties > 0) lootMsg += ` Lost ${result.casualties} soldiers.`;
        if (result.wounded > 0) lootMsg += ` ${result.wounded} wounded saved by surgeons.`;
        if (result.commanderSlain) lootMsg += ` Your assassins slew their commander!`;
        if (result.loot > 0) lootMsg += ` Gained ${result.loot} gold.`;
        const itemLoot = Object.entries(result.inventoryLoot || {})
            .map(([k, v]) => `${v} ${k}`)
            .join(', ');
        if (itemLoot) lootMsg += ` Seized: ${itemLoot}.`;
        if (result.lootLeftBehind && Object.keys(result.lootLeftBehind).length > 0) {
            lootMsg += ` Packs full — left behind: ${Object.entries(result.lootLeftBehind).map(([k, v]) => `${v} ${k}`).join(', ')}.`;
        }
        if (result.renownChange > 0) lootMsg += ` +${result.renownChange} renown!`;

        return { kind: 'victory', result, notification: { title: `⚔️ Victory!`, body: lootMsg, type: 'success' } };
    }

    let defeatMsg = `Defeated by the ${attacker.name}!`;
    if (result.casualties > 0) defeatMsg += ` Lost ${result.casualties} soldiers.`;
    if (result.captured) {
        defeatMsg += ` You have been captured and forced into servitude for ${result.servitudeDays} days!`;
        if (result.goldConfiscated > 0) defeatMsg += ` ${result.goldConfiscated} gold confiscated.`;
    }
    return { kind: 'defeat', result, notification: { title: `💀 Defeat!`, body: defeatMsg, type: 'error' } };
}
