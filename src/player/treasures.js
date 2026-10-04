// ============================================
// TREASURES — what rare loot is good for
// ============================================
// Legendary creatures, envoys, pilgrims and smugglers carry goods that used to
// have no definition: the player could seize a Dragon Scale and do nothing with
// it. Each now has a GOODS entry in data/playerEconomy.json (name, icon,
// basePrice — so it sells), and an optional `treasure` block saying what else
// it does:
//
//   treasure.equip    { battlePower | damageReduction | negotiation }
//                     passive while carried; each kind of item counts once
//   treasure.gift     reputation gained presenting one to a lord
//   treasure.prestige House Prestige for enshrining one in your hall
//   treasure.consume  { health | movement } when used from the packs
//
// PlayerEffects reads the equip totals; the royal audience (gift) and the
// inventory panel (dedicate / use) call the actions below.

import { DataLoader } from '../core/dataLoader.js';
import { House } from '../systems/house.js';

/** Upper bound for each carried-treasure bonus, so hoarding can't snowball. */
export const TREASURE_EQUIP_CAPS = { battlePower: 0.1, negotiation: 0.08, damageReduction: 0.4 };

/** A greedy lord values treasure more; an honourable one is touched by it. */
const GIFT_TRAIT_MULT = { greedy: 1.25, honorable: 1.1 };

function _goods() {
    const pe = DataLoader._gamedata && DataLoader._gamedata.playerEconomy;
    return (pe && pe.GOODS) || {};
}

function _take(player, itemId) {
    if (!player || !player.inventory || !(player.inventory[itemId] > 0)) return false;
    player.inventory[itemId]--;
    if (player.inventory[itemId] <= 0) delete player.inventory[itemId];
    return true;
}

export const Treasures = {
    /** The GOODS entry for an item id, or null. */
    def(itemId) {
        if (!itemId) return null;
        return _goods()[String(itemId).toUpperCase()] || null;
    },

    /** The item's `treasure` block, or null for ordinary goods. */
    info(itemId) {
        const def = Treasures.def(itemId);
        return (def && def.treasure) || null;
    },

    /** Display name ("Dragon Scale"), falling back to the id. */
    name(itemId) {
        const def = Treasures.def(itemId);
        return def ? def.name : String(itemId).replace(/_/g, ' ');
    },

    /** Treasures the player is carrying: [{ id, qty, def, info }]. */
    held(player) {
        const out = [];
        for (const [id, qty] of Object.entries((player && player.inventory) || {})) {
            if (!(qty > 0)) continue;
            const info = Treasures.info(id);
            if (info) out.push({ id, qty, def: Treasures.def(id), info });
        }
        return out;
    },

    /**
     * Total of one carried bonus. Each kind of item counts once however many
     * you carry; damage reduction combines multiplicatively like armour.
     */
    equipTotal(player, key) {
        const cap = TREASURE_EQUIP_CAPS[key] != null ? TREASURE_EQUIP_CAPS[key] : 0.1;
        if (key === 'damageReduction') {
            let keep = 1;
            for (const t of Treasures.held(player)) {
                const r = t.info.equip && t.info.equip.damageReduction;
                if (r > 0) keep *= 1 - r;
            }
            return Math.min(cap, 1 - keep);
        }
        let total = 0;
        for (const t of Treasures.held(player)) {
            const v = t.info.equip && t.info.equip[key];
            if (v > 0) total += v;
        }
        return Math.min(cap, total);
    },

    /** Gifts the player could present to a lord: [{ id, qty, def, value }]. */
    giftable(player) {
        return Treasures.held(player)
            .filter(t => t.info.gift > 0)
            .map(t => ({ id: t.id, qty: t.qty, def: t.def, value: t.info.gift }))
            .sort((a, b) => b.value - a.value);
    },

    /**
     * Present one treasure to a kingdom's lord. Reputation with the realm
     * rises by the item's gift value (more for a greedy lord), scaled by
     * `scaleGain` (the caller passes PlayerEffects.scaleReputationGain).
     * @returns {{success:boolean, reason?:string, reputation?:number, item?:string}}
     */
    presentToLord(player, kingdom, itemId, scaleGain = (p, g) => g) {
        const info = Treasures.info(itemId);
        if (!info || !(info.gift > 0)) return { success: false, reason: 'That is no fitting gift for a lord.' };
        if (!kingdom) return { success: false, reason: 'There is no court to receive it.' };
        if (!_take(player, itemId)) return { success: false, reason: `You carry no ${Treasures.name(itemId)}.` };
        let mult = 1;
        const traits = (kingdom.lord && kingdom.lord.traits) || [];
        for (const t of traits) {
            const id = typeof t === 'string' ? t : t && t.id;
            if (GIFT_TRAIT_MULT[id]) mult = Math.max(mult, GIFT_TRAIT_MULT[id]);
        }
        const reputation = scaleGain(player, Math.round(info.gift * mult));
        if (!player.reputation) player.reputation = {};
        player.reputation[kingdom.id] = (player.reputation[kingdom.id] || 0) + reputation;
        return { success: true, reputation, item: Treasures.name(itemId) };
    },

    /**
     * Enshrine one treasure in the House's hall for Prestige.
     * @returns {{success:boolean, reason?:string, prestige?:number}}
     */
    dedicate(player, itemId, day = 0) {
        const info = Treasures.info(itemId);
        if (!info || !(info.prestige > 0)) return { success: false, reason: 'That would add nothing to your hall.' };
        if (!player || !player.house) return { success: false, reason: 'You have no House to enshrine it.' };
        if (!_take(player, itemId)) return { success: false, reason: `You carry no ${Treasures.name(itemId)}.` };
        House.award(player.house, info.prestige, `enshrined a ${Treasures.name(itemId)}`, day);
        return { success: true, prestige: info.prestige };
    },

    /**
     * Use a consumable treasure (holy water heals, rum restores a step).
     * @returns {{success:boolean, reason?:string, health?:number, movement?:number}}
     */
    use(player, itemId) {
        const info = Treasures.info(itemId);
        const fx = info && info.consume;
        if (!fx) return { success: false, reason: 'That cannot be used.' };
        if (!_take(player, itemId)) return { success: false, reason: `You carry no ${Treasures.name(itemId)}.` };
        const result = { success: true };
        if (fx.health > 0) {
            const max = player.maxHealth || 100;
            const before = player.health || 0;
            player.health = Math.min(max, before + fx.health);
            result.health = player.health - before;
        }
        if (fx.movement > 0) {
            player.movementRemaining = (player.movementRemaining || 0) + fx.movement;
            result.movement = fx.movement;
        }
        return result;
    },

    /** Short effect lines for the inventory panel. */
    describe(itemId) {
        const info = Treasures.info(itemId);
        if (!info) return [];
        const lines = [];
        const eq = info.equip || {};
        if (eq.battlePower) lines.push(`⚔️ +${Math.round(eq.battlePower * 100)}% battle power while carried`);
        if (eq.damageReduction) lines.push(`🛡️ −${Math.round(eq.damageReduction * 100)}% harm taken while carried`);
        if (eq.negotiation) lines.push(`🤝 +${Math.round(eq.negotiation * 100)}% negotiation while carried`);
        if (info.gift) lines.push(`👑 Gift for a lord: +${info.gift} reputation`);
        if (info.prestige) lines.push(`🏛️ Enshrine for +${info.prestige} House Prestige`);
        if (info.consume && info.consume.health) lines.push(`❤️ Use: +${info.consume.health} health`);
        if (info.consume && info.consume.movement) lines.push(`👣 Use: +${info.consume.movement} movement today`);
        return lines;
    },
};
