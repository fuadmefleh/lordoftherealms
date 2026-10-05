// ============================================
// REALM WARS — kingdoms go to war with the player
// ============================================
// Kingdoms used to fight only each other. Now a kingdom whose hostility toward
// the player runs high (bad reputation plus, for rival Houses, the feud) first
// issues an *ultimatum* — pay tribute within a few days or face war. Ignore it
// and the kingdom declares war, then marches real *war hosts* (world units)
// at the player's properties and colonies. A host that reaches its target
// razes or damages a property, or besieges and may capture a colony. The
// player fights hosts in the field (they engage when adjacent, or can be
// attacked), and each host destroyed raises the player's war score. Wars end
// by buying peace, by forcing peace once the score is high enough, through
// exhaustion, or when the enemy kingdom falls; a truce follows.
//
// State lives on player.realmWars and is saved with the player. World units
// are not saved, so each host is also recorded here and re-spawned from that
// record after a load. Randomness flows through Utils only.

import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { WorldUnit } from '../world/units.js';
import { House } from './house.js';
import { Technology } from './technology.js';
import { Holdings } from './holdings.js';

const CONFIG = {
    checkCadence: 10,          // days between hostility checks
    hostilityThreshold: 80,    // −reputation + feud at which a kingdom threatens war
    ultimatumDays: 10,
    tributeBase: 300,
    tributePerMilitary: 0.5,
    truceDays: 120,
    hostCadence: 12,           // days between host dispatches per war
    maxHosts: 2,
    minMilitaryToSend: 60,
    hostSpeed: 3,
    scorePerHostDefeated: 30,
    scorePerHoldingLost: -20,
    enforcePeaceScore: 50,
    exhaustionDays: 150,
    peaceBase: 200,
    peacePerMilitary: 0.4,
    peaceScoreDiscount: 10,    // gold off the peace price per point of war score
    reparationsBase: 100,
    reparationsPerMilitary: 0.2,
};

const dist = (world, a, b) => Hex.wrappingDistance(a.q, a.r, b.q, b.r, world.width);

function findProperty(world, ref) {
    const tile = world.getTile(ref.q, ref.r);
    if (!tile) return { tile: null, prop: null };
    let prop = Array.isArray(tile.playerProperties) ? tile.playerProperties.find(p => p && p.type === ref.type) : null;
    if (!prop && tile.playerProperty && tile.playerProperty.type === ref.type) prop = tile.playerProperty;
    return { tile, prop };
}

