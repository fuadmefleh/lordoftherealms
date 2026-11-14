// ============================================
// WHISPERS — court scandals and whisper campaigns
// ============================================
// The great are talked about. Every few weeks a tale hatches about a ruler
// (a hidden bastard, a poisoned uncle, pawned crown jewels, a secret pact
// with the enemy, madness…) or a rival adventurer (a rigged tournament,
// grave-goods, cowardice). Some tales are true, some are lies, and nobody
// knows which. A tale starts in one town and spreads town to town; the more
// towns of the subject's own realm that whisper it, the hotter it runs, and a
// hot tale about a ruler drags on the realm's stability (kingdom.scandal.stab,
// read by world/kingdomState.js). When its time is up it is proven (true and
// hot: a shock to the realm, a rival's name in the mud), debunked (a lie:
// the crown is vindicated) or simply forgotten. A lie the player planted or
// fanned that runs at provenHeat or hotter for `harden.days` days on end
// comes to a reckoning: it hardens into accepted truth (proven, as if it
// were so — likelier the more of the subject's own towns tell it and the
// weaker the subject's standing) or it is debunked there and then.
//
// The player hears tales where they have spread (arriving in a town, the
// tavern, townsfolk chatter — systems/chatter.js) and can work them:
//   fan      — pay for the telling: hotter and further; the subject's enemies
//              like you for it, if the subject's men don't notice who paid;
//              a lie you fanned is likelier to be traced to you
//   quash    — in the subject's realm, pay to cool it: the crown is grateful
//   dig      — pay for the truth of it (wits or charm); a close friend may
//              simply tell you (systems/relationships/matters.js → reveal)
//   blackmail— a true tale, known to be true: the ruler pays to bury it…
//              unless they are the honourable kind and call the guard
//   sell     — a true tale to a crown at war with the subject: gold, their
//              favour, and the tale proven before the whole realm
//   plant    — start a tale of your own about any ruler or rival you know.
//              It may be true without your knowing. If it's a lie, it can be
//              traced back to you, and then the talk is about you (Gossip
//              'whisperer' rumour, the realm's displeasure, a rival's hatred).
// A bard can also sing down a crime rumour about the player in one town
// (singDown → Gossip.refute).
//
// State on player.whispers (saved). The daily tick draws from its own seeded
// stream (world seed + day), so it never reshuffles anyone else's dice; the
// player's own actions draw from Utils.random. Content: data/gossip.json →
// scandals. World / player are passed in; no import-time side effects.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { Gossip } from './gossip.js';
import { Rivals } from './rivals.js';
import { NPCLords } from '../world/npcLords.js';
import { Names } from '../core/names.js';
// (a tale on broadsheets goes where people read: systems/literacy.js; run time only)
import { Literacy } from './literacy.js';

const _num = v => (Number.isFinite(v) ? v : 0);
const _day = world => (world && Number.isFinite(world.day) ? world.day : 0);
const _key = (q, r) => `${q},${r}`;

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

const DEFAULTS = {
    firstDay: 20, hatchEvery: [14, 28], maxLive: 3, lifeDays: [35, 60],
    spreadPerDay: 2, spreadChance: 0.45, maxSpreadDistance: 7, heatPerTown: 12, foreignHeat: 0.4,
    coolPerDay: 0.8, provenHeat: 50, stabilityAtFullHeat: 12, maxStability: 20,
    provenShock: 8, vindicated: 3, rulerShare: 0.75, maxResolved: 20,
    fan: { cost: 40, heat: 15, spreads: 3, traceChance: 0.05, enemyRep: 3, traceBonus: 0.5, traceOnDebunk: 0.2 },
    harden: { days: 8, base: 0.3, perTown: 0.04, standing: 0.5, min: 0.05, max: 0.8 },
    quash: { cost: 60, heat: 30, rep: 4 },
    dig: { cost: 30, base: 0.35, perStat: 0.05 },
    blackmail: { base: 120, perHeat: 3, rep: -15, refuseTraits: ['honorable', 'brave'], refuseChance: 0.6 },
    sell: { base: 80, perHeat: 2, rep: 8 },
    plant: { cost: 80, heat: 12, traceChancePerDay: 0.025, traceTrueFactor: 0.4, rep: -15 },
    rival: { renownProven: 12, attitudeIfTraced: -35 },
    bard: { cost: 35 },
};

