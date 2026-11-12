// ============================================
// FOUNDING — the player sends settlers out to found a village of their own
// ============================================
//
// The planning and paying side of a founding expedition (the land, the walk,
// the village and its years are world/villageFounding.js):
//
//   source(player, world, q, r)      — can settlers leave this town, how many, on what terms
//   plan(player, world, src, site, n) — survey, route, days, supplies (packs / market), fee, purses
//   dispatch(player, world, src, site, n, opts) — people, goods and coin really move; the party sets out
//
// Real economy: the settlers are the town's people (its population drops);
// their grain, tools and timber come out of the player's packs or are bought
// off the town's market (its stock drops, its purse takes the coin); the fee
// hires guides and carters there (the town's purse); a settler from a town
// not the player's own is paid a purse that goes with them and becomes the
// new village's coin. Nothing is made from nothing. Data: data/colonization.json
// `founding`. No randomness here but the WorldUnit's own (Utils).

import { Hex } from '../core/hex.js';
import { Economy } from '../world/economy.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Colonization } from '../world/colonization.js';
import { VillageFounding } from '../world/villageFounding.js';
import { Holdings } from './holdings.js';
import { MarketDynamics } from './marketDynamics.js';
import { Ledger } from './ledger.js';
import { Barter } from '../world/barter.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const SUPPLY_ORDER = ['grain', 'tools', 'wood'];

