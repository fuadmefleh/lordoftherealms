// ============================================
// REALM UNIONS — two AI crowns on one head
// ============================================
// The player may wear many crowns (systems/highCrowns.js); this is the same
// for the AI realms. Two crowns come to one head when the reigning rulers of
// two realms are wed to each other — a royal match of their heirs
// (CrownMatches, systems/betrothals.js) who both came to their thrones, or two
// crowned rulers wed by their envoys (Characters.arrangeMarriage) — and the
// lesser realm's law on the crown abroad (data/laws.json crownAbroad: 'blood'
// or 'native') lets its crown be worn by one who reigns elsewhere.
//
//   ONE RULER    the greater realm (more land, then the larger host) is the
//                SENIOR crown; its ruler is the MONARCH of both, and the
//                junior realm's kingdom.ruler reads his name. The junior's own
//                royal (characterData.ruler: the consort, later a regent) keeps
//                its court. Each realm keeps its laws, treasury and lords.
//   ABROAD       one foreign policy: the two keep the peace and stand allied
//                (KingdomAI.mayOpenWar refuses a war between them), the junior
//                declares no war of its own (KingdomAI.considerWar), and each
//                joins the other's wars unless it holds a truce with the foe;
//                when the senior makes peace, so does the junior. A realm
//                weighing war on either weighs the two hosts together
//                (KingdomAI.unionMight).
//   THE LORDS    the junior's lords resent an absentee king: their TEMPER
//                (0–100) grows weekly (absence, a foreign culture or faith,
//                the senior's wars, a troubled realm), eased by a consort at
//                home and the monarch's progresses; it sours the realm's
//                stability (personalUnion.stab, read by KingdomStability.target)
//                and its regard for the senior crown. Past revoltAt they may
//                rise and crown a king of their own (the senior may march to
//                take it back).
//   SUCCESSION   a union ends at a succession its law or blood will not
//                follow: the monarch dies while the consort lives (her crown
//                stays hers); the senior's new ruler is a regent or a stranger
//                to the blood; the junior crowns a native heir of its own line
//                (or a cousin seizes it); the law forbids a crown abroad. Else
//                the crown follows the blood and the union holds.
//   HEIRS        the two spouses' children are born at the senior court and
//                are of both lines (world/characters: Characters._birthsHere,
//                _lineOf). A realm whose heir by blood already reigns elsewhere
//                is held by a stand-in (lastSuccession.abroad): where its law
//                lets the crown go abroad the two crowns join on the heir's
//                head (_crownAbroad: a union by inheritance, the stand-in its
//                regent), else the stand-in is crowned. In a standing union,
//                a monarch whose heir reigns the junior realm moves the seat
//                there (_flip). So a union can outlast the marriage that made it.
//   ENDS TOO     either realm falls, or the player takes either throne.
//
// State: kingdom.personalUnion on both realms (saved with the realm:
// { id, role: 'senior'|'junior', partnerId, since, ... } — the junior's record
// holds the monarch, the resident royal, the temper and what has been seen);
// world.realmUnions = { seq, history, refused } (systems/saveLoad.js). The
// world's day calls processDay(world, player) (ui/game/endDay.js, and the
// afterlife's world-only tick with player null). Tellings go to world.events,
// the Timeline (RealmTimeline.note → the Almanac), the player's notices and,
// when the player is a subject of either realm, the House chronicle and an
// interrupt. Hash rolls only (world seed + key); no RNG stream is drawn.
// Tunables and text in data/realmUnions.json. No import-time side effects.

import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { Names } from '../core/names.js';
import { Interrupts } from '../core/interrupts.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { Characters } from '../world/characters.js';
import { Laws } from './laws.js';
import { House } from './house.js';
import { RealmTimeline } from './realmTimeline.js';

const DEFAULTS = {
    minTerritory: 1,
    truceDays: 360,
    relationsFloor: 80,
    temper: {
        weekly: 0.3, foreignCulture: 0.2, foreignFaith: 0.12, perWar: 0.08, troubled: 0.2, troubledBelow: 35,
        consortHome: -0.2, progressChance: 0.3, progress: -12, stabBase: -2, stabPerTemper: 0.08, regardFloor: 20,
    },
    revoltAt: 100,
    revoltChance: 0.12,
    revoltRelations: -40,
    reconquestRatio: 1.4,
    reconquestChance: 0.5,
    cousinYields: 0.6,
    partedRelations: 40,
    historyCap: 40,
    refusedCap: 40,
};

const YEAR = 120;
const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _arr = v => (Array.isArray(v) ? v : []);
const _day = world => _num(world && world.day);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _fill = (text, vars) => String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));

function _seed(world) {
    const p = world && world.generationParams;
    return _num(p && p.seed, 1);
}

/** A unit roll for `key` in this world (no RNG stream touched). */
function _hash01(world, key) {
    let h = Utils.hashStr(`${_seed(world)}|realmUnions|${key}`) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return (((h ^ (h >>> 16)) >>> 0) % 100000) / 100000;
}

