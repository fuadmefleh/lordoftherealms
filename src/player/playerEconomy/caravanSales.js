// PlayerEconomy — what a caravan sells where it lands, and what becomes of
// the rest (data/playerCaravans.json).
//
// A town pays for a caravan's goods out of its purse (world/economy.js), unit
// by unit at its stock's price curve (world/settlementMarket.js), and only the
// units it pays for change hands: they join its market stock, the coin (less
// the crown's duty) goes to the player. A town short of coin leaves the rest on
// the wagons: the caravan waits there up to waitDays, selling as the purse
// refills; then it goes on to the nearest town within onwardRange that can pay
// (if the player let it: caravan.findBuyer) or carries the rest back home (to
// the property's store, else the packs), robbed on the way like any caravan.
// The hire scales with the load's weight and the way, paid to the carters'
// home town as wages.
import { PlayerEconomy } from './_ref.js';
import { Trading } from './trading.js';
import { Underworld } from '../../systems/underworld.js';
import { TradePolicy } from '../../systems/tradePolicy.js';
import { Difficulty } from '../../core/difficulty.js';
import { DataLoader } from '../../core/dataLoader.js';
import { Ledger } from '../../systems/ledger.js';
import { PlayerCoin } from '../playerCoin.js';
import { Utils, Hex, WorldUnit, MarketDynamics, Quests, Technology, Infrastructure, WorldEvents, PlayerInventory, Economy, SettlementMarket } from './_imports.js';

const DEFAULTS = {
    waitDays: 5,
    onwardRange: 8,
    onwardMinShare: 0.25,
    maxRange: 20,
    fee: { base: 30, perHex: 3, perLoadHex: 3, loadLb: 500 },
};
let _cfg = null;
let _cfgSrc;

const _num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

