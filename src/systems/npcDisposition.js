// ============================================
// NPC DISPOSITION — what an inner-map NPC's opinion of the player *does*
// ============================================
// The dialog writes a per-NPC memory (`npc._dialogMemory`: disposition,
// threatened, giftsReceived, playerTitle, ...). This module turns that memory
// into concrete effects so the numbers matter:
//
//   - shop prices, both ways, from disposition + personality traits
//   - gifts make later goodwill grow faster; threats make it grow slower,
//     make the NPC fearful, and can get them to refuse trade or report you
//   - a successful threat or persuasion grants something real (coin, map
//     knowledge, a treasure map, a hidden cache, true intel, a discount)
//   - harming / killing an NPC turns their family and friends against you
//
// Pure domain logic: no globals, randomness via Utils (seedable).

import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { NpcFamily } from './npcFamily.js';
import { Cartography } from './cartography.js';
import { PlayerInventory } from '../core/inventory.js';

/**
 * What a flattered NPC actually hands over — aligned index-for-index with the
 * FLATTER_SUCCESS lines in ui/npcDialog.data.js, so each promise is kept.
 * null = the line is gossip/advice only. Each NPC rewards flattery once.
 */
export const FLATTER_REWARDS = {
    merchant:       [null, { kind: 'discount', amount: 0.10 }],
    guard:          [null, null],
    farmer:         [{ kind: 'item', item: 'grain', qty: 4 }, { kind: 'cache', lo: 10, hi: 40 }],
    priest:         [{ kind: 'karma', amount: 3 }, { kind: 'heal', amount: 15 }],
    blacksmith_npc: [{ kind: 'discount', amount: 0.10 }, { kind: 'reveal' }],
    villager:       [{ kind: 'item', item: 'bread', qty: 1 }, null],
    child:          [{ kind: 'cache', lo: 1, hi: 6 }, { kind: 'cache', lo: 3, hi: 12 }],
    noble:          [{ kind: 'reputation', amount: 2 }, { kind: 'reputation', amount: 3 }],
    traveler:       [{ kind: 'reveal' }, { kind: 'reveal' }],
    beggar:         [{ kind: 'cache', lo: 10, hi: 40 }, { kind: 'intel' }],
};

/** Price shift per personality trait (positive = dearer for the player). */
export const TRAIT_PRICE_MODS = {
    generous: -0.08,
    kind: -0.05,
    jovial: -0.03,
    curious: 0,
    witty: 0,
    quiet: 0,
    bold: 0.02,
    cautious: 0.03,
    stubborn: 0.04,
    stern: 0.05,
    greedy: 0.12,
};

/** Coin an intimidated NPC hands over, by type ([min, max]). */
const EXTORTION_GOLD = {
    merchant: [20, 60], noble: [30, 80], blacksmith_npc: [15, 40], traveler: [10, 30],
    priest: [5, 20], farmer: [3, 12], villager: [3, 12], beggar: [0, 2], child: [0, 3], guard: [10, 25],
};

