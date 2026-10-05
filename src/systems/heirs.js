// ============================================
// HEIRS — placing the House's grown children
// ============================================
// A child who has come of age (systems/upbringing.js) can be put to use:
//   • an office in the House (House.assignRole — unchanged),
//   • an alliance marriage into a kingdom's nobility (a dowry buys standing),
//   • a royal match with an unwed prince or princess of a ruling dynasty
//     (Prestige and a dowry — Throne.royalMatchCandidates — and the House
//     gains a claim on that throne),
//   • fostering as a ward at a ruler's court: the child is away for a season
//     and returns with skills, standing with that realm and, often, one of
//     the host's traits (the return is processed by Upbringing.processDay).
// A married or fostered child stays in the line of succession.
//
// No randomness, no import-time side effects. Content: data/upbringing.json
// → placements (DataLoader.upbringing).

import { DataLoader } from '../core/dataLoader.js';
import { House } from './house.js';
import { Throne } from './throne.js';
import { Upbringing } from './upbringing.js';
import { Traits } from './traits.js';

const DEFAULTS = {
    allianceDowry: 200, allianceReputation: 15, allianceMinReputation: 0, alliancePrestige: 4,
    royalClaim: 15, royalReputation: 20, wardDays: 120, wardReputation: 10,
    wardSkills: { leadership: 1, diplomacy: 1 }, wardLordTraits: {},
};

function _num(v) {
    return typeof v === 'number' && isFinite(v) ? v : 0;
}

