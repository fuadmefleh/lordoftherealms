// ============================================
// DAWN BIRTH — the player is born into a clan at the Dawn of Man
// ============================================
//
// In a world begun before any town (world/dawn.js) nobody comes from
// nowhere: the player is born to one of the wandering clans, with a father,
// a mother and brothers and sisters (relationship NPCs, warm to them from
// the start). The clan walks with the player while they keep near it
// (Dawn._followPlayer) and makes camp for good where the player chooses
// (settleHere → Dawn.settleWithPlayer) — or on its own, if the player has
// gone far. Either way the village is the family's home: `sync` (daily,
// from the end of the day) moves them in and tells the player.
//
// Content (kin, ages, regard, lines) in data/dawn.json `birth`. Randomness
// through Utils; player and world passed in.

import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Dawn } from '../world/dawn.js';
import { Characters } from '../world/characters.js';
import { Relationships } from '../systems/relationships.js';

const _num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _fill = (s, vars) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));

export const DawnBirth = {
    data() {
        const g = DataLoader._gamedata;
        return (g && g.dawn && g.dawn.birth) || {};
    },

    /** The clan the player begins beside (at world.playerStart), or the nearest one */
    _startClan(world, player) {
        const clans = world.units.filter(u => u.type === 'clan' && !u.destroyed);
        let best = null;
        for (const c of clans) {
            const d = Hex.wrappingOffsetDistance(c.q, c.r, player.q, player.r, world.width);
            if (!best || d < best.d) best = { c, d };
        }
        return best ? best.c : null;
    },

    /**
     * Born at the dawn: the player joins the clan they begin with, takes its
     * name if they have no other, and gains their family. → { clan, kin } or null
     * (not a dawn world, or no clan to be born into).
     */
    apply(player, world) {
        if (!Dawn.isActive(world) || !player) return null;
        const clan = DawnBirth._startClan(world, player);
        if (!clan) return null;
        const B = DawnBirth.data();
        clan.kinOfPlayer = true;
        player.dawnClan = clan.id;
        player.q = clan.q;
        player.r = clan.r;
        if (!player.lastName) {
            player.lastName = `of the ${clan.clanName}`;
            player.name = `${player.firstName} ${player.lastName}`.trim();
            if (player.dynasty) player.dynasty.name = clan.clanName;
        }

        const culture = clan.culture || 'Woodland';
        const names = (Characters && Characters.FIRST_NAMES && (Characters.FIRST_NAMES[culture] || Characters.FIRST_NAMES.Imperial)) || null;
        const home = { name: clan.name, kingdom: null, q: clan.q, r: clan.r };
        const age = _num(player.age, 20);
        const PA = B.parentAge || {};
        const regard = B.regard || {};
        const jobs = B.occupations && B.occupations.length ? B.occupations : ['Hunter'];
        const kin = [];
        const make = (role, gender, years) => {
            const npc = Relationships.generateNPC(home, world);
            npc.gender = gender;
            if (names && names[gender] && names[gender].length) npc.firstName = Utils.randPick(names[gender]);
            npc.dynasty = clan.clanName;
            npc.culture = culture;
            npc.age = Math.max(1, Math.round(years));
            npc.kin = role;
            npc.clanId = clan.id;
            npc.occupation = Utils.randPick(jobs);
            npc.settlementName = clan.name;
            const rel = Relationships.getRelationship(player, npc.id);
            rel.score = _num(role === 'father' || role === 'mother' ? regard.parent : regard.sibling, 60);
            rel.family = role;
            kin.push(npc);
            return npc;
        };
        make('father', 'male', age + Utils.randInt(_num(PA.min, 18), _num(PA.max, 30)) + 2);
        make('mother', 'female', age + Utils.randInt(_num(PA.min, 18), _num(PA.max, 30)));
        const S = B.siblings || {};
        const spread = _num(B.siblingAgeSpread, 9);
        for (let i = 0, n = Utils.randInt(_num(S.min, 1), _num(S.max, 3)); i < n; i++) {
            const gender = Utils.random() < 0.5 ? 'male' : 'female';
            make(gender === 'male' ? 'brother' : 'sister', gender, Math.max(2, age + Utils.randInt(-spread, spread)));
        }
        player.dawnKin = kin.map(k => k.id);
        if (typeof Relationships.prepareForSave === 'function') Relationships.prepareForSave(player);
        return { clan, kin };
    },

    /** "your father Bran, your mother Ide and your sister Wen" */
    kinLine(player) {
        const ids = Array.isArray(player && player.dawnKin) ? player.dawnKin : [];
        const parts = ids.map(id => Relationships.getNPC(id)).filter(n => n && n.isAlive !== false).map(n => `your ${n.kin} ${n.firstName}`);
        if (parts.length <= 1) return parts.join('');
        return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
    },

    /** The welcome at a dawn start */
    welcome(player, world) {
        const clan = Dawn.kinClan(world, player);
        return _fill(Dawn.data().welcome, { clan: clan ? clan.clanName : 'a', kin: DawnBirth.kinLine(player) || 'your kin' });
    },

    /** Can the player make camp for good here, with their clan? (the action's gate) */
    canSettleHere(player, world) {
        const clan = Dawn.kinClan(world, player);
        if (!clan) return false;
        const tile = world.getTile(player.q, player.r);
        return !!(tile && !tile.settlement && Hex.wrappingOffsetDistance(clan.q, clan.r, player.q, player.r, world.width) <= 1);
    },

    /** Make camp for good where the player stands → { success, text } */
    settleHere(player, world) {
        const res = Dawn.settleWithPlayer(world, player);
        if (!res.success) return res;
        const text = DawnBirth.sync(player, world) || '';
        return { success: true, settlement: res.settlement, text };
    },

    /**
     * Once the clan has settled (with the player or without), the family
     * lives in its village and the player's home is there. Daily; → the line
     * to tell the player the day it happens, else null.
     */
    sync(player, world) {
        if (!player || !player.dawnClan || !world || !world.dawn) return null;
        const home = world.dawn.kinHome;
        if (!home || home.clanId !== player.dawnClan) {
            // The clan is gone without a home (it shouldn't be): the player is on their own
            if (!Dawn.kinClan(world, player) && !home) player.dawnClan = null;
            return null;
        }
        for (const id of player.dawnKin || []) {
            const npc = Relationships.getNPC(id);
            if (!npc) continue;
            npc.settlementName = home.name;
            npc.settlementQ = home.q;
            npc.settlementR = home.r;
        }
        player.dawnClan = null;
        player.dawnHome = { q: home.q, r: home.r, name: home.name };
        if (typeof Relationships.prepareForSave === 'function') Relationships.prepareForSave(player);
        const L = DawnBirth.data().lines || {};
        const here = player.q === home.q && player.r === home.r;
        return _fill(here ? L.settled : L.settledAway, { name: home.name, kin: DawnBirth.kinLine(player) || 'your kin' });
    },
};
