// ============================================
// COASTAL RAIDS — soldiers put ashore from the ships' boats
// ============================================
// From aboard a ship beside the coast (or ashore beside a ship at anchor),
// the player can land troops on a town or village next to the water and
// fall on it before help comes. The boats are the limit: each ship lands
// Landings.config().raid.troopsPerShip soldiers a day (the strongest go
// first), and a ship's boats carry one raiding party a day. War galleys in
// the army stand in and bombard (the coastal theatre).
//
// A town caught unready by boats out of the sea turns out only a share of
// its garrison (raid.defenseShare); once a realm's coast is on alarm after a
// raid (systems/landings.js), the next one meets a readier defence and beach
// runs on that coast are caught more often.
//
//   plunder — the town's gold and the best of its market stores, carried to
//             the hold (a boat-load per ship).
//   burn    — torch the stores and granary: little gold, the realm's market
//             starved, and a deeper grudge.
//
// Consequences, as for an overland raid (PlayerMilitary.raidSettlement):
// karma, reputation, traits (cruelty/greed/dread), the realm lord's memory
// (NPCLords — feeds RealmWars.hostility), a House feud, and sea infamy
// (systems/pirates.js). The battle and plunder rolls run on their own seeded
// stream (world seed, day, town), so the shared RNG stream is untouched.

import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { PlayerInventory } from '../core/inventory.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { NPCLords } from '../world/npcLords.js';
import { Ships } from '../systems/ships.js';
import { Landings } from '../systems/landings.js';
import { Holdings } from '../systems/holdings.js';
import { Traits } from '../systems/traits.js';
import { House } from '../systems/house.js';
import { Quests } from '../systems/quests.js';
import { Pirates } from '../systems/pirates.js';
import { Ledger } from '../systems/ledger.js';
import { PlayerMilitary } from './playerMilitary.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _day = (world) => _num(world && world.day);
const _label = (id) => String(id).replace(/_/g, ' ');

function _seed(world) {
    const p = world && world.generationParams;
    return (p && p.seed) || 0;
}

