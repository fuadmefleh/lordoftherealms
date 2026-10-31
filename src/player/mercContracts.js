// ============================================
// MERCENARY CONTRACTS — selling the army's sword to a realm
// ============================================
// A contract (data/military.json contractTypes) is signed in a town for its
// kingdom. It faces an opposition — the bandits, the besieged garrison, the
// beast — whose strength is rolled at signing (data/mercenaryContracts.json).
// Each day of the countdown may bring one event, weighted per contract:
//   ambush     the enemy strikes first: losses fall with the force ratio,
//              and a strong company bloodies them back (opposition shrinks)
//   desertion  a soldier slips away — likelier when the company is outmatched
//              or its paymaster is nearly broke
//   loot       a strongbox, a baggage train: gold now (and sometimes goods
//              from the contract's loot table — contracts.<id>.items)
// At the end the army's strength against the opposition decides it: victory
// (pay, experience, reputation), a pyrrhic victory (heavy losses), or defeat
// (casualties, a small retainer, reputation lost). A won contract may bring
// spoils from its loot table; a naval contract (a pirate cove) counts the war
// galleys too (contracts.<id>.naval). Item rolls draw from their own seeded
// streams. A realm short of coin may
// renege on part of the fee. An army wiped out mid-contract abandons it.
//
// Employer reputation: player.mercRep[kingdomId] (−100..100) raises or cuts
// the fee, lowers the odds of reneging, and below `refuseBelow` the realm
// won't hire the player at all. Coin flows go to the Ledger as 'contracts'.
//
// Domain rules: player / world / settlement / strength are parameters; all
// randomness via Utils. The army's strength is passed in by the caller
// (PlayerMilitary.getArmyStrength) so this module needs nothing above it.

import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { Ledger } from '../systems/ledger.js';
import { Ships } from '../systems/ships.js';
import { PlayerInventory } from './inventory.js';

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/** A private seeded stream for one roll (world seed + a tag): never touches the shared RNG. */
function _stream(world, tag) {
    const seed = String((world && world.generationParams && world.generationParams.seed) || 'world');
    return Utils.seededRandom((_hash(`${seed}:merc:${world && world.day}:${tag}`) % 233279) + 1);
}

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const DEFAULTS = {
    dailyEventChance: 0.16, riskEventChance: 0.3, spread: [0.75, 1.3],
    repPay: 0.01, repPayMax: 0.3, refuseBelow: -30,
    rep: { victory: 4, pyrrhic: 1, defeat: -5, abandoned: -10 },
    kingdomRep: { victory: 2, defeat: -1 },
    retainer: 0.25,
    renege: { base: 0.05, poorTreasury: 0.12, perRep: 0.004, max: 0.35, share: 0.5 },
    ambush: { loss: 0.08, min: 0.02, max: 0.25, bloodied: 0.12 },
    desertion: { poorRatio: 1.2, unpaidGold: 50 },
    loot: { min: 0.05, max: 0.2 },
    victory: { base: 0.45, perRatio: 0.8, min: 0.05, max: 0.97, lossBase: 0.35, lossMax: 0.35 },
    defeat: { lossBase: 0.25, perInvRatio: 0.2, lossMax: 0.6 },
    contracts: {},
};

function _merge(base, over) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
        if (k.startsWith('_')) continue;
        out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) ? _merge(base[k], v) : v;
    }
    return out;
}

let _src;
let _cfg = null;

