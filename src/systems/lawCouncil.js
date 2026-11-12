// ============================================
// LAW COUNCIL — the AI realms' rulers change their laws
// ============================================
// Only the player's Laws.enact changed a law before; a realm under an AI
// ruler kept its old custom for ever. Here each realm the player does not
// rule weighs, every day, the rules of data/laws.json `ai.rules` — one per
// law, each naming a TRIGGER (a test of the world: is the danger near?),
// the option to proclaim while it stands (`on`) and the one to go back to
// once it has passed (`off`):
//
//   - the danger must stand `actDays` before the crown acts (no knee-jerk),
//     and be gone `clearDays` before it relents — and the law must have
//     held `minHoldDays` — so the law does not flap; the danger is "near"
//     within `radius` hexes of the realm's towns, "gone" only beyond
//     `clearRadius` (wider), a second fold of hysteresis;
//   - the ruler's traits (kingdom.characterData.ruler.traits) shift all
//     three (`traits`: { traitId: { act, clear, radius } } in days and
//     hexes): a wise or fearful ruler shuts the gates sooner and keeps them
//     shut longer; a greedy one or a merchant prince, losing the trade,
//     waits and opens early;
//   - the proclamation (Laws.proclaim: the option's stability paid, no
//     treasury) goes on world.lawNews for the heralds (systems/heralds.js:
//     `law_<law>_<option>` in data/chatter.json heralds.templates).
//
// Wired now: Pestilence (trigger 'plague'): the plague in, or within
// `radius` hexes of, one of the realm's towns — a town's roster sick of it
// (settlement.sickness / folk.ill.out, systems/illness.js) or the plague
// world event's town. Quarantine then reads through Illness.quarantined, and
// the trade cut through MarketDynamics._quarantine, unchanged. Another law
// needs only its rule in the data and a TRIGGERS entry here.
//
// Per realm memory on kingdom.laws.ai = { lawId: { since, last } } (saved
// with the realm; old saves start without it). No randomness at all.

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Kingdom } from '../world/kingdom.js';
import { Laws } from './laws.js';
import { Illness } from './illness.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const MAX_NEWS = 30;

/** The plague's places today: [{ q, r, name }] — towns sick of it, the plague event's town. */
function _plagueSites(world, views, day, rule) {
    const stale = _num(rule.staleDays, 12);
    const out = [];
    for (const s of views) {
        if (!s || !Number.isFinite(s.q) || !Number.isFinite(s.r)) continue;
        const sk = s.sickness;
        let sick = !!(sk && sk.k && (Illness.def(sk.k) || {}).plague && day - _num(sk.d, day) <= stale);
        const out_ = s.folk && s.folk.ill && _obj(s.folk.ill.out);
        if (!sick && out_) sick = Object.keys(out_).some(k => (Illness.def(k) || {}).plague);
        if (sick) out.push({ q: s.q, r: s.r, name: s.name || null });
    }
    for (const ev of (world && Array.isArray(world.activeEvents)) ? world.activeEvents : []) {
        if (ev && ev.id === 'plague' && Number.isFinite(ev.q) && Number.isFinite(ev.r)) out.push({ q: ev.q, r: ev.r, name: ev.settlementName || null });
    }
    return out;
}

/** The nearest of `sites` to any of `towns`: { d, site, town } (d Infinity when none). */
function _nearest(towns, sites) {
    let best = { d: Infinity, site: null, town: null };
    for (const t of towns) {
        for (const x of sites) {
            const d = Hex.distance(t.q, t.r, x.q, x.r);
            if (d < best.d) best = { d, site: x, town: t };
        }
    }
    return best;
}

/** Each trigger: (world, kingdom, towns, rule, ctx) → { near: { d, site, town }, nearR, clearR } — the danger's distance. */
const TRIGGERS = {
    plague(world, k, towns, rule, ctx) {
        if (!ctx.plague) ctx.plague = _plagueSites(world, ctx.views, ctx.day, rule);
        return _nearest(towns, ctx.plague);
    },
};