export const CoastalRaids = {
    cfg() {
        return Landings.config().raid;
    },

    /** Ships whose boats can carry a party from where the player is: the one aboard, and any at anchor beside them. */
    boats(player) {
        if (!player) return [];
        const out = [];
        if (player.boardedShip) {
            const s = Ships.getShipById(player, player.boardedShip);
            if (s) out.push(s);
        } else {
            for (const s of Ships.getAnchoredShipsNear(player, player.q, player.r)) out.push(s);
        }
        return out;
    },

    /** Boats that have not yet landed a party today. */
    freeBoats(player, world) {
        const day = _day(world);
        return CoastalRaids.boats(player).filter(s => s.raidDay !== day);
    },

    /**
     * Towns and villages next to the water a party can reach: beside the
     * player's ship (aboard), or beside the player / the anchored ship
     * (ashore). Never one of the player's own holdings or their liege's
     * towns. → [{ q, r, tile, settlement, kingdom }]
     */
    targets(player, world) {
        if (!player || !world || typeof world.getTile !== 'function') return [];
        const origins = [];
        if (player.boardedShip) origins.push({ q: player.q, r: player.r });
        else {
            origins.push({ q: player.q, r: player.r });
            for (const s of CoastalRaids.boats(player)) origins.push({ q: s.q, r: s.r });
        }
        const seen = new Set();
        const out = [];
        for (const o of origins) {
            for (const h of [o, ...Hex.neighbors(o.q, o.r)]) {
                const q = world.width ? Hex.wrapQ(h.q, world.width) : h.q;
                const key = `${q},${h.r}`;
                if (seen.has(key)) continue;
                seen.add(key);
                const tile = world.getTile(q, h.r);
                const s = tile && tile.settlement;
                if (!s || !Ships.isPortTile(world, q, h.r)) continue;
                if (Holdings.isHolding(player, world, q, h.r)) continue;
                if (s.colony && s.colony.isPlayerColony) continue;
                if (player.allegiance != null && s.kingdom != null && String(s.kingdom) === String(player.allegiance)) continue;
                const kingdom = s.kingdom != null && typeof world.getKingdom === 'function' ? world.getKingdom(s.kingdom) : null;
                out.push({ q, r: h.r, tile, settlement: s, kingdom });
            }
        }
        return out;
    },

    /** The land soldiers the boats can put ashore today, strongest first. */
    landingParty(player, world) {
        const cap = CoastalRaids.freeBoats(player, world).length * _num(CoastalRaids.cfg().troopsPerShip, 8);
        const land = (player.army || []).filter(u => !PlayerMilitary.isNavalUnit(u));
        return land
            .slice()
            .sort((a, b) => _num(b.strength) * (1 + (_num(b.level, 1) - 1) * 0.2) - _num(a.strength) * (1 + (_num(a.level, 1) - 1) * 0.2))
            .slice(0, cap);
    },

    /** Run `fn` with the army cut down to the landing party (and the galleys, who bombard); survivors rejoin after. */
    _withParty(player, party, fn) {
        const all = player.army || [];
        const naval = all.filter(u => PlayerMilitary.isNavalUnit(u));
        const aboard = all.filter(u => !naval.includes(u) && !party.includes(u));
        player.army = [...party, ...naval];
        try {
            return fn();
        } finally {
            player.army = [...(player.army || []), ...aboard];
        }
    },

    /**
     * What a raid on the town at (q, r) would face:
     * { ok, reason?, target, troops, landed, strength, defense, alarmed, boats }.
     */
    quote(player, world, q, r) {
        const C = CoastalRaids.cfg();
        const target = CoastalRaids.targets(player, world).find(t => t.q === q && t.r === r);
        if (!target) return { ok: false, reason: 'No town your boats can reach there.' };
        const s = target.settlement;
        const boats = CoastalRaids.freeBoats(player, world);
        const out = { ok: true, target, boats: boats.length, troops: 0, strength: 0, defense: 0, alarmed: false };
        if (!CoastalRaids.boats(player).length) return { ...out, ok: false, reason: 'You need a ship beside the coast.' };
        if (!boats.length) return { ...out, ok: false, reason: 'Your boats have already landed a party today.' };
        const party = CoastalRaids.landingParty(player, world);
        out.troops = party.length;
        out.landed = (player.army || []).filter(u => !PlayerMilitary.isNavalUnit(u)).length;
        out.strength = CoastalRaids._withParty(player, party, () => PlayerMilitary.getTheatreStrength(player, 'coastal'));
        out.alarmed = !!(target.kingdom && Landings.alarmed(player, world, target.kingdom.id));
        const share = out.alarmed ? C.alarmShare : C.defenseShare;
        out.defense = Math.max(1, Math.floor(PlayerMilitary.getSettlementDefense(s, world) * share));
        const day = _day(world);
        if (s.lastRaidedDay != null && day - s.lastRaidedDay < PlayerMilitary.RAID_COOLDOWN_DAYS) {
            return { ...out, ok: false, reason: `${s.name} was raided lately — nothing left to take for ${PlayerMilitary.RAID_COOLDOWN_DAYS - (day - s.lastRaidedDay)} more day(s).` };
        }
        if (!party.length) return { ...out, ok: false, reason: 'You have no soldiers to put ashore.' };
        if (out.strength < C.minStrength) return { ...out, ok: false, reason: `The landing party is too weak (strength ${out.strength}, need ${C.minStrength}).` };
        return out;
    },

    _rng(world, s) {
        return Utils.seededRandom(((Utils.hashStr(`${_seed(world)}:searaid:${_day(world)}:${s.q},${s.r}:${s.name}`) >>> 0) % 233279) + 1);
    },

    /**
     * Land the party and fall on the town. `mode` 'plunder' (gold and stores
     * to the hold) or 'burn' (the stores and granary torched). Costs AP;
     * each ship's boats carry one party a day.
     * → { success, reason?, victory, casualties, plunder, goods, burned, ... }
     */
    raid(player, world, q, r, mode = 'plunder') {
        const C = CoastalRaids.cfg();
        const qt = CoastalRaids.quote(player, world, q, r);
        if (!qt.ok) return { success: false, reason: qt.reason };
        if (_num(player.actionPoints) < C.ap) return { success: false, reason: `A raid from the sea takes ${C.ap} action points.` };
        const burn = mode === 'burn';
        const { settlement: s, tile, kingdom } = qt.target;
        const day = _day(world);
        const boats = CoastalRaids.freeBoats(player, world);
        const party = CoastalRaids.landingParty(player, world);
        player.actionPoints -= C.ap;
        for (const b of boats) b.raidDay = day;

        const result = Utils.withRng(CoastalRaids._rng(world, s), () => {
            const res = CoastalRaids._withParty(player, party, () => PlayerMilitary.combat(player, qt.defense, s.name, {
                terrainId: tile && tile.terrain && tile.terrain.id,
                enemyComposition: PlayerMilitary._getSettlementComposition(s, tile),
                world,
                theatre: 'coastal',
                lootTown: s, // the defenders' coin is the town's
            }));
            res.success = true;
            res.mode = burn ? 'burn' : 'plunder';
            res.troops = party.length;
            res.defenseStrength = qt.defense;
            res.alarmed = qt.alarmed;
            if (res.loot) Ledger.record(player, 'plunder', res.loot);
            if (res.victory) CoastalRaids._sack(player, world, s, boats, burn, res);
            return res;
        });
        CoastalRaids._consequences(player, world, s, kingdom, burn, result);
        const st = Landings.ensure(player);
        st.stats.raids++;
        if (result.victory) {
            st.stats.raidsWon++;
            if (burn) st.stats.burned++;
        }
        Landings._log(player, world, result.victory
            ? `Your boats landed on ${s.name}${burn ? ' and put its stores to the torch' : ` and carried off ${result.plunder}g`}.`
            : `Your landing on ${s.name} was thrown back into the sea.`);
        return result;
    },

    /** A won raid: gold, and the stores carried to the hold or burned. */
    _sack(player, world, s, boats, burn, res) {
        const C = CoastalRaids.cfg();
        s.lastRaidedDay = _day(world);
        const [lo, hi] = C.plunderPerHead;
        const perHead = burn ? lo * 0.5 : Utils.randFloat(lo, hi);
        const gold = Math.floor(_num(s.population) * perHead);
        player.gold = _num(player.gold) + gold;
        if (gold > 0) Ledger.record(player, 'plunder', gold);
        res.plunder = gold;
        res.goods = {};
        if (burn) {
            SettlementMarket.loot(s, C.burnShare);
            if (s.economy) s.economy.food = Math.floor(_num(s.economy.food) * (1 - C.burnFood));
            res.burned = true;
        } else if (SettlementMarket.ensure(s)) {
            // The best of the market's stores, a boat-load (and the free hold) per ship
            const ranked = Object.keys(s.market.stock)
                .map(id => ({ id, n: SettlementMarket.available(s, id), v: PlayerInventory.goodValue(id) || 1 }))
                .filter(e => e.n > 0)
                .sort((a, b) => b.v - a.v || (a.id < b.id ? -1 : 1));
            for (const ship of boats) {
                // The boats ferry a boat-load each, whatever quay the town has (it is not yours to use)
                const used = ship.ferryDay === _day(world) ? _num(ship.ferryUnits) : 0;
                let room = Math.min(Ships.getCargoFree(ship), Math.max(0, Ships.LANDING_BOAT_CAPACITY - used));
                for (const e of ranked) {
                    if (room <= 0) break;
                    const take = Math.min(room, Math.floor(e.n));
                    if (take <= 0) continue;
                    const got = Math.floor(SettlementMarket.take(s, e.id, take));
                    if (got <= 0) continue;
                    e.n -= got;
                    room -= got;
                    if (!ship.cargo) ship.cargo = {};
                    ship.cargo[e.id] = _num(ship.cargo[e.id]) + got;
                    Ships._useFerry(ship, world, got);
                    res.goods[e.id] = _num(res.goods[e.id]) + got;
                }
            }
        }
        s.population = Math.max(10, Math.floor(_num(s.population) * (1 - (burn ? C.burnPopLoss : C.popLoss))));
        Quests.track(player, 'battles_won');
    },

    /** Karma, reputation, traits, the lord's memory, the House feud, infamy; the realm's coast raised on alarm. */
    _consequences(player, world, s, kingdom, burn, res) {
        const C = CoastalRaids.cfg();
        const kid = s.kingdom;
        if (!player.reputation) player.reputation = {};
        if (res.victory) {
            player.karma = _num(player.karma) - (burn ? C.burnKarma : C.karma);
            Traits.recordAggression(player, kid, burn ? { cruelty: 5, dread: 3 } : { cruelty: 2, greed: 3, dread: 2 });
            if (kid != null) player.reputation[kid] = _num(player.reputation[kid]) - (burn ? C.burnReputation : C.reputation);
            House.accrueRivalFeud(player, world, kid, burn ? C.burnFeud : C.feud, `${burn ? 'burned' : 'raided'} ${s.name} from the sea`);
            NPCLords.rememberRealm(world, kid, 'raid', { note: `${s.name}, from the sea`, weight: burn ? C.burnMemory : C.memory });
            Pirates.addInfamy(player, burn ? C.burnInfamy : C.infamy);
        } else {
            player.karma = _num(player.karma) - 2;
            if (kid != null) player.reputation[kid] = _num(player.reputation[kid]) - C.failReputation;
            NPCLords.rememberRealm(world, kid, 'raid_failed', { note: `${s.name}, from the sea` });
            House.accrueRivalFeud(player, world, kid, 5, `a landing on ${s.name}`);
        }
        // The realm's coast is on its guard now (a readier garrison, a sharper coast watch)
        if (kid != null) Landings.raiseAlarm(player, world, kid);
        res.alarmDays = C.alarmDays;
        res.kingdomName = kingdom ? kingdom.name : null;
    },

    /** Short description of the goods carried off, for notices. */
    describeGoods(goods) {
        const parts = Object.entries(goods || {}).filter(([, n]) => n > 0).map(([id, n]) => `${n} ${_label(id)}`);
        return parts.join(', ');
    },
};
