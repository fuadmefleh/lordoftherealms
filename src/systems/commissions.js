// ============================================
// COMMISSIONS — hire a town's tradesmen to work your goods
// ============================================
//
// Bring grain to the mill and come back for flour; flour or grain to the
// baker for bread; iron and coal to the smithy for tools; hides to the
// tannery... every trade a town keeps (data/markets.json `recipes`, where the
// place is big enough for it) and every craft recipe its craftsmen will take
// on (data/crafting.json, by station: the inn's cook, the workshops, the
// smelter, the apothecary, the tanner).
//
// You pay for their time one of two ways:
//   - a fee: a share of what the product is worth here (more when you
//     haggle in a tongue you lack, systems/languages.js); the gold goes to
//     the town's coffers;
//   - a cut: the tradesman keeps a share of the product, which goes into
//     the town's market stock.
// The inputs are handed over at once. The job takes as many days as the
// trade's hands need; it is collected at the same town, and the player is
// told when it's ready (processDay).
//
// State: player.commissions = [{ id, kind, recipeId, label, town, q, r,
// runs, pay, fee, out: {good: n}, readyDay, collected }]. Content in
// data/commissions.json. No randomness; player and world passed in.
//
// Grades (core/grades.js): the work comes out in the town's grades — its
// craftsmanship for the product (world/marketGrades.js, + the trade's
// data/craftGrades.json hired.levelBonus, + the grade of the goods you
// brought) sets the shares of Poor, Fine, Excellent and Masterwork, rounded
// down, the rest Common (job.grades; handed over on collection, best first).

import { DataLoader } from '../core/dataLoader.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { PlayerInventory } from '../core/inventory.js';
import { Grades } from '../core/grades.js';
import { MarketGrades } from '../world/marketGrades.js';
import { Languages } from './languages.js';
import { Ledger } from './ledger.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = (world) => _num(world && world.day, 0);
const RANK = { village: 0, town: 1, city: 2, capital: 3 };

let _nextId = 1;