const TRADER_TYPES = new Set(['merchant', 'traveler', 'blacksmith_npc']);

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export const NpcDisposition = {
    /** Get (creating if needed) the dialog memory of an NPC. */
    getMemory(npc) {
        if (!npc._dialogMemory) {
            npc._dialogMemory = {
                timesSpoken: 0,      // Total conversations
                disposition: 50,     // 0=hostile, 50=neutral, 100=friendly
                lastAction: null,    // Last player action toward this NPC
                giftsReceived: 0,    // How many gifts
                threatened: false,   // Ever threatened (cleared by making amends)
                flattered: false,    // Ever flattered
                questOffered: false, // Already offered a quest this session
                rumorsTold: 0,       // How many rumors shared
                playerTitle: null,   // Last known player title
            };
        }
        return npc._dialogMemory;
    },

    /**
     * Multiplier on future positive disposition gains: gifts build a habit of
     * goodwill (+10% per gift, up to +50%); a threatened NPC warms at half speed.
     */
    gainMultiplier(npc) {
        const mem = NpcDisposition.getMemory(npc);
        let mult = 1 + Math.min(0.5, (mem.giftsReceived || 0) * 0.1);
        if (mem.threatened) mult *= 0.5;
        return mult;
    },

    /**
     * Change an NPC's disposition, applying the gift/threat multiplier to
     * positive changes. Returns the change actually applied.
     */
    adjustDisposition(npc, delta) {
        const mem = NpcDisposition.getMemory(npc);
        let applied = delta > 0 ? Math.max(1, Math.round(delta * NpcDisposition.gainMultiplier(npc))) : Math.round(delta);
        const before = mem.disposition;
        mem.disposition = clamp(before + applied, 0, 100);
        applied = mem.disposition - before;
        return applied;
    },

    /** Record a gift; three gifts after a threat make amends. */
    recordGift(npc) {
        const mem = NpcDisposition.getMemory(npc);
        mem.giftsReceived = (mem.giftsReceived || 0) + 1;
        if (mem.threatened) {
            mem.amends = (mem.amends || 0) + 1;
            if (mem.amends >= 3) {
                mem.threatened = false;
                mem.fearful = false;
                mem.amends = 0;
                return { forgiven: true };
            }
        }
        return { forgiven: false };
    },

    /**
     * Trade price modifiers for this NPC.
     * @returns {{ buy:number, sell:number, pct:number, reasons:Array<{label:string,pct:number}>, refuses:boolean, refuseReason?:string }}
     *   buy  — multiplier on what the player pays
     *   sell — multiplier on what the NPC pays the player
     *   pct  — net % change to buy prices (for display)
     */
    getPriceModifiers(npc) {
        const mem = NpcDisposition.getMemory(npc);
        const reasons = [];
        const d = mem.disposition;

        if (mem.threatened && d < 25) {
            return {
                buy: 1, sell: 1, pct: 0, reasons, refuses: true,
                refuseReason: `${npc.name || 'They'} won't deal with someone who threatened them.`,
            };
        }

        let shift = 0;
        const dispShift = Math.round(((50 - d) / 250) * 100) / 100; // ±0.20
        if (dispShift !== 0) {
            shift += dispShift;
            reasons.push({ label: d > 50 ? 'Goodwill' : 'Dislikes you', pct: Math.round(dispShift * 100) });
        }
        for (const t of (npc.personalityTraits || [])) {
            const m = TRAIT_PRICE_MODS[t];
            if (m) {
                shift += m;
                reasons.push({ label: t.charAt(0).toUpperCase() + t.slice(1), pct: Math.round(m * 100) });
            }
        }
        if (mem.threatened) {
            shift += 0.10;
            reasons.push({ label: 'Distrusts you', pct: 10 });
        }
        if (mem.fearful) {
            // A frightened trader wants you gone and pads the price to make it so
            shift += 0.05;
            reasons.push({ label: 'Afraid of you', pct: 5 });
        }
        if (mem.discount) {
            shift -= mem.discount;
            reasons.push({ label: 'Owes you a favour', pct: -Math.round(mem.discount * 100) });
        }

        const buy = clamp(1 + shift, 0.6, 1.5);
        const sell = clamp(1 - shift * 0.75, 0.6, 1.3);
        return { buy, sell, pct: Math.round((buy - 1) * 100), reasons, refuses: false };
    },

    /** Price the player pays for an item with this NPC. */
    buyPrice(npc, basePrice) {
        return Math.max(1, Math.round(basePrice * NpcDisposition.getPriceModifiers(npc).buy));
    },

    /** Price the NPC pays the player per unit. */
    sellPrice(npc, basePrice) {
        return Math.max(1, Math.floor(basePrice * NpcDisposition.getPriceModifiers(npc).sell));
    },

    /**
     * Note that the player now holds a title the NPC hadn't seen before.
     * Returns { changed, title } — a newly titled player earns a one-time +5.
     */
    notePlayerTitle(npc, title) {
        const mem = NpcDisposition.getMemory(npc);
        const prev = mem.playerTitle;
        mem.playerTitle = title || null;
        if (title && prev !== title && mem.timesSpoken > 0) {
            NpcDisposition.adjustDisposition(npc, 5);
            return { changed: true, title, previous: prev };
        }
        return { changed: false, title };
    },

    /**
     * How much easier it is to intimidate this NPC again. Someone you have
     * already cowed (`fearful`) folds faster: −2 to the threat difficulty.
     * Returns a non-positive modifier to add to the base difficulty.
     */
    intimidationModifier(npc) {
        const mem = NpcDisposition.getMemory(npc);
        return mem.fearful ? -2 : 0;
    },

    /** Threat difficulty after the NPC's fear is taken into account (min 1). */
    threatDifficulty(npc, baseDifficulty) {
        return Math.max(1, baseDifficulty + NpcDisposition.intimidationModifier(npc));
    },

    /**
     * Reaction of a threatened NPC when the player talks to them again.
     * @returns {null|{ kind:'refuse'|'fear', text:string }}
     */
    threatReaction(npc) {
        const mem = NpcDisposition.getMemory(npc);
        if (!mem.threatened) return null;
        if (mem.disposition < 15) {
            return { kind: 'refuse', text: '*backs away* Stay away from me! I have nothing more to say to you.' };
        }
        if (!mem.fearful) {
            // They stood up to the threat last time — wary, not cowed
            return { kind: 'defiant', text: '*folds arms* You again. Your threats did not work last time either.' };
        }
        return { kind: 'fear', text: '*flinches* W-what do you want now? I gave you what you asked for...' };
    },

    /**
     * Resolve a threat. On success the NPC hands over coin (once per NPC).
     * Either way they may run to the guard — the caller reports that as an
     * assault through Gossip when `reported` is set.
     * @returns {{ gold:number, reported:boolean, alreadyExtorted:boolean }}
     */
    resolveThreat(npc, player, success) {
        const mem = NpcDisposition.getMemory(npc);
        const type = npc.type || 'villager';
        const out = { gold: 0, reported: false, alreadyExtorted: false };
        mem.threatened = true;
        mem.amends = 0;
        if (success) {
            mem.fearful = true;
            if (mem.extorted) {
                out.alreadyExtorted = true;
            } else {
                const [lo, hi] = EXTORTION_GOLD[type] || EXTORTION_GOLD.villager;
                out.gold = hi > 0 ? Utils.randInt(lo, hi) : 0;
                mem.extorted = true;
                if (player && out.gold > 0) player.gold = (player.gold || 0) + out.gold;
            }
        }
        // Guards don't report themselves; the bold and the angry report more often
        if (type !== 'guard') {
            const traits = npc.personalityTraits || [];
            let chance = success ? 0.25 : 0.45;
            if (traits.includes('bold') || traits.includes('stern')) chance += 0.15;
            if (traits.includes('cautious') || traits.includes('quiet')) chance -= 0.1;
            out.reported = Utils.random() < chance;
        }
        return out;
    },

    /**
     * Something concrete an NPC reveals when persuaded.
     * @param {object} ctx { player, world, kingdom, settlementTile }
     * @returns {{ kind:string, text:string, gold?:number, tilesRevealed?:number, map?:object, discount?:number }}
     */
    persuadeSecret(npc, ctx) {
        const { player, world, kingdom } = ctx || {};
        const mem = NpcDisposition.getMemory(npc);
        const type = npc.type || 'villager';

        const options = [];
        if (world && player) options.push('map', 'cache');
        if (world && player && world.width) options.push('treasure');
        if (kingdom) options.push('intel');
        if (TRADER_TYPES.has(type) && !mem.discount) options.push('discount', 'discount');
        if (options.length === 0) options.push('cache');
        if (mem.secretsShared) {
            // One big secret per NPC; later ones are small talk with a little coin
            return NpcDisposition._grantCache(npc, player, 5, 15, 'I\'ve told you all I know... but here — someone dropped this behind the well.');
        }
        mem.secretsShared = true;

        const kind = Utils.randPick(options);
        switch (kind) {
            case 'map': {
                const revealed = NpcDisposition._revealNearbyRegion(player, world);
                if (revealed > 0) {
                    return { kind, tilesRevealed: revealed, text: 'There\'s an old smugglers\' trail out of town. Here — I\'ll sketch the lands it crosses for you.' };
                }
                return NpcDisposition._grantCache(npc, player, 20, 60, 'There\'s a loose stone under the old well. Whatever\'s behind it is yours.');
            }
            case 'treasure': {
                const map = Cartography.generateTreasureMap(world);
                if (map) {
                    map.createdBy = npc.name || 'a local';
                    map.createdDay = world.day || 0;
                    if (!player.maps) player.maps = [];
                    player.maps.push(map);
                    return { kind, map, text: 'My grandfather buried something out in the wilds and drew this map. Take it — I\'m too old to dig.' };
                }
                return NpcDisposition._grantCache(npc, player, 20, 60, 'There\'s a cache beneath the old well. Go on, take it.');
            }
            case 'intel': {
                if (player && typeof player.learnAboutKingdom === 'function') player.learnAboutKingdom(kingdom.id, ['military', 'economy']);
                const soldiers = kingdom.military || 0;
                const treasury = kingdom.treasury || 0;
                const atWar = Array.isArray(kingdom.wars) && kingdom.wars.length > 0;
                const enemy = atWar && world && world.kingdoms ? world.kingdoms.find(k => k.id === kingdom.wars[0]) : null;
                let text = `${kingdom.name} fields about ${Utils.formatNumber(soldiers)} soldiers, and the treasury holds near ${Math.round(treasury / 100) * 100} gold.`;
                text += enemy ? ` They're at war with ${enemy.name} — the garrisons are thinner than they look.` : ' Not a war in sight, so the lords are getting restless.';
                return { kind, text };
            }
            case 'discount': {
                mem.discount = 0.15;
                return { kind, discount: 0.15, text: 'You\'ve been straight with me. From now on you get my family price — fifteen off everything.' };
            }
            default:
                return NpcDisposition._grantCache(npc, player, 30, 120, 'There\'s a hidden passage beneath the old well. Leads to a cache of valuables — go before anyone else does.');
        }
    },

    /**
     * Pay out what a flattered NPC promised (FLATTER_REWARDS[type][lineIndex]).
     * Once per NPC; later flattery only warms them.
     * @param {object} ctx { player, world, kingdom, type? (dialog type override) }
     * @returns {{ kind:string, summary:string }|null}
     */
    flatterReward(npc, lineIndex, ctx = {}) {
        const { player, world, kingdom } = ctx;
        if (!npc || !player) return null;
        const mem = NpcDisposition.getMemory(npc);
        if (mem.flatterRewarded) return null;
        const table = FLATTER_REWARDS[ctx.type || npc.type] || FLATTER_REWARDS.villager;
        const spec = table[lineIndex];
        if (!spec) return null;
        mem.flatterRewarded = true;
        switch (spec.kind) {
            case 'discount':
                if (mem.discount >= spec.amount) return { kind: 'discount', summary: 'Already gives you a good price' };
                mem.discount = spec.amount;
                return { kind: 'discount', summary: `${Math.round(spec.amount * 100)}% off with ${npc.name || 'them'} from now on` };
            case 'item': {
                const res = PlayerInventory.addOrSell(player, { [spec.item]: spec.qty });
                return { kind: 'item', summary: res.gold ? `Packs full — sold the gift for ${res.gold}g` : `+${spec.qty} ${spec.item}` };
            }
            case 'cache': {
                const r = NpcDisposition._grantCache(npc, player, spec.lo, spec.hi, '');
                return { kind: 'cache', summary: `+${r.gold} gold` };
            }
            case 'karma':
                player.karma = (player.karma || 0) + spec.amount;
                return { kind: 'karma', summary: `+${spec.amount} karma (blessed)` };
            case 'heal': {
                const max = player.maxHealth || 100;
                const before = player.health || 0;
                player.health = Math.min(max, before + spec.amount);
                return { kind: 'heal', summary: `+${player.health - before} health` };
            }
            case 'reputation': {
                if (!kingdom) return { kind: 'reputation', summary: 'A kind word at court' };
                if (!player.reputation) player.reputation = {};
                player.reputation[kingdom.id] = (player.reputation[kingdom.id] || 0) + spec.amount;
                return { kind: 'reputation', summary: `+${spec.amount} reputation with ${kingdom.name}` };
            }
            case 'reveal': {
                const n = NpcDisposition._revealNearbyRegion(player, world);
                if (n > 0) return { kind: 'reveal', summary: `${n} map tiles revealed` };
                const r = NpcDisposition._grantCache(npc, player, 5, 20, '');
                return { kind: 'cache', summary: `You already know these lands — they tip you ${r.gold} gold instead` };
            }
            case 'intel':
                if (kingdom && typeof player.learnAboutKingdom === 'function') {
                    player.learnAboutKingdom(kingdom.id, ['military', 'economy']);
                    return { kind: 'intel', summary: `Learned ${kingdom.name}'s military & economy` };
                }
                return null;
            default:
                return null;
        }
    },

    _grantCache(npc, player, lo, hi, text) {
        const gold = Utils.randInt(lo, hi);
        if (player) player.gold = (player.gold || 0) + gold;
        return { kind: 'cache', gold, text };
    },

    /** Mark unexplored tiles around a point 5-10 hexes away as explored. */
    _revealNearbyRegion(player, world) {
        if (!world || typeof world.getTile !== 'function' || player.q == null) return 0;
        const ring = Hex.hexesInRange(player.q, player.r, 10)
            .filter(h => Hex.distance(player.q, player.r, h.q, h.r) >= 5)
            .filter(h => { const t = world.getTile(h.q, h.r); return t && !t.explored; });
        if (ring.length === 0) return 0;
        const center = Utils.randPick(ring);
        let revealed = 0;
        for (const h of Hex.hexesInRange(center.q, center.r, 3)) {
            const t = world.getTile(h.q, h.r);
            if (t && !t.explored) { t.explored = true; revealed++; }
        }
        return revealed;
    },

    /**
     * The player harmed (assault) or killed (murder) an NPC. Relatives turn
     * against the player, friends sour, and the grieving family draws closer.
     * @param {object} victim
     * @param {Array} allNpcs inner-map NPCs (victim may already be removed)
     * @param {'assault'|'murder'} severity
     * @returns {{ affected:Array<{id, name, relation, delta}> }}
     */
    onNpcHarmed(victim, allNpcs, severity = 'assault') {
        const affected = [];
        if (!victim || !Array.isArray(allNpcs)) return { affected };
        const base = severity === 'murder' ? -70 : -25;

        // The victim's own memory (they may survive an assault)
        if (severity !== 'murder') {
            const vm = NpcDisposition.getMemory(victim);
            vm.disposition = clamp(vm.disposition + base, 0, 100);
            vm.assaulted = true;
        }

        const relations = [];
        if (victim.spouseId != null) relations.push({ id: victim.spouseId, factor: 0.9, relation: 'spouse' });
        for (const id of (victim.childIds || [])) relations.push({ id, factor: 0.8, relation: 'child' });
        for (const id of (victim.parentIds || [])) relations.push({ id, factor: 0.8, relation: 'parent' });
        for (const id of (victim.siblingIds || [])) relations.push({ id, factor: 0.6, relation: 'sibling' });

        const familyIds = new Set(relations.map(r => r.id));
        for (const r of relations) {
            const rel = allNpcs.find(n => n.id === r.id);
            if (!rel || rel.id === victim.id) continue;
            const mem = NpcDisposition.getMemory(rel);
            const delta = Math.round(base * r.factor);
            mem.disposition = clamp(mem.disposition + delta, 0, 100);
            mem.grudge = { victimName: victim.name, relation: r.relation, severity };
            if (!mem._familyEvents) mem._familyEvents = [];
            mem._familyEvents.push({ npcId: victim.id, npcName: victim.name, relation: r.relation, delta, original: base });
            affected.push({ id: rel.id, name: rel.name, relation: r.relation, delta });
        }

        // Friends (NPC-NPC bonds) of the victim sour too
        for (const other of allNpcs) {
            if (other.id === victim.id || familyIds.has(other.id)) continue;
            const bond = NpcFamily.getNpcRelationship(victim.id, other.id);
            if (!bond || bond.score < 30) continue;
            const mem = NpcDisposition.getMemory(other);
            const delta = Math.round(base * 0.4 * (bond.score / 100));
            if (delta === 0) continue;
            mem.disposition = clamp(mem.disposition + delta, 0, 100);
            mem.grudge = mem.grudge || { victimName: victim.name, relation: 'friend', severity };
            affected.push({ id: other.id, name: other.name, relation: 'friend', delta });
        }

        // The family closes ranks — shared grief strengthens their bonds
        const family = relations.map(r => r.id).filter(id => allNpcs.some(n => n.id === id));
        const event = severity === 'murder' ? `mourned ${victim.name}` : `tended ${victim.name}'s wounds`;
        for (let i = 0; i < family.length; i++) {
            for (let j = i + 1; j < family.length; j++) {
                NpcFamily.modifyNpcRelationship(family[i], family[j], severity === 'murder' ? 15 : 5, event);
            }
            NpcFamily.modifyNpcRelationship(victim.id, family[i], severity === 'murder' ? 10 : 5, event);
        }

        return { affected };
    },

    /** A line a relative with a grudge says instead of a greeting, or null. */
    grudgeLine(npc) {
        const mem = npc._dialogMemory;
        if (!mem || !mem.grudge) return null;
        const g = mem.grudge;
        const who = g.relation === 'friend' ? `my friend ${g.victimName}` : `my ${g.relation === 'child' ? 'parent' : g.relation === 'parent' ? 'child' : g.relation} ${g.victimName}`;
        return g.severity === 'murder'
            ? `*glares with red eyes* You... you killed ${who}. Get out of my sight.`
            : `I saw what you did to ${who}. Don't think I'll forget it.`;
    },
};