export const MercContracts = {
    config() {
        const gd = DataLoader._gamedata;
        const d = (gd && gd.mercenaryContracts) || null;
        if (!_cfg || d !== _src) {
            _src = d;
            _cfg = _merge(DEFAULTS, d || {});
        }
        return _cfg;
    },

    /**
     * Tuning of one contract type: { opposition, events, items, itemChance,
     * spoilsChance, naval }. `items` is the contract's loot table
     * ([{ id, qty: [lo, hi], weight }]: a pirate cove's stolen cargo, a
     * ruin's relics); `naval` is the share of the war galleys' strength that
     * counts (a cove is stormed from the sea).
     */
    rules(contract) {
        const C = MercContracts.config();
        const r = (contract && C.contracts[contract.id || contract.type]) || {};
        return {
            opposition: _num(r.opposition, Math.max(10, _num(contract && contract.minStrength, 20))),
            events: { ambush: 1, desertion: 0.5, loot: 0.6, ...(r.events || {}) },
            items: Array.isArray(r.items) ? r.items.filter(x => x && x.id) : [],
            itemChance: _num(r.itemChance, _num(C.itemChance, 0.5)),
            spoilsChance: _num(r.spoilsChance, _num(C.spoilsChance, 0.6)),
            naval: _clamp(_num(r.naval), 0, 1),
        };
    },

    /** Share of the galleys' strength a contract counts (0 for land work). */
    navalWeight(contract) {
        return MercContracts.rules(contract).naval;
    },

    /**
     * The force a contract sees: the land army, plus the galleys' share on a
     * naval contract. `land` and `naval` are strengths from the caller.
     */
    forceFor(contract, land, naval = 0) {
        return Math.round(_num(land) + _num(naval) * MercContracts.navalWeight(contract));
    },

    /**
     * Roll the contract's loot table: { id: qty } or null, from its own
     * seeded stream (world seed, day, contract), so a contract's spoils never
     * reshuffle anyone else's dice.
     */
    _rollItems(world, c, tag) {
        const r = MercContracts.rules(c);
        if (!r.items.length) return null;
        const rng = _stream(world, `${c.type}:${tag}:${c.opposition}`);
        const total = r.items.reduce((t, x) => t + Math.max(0, _num(x.weight, 1)), 0);
        if (!(total > 0)) return null;
        let roll = rng() * total;
        let pick = r.items[r.items.length - 1];
        for (const x of r.items) {
            roll -= Math.max(0, _num(x.weight, 1));
            if (roll <= 0) { pick = x; break; }
        }
        const [lo, hi] = Array.isArray(pick.qty) ? pick.qty : [1, 1];
        const qty = Math.max(1, Math.round(lo + (hi - lo) * rng()));
        return { [pick.id]: qty };
    },

    /** Put rolled loot in the packs (what doesn't fit is sold on the spot): a text fragment, or ''. */
    _takeItems(player, c, items) {
        if (!items) return '';
        const res = PlayerInventory.addOrSell(player, items);
        if (!c.items || typeof c.items !== 'object') c.items = {};
        for (const [id, q] of Object.entries(res.added)) c.items[id] = _num(c.items[id]) + q;
        if (res.gold > 0) {
            c.loot = _num(c.loot) + res.gold;
            Ledger.record(player, 'contracts', res.gold);
        }
        const parts = [];
        if (Object.keys(res.added).length) parts.push(PlayerInventory.describe(res.added));
        if (res.gold > 0) parts.push(`${PlayerInventory.describe(res.sold)} sold on the spot for ${res.gold} gold (no room in the packs)`);
        return parts.join('; ');
    },

    /** The player's standing as a sellsword with a realm (−100..100). */
    repWith(player, kingdomId) {
        return kingdomId && player && player.mercRep ? _num(player.mercRep[kingdomId]) : 0;
    },

    _addRep(player, kingdomId, delta) {
        if (!kingdomId || !delta) return 0;
        if (!player.mercRep || typeof player.mercRep !== 'object') player.mercRep = {};
        player.mercRep[kingdomId] = _clamp(_num(player.mercRep[kingdomId]) + delta, -100, 100);
        return delta;
    },

    /**
     * What a realm would offer for this contract: { payment, refused, reason,
     * rep, opposition (the expected strength) }.
     */
    quote(player, contract, settlement) {
        const C = MercContracts.config();
        const kid = settlement && settlement.kingdom ? settlement.kingdom : null;
        const rep = MercContracts.repWith(player, kid);
        const mult = 1 + _clamp(rep * _num(C.repPay), -_num(C.repPayMax), _num(C.repPayMax));
        const refused = kid != null && rep <= _num(C.refuseBelow);
        return {
            payment: Math.max(1, Math.round(_num(contract && contract.payment) * mult)),
            refused,
            reason: refused ? 'This realm remembers how your last contract went and will not hire you.' : null,
            rep, kingdomId: kid,
            opposition: MercContracts.rules(contract).opposition,
        };
    },

    /** Chance of victory at the end, by force ratio. */
    winChance(strength, opposition) {
        const V = MercContracts.config().victory;
        const ratio = opposition > 0 ? _num(strength) / opposition : 10;
        return _clamp(V.base + (ratio - 1) * V.perRatio, V.min, V.max);
    },

    /**
     * Sign a contract. `strength` is the army's strength now. Returns
     * { success, contract } or { success: false, reason }.
     */
    accept(player, contract, settlement, strength) {
        if (!contract) return { success: false, reason: 'Invalid contract' };
        if (_num(strength) < _num(contract.minStrength)) {
            return { success: false, reason: `Need army strength of ${contract.minStrength} (have ${strength})` };
        }
        if (player.activeContract) return { success: false, reason: 'Already on a contract' };
        const q = MercContracts.quote(player, contract, settlement);
        if (q.refused) return { success: false, reason: q.reason };
        const C = MercContracts.config();
        const spread = Array.isArray(C.spread) ? C.spread : [0.75, 1.3];
        const opposition = Math.max(1, Math.round(q.opposition * Utils.randFloat(spread[0], spread[1])));
        player.activeContract = {
            type: contract.id,
            name: contract.name,
            icon: contract.icon || '⚔️',
            payment: q.payment,
            daysRemaining: _num(contract.duration, 3),
            duration: _num(contract.duration, 3),
            risk: _num(contract.risk),
            settlement: settlement ? settlement.name : null,
            kingdomId: q.kingdomId,
            opposition,
            startStrength: Math.round(_num(strength)),
            losses: 0,
            loot: 0,
            log: [],
        };
        return { success: true, contract: player.activeContract };
    },

    /** Units that can fall on a land contract (ships stay in port). */
    _landUnits(player) {
        return (player.army || []).filter(u => u && !Ships.isNavalUnit(u));
    },

    /** Remove `n` random land units; returns how many fell. */
    _lose(player, n) {
        let lost = 0;
        for (let i = 0; i < n; i++) {
            const land = MercContracts._landUnits(player);
            if (!land.length) break;
            const u = Utils.randPick(land);
            const idx = player.army.indexOf(u);
            if (idx >= 0) { player.army.splice(idx, 1); lost++; }
        }
        return lost;
    },

    _loseShare(player, share) {
        const land = MercContracts._landUnits(player).length;
        if (!(share > 0) || !land) return 0;
        return MercContracts._lose(player, Math.min(land, Math.round(land * share)));
    },

    /** One day's possible event: { type, text, lost?, gold?, items? } or null. */
    _event(player, c, strength, world = null) {
        const C = MercContracts.config();
        const chance = _num(C.dailyEventChance) + _num(c.risk) * _num(C.riskEventChance);
        if (Utils.random() >= chance) return null;
        const r = MercContracts.rules(c);
        const ratio = c.opposition > 0 ? strength / c.opposition : 10;
        const broke = _num(player.gold) < _num(C.desertion.unpaidGold);
        const weights = [
            { value: 'ambush', weight: _num(r.events.ambush) },
            { value: 'desertion', weight: _num(r.events.desertion) * (ratio < _num(C.desertion.poorRatio) || broke ? 2 : 1) },
            { value: 'loot', weight: _num(r.events.loot) },
        ].filter(w => w.weight > 0);
        if (!weights.length) return null;
        const type = Utils.weightedPick(weights);
        if (type === 'ambush') {
            const A = C.ambush;
            const share = _clamp(_num(A.loss) / Math.max(0.2, ratio), A.min, A.max) * Utils.randFloat(0.6, 1.2);
            const lost = MercContracts._loseShare(player, share);
            c.losses += lost;
            let text = `Ambushed on the ${c.name.toLowerCase()}! ${lost ? `${lost} of your soldiers fell.` : 'Your lines held.'}`;
            if (ratio > 1) {
                c.opposition = Math.max(1, Math.round(c.opposition * (1 - _num(A.bloodied))));
                text += ' You bloodied them in return.';
            }
            return { type, text, lost };
        }
        if (type === 'desertion') {
            const lost = MercContracts._lose(player, 1);
            c.losses += lost;
            return lost ? { type, text: `A soldier deserted in the night${broke ? ' — the men doubt they will be paid' : ''}.`, lost } : null;
        }
        if (type === 'loot') {
            const L = C.loot;
            const gold = Math.max(1, Math.round(c.payment * Utils.randFloat(L.min, L.max)));
            player.gold = _num(player.gold) + gold;
            c.loot += gold;
            Ledger.record(player, 'contracts', gold);
            // ...and sometimes goods from the contract's loot table (own streams)
            const lucky = r.items.length > 0 && _stream(world, `${c.type}:lootItem`)() < r.itemChance;
            const items = lucky ? MercContracts._rollItems(world, c, 'loot') : null;
            const got = items ? MercContracts._takeItems(player, c, items) : '';
            return { type, text: `Your company seized a strongbox: +${gold} gold.${got ? ` Among the spoils: ${got}.` : ''}`, gold, items };
        }
        return null;
    },

    /**
     * Advance the active contract a day. `strengthOf(player)` gives the
     * army's strength now. Returns null (no contract), { completed: false,
     * daysRemaining, event } or the outcome { completed: true, contract,
     * outcome: 'victory'|'pyrrhic'|'defeat'|'abandoned', casualties, payment,
     * reneged, loot, message }.
     */
    tick(player, world, strengthOf) {
        const c = player && player.activeContract;
        if (!c) return null;
        if (!Number.isFinite(c.opposition)) {
            // A contract signed before opposition existed (old save)
            c.opposition = MercContracts.rules(c).opposition;
            c.losses = _num(c.losses);
            c.loot = _num(c.loot);
            c.log = Array.isArray(c.log) ? c.log : [];
        }
        const strengthNow = () => Math.max(0, _num(typeof strengthOf === 'function' ? strengthOf(player) : 0));
        c.daysRemaining--;
        let event = null;
        if (c.daysRemaining > 0) {
            event = MercContracts._event(player, c, strengthNow(), world);
            if (event) c.log.push({ day: world ? world.day : null, type: event.type, text: event.text });
            if (!MercContracts._landUnits(player).length) return MercContracts._finish(player, world, c, 'abandoned', 0, event);
            return { completed: false, daysRemaining: c.daysRemaining, event };
        }
        if (!MercContracts._landUnits(player).length) return MercContracts._finish(player, world, c, 'abandoned', 0, null);

        const C = MercContracts.config();
        const strength = strengthNow();
        const ratio = c.opposition > 0 ? strength / c.opposition : 10;
        const risk = Math.max(0.05, _num(c.risk));
        const won = Utils.random() < MercContracts.winChance(strength, c.opposition);
        let casualties;
        let outcome;
        if (won) {
            const V = C.victory;
            const share = _clamp(_num(V.lossBase) * risk / Math.max(0.2, ratio), 0, _num(V.lossMax)) * Utils.randFloat(0.5, 1.1);
            casualties = _num(c.risk) > 0 ? MercContracts._loseShare(player, share) : 0;
            outcome = share > 0.15 && casualties > 0 ? 'pyrrhic' : 'victory';
        } else {
            const D = C.defeat;
            const share = _clamp(_num(D.lossBase) + _num(D.perInvRatio) / Math.max(0.2, ratio), 0, _num(D.lossMax)) * Utils.randFloat(0.7, 1.1);
            casualties = MercContracts._loseShare(player, share);
            outcome = 'defeat';
        }
        return MercContracts._finish(player, world, c, outcome, casualties, null);
    },

    _finish(player, world, c, outcome, casualties, event) {
        const C = MercContracts.config();
        const kingdom = c.kingdomId && world && typeof world.getKingdom === 'function' ? world.getKingdom(c.kingdomId) : null;
        let payment = 0;
        let reneged = false;
        if (outcome === 'victory' || outcome === 'pyrrhic') {
            payment = c.payment;
            const R = C.renege;
            const poor = kingdom && Number.isFinite(kingdom.treasury) && kingdom.treasury < c.payment * 3;
            const p = _clamp(_num(R.base) + (poor ? _num(R.poorTreasury) : 0) - MercContracts.repWith(player, c.kingdomId) * _num(R.perRep), 0, _num(R.max));
            if (kingdom && Utils.random() < p) {
                reneged = true;
                payment = Math.round(payment * _num(R.share, 0.5));
            }
            for (const unit of player.army || []) {
                unit.experience = _num(unit.experience) + 10;
                if (unit.experience >= 100 && _num(unit.level, 1) < 5) {
                    unit.level = _num(unit.level, 1) + 1;
                    unit.experience = 0;
                    unit.strength = Math.floor(_num(unit.strength) * 1.2);
                }
            }
            if (player.skills) player.skills.combat = Math.min(10, _num(player.skills.combat, 1) + 0.3);
            if (player.skills) player.skills.leadership = Math.min(10, _num(player.skills.leadership, 1) + 0.1);
        } else if (outcome === 'defeat') {
            payment = Math.round(c.payment * _num(C.retainer));
            if (player.skills) player.skills.combat = Math.min(10, _num(player.skills.combat, 1) + 0.15);
        }
        if (payment > 0) {
            if (kingdom && Number.isFinite(kingdom.treasury)) kingdom.treasury = Math.max(0, kingdom.treasury - payment);
            player.gold = _num(player.gold) + payment;
            Ledger.record(player, 'contracts', payment);
        }
        const repDelta = _num(C.rep[outcome]);
        MercContracts._addRep(player, c.kingdomId, repDelta);
        const kRep = _num(C.kingdomRep[outcome === 'pyrrhic' ? 'victory' : outcome]);
        if (c.kingdomId && kRep) {
            if (!player.reputation) player.reputation = {};
            player.reputation[c.kingdomId] = _num(player.reputation[c.kingdomId]) + kRep;
        }
        const totalLost = _num(c.losses) + casualties;
        const words = {
            victory: `${c.name} fulfilled.`,
            pyrrhic: `${c.name} fulfilled — at a bitter price.`,
            defeat: `${c.name} failed: the enemy (${c.opposition} strong) drove you off.`,
            abandoned: `${c.name} abandoned — you have no soldiers left to fight it.`,
        };
        let message = words[outcome];
        // A won contract's spoils: the stolen cargo, the relics (the loot table, own streams)
        let spoils = '';
        if (outcome === 'victory' || outcome === 'pyrrhic') {
            const r = MercContracts.rules(c);
            if (r.items.length && _stream(world, `${c.type}:spoils?`)() < r.spoilsChance) {
                spoils = MercContracts._takeItems(player, c, MercContracts._rollItems(world, c, 'spoils'));
            }
        }
        if (totalLost) message += ` ${totalLost} soldier${totalLost === 1 ? '' : 's'} lost.`;
        if (payment) message += ` +${payment} gold${reneged ? ' (the crown paid only half, pleading empty coffers)' : outcome === 'defeat' ? ' retainer' : ''}.`;
        if (c.loot) message += ` (${c.loot} gold in plunder along the way.)`;
        if (spoils) message += ` Spoils taken: ${spoils}.`;
        // What happened on the march (the contract's log)
        const marched = (c.log || []).map(e => e && e.text).filter(Boolean);
        if (marched.length) message += ` On the march: ${marched.slice(-4).join(' ')}`;
        player.activeContract = null;
        return {
            completed: true, contract: c, outcome, casualties: totalLost, payment, reneged, loot: _num(c.loot),
            items: c.items || null, log: Array.isArray(c.log) ? c.log : [], spoils,
            success: outcome === 'victory' || outcome === 'pyrrhic', repDelta, event, message,
        };
    },
};
