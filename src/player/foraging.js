// ============================================
// FORAGING — the quick search of the land around you
// The UI's foraging minigame is separate; this is the plain roll the
// "skip" path and anything headless use. Wild foods found this way are
// edible (Player.FOOD_TYPES), so a broke traveller can live off the land.
// ============================================

import { Utils } from '../core/utils.js';
import { PlayerInventory } from './inventory.js';

export const Foraging = {
    /** The loot table for this tile's terrain, or null when nothing grows here. */
    lootTableFor(tile, forageData) {
        if (!tile || !tile.terrain || !forageData) return null;
        const category = (forageData.terrain_mapping || {})[tile.terrain.id];
        const table = category && forageData.loot_table && forageData.loot_table[category];
        return table && table.length ? table : null;
    },

    /**
     * Search the tile for one useful thing. Intelligence widens the search.
     * Returns { success, entry, added, reason } — success:false only when the
     * terrain has nothing; `added` is false when the packs were full.
     */
    quickForage(player, tile, forageData) {
        const table = Foraging.lootTableFor(tile, forageData);
        if (!table) return { success: false, reason: 'This terrain has nothing worth gathering.' };
        const intBonus = 1 + (player.intelligence || 5) * 0.05;
        let entry = null;
        for (let attempt = 0; attempt < 5 && !entry; attempt++) {
            const roll = Utils.random();
            let cum = 0;
            for (const e of table) {
                cum += e.chance * intBonus * 0.6;
                if (roll < cum) { entry = e; break; }
            }
        }
        if (!entry) entry = table[0];
        const add = PlayerInventory.addItem(player, entry.item, 1);
        return { success: true, entry, added: !!add.success, reason: add.reason };
    },
};
