// ============================================
// TOWN WORLD — what the realm's great affairs look like in one town's streets
// ============================================
// The world's big systems reach the player as panels and notices; this reads
// them for one town and says what its streets should show (ui/innerMapTownWorld.js
// walks and draws it). Nothing here is saved: every answer is derived from the
// state the systems already keep, so a load shows the same town.
//
//   WHO RULES  the realm's banner at the gates and the seat; a union's junior
//              realm flies both crowns' (systems/realmUnions.js); a town taken
//              from another crown within conquered.days (world/revanche.js
//              kingdom.lostTowns) has the new crown's garrison at its gates and
//              its people grumbling of the old.
//   WAR        the realm at war (kingdom.wars): soldiers billeted, drilling on
//              the square at the drill hours (drillBeat keeps their time); a
//              host gathering here — a war host of the realm on or beside the
//              town (systems/realmWars.js world units), the realm's muster town
//              against its foe (its town nearest its front against the foe,
//              else nearest the foe's seat), or a holy war's muster
//              (HolyWars.musterOf) — pitches its tents outside the walls; a
//              besieged town (systems/holdingSieges.js, a commission's siege,
//              a foe's war host before it, or the front of a war between
//              crowns laid to its walls: world/kingdomAI.js noteFront — one
//              only threatening it is `threat`) sees the siege lines' fires and
//              fewer people out; a town by the front (a foe's land within
//              frontHexes, or a fresh battle cairn: world/townMarks.js) has
//              wounded at the temple.
//   THE CROSS  an open call to a holy war of the realm's see: a preacher in the
//              square; crusaders passing through on their way to the muster;
//              an inquisitor sitting a hearing here (systems/inquisition.js)
//              stands in the square with his clerks.
//   HARD TIMES famine (the 'famine' world event on the realm, or the age's
//              famine over the town's region: systems/crises.js) empties
//              stalls, thins the crowd and brings beggars out, a bread line
//              to the barred bakery and empty baskets to the square (in every
//              era, stalls or none); a realm under
//              the Church's ban has its temple doors shut.
//   NEWS       the proclamations that have reached the town in the last days
//              (systems/heralds.js heardAt), for the crier to cry.
//
// Pure: no randomness (counts and picks are hashes), no globals; the world,
// the player and the day come in as parameters. Data: data/townWorld.json.

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Harvests } from '../world/harvests.js';
import { TownMarks } from '../world/townMarks.js';
import { HolyWars } from './holyWars.js';
import { Inquisition } from './inquisition.js';
import { RealmUnions } from './realmUnions.js';
import { HoldingSieges } from './holdingSieges.js';
import { Heralds } from './heralds.js';
import { Crises } from './crises.js';
import { KingdomAI } from '../world/kingdomAI.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _arr = v => (Array.isArray(v) ? v : []);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

const DEFAULTS = {
    enabled: true,
    war: { billet: { village: 2, town: 4, city: 6, capital: 8 }, drill: [[7, 9], [15, 17]], musterTents: 6, musterMen: 6, frontHexes: 5, woundedDays: 40, wounded: { village: 2, town: 3, city: 4, capital: 4 }, siegeFires: 6, stay: { siege: 0.55, threat: 0.2, war: 0.08 },
        train: { every: 80, firstAfter: 6, wagons: 3, gap: 7, unloadSecs: 32, hours: [6, 19], haulers: 2 },
        drillBeat: { cycle: 6.4, thrust: 1.2, recover: 2.1, step: 3.8, stepLen: 0.9 } },
    holy: { crusaders: 3, musterCrusaders: 5, routeHexes: 8, preachHours: [8, 18], surcoat: 'White', cross: '#b3262e' },
    conquered: { days: 360, garrison: { village: 2, town: 3, city: 4, capital: 5 } },
    famine: { beggars: { village: 1, town: 2, city: 3, capital: 3 }, stalls: 0.6, stay: 0.3, breadLine: { village: 3, town: 4, city: 6, capital: 6 }, baskets: { village: 2, town: 3, city: 5, capital: 5 } },
    news: { days: 6, max: 4 },
    grumble: { every: [14, 24], radius: 9, perVisit: 8 },
    approach: { chance: 0.55, afterSecs: 12, letterDays: 3, waitSecs: 45, beggarGold: 30 },
    names: {},
    lines: {},
};