export const Whispers = {

    // ──────────── DATA ────────────

    data() {
        return (DataLoader.gossip && DataLoader.gossip.scandals) || { config: {}, kinds: {} };
    },

    config() {
        const c = this.data().config || {};
        const out = { ...DEFAULTS, ...c };
        for (const k of ['fan', 'quash', 'dig', 'blackmail', 'sell', 'plant', 'rival', 'bard', 'harden']) out[k] = { ...DEFAULTS[k], ...(c[k] || {}) };
        return out;
    },

    kinds() {
        return this.data().kinds || {};
    },

    // ──────────── STATE ────────────

    _blank() {
        return { scandals: [], resolved: [], nextId: 1, nextHatch: null, stats: { planted: 0, traced: 0, blackmailed: 0, sold: 0, fanned: 0, quashed: 0, hardened: 0, debunked: 0 } };
    },

    state(player) {
        if (!player) return this._blank();
        let st = player.whispers;
        if (!st || typeof st !== 'object') {
            player.whispers = this._blank();
            return player.whispers;
        }
        const blank = this._blank();
        if (!Array.isArray(st.scandals)) st.scandals = [];
        if (!Array.isArray(st.resolved)) st.resolved = [];
        if (!(st.nextId > 0)) st.nextId = st.scandals.length + st.resolved.length + 1;
        if (st.nextHatch === undefined) st.nextHatch = null;
        st.stats = { ...blank.stats, ...(st.stats || {}) };
        return st;
    },

    serialize(player) {
        return player && player.whispers ? JSON.parse(JSON.stringify(player.whispers)) : null;
    },

    loadState(player) {
        this.state(player);
    },

    get(player, id) {
        return this.state(player).scandals.find(s => s.id === id) || null;
    },

    live(player) {
        return this.state(player).scandals.filter(s => s.state === 'live');
    },

    // ──────────── WORLD HELPERS ────────────

    /** Every settlement of a living realm (the world's tile scan; see Gossip._settlements). */
    _settlements(world) {
        const alive = new Set(((world && world.kingdoms) || []).filter(k => k.isAlive !== false).map(k => k.id));
        return Gossip._settlements(world).filter(s => alive.has(s.kingdom));
    },

    /** Settlements by realm id. */
    _byRealm(world) {
        const map = new Map();
        for (const s of this._settlements(world)) {
            if (!map.has(s.kingdom)) map.set(s.kingdom, []);
            map.get(s.kingdom).push(s);
        }
        return map;
    },

    _kingdom(world, id) {
        if (!world || id == null) return null;
        if (typeof world.getKingdom === 'function') return world.getKingdom(id);
        return (world.kingdoms || []).find(k => k.id === id) || null;
    },

    _settlementAt(world, q, r) {
        const tile = world && world.getTile && q != null ? world.getTile(q, r) : null;
        return tile && tile.settlement ? { q, r, name: tile.settlement.name, kingdom: tile.settlement.kingdom } : null;
    },

    _nearest(world, q, r) {
        let best = null;
        let bestD = Infinity;
        for (const s of this._settlements(world)) {
            const d = Hex.wrappingDistance(q, r, s.q, s.r, world.width);
            if (d < bestD) { best = s; bestD = d; }
        }
        return best;
    },

    _enemies(world, kingdom) {
        if (!kingdom) return [];
        const ids = new Set(kingdom.wars || []);
        for (const k of world.kingdoms || []) if (k.isAlive !== false && (k.wars || []).includes(kingdom.id)) ids.add(k.id);
        return [...ids].map(id => this._kingdom(world, id)).filter(k => k && k.isAlive !== false);
    },

    _traitIds(kingdom) {
        const lord = kingdom && kingdom.lord;
        return lord && Array.isArray(lord.traits) ? lord.traits.map(t => t && t.id).filter(Boolean) : [];
    },

    _rival(player, id) {
        const list = player && player.rivals && Array.isArray(player.rivals.list) ? player.rivals.list : [];
        return list.find(r => r && r.id === id) || null;
    },

    // ──────────── TALES ────────────

    /** Kinds that fit a subject ('ruler' | 'rival'); a pact needs a war. */
    kindsFor(subjectType, world, kingdom) {
        const atWar = this._enemies(world, kingdom).length > 0;
        return Object.entries(this.kinds())
            .filter(([, k]) => (k.subjects || []).includes(subjectType) && (!k.needsWar || (subjectType === 'ruler' && atWar)))
            .map(([id]) => id);
    },

    /** How likely a tale of this kind is true of this subject (0.02–0.95). */
    truthChance(kindId, subject, world, player) {
        const kind = this.kinds()[kindId];
        if (!kind) return 0;
        const t = kind.truth || {};
        let p = _num(t.base);
        if (subject.type === 'ruler') {
            const k = this._kingdom(world, subject.kingdomId);
            for (const id of this._traitIds(k)) p += _num(t.traits && t.traits[id]);
            if (t.emptyTreasury && k && _num(k.treasury) <= 50) p += t.emptyTreasury;
            if (t.oldAge && k && k.lord && _num(k.lord.age) >= 55) p += t.oldAge;
        } else {
            const rv = this._rival(player, subject.rivalId);
            const deeds = (rv && rv.deeds) || {};
            if (t.rivalDuelsLost && _num(deeds.duelsLost) > _num(deeds.duelsWon)) p += t.rivalDuelsLost;
            if (t.rivalDelves && _num(deeds.delves) >= 3) p += t.rivalDelves;
        }
        return Utils.clamp(p, 0.02, 0.95);
    },

    /** The tale as the townsfolk tell it. */
    text(sc, which = 'line') {
        const kind = this.kinds()[sc.kind] || {};
        let raw;
        if (which === 'line') raw = (kind.lines || [])[sc.line || 0] || kind.label || 'a tale';
        else raw = kind[which] || '';
        return String(raw)
            .replace(/\{subject\}/g, sc.subject.name)
            .replace(/\{place\}/g, sc.place)
            .replace(/\{kingdom\}/g, sc.kingdomName || 'the realm')
            .replace(/\{enemy\}/g, sc.enemy || 'the enemy');
    },

    _create(player, world, subject, kindId, origin, opts = {}) {
        const st = this.state(player);
        const cfg = this.config();
        const kind = this.kinds()[kindId];
        if (!kind || !origin) return null;
        const k = this._kingdom(world, subject.kingdomId);
        const enemy = this._enemies(world, k)[0] || null;
        const day = _day(world);
        const truth = opts.truth != null ? !!opts.truth : Utils.random() < this.truthChance(kindId, subject, world, player);
        const life = Utils.randInt(cfg.lifeDays[0], cfg.lifeDays[1]);
        const sc = {
            id: st.nextId++,
            kind: kindId,
            subject: { ...subject },
            kingdomId: subject.kingdomId,
            kingdomName: (k && k.name) || 'the realm',
            enemy: enemy ? enemy.name : null,
            enemyId: enemy ? enemy.id : null,
            truth,
            planted: !!opts.planted,
            place: origin.name,
            originKey: _key(origin.q, origin.r),
            spreadTo: [_key(origin.q, origin.r)],
            line: Utils.randInt(0, Math.max(0, (kind.lines || []).length - 1)),
            heat: 0,
            extra: _num(opts.extra),
            born: day,
            ends: day + life,
            state: 'live',
            known: !!opts.known,
            truthKnown: false,
            fannedByPlayer: false,
            traced: false,
        };
        sc.heat = this._heat(sc, world);
        st.scandals.push(sc);
        return sc;
    },

    /** A new tale hatches somewhere in the world (the daily tick). */
    _hatch(player, world) {
        const cfg = this.config();
        const towns = this._byRealm(world);
        const realms = (world.kingdoms || []).filter(k => k.isAlive !== false && (towns.get(k.id) || []).length > 0);
        if (!realms.length) return null;
        const live = this.live(player);
        const rivals = ((player.rivals && player.rivals.list) || []).filter(r => r && !r.dead && r.q != null);

        // A ruler, mostly; sometimes one of the rival adventurers
        if (rivals.length && Utils.random() >= cfg.rulerShare) {
            const rv = Utils.randPick(rivals);
            if (!live.some(s => s.subject.type === 'rival' && s.subject.rivalId === rv.id)) {
                const at = this._settlementAt(world, rv.q, rv.r) || this._nearest(world, rv.q, rv.r);
                const kinds = at ? this.kindsFor('rival', world, this._kingdom(world, at.kingdom)) : [];
                if (at && kinds.length) {
                    return this._create(player, world, { type: 'rival', rivalId: rv.id, name: rv.name, kingdomId: at.kingdom }, Utils.randPick(kinds), at);
                }
            }
        }
        const k = Utils.randPick(realms);
        if (live.some(s => s.subject.type === 'ruler' && s.kingdomId === k.id)) return null;
        const kinds = this.kindsFor('ruler', world, k);
        if (!kinds.length) return null;
        const s = Utils.randPick(towns.get(k.id));
        return this._create(player, world, { type: 'ruler', kingdomId: k.id, name: k.ruler || `the ruler of ${Names.realm(k.name)}` }, Utils.randPick(kinds), { q: s.q, r: s.r, name: s.name });
    },

    // ──────────── SPREAD & HEAT ────────────

    _spread(sc, world) {
        const cfg = this.config();
        if (!sc.spreadTo.length) return false;
        const [sq, sr] = Utils.randPick(sc.spreadTo).split(',').map(Number);
        for (const s of this._settlements(world)) {
            const key = _key(s.q, s.r);
            if (sc.spreadTo.includes(key)) continue;
            const d = Hex.wrappingDistance(sq, sr, s.q, s.r, world.width);
            if (d > cfg.maxSpreadDistance) continue;
            // (on broadsheets, while they are fresh: faster where people read, slower where they don't)
            const written = sc.written && _day(world) - _num(sc.written.d) < 40 ? Literacy.writtenSpread(world, Literacy.at(world, key)) : 1;
            if (Utils.random() < cfg.spreadChance * written * (1 - d / (cfg.maxSpreadDistance + 1))) {
                sc.spreadTo.push(key);
                return true;
            }
        }
        return false;
    },

    /** Heat 0–100: towns whispering it (the subject's own realm counts most), what was paid, less the cooling of age. */
    _heat(sc, world) {
        const cfg = this.config();
        let towns = 0;
        for (const key of sc.spreadTo) {
            const [q, r] = key.split(',').map(Number);
            const s = this._settlementAt(world, q, r);
            towns += s && s.kingdom === sc.kingdomId ? 1 : cfg.foreignHeat;
        }
        const age = _day(world) - sc.born;
        const half = (sc.ends - sc.born) / 2;
        const cool = Math.max(0, age - half) * cfg.coolPerDay;
        return Math.round(Utils.clamp(towns * cfg.heatPerTown + _num(sc.extra) - cool, 0, 100));
    },

    /** Each realm's stability drag from the live tales about its ruler (kingdom.scandal.stab). */
    _applyStability(player, world) {
        const cfg = this.config();
        const drag = new Map();
        for (const sc of this.live(player)) {
            if (sc.subject.type !== 'ruler') continue;
            const sev = _num((this.kinds()[sc.kind] || {}).severity) || 1;
            drag.set(sc.kingdomId, (drag.get(sc.kingdomId) || 0) + (sc.heat / 100) * cfg.stabilityAtFullHeat * sev);
        }
        for (const k of world.kingdoms || []) {
            const d = drag.get(k.id) || 0;
            if (d > 0) k.scandal = { stab: -Math.round(Math.min(cfg.maxStability, d) * 10) / 10 };
            else if (k.scandal) delete k.scandal;
        }
    },

    // ──────────── DAILY TICK ────────────

    _dayRng(world) {
        return Utils.seededRandom((_hash(`${_seed(world)}:whispers:${_day(world)}`) % 233279) + 1);
    },

    /**
     * One day: a tale may hatch, every live tale spreads, heats or cools, may
     * be traced to the player, may end; the player hears the tales where they
     * are. Returns { notices }.
     */
    processDay(world, player) {
        const out = { notices: [] };
        if (!world || !player || !Array.isArray(world.kingdoms)) return out;
        Utils.withRng(this._dayRng(world), () => this._tick(world, player, out));
        return out;
    },

    _tick(world, player, out) {
        const st = this.state(player);
        const cfg = this.config();
        const day = _day(world);

        if (st.nextHatch == null) st.nextHatch = Math.max(day, cfg.firstDay) + Utils.randInt(0, cfg.hatchEvery[0]);
        if (day >= st.nextHatch) {
            if (this.live(player).length < cfg.maxLive) this._hatch(player, world);
            st.nextHatch = day + Utils.randInt(cfg.hatchEvery[0], cfg.hatchEvery[1]);
        }

        const here = this._settlementAt(world, player.q, player.r);
        const hereKey = here ? _key(here.q, here.r) : null;
        for (const sc of this.live(player)) {
            for (let i = 0; i < cfg.spreadPerDay; i++) this._spread(sc, world);
            sc.heat = this._heat(sc, world);

            // A lie the player planted can be traced back to them (the likelier for their own fanning of it)
            if (sc.planted && !sc.traced) {
                const p = cfg.plant.traceChancePerDay * (sc.truth ? cfg.plant.traceTrueFactor : 1) * (1 + sc.heat / 100) * (sc.fannedByPlayer ? 1 + _num(cfg.fan.traceBonus) : 1);
                if (Utils.random() < p) this._trace(player, world, sc, out);
            }

            // A lie of the player's making kept hot long enough: it hardens into accepted truth, or is debunked
            if (sc.state === 'live' && !sc.truth && (sc.planted || sc.fannedByPlayer)) {
                sc.hotDays = sc.heat >= cfg.provenHeat ? _num(sc.hotDays) + 1 : 0;
                if (sc.hotDays >= cfg.harden.days) {
                    if (Utils.random() < this.hardenChance(world, player, sc)) {
                        sc.hardened = true;
                        st.stats.hardened++;
                        this._resolve(player, world, sc, 'proven', out);
                    } else {
                        this._resolve(player, world, sc, 'debunked', out);
                    }
                }
            }

            if (hereKey && !sc.known && sc.spreadTo.includes(hereKey)) {
                sc.known = true;
                out.notices.push({ icon: (this.kinds()[sc.kind] || {}).icon || '🗣️', title: `Whispers in ${here.name}`, text: `"${this.text(sc)}"`, type: 'info' });
            }
            if (sc.state === 'live' && day >= sc.ends) this._resolve(player, world, sc, null, out);
        }
        this._prune(st);
        this._applyStability(player, world);
    },

    /**
     * The chance a lie kept hot hardens into accepted truth at its reckoning
     * (else it is debunked): more of the subject's own towns telling it, a
     * shakier crown or a lesser name make it likelier.
     */
    hardenChance(world, player, sc) {
        const H = this.config().harden;
        let own = 0;
        for (const key of sc.spreadTo) {
            const [q, r] = key.split(',').map(Number);
            const s = this._settlementAt(world, q, r);
            if (s && s.kingdom === sc.kingdomId) own++;
        }
        let standing = 0;
        if (sc.subject.type === 'ruler') {
            const k = this._kingdom(world, sc.kingdomId);
            standing = k ? (_num(k.stability) - 50) / 100 : 0;
        } else {
            const rv = this._rival(player, sc.subject.rivalId);
            standing = rv ? Utils.clamp((_num(rv.renown) - 50) / 100, -0.5, 0.5) : 0;
        }
        return Utils.clamp(_num(H.base) + _num(H.perTown) * own - _num(H.standing) * standing, _num(H.min), _num(H.max));
    },

    /** Move finished tales to the record. */
    _prune(st) {
        const cfg = this.config();
        const done = st.scandals.filter(s => s.state !== 'live');
        if (!done.length) return;
        st.scandals = st.scandals.filter(s => s.state === 'live');
        st.resolved.unshift(...done.map(s => ({ id: s.id, kind: s.kind, subject: s.subject, kingdomId: s.kingdomId, kingdomName: s.kingdomName, place: s.place, enemy: s.enemy, truth: s.truth, fallout: s.fallout || null, state: s.state, day: s.endedDay, planted: s.planted, traced: s.traced, known: s.known, fanned: !!s.fannedByPlayer, hardened: !!s.hardened })));
        if (st.resolved.length > cfg.maxResolved) st.resolved.length = cfg.maxResolved;
    },

    /**
     * End a tale. outcome: 'proven' | 'debunked' | 'faded' | 'buried', or null
     * to let heat and truth decide.
     */
    _resolve(player, world, sc, outcome, out) {
        const cfg = this.config();
        if (!outcome) {
            if (sc.truth && sc.heat >= cfg.provenHeat) outcome = 'proven';
            else if (!sc.truth && (sc.heat >= cfg.provenHeat * 0.6 || sc.quashed)) outcome = 'debunked';
            else outcome = 'faded';
        }
        sc.state = outcome;
        sc.endedDay = _day(world);
        if (outcome === 'debunked' && (sc.planted || sc.fannedByPlayer)) this.state(player).stats.debunked++;
        const k = this._kingdom(world, sc.kingdomId);
        if (sc.subject.type === 'ruler' && k) {
            if (outcome === 'proven') k.stability = Utils.clamp(_num(k.stability) - cfg.provenShock, 0, 100);
            if (outcome === 'debunked') k.stability = Utils.clamp(_num(k.stability) + cfg.vindicated, 0, 100);
        }
        // Each kind of tale has its own fallout (data/gossip.json scandals.kinds.*.fallout)
        if (sc.subject.type === 'ruler' && k && (outcome === 'proven' || outcome === 'debunked')) {
            sc.fallout = this.applyFallout(world, sc, outcome);
        }
        const rv = sc.subject.type === 'rival' ? this._rival(player, sc.subject.rivalId) : null;
        if (rv && outcome === 'proven') rv.renown = Math.max(0, _num(rv.renown) - cfg.rival.renownProven);

        // A lie of the player's debunked: someone asks who started it (or who paid to keep it going)
        if (outcome === 'debunked' && (sc.planted || sc.fannedByPlayer) && !sc.traced) {
            const p = (sc.planted ? 0.5 : 0) + (sc.fannedByPlayer ? _num(cfg.fan.traceOnDebunk) : 0);
            if (Utils.random() < p) this._trace(player, world, sc, out);
        }

        const inRealm = player.q != null && (this._settlementAt(world, player.q, player.r) || {}).kingdom === sc.kingdomId;
        if (out && (sc.known || inRealm) && outcome !== 'faded' && outcome !== 'buried') {
            const icon = outcome === 'proven' ? '🔥' : '🕊️';
            const fx = this.falloutText(sc.fallout);
            out.notices.push({ icon, title: outcome === 'proven' ? 'A Scandal Proven' : 'A Tale Debunked', text: this.text(sc, outcome) + (fx ? ` (${sc.kingdomName}: ${fx})` : ''), type: outcome === 'proven' ? 'warning' : 'info' });
        }
        return outcome;
    },

    /**
     * What a ruler's tale does to the realm when it is proven or debunked,
     * beyond the stability shock every tale carries — data-driven per kind
     * (scandals.kinds.<kind>.fallout.<outcome>):
     *   stability       — kingdom.stability (more)
     *   unity / piety   — kingdom.religion.unity / .piety (a heresy)
     *   treasuryPct     — share of the treasury lost (the lenders call in a debtor king's loans)
     *   enemyRelations  — the realm and the named enemy (a secret pact) both ways
     *   advisorLoyalty  — every royal advisor's loyalty (madness, a bastard heir: the council worries
     *                     about the succession; under 30 an advisor drags the realm, characters/generation.js)
     * Returns [{ label, value }] for the record (and the notice). Pure of RNG.
     */
    applyFallout(world, sc, outcome) {
        const kind = this.kinds()[sc.kind] || {};
        const f = kind.fallout && kind.fallout[outcome];
        const k = this._kingdom(world, sc.kingdomId);
        const notes = [];
        if (!f || !k) return notes;
        const add = (label, value) => { if (value) notes.push({ label, value: Math.round(value) }); };
        if (_num(f.stability)) {
            k.stability = Utils.clamp(_num(k.stability) + _num(f.stability), 0, 100);
            add('stability', f.stability);
        }
        const rel = k.religion;
        if (rel && typeof rel.unity === 'number' && _num(f.unity)) {
            rel.unity = Utils.clamp(rel.unity + _num(f.unity), 0, 100);
            add('faith unity', f.unity);
        }
        if (rel && typeof rel.piety === 'number' && _num(f.piety)) {
            rel.piety = Utils.clamp(rel.piety + _num(f.piety), 0, 100);
            add('piety', f.piety);
        }
        if (_num(f.treasuryPct) && _num(k.treasury) > 0) {
            const delta = Math.round(_num(k.treasury) * _num(f.treasuryPct));
            k.treasury = Math.max(0, _num(k.treasury) + delta);
            add('treasury', delta);
        }
        if (_num(f.enemyRelations)) {
            let enemy = sc.enemyId != null ? this._kingdom(world, sc.enemyId) : null;
            if (!enemy && sc.enemy) enemy = (world.kingdoms || []).find(x => x && x.name === sc.enemy) || null;
            if (enemy && enemy !== k) {
                if (!k.relations) k.relations = {};
                if (!enemy.relations) enemy.relations = {};
                k.relations[enemy.id] = Utils.clamp(_num(k.relations[enemy.id]) + _num(f.enemyRelations), -100, 100);
                enemy.relations[k.id] = Utils.clamp(_num(enemy.relations[k.id]) + _num(f.enemyRelations), -100, 100);
                add(`relations with ${enemy.name}`, f.enemyRelations);
            }
        }
        const advisors = k.characterData && k.characterData.advisors;
        if (advisors && _num(f.advisorLoyalty)) {
            for (const a of Object.values(advisors)) {
                if (a && typeof a.loyalty === 'number') a.loyalty = Utils.clamp(a.loyalty + _num(f.advisorLoyalty), 0, 100);
            }
            add("the council's loyalty", f.advisorLoyalty);
        }
        return notes;
    },

    /** "faith unity −15, treasury −120" for a notice. */
    falloutText(notes) {
        if (!notes || !notes.length) return '';
        return notes.map(n => `${n.label} ${n.value > 0 ? '+' : '−'}${Math.abs(n.value)}`).join(', ');
    },

    /** The player's hand in a lie comes out. */
    _trace(player, world, sc, out) {
        const cfg = this.config();
        const st = this.state(player);
        sc.traced = true;
        st.stats.traced++;
        const origin = sc.originKey.split(',').map(Number);
        Gossip.accuse(player, world, 'whisperer', { q: origin[0], r: origin[1], victim: sc.subject.name, credibility: sc.truth ? 0.6 : 0.9 });
        if (!player.reputation) player.reputation = {};
        const rep = sc.truth ? Math.round(cfg.plant.rep / 3) : cfg.plant.rep;
        player.reputation[sc.kingdomId] = _num(player.reputation[sc.kingdomId]) + rep;
        const rv = sc.subject.type === 'rival' ? this._rival(player, sc.subject.rivalId) : null;
        if (rv) Rivals.remember(rv, world, sc.truth ? 'spread an ugly truth about me' : 'spread lies about me', cfg.rival.attitudeIfTraced);
        // A ruler whose name you dragged through the taverns swears it on his heirs (world/npcLords.js vendetta)
        if (sc.subject.type === 'ruler') NPCLords.rememberRealm(world, sc.kingdomId, 'scandal_traced', { note: this.kinds()[sc.kind] ? this.kinds()[sc.kind].name || sc.kind : sc.kind });
        if (!sc.truth && sc.state === 'live') this._resolve(player, world, sc, 'debunked', null);
        if (out) {
            const how = sc.planted ? 'has been traced back to you' : 'was kept alive by your coin, and folk know it';
            out.notices.push({ icon: '🐍', title: 'Your Whisper Traced', text: `The tale about ${sc.subject.name} ${how}.${sc.truth ? ' It was true, at least.' : ' Now they talk about you instead.'}`, type: 'error' });
        }
    },

    // ──────────── WHAT THE PLAYER HEARS ────────────

    /** Live tales told at (q, r) — a pure read (chatter, the LLM voice). */
    talkAt(player, q, r) {
        if (!player || !player.whispers || q == null) return [];
        const key = _key(q, r);
        return this.live(player).filter(s => s.spreadTo.includes(key));
    },

    /** Live tales told at (q, r), now heard by the player (the tavern). */
    listenAt(player, q, r) {
        const list = this.talkAt(player, q, r);
        for (const s of list) s.known = true;
        return list;
    },

    /** What the player can see of a tale: its text, heat, and what they can do with it here. */
    view(player, world, sc, q, r) {
        const cfg = this.config();
        const kind = this.kinds()[sc.kind] || {};
        const here = this._settlementAt(world, q, r);
        const inRealm = !!here && here.kingdom === sc.kingdomId;
        const told = !!here && sc.spreadTo.includes(_key(q, r));
        const gold = _num(player.gold);
        const ruler = sc.subject.type === 'ruler';
        const k = this._kingdom(world, sc.kingdomId);
        const buyers = ruler ? this._enemies(world, k) : [];
        return {
            id: sc.id,
            icon: kind.icon || '🗣️',
            label: kind.label || sc.kind,
            subject: sc.subject.name,
            subjectType: sc.subject.type,
            kingdomName: sc.kingdomName,
            text: this.text(sc),
            heat: sc.heat,
            towns: sc.spreadTo.length,
            daysLeft: Math.max(0, sc.ends - _day(world)),
            planted: sc.planted,
            fanned: !!sc.fannedByPlayer,
            hotDays: _num(sc.hotDays),
            hardenDays: cfg.harden.days,
            truthKnown: sc.truthKnown,
            truth: sc.truthKnown ? sc.truth : null,
            can: {
                fan: told && gold >= cfg.fan.cost,
                quash: inRealm && gold >= cfg.quash.cost,
                dig: told && !sc.truthKnown && sc.dugDay !== _day(world) && gold >= cfg.dig.cost,
                blackmail: ruler && inRealm && sc.truthKnown && sc.truth,
                sell: ruler && sc.truthKnown && sc.truth && buyers.length > 0,
            },
            buyers: buyers.map(b => ({ id: b.id, name: b.name })),
            costs: { fan: cfg.fan.cost, quash: cfg.quash.cost, dig: cfg.dig.cost },
            blackmailGold: cfg.blackmail.base + cfg.blackmail.perHeat * sc.heat,
            sellGold: cfg.sell.base + cfg.sell.perHeat * sc.heat,
        };
    },

    /** The player's whispering tallies: { planted, traced, blackmailed, sold, fanned, quashed, hardened, debunked }. */
    stats(player) {
        return { ...this.state(player).stats };
    },

    /** Finished tales the player knew of, newest first. */
    record(player, limit = 8) {
        return this.state(player).resolved.filter(s => s.known || s.planted).slice(0, limit).map(s => ({
            ...s,
            icon: (this.kinds()[s.kind] || {}).icon || '🗣️',
            text: s.state === 'proven' || s.state === 'debunked' ? this.text(s, s.state) : `The talk of ${s.subject.name} ${s.state === 'buried' ? 'was bought silent' : 'died away'}.`,
        }));
    },

    // ──────────── THE PLAYER'S HAND ────────────

    _live(player, id) {
        const sc = this.get(player, id);
        return sc && sc.state === 'live' ? sc : null;
    },

    /** Pay for the telling: hotter and further. The subject's enemies approve, if no one sees who paid. */
    fan(player, world, id, q, r) {
        const cfg = this.config();
        const sc = this._live(player, id);
        if (!sc) return { ok: false, reason: 'That talk has run its course.' };
        if (!sc.spreadTo.includes(_key(q, r))) return { ok: false, reason: 'Nobody here is telling that tale.' };
        if (_num(player.gold) < cfg.fan.cost) return { ok: false, reason: `You need ${cfg.fan.cost} gold for the rounds.` };
        player.gold -= cfg.fan.cost;
        sc.extra = _num(sc.extra) + cfg.fan.heat;
        sc.fannedByPlayer = true;
        for (let i = 0; i < cfg.fan.spreads; i++) this._spread(sc, world);
        sc.heat = this._heat(sc, world);
        this.state(player).stats.fanned++;
        if (!player.reputation) player.reputation = {};
        const k = this._kingdom(world, sc.kingdomId);
        const pleased = sc.subject.type === 'ruler' ? this._enemies(world, k) : [];
        for (const e of pleased) player.reputation[e.id] = _num(player.reputation[e.id]) + cfg.fan.enemyRep;
        let text = `You stand rounds and tell it well. The tale of ${sc.subject.name} runs hotter (heat ${sc.heat}).`;
        if (pleased.length) text += ` ${pleased.map(e => e.name).join(' and ')} will hear who kept it alive.`;
        if (Utils.random() < cfg.fan.traceChance) {
            player.reputation[sc.kingdomId] = _num(player.reputation[sc.kingdomId]) - 8;
            text += ` But someone in ${sc.kingdomName}'s pay was listening, and marked your face.`;
            return { ok: true, text, noticed: true };
        }
        return { ok: true, text };
    },

    /** In the subject's realm: pay to cool a tale. The crown (or the rival) is grateful. */
    quash(player, world, id, q, r) {
        const cfg = this.config();
        const sc = this._live(player, id);
        if (!sc) return { ok: false, reason: 'That talk has run its course.' };
        const here = this._settlementAt(world, q, r);
        if (!here || here.kingdom !== sc.kingdomId) return { ok: false, reason: `Only in ${sc.kingdomName} can you buy that silence.` };
        if (_num(player.gold) < cfg.quash.cost) return { ok: false, reason: `You need ${cfg.quash.cost} gold for the right palms.` };
        player.gold -= cfg.quash.cost;
        sc.extra = _num(sc.extra) - cfg.quash.heat;
        sc.quashed = true;
        sc.heat = this._heat(sc, world);
        this.state(player).stats.quashed++;
        if (!player.reputation) player.reputation = {};
        if (sc.subject.type === 'ruler') {
            player.reputation[sc.kingdomId] = _num(player.reputation[sc.kingdomId]) + cfg.quash.rep;
            return { ok: true, text: `A word with the right people, coin in the right hands. The talk of ${sc.subject.name} cools (heat ${sc.heat}), and the court of ${sc.kingdomName} notices who helped.` };
        }
        const rv = this._rival(player, sc.subject.rivalId);
        if (rv) Rivals.remember(rv, world, 'spoke up for me when the tavern talk turned', 10);
        return { ok: true, text: `You speak up for ${sc.subject.name} and pay to have it said again. The talk cools (heat ${sc.heat}).` };
    },

    /** Pay for the truth of a tale. Wits or charm decide it; once a day per tale. */
    dig(player, world, id) {
        const cfg = this.config();
        const sc = this._live(player, id);
        if (!sc) return { ok: false, reason: 'That talk has run its course.' };
        if (sc.truthKnown) return { ok: false, reason: 'You already know the truth of it.' };
        if (sc.dugDay === _day(world)) return { ok: false, reason: 'You have asked all the questions you can today.' };
        if (_num(player.gold) < cfg.dig.cost) return { ok: false, reason: `You need ${cfg.dig.cost} gold to loosen tongues.` };
        player.gold -= cfg.dig.cost;
        sc.dugDay = _day(world);
        const stat = Math.max(_num(player.intelligence) || 5, _num(player.charisma) || 5);
        const chance = Utils.clamp(cfg.dig.base + stat * cfg.dig.perStat, 0.05, 0.95);
        if (Utils.random() >= chance) return { ok: true, found: false, text: 'Drinks, coin and questions. Everyone has heard it; nobody knows anything.' };
        sc.truthKnown = true;
        return { ok: true, found: true, truth: sc.truth, text: sc.truth ? `You find the one who knows, and pay for the rest. It's true: ${sc.subject.name} has something to hide.` : `You trace it to a drunk and a grudge. The tale of ${sc.subject.name} is a lie.` };
    },

    /** A confidant tells the player the truth of a tale (systems/relationships/matters.js). */
    reveal(player, id) {
        const sc = this.get(player, id);
        if (!sc) return null;
        sc.known = true;
        sc.truthKnown = true;
        return sc;
    },

    /** A live tale in a realm whose truth the player doesn't know — what a well-placed friend might tell. */
    secretIn(player, kingdomId) {
        return this.live(player).find(s => s.kingdomId === kingdomId && !s.truthKnown) || null;
    },

    /** A true tale, known to be true: the ruler pays to bury it, or calls the guard. */
    blackmail(player, world, id, q, r) {
        const cfg = this.config();
        const sc = this._live(player, id);
        if (!sc || sc.subject.type !== 'ruler') return { ok: false, reason: 'There is nothing to sell here.' };
        if (!sc.truthKnown || !sc.truth) return { ok: false, reason: 'You would need to know it is true.' };
        const here = this._settlementAt(world, q, r);
        if (!here || here.kingdom !== sc.kingdomId) return { ok: false, reason: `You would have to be in ${sc.kingdomName} to send that letter.` };
        const k = this._kingdom(world, sc.kingdomId);
        if (!player.reputation) player.reputation = {};
        const proud = this._traitIds(k).some(t => cfg.blackmail.refuseTraits.includes(t));
        if (proud && Utils.random() < cfg.blackmail.refuseChance) {
            Gossip.accuse(player, world, 'blackmailer', { q, r, victim: sc.subject.name, credibility: 0.9 });
            sc.extra = _num(sc.extra) + 20; // ...and now everyone wants to know what you had on them
            sc.heat = this._heat(sc, world);
            return { ok: true, refused: true, text: `${sc.subject.name} reads your letter, laughs, and hands it to the captain of the guard. Now you are the scandal.` };
        }
        const gold = cfg.blackmail.base + cfg.blackmail.perHeat * sc.heat;
        player.gold = _num(player.gold) + gold;
        player.reputation[sc.kingdomId] = _num(player.reputation[sc.kingdomId]) + cfg.blackmail.rep;
        this.state(player).stats.blackmailed++;
        this._resolve(player, world, sc, 'buried', null);
        this._prune(this.state(player));
        this._applyStability(player, world);
        return { ok: true, gold, text: `A purse of ${gold} gold arrives with no letter, and the talk of ${sc.subject.name} dies overnight. The court of ${sc.kingdomName} will not forget whose silence it bought.` };
    },

    /** Sell a known-true tale to a crown at war with the subject: gold, their favour, and the tale proven. */
    sell(player, world, id, buyerId) {
        const cfg = this.config();
        const sc = this._live(player, id);
        if (!sc || sc.subject.type !== 'ruler') return { ok: false, reason: 'No crown would pay for that.' };
        if (!sc.truthKnown || !sc.truth) return { ok: false, reason: 'You would need proof it is true.' };
        const k = this._kingdom(world, sc.kingdomId);
        const buyer = this._enemies(world, k).find(e => e.id === buyerId);
        if (!buyer) return { ok: false, reason: `${(this._kingdom(world, buyerId) || {}).name || 'That crown'} has no quarrel worth paying for.` };
        const gold = cfg.sell.base + cfg.sell.perHeat * sc.heat;
        player.gold = _num(player.gold) + gold;
        if (!player.reputation) player.reputation = {};
        player.reputation[buyer.id] = _num(player.reputation[buyer.id]) + cfg.sell.rep;
        player.reputation[sc.kingdomId] = _num(player.reputation[sc.kingdomId]) - 10;
        this.state(player).stats.sold++;
        this._resolve(player, world, sc, 'proven', null);
        this._prune(this.state(player));
        this._applyStability(player, world);
        return { ok: true, gold, text: `${buyer.name}'s heralds cry your proof in every square. ${this.text(sc, 'proven')} (+${gold} gold)` };
    },

    /** Who the player can start a tale about: every living ruler, and the rival adventurers they have met. */
    plantTargets(player, world) {
        const out = [];
        const towns = this._byRealm(world);
        for (const k of world.kingdoms || []) {
            if (k.isAlive === false || !(towns.get(k.id) || []).length) continue;
            const kinds = this.kindsFor('ruler', world, k);
            if (kinds.length) out.push({ subjectType: 'ruler', kingdomId: k.id, name: k.ruler || `the ruler of ${Names.realm(k.name)}`, realm: k.name, kinds });
        }
        for (const rv of (player.rivals && player.rivals.list) || []) {
            if (!rv || rv.dead || !rv.met) continue;
            out.push({ subjectType: 'rival', rivalId: rv.id, name: rv.name, realm: null, kinds: this.kindsFor('rival', world, null) });
        }
        return out;
    },

    /**
     * Start a tale of the player's own at (q, r). It may be true without their
     * knowing; a lie can be traced back.
     * @param {Object} target - { subjectType, kingdomId | rivalId, kind }
     */
    plant(player, world, target, q, r) {
        const cfg = this.config();
        const here = this._settlementAt(world, q, r);
        if (!here) return { ok: false, reason: 'You need a crowd to start a tale.' };
        if (_num(player.gold) < cfg.plant.cost) return { ok: false, reason: `You need ${cfg.plant.cost} gold to set tongues wagging.` };
        let subject;
        if (target.subjectType === 'rival') {
            const rv = this._rival(player, target.rivalId);
            if (!rv || rv.dead) return { ok: false, reason: 'No one by that name.' };
            subject = { type: 'rival', rivalId: rv.id, name: rv.name, kingdomId: here.kingdom };
        } else {
            const k = this._kingdom(world, target.kingdomId);
            if (!k || k.isAlive === false) return { ok: false, reason: 'No such crown.' };
            subject = { type: 'ruler', kingdomId: k.id, name: k.ruler || `the ruler of ${Names.realm(k.name)}` };
        }
        const k = this._kingdom(world, subject.kingdomId);
        if (!this.kindsFor(subject.type, world, k).includes(target.kind)) return { ok: false, reason: 'Nobody would believe that of them.' };
        if (this.live(player).some(s => s.subject.type === subject.type && (subject.type === 'ruler' ? s.kingdomId === subject.kingdomId : s.subject.rivalId === subject.rivalId))) {
            return { ok: false, reason: `There is already a tale about ${subject.name} going round. Work that one.` };
        }
        player.gold -= cfg.plant.cost;
        const sc = this._create(player, world, subject, target.kind, here, { planted: true, known: true, extra: cfg.plant.heat });
        this.state(player).stats.planted++;
        return { ok: true, scandal: sc, text: `You buy a round, lower your voice, and tell them: "${this.text(sc)}" By morning it's all over ${here.name}.` };
    },

    /** Pay a bard to sing down a crime rumour about the player in this town. */
    singDown(player, world, rumorId, q, r) {
        const cfg = this.config();
        if (_num(player.gold) < cfg.bard.cost) return { ok: false, reason: `The bard wants ${cfg.bard.cost} gold.` };
        if (!Gossip.refute(player, rumorId, _key(q, r))) return { ok: false, reason: 'There is no such talk here to sing down.' };
        player.gold -= cfg.bard.cost;
        return { ok: true, text: 'The bard takes your coin and a fresh cup, and by the third verse the whole room agrees you were wronged. The song will travel.' };
    },
};