Object.assign(PlayerEconomy, {
    /** The caravans' terms (data/playerCaravans.json config, over the defaults). */
    caravanConfig() {
        const gd = DataLoader._gamedata;
        const d = (gd && gd.playerCaravans && gd.playerCaravans.config) || null;
        if (!_cfg || d !== _cfgSrc) {
            _cfgSrc = d;
            const o = d && typeof d === 'object' ? d : {};
            _cfg = { ...DEFAULTS, ...o, fee: { ...DEFAULTS.fee, ...(o.fee || {}) } };
        }
        return _cfg;
    },

    /**
     * The hire of a caravan carrying `goods` `dist` hexes:
     * base + hexes × (perHex + perLoadHex × loads), loads = weight / loadLb.
     */
    caravanFee(goods, dist) {
        const F = PlayerEconomy.caravanConfig().fee;
        let lb = 0;
        for (const [g, q] of Object.entries(goods || {})) if (q > 0) lb += PlayerInventory.itemWeight(g) * q;
        const loads = lb / Math.max(1, _num(F.loadLb, 500));
        const hexes = Math.max(0, _num(dist));
        return Math.max(0, Math.ceil(_num(F.base) + hexes * (_num(F.perHex) + _num(F.perLoadHex) * loads)));
    },

    /** A good's definition by id (data/playerEconomy.json GOODS), or null. */
    _caravanGood(goodId) {
        const G = PlayerEconomy.GOODS || {};
        return G[String(goodId).toUpperCase()] || Object.values(G).find(g => g && g.id === goodId) || null;
    },

    /** A good's name for a message ("hemp fiber"). */
    goodLabel(goodId) {
        const g = PlayerEconomy._caravanGood(goodId);
        return (g && g.name ? g.name : String(goodId).replace(/_/g, ' ')).toLowerCase();
    },

    /** "7 hemp, 3 grain" */
    _caravanList(goods) {
        const parts = [];
        for (const [g, n] of Object.entries(goods || {})) if (n > 0) parts.push(`${Math.floor(n)} ${PlayerEconomy.goodLabel(g)}`);
        return parts.join(', ') || 'nothing';
    },

    /** "~370g" (a purse is guessed at, not counted). */
    purseLabel(purse) {
        if (purse == null) return 'deep purses';
        const p = Math.max(0, purse);
        const r = p >= 1000 ? Math.round(p / 50) * 50 : p >= 100 ? Math.round(p / 10) * 10 : Math.floor(p);
        return `~${Utils.formatGold(r)}g`;
    },

    /**
     * What the caravan's takings are multiplied by at `tile` over the market's
     * worth of the goods: the sale share, the haul's distance, the market's
     * size and draw, a road all the way, the route's standing (and a smuggler's
     * premium), commerce, difficulty, trade techs and the day's events there.
     */
    _caravanPremium(player, world, c, tile, routeRef = null) {
        const town = tile && tile.settlement;
        const from = c.fromPos || tile;
        const dist = Hex.wrappingDistance(from.q, from.r, tile.q, tile.r, world.width);
        let m = Trading.SELL_SHARE * PlayerEconomy.caravanDistanceMultiplier(dist) * PlayerEconomy.caravanSizeMultiplier(town && town.type);
        if (town) m *= _num(Economy.caravanProfitMultiplier(world, town), 1) || 1;
        if (c.roadLinked) m *= 1 + PlayerEconomy.ROAD_TRADE_BONUS;
        if (routeRef) {
            m *= (1 + (routeRef.prosperity || 0) * 0.04) * (1 + (routeRef.roadQuality || 0) * 0.06);
            if (c.isSmugglingRoute) m *= (1.35 + (routeRef.prosperity || 0) * 0.05) * Underworld.smugglingProfitMultiplier(world, tile);
        }
        m *= 1 + _num(player && player.skills && player.skills.commerce) * 0.05;
        m *= Difficulty.mult(player, 'sellPrice');
        m *= 1 + _num(Technology.getTradeProfitBonus(player));
        const ev = WorldEvents.getModifier(world, 'tradeIncome', tile) + WorldEvents.getModifier(world, 'landTradeIncome', tile);
        m *= Math.max(0, 1 + _num(ev));
        return m;
    },

    /** What the town at `tile` pays for each of `n` units of a good landing in its store, one by one (× `mult`). */
    _caravanUnitPrices(world, tile, goodId, n, mult) {
        const town = tile && tile.settlement;
        const good = PlayerEconomy._caravanGood(goodId);
        const out = new Array(Math.max(0, n));
        if (town && town.market && good && SettlementMarket.tracks(goodId)) {
            const now = SettlementMarket.value(world, town, tile, goodId, good.basePrice);
            const s0 = SettlementMarket.stock(town, goodId);
            for (let j = 0; j < n; j++) out[j] = now * SettlementMarket.levelFactor(town, goodId, s0 + j) * mult;
        } else {
            const p = MarketDynamics.getPrice(goodId, tile.q, tile.r, world) * mult;
            for (let j = 0; j < n; j++) out[j] = p;
        }
        return out;
    },

    /**
     * The sale the town at `tile` would make of caravan `c`'s load today,
     * good by good out of one purse: { purse, rows: [{ g, have, n, gross,
     * kept, check, full }], gross, payGross, kept, value, units, sold }.
     * `gross` is the whole load's worth there, `payGross` the part its purse
     * covers (duty inside), `kept` what the player would get of it, `value`
     * what the player would get for the whole load with a purse deep enough.
     */
    _caravanSalePlan(player, world, c, tile, routeRef = null, purseOverride = undefined) {
        const town = tile && tile.settlement;
        const purse0 = purseOverride !== undefined ? purseOverride : (town ? Economy.townPurse(town) : null);
        let left = purse0 == null ? Infinity : purse0;
        const mult = PlayerEconomy._caravanPremium(player, world, c, tile, routeRef);
        const plan = { purse: purse0, rows: [], gross: 0, payGross: 0, kept: 0, value: 0, units: 0, sold: 0 };
        for (const [g, held] of Object.entries(c.goods || {})) {
            const have = Math.floor(_num(held));
            if (have <= 0) continue;
            let check = null;
            if (!c.isSmugglingRoute && town) {
                check = TradePolicy.consignCheck(player, world, c.lots, have, town, g, have, 'double');
                if (!check.ok) { plan.rows.push({ g, have, n: 0, gross: 0, kept: 0, check, why: check.reason }); plan.units += have; continue; }
            }
            const keep = check ? check.mult : 1;
            const prices = PlayerEconomy._caravanUnitPrices(world, tile, g, have, mult);
            let full = 0;
            for (const p of prices) full += p;
            let n = 0, gross = 0;
            while (n < have && gross + prices[n] <= left + 1e-9) { gross += prices[n]; n++; }
            left -= gross;
            plan.rows.push({ g, have, n, gross, kept: gross * keep, check });
            plan.gross += full;
            plan.value += full * keep;
            plan.payGross += gross;
            plan.kept += gross * keep;
            plan.units += have;
            plan.sold += n;
        }
        return plan;
    },

    /**
     * Sell what the town at `tile` can pay for out of caravan `c`'s load:
     * the units paid for join its stock, the coin goes to the player (the
     * crown's duty to its treasury, both out of the town's purse), the rest
     * stays on the wagons. → { sold: {g: n}, gold, duty, purse }
     */
    _caravanSell(player, world, c, tile, routeRef = null) {
        const town = tile && tile.settlement;
        const plan = PlayerEconomy._caravanSalePlan(player, world, c, tile, routeRef);
        const res = { sold: {}, gold: 0, duty: 0, purse: plan.purse };
        for (const row of plan.rows) {
            if (!(row.n > 0)) continue;
            let kept = Math.floor(row.kept);
            let duty = 0;
            if (row.check && row.check.rate > 0 && kept > 0) duty = TradePolicy.payDuty(player, world, town, kept, row.check);
            if (row.check) {
                TradePolicy.breachHeat(player, world, row.n, row.check);
                TradePolicy.takeLots(c.lots, row.g, row.n, row.have);
            }
            if (town) {
                const paid = Economy.drawTown(town, kept + duty);
                kept = Math.max(0, Math.min(kept, Math.floor(paid - Math.min(duty, paid))));
                SettlementMarket.add(town, row.g, row.n);
            }
            c.goods[row.g] = _num(c.goods[row.g]) - row.n;
            if (!(c.goods[row.g] >= 1)) delete c.goods[row.g];
            res.sold[row.g] = row.n;
            res.gold += kept;
            res.duty += duty;
        }
        if (res.gold > 0) {
            player.gold += res.gold;
            Ledger.record(player, 'caravans', res.gold);
            Quests.track(player, 'trade_profit', res.gold);
        }
        if (!c.sold) c.sold = {};
        for (const [g, n] of Object.entries(res.sold)) c.sold[g] = (c.sold[g] || 0) + n;
        c.earned = _num(c.earned) + res.gold;
        c.dutyPaid = _num(c.dutyPaid) + res.duty;
        return res;
    },

    /**
     * The real picture of a caravan before it sets out: the destination's
     * purse, what the load fetches there capped by it, the hire and the net.
     * `goods` {g: qty}; `lots` its bookings by realm (optional, for duties).
     * → { ok, why?, dist, days, fee, purse, purseText, value, payable, net,
     *     units, sellable, warnings: [] }
     */
    caravanPreview(player, world, from, to, goods, lots = null) {
        const tile = world.getTile(to.q, to.r);
        if (!tile || !tile.settlement) return { ok: false, why: 'No market there', fee: 0, value: 0, payable: 0, net: 0, warnings: [] };
        const dist = Hex.wrappingDistance(from.q, from.r, to.q, to.r, world.width);
        const fee = PlayerEconomy.caravanFee(goods, dist);
        const c = {
            fromPos: { q: from.q, r: from.r }, goods: { ...goods }, lots: lots || {},
            roadLinked: Infrastructure.hasRoadConnection(world, from.q, from.r, to.q, to.r),
        };
        const plan = PlayerEconomy._caravanSalePlan(player, world, c, tile, null, PlayerEconomy._caravanPurseGuess(tile.settlement));
        const walk = Infrastructure.routeDays(world, from, to, null, 60);
        const days = walk != null ? Math.max(1, Math.ceil(walk / (1 + Technology.getEffectTotal(player, 'caravanSpeedBonus')) - 1e-9)) : Math.max(1, Math.ceil(dist / 2));
        const value = Math.floor(plan.value);
        const payable = Math.floor(plan.kept);
        const out = {
            ok: true, dist, days, fee, purse: plan.purse, purseText: PlayerEconomy.purseLabel(plan.purse),
            value, payable, net: payable - fee, units: plan.units, sellable: plan.sold, warnings: [],
        };
        const town = tile.settlement;
        if (plan.sold < plan.units) {
            out.warnings.push(plan.sold > 0
                ? `${town.name}'s merchants hold ${out.purseText}: enough for ${plan.sold} of ${plan.units}. The rest waits for coin, then goes on or comes back.`
                : `${town.name}'s merchants hold ${out.purseText}: not enough for even one. The load waits for coin, then goes on or comes back.`);
        }
        if (out.net < 0) out.warnings.push(`The hire (${Utils.formatGold(fee)}g) costs more than they can pay (${Utils.formatGold(payable)}g): a loss of ${Utils.formatGold(-out.net)}g.`);
        return out;
    },

    /**
     * A town's purse for a preview: what it holds, or for a town whose coffers
     * are not yet opened (the first day of a world) what they will open with
     * (Economy.initSettlement on a copy: nothing in the world is touched).
     */
    _caravanPurseGuess(town) {
        const have = Economy.townPurse(town);
        if (have != null || !town || !(Number(town.population) > 0) || typeof Economy.initSettlement !== 'function') return have;
        try {
            const probe = { type: town.type, population: town.population, dawnBorn: town.dawnBorn, freshPurse: town.freshPurse };
            Economy.initSettlement(probe);
            return probe.economy && Number.isFinite(probe.economy.gold) ? Math.max(0, probe.economy.gold) : null;
        } catch (e) {
            return null;
        }
    },

    /** Bookings of `qty` of the player's packed `goodId` (a copy, nothing taken), for a preview's duties. */
    caravanPreviewLots(player, goods) {
        const lots = {};
        const ledger = TradePolicy.playerState(player).ledger || {};
        for (const [g, qty] of Object.entries(goods || {})) {
            const held = _num(player.inventory && player.inventory[g]);
            const row = ledger[g];
            if (!row || !(held > 0)) continue;
            const f = Math.min(1, qty / held);
            lots[g] = {};
            for (const [k, v] of Object.entries(row)) if (v > 0) lots[g][k] = _num(v) * f;
        }
        return lots;
    },

    // ──────────── ARRIVALS ────────────

    /** The caravan's message lead: "Ashford → Thornfield". */
    _caravanHead(c) {
        return `${c.from} → ${c.to}`;
    },

    /** Push a caravan event for the day's notices (finalProfit: the coin paid today). */
    _caravanEvent(completed, c, status, message, gold = 0, duty = 0) {
        completed.push({ ...c, goods: { ...(c.goods || {}) }, finalProfit: Math.max(0, Math.floor(gold)), duty, status, message });
    },

    /** The net of a caravan's whole run: what it earned less its hire. */
    _caravanNetText(c) {
        if (!(c.fee > 0)) return '';
        const net = Math.floor(_num(c.earned) - c.fee);
        return ` Net ${net >= 0 ? '+' : '−'}${Utils.formatGold(Math.abs(net))}g after the ${Utils.formatGold(c.fee)}g hire.`;
    },

    /**
     * A commercial caravan has reached the market it is bound for: the
     * smugglers' reckoning on its first landfall, then the sale. → true when
     * it is done (all sold), false while it stays (waiting for coin).
     */
    _caravanArrive(player, world, c, completed) {
        const tile = world.getTile(c.toPos.q, c.toPos.r);
        const town = tile && tile.settlement;
        const routeRef = c.routeId ? PlayerEconomy._getRouteById(player, c.routeId, c.isSmugglingRoute) : null;
        if (!c.visited) c.visited = [];
        c.visited.push(`${c.toPos.q},${c.toPos.r}`);
        let caught = false;
        if (c.isSmugglingRoute && routeRef && !c.smuggleRolled) {
            c.smuggleRolled = true;
            caught = PlayerEconomy._caravanSmuggleCheck(player, world, c, tile, routeRef);
        }
        if (!tile) {
            c.goods = c.goods || {};
            return PlayerEconomy._caravanMoveOn(player, world, c, completed, routeRef);
        }
        const res = PlayerEconomy._caravanSell(player, world, c, tile, routeRef);
        if (!c.arrivedOnce) {
            c.arrivedOnce = true;
            player.skills.commerce = Math.min(10, player.skills.commerce + 0.2);
        }
        const soldText = PlayerEconomy._caravanList(res.sold);
        const name = (town && town.name) || c.to;
        if (!Object.keys(c.goods).length) {
            const msg = caught
                ? `${PlayerEconomy._caravanHead(c)}: the guards seized part of the shipment; ${soldText} sold for ${Utils.formatGold(res.gold)}g.`
                : `${PlayerEconomy._caravanHead(c)}: ${name} bought ${soldText} for ${Utils.formatGold(res.gold)}g${res.duty > 0 ? ` (${Utils.formatGold(res.duty)}g duty inside)` : ''}.${PlayerEconomy._caravanNetText(c)}`;
            PlayerEconomy._caravanEvent(completed, c, caught ? 'smuggling_caught' : 'completed', msg, res.gold, res.duty);
            PlayerEconomy._caravanDone(player, c, routeRef);
            return true;
        }
        const wait = Math.max(0, Math.floor(_num(PlayerEconomy.caravanConfig().waitDays, 5)));
        c.status = 'selling';
        c.waitLeft = wait;
        const purse = PlayerEconomy.purseLabel(res.purse).replace('~', '');
        const lead = Object.keys(res.sold).length
            ? `${name}'s merchants had only ${purse}: ${soldText} sold for ${Utils.formatGold(res.gold)}g, ${PlayerEconomy._caravanList(c.goods)} wait for coin`
            : `${name}'s merchants have no coin to spare (${purse}): ${PlayerEconomy._caravanList(c.goods)} wait for coin`;
        PlayerEconomy._caravanEvent(completed, c, caught ? 'smuggling_caught' : 'selling',
            `${caught ? 'Guards seized part of the shipment. ' : ''}${lead}${wait > 0 ? ` (up to ${wait} day${wait === 1 ? '' : 's'})` : ''}.`, res.gold, res.duty);
        if (wait <= 0) return PlayerEconomy._caravanMoveOn(player, world, c, completed, routeRef);
        return false;
    },

    /** A day waiting in a town short of coin: sell what its purse now covers. → true when done. */
    _caravanWaitDay(player, world, c, completed) {
        const tile = world.getTile(c.toPos.q, c.toPos.r);
        const routeRef = c.routeId ? PlayerEconomy._getRouteById(player, c.routeId, c.isSmugglingRoute) : null;
        const res = tile ? PlayerEconomy._caravanSell(player, world, c, tile, routeRef) : { sold: {}, gold: 0, duty: 0 };
        const name = (tile && tile.settlement && tile.settlement.name) || c.to;
        c.waitLeft = Math.max(0, _num(c.waitLeft) - 1);
        const soldAny = Object.keys(res.sold).length > 0;
        if (!Object.keys(c.goods).length) {
            PlayerEconomy._caravanEvent(completed, c, 'completed',
                `${PlayerEconomy._caravanHead(c)}: ${name} found the coin for the last ${PlayerEconomy._caravanList(res.sold)} (${Utils.formatGold(res.gold)}g). In all ${PlayerEconomy._caravanList(c.sold)} sold for ${Utils.formatGold(c.earned)}g.${PlayerEconomy._caravanNetText(c)}`,
                res.gold, res.duty);
            PlayerEconomy._caravanDone(player, c, routeRef);
            return true;
        }
        if (soldAny) {
            PlayerEconomy._caravanEvent(completed, c, 'selling',
                `${name}: ${PlayerEconomy._caravanList(res.sold)} more sold for ${Utils.formatGold(res.gold)}g; ${PlayerEconomy._caravanList(c.goods)} still wait${c.waitLeft > 0 ? ` (${c.waitLeft} day${c.waitLeft === 1 ? '' : 's'} left)` : ''}.`,
                res.gold, res.duty);
        }
        if (c.waitLeft > 0) return false;
        return PlayerEconomy._caravanMoveOn(player, world, c, completed, routeRef);
    },

    /**
     * The nearest town within onwardRange of `at` (not one the caravan has
     * tried) whose purse covers at least onwardMinShare of what the load is
     * worth there (or all of it). → { tile, dist, plan } or null.
     */
    _caravanBuyerNear(player, world, c, at, routeRef = null) {
        const K = PlayerEconomy.caravanConfig();
        const visited = new Set(c.visited || []);
        const all = typeof world.getAllSettlements === 'function' ? world.getAllSettlements() : [];
        let best = null;
        for (const s of all) {
            if (!s || visited.has(`${s.q},${s.r}`)) continue;
            const dist = Hex.wrappingDistance(at.q, at.r, s.q, s.r, world.width);
            if (dist <= 0 || dist > K.onwardRange) continue;
            if (best && dist > best.dist) continue;
            const tile = world.getTile(s.q, s.r);
            if (!tile || !tile.settlement) continue;
            const plan = PlayerEconomy._caravanSalePlan(player, world, c, tile, routeRef);
            if (!(plan.sold > 0)) continue;
            if (plan.sold < plan.units && plan.payGross < plan.gross * _num(K.onwardMinShare, 0.25)) continue;
            if (!best || dist < best.dist || plan.kept > best.plan.kept) best = { tile, dist, plan };
        }
        return best;
    },

    /** The wait is over with goods unsold: on to a town that can pay, or home. → false (still on the road). */
    _caravanMoveOn(player, world, c, completed, routeRef = null) {
        const at = { q: c.toPos.q, r: c.toPos.r };
        const name = c.to;
        const left = PlayerEconomy._caravanList(c.goods);
        const next = c.findBuyer !== false ? PlayerEconomy._caravanBuyerNear(player, world, c, at, routeRef) : null;
        if (next) {
            const s = next.tile.settlement;
            c.legs = (c.legs || 0) + 1;
            c.to = s.name;
            PlayerEconomy._caravanSetOff(player, world, c, at, { q: next.tile.q, r: next.tile.r }, 'traveling');
            PlayerEconomy._caravanEvent(completed, c, 'onward',
                `${name} could not pay for the rest: ${left} go on to ${s.name} (${next.dist} hex${next.dist === 1 ? '' : 'es'}), whose merchants hold ${PlayerEconomy.purseLabel(next.plan.purse)}.`);
            return false;
        }
        const home = c.homeName || c.from;
        c.legs = (c.legs || 0) + 1;
        c.to = home;
        PlayerEconomy._caravanSetOff(player, world, c, at, { q: c.fromPos.q, r: c.fromPos.r }, 'returning');
        PlayerEconomy._caravanEvent(completed, c, 'returning',
            `No buyer for ${left} at ${name}${c.findBuyer !== false ? ' or near it' : ''}: the caravan carries them back to ${home} (${c.daysRemaining} day${c.daysRemaining === 1 ? '' : 's'}).`);
        return false;
    },

    /** Send the caravan from `from` to `to` as a new leg: a wagon on the roads if it had one, else a timer. */
    _caravanSetOff(player, world, c, from, to, status) {
        c.status = status;
        c.toPos = { q: to.q, r: to.r };
        c.currentPos = { q: from.q, r: from.r };
        const speedUp = 1 + Technology.getEffectTotal(player, 'caravanSpeedBonus');
        const road = Infrastructure.hasRoadConnection(world, from.q, from.r, to.q, to.r);
        const dist = Hex.wrappingDistance(from.q, from.r, to.q, to.r, world.width);
        if (c.unitId) {
            const u = new WorldUnit('caravan', from.q, from.r, to.q, to.r);
            u.playerOwned = true;
            u.speed = (u.speed || 1) * speedUp + (road ? 1 : 0);
            if (road) u.roadLinked = true;
            u.isSmugglingRoute = !!c.isSmugglingRoute;
            u.goods = { ...c.goods };
            u.inventory = { ...c.goods };
            world.units.push(u);
            c.unitId = u.id;
            c.daysRemaining = Math.max(1, Math.ceil(dist / Math.max(1, u.speed)));
        } else {
            const walk = Infrastructure.routeDays(world, from, to, null, 60);
            c.daysRemaining = walk != null ? Math.max(1, Math.ceil(walk / speedUp - 1e-9)) : Math.max(1, Math.ceil(dist / (2 * speedUp)));
        }
    },

    /** Back home with what no one bought: into the property's store, else the packs. */
    _caravanHome(player, world, c, completed) {
        const tile = world.getTile(c.fromPos.q, c.fromPos.r);
        const routeRef = c.routeId ? PlayerEconomy._getRouteById(player, c.routeId, c.isSmugglingRoute) : null;
        const back = {};
        for (const [g, n] of Object.entries(c.goods || {})) if (n >= 1) back[g] = Math.floor(n);
        let stored = 0;
        if (c.homeProperty && tile) {
            const prop = PlayerEconomy.findPropertyAt(tile, c.homeProperty.type);
            if (prop) {
                for (const g of Object.keys(back)) {
                    if (prop.produces !== g) continue;
                    const room = Math.max(0, PlayerEconomy.getStorageCapacity(player, prop) - (prop.storage || 0));
                    const n = Math.min(room, back[g]);
                    if (n > 0) { prop.storage = (prop.storage || 0) + n; back[g] -= n; stored += n; }
                    if (back[g] <= 0) delete back[g];
                }
            }
        }
        let packed = '';
        if (Object.keys(back).length) {
            for (const g of Object.keys(back)) if (c.lots && c.lots[g]) TradePolicy.givePlayerLots(player, g, c.lots[g]);
            const r = PlayerInventory.addOrSell(player, back, PlayerCoin.payerHere(world, player, c.fromPos));
            const added = (r && r.added) || {};
            const soldHome = (r && r.sold) || {};
            packed = Object.keys(added).length ? ` ${PlayerEconomy._caravanList(added)} into your packs.` : '';
            if (Object.keys(soldHome).length) packed += ` No room for ${PlayerEconomy._caravanList(soldHome)}: sold at home for ${Utils.formatGold(Math.floor((r && r.gold) || 0))}g.`;
        }
        const soldAll = c.sold && Object.keys(c.sold).length ? `It sold ${PlayerEconomy._caravanList(c.sold)} for ${Utils.formatGold(c.earned || 0)}g.` : 'It sold nothing.';
        PlayerEconomy._caravanEvent(completed, c, 'returned',
            `The caravan is back at ${c.homeName || c.from} with ${PlayerEconomy._caravanList(c.goods)} unsold.${stored > 0 ? ` ${stored} back in the store.` : ''}${packed} ${soldAll}${PlayerEconomy._caravanNetText(c)}`);
        c.goods = {};
        c.status = 'completed';
        if (routeRef) PlayerEconomy._recordRouteSuccess(routeRef, Math.floor(c.earned || 0));
    },

    /** A caravan's run is over (all sold): the route's tally, the quests. */
    _caravanDone(player, c, routeRef) {
        c.status = 'completed';
        if (routeRef) PlayerEconomy._recordRouteSuccess(routeRef, Math.floor(c.earned || 0));
        Quests.trackCaravanCompleted(player);
    },

    /**
     * A smuggling run reaches its market: the guards may catch it. A share of
     * each good is seized (the watch sells it into the town's stock), the
     * player fined into the town's purse. Every run feeds heat. → caught?
     */
    _caravanSmuggleCheck(player, world, c, tile, routeRef) {
        const town = tile && tile.settlement;
        const dist = Hex.wrappingDistance(c.fromPos.q, c.fromPos.r, c.toPos.q, c.toPos.r, world.width);
        const stealth = player.skills?.stealth || 1;
        const chance = Math.max(0.06, Math.min(0.62,
            0.28 + dist * 0.01 - stealth * 0.02 - (routeRef.protection || 0) * 0.03 + Underworld.smugglingCatchBonus(world, tile)));
        let caught = false;
        if (Utils.random() < chance) {
            caught = true;
            const share = 0.35 + Utils.random() * 0.2;
            const mult = tile ? PlayerEconomy._caravanPremium(player, world, c, tile, routeRef) : 0;
            let value = 0;
            for (const [g, q] of Object.entries(c.goods)) {
                const n = Math.floor(_num(q) * share);
                if (n <= 0) continue;
                if (tile) value += n * (PlayerEconomy._caravanUnitPrices(world, tile, g, 1, mult)[0] || 0);
                c.goods[g] = _num(q) - n;
                if (!(c.goods[g] >= 1)) delete c.goods[g];
                if (town) SettlementMarket.add(town, g, n);
                if (!c.seized) c.seized = {};
                c.seized[g] = (c.seized[g] || 0) + n;
            }
            const fine = Math.min(player.gold, Math.floor(value * 0.4));
            PlayerCoin.pay(world, player, fine, town || null, 'fines');
            player.karma = (player.karma || 0) - 2;
            if (!player.criminalRecord) player.criminalRecord = { pickpocket: 0, smuggling: 0 };
            player.criminalRecord.smuggling = (player.criminalRecord.smuggling || 0) + 1;
            if (town && town.kingdom && player.reputation) {
                player.reputation[town.kingdom] = (player.reputation[town.kingdom] || 0) - 4;
            }
        }
        if (town && town.kingdom) Underworld.recordCrime(player, world, 'smuggling_route', { kingdom: town.kingdom, caught });
        return caught;
    },

    /** One line for a caravan's state, for the panels. */
    caravanStatusText(c) {
        const cargo = PlayerEconomy._caravanList(c.goods);
        const sold = c.sold && Object.keys(c.sold).length ? ` · sold ${PlayerEconomy._caravanList(c.sold)} for ${Utils.formatGold(Math.floor(c.earned || 0))}g` : '';
        if (c.status === 'selling') return `At ${c.to}: ${cargo} wait for coin (${c.waitLeft || 0} day${c.waitLeft === 1 ? '' : 's'} left)${sold}`;
        if (c.status === 'returning') return `Carrying ${cargo} back home${sold}`;
        const exp = c.expectedProfit != null ? ` — they can pay ~${Utils.formatGold(c.expectedProfit)}g` : '';
        return `Carrying ${cargo}${c.legs ? ' on to a buyer' : ''}${exp}${sold}`;
    },
});
