// ============================================
// PENAL LABOUR — the lash, the pillory, the iron, the mines and the oar
// ============================================
// The sentences between a fine and the noose, for the living. Who passes them:
//
//   THE PLAYER AS JUDGE   player/trials.js rule(): flog, stocks, brand, mines,
//                         galleys, outlaw (the verdicts in data/trials.json with
//                         a `penal` id), where the realm's law allows them.
//   THE REALMS' COURTS    weekly (_realmCourts): a town's caught crimes on its
//                         record (settlement.npcCrimes) are sentenced by their
//                         severity under the realm's laws.
//   THE SCAFFOLD'S MERCY  systems/executions.js spare(): the mines or the
//                         galleys instead of death.
//   THE PLAYER TRIED      player/trials.js resolveTrial(): the lash, the pillory,
//                         the court's letter, the mines or the galleys
//                         (sentencePlayer; the labour is indentured servitude
//                         with servitude.penal, player/playerMilitary/combat.js).
//
// THE LAW (data/laws.json): corporal (stocks | lash | iron) and penalLabour
// (none | mines | oars) decide which sentences exist; the punishment law's
// severity scales lashes and terms. Harder law cows thieves (deterrence(), read
// by systems/npcTheft.js) and every public punishment sours the town, more
// under a faith that holds the body sacred (systems/maimFaith.js).
//
// WHAT IS READ ELSEWHERE
//   property.convicts   × a mine's or quarry's staffing (mineStaffing, from
//                       player/playerEconomy/property.js)
//   ship.convictOars    unpaid hands in ship.crew (systems/ships.js wages) and
//                       a sullen ship (its resting morale)
//   unit.convictOars    a war galley's bench: its upkeep cut (galleyUpkeepSaving,
//                       player/playerMilitary/recruitment.js)
//   navy.convictOars    the crown's galley convicts: the royal fleet's upkeep
//                       (world/kingdomNavy.js)
//   person.brandMark    the court's letter: watched (npcTheft catch chance),
//                       the trades (MaimMarks 'brand' work), talk (markAside)
//
// State: world.penal = { next, crown: [convicts], stats } (saved,
// systems/saveLoad.js) and player.penal = { convicts: [convicts at the
// player's sites], scars, served, log, stats } (saved). A convict:
// { id, name, pid, q, r (home), kid, kind, site, siteLabel, crime, from,
// until, by }. Rolls are hashes of the world seed: no shared dice.
// Explicit params; no globals; tuning in data/penalLabour.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Economy } from '../world/economy.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Laws } from './laws.js';
import { Townsfolk } from './townsfolk.js';
import { MaimMarks } from './maimMarks.js';
import { MaimFaith } from './maimFaith.js';
import { NpcMemory } from './npcMemory.js';
import { Ledger } from './ledger.js';
import { House } from './house.js';
import { Ailments } from './ailments.js';
import { Devotion } from './devotion.js';
import { Wanted } from './wanted.js';
import { Underworld } from './underworld.js';
import { Ships } from './ships.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = world => _num(world && world.day);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _fill = (t, vars) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
const _cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const _pname = p => (p ? `${p.first}${p.last ? ` ${p.last}` : ''}` : 'someone');

function _seed(world) {
    const p = world && world.generationParams;
    return (p && p.seed) || 0;
}