/** This system's own stream (mulberry32), for the war machinery's draws (KingdomAI.startWar's war goals). */
function _rng(world, key) {
    let a = (Utils.hashStr(`${_seed(world)}|realmUnionsRng|${key}`) >>> 0) || 1;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Open a war on this system's own stream, so the shared one is left as it was. */
function _startWar(world, a, b) {
    Utils.withRng(_rng(world, `war:${a.id}:${b.id}:${_day(world)}`), () => KingdomAI.startWar(a, b, world));
}

function _kingdom(world, id) {
    if (!world || id == null) return null;
    return (world.kingdoms || []).find(k => k && String(k.id) === String(id)) || null;
}

let _cfg = null;
let _cfgSrc;

export const RealmUnions = {
    data() {
        const g = DataLoader._gamedata;
        return (g && _obj(g.realmUnions)) || _obj(DataLoader.realmUnions) || {};
    },

    config() {
        const src = RealmUnions.data().config;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            _cfg = { ...DEFAULTS, ...d, temper: { ...DEFAULTS.temper, ...(_obj(d.temper) || {}) } };
        }
        return _cfg;
    },

    _text(key, vars, fallback = '') {
        const t = _obj(RealmUnions.data().text) || {};
        return _fill(t[key] || fallback, vars);
    },

    /** The world's record: { seq, history, refused }. */
    state(world) {
        if (!world) return { seq: 0, history: [], refused: {} };
        let st = _obj(world.realmUnions);
        if (!st) st = world.realmUnions = { seq: 0, history: [], refused: {} };
        if (!Array.isArray(st.history)) st.history = [];
        if (!_obj(st.refused)) st.refused = {};
        st.seq = _num(st.seq);
        return st;
    },

    // ──────────── READERS ────────────

    /** The realm's union partner (alive), or null. */
    partnerOf(world, kingdom) {
        const u = kingdom && _obj(kingdom.personalUnion);
        if (!u || u.partnerId == null) return null;
        const p = _kingdom(world, u.partnerId);
        return p && p.isAlive ? p : null;
    },

    /** Are these two realms one crown? */
    together(a, b) {
        return !!(a && b && _obj(a.personalUnion) && String(a.personalUnion.partnerId) === String(b.id));
    },

    /** { senior, junior, u (the junior's record) } for a realm in union, or null. */
    unionOf(world, kingdom) {
        const p = RealmUnions.partnerOf(world, kingdom);
        if (!p) return null;
        const senior = kingdom.personalUnion.role === 'senior' ? kingdom : p;
        const junior = senior === kingdom ? p : kingdom;
        const u = _obj(junior.personalUnion);
        return u ? { senior, junior, u } : null;
    },

    /** Every union standing: [{ senior, junior, u }]. */
    list(world) {
        const out = [];
        for (const k of _arr(world && world.kingdoms)) {
            if (!k || !k.isAlive || !_obj(k.personalUnion) || k.personalUnion.role !== 'junior') continue;
            const v = RealmUnions.unionOf(world, k);
            if (v) out.push(v);
        }
        return out;
    },

    /**
     * What the player reads of a realm's union, or null:
     * { role, partner, partnerName, monarch, resident, residentRole, since, temper, label, text }.
     */
    describe(world, kingdom) {
        const v = RealmUnions.unionOf(world, kingdom);
        if (!v) return null;
        const { senior, junior, u } = v;
        const partner = kingdom === senior ? junior : senior;
        const label = RealmUnions._text('union', { partner: Names.realm(partner.name) }, `in personal union with ${Names.realm(partner.name)}`);
        const residentRole = u.resident && u.resident.role === 'consort' ? 'consort' : 'regent';
        const temper = Math.round(_num(u.temper));
        const mood = temper >= 75 ? 'near revolt' : temper >= 45 ? 'restless' : temper >= 20 ? 'grumbling' : 'content';
        const text = kingdom === senior
            ? `${senior.ruler} also wears the crown of ${Names.realm(junior.name)} (since day ${u.since}); its lords are ${mood}.`
            : `Ruled from ${Names.realm(senior.name)} by ${senior.ruler}, in personal union since day ${u.since}. ${u.resident && u.resident.name ? `${u.resident.name} keeps the court here as ${residentRole}. ` : ''}Its own laws and treasury; one foreign policy. The lords are ${mood} (${temper}/100).`;
        return {
            role: kingdom === senior ? 'senior' : 'junior', partner, partnerName: partner.name,
            monarch: senior.ruler, resident: u.resident ? u.resident.name : null, residentRole,
            since: u.since, temper, mood, label, text,
        };
    },

    /** A realm's host weighed with its union partner's (the two fight as one). */
    might(world, kingdom) {
        const m = k => _num(k && k.military) + _num(k && k.population) * 0.1;
        const p = RealmUnions.partnerOf(world, kingdom);
        return m(kingdom) + (p ? m(p) : 0);
    },

    /** Unions on record (formed and ended): newest last. */
    history(world) {
        return _arr(_obj(world && world.realmUnions) && world.realmUnions.history).slice();
    },

    // ──────────── THE DAY ────────────

    /** One day of the unions. → { notices } */
    processDay(world, player = null) {
        const out = { notices: [], formed: [], ended: [] };
        if (!world || !Array.isArray(world.kingdoms)) return out;
        const day = _day(world);
        // The unions that stand: successions, falls, the player's hand, the peace and the wars
        for (const v of RealmUnions.list(world).concat(RealmUnions._orphans(world))) {
            if (!v.senior || !v.junior) continue;
            if (RealmUnions._checkEnd(world, player, v, out)) continue;
            if (RealmUnions._successions(world, player, v, out)) continue;
            RealmUnions._sync(world, v, out);
            if (day % 7 === 0 && RealmUnions._week(world, player, v, out)) continue;
        }
        // New unions: two reigning rulers wed to each other
        RealmUnions._scan(world, player, out);
        return out;
    },

    /** Half-records left by a realm that fell or a broken link: tidied as endings. */
    _orphans(world) {
        const out = [];
        for (const k of _arr(world.kingdoms)) {
            const u = k && _obj(k.personalUnion);
            if (!u) continue;
            const p = _kingdom(world, u.partnerId);
            if (k.isAlive && p && p.isAlive && _obj(p.personalUnion) && String(p.personalUnion.partnerId) === String(k.id)) continue;
            if (!k.isAlive && p && p.isAlive && _obj(p.personalUnion)) continue; // (told from the living side)
            const senior = u.role === 'senior' ? k : p;
            const junior = u.role === 'senior' ? p : k;
            out.push({ senior, junior, u: (junior && _obj(junior.personalUnion)) || u, orphan: true });
        }
        return out;
    },

    _ruler(k) {
        const r = k && k.characterData && k.characterData.ruler;
        return r && r.isAlive !== false ? r : null;
    },

    _playerHeld(k) {
        const c = k && k.crown;
        const r = RealmUnions._ruler(k);
        return !!((c && (c.playerRuled || c.union)) || (r && r.isPlayer));
    },

    /** Which of two realms is the greater crown: more land, then the larger host, then the id. */
    _greater(a, b) {
        const ta = _arr(a.territory).length, tb = _arr(b.territory).length;
        if (ta !== tb) return ta > tb ? a : b;
        const ma = _num(a.military), mb = _num(b.military);
        if (ma !== mb) return ma > mb ? a : b;
        return String(a.id) < String(b.id) ? a : b;
    },

    _vars(v, extra = {}) {
        const { senior, junior, u } = v;
        return {
            monarch: senior ? senior.ruler : '', senior: senior ? senior.name : '', junior: junior ? junior.name : '',
            seniorRealm: senior ? Names.realm(senior.name) : '', juniorRealm: junior ? Names.realm(junior.name) : '',
            SeniorRealm: senior ? Names.realm(senior.name, true) : '', JuniorRealm: junior ? Names.realm(junior.name, true) : '',
            resident: (u && u.resident && u.resident.name) || (junior && junior.ruler) || '',
            // (the monarch's style in the lords' mouths: "their absent queen")
            king: (RealmUnions._ruler(senior) || {}).gender === 'female' ? 'queen' : 'king',
            ...extra,
        };
    },

    // ──────────── FORMING ────────────

    _scan(world, player, out) {
        const C = RealmUnions.config();
        const st = RealmUnions.state(world);
        const byRuler = new Map();
        for (const k of world.kingdoms) {
            const r = RealmUnions._ruler(k);
            if (k && k.isAlive && r && r.id != null) byRuler.set(r.id, k);
        }
        for (const a of world.kingdoms) {
            if (!a || !a.isAlive || _obj(a.personalUnion)) continue;
            const ra = RealmUnions._ruler(a);
            if (!ra || ra.spouseId == null) continue;
            const b = byRuler.get(ra.spouseId);
            if (!b || b === a || _obj(b.personalUnion)) continue;
            const rb = RealmUnions._ruler(b);
            if (!rb || rb.spouseId !== ra.id) continue;
            if (!Characters.canWed(ra, rb)) continue; // (the world's rule on who may wed: no union of a match it never makes)
            if (String(a.id) > String(b.id)) continue; // (each pair once)
            if (RealmUnions._playerHeld(a) || RealmUnions._playerHeld(b)) continue;
            if (_arr(a.territory).length < C.minTerritory || _arr(b.territory).length < C.minTerritory) continue;
            const key = `${ra.id}|${rb.id}`;
            if (st.refused[key] != null || st.refused[`${rb.id}|${ra.id}`] != null) continue;
            const senior = RealmUnions._greater(a, b);
            const junior = senior === a ? b : a;
            const rj = senior === a ? rb : ra;
            const rjName = Characters.getDisplayName(rj, junior);
            const v0 = { senior, junior, u: { resident: { name: rjName } } };
            if (Laws.value(world, junior.id, 'crownAbroad') === 'native') {
                RealmUnions._refuse(world, ra.id, rb.id);
                const text = RealmUnions._text('refused', RealmUnions._vars(v0, { consort: rjName }), '');
                RealmUnions._tell(world, player, v0, text, out, { icon: '🏛️', title: 'No Crown Abroad', type: 'info', minor: true });
                continue;
            }
            RealmUnions.form(world, senior, junior, { player, out, consort: rj });
        }
        // Crowns abroad: a realm whose heir by blood reigns elsewhere (Characters.handleSuccession)
        for (const k of world.kingdoms) {
            const ab = k && k.isAlive && k.lastSuccession && _obj(k.lastSuccession.abroad);
            if (ab && ab.settled == null) RealmUnions._crownAbroad(world, player, k, ab, out);
        }
    },

    /**
     * A realm's crown has passed by blood to an heir who reigns in another
     * realm (the child of a royal marriage across the two): where its law lets
     * a crown be worn abroad, the two crowns come to one head — the heir's seat
     * the senior crown, the one who holds the court here (the heir's stand-in)
     * its regent. Else the stand-in is crowned in their own right.
     */
    _crownAbroad(world, player, k, ab, out) {
        const C = RealmUnions.config();
        ab.settled = _day(world);
        const seat = _kingdom(world, ab.seatId);
        const heir = seat && RealmUnions._ruler(seat);
        const standIn = RealmUnions._ruler(k);
        const v0 = { senior: seat || k, junior: k, u: { resident: { name: standIn ? Characters.getDisplayName(standIn, k) : k.ruler } } };
        const vars = RealmUnions._vars(v0, { old: k.lastSuccession.oldRulerName || 'The old ruler', heir: ab.heirName || '' });
        let why = null;
        if (!seat || !seat.isAlive || !heir || String(heir.id) !== String(ab.heirId)) why = 'gone';
        else if (_obj(k.personalUnion) || _obj(seat.personalUnion)) why = 'bound';
        else if (RealmUnions._playerHeld(k) || RealmUnions._playerHeld(seat)) why = 'player';
        else if (_arr(k.territory).length < C.minTerritory || _arr(seat.territory).length < C.minTerritory) why = 'small';
        else if (Laws.value(world, k.id, 'crownAbroad') === 'native') why = 'law';
        if (why) {
            // The one who held the court is crowned in their own right
            if (standIn && standIn.standIn) delete standIn.standIn;
            if (!RealmUnions._playerHeld(k)) Characters.syncRulerName(k);
            vars.resident = k.ruler;
            if (why === 'law' || why === 'bound') RealmUnions._tell(world, player, v0, RealmUnions._text('abroadRefused', vars, ''), out, { icon: '🏛️', title: 'No Crown Abroad', type: 'info', minor: true });
            return null;
        }
        return RealmUnions.form(world, seat, k, { player, out, consort: standIn, residentRole: 'regent', how: 'inheritance', textKey: 'abroadFormed', vars });
    },

    /** Two wed rulers whose crowns will not (or no longer) be one: not asked again. */
    _refuse(world, idA, idB) {
        if (idA == null || idB == null) return;
        const C = RealmUnions.config();
        const st = RealmUnions.state(world);
        st.refused[`${idA}|${idB}`] = _day(world);
        const keys = Object.keys(st.refused);
        if (keys.length > C.refusedCap) for (const k of keys.slice(0, keys.length - C.refusedCap)) delete st.refused[k];
    },

    /**
     * Join two crowns on the senior's ruler (also for specs and the editor).
     * opts: { player, out, consort (the junior's royal), how }.
     */
    form(world, senior, junior, opts = {}) {
        const C = RealmUnions.config();
        const st = RealmUnions.state(world);
        const out = opts.out || { notices: [], formed: [], ended: [] };
        const day = _day(world);
        if (!senior || !junior || senior === junior || _obj(senior.personalUnion) || _obj(junior.personalUnion)) return null;
        const consort = opts.consort || RealmUnions._ruler(junior);
        st.seq += 1;
        const id = `union_${st.seq}`;
        const consortName = consort ? Characters.getDisplayName(consort, junior) : (junior.ruler || '');
        senior.personalUnion = { id, role: 'senior', partnerId: junior.id, since: day };
        junior.personalUnion = {
            id, role: 'junior', partnerId: senior.id, since: day, how: opts.how || 'marriage',
            resident: consort ? { id: consort.id, name: consortName, role: opts.residentRole || 'consort' } : null,
            temper: 0, stab: _num(C.temper.stabBase),
            seen: { s: _num(senior.lastSuccession && senior.lastSuccession.day, -1), j: _num(junior.lastSuccession && junior.lastSuccession.day, -1) },
            lastWars: _arr(senior.wars).slice(),
        };
        const v = { senior, junior, u: junior.personalUnion };
        // One foreign policy from today: no war between them, allied
        if (_arr(senior.wars).includes(junior.id) || _arr(junior.wars).includes(senior.id)) {
            KingdomAI.endWar(senior, junior, world, { text: `🕊️ ${senior.name} and ${junior.name} lay down their arms: their crowns are one.` });
        }
        RealmUnions._bind(world, v);
        const text = RealmUnions._text(opts.textKey || 'formed', RealmUnions._vars(v, { consort: consortName, ...(opts.vars || {}), resident: consortName }), `👑 ${senior.name} and ${junior.name} are joined in personal union.`);
        junior.ruler = senior.ruler;
        st.history.push({ id, senior: { id: senior.id, name: senior.name }, junior: { id: junior.id, name: junior.name }, monarch: senior.ruler, consort: consortName, from: day, to: null, how: opts.how || 'marriage', end: null, monarchs: [senior.ruler] });
        if (st.history.length > C.historyCap) st.history.splice(0, st.history.length - C.historyCap);
        RealmUnions._tell(world, opts.player || null, v, text, out, { icon: '👑', title: 'Two Crowns, One Head', type: 'info', interrupt: true });
        RealmUnions._timeline(world, senior, 'timelineFormed', RealmUnions._vars(v));
        out.formed.push(id);
        return junior.personalUnion;
    },

    /** Allied, at peace, a standing truce and warm regard (kept daily). */
    _bind(world, v) {
        const C = RealmUnions.config();
        const { senior, junior, u } = v;
        const until = _day(world) + C.truceDays;
        for (const [x, y] of [[senior, junior], [junior, senior]]) {
            if (!Array.isArray(x.allies)) x.allies = [];
            if (!x.allies.includes(y.id)) x.allies.push(y.id);
            if (!x.truces) x.truces = {};
            if (_num(x.truces[y.id]) < until) x.truces[y.id] = until;
            if (!x.relations) x.relations = {};
        }
        senior.relations[junior.id] = Math.max(_num(senior.relations[junior.id]), C.relationsFloor);
        // (the junior's regard sinks with its lords' temper)
        const regard = _clamp(C.relationsFloor + 10 - _num(u.temper), _num(C.temper.regardFloor), 100);
        junior.relations[senior.id] = Math.round(regard);
    },

    // ──────────── KEEPING ────────────

    /** Peace between them, the monarch's name on both, each in the other's wars. */
    _sync(world, v, out) {
        const { senior, junior, u } = v;
        if (_arr(senior.wars).includes(junior.id) || _arr(junior.wars).includes(senior.id)) {
            KingdomAI.endWar(senior, junior, world, { text: `🕊️ ${senior.name} and ${junior.name}, one crown, make peace with each other.` });
        }
        RealmUnions._bind(world, v);
        if (senior.ruler && junior.ruler !== senior.ruler) junior.ruler = senior.ruler;
        const vars = RealmUnions._vars(v);
        // The senior's peace binds the junior
        const now = new Set(_arr(senior.wars).map(String));
        for (const foeId of _arr(u.lastWars)) {
            if (now.has(String(foeId)) || !_arr(junior.wars).map(String).includes(String(foeId))) continue;
            const foe = _kingdom(world, foeId);
            if (!foe || KingdomAI.isSworn(junior, foe, world)) continue;
            KingdomAI.endWar(junior, foe, world, { text: RealmUnions._text('peace', { ...vars, foe: foe.name }, '') });
        }
        // Each joins the other's wars (unless it holds a truce with the foe)
        for (const [from, to, key] of [[senior, junior, 'joinWar'], [junior, senior, 'joinWarSenior']]) {
            for (const foeId of _arr(from.wars).slice()) {
                if (String(foeId) === String(to.id) || _arr(to.wars).map(String).includes(String(foeId))) continue;
                const foe = _kingdom(world, foeId);
                if (!foe || !foe.isAlive || KingdomAI.hasTruce(to, foe, world) || RealmUnions.together(to, foe)) continue;
                _startWar(world, to, foe);
                if (Array.isArray(world.events)) world.events.push({ text: RealmUnions._text(key, { ...vars, foe: foe.name }, ''), type: 'military' });
            }
        }
        u.lastWars = _arr(senior.wars).slice();
    },

    /** Weekly: the junior lords' temper, a progress, a revolt. → true when the union broke. */
    _week(world, player, v, out) {
        const C = RealmUnions.config();
        const T = C.temper;
        const { senior, junior, u } = v;
        const day = _day(world);
        let d = _num(T.weekly);
        if (senior.culture && junior.culture && senior.culture !== junior.culture) d += _num(T.foreignCulture);
        const fa = senior.religion && (senior.religion.faith || senior.religion.id || senior.religion.dominant);
        const fb = junior.religion && (junior.religion.faith || junior.religion.id || junior.religion.dominant);
        if (fa && fb && fa !== fb) d += _num(T.foreignFaith);
        d += _num(T.perWar) * _arr(junior.wars).length;
        if (typeof junior.stability === 'number' && junior.stability < _num(T.troubledBelow)) d += _num(T.troubled);
        const res = u.resident && RealmUnions._ruler(junior);
        if (u.resident && u.resident.role === 'consort' && res && res.id === u.resident.id) d += _num(T.consortHome);
        u.temper = _clamp(_num(u.temper) + d, 0, 100);
        // A progress: the monarch keeps court a season in the junior realm (once a year, at most)
        if (day % YEAR < 7 && u.temper > 10 && _hash01(world, `progress:${u.id}:${Math.floor(day / YEAR)}`) < _num(T.progressChance)) {
            u.temper = _clamp(u.temper + _num(T.progress), 0, 100);
            if (Array.isArray(world.events)) world.events.push({ text: RealmUnions._text('progress', RealmUnions._vars(v), ''), type: 'political' });
        }
        u.stab = Math.round((_num(T.stabBase) - _num(u.temper) * _num(T.stabPerTemper)) * 10) / 10;
        // The lords grow restless: said once as the temper crosses the half
        if (u.temper >= 50 && !u.warned) {
            u.warned = day;
            RealmUnions._tell(world, player, v, RealmUnions._text('restless', RealmUnions._vars(v), ''), out, { icon: '🏴', title: 'An Absent King', type: 'warning', minor: true });
        } else if (u.temper < 35 && u.warned) u.warned = null;
        // A revolt for a king of their own
        if (u.temper >= C.revoltAt && _hash01(world, `revolt:${u.id}:${day}`) < C.revoltChance) {
            RealmUnions._end(world, player, v, 'revolt', out);
            return true;
        }
        return false;
    },

    // ──────────── SUCCESSIONS ────────────

    /** A succession in either realm since last seen. → true when the union broke. */
    _successions(world, player, v, out) {
        const { senior, junior, u } = v;
        if (!_obj(u.seen)) u.seen = { s: -1, j: -1 };
        const ss = senior.lastSuccession, sj = junior.lastSuccession;
        const sDay = _num(ss && ss.day, -1), jDay = _num(sj && sj.day, -1);
        const C = RealmUnions.config();
        // The monarch is dead: does the junior crown follow the senior's heir?
        if (sDay > _num(u.seen.s, -1)) {
            u.seen.s = sDay;
            const res = RealmUnions._ruler(junior);
            const vars = RealmUnions._vars(v, { old: ss.oldRulerName || 'The old king' });
            // The monarch's heir reigns elsewhere already (a child of the blood holding a crown abroad)
            const ab = _obj(ss.abroad);
            if (ab && ab.settled == null) {
                if (String(ab.seatId) === String(junior.id)) return RealmUnions._flip(world, player, v, out);
                // (a third realm's ruler: this union ends, and that crown may join it — _crownAbroad)
                RealmUnions._end(world, player, v, 'stranger', out, { resident: res ? Characters.getDisplayName(res, junior) : '' });
                return true;
            }
            if (u.resident && u.resident.role === 'consort' && res && res.id === u.resident.id) {
                const pos = res.gender === 'male' ? 'his' : 'her';
                RealmUnions._end(world, player, v, 'parted', out, { text: RealmUnions._text('partedConsort', { ...vars, consort: u.resident.name, pos }, '') });
                return true;
            }
            if (Laws.value(world, junior.id, 'crownAbroad') === 'native') { RealmUnions._end(world, player, v, 'law', out); return true; }
            if (ss.type !== 'heir' || ss.crisis) { RealmUnions._end(world, player, v, 'stranger', out); return true; }
            u.monarch = senior.ruler;
            junior.ruler = senior.ruler;
            RealmUnions._tell(world, player, v, RealmUnions._text('inherited', RealmUnions._vars(v), ''), out, { icon: '👑', title: 'The Union Holds', type: 'info', minor: true });
            const hh = RealmUnions.state(world).history.find(x => x && x.id === u.id);
            RealmUnions._noteHistory(world, u, { monarch: senior.ruler, monarchs: _arr(hh && hh.monarchs).concat([senior.ruler]) });
        }
        // The junior's royal is dead: does its crown pass to the monarch?
        if (jDay > _num(u.seen.j, -1)) {
            u.seen.j = jDay;
            const res = RealmUnions._ruler(junior);
            const resName = res ? Characters.getDisplayName(res, junior) : (sj.heirName || '');
            const vars = RealmUnions._vars(v, { old: sj.oldRulerName || 'The old ruler', resident: resName });
            if (Laws.value(world, junior.id, 'crownAbroad') === 'native') { RealmUnions._end(world, player, v, 'law', out, { resident: resName }); return true; }
            const ab = _obj(sj.abroad);
            if (ab && ab.settled == null) {
                if (String(ab.seatId) === String(senior.id)) {
                    // The junior's heir by blood is the monarch: the crown follows, a stand-in keeps the court
                    ab.settled = _day(world);
                    u.resident = res ? { id: res.id, name: resName, role: 'regent' } : null;
                    junior.ruler = senior.ruler;
                    RealmUnions._tell(world, player, v, RealmUnions._text('viceroy', vars, ''), out, { icon: '👑', title: 'The Union Holds', type: 'info', minor: true });
                    return false;
                }
                RealmUnions._end(world, player, v, 'native', out, { resident: resName });
                return true;
            }
            const monarch = RealmUnions._ruler(senior);
            const childOfMonarch = !!(res && monarch && (res.parentId === monarch.id || res.parentId2 === monarch.id));
            let holds;
            if (sj.type === 'heir') holds = childOfMonarch; // (a native heir of the junior's own line takes his own crown)
            else holds = _hash01(world, `cousin:${u.id}:${jDay}`) < C.cousinYields; // (a regent or cousin yields to the blood, or seizes it)
            if (!holds) { RealmUnions._end(world, player, v, 'native', out, { resident: resName }); return true; }
            u.resident = res ? { id: res.id, name: resName, role: 'regent' } : null;
            junior.ruler = senior.ruler;
            RealmUnions._tell(world, player, v, RealmUnions._text('viceroy', vars, ''), out, { icon: '👑', title: 'The Union Holds', type: 'info', minor: true });
        }
        return false;
    },

    /**
     * The monarch is dead and the heir by blood already reigns in the junior
     * realm (a child of the line who held its court): the two crowns stay on
     * one head, and the seat of the union moves — the heir's realm the senior
     * crown, the late monarch's realm the junior, kept by a stand-in.
     * → true (the day's work on this union is done).
     */
    _flip(world, player, v, out) {
        const { senior: oldSenior, junior: oldJunior, u } = v;
        const ss = oldSenior.lastSuccession;
        if (ss && _obj(ss.abroad)) ss.abroad.settled = _day(world);
        if (Laws.value(world, oldSenior.id, 'crownAbroad') === 'native') {
            // (the late monarch's realm will have no king abroad: its stand-in is crowned there)
            const sv = { senior: oldJunior, junior: oldSenior, u: { ...u, resident: null } };
            oldSenior.personalUnion = { ...u, role: 'junior', partnerId: oldJunior.id };
            oldJunior.personalUnion = { id: u.id, role: 'senior', partnerId: oldSenior.id, since: u.since };
            if (!RealmUnions._playerHeld(oldJunior)) Characters.syncRulerName(oldJunior);
            const sr = RealmUnions._ruler(oldSenior);
            RealmUnions._end(world, player, sv, 'law', out, { resident: sr ? Characters.getDisplayName(sr, oldSenior) : '' });
            return true;
        }
        const senior = oldJunior;
        const junior = oldSenior;
        const standIn = RealmUnions._ruler(junior);
        const day = _day(world);
        senior.personalUnion = { id: u.id, role: 'senior', partnerId: junior.id, since: u.since };
        junior.personalUnion = {
            ...u, role: 'junior', partnerId: senior.id,
            resident: standIn ? { id: standIn.id, name: Characters.getDisplayName(standIn, junior), role: 'regent' } : null,
            temper: 0, stab: _num(RealmUnions.config().temper.stabBase), warned: null,
            seen: { s: _num(senior.lastSuccession && senior.lastSuccession.day, -1), j: _num(junior.lastSuccession && junior.lastSuccession.day, day) },
            lastWars: _arr(senior.wars).slice(),
        };
        if (!RealmUnions._playerHeld(senior)) Characters.syncRulerName(senior);
        junior.ruler = senior.ruler;
        const nv = { senior, junior, u: junior.personalUnion };
        RealmUnions._bind(world, nv);
        const st = RealmUnions.state(world);
        const h = st.history.find(x => x && x.id === u.id);
        if (h) {
            h.senior = { id: senior.id, name: senior.name };
            h.junior = { id: junior.id, name: junior.name };
            h.monarch = senior.ruler;
            h.monarchs = _arr(h.monarchs).concat([senior.ruler]);
            h.seatMoved = (h.seatMoved || 0) + 1;
        }
        const text = RealmUnions._text('seatMoved', RealmUnions._vars(nv, { old: (ss && ss.oldRulerName) || 'The old king' }), '');
        RealmUnions._tell(world, player, nv, text, out, { icon: '👑', title: 'The Union Holds', type: 'info', minor: true });
        return true;
    },

    /** The ends that need no succession: a realm fallen, the player on a throne, a broken link. */
    _checkEnd(world, player, v, out) {
        const { senior, junior } = v;
        if (v.orphan || !senior || !junior || !senior.isAlive || !junior.isAlive) {
            const fallen = (senior && !senior.isAlive) ? senior : junior;
            RealmUnions._end(world, player, v, 'fallen', out, { fallen: fallen ? fallen.name : 'a realm' });
            return true;
        }
        if (RealmUnions._playerHeld(senior) || RealmUnions._playerHeld(junior)) {
            RealmUnions._end(world, player, v, 'player', out, { taken: RealmUnions._playerHeld(senior) ? senior.name : junior.name });
            return true;
        }
        return false;
    },

    // ──────────── ENDING ────────────

    /**
     * End a union. how: 'parted' | 'stranger' | 'native' | 'law' | 'revolt' |
     * 'fallen' | 'player'. opts: { text, resident, fallen, taken }.
     */
    _end(world, player, v, how, out, opts = {}) {
        const C = RealmUnions.config();
        const { senior, junior } = v;
        const u = (junior && _obj(junior.personalUnion)) || v.u || {};
        const day = _day(world);
        if (senior && _obj(senior.personalUnion) && String(senior.personalUnion.id) === String(u.id)) delete senior.personalUnion;
        if (junior && _obj(junior.personalUnion) && String(junior.personalUnion.id) === String(u.id)) delete junior.personalUnion;
        if (senior && _obj(senior.personalUnion) && !_kingdom(world, senior.personalUnion.partnerId)) delete senior.personalUnion;
        // The junior's own royal takes its own crown back (and a couple who parted is not joined again)
        const res = RealmUnions._ruler(junior);
        RealmUnions._refuse(world, res && res.id, RealmUnions._ruler(senior) && RealmUnions._ruler(senior).id);
        const pend = junior && junior.lastSuccession && _obj(junior.lastSuccession.abroad);
        if (res && res.standIn && !(pend && pend.settled == null)) delete res.standIn;
        if (junior && junior.isAlive && res && !RealmUnions._playerHeld(junior)) junior.ruler = Characters.getDisplayName(res, junior);
        const vars = RealmUnions._vars({ senior, junior, u }, { resident: opts.resident || (junior && junior.ruler) || '', fallen: opts.fallen || '', taken: opts.taken || '' });
        const key = { parted: 'partedConsort', stranger: 'partedStranger', native: 'partedNative', law: 'partedLaw', revolt: 'revolt', fallen: 'fallen', player: 'player' }[how] || 'partedNative';
        const text = opts.text || RealmUnions._text(key, vars, `💔 The union of ${vars.seniorRealm} and ${vars.juniorRealm} is ended.`);
        // The two crowns apart: the standing truce shortened to an ordinary one
        if (senior && junior && senior.isAlive && junior.isAlive) {
            const until = day + C.truceDays;
            for (const [x, y] of [[senior, junior], [junior, senior]]) {
                if (!x.truces) x.truces = {};
                x.truces[y.id] = how === 'revolt' ? day : until;
                if (!x.relations) x.relations = {};
                if (how === 'revolt') {
                    x.relations[y.id] = Math.min(_num(x.relations[y.id]), C.revoltRelations);
                    x.allies = _arr(x.allies).filter(id => String(id) !== String(y.id));
                } else {
                    x.relations[y.id] = Math.min(_num(x.relations[y.id], C.partedRelations), Math.max(C.partedRelations, _num(x.relations[y.id]) - 30));
                    if (how !== 'parted') x.allies = _arr(x.allies).filter(id => String(id) !== String(y.id));
                }
            }
        }
        RealmUnions._noteHistory(world, u, { to: day, end: how });
        RealmUnions._tell(world, player, { senior, junior, u }, text, out, { icon: how === 'revolt' ? '🏴' : '💔', title: how === 'revolt' ? 'A Crown Breaks Away' : 'A Union Ends', type: how === 'revolt' ? 'warning' : 'info', interrupt: true });
        if (senior && junior) RealmUnions._timeline(world, junior, 'timelineEnded', vars);
        // A revolt: the monarch may march to take the crown back
        if (how === 'revolt' && senior && junior && senior.isAlive && junior.isAlive
            && _num(senior.military) > _num(junior.military) * C.reconquestRatio
            && _hash01(world, `reconquest:${u.id}`) < C.reconquestChance
            && !_arr(senior.wars).includes(junior.id)) {
            _startWar(world, senior, junior);
            if (Array.isArray(world.events)) world.events.push({ text: RealmUnions._text('reconquest', vars, ''), type: 'military' });
        }
        out.ended.push({ id: u.id, how });
        return true;
    },

    _noteHistory(world, u, patch) {
        const st = RealmUnions.state(world);
        const h = st.history.find(x => x && x.id === u.id);
        if (h) Object.assign(h, patch);
    },

    // ──────────── TELLING ────────────

    /** Is the player a subject (or sworn) of either realm? */
    _concerns(player, v) {
        if (!player) return false;
        const a = player.allegiance;
        return a != null && [v.senior, v.junior].some(k => k && String(k.id) === String(a));
    },

    _tell(world, player, v, text, out, o = {}) {
        if (!text) return;
        if (Array.isArray(world.events)) world.events.push({ text, type: 'diplomatic', category: 'political', kingdom: v.junior ? v.junior.id : null });
        const mine = RealmUnions._concerns(player, v);
        if (!o.minor || mine) out.notices.push({ icon: o.icon || '👑', title: o.title || 'Personal Union', text, type: o.type || 'info' });
        if (mine && player.house) House._chronicle(player.house, world, text, ['realm', 'union']);
        if (mine && o.interrupt) Interrupts.raise(world, { reason: o.title || 'Personal union', icon: o.icon || '👑', source: 'realmUnions' });
    },

    _timeline(world, k, key, vars) {
        const cap = k && _obj(k.capital);
        RealmTimeline.note(world, 'crown', cap ? cap.q : null, cap ? cap.r : null, RealmUnions._text(key, vars, ''), 40);
    },

    // ──────────── SAVE / LOAD ────────────

    serialize(world) {
        const st = world && _obj(world.realmUnions);
        return st ? JSON.parse(JSON.stringify(st)) : null;
    },

    restore(saved, world) {
        if (!world) return;
        world.realmUnions = _obj(saved) ? JSON.parse(JSON.stringify(saved)) : null;
        RealmUnions.state(world);
    },
};
