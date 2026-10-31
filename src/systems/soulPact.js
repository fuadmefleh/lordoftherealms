// ============================================
// SOUL PACT — the stranger in the tavern corner, and what he comes back for
// ============================================
// "Sell your soul" is a storyline, not a coin slot:
//
//   sell     — a named stranger buys the soul once, for a real sum (by the
//              player's renown and karma). Karma and renown fall at once.
//   due      — weeks later the debt comes due with a demand, drawn from the
//              system's own stream: pay back double in gold, or do a dark
//              deed (cruelty, a damning lie, a town put in fear) within a few
//              days. Earned-trait deed counters (systems/traits.js) are
//              watched, so the deed must really be done. A kept demand buys a
//              few quiet weeks — and a few coins — before the next.
//   curse    — refuse, or let the days run out, and the soul's emptiness
//              shows: −2 luck (read by gambling, fishing, foraging...), karma
//              drained daily, renown lost, prayers unanswered (Devotion
//              .prayerMult reads it).
//   redeem   — the soul can be bought back at a temple (three times the
//              price, less the clergy's regard for you), or won back by
//              keeping a pilgrimage vow to a shrine of your own faith
//              (systems/devotion.js).
//
// State on player.soulPact (saved); the legacy counters soulSoldCount /
// lastSoulSoldDay are kept for the character panel. Rolls come from the
// pact's own seeded stream. Content: data/devotion.json → pact.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Traits } from './traits.js';
import { Ledger } from './ledger.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _r1 = v => Math.round(v * 10) / 10;
const _day = world => (world && Number.isFinite(world.day) ? world.day : 0);

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function _seed(world) {
    const p = world && world.generationParams;
    return (p && p.seed) || 0;
}