export const LawCouncil = {
    config() {
        const d = _obj(DataLoader._gamedata && DataLoader._gamedata.laws && DataLoader._gamedata.laws.ai) || {};
        return { enabled: d.enabled !== false, ...d };
    },

    /** The ruler's traits as ids. */
    traits(k) {
        const r = k && k.characterData && k.characterData.ruler;
        return ((r && Array.isArray(r.traits)) ? r.traits : []).map(t => (t && t.id) || t).filter(t => typeof t === 'string');
    },

    /** A rule as this ruler reads it: { act, clear, hold, radius, clearRadius } (days, hexes). */
    temper(rule, k) {
        const out = {
            act: _num(rule.actDays, 2), clear: _num(rule.clearDays, 20), hold: _num(rule.minHoldDays, 20),
            radius: _num(rule.radius, 4), clearRadius: _num(rule.clearRadius, _num(rule.radius, 4) + 2),
        };
        const T = _obj(rule.traits) || {};
        for (const t of LawCouncil.traits(k)) {
            const m = _obj(T[t]);
            if (!m) continue;
            out.act += _num(m.act);
            out.clear += _num(m.clear);
            out.radius += _num(m.radius);
        }
        out.act = Math.max(0, out.act);
        out.clear = Math.max(1, out.clear);
        out.radius = Math.max(0, out.radius);
        out.clearRadius = Math.max(out.radius + 1, out.clearRadius + Math.max(0, out.radius - _num(rule.radius, 4)));
        return out;
    },

    /** The realm's memory of a rule: { since (the danger first seen near), last (last seen within clearRadius) }. */
    memory(k, lawId) {
        if (!_obj(k.laws)) k.laws = {};
        if (!_obj(k.laws.ai)) k.laws.ai = {};
        if (!_obj(k.laws.ai[lawId])) k.laws.ai[lawId] = { since: null, last: null };
        return k.laws.ai[lawId];
    },

    /** The heralds' records (world.lawNews, systems/heralds.js). */
    news(world) {
        const n = world && _obj(world.lawNews);
        return n && Array.isArray(n.history) ? n.history : [];
    },

    _news(world, entry) {
        if (!_obj(world.lawNews)) world.lawNews = { history: [] };
        if (!Array.isArray(world.lawNews.history)) world.lawNews.history = [];
        world.lawNews.history.push(entry);
        if (world.lawNews.history.length > MAX_NEWS) world.lawNews.history.splice(0, world.lawNews.history.length - MAX_NEWS);
    },

    /**
     * One day of the AI crowns' laws. `player`: the realm they rule is
     * theirs to decide. → { changes: [{ kingdomId, law, to, why }] }
     */
    processDay(world, player = null) {
        const out = { changes: [] };
        const C = LawCouncil.config();
        if (!C.enabled || !world || !Array.isArray(world.kingdoms)) return out;
        const rules = Laws.aiRules();
        if (!Object.keys(rules).length) return out;
        const day = _num(world.day);
        const every = Math.max(1, Math.round(_num(C.everyDays, 1)));
        if (day % every !== 0) return out;
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        const ctx = { day, views };
        const ruled = player ? Laws.ruled(player, world) : null;
        for (const k of world.kingdoms) {
            if (!k || k.isAlive === false || (ruled && ruled.id === k.id)) continue;
            const towns = views.filter(s => s && s.kingdom === k.id && Number.isFinite(s.q) && Number.isFinite(s.r));
            if (!towns.length) continue;
            for (const [lawId, rule] of Object.entries(rules)) {
                const trig = TRIGGERS[rule.trigger];
                if (!trig || !rule.on || !rule.off) continue;
                const ch = LawCouncil._weigh(world, k, towns, lawId, rule, trig(world, k, towns, rule, ctx), day);
                if (ch) out.changes.push(ch);
            }
        }
        return out;
    },

    /** One realm, one rule: act once the danger has stood, relent once it has long gone. → the change or null. */
    _weigh(world, k, towns, lawId, rule, near, day) {
        const t = LawCouncil.temper(rule, k);
        const m = LawCouncil.memory(k, lawId);
        const cur = Laws.value(world, k.id, lawId);
        if (near.d <= t.clearRadius) m.last = day;
        if (cur !== rule.on) {
            if (near.d <= t.radius) {
                if (m.since == null) m.since = day;
                if (day - m.since >= t.act) return LawCouncil._change(world, k, lawId, rule.on, 'on', near, day);
            } else {
                m.since = null;
            }
            return null;
        }
        // Under the law: relent once the danger has been gone clearDays, and the law has held a while
        m.since = null;
        if (m.last == null) m.last = day;
        const changed = _num(k.laws && k.laws.changed && k.laws.changed[lawId], -Infinity);
        if (day - m.last >= t.clear && day - changed >= t.hold) return LawCouncil._change(world, k, lawId, rule.off, 'off', near, day);
        return null;
    },

    _change(world, k, lawId, optionId, dir, near, day) {
        const why = dir === 'on' ? 'danger' : 'passed';
        const r = Laws.proclaim(world, k, lawId, optionId, { why });
        if (!r) return null;
        const ruler = k.characterData && k.characterData.ruler;
        let style = null;
        try { style = Kingdom.rulerStyle(k, (ruler && ruler.gender) || 'male'); } catch (e) { style = null; }
        const where = near && near.site ? near.site : (near && near.town) || null;
        const town = near && near.town;
        LawCouncil._news(world, {
            key: `law:${k.id}:${lawId}:${optionId}:${day}`, kind: `law_${lawId}_${optionId}`, day, kingdomId: k.id,
            kingdom: k.name || null, ruler: (style && style.full) || (ruler && ruler.name) || null,
            place: (town && town.name) || null, near: (where && where.name) || null,
            q: town ? town.q : null, r: town ? town.r : null, law: lawId, to: optionId, why,
        });
        return { kingdomId: k.id, law: lawId, to: optionId, why };
    },
};