function _hash(s) {
    let h = Utils.hashStr(String(s)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
}

/** 0..1, fixed for a key in this world. */
function _roll(world, key) {
    return (_hash(`${_seed(world)}|penal|${key}`) % 100000) / 100000;
}

function _kingdom(world, id) {
    if (!world || id == null) return null;
    if (typeof world.getKingdom === 'function') return world.getKingdom(id) || null;
    return (world.kingdoms || []).find(k => k && String(k.id) === String(id)) || null;
}

function _tile(world, q, r) {
    return world && typeof world.getTile === 'function' && Number.isFinite(q) && Number.isFinite(r) ? world.getTile(q, r) : null;
}

const SENTENCES = ['stocks', 'flog', 'brand', 'mines', 'galleys', 'outlaw'];
const MINE_TYPES = ['mine', 'quarry'];

export const PenalLabour = {
    SENTENCES,

    // ── Tuning ───────────────────────────────────────

    config() {
        const g = DataLoader._gamedata;
        return (g && _obj(g.penalLabour)) || {};
    },

    enabled() {
        return PenalLabour.config().enabled !== false;
    },

    _c(k) { return _obj(PenalLabour.config()[k]) || {}; },

    line(pool, vars = {}, salt = '') {
        const list = (PenalLabour._c('lines')[pool]);
        const arr = Array.isArray(list) ? list : (typeof list === 'string' ? [list] : []);
        if (!arr.length) return '';
        return _fill(arr[_hash(`${pool}|${salt}`) % arr.length], vars);
    },

    // ── State ────────────────────────────────────────

    worldState(world) {
        if (!world) return { next: 1, crown: [], stats: {} };
        if (!_obj(world.penal)) world.penal = { next: 1, crown: [], stats: {} };
        const w = world.penal;
        if (!Array.isArray(w.crown)) w.crown = [];
        if (!_obj(w.stats)) w.stats = {};
        if (!Number.isFinite(w.next)) w.next = 1;
        return w;
    },

    serialize(world) {
        return world && world.penal ? world.penal : null;
    },

    restore(saved, world) {
        if (!world) return;
        world.penal = _obj(saved) ? saved : null;
        if (world.penal) PenalLabour.worldState(world);
    },

    state(player) {
        if (!player) return { convicts: [], scars: 0, served: [], log: [], stats: {} };
        if (!_obj(player.penal)) player.penal = {};
        const st = player.penal;
        if (!Array.isArray(st.convicts)) st.convicts = [];
        if (!Array.isArray(st.served)) st.served = [];
        if (!Array.isArray(st.log)) st.log = [];
        if (!_obj(st.stats)) st.stats = {};
        if (!Number.isFinite(st.scars)) st.scars = 0;
        return st;
    },

    _stat(stats, k, n = 1) { stats[k] = _num(stats[k]) + n; },

    _log(player, world, text) {
        if (!player) return;
        const st = PenalLabour.state(player);
        st.log.push({ day: _day(world), text });
        if (st.log.length > 30) st.log.splice(0, st.log.length - 30);
    },

    // ── The law ──────────────────────────────────────

    /** The realm's corporal law: 'stocks' | 'lash' | 'iron' (its custom until a ruler sets it). */
    corporal(world, kid) {
        if (kid == null) return 'stocks';
        try { return Laws.value(world, kid, 'corporal') || 'stocks'; } catch (e) { return 'stocks'; }
    },

    /** The realm's penal labour law: 'none' | 'mines' | 'oars'. */
    labour(world, kid) {
        if (kid == null) return 'none';
        try { return Laws.value(world, kid, 'penalLabour') || 'none'; } catch (e) { return 'none'; }
    },

    /** × lashes and terms by the realm's punishment law. */
    severity(world, kid) {
        const S = PenalLabour._c('severity');
        let opt = 'standard';
        try { opt = (kid != null && Laws.value(world, kid, 'punishment')) || 'standard'; } catch (e) { opt = 'standard'; }
        return _num(S[opt], 1);
    },

    /** May this sentence be passed in this realm? → { ok, why } */
    allowed(world, kid, sentence) {
        if (!PenalLabour.enabled() || !SENTENCES.includes(sentence)) return { ok: false, why: 'No such sentence.' };
        const C = PenalLabour.config();
        if ((C.always || []).includes(sentence)) {
            if (sentence === 'outlaw' && kid == null) return { ok: false, why: 'Outlawry needs a realm whose peace to put them out of.' };
            return { ok: true, why: '' };
        }
        if (kid == null) return { ok: false, why: 'No realm\'s law here.' };
        const L = PenalLabour._c('laws');
        const corp = PenalLabour.corporal(world, kid);
        const lab = PenalLabour.labour(world, kid);
        const ok = ((L.corporal || {})[corp] || []).includes(sentence) || ((L.penalLabour || {})[lab] || []).includes(sentence);
        if (ok) return { ok: true, why: '' };
        const k = _kingdom(world, kid);
        const realm = (k && k.name) || 'the realm';
        const why = sentence === 'flog' ? `The law of ${realm} keeps no whipping post.`
            : sentence === 'brand' ? `The law of ${realm} does not put the iron to a face.`
                : sentence === 'mines' ? `The law of ${realm} sends no convict to the mines.`
                    : `The law of ${realm} sends no convict to the oars.`;
        return { ok: false, why };
    },

    /** Lashes for a crime of this severity (1..4) here. */
    lashes(world, kid, sev) {
        const F = PenalLabour._c('flog');
        const L = _obj(F.lashes) || {};
        const s = _clamp(Math.round(_num(sev, 2)), 1, 4);
        return Math.max(1, Math.round(_num(L[String(s)], 12 * s) * PenalLabour.severity(world, kid)));
    },

    /** Days of hard labour for a crime of this severity here. */
    termDays(world, kid, sev) {
        const T = PenalLabour._c('terms');
        const s = _clamp(Math.round(_num(sev, 2)), 1, 4);
        return Math.max(7, Math.round(_num(T[String(s)], 60 * s) * PenalLabour.severity(world, kid)));
    },

    /** The court's letter for a crime id (judge crimes, npcCrimes kinds). */
    letterFor(crimeId) {
        const L = PenalLabour._c('letters');
        return L[crimeId] || L.default || 'F';
    },

    /** The court's letter for a player's trial charge group (by a word in it). */
    chargeLetter(group) {
        const g = String(group || '').toLowerCase();
        for (const [w, l] of Object.entries(PenalLabour._c('chargeLetters'))) if (w !== '_doc' && g.includes(w)) return l;
        return PenalLabour.letterFor('default');
    },

    letterName(letter) {
        return PenalLabour._c('letterNames')[letter] || `a court's ${letter || 'F'}`;
    },

    _crimeSeverity(crimeId) {
        const g = DataLoader._gamedata;
        const C = (g && g.trials && g.trials.judge && g.trials.judge.crimes) || {};
        return _num(C[crimeId] && C[crimeId].severity, 2);
    },

    _crimeLabel(crimeId) {
        const g = DataLoader._gamedata;
        const C = (g && g.trials && g.trials.judge && g.trials.judge.crimes) || {};
        return (C[crimeId] && C[crimeId].label) || String(crimeId || 'a crime');
    },

    // ── Deterrence, souring, the crowd ───────────────

    /** × tonight's chance of a theft in this town: the realm's laws, and a recent public punishment. */
    deterrence(world, s, day = _day(world)) {
        if (!s || !PenalLabour.enabled()) return 1;
        const D = PenalLabour._c('deterLaw');
        let m = 1;
        if (s.kingdom != null) {
            m *= _num((D.corporal || {})[PenalLabour.corporal(world, s.kingdom)], 1);
            m *= _num((D.penalLabour || {})[PenalLabour.labour(world, s.kingdom)], 1);
        }
        const f = s.penalFear;
        if (f && _num(f.until) > _num(day)) m *= _clamp(_num(f.m, 1), 0.3, 1);
        return m;
    },

    _fear(s, sentence, day) {
        if (!s) return;
        const F = _obj(PenalLabour._c(sentence).fear);
        if (!F) return;
        const prev = s.penalFear && _num(s.penalFear.until) > day ? _num(s.penalFear.m, 1) : 1;
        s.penalFear = { until: day + _num(F.days, 30), m: Math.round(Math.min(prev, _num(F.m, 1)) * 1000) / 1000 };
    },

    /** How much a public punishment sours this town (× the realm's faith). */
    _sourBy(world, s, sentence) {
        const base = _num(PenalLabour._c(sentence).sour);
        if (!base) return 0;
        const stance = s && s.kingdom != null ? MaimFaith.realmStance(world, s.kingdom) : 'mild';
        return base * _num((PenalLabour._c('faith').sour || {})[stance], 1);
    },

    /**
     * The square's mood at a flogging or the stocks: 'jeer' | 'quiet' | 'pity'.
     * o = { guilty, severity, stranger }. → { mood, score, text }
     */
    crowd(world, s, p, o = {}) {
        const C = PenalLabour._c('crowd');
        let score = o.guilty === false ? -1.5 : 1;
        const folk = s && s.folk;
        if (folk && p) {
            let kin = 0;
            const ids = [p.spouse, ...(p.parents || []), ...(p.kids || [])];
            for (const id of ids) { const k = id != null ? Townsfolk.get(folk, id) : null; if (k && Townsfolk.isHere(k)) kin++; }
            score -= kin * 0.4;
            if (p.role === 'noble') score -= 0.5;
            if (p.job && p.job.id === 'beggar') score += 0.5;
        } else score += 0.5;
        if (o.stranger) score += 0.5;
        const happy = s && typeof s.happiness === 'number' ? s.happiness : 50;
        if (happy < 40) score -= (40 - happy) * 0.04;
        score += _num(o.severity, 2) * 0.3 - 0.6;
        score += (_roll(world, `crowd|${s ? `${s.q},${s.r}` : ''}|${p ? p.id : o.salt || ''}|${_day(world)}`) * 2 - 1);
        const mood = score >= _num(C.jeer, 1) ? 'jeer' : score <= _num(C.pity, -0.5) ? 'pity' : 'quiet';
        return { mood, score, text: PenalLabour.line(mood, {}, `${p ? p.id : ''}|${_day(world)}`) };
    },

    /** The pillory in the square while someone sits there or is tied to the post (world/scaffolds.js lays it). */
    _pillory(s, ref, name, from, until, why) {
        if (!s) return;
        const cur = s.pillory;
        // (a tenant in the stocks for rent keeps the pillory until they are out: systems/peopleCrimes.js)
        if (cur && _num(cur.until) >= from && !String(cur.ref || '').startsWith('pen')) return;
        s.pillory = { ref: `pen${ref}`, name, from, until, why };
    },

    // ══════════════════════════════════════════════
    // WHERE CONVICTS GO
    // ══════════════════════════════════════════════

    _siteLabel(world, kind, kid) {
        const k = _kingdom(world, kid);
        const M = PenalLabour._c(kind);
        return `${M.label || (kind === 'mines' ? 'the mines' : 'the galleys')} of ${(k && k.name) || 'the crown'}`;
    },

    _shipRoom(ship) {
        const need = Ships.getShipEffectiveStats(ship).crewRequired;
        return Math.max(0, need - Ships.getCrew(ship));
    },

    /**
     * Where a convict of `kind` could serve: the player's own sites with room
     * first (a mine or quarry, a ship with an empty berth, a war galley's
     * bench), then the crown's gang of the realm, where its law sends convicts.
     * → [{ key, kind, type: 'property'|'ship'|'galley'|'crown', label, room, n }]
     */
    sites(player, world, kind, kid = null) {
        const out = [];
        if (player) {
            const st = PenalLabour.state(player);
            const count = key => st.convicts.filter(c => c.site === key).length;
            if (kind === 'mines') {
                const M = PenalLabour._c('mines');
                const seen = new Set();
                for (const rec of player.properties || []) {
                    if (!rec || !MINE_TYPES.includes(rec.type)) continue;
                    const t = _tile(world, rec.q, rec.r);
                    for (const prop of (t && t.playerProperties) || []) {
                        if (!prop || !MINE_TYPES.includes(prop.type) || prop.underConstruction) continue;
                        const key = `prop:${rec.q},${rec.r}:${prop.type}`;
                        if (seen.has(key)) continue;
                        seen.add(key);
                        const cap = _num(M.gangPerLevel, 6) * Math.max(1, _num(prop.level, 1));
                        const n = count(key);
                        out.push({ key, kind, type: 'property', label: `your ${String(prop.name || prop.type).toLowerCase()} at ${(t.settlement && t.settlement.name) || `${rec.q},${rec.r}`}`, room: Math.max(0, cap - n), n });
                    }
                }
            } else if (kind === 'galleys') {
                const G = PenalLabour._c('galleys');
                for (const ship of player.ships || []) {
                    if (!ship || ship.status === 'building') continue;
                    const key = `ship:${ship.id}`;
                    out.push({ key, kind, type: 'ship', label: `the ${ship.name}`, room: PenalLabour._shipRoom(ship), n: count(key) });
                }
                (player.army || []).forEach((u, i) => {
                    if (!Ships.isNavalUnit(u)) return;
                    if (!u.galleyId) u.galleyId = `g${_day(world)}_${i}_${(player.army || []).length}`;
                    const key = `galley:${u.galleyId}`;
                    const n = count(key);
                    out.push({ key, kind, type: 'galley', label: `your ${u.name || 'war galley'}`, room: Math.max(0, _num(G.bench, 30) - n), n });
                });
            }
        }
        if (kid != null && PenalLabour.allowed(world, kid, kind).ok) {
            const w = PenalLabour.worldState(world);
            const key = `crown:${kid}:${kind}`;
            const room = Math.max(0, _num(PenalLabour.config().crownCap, 400) - w.crown.length);
            out.push({ key, kind, type: 'crown', label: PenalLabour._siteLabel(world, kind, kid), room, n: w.crown.filter(c => c.site === key).length });
        }
        return out;
    },

    /** The best place for one more convict (the player's own with room, else the crown's), or null. */
    siteFor(player, world, kind, kid, prefer = null) {
        const all = PenalLabour.sites(player, world, kind, kid).filter(x => x.room > 0);
        if (prefer) { const p = all.find(x => x.key === prefer); if (p) return p; }
        return all[0] || null;
    },

    /** The object a site key names, or null (gone: sold, wrecked, fallen). */
    _siteObj(player, world, key) {
        const m = /^(prop|ship|galley|crown):(.+)$/.exec(String(key || ''));
        if (!m) return null;
        if (m[1] === 'prop') {
            const mm = /^(-?\d+),(-?\d+):(\w+)$/.exec(m[2]);
            const t = mm ? _tile(world, Number(mm[1]), Number(mm[2])) : null;
            const prop = t && (t.playerProperties || []).find(p => p && p.type === mm[3]);
            return prop ? { type: 'property', obj: prop, q: Number(mm[1]), r: Number(mm[2]) } : null;
        }
        if (m[1] === 'ship') {
            const ship = (player && player.ships || []).find(s => s && String(s.id) === m[2]);
            return ship ? { type: 'ship', obj: ship, q: ship.q, r: ship.r } : null;
        }
        if (m[1] === 'galley') {
            const u = (player && player.army || []).find(x => x && x.galleyId === m[2]);
            return u ? { type: 'galley', obj: u, q: player.q, r: player.r } : null;
        }
        return { type: 'crown' };
    },

    /** Convicts at one of the player's sites (a property, a ship or a war galley). */
    convictsAt(player, key) {
        return PenalLabour.state(player).convicts.filter(c => c.site === key);
    },

    /** The site key of a property on (q, r). */
    propertyKey(q, r, prop) { return `prop:${q},${r}:${prop && prop.type}`; },

    /** Write the counts the other systems read onto each site (property.convicts, ship/unit.convictOars). */
    _syncSites(player, world) {
        if (!player) return;
        const st = PenalLabour.state(player);
        const by = new Map();
        for (const c of st.convicts) by.set(c.site, _num(by.get(c.site)) + 1);
        for (const rec of player.properties || []) {
            if (!rec || !MINE_TYPES.includes(rec.type)) continue;
            const t = _tile(world, rec.q, rec.r);
            for (const prop of (t && t.playerProperties) || []) {
                if (prop && MINE_TYPES.includes(prop.type)) {
                    const n = _num(by.get(`prop:${rec.q},${rec.r}:${prop.type}`));
                    if (n) prop.convicts = n; else delete prop.convicts;
                }
            }
        }
        for (const ship of player.ships || []) {
            if (!ship) continue;
            const n = _num(by.get(`ship:${ship.id}`));
            if (n) ship.convictOars = n; else delete ship.convictOars;
        }
        for (const u of player.army || []) {
            if (!u || !u.galleyId) continue;
            const n = _num(by.get(`galley:${u.galleyId}`));
            if (n) u.convictOars = n; else delete u.convictOars;
        }
    },

    // ── Read by the economy ──────────────────────────

    /** A mine's or quarry's staffing with its convict gang: staffing + perConvict each, at most maxBoost more. */
    mineStaffing(property, staffing = 1) {
        const n = _num(property && property.convicts);
        if (!n || !property || !MINE_TYPES.includes(property.type)) return staffing;
        const M = PenalLabour._c('mines');
        return staffing + Math.min(_num(M.maxBoost, 0.8), n * _num(M.perConvict, 0.1));
    },

    /** Gold a day a war galley's convict bench saves of its upkeep (at most half of it). */
    galleyUpkeepSaving(unit) {
        const n = _num(unit && unit.convictOars);
        if (!n) return 0;
        return Math.min(_num(unit.upkeep) * 0.5, n * _num(PenalLabour._c('galleys').oarSave, 0.3));
    },

    /** × the chance this townsperson is caught at a theft: the watch knows a branded face. */
    watchedMult(p) {
        return p && p.brandMark ? _num(PenalLabour._c('brand').watched, 1.6) : 1;
    },

    // ══════════════════════════════════════════════
    // SENTENCING THE TOWN'S FOLK
    // ══════════════════════════════════════════════

    /**
     * Carry out a sentence on a townsperson. o = { settlement, folk, person,
     * sentence, crimeId, crimeLabel, severity, kingdomId, by: 'player'|'crown',
     * site (preferred site key), guilty }. → { ok, text, reason, fx (Petitions
     * effects for the player's court), died, convict }
     */
    sentenceFolk(player, world, o = {}) {
        const { folk, person: p } = o;
        const s = o.settlement || null;
        const sentence = o.sentence;
        if (!PenalLabour.enabled()) return { ok: false, reason: 'Not in this world.' };
        if (!p || p.died != null || p.away) return { ok: false, reason: 'There is no one to sentence.' };
        const kid = o.kingdomId != null ? o.kingdomId : (s ? s.kingdom : null);
        const can = PenalLabour.allowed(world, kid, sentence);
        if (!can.ok) return { ok: false, reason: can.why };
        const day = _day(world);
        const byPlayer = o.by !== 'crown' && !!player;
        const sev = _clamp(Math.round(_num(o.severity, PenalLabour._crimeSeverity(o.crimeId))), 1, 4);
        const crime = o.crimeLabel || PenalLabour._crimeLabel(o.crimeId);
        const name = _pname(p);
        const town = (s && s.name) || 'the town';
        const k = _kingdom(world, kid);
        const vars = { name, town, crime, realm: (k && k.name) || 'the realm' };
        const fx = {};
        const sour = (n) => {
            if (!n) return;
            if (byPlayer) fx.happiness = _num(fx.happiness) - n;
            else if (s) s.happiness = _clamp(Math.round((_num(s.happiness, 50) - n) * 100) / 100, 0, 100);
        };
        const remember = (kind, kin = true) => {
            if (!byPlayer || !folk) return;
            NpcMemory.remember(world, { folk, person: p }, { kind, player, kin });
        };
        const W = PenalLabour.worldState(world);
        const stats = W.stats;
        let text = '';
        let died = false;
        let convict = null;

        if (sentence === 'flog') {
            const F = PenalLabour._c('flog');
            const lashes = PenalLabour.lashes(world, kid, sev);
            const age = Townsfolk.age(p, day);
            let pDie = Math.min(_num(F.deathMax, 0.15), lashes * _num(F.deathPerLash, 0.0012) * (age >= _num(F.oldAge, 55) ? _num(F.oldMult, 2.5) : 1));
            if (Townsfolk.injury(p, day)) pDie *= 1.5;
            const c = PenalLabour.crowd(world, s, p, { guilty: o.guilty, severity: sev });
            PenalLabour._pillory(s, p.id, name, day, day, 'flogging');
            vars.lashes = lashes;
            if (_roll(world, `flogDie|${p.id}|${day}`) < pDie) {
                died = true;
                if (folk) {
                    if (byPlayer) {
                        NpcMemory.rememberKin(world, { folk, person: p }, { kind: 'flogged_dead', player });
                        NpcMemory.rememberTown(world, s || folk, { kind: 'flogged_dead', player, victim: name });
                    }
                    Townsfolk.slay(folk, p, day, 'the lash', world);
                    Townsfolk.record(folk, world, day, { k: 'townMemory', x: `${name} died under the lash in the square {when}` });
                }
                text = PenalLabour.line('flogDied', vars, p.id);
                sour(PenalLabour._sourBy(world, s, 'flog') * 3);
                PenalLabour._stat(stats, 'flogDied');
            } else {
                const max = _num(F.hurtMax, 10);
                Townsfolk.injure(p, day, Math.max(1, max - lashes * _num(F.hurtPerLash, 0.12)), max);
                p.lashed = _num(p.lashed) + 1;
                Townsfolk.note(p, day, 'penal', null, `I was flogged at the post for ${crime}`);
                remember('flogged');
                text = `${PenalLabour.line('flog', vars, p.id)} ${c.text}`.trim();
            }
            sour(PenalLabour._sourBy(world, s, 'flog') * (c.mood === 'pity' ? 2 : 1));
            if (c.mood === 'pity') sour(-_num(PenalLabour._c('crowd').pityHappiness, -2));
            else if (c.mood === 'jeer' && byPlayer) fx.happiness = _num(fx.happiness) + _num(PenalLabour._c('crowd').jeerHappiness, 1);
            PenalLabour._fear(s, 'flog', day);
            PenalLabour._stat(stats, 'flogged');
            PenalLabour._faithCost(player, world, kid, byPlayer);
        } else if (sentence === 'stocks') {
            const S = PenalLabour._c('stocks');
            const days = Math.max(1, Math.round(_num(S.days, 1)));
            const c = PenalLabour.crowd(world, s, p, { guilty: o.guilty, severity: sev });
            PenalLabour._pillory(s, p.id, name, day, day + days, crime);
            p.jailedUntil = Math.max(_num(p.jailedUntil), day + days);
            if (c.mood === 'jeer') {
                const [lo, hi] = PenalLabour._c('crowd').pelt || [2, 5];
                const max = _num(S.hurtMax, 10);
                Townsfolk.injure(p, day, max - Math.round(lo + _roll(world, `pelt|${p.id}|${day}`) * (hi - lo)), max);
            }
            Townsfolk.note(p, day, 'penal', null, `I sat in the pillory of ${town} for ${crime}`);
            remember('pilloried');
            text = `${PenalLabour.line('stocks', vars, p.id)} ${c.text}`.trim();
            if (c.mood === 'pity') sour(-_num(PenalLabour._c('crowd').pityHappiness, -2));
            sour(PenalLabour._sourBy(world, s, 'stocks'));
            PenalLabour._fear(s, 'stocks', day);
            PenalLabour._stat(stats, 'pilloried');
        } else if (sentence === 'brand') {
            const why = MaimMarks.whyNot(p, 'brand');
            if (why) return { ok: false, reason: `${name} already bears a brand.` };
            const letter = PenalLabour.letterFor(o.crimeId);
            MaimMarks.mark(p, 'brand', { day, by: byPlayer ? 'your court' : 'the court', why: crime, patch: false });
            p.brandMark = { l: letter, c: crime, d: day, k: kid, t: town, by: byPlayer ? 'player' : 'crown' };
            Townsfolk.injure(p, day, 10 - _num(PenalLabour._c('brand').hurt, 3), 10);
            Townsfolk.note(p, day, 'penal', null, `The court burned ${PenalLabour.letterName(letter)} into my cheek for ${crime}`);
            remember('court_branded');
            vars.letter = `a ${letter}`;
            text = PenalLabour.line('brand', vars, p.id);
            PenalLabour._pillory(s, p.id, name, day, day, 'the iron');
            sour(PenalLabour._sourBy(world, s, 'brand'));
            PenalLabour._fear(s, 'brand', day);
            PenalLabour._stat(stats, 'branded');
            PenalLabour._faithCost(player, world, kid, byPlayer);
        } else if (sentence === 'mines' || sentence === 'galleys') {
            const site = PenalLabour.siteFor(byPlayer ? player : null, world, sentence, kid, o.site || null);
            if (!site) return { ok: false, reason: sentence === 'mines' ? 'There is no mine to send them to.' : 'There is no oar to chain them to.' };
            const days = Math.max(7, Math.round(_num(o.days, PenalLabour.termDays(world, kid, sev))));
            convict = {
                id: W.next++, name, pid: p.id, q: folk ? folk.q : (s ? s.q : null), r: folk ? folk.r : (s ? s.r : null), kid, kind: sentence,
                site: site.key, siteLabel: site.label, crime, crimeId: o.crimeId || null, from: day, until: day + days, by: byPlayer && site.type !== 'crown' ? 'player' : byPlayer ? 'player-crown' : 'crown',
            };
            if (folk) Townsfolk.leavePurse(folk, p, world, day, {});
            p.jailedUntil = null;
            p.away = { d: day, to: site.label, convict: convict.id, missing: true };
            Townsfolk.note(p, day, 'penal', null, `I was sentenced to ${site.label} for ${crime}`);
            remember(sentence === 'mines' ? 'sent_mines' : 'sent_galleys');
            if (site.type === 'crown') W.crown.push(convict);
            else {
                PenalLabour.state(player).convicts.push(convict);
                // (a ship's convict fills an empty berth: one more hand in her crew, no wage)
                const so = PenalLabour._siteObj(player, world, site.key);
                if (so && so.type === 'ship') { Ships._ensureCrew(so.obj); so.obj.crew += 1; }
                PenalLabour._syncSites(player, world);
            }
            vars.site = site.label;
            vars.days = days;
            text = PenalLabour.line(sentence, vars, p.id);
            PenalLabour._stat(stats, sentence === 'mines' ? 'toMines' : 'toGalleys');
        } else if (sentence === 'outlaw') {
            if (sev < _num(PenalLabour._c('outlaw').minSeverity, 2)) return { ok: false, reason: `Outlawry is not for ${crime}.` };
            let forfeit = 0;
            if (folk) {
                Townsfolk.purse(folk, p, world);
                forfeit = Utils.centsDown(Math.max(0, _num(p.purse)));
                if (forfeit > 0) {
                    p.purse = Utils.cents(_num(p.purse) - forfeit);
                    if (byPlayer) { player.gold = Utils.cents(_num(player.gold) + forfeit); Ledger.record(player, 'courtFines', forfeit); } else if (k) k.treasury = Utils.cents(_num(k.treasury) + forfeit);
                }
            }
            p.jailedUntil = null;
            p.away = { d: day, to: 'the greenwood', outlaw: true };
            Townsfolk.note(p, day, 'penal', null, `I was put out of the peace of ${vars.realm} for ${crime}`);
            if (byPlayer && folk) NpcMemory.rememberKin(world, { folk, person: p }, { kind: 'outlawed', player });
            text = `${PenalLabour.line('outlaw', vars, p.id)}${forfeit > 0 ? ` ${Utils.formatGold(forfeit)} gold is forfeit${byPlayer ? ' to your court' : ' to the crown'}.` : ''}`;
            PenalLabour._stat(stats, 'outlawed');
        }
        if (byPlayer) PenalLabour._log(player, world, text);
        if (folk && sentence !== 'flog' && !died) Townsfolk.record(folk, world, day, { k: 'townMemory', x: `${name} was sentenced to ${sentence === 'stocks' ? 'the pillory' : sentence === 'flog' ? 'the lash' : sentence === 'brand' ? 'the iron' : sentence === 'outlaw' ? 'outlawry' : `the ${sentence}`} for ${crime} {when}` });
        return { ok: true, text, fx, died, convict };
    },

    /** A player judge who orders the lash or the iron under a faith that holds the body sacred: standing with it lost. */
    _faithCost(player, world, kid, byPlayer) {
        if (!byPlayer || !player || kid == null) return;
        const stance = MaimFaith.realmStance(world, kid);
        const n = _num((PenalLabour._c('faith').devotion || {})[stance]);
        const f = n > 0 ? MaimFaith.realmFaith(world, kid) : null;
        if (f) { try { Devotion._addStanding(player, f, -n); } catch (e) { /* no devotion */ } }
    },

    /** What a penal verdict would do here, for the court's panel: "To your mine at X (3 there)". */
    verdictNote(player, world, c, sentence) {
        if (!c) return '';
        if (sentence === 'flog') return `${PenalLabour.lashes(world, c.kingdomId, c.severity)} lashes by the law here.`;
        if (sentence === 'brand') return `${_cap(PenalLabour.letterName(PenalLabour.letterFor(c.crime)))}, for life.`;
        if (sentence === 'mines' || sentence === 'galleys') {
            const site = PenalLabour.siteFor(player, world, sentence, c.kingdomId);
            const days = PenalLabour.termDays(world, c.kingdomId, c.severity);
            return site ? `${days} days at ${site.label}.` : 'Nowhere to send them.';
        }
        return '';
    },

    // ══════════════════════════════════════════════
    // THE DAY
    // ══════════════════════════════════════════════

    /** The day's end: the player's convicts daily; the crown's gangs and the realms' courts weekly. → { notices } */
    processDay(world, player = null) {
        const out = { notices: [] };
        if (!world || !PenalLabour.enabled()) return out;
        const day = _day(world);
        if (player) PenalLabour._playerSitesDay(world, player, day, out);
        const R = PenalLabour._c('realm');
        const every = Math.max(1, Math.round(_num(R.everyDays, 7)));
        if (day % every === _num(R.offset, 3) % every) {
            PenalLabour._crownWeek(world, day, player, out, every);
            PenalLabour._realmCourts(world, day, R);
        }
        return out;
    },

    /** A convict goes home at the end of their term (or stays gone: the town fell). */
    _release(world, c, how, day) {
        const t = _tile(world, c.q, c.r);
        const folk = t && t.settlement && t.settlement.folk;
        const p = folk && c.pid != null ? Townsfolk.get(folk, c.pid) : null;
        const M = PenalLabour._c(c.kind);
        if (!p || p.died != null) return { p: null, folk };
        if (how === 'served') {
            p.away = null;
            const max = 10;
            Townsfolk.injure(p, day, max - _num(M.returnHurt, 3), max);
            p.served = { k: c.kind, d: day, s: c.siteLabel };
            Townsfolk.note(p, day, 'penal', null, `I came home from ${c.siteLabel}, after ${Math.max(1, Math.round((day - c.from) / 30))} months of it`);
            Townsfolk.record(folk, world, day, { k: 'townMemory', x: `${_pname(p)} came home from ${c.siteLabel} {when}` });
        } else if (how === 'died') {
            if (p.away) p.away = null;
            Townsfolk.slay(folk, p, day, c.kind === 'mines' ? 'the mines' : 'the galleys', world);
            Townsfolk.record(folk, world, day, { k: 'townMemory', x: `${_pname(p)} died at ${c.siteLabel} {when}` });
        } else {
            p.away = { d: day, to: 'the hills', escaped: true };
            Townsfolk.note(p, day, 'penal', null, `I broke out of ${c.siteLabel}`);
        }
        return { p, folk };
    },

    _endConvict(world, player, c, how, day, out) {
        const W = PenalLabour.worldState(world);
        const { p, folk } = PenalLabour._release(world, c, how, day);
        PenalLabour._stat(W.stats, how === 'served' ? 'served' : how === 'died' ? 'died' : 'escaped');
        const mine = c.by === 'player' || c.by === 'player-crown';
        if (mine && player) {
            const st = PenalLabour.state(player);
            PenalLabour._stat(st.stats, how);
            if (how === 'died' && folk && p) NpcMemory.rememberKin(world, { folk, person: p }, { kind: 'died_labour', player });
            const home = _tile(world, c.q, c.r);
            const vars = { name: c.name, town: (home && home.settlement && home.settlement.name) || 'their town', site: c.siteLabel };
            const text = PenalLabour.line(how === 'served' ? 'returned' : how === 'died' ? 'diedAway' : 'escaped', vars, c.id);
            if (text) {
                PenalLabour._log(player, world, text);
                if (out && c.by === 'player') out.notices.push({ icon: how === 'served' ? '🚶' : how === 'died' ? '⚰️' : '🏃', title: how === 'served' ? 'A Term Served' : how === 'died' ? 'A Convict Dead' : 'A Convict Escaped', text, type: how === 'served' ? 'info' : 'warning' });
            }
        }
    },

    /** The player's own sites: rations, the ships' benches (losses, mutiny, the port), the days' rolls, terms ending. */
    _playerSitesDay(world, player, day, out) {
        const st = PenalLabour.state(player);
        if (!st.convicts.length) return;
        const keep = [];
        // Rations: bread bought in the town nearest each site, out of the keeper's purse
        const bySite = new Map();
        for (const c of st.convicts) { if (!bySite.has(c.site)) bySite.set(c.site, []); bySite.get(c.site).push(c); }
        const hungry = new Set();
        const gone = new Set();
        for (const [key, list] of bySite) {
            const so = PenalLabour._siteObj(player, world, key);
            if (!so || so.type === 'crown') {
                // The mine sold, the ship lost, the galley disbanded: the crown takes them, or (no realm's law) they go free
                for (const c of list) {
                    if (c.kid != null && PenalLabour.allowed(world, c.kid, c.kind).ok) {
                        const site = `crown:${c.kid}:${c.kind}`;
                        PenalLabour.worldState(world).crown.push({ ...c, site, siteLabel: PenalLabour._siteLabel(world, c.kind, c.kid), by: 'player-crown' });
                    } else PenalLabour._endConvict(world, player, c, 'escaped', day, out);
                    gone.add(c.id);
                }
                continue;
            }
            const M = PenalLabour._c(list[0].kind);
            // (a ship's bench eats from her hold with the crew: systems/ships.js provisions)
            const cost = so.type === 'ship' ? 0 : Utils.cents(list.length * _num(M.rations, 0.25));
            if (cost > 0) {
                if (_num(player.gold) >= cost) {
                    player.gold = Utils.cents(_num(player.gold) - cost);
                    Ledger.record(player, 'convicts', -cost);
                    if (!Economy.payNearest(world, so.q, so.r, cost)) Economy.payNearest(world, player.q, player.r, cost);
                } else for (const c of list) hungry.add(c.id);
            }
            // A ship's bench: the crew shrank under them (a fight, a storm, deserters) — the convicts were among the lost
            if (so.type === 'ship') {
                const ship = so.obj;
                Ships._ensureCrew(ship);
                let over = list.filter(c => !gone.has(c.id)).length - Math.max(0, ship.crew);
                for (const c of list) {
                    if (over <= 0) break;
                    PenalLabour._endConvict(world, player, c, _roll(world, `lost|${c.id}|${day}`) < 0.5 ? 'died' : 'escaped', day, out);
                    gone.add(c.id);
                    over--;
                }
                const left = list.filter(c => !gone.has(c.id));
                // Mutiny at sea: a sullen bench, a big share of the crew
                const G = PenalLabour._c('galleys');
                const Mu = _obj(G.mutiny) || {};
                const share = ship.crew > 0 ? left.length / ship.crew : 0;
                if (ship.status !== 'docked' && left.length && share >= _num(Mu.share, 0.35) && Ships.getMorale(ship) < _num(Mu.morale, 35)
                    && _roll(world, `mutiny|${ship.id}|${day}`) < _num(Mu.perDay, 0.03)) {
                    const [lo, hi] = Mu.killed || [1, 3];
                    const killed = Math.min(Math.max(0, ship.crew - left.length), lo + Math.floor(_roll(world, `mutinyK|${ship.id}|${day}`) * (hi - lo + 1)));
                    for (const c of left) { PenalLabour._endConvict(world, player, c, 'escaped', day, null); gone.add(c.id); }
                    ship.crew = Math.max(0, ship.crew - left.length - killed);
                    Ships._setMorale(ship, Ships.getMorale(ship) + _num(Mu.morale_after, -15));
                    PenalLabour._stat(st.stats, 'mutinies');
                    const text = `The convicts at the oars of the ${ship.name} rose in the night: ${killed} of her crew are dead, and ${left.length} chained men took the boats and are gone.`;
                    PenalLabour._log(player, world, text);
                    out.notices.push({ icon: '⚓', title: 'Mutiny at the Oars', text, type: 'error' });
                }
            }
        }
        for (const c of st.convicts) {
            if (gone.has(c.id)) continue;
            if (day >= c.until) {
                if (c.site.startsWith('ship:')) { const so = PenalLabour._siteObj(player, world, c.site); if (so) so.obj.crew = Math.max(0, _num(so.obj.crew) - 1); }
                PenalLabour._endConvict(world, player, c, 'served', day, out);
                continue;
            }
            const M = PenalLabour._c(c.kind);
            const so = PenalLabour._siteObj(player, world, c.site);
            const hunger = hungry.has(c.id) ? 2 : 1;
            const docked = !(so && so.type === 'ship') || so.obj.status === 'docked';
            const esc = c.kind === 'mines' ? _num(M.escapePerWeek, 0.008) : docked ? _num(M.escapeDockedPerWeek, 0.03) : _num(M.escapeAtSeaPerWeek, 0.004);
            const u = _roll(world, `day|${c.id}|${day}`);
            const pDie = _num(M.deathPerWeek, 0.01) / 7 * hunger;
            const pEsc = esc / 7 * hunger;
            if (u < pDie || u < pDie + pEsc) {
                const how = u < pDie ? 'died' : 'escaped';
                if (so && so.type === 'ship') so.obj.crew = Math.max(0, _num(so.obj.crew) - 1);
                PenalLabour._endConvict(world, player, c, how, day, out);
                continue;
            }
            keep.push(c);
        }
        st.convicts = keep;
        PenalLabour._syncSites(player, world);
    },

    /** The crown's gangs, weekly: rations, ore to the capital's market and coin to the chests, oars for the fleet, deaths, escapes, terms. */
    _crownWeek(world, day, player, out, every) {
        const W = PenalLabour.worldState(world);
        if (!W.crown.length && !(player && player.indenturedServitude && player.indenturedServitude.penal)) {
            for (const k of world.kingdoms || []) if (k && k.navy && k.navy.convictOars) k.navy.convictOars = 0;
            return;
        }
        const keep = [];
        const byRealm = new Map();
        for (const c of W.crown) {
            if (day >= c.until) { PenalLabour._endConvict(world, player, c, 'served', day, out); continue; }
            const M = PenalLabour._c(c.kind);
            const esc = c.kind === 'mines' ? _num(M.escapePerWeek, 0.008) : _num(M.escapeDockedPerWeek, 0.03) * 0.4;
            const pDie = _num(M.deathPerWeek, 0.01) * every / 7;
            const u = _roll(world, `crown|${c.id}|${day}`);
            if (u < pDie) { PenalLabour._endConvict(world, player, c, 'died', day, out); continue; }
            if (u < pDie + esc * every / 7) { PenalLabour._endConvict(world, player, c, 'escaped', day, out); continue; }
            keep.push(c);
            const key = String(c.kid);
            if (!byRealm.has(key)) byRealm.set(key, { kid: c.kid, mines: 0, galleys: 0 });
            byRealm.get(key)[c.kind === 'mines' ? 'mines' : 'galleys']++;
        }
        W.crown = keep;
        // The player at the crown's labour is one of its gang
        const pen = player && player.indenturedServitude && player.indenturedServitude.penal;
        if (pen && pen.kingdomId != null) {
            const key = String(pen.kingdomId);
            if (!byRealm.has(key)) byRealm.set(key, { kid: pen.kingdomId, mines: 0, galleys: 0 });
            byRealm.get(key)[pen.kind === 'mines' ? 'mines' : 'galleys']++;
        }
        const g = DataLoader._gamedata;
        const GOODS = (g && g.playerEconomy && g.playerEconomy.GOODS) || {};
        const M = PenalLabour._c('mines');
        const G = PenalLabour._c('galleys');
        for (const k of world.kingdoms || []) if (k && k.navy) k.navy.convictOars = 0;
        for (const r of byRealm.values()) {
            const k = _kingdom(world, r.kid);
            if (!k || k.isAlive === false) continue;
            // The bread for the chained, bought in the realm's towns out of the chests
            const rations = Utils.cents((r.mines * _num(M.rations, 0.25) + r.galleys * _num(G.rations, 0.2)) * every);
            if (rations > 0) Economy.crownSpend(k, world, rations);
            // The ore: into the capital's market; the capital's purse pays the crown for it
            if (r.mines > 0 && k.capital) {
                const t = _tile(world, k.capital.q, k.capital.r);
                const s = t && t.settlement;
                const goods = Array.isArray(M.crownGoods) && M.crownGoods.length ? M.crownGoods : [M.crownGood || 'iron'];
                const good = goods[_hash(`${_seed(world)}|crownOre|${k.id}`) % goods.length];
                const qty = Math.round(r.mines * _num(M.crownPerWeek, 0.5) * every / 7 * 100) / 100;
                if (s && qty > 0 && SettlementMarket.tracks(good)) {
                    SettlementMarket.add(s, good, qty);
                    const unit = _num((GOODS[String(good).toUpperCase()] || {}).basePrice, 10) * _num(M.crownPriceShare, 0.6);
                    const paid = Economy.drawTown(s, Utils.cents(qty * unit));
                    if (paid > 0) k.treasury = Utils.cents(_num(k.treasury) + paid);
                    PenalLabour._stat(W.stats, 'crownOre', qty);
                }
            }
            // The oars: unpaid rowers in the royal fleet (world/kingdomNavy.js reads it)
            if (r.galleys > 0) {
                if (!k.navy) k.navy = {};
                k.navy.convictOars = r.galleys;
            }
        }
    },

    /** The realms' own courts: caught crimes on a town's record, sentenced by the realm's laws (a hash roll each). */
    _realmCourts(world, day, R) {
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        const pick = _obj(R.pick) || {};
        let towns = 0;
        for (const v of views) {
            const s = (v && v.settlement) || v;
            if (!s || !s.folk || !Array.isArray(s.folk.people) || !Array.isArray(s.npcCrimes) || s.kingdom == null) continue;
            if (towns >= _num(R.townsPerWeek, 40)) break;
            let did = false;
            for (const e of s.npcCrimes) {
                if (!e || !e.caught || e.penal || e.maimDone || e.byPid == null || day - _num(e.d) > _num(R.recordDays, 40)) continue;
                e.penal = 'heard';
                if (_roll(world, `court|${s.q},${s.r}|${e.id}|${e.d}`) >= _num(R.act, 0.45)) continue;
                const p = Townsfolk.get(s.folk, e.byPid);
                if (!p || !Townsfolk.isHere(p)) continue;
                const sev = PenalLabour._crimeSeverity(e.k);
                const list = pick[String(_clamp(sev, 1, 4))] || [];
                const sentence = list.find(x => PenalLabour.allowed(world, s.kingdom, x).ok && (x !== 'brand' || !MaimMarks.whyNot(p, 'brand')));
                if (!sentence) continue;
                const r = PenalLabour.sentenceFolk(null, world, { settlement: s, folk: s.folk, person: p, sentence, crimeId: e.k, severity: sev, kingdomId: s.kingdom, by: 'crown', guilty: true });
                if (r.ok) { e.penal = sentence; did = true; }
            }
            if (did) towns++;
        }
    },

    // ══════════════════════════════════════════════
    // THE PLAYER SENTENCED
    // ══════════════════════════════════════════════

    /**
     * The sentence of a court on the player (player/trials.js resolveTrial).
     * kind: 'flogged' | 'pilloried' | 'mines' | 'galleys'. ctx = { kingdomId,
     * town, q, r, days, crime, severity, jail (the jailState held on remand) }.
     * → { ok, text }
     */
    sentencePlayer(player, world, kind, ctx = {}) {
        const P = PenalLabour._c('player');
        const day = _day(world);
        const kid = ctx.kingdomId != null ? ctx.kingdomId : null;
        const k = _kingdom(world, kid);
        const realm = (k && k.name) || ctx.town || 'the realm';
        const rep = n => { if (kid != null && n) { if (!player.reputation) player.reputation = {}; player.reputation[kid] = _num(player.reputation[kid]) + n; } };
        const st = PenalLabour.state(player);
        const t = _tile(world, ctx.q, ctx.r);
        const s = t && t.settlement;
        if (kind === 'flogged') {
            const lashes = PenalLabour.lashes(world, kid, ctx.severity || 2);
            const loss = Math.round(lashes * _num(P.hpPerLash, 0.6));
            player.health = Math.max(_num(P.minHealth, 5), _num(player.health, 100) - loss);
            let wound = null;
            try { wound = Ailments.inflict(player, world, P.wound || 'flogged_back', { source: 'flogged' }); } catch (e) { wound = null; }
            player.renown = Math.max(0, _num(player.renown) + _num(P.renown, -3));
            rep(_num(P.reputation, -4));
            st.scars++;
            st.served.push({ kind: 'flogged', day, realm, lashes, crime: ctx.crime || null });
            if (s) { PenalLabour._pillory(s, 'player', player.name || 'you', day, day, 'flogging'); PenalLabour._fear(s, 'flog', day); }
            if (player.house) House._chronicle(player.house, world, `${player.name || 'The head of the House'} was flogged at ${ctx.town || 'a court'}${ctx.crime ? ` for ${ctx.crime}` : ''}: ${lashes} lashes.`, ['trial', 'flogged']);
            PenalLabour._log(player, world, `Flogged at ${ctx.town || 'court'}: ${lashes} lashes.`);
            return { ok: true, lashes, text: `Guilty: ${lashes} lashes at the post in the square of ${ctx.town || 'the town'}, before the crowd. You lose ${loss} health${wound ? ', and your back is laid open' : ''}.` };
        }
        if (kind === 'pilloried') {
            const Pl = _obj(P.pillory) || {};
            const days = Math.max(1, Math.round(_num(Pl.days, 1)));
            // The town's mood toward you: what it remembers of you, and your name in the realm
            const op = s ? NpcMemory.townOpinion(world, s, player, day) : 0;
            const repute = kid != null ? _num(player.reputation && player.reputation[kid]) : 0;
            const hate = _clamp(0.5 - op / 60 - repute / 200 + (_roll(world, `pillory|${day}|${ctx.q},${ctx.r}`) - 0.5) * 0.6, 0, 1);
            const [lo, hi] = Pl.pelt || [3, 12];
            const hurt = Math.round(lo + hate * (hi - lo));
            player.health = Math.max(_num(P.minHealth, 5), _num(player.health, 100) - hurt);
            player.renown = Math.max(0, _num(player.renown) + _num(Pl.renown, -2));
            rep(_num(Pl.reputation, -2));
            if (ctx.jail) { ctx.jail.daysRemaining = days; ctx.jail.totalDays = days; ctx.jail.tried = true; ctx.jail.bailCost = 0; ctx.jail.offense = 'the pillory'; }
            if (s) { PenalLabour._pillory(s, 'player', player.name || 'you', day, day + days, ctx.crime || 'a crime'); PenalLabour._fear(s, 'stocks', day); }
            st.served.push({ kind: 'pilloried', day, realm, crime: ctx.crime || null });
            PenalLabour._log(player, world, `A day in the pillory of ${ctx.town || 'the town'}.`);
            const mood = hate > 0.6 ? 'The town pelts you with dung and stones until dark.' : hate > 0.3 ? 'Rotten cabbages and jeers; a few faces turn away.' : 'Few throw anything; some bring you water.';
            return { ok: true, text: `Guilty: ${days === 1 ? 'a day' : `${days} days`} in the pillory of ${ctx.town || 'the town'}. ${mood} (−${hurt} health)` };
        }
        if (kind === 'mines' || kind === 'galleys') {
            const L = _obj(P[kind]) || {};
            const days = Math.max(7, Math.round(_num(ctx.days, PenalLabour.termDays(world, kid, ctx.severity || 3))));
            const label = PenalLabour._siteLabel(world, kind, kid);
            const skills = player.skills || {};
            player.indenturedServitude = {
                captor: label, daysRemaining: days, totalDays: days, dailyWage: 0, goldConfiscated: 0,
                canBuyFreedom: true, freedomCost: Math.round(days * _num(L.ransomPerDay, 5)),
                escapeChance: _clamp(_num(L.escape, 0.06) + _num(skills.stealth) * 0.02, 0.02, 0.4),
                penal: { kind, kingdomId: kid, realm, town: ctx.town || null, q: ctx.q, r: ctx.r, from: day, crime: ctx.crime || null },
            };
            st.served.push({ kind, day, realm, days, crime: ctx.crime || null });
            if (player.house) House._chronicle(player.house, world, `${player.name || 'The head of the House'} was sentenced at ${ctx.town || 'a court'} to ${days} days at ${label}.`, ['trial', kind]);
            PenalLabour._log(player, world, `Sentenced to ${days} days at ${label}.`);
            return { ok: true, days, text: `Guilty: ${days} days at ${label}. They chain you with the others at dawn. (Escape, endure, or buy your release from the crown: ${Utils.formatGold(player.indenturedServitude.freedomCost)} gold.)` };
        }
        return { ok: false, text: '' };
    },

    /** A day at the mines or the oar for the player (player/playerMilitary/combat.js processServitude). → text or '' */
    playerLabourDay(player, world, servitude) {
        const pen = servitude && servitude.penal;
        if (!pen) return '';
        const P = PenalLabour._c('player');
        const L = _obj(P[pen.kind]) || {};
        const day = _day(world);
        const key = `${pen.from}|${day}`;
        const [lo, hi] = L.dayHurt || [0, 1];
        const hurt = Math.round(lo + _roll(world, `pday|${key}`) * (hi - lo));
        player.health = Math.max(_num(P.minHealth, 5), _num(player.health, 100) - hurt);
        let text = '';
        if (_roll(world, `pacc|${key}`) < _num(L.accident, 0.02)) {
            try { Ailments.inflict(player, world, L.wound || 'gash', { source: pen.kind }); } catch (e) { /* none */ }
            text = pen.kind === 'mines' ? 'A fall of rock in the gallery: you are dug out hurt.' : 'The overseer\'s whip, and an oar that broke: you are hurt.';
        }
        // The galley puts in at a port now and then: a better night to slip the chain
        if (pen.kind === 'galleys') {
            const every = Math.max(2, Math.round(_num(L.portEvery, 6)));
            pen.inPort = (day - _num(pen.from)) % every === 0;
            if (pen.inPort) text = `${text} The galley puts in at a port tonight.`.trim();
            if (pen.baseEscape == null) pen.baseEscape = servitude.escapeChance;
            servitude.escapeChance = pen.inPort ? Math.min(0.6, pen.baseEscape + _num(L.portEscape, 0.15)) : pen.baseEscape;
        }
        // (your labour is the crown's: one more pair of hands in its gang, counted in _crownWeek)
        pen.days = _num(pen.days) + 1;
        return text;
    },

    /** The player broke out of the mines or the galleys: the crown wants them for it. */
    playerEscaped(player, world, servitude) {
        const pen = servitude && servitude.penal;
        if (!pen || pen.kingdomId == null) return;
        const P = PenalLabour._c('player');
        try { Wanted.charge(player, world, { kingdomId: pen.kingdomId, label: `escaped from ${pen.kind === 'mines' ? 'the mines' : 'the galleys'}`, gold: Math.round(_num(servitude.daysRemaining) * 4), grave: true }); } catch (e) { /* no wanted */ }
        try { Underworld.addHeat(player, pen.kingdomId, _num(P.escapedHeat, 12), world); } catch (e) { /* no underworld */ }
        PenalLabour._stat(PenalLabour.state(player).stats, 'escapedSelf');
        PenalLabour._log(player, world, `Broke out of ${servitude.captor}.`);
    },

    /** Who a ransom for the player's term is paid to: the sentencing crown's chests. */
    ransomPayee(world, servitude) {
        const pen = servitude && servitude.penal;
        const k = pen ? _kingdom(world, pen.kingdomId) : null;
        return k && 'treasury' in k ? k : null;
    },

    // ══════════════════════════════════════════════
    // WHAT OTHERS SEE
    // ══════════════════════════════════════════════

    /** A townsperson's court mark: { letter, letterName, crime, day, town, by } or null. */
    brandOf(p) {
        const b = p && p.brandMark;
        if (!b) return null;
        return { letter: b.l, letterName: PenalLabour.letterName(b.l), crime: b.c, day: b.d, town: b.t, by: b.by, kingdomId: b.k };
    },

    /** The narrator's aside on meeting them: the court's letter on a cheek, or years at hard labour. */
    markAside(p) {
        if (!p) return '';
        const he = p.gender === 'female' ? 'her' : 'his';
        const He = p.gender === 'female' ? 'She' : 'He';
        const b = PenalLabour.brandOf(p);
        if (b) return _cap(PenalLabour.line('asideBrand', { letterName: b.letterName, his: he }, p.id));
        if (p.served && p.served.s) return PenalLabour.line('asideServed', { He, site: p.served.s }, p.id);
        return '';
    },

    /** What a branded townsperson says when asked about it. */
    brandReply(p, world, player = null) {
        const b = PenalLabour.brandOf(p);
        if (!b) return '';
        if (b.by === 'player') return PenalLabour.line('replyBrandYou', {}, p.id);
        return PenalLabour.line('replyBrand', { town: b.town || 'the town', crime: b.crime || 'a crime', when: Townsfolk.when(b.day, world) }, p.id);
    },

    /** The player's marks from the courts, for the character sheet: [{ icon, label, value }]. */
    playerMarks(player) {
        const out = [];
        if (!player) return out;
        const st = player.penal;
        const brands = (player.trials && Array.isArray(player.trials.brands) ? player.trials.brands : [])
            .filter(b => b && (b.gen == null || !player.house || b.gen === _num(player.house.generation, 1)));
        for (const b of brands) out.push({ icon: '🔥', label: 'Brand', value: `${_cap(PenalLabour.letterName(b.letter || 'F'))} of ${b.realm || 'a realm'}${b.pardoned ? ' (pardoned)' : ''}` });
        if (st && _num(st.scars) > 0) out.push({ icon: '🩸', label: 'The lash', value: `Flogged ×${st.scars}: the stripes on your back` });
        const lab = st && Array.isArray(st.served) ? st.served.filter(x => x.kind === 'mines' || x.kind === 'galleys') : [];
        if (lab.length) out.push({ icon: '⛏️', label: 'Hard labour', value: lab.map(x => `${x.days || '?'} days at ${x.kind === 'mines' ? 'the mines' : 'the galleys'} of ${x.realm}`).slice(-2).join('; ') });
        return out;
    },
};
