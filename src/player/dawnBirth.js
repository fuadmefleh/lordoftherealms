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

    // ── The kin's pot ──
    // A child of the clan is not left to starve at its own fire: with nothing
    // in the packs, at the clan's camp or in the home village, the family
    // shares its pot. They keep count, though: a meal on a day you went out
    // for them (foraged, hunted, worked) is your share and owes nothing — it
    // even pays a meal back; past `maxOwed` meals not paid back they turn you
    // away until you bring food home (handed over, a unit a meal, whenever
    // you come back with more than `keepFood`).

    /** Where the player's kin can feed them: 'clan' (at its camp), 'home' (the village), or null */
    kinHearth(player, world) {
        if (!player || !world || typeof world.getTile !== 'function') return null;
        const kin = (player.dawnKin || []).map(id => Relationships.getNPC(id)).filter(n => n && n.isAlive !== false);
        if (!kin.length) return null;
        const clan = Dawn.kinClan(world, player);
        if (clan && Hex.wrappingOffsetDistance(clan.q, clan.r, player.q, player.r, world.width) <= 1) return 'clan';
        const home = player.dawnHome;
        if (home && player.q === home.q && player.r === home.r) {
            const t = world.getTile(home.q, home.r);
            if (t && t.settlement) return 'home';
        }
        return null;
    },

    /** Has the player done a day's work (foraging, hunting, a job) since the kin last looked? */
    _workedForKin(player) {
        const work = _num(player.foragingTrips, 0) + _num(player.huntingTrips, 0) + _num(player.jobsCompleted, 0);
        const seen = player.kinWorkSeen;
        player.kinWorkSeen = work;
        return typeof seen === 'number' && work > seen;
    },

    _hearthCfg() {
        const H = DawnBirth.data().hearth || {};
        return { maxOwed: _num(H.maxOwed, 12), keepFood: _num(H.keepFood, 6) };
    },

    /**
     * A meal from the kin's pot when the packs are empty (player.endDay).
     * → { from, owed, text } when fed, { refused: true, owed, text } when
     * turned away, or null (no kin at hand).
     */
    kinMeal(player, world) {
        const from = DawnBirth.kinHearth(player, world);
        if (!from) return null;
        const C = DawnBirth._hearthCfg();
        const L = DawnBirth.data().lines || {};
        const owed = _num(player.kinOwed, 0);
        const kin = DawnBirth.kinLine(player) || 'your kin';
        // Out for the clan today: this meal is your share (and a meal owed is paid)
        if (DawnBirth._workedForKin(player)) {
            if (owed > 1) player.kinOwed = owed - 1;
            else delete player.kinOwed;
            return { from, owed: _num(player.kinOwed, 0), earned: true, text: _fill(L.fed, { kin }) };
        }
        if (owed >= C.maxOwed) return { refused: true, owed, text: _fill(L.refused, { owed }) };
        player.kinOwed = owed + 1;
        const text = player.kinOwed > C.maxOwed / 2 ? _fill(L.fedOwed, { owed: player.kinOwed, kin }) : _fill(L.fed, { kin });
        return { from, owed: player.kinOwed, text };
    },

    /**
     * Home with food to spare: what is owed goes into the pot, from the
     * packs' plainest food first. → { qty, text } or null.
     */
    repayKin(player, world) {
        if (!DawnBirth.kinHearth(player, world) || typeof player.getFoodCount !== 'function') return null;
        // A day's work for the clan pays a meal owed, as at the pot
        if (DawnBirth._workedForKin(player) && _num(player.kinOwed, 0) > 0) {
            player.kinOwed -= 1;
            if (player.kinOwed <= 0) delete player.kinOwed;
        }
        const owed = _num(player.kinOwed, 0);
        if (owed <= 0) return null;
        const C = DawnBirth._hearthCfg();
        let spare = Math.min(owed, player.getFoodCount() - C.keepFood);
        if (spare <= 0) return null;
        const order = ((player.constructor && player.constructor.FOOD_TYPES) || []).slice().reverse();
        let qty = 0;
        for (const id of order) {
            while (spare > 0 && player.inventory && player.inventory[id] > 0) {
                player.inventory[id]--;
                if (player.inventory[id] <= 0) delete player.inventory[id];
                spare--;
                qty++;
            }
        }
        if (!qty) return null;
        player.kinOwed = owed - qty;
        if (player.kinOwed <= 0) delete player.kinOwed;
        return { qty, text: _fill((DawnBirth.data().lines || {}).repaid, { qty }) };
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