export const Heirs = {
    config() {
        const d = (typeof DataLoader !== 'undefined' && DataLoader.upbringing && DataLoader.upbringing.placements) || {};
        return { ...DEFAULTS, ...d };
    },

    _kingdom(world, kid) {
        return world && world.getKingdom ? world.getKingdom(kid) : null;
    },

    /** Common gate: a living, come-of-age, unmarried child who is at home. */
    /** A child's noble match counts as a noble marriage for the reign's legacy. */
    _recordMatch(player, world, child, spouse) {
        if (!player.house || !player.house.stats) return;
        player.house.stats.nobleMarriage = (player.house.stats.nobleMarriage || 0) + 1;
    },

    _available(player, childId) {
        const child = ((player && player.children) || []).find(c => c && c.id === childId);
        if (!child || child.isAlive === false) return { error: 'No such child.' };
        const up = Upbringing.ensure(child);
        if (!up.comeOfAge) return { error: `${child.firstName} has not yet come of age.` };
        if (Upbringing.isAway(child)) return { error: `${child.firstName} is away at a foreign court.` };
        return { child, up };
    },

    /** Kingdoms a grown child could marry or be fostered into. */
    kingdoms(player, world) {
        const ruled = Throne.ruledKingdom(player, world);
        return ((world && world.kingdoms) || []).filter(k => k && k.isAlive && !(ruled && ruled.id === k.id));
    },

    /** Unwed royals of age in a kingdom (the eldest first). */
    royalCandidates(world, kid) {
        return Throne.royalMatchCandidates(world, kid);
    },

    _name(world, gender, culture) {
        // Deterministic spouse name: first of the culture's pool for the other gender
        const k = culture || 'Imperial';
        const pool = (typeof DataLoader !== 'undefined' && DataLoader._gamedata && DataLoader._gamedata.characters
            && DataLoader._gamedata.characters.firstNames && DataLoader._gamedata.characters.firstNames[k]) || null;
        const list = pool && pool[gender];
        return Array.isArray(list) && list.length ? list[(world && world.day ? world.day : 0) % list.length] : (gender === 'female' ? 'Helena' : 'Edmund');
    },

    /**
     * Marry a grown child into a kingdom's nobility for an alliance: pay a
     * dowry; the kingdom's regard for you rises and the House gains Prestige.
     */
    marryForAlliance(player, world, childId, kid) {
        const cfg = Heirs.config();
        const got = Heirs._available(player, childId);
        if (got.error) return { success: false, reason: got.error };
        const { child, up } = got;
        if (up.spouse) return { success: false, reason: `${child.firstName} is already wed.` };
        const k = Heirs._kingdom(world, kid);
        if (!k || !k.isAlive) return { success: false, reason: 'No such kingdom.' };
        const rep = (player.reputation && player.reputation[kid]) || 0;
        if (rep < cfg.allianceMinReputation) return { success: false, reason: `${k.name}'s nobles will not wed a House they distrust (need ${cfg.allianceMinReputation} reputation).` };
        if ((player.gold || 0) < cfg.allianceDowry) return { success: false, reason: `The dowry is ${cfg.allianceDowry} gold.` };
        player.gold -= cfg.allianceDowry;
        if (!player.reputation) player.reputation = {};
        player.reputation[kid] = rep + cfg.allianceReputation;
        const gender = child.gender === 'female' ? 'male' : 'female';
        up.spouse = {
            kind: 'alliance', kingdomId: kid, kingdomName: k.name,
            name: `${Heirs._name(world, gender, k.culture)} of ${k.name}`, day: (world && world.day) || 0,
        };
        up.placement = { kind: 'alliance', kingdomId: kid, kingdomName: k.name, day: up.spouse.day };
        if (player.house) {
            House.award(player.house, cfg.alliancePrestige, `${child.firstName} weds into ${k.name}`, world && world.day);
            House._chronicle(player.house, world, `${child.firstName} weds ${up.spouse.name}, binding ${player.house.name} to ${k.name}.`, ['marriage', 'heirs']);
        }
        Heirs._recordMatch(player, world, child, up.spouse);
        return { success: true, child, spouse: up.spouse, reputation: cfg.allianceReputation, cost: cfg.allianceDowry };
    },

    /**
     * Wed a grown child to an unwed royal: Prestige and a dowry (the same
     * price as the ruler's own royal match). The House gains a claim on the
     * throne through the marriage, and standing with the realm.
     */
    arrangeRoyalMatch(player, world, childId, kid) {
        const cfg = Heirs.config();
        const tcfg = Throne.config();
        const got = Heirs._available(player, childId);
        if (got.error) return { success: false, reason: got.error };
        const { child, up } = got;
        if (up.spouse) return { success: false, reason: `${child.firstName} is already wed.` };
        const k = Heirs._kingdom(world, kid);
        if (!k || !k.isAlive) return { success: false, reason: 'No such kingdom.' };
        const rep = (player.reputation && player.reputation[kid]) || 0;
        if (rep < tcfg.royalMatchMinReputation) return { success: false, reason: `${k.name} will not wed its blood to a stranger (need ${tcfg.royalMatchMinReputation} reputation).` };
        const royal = Heirs.royalCandidates(world, kid)[0];
        if (!royal) return { success: false, reason: `${k.name} has no unwed prince or princess of age.` };
        if ((player.gold || 0) < tcfg.royalMatchGold) return { success: false, reason: `The dowry is ${tcfg.royalMatchGold} gold.` };
        if (!player.house || !House.spend(player.house, tcfg.royalMatchPrestige, `royal match for ${child.firstName}`, world.day)) {
            return { success: false, reason: `Need ${tcfg.royalMatchPrestige} Prestige.` };
        }
        player.gold -= tcfg.royalMatchGold;
        royal.spouseId = child.id;
        if (!player.reputation) player.reputation = {};
        player.reputation[kid] = rep + cfg.royalReputation;
        up.spouse = {
            kind: 'royal', kingdomId: kid, kingdomName: k.name, royalId: royal.id,
            name: `${royal.firstName} ${royal.dynasty || ''}`.trim(), day: world.day,
        };
        up.placement = { kind: 'royal', kingdomId: kid, kingdomName: k.name, day: world.day };
        const claim = Throne.grantClaim(player, world, kid, 'marriage', cfg.royalClaim);
        House._chronicle(player.house, world, `${child.firstName} weds ${up.spouse.name} of the royal house of ${k.name}.`, ['marriage', 'heirs', 'throne']);
        Heirs._recordMatch(player, world, child, up.spouse);
        return { success: true, child, spouse: up.spouse, claim, cost: tcfg.royalMatchGold, prestige: tcfg.royalMatchPrestige };
    },

    /** The House trait a ruler's own traits would teach a ward, or null. */
    lordTrait(world, kid) {
        const k = Heirs._kingdom(world, kid);
        const ruler = k && k.characterData && k.characterData.ruler;
        const map = Heirs.config().wardLordTraits || {};
        for (const t of ((ruler && ruler.traits) || [])) {
            const id = map[(t && t.id) || t];
            if (id && Traits.TRAITS[id]) return id;
        }
        return null;
    },

    /** Foster a grown child at a ruler's court for a season (wardDays). */
    sendAsWard(player, world, childId, kid) {
        const cfg = Heirs.config();
        const got = Heirs._available(player, childId);
        if (got.error) return { success: false, reason: got.error };
        const { child, up } = got;
        if (up.fostered) return { success: false, reason: `${child.firstName} has already been fostered.` };
        const k = Heirs._kingdom(world, kid);
        if (!k || !k.isAlive) return { success: false, reason: 'No such kingdom.' };
        const ruler = k.characterData && k.characterData.ruler;
        const lordName = ruler && ruler.firstName ? `${ruler.firstName} of ${k.name}` : (k.ruler || k.name);
        const day = (world && world.day) || 0;
        // A ward cannot hold a House office from abroad
        if (player.house && player.house.roles) {
            for (const r of House.ROLE_IDS) {
                if (r !== 'heir' && player.house.roles[r] === child.id) player.house.roles[r] = null;
            }
        }
        up.fostered = true;
        up.placement = {
            kind: 'ward', kingdomId: kid, kingdomName: k.name, lordName, day,
            until: day + _num(cfg.wardDays), trait: Heirs.lordTrait(world, kid), returned: false,
        };
        if (player.house) House._chronicle(player.house, world, `${child.firstName} is sent to foster at the court of ${lordName}.`, ['heirs']);
        return { success: true, child, placement: up.placement };
    },
};
