// ============================================
// BEGGING — alms from the passers-by, and what it costs a name
// ============================================
// Anyone in a town may sit at a street corner, the market or the temple
// steps with a bowl (the 'beg' action: half a day). The passers-by are the
// town's own people: so many go by, and each gives or not by the spot, a
// fair, how the town fares, how it likes the beggar, how the beggar looks
// and who they are, and how often they have begged here lately. A gift is a
// few coppers out of a townsperson's own purse (settlement.folk, where the
// town keeps a roster of its people; else the town's purse — Economy.drawTown),
// or now and then a loaf the giver buys at the market for the beggar (out of
// its store, the coin to the town). Nothing is made: every coin and loaf
// comes out of a purse or a store, in whole cents.
//
// The price is standing: a little with the realm for anyone, and for a noble
// — a lord, a landholder, a ruler, the head of a great House — a scandal
// (reputation, House Prestige, talk of it in the towns: Gossip 'begging_noble').
// Where the realm's punishment law is harsh (or standard) the watch may move
// a beggar on, and fine one who has begged here before.
//
// The townsfolk who fall on hard times beg too (systems/townJobs.js season).
// State: player.begging = { towns: { 'q,r': { n, day } }, stats } (saved).
// Randomness: Utils.random (the player's own action). Data: data/begging.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Economy } from '../world/economy.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Estates } from '../world/estates.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { Ledger } from '../systems/ledger.js';
import { Laws } from '../systems/laws.js';
import { Throne } from '../systems/throne.js';
import { Gossip } from '../systems/gossip.js';
import { Arms } from '../systems/arms.js';
import { House } from '../systems/house.js';
import { TownWorship } from '../systems/townWorship.js';
import { Trading } from './playerEconomy.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _r2 = (v) => Utils.cents(v);
const _day = (world) => _num(world && world.day);
const _key = (q, r) => `${q},${r}`;

const DEFAULTS = {
    enabled: true, ap: 3,
    passers: { perPop: 0.02, min: 6, max: 60 },
    give: 0.15, gift: { min: 0.1, max: 1.5 }, breadShare: 0.07,
    spots: { street: { label: 'a street corner', mult: 1 } },
    fair: 1.6, feast: 1.5, holyDay: 1.25, holyTemple: 1.2, prosperityRef: 2, prosperity: [0.25, 1.6],
    hostility: { below: 0, per: 0.008, floor: 0.3 },
    dress: { fine: 250, fineMult: 0.45, decent: 60, decentMult: 0.75, raggedBelow: 30, raggedMult: 1.15 },
    known: { renown: 60, mult: 0.8 },
    noble: { mult: 0.4, housePrestige: 150 },
    diminishing: { per: 0.35, halfLifeDays: 3 },
    reputation: 0.5,
    scandal: { reputationMult: 6, prestige: 6, rumour: 'begging_noble' },
    vagrancy: { harsh: 0.35, standard: 0.1, lenient: 0, fine: 1.5 },
    npc: { brokeBelow: 3, starveBelow: 1, recoverAbove: 10, findWork: 0.3, townPurseAbove: 200 },
    hunger: { foodDays: 2, everyDays: 3 },
};

let _src;
let _cfg = null;

