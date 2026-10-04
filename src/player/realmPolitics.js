// ============================================
// REALM POLITICS — the player's part in wars between kingdoms
// ============================================
// Kingdoms fight wars with goals, sue for peace, sign truces and can rise
// again after a fall (world/kingdomAI.js). This module lets the player take
// a hand in all of it:
//   - see every war (progress toward each side's goal) and truce,
//   - broker peace between two warring crowns,
//   - campaign for their liege — wins count toward the liege's war goal and
//     earn a share of the tribute when the liege wins,
//   - fund the restoration of a fallen kingdom in one of its old towns.
// All randomness comes from Utils; world/player are explicit parameters.

import { Utils } from '../core/utils.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { PlayerEffects } from './playerEffects.js';
import { PlayerMilitary } from './playerMilitary.js';

export const REALM_POLITICS = {
    broker: { fee: 50, cooldownDays: 10, base: 0.2, perDiplomacy: 0.04, maxRenownBonus: 0.15, lopsidedPenalty: 0.15, renown: 8, reputation: 8 },
    campaign: { enemyShare: 0.06, minStrength: 15, maxStrength: 400, wage: 30, reputation: 3, enemyLoss: 0.95 },
    spoils: { tributeSharePerMerit: 0.1, maxTributeShare: 0.5, goldPerMerit: 20, renownPerMerit: 3, reputationPerMerit: 2 },
    restoration: {
        cost: { village: 300, town: 500, city: 800, capital: 1200 },
        base: 0.35, unrestBonus: 0.25, perStealth: 0.03, maxChance: 0.9,
        renown: 20, reputationRestored: 40, reputationOccupier: -30, caughtChance: 0.5, caughtReputation: -15,
    },
};

function _pairKey(a, b) {
    return [a, b].sort().join('|');
}