export const Founding = {
    cfg() {
        return VillageFounding.cfg();
    },

    /** Does the player hold this town (a holding, or a town of the realm they rule)? */
    holds(player, world, q, r) {
        const t = world.getTile(q, r);
        if (!t || !t.settlement) return false;
        if (Holdings.isHolding(player, world, t.q, t.r)) return true;
        const ruled = VillageFounding.ruledRealm(world);
        return !!(ruled && t.settlement.kingdom === ruled.id);
    },

    /**
     * Can settlers leave the town at (q, r)? → { ok, reason, held, name, q, r,
     * population, max, purse (per settler), terms (a line for the panel) }
     */
    source(player, world, q, r) {
        const C = Founding.cfg();
        const t = world.getTile(q, r);
        const s = t && t.settlement;
        if (!s) return { ok: false, reason: 'There is no town here.' };
        const held = Founding.holds(player, world, t.q, t.r);
        const minLeft = _num(C.minLeft, 60);
        const pop = Math.max(0, Math.floor(_num(s.population)));
        const out = { ok: false, held, name: s.name, q: t.q, r: t.r, population: pop, max: 0, purse: 0, reason: null };
        const share = held ? _num(C.holdingShare, 0.15) : _num(C.otherShare, 0.05);
        out.max = Math.max(0, Math.min(_num(C.maxSettlers, 60), Math.floor(pop * share), pop - minLeft));
        if (!held) {
            out.purse = _num(C.settlerPurse, 8);
            if (player.q !== t.q || player.r !== t.r) return { ...out, reason: `Go to ${s.name} to ask its people yourself.` };
            if (s.kingdom) {
                const rep = _num(player.reputation && player.reputation[s.kingdom], 0);
                const k = world.getKingdom(s.kingdom);
                if (rep < _num(C.minReputation, -10)) return { ...out, reason: `${s.name} will not let its people go with you: your name in ${k ? k.name : 'this realm'} is too poor.` };
                const mine = [VillageFounding.ruledRealm(world), player.allegiance ? world.getKingdom(player.allegiance) : null].filter(Boolean);
                if (mine.some(m => (m.wars || []).includes(s.kingdom))) return { ...out, reason: `${s.name}'s realm is at war with yours.` };
            }
            const sieges = player.sieges && player.sieges.active;
            if (sieges && sieges.q === t.q && sieges.r === t.r) return { ...out, reason: 'You are besieging it.' };
        }
        if (out.max < _num(C.minSettlers, 10)) {
            return { ...out, reason: `${s.name} has too few people to spare a party (${pop}; it keeps ${minLeft}${held ? '' : ', and lets few go to a stranger'}).` };
        }
        out.ok = true;
        out.terms = held
            ? `Your own people: up to ${out.max} may go.`
            : `They will go for a purse of ${out.purse}g a head, which they take with them to the new village. Up to ${out.max}.`;
        return out;
    },

    /** The towns settlers could come from: the player's holdings and realm towns, and the town they stand in. */
    sources(player, world) {
        const seen = new Set();
        const out = [];
        const add = (q, r) => {
            const k = `${q},${r}`;
            if (seen.has(k)) return;
            seen.add(k);
            const src = Founding.source(player, world, q, r);
            if (src.name) out.push(src);
        };
        const here = world.getTile(player.q, player.r);
        if (here && here.settlement) add(here.q, here.r);
        for (const h of Holdings.list(player, world)) add(h.q, h.r);
        const ruled = VillageFounding.ruledRealm(world);
        if (ruled) for (const v of VillageFounding._views(world)) if (v.kingdom === ruled.id) add(v.q, v.r);
        return out;
    },

    /** What one settler needs: { grain, tools, wood } per head (data). */
    perHead() {
        return { grain: 3, tools: 0.25, wood: 1, ...(Founding.cfg().supplies || {}) };
    },

    /**
     * The whole bill of a party of `n` from `src` ({q, r}) to `site` ({q, r}).
     * → { ok, reasons[], warnings[], survey, route, days, people, supplies: [{ id, need, packs, market, short, unit, cost }],
     *     goodsCost, fee, purses, total, canPay, source }
     */
    plan(player, world, src, site, n) {
        const C = Founding.cfg();
        const source = Founding.source(player, world, src.q, src.r);
        const reasons = [];
        if (!source.ok) reasons.push(source.reason || 'No one can leave from here.');
        const people = Math.max(0, Math.floor(_num(n)));
        if (source.ok && people > source.max) reasons.push(`At most ${source.max} can leave ${source.name}.`);
        if (people < _num(C.minSettlers, 10)) reasons.push(`A village needs at least ${_num(C.minSettlers, 10)} settlers.`);
        const survey = VillageFounding.survey(world, site.q, site.r, { player, from: src });
        if (!survey.ok) reasons.push(...survey.reasons);
        const route = survey.ok ? VillageFounding.route(world, src, survey) : null;
        if (survey.ok && !route) reasons.push('There is no way overland from the town.');
        const speed = 2;
        const days = route ? Math.max(1, Math.ceil((route.length - 1) / speed)) : 0;

        // Supplies: the packs first, then the town's market at its price
        const tile = world.getTile(src.q, src.r);
        const town = tile && tile.settlement;
        if (town) { Economy.initSettlement(town); SettlementMarket.ensure(town); }
        const per = Founding.perHead();
        const supplies = [];
        let goodsCost = 0;
        for (const id of SUPPLY_ORDER) {
            const need = Math.ceil(people * _num(per[id]));
            if (need <= 0) continue;
            const packs = Math.min(need, Math.floor(_num(player.inventory && player.inventory[id])));
            const inStock = town ? SettlementMarket.available(town, id) : 0;
            const market = Math.min(need - packs, inStock);
            // Grain the market hasn't got is bought out of the town's granary, at the same price
            const granary = id === 'grain' && town ? Math.min(need - packs - market, Math.floor(Math.max(0, _num(town.economy.food)))) : 0;
            const unit = town ? MarketDynamics.getPrice(id, src.q, src.r, world) : 0;
            const cost = (market + granary) * unit;
            goodsCost += cost;
            supplies.push({ id, need, packs, market, granary, short: need - packs - market - granary, unit, cost });
        }
        const grain = supplies.find(x => x.id === 'grain');
        if (grain && grain.short > 0) reasons.push(`Short of grain: ${grain.short} more than your packs and ${source.name || 'the town'}'s market and granary hold.`);
        const warnings = [...(survey.warnings || [])];
        for (const x of supplies) if (x.id !== 'grain' && x.short > 0) warnings.push(`Only ${x.need - x.short} of ${x.need} ${x.id} to be had: the village starts short.`);

        const F = C.fee || {};
        const fee = Math.round(_num(F.base, 40) + _num(F.perHex, 4) * Math.max(0, days * speed));
        const purses = source.held ? 0 : people * _num(source.purse);
        const total = Math.round(goodsCost + fee + purses);
        // A town that barters is paid in kind: the goods in the player's packs
        // (less what goes with the settlers as supplies) by their worth (world/barter.js)
        const inKind = !!(town && Barter.active(world, town) && Barter.installed(player));
        const means = inKind
            ? Barter.purse(player) - supplies.reduce((a, x) => a + x.packs * Barter.unitValue(x.id), 0)
            : _num(player.gold);
        const canPay = means >= total;
        if (!canPay) reasons.push(inKind
            ? `It costs goods worth ${total}; what you carry beyond the supplies is worth ${Math.max(0, Math.floor(means))}.`
            : `It costs ${total}g; you have ${Math.floor(_num(player.gold))}g.`);
        return { ok: reasons.length === 0, reasons, warnings, survey, route, days, people, supplies, goodsCost: Math.round(goodsCost), fee, purses, total, canPay, inKind, source };
    },

    /**
     * Send the party out. opts: { name, policy }. → { success, reason?, unit, plan }
     * The town loses the people; the packs and the market lose the goods;
     * the town's purse takes the market's price and the fee; the purses
     * travel with the settlers.
     */
    dispatch(player, world, src, site, n, opts = {}) {
        const plan = Founding.plan(player, world, src, site, n);
        if (!plan.ok) return { success: false, reason: plan.reasons[0], plan };
        const tile = world.getTile(src.q, src.r);
        const town = tile.settlement;
        Economy.initSettlement(town);
        const inventory = {};
        let paidMarket = 0;
        for (const x of plan.supplies) {
            let got = 0;
            if (x.packs > 0) {
                player.inventory[x.id] = _num(player.inventory[x.id]) - x.packs;
                if (player.inventory[x.id] <= 0) delete player.inventory[x.id];
                got += x.packs;
            }
            if (x.market > 0) {
                const bought = SettlementMarket.take(town, x.id, x.market);
                got += bought;
                paidMarket += bought * x.unit;
            }
            if (x.granary > 0) {
                const fromGranary = Math.min(x.granary, Math.floor(Math.max(0, _num(town.economy.food))));
                town.economy.food = _num(town.economy.food) - fromGranary;
                got += fromGranary;
                paidMarket += fromGranary * x.unit;
            }
            if (got > 0) inventory[x.id] = got;
        }
        paidMarket = Math.round(paidMarket);
        const toTown = paidMarket + plan.fee;
        let purseGoods = null;
        if (plan.inKind) {
            // In kind: goods to the town's market for its stores and guides; the
            // settlers' purses as goods they carry to the new village
            Barter.pay(player, toTown, town);
            if (plan.purses > 0) purseGoods = Barter.pay(player, plan.purses, null).goods;
        } else {
            player.gold = _num(player.gold) - toTown - plan.purses;
            town.economy.gold = _num(town.economy.gold) + toTown;
        }
        town.population = Math.max(0, _num(town.population) - plan.people);
        Ledger.record(player, 'villageFounding', -(toTown + plan.purses));

        const realm = VillageFounding.ruledRealm(world);
        const unit = VillageFounding.spawnParty(world, {
            from: { q: tile.q, r: tile.r }, site: plan.survey, people: plan.people, inventory,
            coin: plan.inKind ? 0 : plan.purses, purseGoods, route: plan.route, sourceName: town.name,
            culture: town.culture || (town.kingdom && world.getKingdom(town.kingdom) ? world.getKingdom(town.kingdom).culture : null),
            policy: opts.policy && Colonization.POLICIES && Colonization.POLICIES[opts.policy] ? opts.policy : 'coexistence',
            realmId: realm ? realm.id : null,
            name: opts.name ? String(opts.name).trim().slice(0, 40) : null,
            founder: player.name || null,
        });
        const st = VillageFounding.state(player);
        st.sent = (st.sent || 0) + 1;
        return { success: true, unit, plan, paid: toTown + plan.purses };
    },

    /** Stars for a 0-5 score: "★★★☆☆" */
    stars(score) {
        const n = Math.max(0, Math.min(5, Math.round(_num(score))));
        return '★'.repeat(n) + '☆'.repeat(5 - n);
    },

    /** Hexes from the town to a site (for listings). */
    distance(world, a, b) {
        return Hex.wrappingDistance(a.q, a.r, b.q, b.r, world.width);
    },
};
