// ============================================
// HERALDS — criers carry the great news of the day from town to town
// ============================================
// When something big happens — a coronation, a realm falling or rising
// again, a war declared or a peace made, a saga ending, a revolt against a
// crown (or its end), a peasant rebellion, a new land named on the charts, a
// siege won or broken, a Great Work finished or begun — the heralds proclaim it. A proclamation starts where
// it happened and spreads outward `speed` hexes a day; every settlement it
// has reached knows it (Chatter's `proclamation` condition and the tavern's
// news read heardAt), and when it reaches the player it becomes a short
// dismissible notice.
//
// Detection reads state the other systems already keep and diffs it against
// yesterday's snapshot (rulers, living realms, war pairs, rebellions, the
// player's revolt), or reads day-stamped records (concluded sagas, siege
// histories, named discoveries) — no other system needs a hook. The first
// tick only takes the snapshot, so loading a save never floods the player.
//
// Throttled: at most `maxPerDay` notices a day and `minGapDays` between
// them (the gravest news — priority 9+ — always gets through); news about
// the player's own doings is heard in the towns but not cried at the player,
// who already knows. Content lives in data/chatter.json → heralds.
//
// State on player.heralds (saved with the player). No randomness at all: the
// template is chosen by a hash of the proclamation's id.

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';

const DEFAULT_CONFIG = { speed: 8, lifeDays: 40, minGapDays: 2, maxPerDay: 1, cap: 24 };
const MAJOR = 9;
const SIEGE_WON = ['captured', 'sacked', 'terms'];

const _num = v => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const _day = world => (world && Number.isFinite(world.day) ? world.day : 0);