export const RealmPolitics = {
    _state(player) {
        if (!player.politics) player.politics = { brokerCooldown: {}, merit: {}, historySeen: 0 };
        if (!player.politics.brokerCooldown) player.politics.brokerCooldown = {};
        if (!player.politics.merit) player.politics.merit = {};
        return player.politics;
    },

    /** Every war between living kingdoms: [{ a, b, days, aGains, aGoal, bGains, bGoal }]. */
    activeWars(world) {
        const seen = new Set();
        const out = [];
        for (const a of world.kingdoms || []) {
            if (!a.isAlive) continue;
            for (const id of a.wars || []) {
                const b = world.getKingdom(id);
                if (!b || !b.isAlive) continue;
                const key = _pairKey(a.id, b.id);
                if (seen.has(key)) continue;
                seen.add(key);
                const sa = KingdomAI._warState(a, b.id, world);
                const sb = KingdomAI._warState(b, a.id, world);
                out.push({
                    a, b,
                    days: ((world.day || 0) - Math.min(sa.since, sb.since)),
                    aGains: sa.gains, aGoal: sa.goal, bGains: sb.gains, bGoal: sb.goal,
                });
            }
        }
        return out;
    },

    /** Truces still in force: [{ a, b, daysLeft }]. */
    truces(world) {
        const seen = new Set();
        const out = [];
        const day = world.day || 0;
        for (const a of world.kingdoms || []) {
            if (!a.isAlive) continue;
            for (const [id, until] of Object.entries(a.truces || {})) {
                if (until <= day) continue;
                const b = world.getKingdom(id);
                if (!b || !b.isAlive) continue;
                const key = _pairKey(a.id, b.id);
                if (seen.has(key)) continue;
                seen.add(key);
                out.push({ a, b, daysLeft: until - day });
            }
        }
        return out;
    },

    // ──────────── BROKER PEACE ────────────

    /** Chance the player talks two warring crowns into a truce. */
    brokerChance(player, war) {
        const B = REALM_POLITICS.broker;
        let chance = B.base + B.perDiplomacy * PlayerEffects.effectiveDiplomacy(player)
            + Math.min(B.maxRenownBonus, (player.renown || 0) / 1000);
        // A side close to its war goal won't stop now
        if (war.aGains * 2 >= war.aGoal || war.bGains * 2 >= war.bGoal) chance -= B.lopsidedPenalty;
        return Utils.clamp(chance, 0.05, 0.9);
    },

    brokerPeace(player, world, aId, bId) {
        const B = REALM_POLITICS.broker;
        const st = RealmPolitics._state(player);
        const war = RealmPolitics.activeWars(world).find(w =>
            (w.a.id === aId && w.b.id === bId) || (w.a.id === bId && w.b.id === aId));
        if (!war) return { success: false, reason: 'Those realms are not at war.' };
        const key = _pairKey(aId, bId);
        const day = world.day || 0;
        if ((st.brokerCooldown[key] || 0) > day) {
            return { success: false, reason: `Both courts turned your envoys away recently. Try again in ${st.brokerCooldown[key] - day} days.` };
        }
        if ((player.gold || 0) < B.fee) return { success: false, reason: `Envoys and gifts cost ${B.fee} gold.` };
        player.gold -= B.fee;

        const chance = RealmPolitics.brokerChance(player, war);
        if (Utils.random() < chance) {
            KingdomAI.endWar(war.a, war.b, world, {
                text: `🕊️ Through ${player.name || 'a wandering envoy'}'s mediation, ${war.a.name} and ${war.b.name} sign a truce.`,
            });
            player.renown = (player.renown || 0) + B.renown;
            if (!player.reputation) player.reputation = {};
            const gain = PlayerEffects.scaleReputationGain(player, B.reputation);
            for (const k of [war.a, war.b]) player.reputation[k.id] = Math.min(100, (player.reputation[k.id] || 0) + gain);
            return { success: true, message: `You broker a truce between ${war.a.name} and ${war.b.name}. +${B.renown} renown, +${gain} reputation with both.` };
        }
        st.brokerCooldown[key] = day + B.cooldownDays;
        return { success: true, failed: true, message: `Neither court will yield yet. Your ${B.fee} gold in gifts is spent; try again in ${B.cooldownDays} days.` };
    },

    // ──────────── CAMPAIGN FOR YOUR LIEGE ────────────

    /** The player's liege and the realms it's at war with, or null. */
    campaignOptions(player, world) {
        const liege = player.allegiance ? world.getKingdom(player.allegiance) : null;
        if (!liege || !liege.isAlive || !(liege.wars || []).length) return null;
        const enemies = liege.wars.map(id => world.getKingdom(id)).filter(k => k && k.isAlive);
        return enemies.length ? { liege, enemies } : null;
    },

    /** Enemy force the player meets in one campaign battle. */
    campaignStrength(enemy) {
        const C = REALM_POLITICS.campaign;
        return Utils.clamp(Math.floor((enemy.military || 0) * C.enemyShare), C.minStrength, C.maxStrength);
    },

    /**
     * Ride out against the liege's enemy. A win pushes the liege toward its
     * war goal, bleeds the enemy and earns wages and merit.
     */
    joinCampaign(player, world, enemyId, context = {}) {
        const C = REALM_POLITICS.campaign;
        const opts = RealmPolitics.campaignOptions(player, world);
        if (!opts) return { success: false, reason: 'Your liege is not at war.' };
        const enemy = opts.enemies.find(k => k.id === enemyId);
        if (!enemy) return { success: false, reason: 'Your liege is not at war with that realm.' };
        if (!player.army || player.army.length === 0) return { success: false, reason: 'You need an army to join the campaign.' };

        const strength = RealmPolitics.campaignStrength(enemy);
        const battle = PlayerMilitary.combat(player, strength, `${enemy.name} vanguard`, { ...context, world });
        if (battle.victory) {
            const st = RealmPolitics._state(player);
            const meritKey = `${opts.liege.id}:${enemy.id}`;
            st.merit[meritKey] = (st.merit[meritKey] || 0) + 1;
            KingdomAI._warState(opts.liege, enemy.id, world).gains += 1;
            enemy.military = Math.floor((enemy.military || 0) * C.enemyLoss);
            player.gold = (player.gold || 0) + C.wage;
            if (!player.reputation) player.reputation = {};
            const gain = PlayerEffects.scaleReputationGain(player, C.reputation);
            player.reputation[opts.liege.id] = Math.min(100, (player.reputation[opts.liege.id] || 0) + gain);
            return {
                success: true, battle,
                message: `You rout a ${enemy.name} vanguard for ${opts.liege.name}. +${C.wage}g wages, +${gain} reputation; the war turns in your liege's favour.`,
            };
        }
        return { success: true, battle, failed: true, message: `The ${enemy.name} vanguard throws you back.` };
    },

    // ──────────── RESTORATION ────────────

    /** If this town once belonged to a fallen realm, what reviving it would take. */
    restorationTarget(player, world, tile) {
        const s = tile && tile.settlement;
        if (!s || !s.formerKingdom) return null;
        const fallen = world.getKingdom(s.formerKingdom);
        const occupier = world.getKingdom(s.kingdom);
        if (!fallen || fallen.isAlive || !occupier || !occupier.isAlive) return null;
        const R = REALM_POLITICS.restoration;
        const cost = R.cost[s.type] || R.cost.village;
        const unrest = (occupier.stability != null ? occupier.stability : 60) < KingdomAI.RESTORATION.unrest;
        const chance = Math.min(R.maxChance, R.base + (unrest ? R.unrestBonus : 0) + R.perStealth * ((player.skills && player.skills.stealth) || 0));
        return { fallen, occupier, cost, chance, unrest };
    },

    /** Pay rebels to raise the old banner. */
    fundRestoration(player, world, tile) {
        const R = REALM_POLITICS.restoration;
        const t = RealmPolitics.restorationTarget(player, world, tile);
        if (!t) return { success: false, reason: 'No fallen crown has a claim here.' };
        if (player.allegiance === t.occupier.id) return { success: false, reason: `You are sworn to ${t.occupier.name} — funding rebels would be treason.` };
        if ((player.gold || 0) < t.cost) return { success: false, reason: `The rebels need ${t.cost} gold for arms and bribes.` };
        player.gold -= t.cost;
        if (!player.reputation) player.reputation = {};

        if (Utils.random() < t.chance) {
            KingdomAI.restoreKingdom(t.fallen, t.occupier, { q: tile.q, r: tile.r, tile }, world);
            player.renown = (player.renown || 0) + R.renown;
            player.reputation[t.fallen.id] = Math.min(100, (player.reputation[t.fallen.id] || 0) + R.reputationRestored);
            player.reputation[t.occupier.id] = Math.max(-100, (player.reputation[t.occupier.id] || 0) + R.reputationOccupier);
            return { success: true, message: `Your gold arms the rising: ${t.fallen.name} is restored in ${tile.settlement.name}! +${R.renown} renown; its crown owes you everything.` };
        }
        const caught = Utils.random() < R.caughtChance;
        if (caught) player.reputation[t.occupier.id] = Math.max(-100, (player.reputation[t.occupier.id] || 0) + R.caughtReputation);
        return {
            success: true, failed: true,
            message: `The rising is crushed before it begins and your ${t.cost} gold is lost.${caught ? ` ${t.occupier.name} learns who paid for it (${R.caughtReputation} reputation).` : ''}`,
        };
    },

    /** Cache the liege's enemies and allies on the player (PlayerEffects.liegeTradeModifier reads it). */
    refreshLiegeRelations(player, world) {
        const st = RealmPolitics._state(player);
        const liege = player.allegiance ? world.getKingdom(player.allegiance) : null;
        st.liegeEnemies = liege && liege.isAlive ? [...(liege.wars || [])] : [];
        st.liegeAllies = liege && liege.isAlive ? [...(liege.allies || [])] : [];
    },

    // ──────────── DAILY ────────────

    /**
     * When the player's liege wins a war the player fought in, they get a
     * share of the tribute. Returns [{ enemy, gold, renown }].
     */
    processDaily(player, world) {
        const st = RealmPolitics._state(player);
        const history = world.warHistory || [];
        const spoils = [];
        const S = REALM_POLITICS.spoils;
        for (const h of history) {
            if (h.id <= (st.historySeen || 0) || !h.victor) continue;
            const loser = h.victor === h.a ? h.b : h.a;
            const key = `${h.victor}:${loser}`;
            const merit = st.merit[key] || 0;
            if (!merit) continue;
            delete st.merit[key];
            const share = Math.min(S.maxTributeShare, S.tributeSharePerMerit * merit);
            const gold = Math.floor((h.tribute || 0) * share) + S.goldPerMerit * merit;
            const renown = S.renownPerMerit * merit;
            player.gold = (player.gold || 0) + gold;
            player.renown = (player.renown || 0) + renown;
            if (!player.reputation) player.reputation = {};
            player.reputation[h.victor] = Math.min(100, (player.reputation[h.victor] || 0) + S.reputationPerMerit * merit);
            const loserK = world.getKingdom(loser);
            spoils.push({ enemy: loserK ? loserK.name : 'the enemy', gold, renown });
        }
        // Wars that ended without a victor clear their merit
        for (const key of Object.keys(st.merit)) {
            const [l, e] = key.split(':');
            const liege = world.getKingdom(l);
            if (!liege || !(liege.wars || []).includes(e)) delete st.merit[key];
        }
        st.historySeen = world.warHistorySeq || st.historySeen || 0;
        RealmPolitics.refreshLiegeRelations(player, world);
        return spoils;
    },
};