export const Begging = {
    config() {
        const d = DataLoader._gamedata && DataLoader._gamedata.begging;
        if (!_cfg || d !== _src) {
            _src = d;
            _cfg = { ...DEFAULTS };
            for (const [k, v] of Object.entries(_obj(d) || {})) {
                if (k.startsWith('_')) continue;
                _cfg[k] = _obj(v) && _obj(DEFAULTS[k]) ? { ...DEFAULTS[k], ...v } : v;
            }
        }
        return _cfg;
    },

    enabled() { return Begging.config().enabled !== false; },

    state(player) {
        if (!player) return null;
        let st = _obj(player.begging);
        if (!st) st = player.begging = {};
        if (!_obj(st.towns)) st.towns = {};
        if (!_obj(st.stats)) st.stats = { times: 0, gold: 0, bread: 0, movedOn: 0, fined: 0, scandals: 0 };
        return st;
    },

    /** The spots a town offers: street always, the market in a town, the temple steps where there is a temple. */
    spots(settlement) {
        const S = Begging.config().spots || {};
        const out = [];
        for (const [id, sp] of Object.entries(S)) {
            if (!sp) continue;
            if (sp.needs === 'market' && !(settlement && settlement.type && settlement.type !== 'village')) continue;
            if (sp.needs === 'temple' && !Begging._hasTemple(settlement)) continue;
            out.push({ id, label: sp.label || id, mult: _num(sp.mult, 1) });
        }
        return out;
    },

    _hasTemple(s) {
        if (!s) return false;
        if (s.religiousBuilding || s.temple) return true;
        return s.type === 'city' || s.type === 'capital';
    },

    /** The best spot here (the one whose passers-by give most). */
    bestSpot(settlement) {
        return Begging.spots(settlement).sort((a, b) => b.mult - a.mult)[0] || { id: 'street', label: 'a street corner', mult: 1 };
    },

    /**
     * Is the player one of the great — a ruler, a titled officer, a
     * landholder, the head of a great House? (a noble seen begging is a scandal)
     */
    isNoble(player, world) {
        if (!player) return false;
        try { if (Throne.ruledKingdom(player, world)) return true; } catch (e) { /* no realms */ }
        if (player.kingdomTitle) return true;
        try { if (world && Estates.heldBy(world, 'player').length) return true; } catch (e) { /* no estates */ }
        const h = player.house;
        return !!(h && _num(h.prestige) >= _num(Begging.config().noble.housePrestige, 150));
    },

    /** What the worn arms and clothes are worth (the passers-by judge by it). */
    dressWorth(player) {
        const eq = _obj(player && player.equipment);
        if (!eq) return 0;
        let w = 0;
        for (const slot of ['head', 'body', 'legs', 'feet', 'hands']) {
            const it = eq[slot];
            const id = it && (it.id || it);
            if (typeof id === 'string') w += _num(Arms.basePrice(id));
        }
        return w;
    },

    /** How many begging days here still count (each halving every halfLifeDays). */
    recent(player, world, settlement) {
        const st = _obj(player && player.begging);
        const rec = st && _obj(st.towns) ? st.towns[_key(settlement.q, settlement.r)] : null;
        if (!rec) return 0;
        const half = Math.max(0.5, _num(Begging.config().diminishing.halfLifeDays, 3));
        return _num(rec.n) * Math.pow(0.5, Math.max(0, _day(world) - _num(rec.day)) / half);
    },

    /**
     * The odds here: { passers, chance, mult, parts } — each passer-by gives
     * with `chance` (the base × every factor), `parts` the factors by name.
     */
    odds(player, world, settlement, spotId = null) {
        const C = Begging.config();
        const spot = (spotId && Begging.spots(settlement).find(s => s.id === spotId)) || Begging.bestSpot(settlement);
        const pop = Math.max(0, _num(settlement && settlement.population));
        const P = C.passers;
        const passers = Math.round(_clamp(pop * _num(P.perPop, 0.02), _num(P.min, 6), _num(P.max, 60)));
        const parts = { spot: spot.mult };
        let fair = null;
        try { fair = SettlementMarket.fair(settlement); } catch (e) { fair = null; }
        if (fair) parts.fair = _num(C.fair, 1.6);
        // A holy day or a feast of the year: the faithful give (systems/townWorship.js)
        const day = _day(world);
        let feast = null;
        try { feast = TownWorship.feast(day); } catch (e) { feast = null; }
        if (feast) parts.feast = _num(C.feast, 1.5);
        else if (TownWorship.isHolyDay(day)) parts.holyDay = _num(C.holyDay, 1.25) * (spot.id === 'temple' ? _num(C.holyTemple, 1.2) : 1);
        const purse = Economy.townPurse(settlement);
        const perHead = purse != null && pop > 0 ? purse / pop : _num(C.prosperityRef, 4);
        const pr = Array.isArray(C.prosperity) ? C.prosperity : [0.25, 1.6];
        parts.prosperity = _clamp(perHead / Math.max(0.01, _num(C.prosperityRef, 4)), _num(pr[0], 0.25), _num(pr[1], 1.6));
        const kid = settlement && settlement.kingdom != null ? settlement.kingdom : null;
        const rep = kid != null && player && player.reputation ? _num(player.reputation[kid]) : 0;
        const H = C.hostility;
        if (rep < _num(H.below)) parts.hostility = Math.max(_num(H.floor, 0.3), 1 + (rep - _num(H.below)) * _num(H.per, 0.008));
        const D = C.dress;
        const worth = Begging.dressWorth(player);
        if (worth >= _num(D.fine, 250)) parts.dress = _num(D.fineMult, 0.45);
        else if (worth >= _num(D.decent, 60)) parts.dress = _num(D.decentMult, 0.75);
        else if (player && player.needsEnabled && _num(player.clothesFreshness, 100) < _num(D.raggedBelow, 30)) parts.dress = _num(D.raggedMult, 1.15);
        if (_num(player && player.renown) >= _num(C.known.renown, 60)) parts.known = _num(C.known.mult, 0.8);
        const noble = Begging.isNoble(player, world);
        if (noble) parts.noble = _num(C.noble.mult, 0.4);
        const n = Begging.recent(player, world, settlement);
        if (n > 0.01) parts.diminishing = 1 / (1 + n * _num(C.diminishing.per, 0.6));
        let mult = 1;
        for (const v of Object.values(parts)) mult *= v;
        return { spot, passers, chance: _clamp(_num(C.give, 0.14) * mult, 0, 0.95), mult, parts, noble };
    },

    /**
     * Before the hunger comes: in a town, with foodDays or fewer meals in the
     * packs and no meal on the stalls this purse can buy (config hunger), at
     * most every everyDays (player.begging.hungerWarned). No RNG.
     * → { title, text, cheapest: { id, name, price } | null } | null
     */
    hungerWarning(player, world) {
        const H = Begging.config().hunger || {};
        if (!player || !world || typeof world.getTile !== 'function' || typeof player.getFoodCount !== 'function') return null;
        if (player.jailState || player.indenturedServitude || player.boardedShip) return null;
        const food = player.getFoodCount();
        if (food > _num(H.foodDays, 2)) return null;
        const tile = world.getTile(player.q, player.r);
        const s = tile && tile.settlement;
        if (!s) return null;
        const day = _day(world);
        const was = _obj(player.begging) ? player.begging.hungerWarned : null;
        if (was != null && day - was < Math.max(1, _num(H.everyDays, 3))) return null;
        const edible = (player.constructor && player.constructor.FOOD_TYPES) || [];
        let goods = [];
        try { goods = Trading.getAvailableGoods(s, tile, world) || []; } catch (e) { goods = []; }
        const stalls = goods.filter(g => g && edible.includes(g.id) && g.quantity > 0 && Number.isFinite(g.price)).sort((a, b) => a.price - b.price);
        const cheapest = stalls[0] || null;
        const gold = _num(player.gold);
        if (cheapest && gold >= cheapest.price) return null;
        Begging.state(player).hungerWarned = day;
        const name = cheapest ? String(cheapest.name || cheapest.id).toLowerCase().replace(/_/g, ' ') : null;
        const left = food <= 0 ? 'Your packs are empty' : `Your packs hold ${food} meal${food === 1 ? '' : 's'}`;
        const why = cheapest
            ? `and the cheapest food on the stalls of ${s.name || 'this town'} (${name}) costs ${Utils.formatGold(cheapest.price)}g; you have ${Utils.formatGold(gold)}g.`
            : `and ${s.name || 'this town'} has no food on its stalls.`;
        const ways = cheapest
            ? "Beg for alms, take a day's work, sell something, or set out for a cheaper town before the hunger comes."
            : 'Find another town while you can still walk, or forage and hunt in the wild.';
        return { title: '🍞 Bread Out of Reach', text: `${left}, ${why} ${ways}`, cheapest: cheapest ? { id: cheapest.id, name, price: cheapest.price } : null };
    },

    /** Can the player beg here? → { ok, reason } */
    canBeg(player, world, settlement) {
        if (!Begging.enabled()) return { ok: false, reason: 'No one begs here.' };
        if (!settlement || !(_num(settlement.population) > 0)) return { ok: false, reason: 'There is no one here to beg from.' };
        if (player && (player.jailState || player.indenturedServitude)) return { ok: false, reason: 'Not while you are held.' };
        return { ok: true };
    },

    /**
     * Beg for alms for half a day (the caller charges the action's AP).
     * opts.spot: 'street' | 'market' | 'temple' (default the best here).
     * → { success, gold, bread, givers, movedOn, fined, scandal, text }
     */
    beg(player, world, settlement, opts = {}) {
        const can = Begging.canBeg(player, world, settlement);
        if (!can.ok) return { success: false, gold: 0, bread: 0, text: can.reason };
        const C = Begging.config();
        const st = Begging.state(player);
        const day = _day(world);
        const odds = Begging.odds(player, world, settlement, opts.spot || null);
        const out = { success: true, gold: 0, bread: 0, givers: 0, movedOn: false, fined: 0, scandal: false, spot: odds.spot.id, chance: odds.chance };
        const kid = settlement.kingdom != null ? settlement.kingdom : null;
        const key = _key(settlement.q, settlement.r);
        // The watch, where the law is hard on vagrants: moved on before the bowl fills
        const law = kid != null ? Laws.option(world, kid, 'punishment') : null;
        const lawId = law && law.id ? law.id : (kid != null ? Laws.value(world, kid, 'punishment') : null);
        const V = C.vagrancy;
        const watch = _num(V[lawId], 0);
        const half = watch > 0 && Utils.random() < watch;
        // The passers-by
        const folk = _obj(settlement.folk);
        const givers = folk && Array.isArray(folk.people)
            ? folk.people.filter(p => Townsfolk.isHere(p) && typeof p.purse === 'number' && p.purse >= 0.5 && Townsfolk.age(p, day) >= 14)
            : null;
        const inKind = !!settlement.inKind || Economy.townPurse(settlement) == null;
        const passers = half ? Math.ceil(odds.passers / 2) : odds.passers;
        const G = C.gift;
        const breadPrice = (() => { try { return Math.max(0.01, _num(Estates.priceAt(settlement, 'bread'), 1)); } catch (e) { return 1; } })();
        for (let i = 0; i < passers; i++) {
            if (Utils.random() >= odds.chance) continue;
            const who = givers && givers.length ? givers[Math.floor(Utils.random() * givers.length)] : null;
            // A loaf, now and then (or always, where nobody keeps coin)
            const loaf = (inKind || Utils.random() < _num(C.breadShare, 0.18)) && SettlementMarket.available(settlement, 'bread') >= 1;
            if (loaf) {
                const cost = _r2(breadPrice);
                // (the giver buys it: their coin to the town's purse; the loaf out of the store)
                if (!inKind) {
                    if (who) {
                        if (who.purse < cost) continue;
                        who.purse = _r2(who.purse - cost);
                        Economy.payTown(settlement, cost);
                    }
                    // (with no roster, the town's own people give it: the store's loaf, paid by the town itself)
                }
                if (SettlementMarket.take(settlement, 'bread', 1) >= 1) {
                    player.inventory = player.inventory || {};
                    player.inventory.bread = _num(player.inventory.bread) + 1;
                    out.bread++;
                    out.givers++;
                }
                continue;
            }
            if (inKind) continue;
            const want = _r2(_num(G.min, 0.02) + Utils.random() * Math.max(0, _num(G.max, 0.35) - _num(G.min, 0.02)));
            let got = 0;
            if (who) {
                got = Math.min(want, Utils.centsDown(who.purse));
                who.purse = _r2(who.purse - got);
            } else {
                got = Economy.drawTown(settlement, want);
            }
            got = _r2(got);
            if (!(got > 0)) continue;
            out.gold = _r2(out.gold + got);
            out.givers++;
        }
        if (out.gold > 0) {
            player.gold = _r2(_num(player.gold) + out.gold);
            Ledger.record(player, 'alms', out.gold);
        }
        // Moved on by the watch; fined if they've seen this beggar here before
        if (half) {
            out.movedOn = true;
            st.stats.movedOn = _num(st.stats.movedOn) + 1;
            if (Begging.recent(player, world, settlement) >= 1) {
                const fine = _r2(Math.min(_num(player.gold), _num(V.fine, 1.5) * Laws.punishment(world, kid).fine));
                if (fine > 0) {
                    player.gold = _r2(_num(player.gold) - fine);
                    Economy.payTown(settlement, fine);
                    Ledger.record(player, 'fines', -fine);
                    out.fined = fine;
                    st.stats.fined = _num(st.stats.fined) + 1;
                }
            }
        }
        // The cost to the name
        if (kid != null) {
            player.reputation = player.reputation || {};
            const R = _num(C.reputation, 0.5) * (odds.noble ? _num(C.scandal.reputationMult, 6) : 1);
            player.reputation[kid] = Math.round((_num(player.reputation[kid]) - R) * 100) / 100;
        }
        if (odds.noble) {
            out.scandal = true;
            st.stats.scandals = _num(st.stats.scandals) + 1;
            const h = player.house;
            const loss = Math.min(_num(h && h.prestige), _num(C.scandal.prestige, 6));
            if (h && loss > 0) {
                h.prestige = _num(h.prestige) - loss;
                House._logPrestige(h, day, -loss, 'seen begging in the street');
            }
            try {
                Gossip.spreadDeed(player, world, C.scandal.rumour || 'begging_noble', { q: settlement.q, r: settlement.r, location: settlement.name, kingdom: kid });
            } catch (e) { /* no gossip */ }
        }
        // This town remembers the face
        const n = Begging.recent(player, world, settlement);
        st.towns[key] = { n: Math.round((n + 1) * 100) / 100, day };
        // (old towns forgotten: a long life begs in many places)
        const keys = Object.keys(st.towns);
        if (keys.length > 40) {
            keys.sort((a, b) => _num(st.towns[a].day) - _num(st.towns[b].day));
            for (const k of keys.slice(0, keys.length - 40)) delete st.towns[k];
        }
        st.stats.times = _num(st.stats.times) + 1;
        st.stats.gold = _r2(_num(st.stats.gold) + out.gold);
        st.stats.bread = _num(st.stats.bread) + out.bread;
        st.lastDay = day;
        out.text = Begging._text(settlement, odds, out);
        return out;
    },

    _text(settlement, odds, out) {
        const where = `${odds.spot.label} in ${settlement.name}`;
        const got = [];
        if (out.gold > 0) got.push(`${Utils.formatGold(out.gold)}g`);
        if (out.bread > 0) got.push(out.bread === 1 ? 'a loaf of bread' : `${out.bread} loaves`);
        let t = got.length
            ? `You beg at ${where}. ${out.givers === 1 ? 'One passer-by' : `${out.givers} passers-by`} spare you ${got.join(' and ')}.`
            : `You beg at ${where} for half a day. No one spares you anything.`;
        if (out.movedOn) t += ' The watch moves you on before the bowl fills.';
        if (out.fined > 0) t += ` They know your face: fined ${Utils.formatGold(out.fined)}g for vagrancy.`;
        if (out.scandal) t += ' Heads turn: one of your blood, begging in the street. The talk will follow you.';
        else if (odds.parts.diminishing && odds.parts.diminishing < 0.7) t += ' The townsfolk have seen you here before, and give the less.';
        return t;
    },
};