export const RealmWars = {

    CONFIG,

    /** A civil war (systems/throne.js) ends with a crown or with exile, not a treaty. */
    CIVIL_WAR_REASON: 'A war for the throne ends with a crown or with exile — see Claims & Crowns.',

    _state(player) {
        if (!player.realmWars) player.realmWars = { wars: {}, ultimatums: {}, truces: {} };
        const s = player.realmWars;
        s.wars = s.wars || {};
        s.ultimatums = s.ultimatums || {};
        s.truces = s.truces || {};
        return s;
    },

    atWarWith(player, kingdomId) {
        return !!(player.realmWars && player.realmWars.wars && player.realmWars.wars[kingdomId]);
    },

    wars(player) {
        return Object.values(RealmWars._state(player).wars);
    },

    ultimatums(player) {
        return Object.values(RealmWars._state(player).ultimatums);
    },

    /** How badly a kingdom wants war with the player (0+). */
    hostility(player, kingdom) {
        if (!kingdom || kingdom.id === player.allegiance) return 0;
        const rep = (player.reputation && player.reputation[kingdom.id]) || 0;
        const rival = player.house && player.house.rivals && player.house.rivals[kingdom.id];
        return Math.max(0, -rep + ((rival && rival.feud) || 0));
    },

    /** Everything a war host can march on: properties and colonies. */
    holdings(player, world) {
        const out = [];
        for (const ref of player.properties || []) {
            if (findProperty(world, ref).prop) out.push({ kind: 'property', q: ref.q, r: ref.r, type: ref.type });
        }
        for (const c of player.colonies || []) {
            const t = world.getTile(c.q, c.r);
            if (t && t.settlement && t.settlement.colony) out.push({ kind: 'colony', q: c.q, r: c.r, name: c.name });
        }
        return out;
    },

    /** Tribute demanded; Diplomacy Mastery (allianceCost) talks it down. */
    tribute(kingdom, player = null) {
        const base = CONFIG.tributeBase + (kingdom.military || 0) * CONFIG.tributePerMilitary;
        return Math.round(base * (player ? Technology.getAllianceCostMultiplier(player) : 1));
    },

    peacePrice(player, kingdom) {
        const war = RealmWars._state(player).wars[kingdom.id];
        const score = war ? Math.max(0, war.score) : 0;
        const price = Math.max(100, CONFIG.peaceBase + (kingdom.military || 0) * CONFIG.peacePerMilitary
            - score * CONFIG.peaceScoreDiscount);
        // Diplomacy Mastery (allianceCost) makes treaties cheaper
        return Math.round(price * Technology.getAllianceCostMultiplier(player));
    },

    reparations(kingdom) {
        return Math.round(CONFIG.reparationsBase + (kingdom.military || 0) * CONFIG.reparationsPerMilitary);
    },

    // ── Ultimatums ──────────────────────────────────────────────

    issueUltimatum(player, world, kingdom) {
        const s = RealmWars._state(player);
        const u = {
            kingdomId: kingdom.id,
            name: kingdom.name,
            issuedDay: world.day,
            dueDay: world.day + CONFIG.ultimatumDays,
            tribute: RealmWars.tribute(kingdom, player),
        };
        s.ultimatums[kingdom.id] = u;
        return u;
    },

    payTribute(player, world, kingdomId) {
        const s = RealmWars._state(player);
        const u = s.ultimatums[kingdomId];
        if (!u) return { success: false, reason: 'No such ultimatum.' };
        if ((player.gold || 0) < u.tribute) return { success: false, reason: `Need ${u.tribute} gold.` };
        player.gold -= u.tribute;
        delete s.ultimatums[kingdomId];
        s.truces[kingdomId] = world.day + Math.round(CONFIG.truceDays / 2);
        if (player.reputation) player.reputation[kingdomId] = (player.reputation[kingdomId] || 0) + 20;
        House.accrueRivalFeud(player, world, kingdomId, -10);
        return { success: true, cost: u.tribute };
    },

    // ── War ─────────────────────────────────────────────────────

    declareWar(player, world, kingdom, reason) {
        const s = RealmWars._state(player);
        if (s.wars[kingdom.id]) return s.wars[kingdom.id];
        delete s.ultimatums[kingdom.id];
        const war = {
            kingdomId: kingdom.id,
            name: kingdom.name,
            startDay: world.day,
            score: 0,
            hosts: [],
            lastHostDay: world.day - CONFIG.hostCadence + 3, // first host marches within days
            holdingsLost: 0,
            hostsDefeated: 0,
            reason: reason || 'hostility',
        };
        s.wars[kingdom.id] = war;
        if (player.reputation) player.reputation[kingdom.id] = Math.min(player.reputation[kingdom.id] || 0, -60);
        if (player.house) House._chronicle(player.house, world, `${kingdom.name} declares war on ${player.house.name}.`, ['war']);
        if (world.events) world.events.push({ text: `⚔️ ${kingdom.name} has declared war on ${player.name || 'you'}!`, type: 'military', category: 'MILITARY' });
        return war;
    },

    endWar(player, world, kingdomId, how) {
        const s = RealmWars._state(player);
        const war = s.wars[kingdomId];
        if (!war) return null;
        for (const h of war.hosts) {
            const unit = (world.units || []).find(u => u.id === h.id);
            if (unit) unit.destroyed = true;
        }
        delete s.wars[kingdomId];
        s.truces[kingdomId] = world.day + CONFIG.truceDays;
        if (player.reputation) player.reputation[kingdomId] = Math.max(player.reputation[kingdomId] || 0, -30);
        House.accrueRivalFeud(player, world, kingdomId, -30);
        const label = { bought: 'peace was bought', victory: 'peace was won on the field', exhaustion: 'both sides were exhausted', fallen: 'the kingdom fell' }[how] || how;
        if (player.house) House._chronicle(player.house, world, `The war with ${war.name} ends: ${label}.`, ['war', 'peace']);
        return { war, how };
    },

    /** Pay the enemy to end the war. */
    sueForPeace(player, world, kingdomId) {
        const war = RealmWars._state(player).wars[kingdomId];
        const kingdom = world.getKingdom ? world.getKingdom(kingdomId) : null;
        if (!war || !kingdom) return { success: false, reason: 'No such war.' };
        if (war.civilWar) return { success: false, reason: RealmWars.CIVIL_WAR_REASON };
        const cost = RealmWars.peacePrice(player, kingdom);
        if ((player.gold || 0) < cost) return { success: false, reason: `Need ${cost} gold.` };
        player.gold -= cost;
        RealmWars.endWar(player, world, kingdomId, 'bought');
        return { success: true, cost };
    },

    /** Force peace and reparations once the war has gone your way. */
    demandPeace(player, world, kingdomId) {
        const war = RealmWars._state(player).wars[kingdomId];
        const kingdom = world.getKingdom ? world.getKingdom(kingdomId) : null;
        if (!war || !kingdom) return { success: false, reason: 'No such war.' };
        if (war.civilWar) return { success: false, reason: RealmWars.CIVIL_WAR_REASON };
        if (war.score < CONFIG.enforcePeaceScore) {
            return { success: false, reason: `Need a war score of ${CONFIG.enforcePeaceScore} (now ${war.score}). Defeat their war hosts.` };
        }
        const gold = RealmWars.reparations(kingdom);
        player.gold = (player.gold || 0) + gold;
        RealmWars.endWar(player, world, kingdomId, 'victory');
        House.recordPlayerDeed(player, world, 'battleWon', {
            scale: 3, reason: `victory over ${kingdom.name}`,
            chronicle: `${kingdom.name} sues for peace and pays ${gold} gold in reparations.`, tags: ['war', 'victory'],
        });
        return { success: true, gold };
    },

    // ── War hosts ───────────────────────────────────────────────

    _spawnUnit(world, kingdom, rec) {
        const unit = new WorldUnit('war_host', rec.q, rec.r, rec.targetQ, rec.targetR);
        unit.id = rec.id;
        unit.icon = '🚩';
        unit.name = rec.name;
        unit.speed = CONFIG.hostSpeed;
        unit.strength = rec.strength;
        unit.population = rec.strength * 2;
        unit.kingdomId = kingdom.id;
        unit.objectiveQ = rec.targetQ;
        unit.objectiveR = rec.targetR;
        unit.maxAge = 100000;
        unit.inventory = { gold: Math.round(rec.strength * 2), food: rec.strength };
        world.units.push(unit);
        return unit;
    },

    _dispatchHost(player, world, kingdom, war) {
        const targets = RealmWars.holdings(player, world);
        if (!targets.length || !world.getAllSettlements) return null;
        const bases = world.getAllSettlements().filter(s => s.kingdom === kingdom.id);
        if (!bases.length) return null;
        // March on the holding closest to any of the kingdom's settlements.
        let best = null;
        for (const t of targets) {
            for (const b of bases) {
                const d = dist(world, t, b);
                if (!best || d < best.d) best = { d, t, b };
            }
        }
        const strength = Utils.clamp(Math.round(20 + (kingdom.military || 0) * 0.04), 25, 180);
        kingdom.military = Math.max(0, (kingdom.military || 0) - strength);
        const rec = {
            id: `wh_${kingdom.id}_${world.day}_${war.hosts.length}`,
            name: `${kingdom.name} War Host`,
            q: best.b.q, r: best.b.r,
            targetQ: best.t.q, targetR: best.t.r,
            target: best.t,
            strength,
        };
        war.hosts.push(rec);
        war.lastHostDay = world.day;
        RealmWars._spawnUnit(world, kingdom, rec);
        return rec;
    },

    /** Called by PlayerMilitary.attackUnit when the player destroys a host. */
    onHostDefeated(player, world, unit) {
        const war = player.realmWars && player.realmWars.wars && player.realmWars.wars[unit.kingdomId];
        if (!war) return null;
        const before = war.hosts.length;
        war.hosts = war.hosts.filter(h => h.id !== unit.id);
        if (war.hosts.length === before) return null;
        war.score += CONFIG.scorePerHostDefeated;
        war.hostsDefeated++;
        House.recordPlayerDeed(player, world, 'battleWon', { reason: `broke the ${unit.name}` });
        return war;
    },

    _strike(player, world, kingdom, war, rec, unit) {
        const t = rec.target;
        let text = null;
        let lost = false;
        if (t.kind === 'property') {
            const { tile, prop } = findProperty(world, t);
            if (prop) {
                if ((prop.level || 1) > 1) {
                    prop.level -= 1;
                    prop.storage = 0;
                    prop.sabotagedDays = Math.max(prop.sabotagedDays || 0, 20);
                    text = `${rec.name} sacks your ${t.type} at (${t.q}, ${t.r}): it falls to level ${prop.level} and stops producing for 20 days.`;
                    lost = true;
                } else {
                    if (Array.isArray(tile.playerProperties)) tile.playerProperties = tile.playerProperties.filter(p => p !== prop);
                    if (tile.playerProperty === prop) tile.playerProperty = (tile.playerProperties && tile.playerProperties[0]) || null;
                    player.properties = (player.properties || []).filter(r => !(r.q === t.q && r.r === t.r && r.type === t.type));
                    text = `${rec.name} burns your ${t.type} at (${t.q}, ${t.r}) to the ground.`;
                    lost = true;
                }
            }
        } else if (t.kind === 'colony') {
            const tile = world.getTile(t.q, t.r);
            const settlement = tile && tile.settlement;
            const colony = settlement && settlement.colony;
            if (colony) {
                // Stationed troops, militia and walls (systems/holdings.js) hold the gates
                const defense = Holdings.defenseRating(settlement) * Utils.randFloat(0.8, 1.4);
                if (rec.strength > defense) {
                    settlement.kingdom = kingdom.id;
                    tile.kingdom = kingdom.id;
                    colony.isPlayerColony = false;
                    if (kingdom.territory) kingdom.territory.push({ q: tile.q, r: tile.r });
                    kingdom.population = (kingdom.population || 0) + (settlement.population || 0);
                    player.colonies = (player.colonies || []).filter(c => !(c.q === t.q && c.r === t.r));
                    text = `${rec.name} storms your colony ${settlement.name}. It now belongs to ${kingdom.name}.`;
                    lost = true;
                } else {
                    colony.loyalty = Math.max(0, (colony.loyalty || 0) - 10);
                    const fallen = Holdings.onSiegeRepelled(settlement);
                    text = `${rec.name} besieges ${settlement.name}, but the garrison holds (−10 loyalty${fallen ? `, ${fallen} stationed troops lost` : ''}).`;
                    war.score += 10;
                }
            }
        }
        // The host goes home either way.
        unit.destroyed = true;
        war.hosts = war.hosts.filter(h => h.id !== rec.id);
        kingdom.military = (kingdom.military || 0) + Math.round(rec.strength * 0.8);
        if (lost) {
            war.score += CONFIG.scorePerHoldingLost;
            war.holdingsLost++;
        }
        if (text && player.house) House._chronicle(player.house, world, text, ['war']);
        return text;
    },

    _tickWar(player, world, kingdom, war, out) {
        // Keep host records in sync with their units, re-spawning after a load.
        for (const rec of war.hosts.slice()) {
            let unit = world.units.find(u => u.id === rec.id);
            if (!unit) unit = RealmWars._spawnUnit(world, kingdom, rec);
            if (unit.destroyed) continue; // defeated today; onHostDefeated already ran
            rec.stuckDays = (unit.q === rec.q && unit.r === rec.r) ? (rec.stuckDays || 0) + 1 : 0;
            rec.q = unit.q; rec.r = unit.r;
            if (rec.stuckDays >= 8) {
                // No way through — the host gives up and marches home.
                unit.destroyed = true;
                war.hosts = war.hosts.filter(h => h.id !== rec.id);
                kingdom.military = (kingdom.military || 0) + rec.strength;
                continue;
            }
            if (unit.q === rec.targetQ && unit.r === rec.targetR) {
                const text = RealmWars._strike(player, world, kingdom, war, rec, unit);
                if (text) out.struck.push({ kingdomId: kingdom.id, text });
            }
        }
        if (war.hosts.length < CONFIG.maxHosts
            && world.day - war.lastHostDay >= CONFIG.hostCadence
            && (kingdom.military || 0) >= CONFIG.minMilitaryToSend) {
            const rec = RealmWars._dispatchHost(player, world, kingdom, war);
            if (rec) out.marching.push({ kingdomId: kingdom.id, host: rec });
        }
        if (!war.civilWar && !war.hosts.length && world.day - war.startDay >= CONFIG.exhaustionDays) {
            out.ended.push(RealmWars.endWar(player, world, kingdom.id, 'exhaustion'));
        }
    },

    /**
     * Advance wars and ultimatums one day. Call after world.advanceDay (units
     * have moved) from the end-of-day sequence.
     * @returns {{ ultimatums: object[], declared: object[], marching: object[], struck: object[], ended: object[] }}
     */
    processDaily(player, world) {
        const out = { ultimatums: [], declared: [], marching: [], struck: [], ended: [] };
        if (!player || !world || !world.kingdoms) return out;
        const s = RealmWars._state(player);
        const day = world.day || 0;
        if (!world.units) world.units = [];

        for (const war of Object.values(s.wars)) {
            const kingdom = world.kingdoms.find(k => k.id === war.kingdomId);
            if (!kingdom || !kingdom.isAlive) { out.ended.push(RealmWars.endWar(player, world, war.kingdomId, 'fallen')); continue; }
            RealmWars._tickWar(player, world, kingdom, war, out);
        }

        for (const u of Object.values(s.ultimatums)) {
            const kingdom = world.kingdoms.find(k => k.id === u.kingdomId);
            if (!kingdom || !kingdom.isAlive || kingdom.id === player.allegiance) { delete s.ultimatums[u.kingdomId]; continue; }
            if (day >= u.dueDay) out.declared.push(RealmWars.declareWar(player, world, kingdom, 'ultimatum ignored'));
        }

        if (day > 0 && day % CONFIG.checkCadence === 0 && RealmWars.holdings(player, world).length) {
            for (const k of world.kingdoms) {
                if (!k.isAlive || k.id === player.allegiance) continue;
                if (s.wars[k.id] || s.ultimatums[k.id]) continue;
                if ((s.truces[k.id] || 0) > day) continue;
                const h = RealmWars.hostility(player, k);
                if (h < CONFIG.hostilityThreshold) continue;
                if (Utils.random() < (h - 60) / 200) {
                    out.ultimatums.push(RealmWars.issueUltimatum(player, world, k));
                    break; // one new threat at a time
                }
            }
        }
        return out;
    },
};