export const SoulPact = {
    config() {
        const gd = DataLoader._gamedata;
        return (gd && gd.devotion && gd.devotion.pact) || {};
    },

    _blank() {
        return { state: 'none', buyer: null, look: null, price: 0, soldDay: null, dueDay: null, demand: null, curse: null, kept: 0, history: [], n: 0 };
    },

    /** The pact record (none | sold | due | cursed | redeemed). */
    state(player) {
        if (!player) return SoulPact._blank();
        let st = player.soulPact;
        if (!_obj(st)) {
            player.soulPact = SoulPact._blank();
            return player.soulPact;
        }
        const b = SoulPact._blank();
        for (const k of Object.keys(b)) if (st[k] === undefined) st[k] = b[k];
        if (!Array.isArray(st.history)) st.history = [];
        return st;
    },

    serialize(player) {
        return player && player.soulPact ? JSON.parse(JSON.stringify(player.soulPact)) : null;
    },

    loadState(player) {
        if (player && player.soulPact) SoulPact.state(player);
    },

    _rng(world, player, tag) {
        const st = SoulPact.state(player);
        st.n = (st.n || 0) + 1;
        return Utils.seededRandom((_hash(`${_seed(world)}:soulpact:${tag}:${_day(world)}:${st.n}`) % 233279) + 1);
    },

    _note(st, world, text) {
        st.history.unshift({ d: _day(world), text });
        if (st.history.length > 20) st.history.length = 20;
    },

    /** Is the soul in the stranger's hands? */
    isSold(player) {
        const s = player && player.soulPact && player.soulPact.state;
        return s === 'sold' || s === 'due' || s === 'cursed';
    },

    /** How much prayer, alms and pilgrimage still count: 1 free, less sold, 0 cursed. */
    prayerMult(player) {
        const s = player && player.soulPact && player.soulPact.state;
        const dv = (DataLoader._gamedata && DataLoader._gamedata.devotion && DataLoader._gamedata.devotion.config) || {};
        if (s === 'cursed') return _num(dv.cursedMult, 0);
        if (s === 'sold' || s === 'due') return _num(dv.soulSoldMult, 0.4);
        return 1;
    },

    /** The stranger in this tavern, and what they would pay (no RNG: a hash of the town and the player). */
    offer(player, world, tile) {
        const C = SoulPact.config();
        const list = C.strangers || [];
        const st = SoulPact.state(player);
        const idx = list.length ? _hash(`${_seed(world)}:${tile ? `${tile.q},${tile.r}` : ''}:${player && player.name}`) % list.length : 0;
        const who = st.buyer ? { name: st.buyer, look: st.look } : (list[idx] || { name: 'a stranger', look: 'a figure in the corner' });
        const P = C.price || {};
        const price = Math.round(Math.max(10, Math.min(_num(P.max, 400), _num(P.base, 60) + _num(P.perRenown, 1.5) * _num(player.renown) + _num(P.perKarma, 2) * Math.max(0, _num(player.karma)))));
        return { name: who.name, look: who.look, price, state: st.state };
    },

    /** Sell the soul (once — a redeemed soul can be sold again). */
    sell(player, world, tile) {
        const st = SoulPact.state(player);
        if (SoulPact.isSold(player)) return { success: false, reason: `${st.buyer} already holds your soul.` };
        const C = SoulPact.config();
        const o = SoulPact.offer(player, world, tile);
        const rng = SoulPact._rng(world, player, 'sell');
        const due = C.dueDays || [18, 32];
        st.state = 'sold';
        st.buyer = o.name;
        st.look = o.look;
        st.price = o.price;
        st.soldDay = _day(world);
        st.dueDay = _day(world) + due[0] + Math.floor(rng() * (due[1] - due[0] + 1));
        st.demand = null;
        player.gold = _num(player.gold) + o.price;
        Ledger.record(player, 'pact', o.price);
        player.karma = _r1(_num(player.karma) + _num(C.karma, -10));
        player.renown = Math.max(0, _num(player.renown) + _num(C.renown, -2));
        Traits.recordDeeds(player, { greed: 3, deceit: 1 });
        // The old character-panel counters
        player.soulSoldCount = (player.soulSoldCount || 0) + 1;
        player.lastSoulSoldDay = _day(world);
        SoulPact._note(st, world, `Sold your soul to ${o.name} for ${o.price} gold.`);
        return { success: true, gold: o.price, buyer: o.name, text: `${o.name} counts out ${o.price} gold and takes your hand. It is very cold. "We'll speak again. Not soon. But we will."` };
    },

    /** Describe the current demand: { kind, label, icon, text, gold, deed, daysLeft, done }. */
    demand(player, world) {
        const st = SoulPact.state(player);
        const d = st.demand;
        if (!d) return null;
        const def = (SoulPact.config().demands || {})[d.kind] || {};
        const deeds = (player.traits && player.traits.deeds) || {};
        return {
            kind: d.kind, label: def.label || d.kind, icon: def.icon || '🔥',
            text: String(def.text || '').replace('{gold}', d.gold || 0),
            gold: d.gold || 0, deed: d.deed || null,
            progress: d.deed ? Math.max(0, _num(deeds[d.deed]) - _num(d.base)) : 0,
            amount: _num(d.amount, 1),
            daysLeft: Math.max(0, _num(d.until) - _day(world)),
        };
    },

    _due(player, world, out) {
        const st = SoulPact.state(player);
        const C = SoulPact.config();
        const rng = SoulPact._rng(world, player, 'due');
        const kinds = Object.keys(C.demands || {});
        if (!kinds.length) return;
        const kind = kinds[Math.floor(rng() * kinds.length)];
        const def = C.demands[kind];
        const deeds = (player.traits && player.traits.deeds) || {};
        st.state = 'due';
        st.demand = { kind, day: _day(world), until: _day(world) + _num(C.answerDays, 8) };
        if (def.goldMult) st.demand.gold = Math.round(st.price * def.goldMult);
        if (def.deed) { st.demand.deed = def.deed; st.demand.amount = _num(def.amount, 1); st.demand.base = _num(deeds[def.deed]); }
        const dd = SoulPact.demand(player, world);
        SoulPact._note(st, world, `${st.buyer} came to collect: ${dd.label}.`);
        out.notices.push({ icon: '🔥', title: 'The Debt Comes Due', text: `${st.buyer} finds you. ${dd.text} (${dd.daysLeft} days — answer at any tavern)`, type: 'warning' });
    },

    _settled(player, world, how, out) {
        const st = SoulPact.state(player);
        const C = SoulPact.config();
        const rng = SoulPact._rng(world, player, 'again');
        const again = C.againDays || [30, 50];
        st.state = 'sold';
        st.kept = _num(st.kept) + 1;
        st.demand = null;
        st.dueDay = _day(world) + again[0] + Math.floor(rng() * (again[1] - again[0] + 1));
        let text;
        if (how === 'deed') {
            player.karma = _r1(_num(player.karma) + _num(C.keptKarma, -4));
            const g = Math.round(_num(C.keptGold));
            if (g > 0) { player.gold = _num(player.gold) + g; Ledger.record(player, 'pact', g); }
            text = `${st.buyer} is pleased. A purse of ${g} gold appears in your pack. "Until next time."`;
        } else {
            text = `${st.buyer} weighs the coin and smiles. "Paid — this time."`;
        }
        SoulPact._note(st, world, text);
        if (out) out.notices.push({ icon: '🔥', title: 'The Stranger Is Satisfied', text, type: 'info' });
        return text;
    },

    _curse(player, world, out) {
        const st = SoulPact.state(player);
        const K = (SoulPact.config().curse) || {};
        if (st.state === 'cursed') return;
        st.state = 'cursed';
        st.demand = null;
        const luck = _num(K.luck, -2);
        const before = _num(player.luck, 5);
        player.luck = Math.max(1, before + luck);
        st.curse = { luck: player.luck - before, day: _day(world) };
        player.renown = Math.max(0, _num(player.renown) + _num(K.renown, -5));
        const text = `${st.buyer} takes what is owed. ${K.text || ''}`.trim();
        SoulPact._note(st, world, text);
        if (out) out.notices.push({ icon: '💀', title: 'Cursed', text, type: 'error' });
    },

    /**
     * Answer the stranger: 'pay' (when the demand is gold, or to buy off a
     * deed for the gold sum), or 'refuse'. A deed demand is answered by doing it.
     */
    answer(player, world, choice) {
        const st = SoulPact.state(player);
        if (st.state !== 'due' || !st.demand) return { success: false, reason: 'No one is asking anything of you.' };
        const out = { notices: [] };
        if (choice === 'pay') {
            const gold = SoulPact.payCost(player);
            if (_num(player.gold) < gold) return { success: false, reason: `${st.buyer} wants ${gold} gold.` };
            player.gold -= gold;
            Ledger.record(player, 'pact', -gold);
            return { success: true, text: SoulPact._settled(player, world, 'gold', null) };
        }
        if (choice === 'refuse') {
            SoulPact._curse(player, world, out);
            return { success: true, text: out.notices.map(n => n.text).join(' '), cursed: true };
        }
        return { success: false, reason: 'Unknown answer.' };
    },

    /** The gold that answers the current demand (a deed can be bought off for the same sum). */
    payCost(player) {
        const st = SoulPact.state(player);
        if (st.demand && st.demand.gold) return st.demand.gold;
        return Math.round(_num(st.price) * _num(((SoulPact.config().demands || {}).pay || {}).goldMult, 2));
    },

    /** What buying the soul back costs (discount: the clergy's regard, 0..1). */
    redeemCost(player, discount = 0) {
        const st = SoulPact.state(player);
        const R = SoulPact.config().redeem || {};
        const base = Math.max(_num(R.minGold, 150), Math.round(_num(st.price) * _num(R.goldMult, 3)));
        return Math.round(base * (1 - Math.max(0, Math.min(0.9, discount))));
    },

    /** The soul comes back: at a temple (pays redeemCost) or by a pilgrimage kept. */
    redeem(player, world, via = 'temple', discount = 0) {
        const st = SoulPact.state(player);
        if (!SoulPact.isSold(player)) return { success: false, reason: 'Your soul is your own.' };
        const R = SoulPact.config().redeem || {};
        let cost = 0;
        if (via === 'temple') {
            cost = SoulPact.redeemCost(player, discount);
            if (_num(player.gold) < cost) return { success: false, reason: `The rite of redemption takes ${cost} gold in offerings.` };
            player.gold -= cost;
            Ledger.record(player, 'pact', -cost);
        }
        if (st.curse && st.curse.luck) player.luck = Math.min(10, _num(player.luck, 5) - st.curse.luck);
        st.curse = null;
        st.state = 'redeemed';
        st.demand = null;
        st.dueDay = null;
        player.karma = _r1(_num(player.karma) + _num(R.karma, 5));
        player.renown = _num(player.renown) + _num(R.renown, 2);
        Traits.recordDeeds(player, { piety: 3 });
        const text = via === 'temple'
            ? `The priests chant through the night over ${cost} gold of offerings. At dawn ${st.buyer}'s mark is gone from your palm.`
            : `At the shrine's threshold something cold lets go of you. ${st.buyer} has lost a soul.`;
        SoulPact._note(st, world, text);
        return { success: true, cost, text };
    },

    /** The debt comes due, deeds are watched, the curse drains. Returns { notices }. */
    processDay(world, player) {
        const out = { notices: [] };
        if (!player || !_obj(player.soulPact)) return out;
        const st = SoulPact.state(player);
        const day = _day(world);
        const C = SoulPact.config();
        if (st.state === 'sold' && st.dueDay != null && day >= st.dueDay) SoulPact._due(player, world, out);
        else if (st.state === 'due' && st.demand) {
            const d = st.demand;
            const deeds = (player.traits && player.traits.deeds) || {};
            if (d.deed && _num(deeds[d.deed]) - _num(d.base) >= _num(d.amount, 1)) SoulPact._settled(player, world, 'deed', out);
            else if (day > _num(d.until)) SoulPact._curse(player, world, out);
        } else if (st.state === 'cursed') {
            const drain = _num((C.curse || {}).karmaPerDay, 0.5);
            if (drain) player.karma = _r1(_num(player.karma) - drain);
        }
        return out;
    },
};