export const Commissions = {
    config() {
        const g = DataLoader._gamedata;
        return (g && _obj(g.commissions)) || { fee: { share: 0.2, min: 1 }, cut: { share: 0.25 }, tradeShare: 0.5, minPerDay: 4, maxRuns: 200, stations: {}, tradeNames: {}, tradeVerbs: {} };
    },

    _goodName(id) {
        const G = DataLoader._gamedata && DataLoader._gamedata.playerEconomy && DataLoader._gamedata.playerEconomy.GOODS;
        const g = G && G[String(id).toUpperCase()];
        return (g && g.name) || String(id).replace(/_/g, ' ');
    },

    _base(id) {
        const G = DataLoader._gamedata && DataLoader._gamedata.playerEconomy && DataLoader._gamedata.playerEconomy.GOODS;
        const g = G && G[String(id).toUpperCase()];
        return g && g.basePrice > 0 ? g.basePrice : 5;
    },

    /** What a unit of a good is worth in this town today */
    _worth(world, settlement, id) {
        const base = Commissions._base(id);
        if (settlement && settlement.market && SettlementMarket.tracks(id)) {
            const tile = world && typeof world.getTile === 'function' ? world.getTile(settlement.q, settlement.r) : null;
            const v = SettlementMarket.value(world, settlement, tile, id, base);
            if (v > 0) return v;
        }
        return base;
    },

    /**
     * Every process for hire in a settlement: [{ id, kind: 'trade'|'craft',
     * recipeId, label, who, in: {good: per run}, out: {good: per run},
     * perDay }].
     */
    offers(world, settlement) {
        if (!settlement) return [];
        const C = Commissions.config();
        const out = [];
        // The town's own trades
        const recipes = (DataLoader._gamedata && DataLoader._gamedata.markets && DataLoader._gamedata.markets.recipes) || [];
        for (const rc of recipes) {
            if (!SettlementMarket.hasTrade(settlement, rc.id)) continue;
            const inp = SettlementMarket.recipeGoods(rc.id, 'in');
            const outp = SettlementMarket.recipeGoods(rc.id, 'out');
            if (!Object.keys(inp).length || !Object.keys(outp).length) continue;
            const cap = SettlementMarket.tradeCapacity(settlement, rc.id);
            const verb = (C.tradeVerbs || {})[rc.id] || 'Work';
            const outName = Object.keys(outp).map(Commissions._goodName).join(', ');
            out.push({
                id: `trade:${rc.id}`, kind: 'trade', recipeId: rc.id,
                label: `${verb} ${outName.toLowerCase()}`, who: (C.tradeNames || {})[rc.id] || rc.id,
                in: inp, out: outp,
                perDay: Math.max(_num(C.minPerDay, 4), Math.floor(cap * _num(C.tradeShare, 0.5))),
            });
        }
        // The craftsmen's work (data/crafting.json), by station
        const craft = (DataLoader._gamedata && DataLoader._gamedata.crafting && DataLoader._gamedata.crafting.recipes) || [];
        const rank = RANK[settlement.type] != null ? RANK[settlement.type] : 0;
        for (const r of craft) {
            const st = _obj((C.stations || {})[r.station]);
            if (!st || rank < (RANK[st.minType] || 0)) continue;
            const s = rank >= 1 && st.town ? { ...st, ...st.town } : st;
            if (_num(r.difficulty, 1) > _num(s.maxDifficulty, 3)) continue;
            if (!_obj(r.ingredients) || !_obj(r.result)) continue;
            out.push({
                id: `craft:${r.id}`, kind: 'craft', recipeId: r.id,
                label: r.label || r.id, icon: r.icon || null, who: s.who || r.station,
                in: { ...r.ingredients }, out: { ...r.result },
                perDay: Math.max(1, _num(s.perDay, 4)),
            });
        }
        return out;
    },

    offer(world, settlement, offerId) {
        return Commissions.offers(world, settlement).find(o => o.id === offerId) || null;
    },

    /** How many runs the player's pack can feed (whole units of every input) */
    maxRuns(player, offer) {
        const inv = (player && player.inventory) || {};
        let n = Infinity;
        for (const [g, per] of Object.entries(offer.in)) n = Math.min(n, Math.floor(_num(inv[g]) / per));
        return Number.isFinite(n) ? Math.max(0, Math.min(n, _num(Commissions.config().maxRuns, 200))) : 0;
    },

    /**
     * What `runs` of an offer cost and give, paid by `pay` ('fee' | 'cut'):
     * { inputs, made, keep, give, fee, days }.
     */
    quote(player, world, settlement, offer, runs, pay = 'fee') {
        const C = Commissions.config();
        const n = Math.max(1, Math.floor(runs));
        const inputs = {};
        for (const [g, per] of Object.entries(offer.in)) inputs[g] = Math.ceil(per * n - 1e-9);
        const made = {};
        for (const [g, per] of Object.entries(offer.out)) made[g] = Math.floor(per * n + 1e-9);
        let worth = 0;
        for (const [g, q] of Object.entries(made)) worth += q * Commissions._worth(world, settlement, g);
        let fee = 0;
        const keep = {};
        const give = { ...made };
        if (pay === 'cut') {
            const share = _num((C.cut || {}).share, 0.25);
            for (const [g, q] of Object.entries(made)) {
                const k = Math.min(q, Math.max(q > 1 ? 1 : 0, Math.round(q * share)));
                keep[g] = k;
                give[g] = q - k;
            }
        } else {
            // a fee on what the work adds; dearer when you can't haggle in the tongue
            const tongue = player ? Languages.tradeModifier(player, settlement, world) : 0;
            fee = Math.max(_num((C.fee || {}).min, 1), Math.round(worth * _num((C.fee || {}).share, 0.2) * (1 - tongue)));
        }
        const days = Math.max(0, Math.ceil(n / Math.max(1, offer.perDay)) - 1);
        const grades = Commissions.gradesFor(player, settlement, inputs, give);
        return { runs: n, inputs, made, keep, give, fee, worth: Math.round(worth), days, grades };
    },

    /**
     * The grades the work comes out in: { good: { poor, fine, excellent,
     * masterwork } } of the units handed back (the rest Common).
     */
    gradesFor(player, settlement, inputs, give) {
        const out = {};
        if (!settlement) return out;
        // The goods you bring: better stuff makes better work
        let n = 0, sum = 0;
        for (const [g, k] of Object.entries(inputs || {})) {
            if (!Grades.gradeable(g) || !player) continue;
            const p = Grades.peek(player, g, k, { order: 'best' });
            n += p.n; sum += p.index * p.n;
        }
        const inputBonus = n > 0 ? (sum / n - Grades.COMMON) * 1.5 : 0;
        const bonus = _num(((Grades.data() || {}).hired || {}).levelBonus, 0.5) + inputBonus;
        for (const [g, q] of Object.entries(give || {})) {
            if (!(q > 0) || !Grades.gradeable(g)) continue;
            const mix = MarketGrades.mix(MarketGrades.level(settlement, g) + bonus);
            const e = {};
            let left = q;
            for (const id of ['masterwork', 'excellent', 'fine', 'poor']) {
                const k = Math.min(left, Math.floor(q * mix[id] + 1e-9));
                if (k > 0) { e[id] = k; left -= k; }
            }
            if (Object.keys(e).length) out[g] = e;
        }
        return out;
    },

    /**
     * Hand the goods over: the job starts. → { success, job, text } or
     * { success: false, reason }.
     */
    commission(player, world, offerId, runs, pay = 'fee') {
        const tile = world && world.getTile(player.q, player.r);
        const s = tile && tile.settlement;
        if (!s) return { success: false, reason: 'There is no one here to hire.' };
        const offer = Commissions.offer(world, s, offerId);
        if (!offer) return { success: false, reason: `No one in ${s.name} does that work.` };
        if (Math.floor(runs) < 1) return { success: false, reason: 'Nothing to do.' };
        const q = Commissions.quote(player, world, s, offer, runs, pay);
        const inv = player.inventory || (player.inventory = {});
        for (const [g, n] of Object.entries(q.inputs)) {
            if (_num(inv[g]) < n) return { success: false, reason: `You need ${n} ${Commissions._goodName(g).toLowerCase()}.` };
        }
        if (pay !== 'cut' && _num(player.gold) < q.fee) return { success: false, reason: `${offer.who[0].toUpperCase() + offer.who.slice(1)} ask${offer.who.endsWith('s') ? '' : 's'} ${q.fee} gold.` };
        if (Object.values(q.give).every(v => v <= 0)) return { success: false, reason: 'That is too little to be worth their while: bring more.' };
        // (the best of what you carry goes to the work — core/grades.js)
        for (const [g, n] of Object.entries(q.inputs)) Grades.remove(player, g, n, { order: 'best' });
        if (pay !== 'cut') {
            player.gold -= q.fee;
            Ledger.record(player, 'hiredWork', -q.fee);
            if (s.economy) s.economy.gold = _num(s.economy.gold) + q.fee;
        } else if (s.market) {
            for (const [g, n] of Object.entries(q.keep)) if (n > 0 && SettlementMarket.tracks(g)) SettlementMarket.add(s, g, n);
        }
        if (!Array.isArray(player.commissions)) player.commissions = [];
        const job = {
            id: `cm_${_day(world)}_${_nextId++}_${player.commissions.length}`,
            kind: offer.kind, recipeId: offer.recipeId, label: offer.label, who: offer.who,
            town: s.name, q: s.q, r: s.r, runs: q.runs, pay, fee: q.fee, kept: q.keep,
            out: q.give, grades: q.grades, readyDay: _day(world) + q.days, collected: false, told: false,
        };
        player.commissions.push(job);
        const outText = Object.entries(q.give).filter(([, n]) => n > 0).map(([g, n]) => `${n} ${Commissions._goodName(g).toLowerCase()}`).join(', ');
        const when = q.days <= 0 ? 'by the end of the day' : `in ${q.days + 1} days`;
        return { success: true, job, text: `${offer.who[0].toUpperCase() + offer.who.slice(1)} will have ${outText} for you ${when}${pay === 'cut' ? ' (keeping their cut)' : ` (${q.fee} gold)`}.` };
    },

    /** `n` units of `g` just handed over from a job: its graded units go first, best first. */
    _handGrades(player, job, g, n) {
        const e = _obj(job.grades) && _obj(job.grades[g]);
        if (!e || !(n > 0)) return;
        let left = n;
        for (const id of ['masterwork', 'excellent', 'fine', 'poor']) {
            const k = Math.min(left, _num(e[id]));
            if (k > 0) {
                Grades.add(player, g, k, id);
                e[id] -= k;
                left -= k;
                if (!(e[id] > 0)) delete e[id];
            }
        }
    },

    /** Jobs not yet collected */
    pending(player) {
        return (Array.isArray(player && player.commissions) ? player.commissions : []).filter(j => !j.collected);
    },

    isReady(job, world) {
        return !!job && _day(world) >= _num(job.readyDay);
    },

    /** Collect every ready job at the town the player is in → { success, got, left, text } */
    collect(player, world) {
        const tile = world && world.getTile(player.q, player.r);
        const s = tile && tile.settlement;
        if (!s) return { success: false, reason: 'Your work waits in the town you left it in.' };
        const here = Commissions.pending(player).filter(j => j.q === s.q && j.r === s.r);
        const ready = here.filter(j => Commissions.isReady(j, world));
        if (!ready.length) return { success: false, reason: here.length ? 'Nothing is ready yet.' : 'You have no work waiting here.' };
        const got = {};
        let full = false;
        for (const job of ready) {
            for (const [g, n] of Object.entries(job.out)) {
                if (n <= 0) continue;
                const added = PlayerInventory.addItems(player, { [g]: n });
                if (added && added.full) {
                    // Take what fits, one at a time; the rest stays with the tradesman
                    let taken = 0;
                    for (let i = 0; i < n; i++) {
                        const a = PlayerInventory.addItems(player, { [g]: 1 });
                        if (a && a.full) break;
                        taken++;
                    }
                    job.out[g] = n - taken;
                    if (taken) got[g] = _num(got[g]) + taken;
                    Commissions._handGrades(player, job, g, taken);
                    full = true;
                } else {
                    got[g] = _num(got[g]) + n;
                    job.out[g] = 0;
                    Commissions._handGrades(player, job, g, n);
                }
            }
            if (Object.values(job.out).every(v => v <= 0)) job.collected = true;
        }
        player.commissions = player.commissions.filter(j => !j.collected);
        const gotText = Object.entries(got).map(([g, n]) => `${n} ${Commissions._goodName(g).toLowerCase()}`).join(', ');
        return {
            success: Object.keys(got).length > 0, got, full,
            reason: full && !Object.keys(got).length ? PlayerInventory.fullMessage(player) : undefined,
            text: gotText ? `You collect ${gotText}.${full ? ' Your pack is full: the rest waits for you.' : ''}` : '',
        };
    },

    /** The day: jobs that are done are announced (once) → { notices } */
    processDay(player, world) {
        const out = { notices: [] };
        for (const j of Commissions.pending(player)) {
            if (j.told || !Commissions.isReady(j, world)) continue;
            j.told = true;
            const what = Object.entries(j.out).filter(([, n]) => n > 0).map(([g, n]) => `${n} ${Commissions._goodName(g).toLowerCase()}`).join(', ');
            out.notices.push({ icon: '🏭', title: 'Work Ready', text: `${j.who[0].toUpperCase() + j.who.slice(1)} in ${j.town} ${j.who.endsWith('s') ? 'have' : 'has'} finished: ${what} waiting for you.`, type: 'success' });
        }
        return out;
    },
};