/** A hash of the parts → [0, 1). */
export function townHash(...parts) {
    let h = 2166136261 >>> 0;
    for (const p of parts) {
        const s = String(p);
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
        h ^= 0x3b; h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
}

function _kingdom(world, id) {
    if (id == null || !world) return null;
    if (typeof world.getKingdom === 'function') { const k = world.getKingdom(id); if (k) return k; }
    return _arr(world.kingdoms).find(k => k && String(k.id) === String(id)) || null;
}

const _alive = k => !!(k && k.isAlive !== false);

function _views(world) {
    return world && typeof world.getSettlementViews === 'function' ? (world.getSettlementViews() || []) : [];
}

function _dist(world, a, b) {
    if (!a || !b || !Number.isFinite(a.q) || !Number.isFinite(b.q)) return Infinity;
    return Hex.wrappingOffsetDistance(a.q, a.r, b.q, b.r, (world && world.width) || 0);
}

function _bySize(table, type) {
    const t = _obj(table) || {};
    return _num(t[type], _num(t.town, 0));
}

export const TownWorld = {

    config() {
        const d = (DataLoader._gamedata && DataLoader._gamedata.townWorld) || {};
        const out = { ...DEFAULTS, ...d };
        for (const k of ['war', 'holy', 'conquered', 'famine', 'news', 'grumble', 'approach', 'names', 'lines']) out[k] = { ...DEFAULTS[k], ...(_obj(d[k]) || {}) };
        out.war.stay = { ...DEFAULTS.war.stay, ...(_obj(out.war.stay) || {}) };
        out.war.train = { ...DEFAULTS.war.train, ...(_obj(out.war.train) || {}) };
        out.war.drillBeat = { ...DEFAULTS.war.drillBeat, ...(_obj(out.war.drillBeat) || {}) };
        return out;
    },

    /** A line of the pool `key`, picked by a hash of `seed`, {tokens} filled. */
    line(key, seed, tokens = {}) {
        const pool = _arr(TownWorld.config().lines[key]);
        if (!pool.length) return '';
        const raw = pool[Math.floor(townHash(key, seed) * pool.length) % pool.length];
        return String(raw).replace(/\{(\w+)\}/g, (m, k) => (tokens[k] != null ? tokens[k] : m));
    },

    /** A figure's name from data names.{kind}, tokens filled. */
    name(kind, tokens = {}) {
        const raw = TownWorld.config().names[kind] || kind;
        return String(raw).replace(/\{(\w+)\}/g, (m, k) => (tokens[k] != null ? tokens[k] : m));
    },

    /** Is the hour within any of the [from, to) spans? */
    inHours(h, spans) {
        const list = Array.isArray(spans) && Array.isArray(spans[0]) ? spans : [spans];
        return list.some(s => Array.isArray(s) && h >= s[0] && h < s[1]);
    },

    // ──────────── READERS ────────────

    /** The banners the town flies: [{ kingdomId, name, color, role }] (its own crown first). */
    crowns(world, k) {
        if (!_alive(k)) return [];
        const out = [{ kingdomId: k.id, name: k.name, color: k.color || '#8a2a2a', role: 'own' }];
        const u = RealmUnions.unionOf(world, k);
        if (u && u.junior === k && _alive(u.senior)) out.push({ kingdomId: u.senior.id, name: u.senior.name, color: u.senior.color || '#2a4a8a', role: 'senior' });
        return out;
    },

    /** The realm's foes in war, alive: [kingdom]. */
    foes(world, k) {
        return _arr(k && k.wars).map(id => _kingdom(world, id)).filter(_alive);
    },

    /**
     * The realm's town nearest its front against the foe (KingdomAI.frontOf: the
     * foe's town its battles threaten), else nearest the foe's seat — where its
     * host gathers against that foe — or null.
     */
    musterTown(world, k, foe) {
        if (!k || !foe) return null;
        const goal = KingdomAI.frontOf(k, foe.id, world) || foe.capital || _views(world).find(s => s && s.kingdom === foe.id) || null;
        if (!goal) return null;
        let best = null, bd = Infinity;
        for (const s of _views(world)) {
            if (!s || s.kingdom !== k.id || !Number.isFinite(s.q)) continue;
            const d = _dist(world, s, goal);
            if (d < bd || (d === bd && best && (s.q * 1000 + s.r) < (best.q * 1000 + best.r))) { bd = d; best = s; }
        }
        return best;
    },

    /**
     * A war between crowns with no host on the map (KingdomAI's battles) fought
     * at this town: { kingdomId, name, since, siege } of the crown whose warm
     * front (KingdomAI.frontOf) it is — a siege before a threat — or null.
     */
    aiFront(world, s) {
        let best = null;
        for (const a of _arr(world && world.kingdoms)) {
            if (!_alive(a) || !a.warState || typeof a.warState !== 'object') continue;
            for (const id of _arr(a.wars)) {
                const f = KingdomAI.frontOf(a, id, world);
                if (!f || f.q !== s.q || f.r !== s.r) continue;
                if (!best || (f.siege && !best.siege) || (!!f.siege === best.siege && _num(f.since) < best.since)) best = { kingdomId: a.id, name: a.name, since: _num(f.since), siege: !!f.siege };
            }
        }
        return best;
    },

    /** Who besieges the town: { kingdomId, name, source } or null. */
    siegeOf(world, player, s, k) {
        const hs = player ? HoldingSieges.at(player, s.q, s.r) : null;
        if (hs) return { kingdomId: hs.kingdomId, name: hs.kingdomName || (_kingdom(world, hs.kingdomId) || {}).name || 'the enemy', source: 'holding' };
        const c = player && _obj(player.commission);
        if (c && c.siege && c.siege.q === s.q && c.siege.r === s.r) {
            const liege = _kingdom(world, c.kingdomId);
            return { kingdomId: c.kingdomId, name: liege ? liege.name : 'your liege', source: 'commission' };
        }
        // A foe's war host camped on or beside the town
        const foes = new Set(_arr(k && k.wars).map(String));
        for (const u of _arr(world && world.units)) {
            if (!u || u.type !== 'war_host' || u.kingdomId == null || u.isDead) continue;
            if (_dist(world, u, s) > 1) continue;
            const besieging = u.besieging && u.besieging.q === s.q && u.besieging.r === s.r;
            if (besieging || (k && foes.has(String(u.kingdomId)))) {
                const fk = _kingdom(world, u.kingdomId);
                return { kingdomId: u.kingdomId, name: fk ? fk.name : 'the enemy', source: 'host' };
            }
        }
        // A war of crowns fought in KingdomAI's battles: its front at the walls
        const f = TownWorld.aiFront(world, s);
        if (f && f.siege) return { kingdomId: f.kingdomId, name: f.name, source: 'front', since: f.since };
        return null;
    },

    /** Does a foe's land come within `hexes` of the town? */
    nearFoe(world, s, foes, hexes) {
        if (!foes.length || !world || typeof world.getTile !== 'function' || !(hexes > 0)) return false;
        const ids = new Set(foes.map(f => String(f.id)));
        const W = _num(world.width, 0);
        for (let dr = -hexes; dr <= hexes; dr++) {
            for (let dq = -hexes; dq <= hexes; dq++) {
                const r = s.r + dr;
                let q = s.q + dq;
                if (W > 0) q = ((q % W) + W) % W;
                if (_dist(world, s, { q, r }) > hexes) continue;
                const t = world.getTile(q, r);
                if (!t) continue;
                const owner = t.kingdom != null ? t.kingdom : (t.settlement ? t.settlement.kingdom : null);
                if (owner != null && ids.has(String(owner))) return true;
            }
        }
        return false;
    },

    /** A battle remembered near the town within `days` (its cairn's latest dead). */
    freshBattle(s, day, days) {
        let marks = [];
        try { marks = TownMarks.marks(s, 'cairn') || []; } catch (e) { marks = []; }
        return marks.some(m => m && day >= _num(m.d, -1e9) && day - _num(m.d, -1e9) <= days);
    },

    /** The town's last change of crown within `days`: { from, fromName, by, byName, day } or null. */
    conquest(world, s, k, day, days) {
        let best = null;
        for (const other of _arr(world && world.kingdoms)) {
            if (!other || (k && other.id === k.id)) continue;
            for (const rec of _arr(other.lostTowns)) {
                if (!rec || rec.q !== s.q || rec.r !== s.r) continue;
                if (day - _num(rec.day) > days || day < _num(rec.day)) continue;
                if (k && rec.by != null && String(rec.by) !== String(k.id)) continue;
                if (!best || _num(rec.day) > best.day) best = { from: other.id, fromName: other.name, by: k ? k.id : rec.by, byName: k ? k.name : rec.byName, day: _num(rec.day) };
            }
        }
        return best;
    },

    /** Is the town's realm (or its region) in famine? */
    famine(world, s, k) {
        for (const ev of _arr(world && world.activeEvents)) {
            if (!ev || ev.id !== 'famine') continue;
            if (ev.kingdomId == null || (k && String(ev.kingdomId) === String(k.id))) return true;
        }
        const c = Crises.active(world);
        if (c && c.kind === 'famine' && c.data && Array.isArray(c.data.regions) && (c.phase == null || c.phase === 'hungry')) {
            let id = null;
            try { id = Harvests.regionOf(world, s.q, s.r); } catch (e) { id = null; }
            if (id != null && c.data.regions.includes(id)) return true;
        }
        return false;
    },

    /**
     * The holy wars as this town sees them: the preacher's call (an open call
     * of the realm's see, the realm invited or answered, and not its target),
     * crusaders passing (a war with crusading crowns, the town on the road to or
     * at its muster) → { preach, crusaders, muster, war } or null.
     */
    holy(world, s, k) {
        if (!_alive(k)) return null;
        const C = TownWorld.config().holy;
        let preach = null, crusaders = 0, musterHere = false, war = null, muster = null;
        for (const w of HolyWars.active(world)) {
            if (!w || w.target === k.id) continue;
            const ours = _arr(w.invited).includes(k.id) || _arr(w.members).includes(k.id);
            if (!ours) continue;
            if (w.phase === 'call' && !preach) preach = { warId: w.id, head: w.head, target: w.targetName, name: w.name };
            // Crusaders on the road: a war some crown has answered, this town at or near its muster
            if (!_arr(w.members).length) continue;
            const m = HolyWars.musterOf(world, w);
            const d = m ? _dist(world, m, s) : Infinity;
            const n = d === 0 ? _num(C.musterCrusaders, 5) : d <= _num(C.routeHexes, 8) ? _num(C.crusaders, 3) : 0;
            if (n > crusaders) { crusaders = n; war = w; muster = m; musterHere = d === 0; }
        }
        if (!preach && !crusaders) return null;
        const w = war || (preach ? HolyWars.war(world, preach.warId) : null);
        return { preach, crusaders, musterHere, warId: w ? w.id : null, target: w ? w.targetName : null, muster: muster ? muster.town : null };
    },

    /** An inquisitor sitting a hearing in the town: { id, name, zeal } or null. */
    hearing(world, s) {
        const inq = Inquisition.at(world, s.q, s.r).find(i => i && i.phase === 'hearing');
        return inq ? { id: inq.id, name: inq.name || 'the inquisitor', zeal: _num(inq.zeal, 0.6) } : null;
    },

    /** The news cried here these days: [{ kind, text, day }], newest first. */
    news(world, player, s, day) {
        const C = TownWorld.config().news;
        const heard = player ? Heralds.heardAt(player, world, s.q, s.r) : [];
        return heard.filter(p => p && p.text && day - _num(p.day) <= _num(C.days, 6)).slice(0, _num(C.max, 4));
    },

    // ──────────── THE VIEW ────────────

    /**
     * What the town's streets show today. → {
     *   key, kingdomId, realmName, crowns, foes: [{ id, name }],
     *   billet, drill, muster: { kingdomId, name, tents, men, holy } | null,
     *   siege: { kingdomId, name, fires, source, since? } | null,
     *   threat: { kingdomId, name, since } | null (a foe's front near, not yet a siege),
     *   front, wounded,
     *   holy: TownWorld.holy, inquisition: TownWorld.hearing,
     *   conquered: { from, fromName, by, byName, day, garrison } | null,
     *   famine, banned: { head } | null, stay (share kept indoors), beggars,
     *   famineStalls (share of stalls left empty), breadLine (folk queuing at the
     *   bakery or granary door), baskets (empty baskets and crates on the square),
     *   news }
     * or null when the town has no living crown and nothing to show.
     */
    view(world, player, s, day = _num(world && world.day, 1)) {
        const C = TownWorld.config();
        if (!C.enabled || !world || !s || !Number.isFinite(s.q)) return null;
        const type = s.type || 'village';
        const k = _kingdom(world, s.kingdom);
        const own = _alive(k) ? k : null;
        const foes = TownWorld.foes(world, own);
        const W = C.war;
        const out = {
            key: '', kingdomId: own ? own.id : null, realmName: own ? own.name : null,
            crowns: TownWorld.crowns(world, own), foes: foes.map(f => ({ id: f.id, name: f.name })),
            billet: 0, drill: W.drill, muster: null, siege: null, threat: null, front: false, wounded: 0,
            holy: null, inquisition: null, conquered: null, famine: false, banned: null,
            stay: 0, beggars: 0, famineStalls: 0, breadLine: 0, baskets: 0, news: [],
        };
        // War
        if (foes.length) {
            out.billet = Math.max(0, Math.min(10, _bySize(W.billet, type)));
            const siege = TownWorld.siegeOf(world, player, s, own);
            if (siege) out.siege = { ...siege, fires: Math.max(0, Math.min(12, _num(W.siegeFires, 6))) };
            // A host gathering here: the realm's war host on or beside it, else its muster town against a foe
            let host = null;
            for (const u of _arr(world.units)) {
                if (u && u.type === 'war_host' && own && String(u.kingdomId) === String(own.id) && !u.isDead && _dist(world, u, s) <= 1) { host = u; break; }
            }
            const mt = !host && !out.siege ? foes.map(f => ({ f, t: TownWorld.musterTown(world, own, f) })).find(x => x.t && x.t.q === s.q && x.t.r === s.r) : null;
            if (host || mt) out.muster = { kingdomId: own.id, name: own.name, foe: (mt ? mt.f : foes[0]).name, tents: Math.max(1, Math.min(10, _num(W.musterTents, 6))), men: Math.max(0, Math.min(10, _num(W.musterMen, 6))), holy: false };
            if (!out.siege) {
                const f = TownWorld.aiFront(world, s);
                if (f && !f.siege) out.threat = { kingdomId: f.kingdomId, name: f.name, since: f.since };
            }
            out.front = !!out.siege || !!out.threat || TownWorld.nearFoe(world, s, foes, _num(W.frontHexes, 5));
        } else if (player) {
            const siege = TownWorld.siegeOf(world, player, s, own);
            if (siege) out.siege = { ...siege, fires: Math.max(0, Math.min(12, _num(W.siegeFires, 6))) };
        }
        if (out.front || TownWorld.freshBattle(s, day, _num(W.woundedDays, 40))) {
            if (out.front || foes.length) out.wounded = Math.max(0, Math.min(6, _bySize(W.wounded, type)));
        }
        // The cross
        out.holy = TownWorld.holy(world, s, own);
        if (out.holy && out.holy.musterHere && !out.muster) {
            out.muster = { kingdomId: own.id, name: own.name, foe: out.holy.target, tents: Math.max(1, Math.min(10, _num(W.musterTents, 6))), men: 0, holy: true };
        }
        out.inquisition = TownWorld.hearing(world, s);
        // Who rules: a recent conquest
        const cq = TownWorld.conquest(world, s, own, day, _num(C.conquered.days, 360));
        if (cq) out.conquered = { ...cq, garrison: Math.max(0, Math.min(8, _bySize(C.conquered.garrison, type))) };
        // Hard times
        out.famine = TownWorld.famine(world, s, own);
        if (out.famine) {
            out.beggars = Math.max(0, Math.min(5, _bySize(C.famine.beggars, type)));
            out.famineStalls = Math.max(0, Math.min(1, _num(C.famine.stalls, 0.6)));
            // (signs that read in every era, stalls or none: the line at the bakery door, the square's empty baskets)
            out.breadLine = Math.max(0, Math.min(8, _bySize(C.famine.breadLine, type)));
            out.baskets = Math.max(0, Math.min(8, _bySize(C.famine.baskets, type)));
        }
        const ban = own ? HolyWars.banOf(world, own) : null;
        if (ban) out.banned = { head: HolyWars.headLabel(ban.see) };
        out.stay = Math.max(out.siege ? _num(W.stay.siege, 0.55) : 0, out.threat ? _num(W.stay.threat, 0.2) : 0, out.famine ? _num(C.famine.stay, 0.3) : 0, foes.length ? _num(W.stay.war, 0) : 0);
        out.news = TownWorld.news(world, player, s, day);
        out.key = TownWorld.signature(out);
        return out;
    },

    /** A key that changes when what the streets show changes (not the news). */
    signature(v) {
        if (!v) return '';
        return [
            v.kingdomId, v.crowns.map(c => c.kingdomId).join('+'), v.billet, v.muster ? `${v.muster.kingdomId}${v.muster.holy ? 'h' : ''}` : '-',
            v.siege ? v.siege.kingdomId : '-', v.threat ? `t${v.threat.kingdomId}` : '-', v.wounded, v.holy ? `${v.holy.preach ? v.holy.preach.warId : '-'}/${v.holy.crusaders}` : '-',
            v.inquisition ? v.inquisition.id : '-', v.conquered ? `${v.conquered.from}@${v.conquered.day}` : '-',
            v.famine ? 'F' : '-', v.banned ? 'B' : '-',
        ].join('|');
    },

    /**
     * Is a supply train due at the muster camp? `nextAt` the clock (seconds in
     * town) it is next due, `hour` the hour of day, `rolling` the host's wagons
     * on the map now: a train sets out in the train's hours once the last is
     * gone. (The caller sets nextAt = clock + every as the train sets out.)
     */
    trainDue(clock, nextAt, hour, rolling, cfg = TownWorld.config().war.train) {
        if (_num(rolling) > 0 || !(clock >= _num(nextAt, Infinity))) return false;
        return TownWorld.inHours(hour, cfg.hours || [6, 19]);
    },

    /**
     * The drill's beat at `t` seconds (every man in the ranks on the same
     * beat): writes { beat: 'ready'|'thrust'|'recover'|'step', frame (the
     * halfslash frame held through the thrust, else -1), cycle (the count of
     * cycles, its parity which way the step goes), u (0..1 through the beat),
     * late (the step's beat begun: the ranks stand where it puts them) }
     * into `out` (reused: nothing allocated).
     */
    drillBeat(t, out = {}, cfg = TownWorld.config().war.drillBeat) {
        const cyc = Math.max(1, _num(cfg.cycle, 6.4));
        const x = ((t % cyc) + cyc) % cyc;
        out.cycle = Math.floor(t / cyc);
        out.frame = -1;
        const th = _num(cfg.thrust, 1.2), rc = _num(cfg.recover, 2.1), st = _num(cfg.step, 3.8), sl = _num(cfg.stepLen, 0.9);
        // (the step taken: from it on, the ranks stand where it put them)
        out.late = x >= st;
        if (x >= th && x < rc) {
            out.beat = 'thrust';
            out.u = (x - th) / Math.max(0.01, rc - th);
            // (the LPC halfslash sheet: drawn back, driven forward, the lunge held, coming back)
            out.frame = out.u < 0.14 ? 1 : out.u < 0.26 ? 2 : out.u < 0.82 ? 3 : 4;
        } else if (x >= rc && x < st) {
            out.beat = 'recover';
            out.u = (x - rc) / Math.max(0.01, st - rc);
        } else if (x >= st && x < st + sl) {
            out.beat = 'step';
            out.u = (x - st) / Math.max(0.01, sl);
        } else {
            out.beat = 'ready';
            out.u = x < th ? x / Math.max(0.01, th) : (x - st - sl) / Math.max(0.01, cyc - st - sl);
        }
        return out;
    },

    /**
     * Who walks up to the player today, if anyone: 'messenger' (a letter come
     * in the last letterDays), 'petitioner' (petitions wait and the player can
     * hold court here), 'beggar' (hard times and a purse worth asking) — at most
     * one a day, by a hash of the day and the town. → kind or null.
     * `ctx` = { letterDay, petitions, holdsCourt, gold, hardTimes }.
     */
    approacher(day, townKey, ctx = {}) {
        const A = TownWorld.config().approach;
        if (townHash('approach', day, townKey) >= _num(A.chance, 0.55)) return null;
        if (ctx.letterDay != null && day - _num(ctx.letterDay) <= _num(A.letterDays, 3)) return 'messenger';
        if (_num(ctx.petitions) > 0 && ctx.holdsCourt) return 'petitioner';
        if (ctx.hardTimes && _num(ctx.gold) >= _num(A.beggarGold, 30)) return 'beggar';
        return null;
    },
};
