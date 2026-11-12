// ============================================
// HEIRS — placing the House's grown children
// ============================================
// A child who has come of age (systems/upbringing.js) can be put to use:
//   • an office in the House (House.assignRole — unchanged),
//   • an alliance marriage into a kingdom's nobility (a dowry buys standing),
//   • a royal match with an unwed prince or princess of a ruling dynasty
//     (Prestige and a dowry — Throne.royalMatchCandidates — and the House
//     gains a claim on that throne),
//   • a local match with one of the townsfolk (systems/townsfolk.js): no
//     dowry and a little Prestige lost, but the town and the bride's or
//     groom's kin warm to the House, and a known face joins the family,
//     • fostering as a ward at a ruler's court: the child is away for a season
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
import { Townsfolk } from './townsfolk.js';
import { NPCLords } from '../world/npcLords.js';
import { Names } from '../core/names.js';

const DEFAULTS = {
    allianceDowry: 200, allianceReputation: 15, allianceMinReputation: 0, alliancePrestige: 4,
    royalClaim: 15, royalReputation: 20, wardDays: 120, wardReputation: 10,
    wardSkills: { leadership: 1, diplomacy: 1 }, wardLordTraits: {},
    localPrestige: -2, localPrestigeGentle: 1, localReputation: 4, localKinRegard: 15, localMaxAgeGap: 12,
    localGentleRoles: ['noble', 'merchant'],
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

    /**
     * How a realm is bound to the House by blood: 'married' (the ruler's own
     * match, or a child wed into it), 'betrothed' (a child promised to it,
     * systems/heirAgency.js) or null. Pure.
     */
    kinshipWith(player, kid) {
        if (!player || !kid) return null;
        if (player.marriageAllianceKingdom === kid) return 'married';
        let kin = null;
        for (const c of player.children || []) {
            if (!c || c.isAlive === false) continue;
            const up = c.upbringing;
            const sp = up && up.spouse;
            if (sp && (sp.kind === 'alliance' || sp.kind === 'royal') && sp.kingdomId === kid) return 'married';
            const b = up && up.agency && up.agency.betrothal;
            if (b && b.kingdomId === kid) kin = 'betrothed';
        }
        return kin;
    },

    /**
     * The share of a realm's hostility left when it is bound to the House by
     * marriage or betrothal (systems/coalitions.js): { kin, factor }.
     */
    kinshipFactor(player, kid) {
        const kin = Heirs.kinshipWith(player, kid);
        if (!kin) return { kin: null, factor: 1 };
        const a = (typeof DataLoader !== 'undefined' && DataLoader.upbringing && DataLoader.upbringing.agency) || {};
        const f = kin === 'married' ? a.kinshipMarried : a.kinshipBetrothed;
        return { kin, factor: Number.isFinite(f) ? f : (kin === 'married' ? 0.5 : 0.75) };
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
     * opts { dowry, minReputation, deed } override the price and the bar (a
     * match the other House proposed by letter — systems/courtLetters.js).
     */
    marryForAlliance(player, world, childId, kid, opts = {}) {
        const cfg = Heirs.config();
        const got = Heirs._available(player, childId);
        if (got.error) return { success: false, reason: got.error };
        const { child, up } = got;
        if (up.spouse) return { success: false, reason: `${child.firstName} is already wed.` };
        const k = Heirs._kingdom(world, kid);
        if (!k || !k.isAlive) return { success: false, reason: 'No such kingdom.' };
        const rep = (player.reputation && player.reputation[kid]) || 0;
        const minRep = Number.isFinite(opts.minReputation) ? opts.minReputation : cfg.allianceMinReputation;
        const dowry = Number.isFinite(opts.dowry) ? opts.dowry : cfg.allianceDowry;
        if (rep < minRep) return { success: false, reason: `${k.name}'s nobles will not wed a House they distrust (need ${minRep} reputation).` };
        if ((player.gold || 0) < dowry) return { success: false, reason: `The dowry is ${dowry} gold.` };
        player.gold -= dowry;
        // The dowry goes into the realm's treasury (real coin)
        if (dowry > 0) k.treasury = _num(k.treasury) + dowry;
        if (!player.reputation) player.reputation = {};
        player.reputation[kid] = rep + cfg.allianceReputation;
        const gender = child.gender === 'female' ? 'male' : 'female';
        up.spouse = {
            kind: 'alliance', kingdomId: kid, kingdomName: k.name,
            name: `${Heirs._name(world, gender, k.culture)} of ${Names.realm(k.name)}`, day: (world && world.day) || 0,
        };
        up.placement = { kind: 'alliance', kingdomId: kid, kingdomName: k.name, day: up.spouse.day };
        if (player.house) {
            House.award(player.house, cfg.alliancePrestige, `${child.firstName} weds into ${Names.realm(k.name)}`, world && world.day);
            House._chronicle(player.house, world, `${child.firstName} weds ${up.spouse.name}, binding ${player.house.name} to ${Names.realm(k.name)}.`, ['marriage', 'heirs']);
        }
        Heirs._recordMatch(player, world, child, up.spouse);
        NPCLords.rememberDeed(world, k.lord, opts.deed || 'child_wed', { note: child.firstName });
        return { success: true, child, spouse: up.spouse, reputation: cfg.allianceReputation, cost: dowry };
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
        k.treasury = _num(k.treasury) + _num(tcfg.royalMatchGold);
        royal.spouseId = child.id;
        if (!player.reputation) player.reputation = {};
        player.reputation[kid] = rep + cfg.royalReputation;
        up.spouse = {
            kind: 'royal', kingdomId: kid, kingdomName: k.name, royalId: royal.id,
            name: `${royal.firstName} ${royal.dynasty || ''}`.trim(), day: world.day,
        };
        up.placement = { kind: 'royal', kingdomId: kid, kingdomName: k.name, day: world.day };
        const claim = Throne.grantClaim(player, world, kid, 'marriage', cfg.royalClaim);
        const wed = NPCLords.deedDef('child_wed');
        NPCLords.rememberDeed(world, k.lord, 'child_wed', { note: child.firstName, weight: wed ? wed.weight * 1.5 : undefined });
        House._chronicle(player.house, world, `${child.firstName} weds ${up.spouse.name} of the royal house of ${Names.realm(k.name)}.`, ['marriage', 'heirs', 'throne']);
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
        const lordName = ruler && ruler.firstName ? `${ruler.firstName} of ${Names.realm(k.name)}` : (k.ruler || k.name);
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
        NPCLords.rememberDeed(world, k.lord, 'ward', { note: child.firstName });
        return { success: true, child, placement: up.placement };
    },

    // ── A match in town ──────────────────────────────────

    /**
     * Grown, unwed townsfolk of the other sex, within a few years of the
     * child's age, in every town with a roster — the people the player has
     * spoken with (and their kin's towns) first.
     * Returns [{ folk, person, town, name, age, role, known, gentle }].
     */
    localMatches(player, world, childId) {
        const cfg = Heirs.config();
        const got = Heirs._available(player, childId);
        if (got.error) return [];
        const child = got.child;
        const day = (world && world.day) || 0;
        const want = child.gender === 'female' ? 'male' : 'female';
        const C = Townsfolk.config();
        const views = world && typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        const out = [];
        for (const s of views) {
            const folk = s && s.folk;
            if (!folk || !Array.isArray(folk.people)) continue;
            for (const p of folk.people) {
                if (!Townsfolk.isHere(p) || p.gender !== want || p.role === 'priest' || p.role === 'child' || p.wedHouse) continue;
                const age = Townsfolk.age(p, day);
                if (age < C.comeOfAge || Math.abs(age - (child.age || 16)) > cfg.localMaxAgeGap) continue;
                const sp = Townsfolk.get(folk, p.spouse);
                if (sp && sp.died == null) continue;
                out.push({
                    folk, person: p, town: s.name, name: Townsfolk.name(p), age, role: Townsfolk.roleTitle(p),
                    known: (p.mem && p.mem.timesSpoken) || 0, gentle: cfg.localGentleRoles.includes(p.role),
                });
            }
        }
        out.sort((a, b) => b.known - a.known || Number(b.gentle) - Number(a.gentle) || a.town.localeCompare(b.town) || a.person.id - b.person.id);
        return out;
    },

    /**
     * Wed a grown child to a townsperson. No dowry; the House loses a little
     * Prestige for marrying beneath it (gains a little if the match is of a
     * noble or merchant family), the town's realm thinks better of the House,
     * and the townsperson's kin are warmed. The townsperson leaves home to
     * live with the House, and becomes the child's spouse should the child
     * inherit (Relationships._seatHeirSpouse).
     */
    marryTownsperson(player, world, childId, folk, personId) {
        const cfg = Heirs.config();
        const got = Heirs._available(player, childId);
        if (got.error) return { success: false, reason: got.error };
        const { child, up } = got;
        if (up.spouse) return { success: false, reason: `${child.firstName} is already wed.` };
        const p = folk ? Townsfolk.get(folk, personId) : null;
        const match = p && Heirs.localMatches(player, world, childId).find(m => m.person === p);
        if (!match) return { success: false, reason: 'That match cannot be made.' };
        const day = (world && world.day) || 0;
        const tile = world && typeof world.getTile === 'function' ? world.getTile(folk.q, folk.r) : null;
        const town = tile && tile.settlement;
        const delta = match.gentle ? cfg.localPrestigeGentle : cfg.localPrestige;
        if (player.house) {
            if (delta > 0) House.award(player.house, delta, `${child.firstName} weds ${match.name} of ${match.town}`, day);
            else if (delta < 0) House.spend(player.house, Math.min(-delta, Math.max(0, player.house.prestige || 0)), `${child.firstName} weds beneath the House`, day);
        }
        const kid = town && town.kingdom;
        if (kid) {
            if (!player.reputation) player.reputation = {};
            player.reputation[kid] = ((player.reputation[kid]) || 0) + cfg.localReputation;
        }
        // Their kin think the better of the House
        for (const id of [...p.parents, ...Townsfolk.siblings(folk, p).map(s => s.id)]) {
            const kin = Townsfolk.get(folk, id);
            if (!kin || kin.died != null || !kin.mem) continue;
            kin.mem.disposition = Math.min(100, (Number.isFinite(kin.mem.disposition) ? kin.mem.disposition : 50) + cfg.localKinRegard);
        }
        const houseName = (player.house && player.house.name) || `the House of ${player.lastName || player.firstName || 'the player'}`;
        Townsfolk._log(p, day, 'wedHouse', null, `${child.firstName} of ${houseName}`);
        for (const id of p.parents) Townsfolk._log(Townsfolk.get(folk, id), day, 'kidLeft', p.id, houseName);
        Townsfolk._annal(folk, world, day, { k: 'wedHouse', a: p.id, b: null, x: houseName }, []);
        p.wedHouse = true;
        p.away = { d: day, to: `wed into ${houseName}`, withPlayer: 'house' };
        up.spouse = {
            kind: 'local', folkUid: `${folk.q},${folk.r}#${p.id}`, townName: match.town, role: match.role,
            name: match.name, day,
        };
        up.placement = { kind: 'local', townName: match.town, day };
        if (player.house) House._chronicle(player.house, world, `${child.firstName} weds ${match.name}, ${match.role} of ${match.town}.`, ['marriage', 'heirs']);
        return { success: true, child, spouse: up.spouse, prestige: delta, reputation: kid ? cfg.localReputation : 0 };
    },
};