function _hashInt(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function _kingdom(world, id) {
    if (!world || id == null) return null;
    if (world.getKingdom) return world.getKingdom(id);
    return (world.kingdoms || []).find(k => k.id === id) || null;
}

export const Heralds = {

    // ──────────── DATA ────────────

    data() {
        return (DataLoader.chatter && DataLoader.chatter.heralds) || {};
    },

    config() {
        return { ...DEFAULT_CONFIG, ...(Heralds.data().config || {}) };
    },

    // ──────────── STATE ────────────

    _blank() {
        return { snapshot: null, seen: {}, list: [], nextId: 1, lastDay: null, lastNoticeDay: null, stats: { proclaimed: 0, cried: 0 } };
    },

    state(player) {
        if (!player) return Heralds._blank();
        let st = player.heralds;
        if (!st || typeof st !== 'object' || Array.isArray(st)) {
            player.heralds = Heralds._blank();
            return player.heralds;
        }
        const blank = Heralds._blank();
        if (st.snapshot === undefined) st.snapshot = null;
        if (!st.seen || typeof st.seen !== 'object') st.seen = {};
        if (!Array.isArray(st.list)) st.list = [];
        if (!(st.nextId > 0)) st.nextId = 1;
        if (st.lastDay === undefined) st.lastDay = null;
        if (st.lastNoticeDay === undefined) st.lastNoticeDay = null;
        st.stats = { ...blank.stats, ...(st.stats && typeof st.stats === 'object' ? st.stats : {}) };
        return st;
    },

    serialize(player) {
        return player && player.heralds ? JSON.parse(JSON.stringify(player.heralds)) : null;
    },

    loadState(player) {
        Heralds.state(player);
    },

    /** Recent proclamations, newest first. */
    recent(player, limit = 10) {
        return Heralds.state(player).list.slice().reverse().slice(0, limit);
    },

    // ──────────── SPREAD ────────────

    /** Has proclamation `p` reached (q, r) by `day`? */
    reached(p, world, q, r, day = _day(world)) {
        if (!p || day < p.day) return false;
        if (p.q == null || q == null) return true;
        const dist = Hex.wrappingDistance(p.q, p.r, q, r, (world && world.width) || 0);
        return dist <= (day - p.day + 1) * Heralds.config().speed;
    },

    /** What the criers have proclaimed at (q, r): [{ kind, text, day }], newest first. */
    heardAt(player, world, q, r) {
        const st = player && player.heralds;
        if (!st || !Array.isArray(st.list) || !st.list.length) return [];
        const day = _day(world);
        const life = Heralds.config().lifeDays;
        const out = [];
        for (let i = st.list.length - 1; i >= 0; i--) {
            const p = st.list[i];
            if (day - p.day > life) continue;
            if (Heralds.reached(p, world, q, r, day)) out.push({ kind: p.kind, text: p.text, day: p.day });
        }
        return out;
    },

    // ──────────── DAILY ────────────

    _snapshot(world, player) {
        const rulers = {};
        const alive = {};
        const wars = [];
        for (const k of (world && world.kingdoms) || []) {
            alive[k.id] = k.isAlive !== false;
            rulers[k.id] = k.ruler || null;
            if (k.isAlive === false) continue;
            for (const e of k.wars || []) {
                const key = [String(k.id), String(e)].sort().join('|');
                if (!wars.includes(key)) wars.push(key);
            }
        }
        const rebellions = ((world && world.activeEvents) || [])
            .filter(ev => ev && ev.id === 'rebellion')
            .map(ev => `${ev.kingdomId}:${ev.settlementName || ''}`);
        const court = player && player.throne && player.throne.ruling && player.throne.ruling.court;
        const revolt = court && court.revolt ? { id: court.revolt.id, leader: court.revolt.leaderName, kingdomId: player.throne.ruling.kingdomId } : null;
        return { rulers, alive, wars, rebellions, revolt };
    },

    /** Keys of the day-stamped records Heralds reads: [{ key, day, ... }] per kind. */
    _records(player) {
        const out = { sagas: [], sieges: [], holdings: [], lairs: [] };
        for (const s of (player && player.sagas && Array.isArray(player.sagas.done)) ? player.sagas.done : []) {
            if (s && s.ended) out.sagas.push({ key: `saga:${s.uid}`, day: _num(s.ended.day), s });
        }
        for (const h of (player && player.sieges && player.sieges.history) || []) {
            if (h) out.sieges.push({ key: `siege:${h.day}:${h.name}:${h.outcome}`, day: _num(h.day), h });
        }
        for (const h of (player && player.realmWars && player.realmWars.siegeHistory) || []) {
            if (h) out.holdings.push({ key: `held:${h.day}:${h.name}:${h.outcome}`, day: _num(h.day), h });
        }
        // Outlaw lairs grown infamous, and lairs cleared (systems/outlawLairs.js)
        for (const h of (player && player.outlawLairs && Array.isArray(player.outlawLairs.history)) ? player.outlawLairs.history : []) {
            if (h && h.key) out.lairs.push({ key: h.key, day: _num(h.day), h });
        }
        return out;
    },

    /** Mark everything already on record as heard (first tick, old saves). */
    _markSeen(player, st, world = null) {
        const gw = world && world.greatWorks;
        for (const b of (gw && Array.isArray(gw.built)) ? gw.built : []) if (b && b.uid) st.seen[`gw:${b.uid}`] = _num(b.day);
        for (const n of (gw && Array.isArray(gw.npc)) ? gw.npc : []) if (n && n.uid) st.seen[`gwn:${n.uid}`] = _num(n.startDay);
        for (const s of (player && player.discovery && player.discovery.sites) || []) {
            if (s && s.discovered) st.seen[`d:${s.id}`] = true;
        }
        const rec = Heralds._records(player);
        for (const x of [...rec.sagas, ...rec.sieges, ...rec.holdings, ...rec.lairs]) st.seen[x.key] = x.day;
    },

    _capital(world, k) {
        if (k && k.capital && k.capital.q != null) return { q: k.capital.q, r: k.capital.r };
        const s = k && Array.isArray(k.settlements) ? k.settlements[0] : null;
        return s ? { q: s.q, r: s.r } : { q: null, r: null };
    },

    _placeByName(world, name) {
        if (!world || !name) return { q: null, r: null };
        for (const k of world.kingdoms || []) {
            for (const s of k.settlements || []) if (s && s.name === name) return { q: s.q, r: s.r };
        }
        return { q: null, r: null };
    },

    _proclaim(st, world, kind, tokens, at, opts = {}) {
        const H = Heralds.data();
        const templates = (H.templates && H.templates[kind]) || [];
        if (!templates.length) return null;
        const id = st.nextId++;
        const raw = templates[_hashInt(`${kind}:${id}:${_day(world)}`) % templates.length];
        const text = String(raw).replace(/\{(\w+)\}/g, (m, k) => (tokens[k] != null ? tokens[k] : m));
        const p = {
            id, kind, day: _day(world), text,
            q: at && at.q != null ? at.q : null, r: at && at.r != null ? at.r : null,
            kingdomId: opts.kingdomId != null ? opts.kingdomId : null,
            priority: _num((H.priority || {})[kind]),
            own: !!opts.own, delivered: !!opts.own,
        };
        st.list.push(p);
        st.stats.proclaimed++;
        return p;
    },

    /** Find what happened since the last tick and proclaim it. */
    _detect(world, player, st, since) {
        const prev = { rulers: {}, alive: {}, wars: [], rebellions: [], revolt: null, ...st.snapshot };
        const now = Heralds._snapshot(world, player);
        const name = id => { const k = _kingdom(world, id); return k ? k.name : 'a realm'; };

        // Realms falling and rising; new rulers
        for (const k of world.kingdoms || []) {
            const was = prev.alive[k.id];
            const at = Heralds._capital(world, k);
            if (was === true && k.isAlive === false) {
                Heralds._proclaim(st, world, 'realm_fallen', { kingdom: k.name }, at, { kingdomId: k.id });
                continue;
            }
            if (was === false && k.isAlive !== false) {
                Heralds._proclaim(st, world, 'realm_restored', { kingdom: k.name }, at, { kingdomId: k.id });
            }
            const before = prev.rulers[k.id];
            if (k.isAlive !== false && before && k.ruler && k.ruler !== before) {
                const ruling = player && player.throne && player.throne.ruling;
                const own = !!(ruling && ruling.kingdomId === k.id);
                Heralds._proclaim(st, world, 'coronation', { ruler: k.ruler, kingdom: k.name }, at, { kingdomId: k.id, own });
            }
        }

        // Wars declared and peace made (a war that ends because a realm died is a conquest, not a peace)
        for (const key of now.wars) {
            if (prev.wars.includes(key)) continue;
            const [a, b] = key.split('|');
            const ka = (world.kingdoms || []).find(k => String(k.id) === a);
            Heralds._proclaim(st, world, 'war', { kingdom: name(ka ? ka.id : a), other: name(b) }, Heralds._capital(world, ka), { kingdomId: ka ? ka.id : null });
        }
        for (const key of prev.wars) {
            if (now.wars.includes(key)) continue;
            const [a, b] = key.split('|');
            const ka = (world.kingdoms || []).find(k => String(k.id) === a);
            const kb = (world.kingdoms || []).find(k => String(k.id) === b);
            if (!ka || !kb || ka.isAlive === false || kb.isAlive === false) continue;
            Heralds._proclaim(st, world, 'peace', { kingdom: ka.name, other: kb.name }, Heralds._capital(world, ka), { kingdomId: ka.id });
        }

        // Peasant rebellions (timed world events)
        for (const ev of (world.activeEvents || [])) {
            if (!ev || ev.id !== 'rebellion') continue;
            const key = `${ev.kingdomId}:${ev.settlementName || ''}`;
            if (prev.rebellions.includes(key)) continue;
            Heralds._proclaim(st, world, 'rebellion', { kingdom: name(ev.kingdomId), place: ev.settlementName || name(ev.kingdomId) }, { q: ev.q, r: ev.r }, { kingdomId: ev.kingdomId });
        }

        // A revolt against the player's crown (the player already hears of it)
        if (!prev.revolt && now.revolt) {
            const k = _kingdom(world, now.revolt.kingdomId);
            Heralds._proclaim(st, world, 'revolt', { leader: now.revolt.leader || 'the lords', kingdom: k ? k.name : 'the realm' }, Heralds._capital(world, k), { kingdomId: now.revolt.kingdomId, own: true });
        } else if (prev.revolt && !now.revolt) {
            const k = _kingdom(world, prev.revolt.kingdomId);
            Heralds._proclaim(st, world, 'revolt_end', { kingdom: k ? k.name : 'the realm' }, Heralds._capital(world, k), { kingdomId: prev.revolt.kingdomId, own: true });
        }

        // Sagas that ended, sieges won and broken: day-stamped records, each cried once
        const rec = Heralds._records(player);
        const fresh = x => x.day >= since - 1 && st.seen[x.key] == null;
        for (const x of rec.sagas.filter(fresh)) {
            st.seen[x.key] = x.day;
            const s = x.s;
            const a = s.anchor || {};
            const p = a.settlement || a.site || a.lair || null;
            Heralds._proclaim(st, world, 'saga_end', { saga: s.name || 'the saga', title: s.ended.title || 'it is over' }, p, { kingdomId: a.kingdomId, own: !!s.involved });
        }
        // New lands named on the charts
        for (const site of (player.discovery && player.discovery.sites) || []) {
            if (!site || !site.discovered || site.naming || st.seen[`d:${site.id}`]) continue;
            st.seen[`d:${site.id}`] = true;
            const mine = site.discovered.by === 'player';
            const by = mine ? (player.name || 'a bold captain') : (site.discovered.byName || 'an adventurer');
            Heralds._proclaim(st, world, 'discovery', { place: site.name, by }, { q: site.q, r: site.r }, { own: mine });
        }

        // Great Works: wonders finished (anyone's), and kingdoms laying first stones
        // (systems/patronage.js keeps world.greatWorks; records are day-stamped)
        const gw = world.greatWorks;
        for (const b of (gw && Array.isArray(gw.built)) ? gw.built : []) {
            if (!b || !b.uid || st.seen[`gw:${b.uid}`] != null || _num(b.day) < since - 1) continue;
            st.seen[`gw:${b.uid}`] = _num(b.day);
            const mine = b.owner === 'player';
            const k = mine ? null : _kingdom(world, b.kingdomId);
            const by = mine ? ((player.house && player.house.name) || player.name || 'a great House') : (k ? k.name : 'a realm');
            Heralds._proclaim(st, world, 'wonder', { title: b.name, place: b.settlementName || 'the capital', by }, { q: b.q, r: b.r }, { kingdomId: b.kingdomId, own: mine });
        }
        for (const n of (gw && Array.isArray(gw.npc)) ? gw.npc : []) {
            if (!n || !n.uid || st.seen[`gwn:${n.uid}`] != null || _num(n.startDay) < since - 1) continue;
            st.seen[`gwn:${n.uid}`] = _num(n.startDay);
            const k = _kingdom(world, n.kingdomId);
            const t = world.getTile ? world.getTile(n.q, n.r) : null;
            const def = (DataLoader.patronage && DataLoader.patronage.greatWorks && DataLoader.patronage.greatWorks[n.workId]) || {};
            Heralds._proclaim(st, world, 'wonder_begun', { title: def.name || 'a great work', place: (t && t.settlement && t.settlement.name) || 'its capital', by: k ? k.name : 'a realm' }, { q: n.q, r: n.r }, { kingdomId: n.kingdomId });
        }

        // The player's own sieges (won, or broken), and sieges of the player's holdings
        for (const x of rec.sieges.filter(fresh)) {
            st.seen[x.key] = x.day;
            const h = x.h;
            const kind = SIEGE_WON.includes(h.outcome) ? 'siege_won' : h.outcome === 'broken' ? 'siege_lost' : null;
            if (!kind) continue;
            Heralds._proclaim(st, world, kind, { place: h.name, by: player.name || 'the besieger', days: _num(h.days) }, Heralds._placeByName(world, h.name), { own: true });
        }
        for (const x of rec.holdings.filter(fresh)) {
            st.seen[x.key] = x.day;
            const h = x.h;
            const kind = h.outcome === 'fallen' ? 'siege_won' : (h.outcome === 'relieved' || h.outcome === 'held') ? 'siege_lost' : null;
            if (!kind) continue;
            Heralds._proclaim(st, world, kind, { place: h.name, by: h.kingdomName || 'the enemy', days: _num(h.days) }, Heralds._placeByName(world, h.name), { own: true });
        }

        // Outlaws: a lair grown infamous, a lair burned out
        for (const x of rec.lairs.filter(fresh)) {
            st.seen[x.key] = x.day;
            const h = x.h;
            const kind = h.kind === 'cleared' ? 'lair_cleared' : h.kind === 'risen' ? 'lair_risen' : null;
            if (!kind) continue;
            Heralds._proclaim(st, world, kind, { place: h.name, leader: h.leader || 'the chief', by: h.by || 'the wardens', kingdom: h.kingdom || 'the realm' },
                { q: h.q, r: h.r }, { kingdomId: h.kingdomId, own: !!h.own });
        }

        st.snapshot = now;
    },

    /**
     * One day of the heralds: proclaim what happened, spread it, and cry what
     * has reached the player. Draws no RNG. → { notices: [{ icon, title, text, type, kind }] }
     */
    processDay(world, player) {
        const out = { notices: [] };
        if (!world || !player) return out;
        const st = Heralds.state(player);
        const day = _day(world);
        if (st.lastDay === day) return out;
        const cfg = Heralds.config();

        if (!st.snapshot) {
            st.snapshot = Heralds._snapshot(world, player);
            Heralds._markSeen(player, st, world);
        } else {
            Heralds._detect(world, player, st, st.lastDay == null ? day - 1 : st.lastDay);
        }
        st.lastDay = day;

        // Old news is forgotten (named lands stay remembered: their key is `true`)
        st.list = st.list.filter(p => day - p.day <= cfg.lifeDays);
        for (const [k, v] of Object.entries(st.seen)) {
            if (typeof v === 'number' && day - v > cfg.lifeDays * 2) delete st.seen[k];
        }
        if (st.list.length > cfg.cap) st.list = st.list.slice(-cfg.cap);

        // What has reached the player today
        const reached = st.list.filter(p => !p.delivered && Heralds.reached(p, world, player.q, player.r, day));
        if (!reached.length) return out;
        reached.sort((a, b) => (b.priority - a.priority) || (a.id - b.id));
        const gapOk = st.lastNoticeDay == null || day - st.lastNoticeDay >= cfg.minGapDays;
        let cried = 0;
        const icons = Heralds.data().icons || {};
        for (const p of reached) {
            p.delivered = true;
            if (cried >= cfg.maxPerDay) continue;
            if (!gapOk && p.priority < MAJOR) continue;
            cried++;
            st.stats.cried++;
            st.lastNoticeDay = day;
            out.notices.push({ icon: icons[p.kind] || '📯', title: 'The Heralds Cry', text: p.text, type: 'info', kind: p.kind });
        }
        return out;
    },
};
