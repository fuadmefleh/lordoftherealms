// ============================================
// CRISES — the age-defining events of a long game
// ============================================
// Rare, huge world events with long tails. One runs at a time; after it ends
// the world rests `gapYears` before the next may begin, so a century sees
// two to four of them. Each runs for years in phases, works through the
// systems that already exist (none re-implements them), and becomes a
// chapter of the Annals (Crises.annalChapters → systems/annals.js `ages`):
//
//   INVASION  omens at a map edge (the polar rows, else a far coast) → a
//             foreign host lands as real world units ('invader_host', saved
//             with world.units) and marches on the nearest towns. The realms
//             near the landing swear a Grand Alliance (KingdomAI.endWar ends
//             their quarrels, kingdom.allies, relations) or stand aloof.
//             Assaults: the host against the town's garrison (its realm's
//             persistent kingdom.military) × walls, with relief from the
//             alliance's armies near by; losses stick to both. A town taken
//             is sacked (its purse to the host's chest, SettlementMarket.loot,
//             people lost) and the first one makes the invaders a REALM
//             (a kingdom like a Dawn chiefdom: lord, royal family, at war
//             with the alliance — KingdomAI's own wars then go on). Hosts
//             starve away from their towns (attrition) unless victualled.
//             Ends settled (the hosts lay down arms, peace, the realm stays)
//             or repelled (hosts broken and the realm fallen).
//   PLAGUE    off a ship at a port town, spreading town to town along the
//             towns' trade links (settlement.market.links: roads and sea
//             lanes carry it further) at a fraction where a crown keeps
//             quarantine (Illness.quarantined — the AI realms proclaim it
//             themselves, systems/lawCouncil.js, as the plague nears). Each
//             struck town is seeded with the plague (systems/illness.js: its
//             named townsfolk fall sick and die) and loses a share of its
//             people over its course: labour runs short and wages rise
//             (world/townLabour.js), the markets go short of hands.
//   SCHISM    a reformer splits a faith held by three realms or more; the
//             realms declare for the old church or the new rite
//             (kingdom.religion.rite: Religion.sameFaith/faithCompatibility
//             read it, so KingdomAI's diplomacy follows), relations shift
//             camp by camp, piety falls, wars of religion may break out
//             (KingdomAI.startWar). Ends in triumph (one side's might twice
//             the other's: one church again) or the Peace of the Faiths (both
//             rites stand — for good).
//   FAMINE    a decade of failed harvests over a band of regions: blights
//             laid in the year's harvest plan (world/harvests.js), so the
//             dearth, granaries, doles, engrossers, refugees and hunger all
//             follow from real shortages.
//   RUSH      a mother lode struck near a hill town (a gold mine site in
//             world/hinterland.js with a deep reserve): people move in from
//             the towns about (population moved, not made), the gold goes to
//             market and the mints (coin enters the realm: world/moneySupply.js);
//             when the lode thins, the bust sends most of them home.
//
// The player chooses: rally (a battle against a host's vanguard, fought by
// the caller with PlayerMilitary.combat), fund a crown's defence, victual the
// invaders for their plunder, flee to a safe town, pay physicians, preach for
// a side, sell indulgences, give food to a starving town, take sides. Every
// coin moves between real purses (Ledger 'crisisAid' / 'crisisTrade').
//
// No shared RNG: rolls are hashes of the world seed and the crisis; the few
// calls into code that draws Utils.random run on a dedicated stream
// (Utils.withRng). World state on world.crises (saved, systems/saveLoad.js);
// the player's part on player.crises (saved). Runs with player=null (the
// interregnum). Content: data/crises.json.
//
// Prose seam: Crises.useProse(LlmProse) hands in systems/llmProse.js (the
// LLM writes the narration; the template text is the fallback and the key
// is `crisis:<uid>:<n>`). Until it is wired every line is the template's.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { PlayerInventory } from '../core/inventory.js';
import { Kingdom } from '../world/kingdom.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { KingdomNavy } from '../world/kingdomNavy.js';
import { LordInfluence } from '../world/kingdomState.js';
import { NPCLords } from '../world/npcLords.js';
import { Characters } from '../world/characters.js';
import { WorldUnit } from '../world/units.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Economy } from '../world/economy.js';
import { Harvests } from '../world/harvests.js';
import { Hinterland } from '../world/hinterland.js';
import { Seasons } from '../world/seasons.js';
import { Cultures } from '../world/cultures.js';
import { Climate } from '../world/climate.js';
import { Religion } from './religion.js';
import { Illness } from './illness.js';
import { Townsfolk } from './townsfolk.js';
import { Laws } from './laws.js';
import { House } from './house.js';
import { Ledger } from './ledger.js';
import { TownMemory } from './townMemory.js';
import { TownMarks } from '../world/townMarks.js';
import { Interrupts } from '../core/interrupts.js';
import { Names } from '../core/names.js';

const YEAR = Seasons.DAYS_PER_YEAR || 120;
const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _arr = (v) => (Array.isArray(v) ? v : []);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _key = (q, r) => `${q},${r}`;
const _day = (world) => _num(world && world.day);
const STAPLES = ['grain', 'bread', 'food', 'preserved_fish', 'vegetables'];

function _merge(base, over) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
        if (k.startsWith('_')) continue;
        out[k] = _obj(v) && _obj(base[k]) ? _merge(base[k], v) : v;
    }
    return out;
}

function _seed(world) {
    const p = world && world.generationParams;
    return _num(p && p.seed, 1);
}

function _hash(s) {
    let h = Utils.hashStr(String(s)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
}

/** A unit roll for `key` in this world (no RNG stream touched). */
function _roll(world, key) {
    return (_hash(`${_seed(world)}|crisis|${key}`) % 100000) / 100000;
}

/** A dedicated stream (mulberry32) for calls into code that draws Utils.random. */
function _rng(world, key) {
    let a = _hash(`${_seed(world)}|crisisrng|${key}`) || 1;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const _range = (world, key, [lo, hi]) => lo + _roll(world, key) * (hi - lo);
const _irange = (world, key, pair) => Math.round(_range(world, key, pair));
const _pick = (world, key, list) => { const a = _arr(list); return a.length ? a[Math.floor(_roll(world, key) * a.length) % a.length] : null; };
const _fill = (text, vars) => String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
const _dist = (world, a, b) => Hex.wrappingOffsetDistance(a.q, a.r, b.q, b.r, world.width || 80);
const _kingdom = (world, id) => (id != null && world && typeof world.getKingdom === 'function' ? world.getKingdom(id) : null);
const _alive = (k) => !!(k && k.isAlive !== false);
const _views = (world) => (typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : (world.getAllSettlements ? world.getAllSettlements() : []));
const _live = (world, q, r) => { const t = world.getTile(q, r); return t && t.settlement ? t.settlement : null; };
const _listNames = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

let _cfg = null;
let _cfgSrc;
let _prose = null;
/** In-memory host references by unit id (to see who broke a host after the units' sweep). Not saved. */
const _hostRefs = new Map();

const DEFAULTS = {
    enabled: true, firstYears: [12, 22], gapYears: [18, 30],
    weights: { invasion: 1, plague: 1, schism: 1, famine: 1, rush: 1 },
    invasion: { omensDays: [90, 180], hostMult: [2.4, 3.4], minHost: 200, garrison: 0.3, lastGarrison: 0.5, repulseLoss: 0.2, siegeLoss: 0.2, hosts: [2, 3], speed: 2, allianceRadius: 26, allianceMax: 5, joinBase: 0.6, reliefRadius: 14, reliefShare: 0.1, assaultGapDays: 30, restDays: 45, waves: 2, waveShare: 0.45, attritionWeekly: 0.015, garrisonShare: 0.15, plunderPurse: 0.3, lootShare: 0.2, sackPopulation: 0.08, minHostStrength: 30, warYears: [3, 6], aftermathDays: 120, peoples: [{ name: 'the Varangar', realm: 'the Varangar Dominion', host: 'Varangar Warband', culture: 'Nordic', from: 'the frozen sea' }] },
    plague: { names: ['the Great Pestilence'], courseDays: [90, 150], returnChance: 0.6, mortality: [0.08, 0.22], typeMort: {}, careMult: 0.6, spreadBase: 0.2, road: 1.3, sea: 1.6, quarantine: 0.3, decayAfterYears: 1, decayWeekly: 0.97, maxShare: 0.6, seedCases: [2, 4], quietDays: 150, maxYears: 5, aftermathDays: 240 },
    schism: { disputeDays: [180, 360], splitDays: [360, 720], strifeYears: [2, 5], declareWeekly: 0.035, reformLean: 0.45, sameCamp: 12, otherCamp: -22, pietyWeekly: -0.3, warChance: 0.012, maxWars: 2, triumphRatio: 2, preachShift: 0.12, aftermathDays: 180, reformedNames: ['the Reformed {faith}'], reformers: ['Brother Aldric'], reach: 30, heresyStrength: 15 },
    famine: { names: ['the Hungry Years'], years: [6, 10], radius: 22, severity: [0.35, 0.6], ramp: 0.6, aftermathDays: 240 },
    rush: { names: ['the {town} Rush'], reserveMult: 4, radius: 14, migrateWeekly: 0.004, migrateCap: 0.08, bustBelow: 0.15, maxYears: 8, bustDays: [180, 360], returnShare: 0.6 },
    choices: { fundCost: [100, 250, 500], goldPerSoldier: 4, physicianCost: 200, careDays: 120, preachCost: 150, indulgence: 0.03, indulgenceMax: 400, victualPremium: 2.2, reliefPerUnit: 1, vanguardShare: 0.2, rallyRadius: 3, refugeDistance: 14, fare: 30 },
    text: {},
};

const KIND_INFO = {
    invasion: { icon: '⚔️', label: 'Invasion' },
    plague: { icon: '☠️', label: 'Great Plague' },
    schism: { icon: '⛪', label: 'Schism' },
    famine: { icon: '🥀', label: 'Famine' },
    rush: { icon: '💰', label: 'Gold Rush' },
};

export const Crises = {
    KINDS: Object.keys(KIND_INFO),
    KIND_INFO,

    config() {
        const src = DataLoader._gamedata && DataLoader._gamedata.crises;
        if (_cfg && _cfgSrc === src) return _cfg;
        _cfgSrc = src;
        _cfg = _merge(DEFAULTS, _obj(src) || {});
        return _cfg;
    },

    /** Hand in the LLM prose writer (systems/llmProse.js: { write, text }). */
    useProse(impl) {
        _prose = impl && typeof impl.write === 'function' && typeof impl.text === 'function' ? impl : null;
    },

    // ── State ─────────────────────────────────────────

    state(world) {
        if (!world) return null;
        let st = _obj(world.crises);
        if (!st || st.v !== 1) {
            st = world.crises = { v: 1, seq: 0, active: null, history: [], news: [], nextDay: null, lastKind: null };
        }
        return st;
    },

    serialize(world) {
        const st = world && _obj(world.crises);
        return st ? JSON.parse(JSON.stringify(st)) : null;
    },

    restore(saved, world) {
        if (!world) return;
        world.crises = _obj(saved) && saved.v === 1 ? saved : null;
        _hostRefs.clear();
        const st = Crises.state(world);
        // A realm the invaders founded keeps its look (the save keeps only the plain fields)
        for (const c of [st.active, ...st.history].filter(Boolean)) {
            const look = c.data && c.data.realmLook;
            const k = look && _kingdom(world, c.data.realmId);
            if (k) {
                if (!k.colorLight) k.colorLight = look.colorLight;
                if (!Array.isArray(k.preferredTerrain)) k.preferredTerrain = look.preferredTerrain;
                if (k.foundedDay == null) k.foundedDay = look.foundedDay;
            }
        }
    },

    active(world) {
        const st = world && _obj(world.crises);
        return st ? st.active : null;
    },

    history(world) {
        const st = world && _obj(world.crises);
        return st ? _arr(st.history) : [];
    },

    playerState(player) {
        if (!player) return null;
        if (!_obj(player.crises)) player.crises = { acts: [], sides: {} };
        if (!Array.isArray(player.crises.acts)) player.crises.acts = [];
        if (!_obj(player.crises.sides)) player.crises.sides = {};
        return player.crises;
    },

    // ── The daily tick ───────────────────────────────

    /**
     * One day: hosts march and assault daily; everything else weekly.
     * Call after world.advanceDay (ui/game/endDay.js, the harness, the
     * afterlife's world tick with player=null). → { notices }
     */
    processDay(world, player = null) {
        const out = { notices: [] };
        const C = Crises.config();
        if (!world || !C.enabled || !Array.isArray(world.kingdoms)) return out;
        const st = Crises.state(world);
        const day = _day(world);
        if (st.nextDay == null) st.nextDay = Math.round(_range(world, 'first', C.firstYears) * YEAR);
        const c = st.active;
        const before = c ? c.log.length : 0;
        if (c && c.kind === 'invasion') Crises._invasionDaily(world, c, day);
        if (day % 7 === 3) {
            if (c) {
                const H = HANDLERS[c.kind];
                if (H && H.week) H.week(world, c, day);
                if (c.phase === 'aftermath' && day >= _num(c.phaseEnd)) Crises._close(world, st, c, day);
            } else if (day >= st.nextDay) {
                Crises._begin(world, st, day);
            }
        }
        // The player hears the great turns of it (word of a crisis reaches everyone)
        if (player) {
            const fresh = [];
            if (c) fresh.push(...c.log.slice(before).map(e => [c, e]));
            if (st.active && st.active !== c) fresh.push(...st.active.log.map(e => [st.active, e]));
            for (const [x, e] of fresh) {
                if (!e.big) continue;
                out.notices.push({ icon: (KIND_INFO[x.kind] || {}).icon || '📜', title: x.name.charAt(0).toUpperCase() + x.name.slice(1), text: Crises.line(world, x, e), type: 'warning' });
            }
        }
        return out;
    },

    _begin(world, st, day) {
        const C = Crises.config();
        const cands = Crises.KINDS.filter(k => k !== st.lastKind && _num(C.weights[k]) > 0 && HANDLERS[k].eligible(world));
        if (!cands.length) { st.nextDay = day + YEAR; return null; }
        // The climate's era tilts the odds: famine in a drought or a cold age, plague in wet
        // decades, invaders out of a freezing north (world/climate.js crisisBias)
        const bias = Climate.crisisWeights(world, day);
        const w = (k) => _num(C.weights[k]) * _num(bias[k], 1);
        const total = cands.reduce((s, k) => s + w(k), 0);
        let roll = _roll(world, `kind:${st.seq}:${day}`) * total;
        let kind = cands[cands.length - 1];
        for (const k of cands) { roll -= w(k); if (roll <= 0) { kind = k; break; } }
        return Crises.start(world, kind);
    },

    /** Begin a crisis of `kind` now (the scheduler, and tests). → the crisis, or null when it cannot. */
    start(world, kind, opts = {}) {
        const st = Crises.state(world);
        const H = HANDLERS[kind];
        if (!st || !H || st.active) return null;
        if (!opts.force && !H.eligible(world)) return null;
        const day = _day(world);
        st.seq++;
        const c = { uid: `${kind}${st.seq}`, kind, name: KIND_INFO[kind].label, startDay: day, phase: 'start', phaseDay: day, phaseEnd: null, endDay: null, outcome: null, log: [], data: {}, place: null };
        st.active = c;
        if (!H.begin(world, c, day)) { st.active = null; st.seq--; return null; }
        // A new age begins: a time skip stops for it (core/interrupts.js)
        Interrupts.raise(world, { reason: `${c.name.charAt(0).toUpperCase() + c.name.slice(1)} begins`, icon: (KIND_INFO[kind] || {}).icon || '📜', source: 'crises' });
        return c;
    },

    _phase(c, phase, day, until = null) {
        c.phase = phase;
        c.phaseDay = day;
        c.phaseEnd = until;
    },

    /** End the crisis: its aftermath, then into history. */
    _finish(world, c, day, outcome) {
        const C = Crises.config();
        c.outcome = outcome;
        c.endDay = day;
        Crises._phase(c, 'aftermath', day, day + _num((C[c.kind] || {}).aftermathDays, 120));
    },

    _close(world, st, c, day) {
        const C = Crises.config();
        if (!c.endDay) c.endDay = day;
        st.history.push(c);
        if (st.history.length > 24) st.history.splice(0, st.history.length - 24);
        st.active = null;
        st.lastKind = c.kind;
        st.nextDay = day + Math.round(_range(world, `gap:${c.uid}`, C.gapYears) * YEAR);
        for (const id of _arr(c.data.hosts)) _hostRefs.delete(id);
    },

    /** A dated line in the crisis's chronicle, and a proclamation for the heralds. */
    _log(world, c, kind, vars, opts = {}) {
        const T = (Crises.config().text[c.kind] || {})[kind];
        const n = c.log.length;
        const fallback = _fill(_pick(world, `${c.uid}:${kind}:${n}`, T) || '', vars);
        if (!fallback) return null;
        const e = { day: _day(world), kind, text: fallback, n, big: !!opts.big };
        c.log.push(e);
        if (c.log.length > 80) c.log.splice(1, c.log.length - 80);
        if (_prose) {
            try { _prose.write(world, { kind: 'crisis', key: `crisis:${c.uid}:${n}`, facts: { crisis: c.name, kind: c.kind, phase: c.phase, event: kind, ...vars }, fallback, style: 'chronicle' }); } catch (err) { /* the template stands */ }
        }
        const st = Crises.state(world);
        st.news.push({ key: `crisis:${c.uid}:${n}`, kind: opts.big ? 'crisis_grave' : 'crisis', day: e.day, text: fallback, q: opts.at ? opts.at.q : null, r: opts.at ? opts.at.r : null, kingdomId: opts.kingdomId != null ? opts.kingdomId : null });
        if (st.news.length > 40) st.news.splice(0, st.news.length - 40);
        if (Array.isArray(world.events)) world.events.push({ text: `${KIND_INFO[c.kind].icon} ${fallback}`, type: 'crisis' });
        return e;
    },

    /** A chronicle entry as it reads now (the LLM's if written, else the template). */
    line(world, c, e) {
        if (!e) return '';
        if (_prose) {
            try { return _prose.text(world, `crisis:${c.uid}:${e.n}`, e.text) || e.text; } catch (err) { return e.text; }
        }
        return e.text;
    },

    /** Proclamations for the heralds (systems/heralds.js). */
    news(world) {
        const st = world && _obj(world.crises);
        return st ? _arr(st.news) : [];
    },

    // ── Invasion ─────────────────────────────────────

    _beachhead(world) {
        const views = _views(world).filter(s => s.kingdom && _alive(_kingdom(world, s.kingdom)));
        if (!views.length) return null;
        const H = world.height || 60;
        const cands = [];
        const consider = (q, r, edge) => {
            const t = world.getTile(q, r);
            if (!t || !t.terrain || !t.terrain.passable || t.settlement) return;
            let best = Infinity;
            for (const s of views) {
                // (on the same land as the town: a host put ashore on an island goes nowhere)
                const st = world.getTile(s.q, s.r);
                if (st && t.regionId != null && st.regionId != null && st.regionId !== t.regionId) continue;
                const d = _dist(world, { q, r }, s);
                if (d < best) best = d;
            }
            if (best < 5 || best > 22) return;
            cands.push({ q, r, edge, score: -Math.abs(best - 10) });
        };
        for (let q = 0; q < (world.width || 80); q++) {
            for (const r of [0, 1, 2, H - 3, H - 2, H - 1]) consider(q, r, r < H / 2 ? 'the northern edge of the world' : 'the southern edge of the world');
        }
        if (!cands.length) {
            // No shore at the world's rim: a far coast, beyond the edge of the charts
            for (let r = 2; r < H - 2; r += 1) {
                for (let q = 0; q < (world.width || 80); q += 2) {
                    const t = world.getTile(q, r);
                    if (!t || !t.terrain || !t.terrain.passable || t.settlement) continue;
                    if (!Hex.neighbors(q, r).some(n => { const nt = world.getTile(Hex.wrapQ(n.q, world.width), n.r); return nt && nt.terrain && !nt.terrain.passable; })) continue;
                    consider(q, r, 'a far coast');
                }
            }
        }
        if (!cands.length) return null;
        cands.sort((a, b) => b.score - a.score || a.r - b.r || a.q - b.q);
        const top = cands.slice(0, 12);
        return top[Math.floor(_roll(world, 'beach') * top.length) % top.length];
    },

    _hosts(world, c) {
        const out = [];
        for (const id of _arr(c.data.hosts)) {
            let u = _hostRefs.get(id);
            if (!u || u.destroyed) {
                const found = (world.units || []).find(x => x && x.id === id && !x.destroyed);
                if (found) { _hostRefs.set(id, found); u = found; }
            }
            if (u && !u.destroyed && (world.units || []).includes(u)) out.push(u);
        }
        return out;
    },

    _invasionDaily(world, c, day) {
        if (c.phase !== 'war') return;
        const I = Crises.config().invasion;
        const hosts = Crises._hosts(world, c);
        // Hosts gone since yesterday: broken by the player on the map, or starved
        for (const id of _arr(c.data.hosts)) {
            if (hosts.some(h => h.id === id)) continue;
            const ref = _hostRefs.get(id);
            c.data.hosts = c.data.hosts.filter(x => x !== id);
            _hostRefs.delete(id);
            const name = (ref && ref.name) || 'A host';
            if (ref && ref.slainByPlayer) {
                c.data.playerBroke = (c.data.playerBroke || 0) + 1;
                Crises._log(world, c, 'slain', { player: c.data.lastPlayerName || 'A captain of the realm', host: name }, { big: true, at: ref });
            } else {
                Crises._log(world, c, 'broken', { host: name }, { at: ref });
            }
        }
        const views = _views(world);
        for (const h of hosts) {
            // The objective: the nearest town not the invaders' own
            let obj = h.objectiveQ != null ? _live(world, h.objectiveQ, h.objectiveR) : null;
            if (h.restUntil && h.restUntil > day) continue;
            if (!obj || (c.data.realmId && obj.kingdom === c.data.realmId)) {
                let best = null, bd = Infinity;
                for (const s of views) {
                    const ls = _live(world, s.q, s.r);
                    if (!ls || (c.data.realmId && ls.kingdom === c.data.realmId)) continue;
                    if (_arr(h.unreachable).includes(_key(s.q, s.r))) continue;
                    const d = _dist(world, h, s);
                    if (d < bd && d <= 40) { bd = d; best = s; }
                }
                h.objectiveQ = best ? best.q : null;
                h.objectiveR = best ? best.r : null;
                h.objDay = day;
                obj = best ? _live(world, best.q, best.r) : null;
            }
            if (!obj) {
                // No town it can reach: the fleet takes it aboard and puts it ashore again elsewhere
                h.idle = _num(h.idle) + 1;
                if (h.idle >= 14) Crises._reland(world, c, h, views);
                continue;
            }
            h.idle = 0;
            const d = _dist(world, h, obj);
            if (d > 1) {
                h.targetQ = h.objectiveQ;
                h.targetR = h.objectiveR;
                // A host that cannot find its way (water, mountains) gives that town up
                const was = _key(h.q, h.r);
                if (h.lastPos === was) h.stuck = _num(h.stuck) + 1; else h.stuck = 0;
                h.lastPos = was;
                // (or wandering: two months on the road without reaching it)
                if (h.stuck >= 14 || day - _num(h.objDay, day) > 60) {
                    h.objDay = day;
                    h.unreachable = _arr(h.unreachable).concat([_key(h.objectiveQ, h.objectiveR)]).slice(-8);
                    h.objectiveQ = null;
                    h.stuck = 0;
                    h.lost = _num(h.lost) + 1;
                    if (h.lost >= 3) { h.lost = 0; Crises._reland(world, c, h, views); }
                    continue;
                }
                const rng = _rng(world, `march:${h.id}:${day}`);
                Utils.withRng(rng, () => {
                    for (let i = 0, n = Math.max(1, _num(h.speed, I.speed)); i < n; i++) {
                        if (h.q === h.targetQ && h.r === h.targetR) break;
                        h.moveTowardsTarget(world);
                    }
                });
            } else if (day - _num(h.lastAssault, -99) >= I.assaultGapDays) {
                // Every host before the walls storms together, led by the strongest
                const band = hosts.filter(o => !o.destroyed && _dist(world, o, obj) <= 1);
                for (const o of band) o.lastAssault = day;
                Crises._assault(world, c, band, obj, day);
            }
        }
    },

    /** Put a stranded host ashore two hexes from the nearest town it has not given up on. */
    _reland(world, c, h, views) {
        h.idle = 0;
        h.unreachable = [];
        let best = null, bd = Infinity;
        for (const s of views) {
            const ls = _live(world, s.q, s.r);
            if (!ls || (c.data.realmId && ls.kingdom === c.data.realmId)) continue;
            const d = _dist(world, h, s);
            if (d < bd && d > 2) { bd = d; best = s; }
        }
        if (!best) return false;
        for (const x of Hex.hexesInRange(best.q, best.r, 2)) {
            const q = Hex.wrapQ(x.q, world.width);
            const t = world.getTile(q, x.r);
            if (!t || !t.terrain || !t.terrain.passable || t.settlement || _dist(world, { q, r: x.r }, best) < 2) continue;
            h.q = q;
            h.r = x.r;
            h.path = [];
            h.objectiveQ = best.q;
            h.objectiveR = best.r;
            Crises._log(world, c, 'reland', { host: h.name, town: best.name }, { at: best, kingdomId: best.kingdom || null });
            return true;
        }
        return false;
    },

    /** A host comes ashore at `at` as a real world unit. */
    _landHost(world, c, at, name, strength) {
        const I = Crises.config().invasion;
        Utils.withRng(_rng(world, `land:${c.uid}:${name}:${_day(world)}`), () => {
            const u = new WorldUnit('invader_host', at.q, at.r);
            u.name = name;
            u.icon = '⚔️';
            u.strength = strength;
            u.population = strength;
            u.speed = I.speed;
            u.maxAge = 1e9;
            u.hostile = true;
            u.crisis = c.uid;
            u.domain = 'land';
            u.inventory = {};
            world.units.push(u);
            c.data.hosts.push(u.id);
            _hostRefs.set(u.id, u);
        });
    },

    _assault(world, c, band, town, day) {
        const I = Crises.config().invasion;
        const def = _kingdom(world, town.kingdom);
        if (def && def.id === c.data.realmId) return;
        const towns = def ? KingdomAI._settlementsOf(def, world).length : 1;
        const garrison = def && _alive(def) ? _num(def.military) * (towns <= 1 ? I.lastGarrison : I.garrison) : _num(town.population) * 0.04;
        const walls = { capital: 1.5, city: 1.3, town: 1.15 }[town.type] || 1;
        const relief = [];
        for (const id of _arr(c.data.alliance)) {
            const m = _kingdom(world, id);
            if (!_alive(m) || (def && m.id === def.id) || !m.capital) continue;
            if (_dist(world, m.capital, town) > I.reliefRadius) continue;
            relief.push({ m, n: _num(m.military) * I.reliefShare });
        }
        const reliefN = relief.reduce((s, x) => s + x.n, 0);
        const defence = (garrison + reliefN) * walls;
        const total = band.reduce((s, h) => s + _num(h.strength), 0);
        const lead = band.slice().sort((a, b) => _num(b.strength) - _num(a.strength))[0];
        const attack = total * (0.85 + _roll(world, `assault:${lead.id}:${day}`) * 0.3);
        const won = attack > defence;
        const hurt = (k, n) => { if (k) k.military = Math.max(0, Math.round(_num(k.military) - n)); };
        // Losses fall on the hosts in proportion to their strength
        const bleed = (n) => { for (const h of band) h.strength = Math.max(0, Math.round(_num(h.strength) - n * _num(h.strength) / Math.max(1, total))); };
        // The dead of the storm leave a cairn by the town, a grave mound where hundreds fell (world/townMarks.js)
        const fallen = won ? defence * 0.3 + garrison * 0.7 + reliefN * 0.5
            : defence * I.repulseLoss + (Math.min(garrison, attack) + reliefN) * I.siegeLoss;
        const people = _obj(c.data.people) || {};
        TownMarks.noteBattle(world, town.q, town.r, {
            dead: Math.round(fallen), day,
            victor: won ? (people.host || lead.name) : (def ? def.name : town.name),
            loser: won ? (def ? def.name : town.name) : (people.host || lead.name),
        });
        if (won) {
            bleed(defence * 0.3);
            hurt(def, garrison * 0.7);
            for (const x of relief) hurt(x.m, x.n * 0.5);
            Crises._capture(world, c, lead, town, def, day);
        } else {
            // Beaten off: the siege goes on, and the walls bleed too
            bleed(defence * I.repulseLoss);
            hurt(def, Math.min(garrison, attack) * I.siegeLoss);
            for (const x of relief) hurt(x.m, x.n * I.siegeLoss);
            c.data.held = (c.data.held || 0) + 1;
            const seen = _obj(c.data.heldAt) || (c.data.heldAt = {});
            if (!seen[town.name]) Crises._log(world, c, 'held', { town: town.name, host: lead.name }, { at: town, kingdomId: def ? def.id : null });
            seen[town.name] = (seen[town.name] || 0) + 1;
        }
        for (const h of band) if (_num(h.strength) < I.minHostStrength) h.destroyed = true;
    },

    _capture(world, c, host, town, def, day) {
        const I = Crises.config().invasion;
        const tile = world.getTile(town.q, town.r);
        if (!tile || !tile.settlement) return;
        const s = tile.settlement;
        // The sack: the purse to the host's chest, the stores carried off or burnt, people lost
        const purse = Economy.townPurse(s);
        const take = purse == null ? 0 : Economy.drawTown(s, purse * I.plunderPurse);
        c.data.chest = Math.round(_num(c.data.chest) + take);
        SettlementMarket.loot(s, I.lootShare);
        s.population = Math.max(20, Math.floor(_num(s.population) * (1 - I.sackPopulation)));
        // ...and the town keeps the ruins for years (systems/townMemory.js: burnt districts, rubble, the folk killed and fled)
        TownMemory.mark(s, 'sack', { by: (_obj(c.data.people) || {}).name || host.name }, world);
        let realm = _kingdom(world, c.data.realmId);
        if (!_alive(realm)) {
            realm = Crises._foundRealm(world, c, host, tile, def, day);
        } else if (def && tile.kingdom === def.id) {
            if (!(realm.wars || []).includes(def.id)) Crises._war(world, realm, def, c);
            KingdomAI.takeTile(realm, def, world, s.q, s.r);
        } else {
            Crises._seize(world, realm, tile, def);
        }
        if (typeof world.invalidateSettlements === 'function') world.invalidateSettlements();
        if (def && _alive(def)) KingdomAI.afterTownLoss(def, realm, world);
        // The host quarters in the town a while; a garrison stays behind
        host.restUntil = day + I.restDays;
        const g = Math.round(_num(host.strength) * I.garrisonShare);
        host.strength -= g;
        realm.military = _num(realm.military) + g;
        c.data.taken = _arr(c.data.taken).concat([s.name]).slice(-30);
        host.objectiveQ = null;
        Crises._log(world, c, 'taken', { host: host.name, town: s.name, realm: def ? def.name : 'its people' }, { big: true, at: s, kingdomId: def ? def.id : null });
        Crises._askAlliance(world, c, s);
    },

    /** A tile (and its town) passes to the invaders outside any war of theirs (a free town, or its realm already fell). */
    _seize(world, realm, tile, def) {
        if (def && Array.isArray(def.territory)) def.territory = def.territory.filter(t => t.q !== tile.q || t.r !== tile.r);
        tile.kingdom = realm.id;
        if (!realm.territory.some(t => t.q === tile.q && t.r === tile.r)) realm.territory.push({ q: tile.q, r: tile.r });
        if (tile.settlement) {
            if (tile.settlement.kingdom && !tile.settlement.formerKingdom) tile.settlement.formerKingdom = tile.settlement.kingdom;
            tile.settlement.kingdom = realm.id;
        }
        if (typeof world.invalidateSettlements === 'function') world.invalidateSettlements();
    },

    _war(world, a, b, c) {
        if (!_alive(a) || !_alive(b) || a.id === b.id) return;
        Utils.withRng(_rng(world, `war:${a.id}:${b.id}:${_day(world)}`), () => KingdomAI.startWar(a, b, world));
        if (c) c.data.wars = (c.data.wars || 0) + 1;
    },

    /** The invaders proclaim their realm at the first town they take (as world/dawn.js raises a chiefdom). */
    _foundRealm(world, c, host, tile, def, day) {
        const people = c.data.people;
        let k = _kingdom(world, c.data.realmId);
        const again = !!k;
        Utils.withRng(_rng(world, `found:${c.uid}:${day}`), () => {
            if (!k) {
                const ids = new Set(world.kingdoms.map(x => x.id));
                let n = 1;
                while (ids.has(`invader_realm_${n}`)) n++;
                const used = new Set(world.kingdoms.map(x => String(x.color || '').toLowerCase()));
                const color = ['#5d4037', '#37474f', '#880e4f', '#4a148c', '#1b5e20', '#bf360c'].find(x => !used.has(x)) || '#4e342e';
                const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
                const name = people.realm.replace(/^the /i, '').replace(/^./, ch => ch.toUpperCase());
                k = Kingdom.create({
                    id: `invader_realm_${n}`, name, ruler: Kingdom.generateRulerName(c.data.culture), color,
                    colorLight: `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.2)`, culture: c.data.culture,
                    description: `A realm carved out by ${people.name}, come from ${people.from}.`,
                    preferredTerrain: ['plains', 'grassland', 'hills'], traits: ['aggressive'],
                });
                k.colonization = { policy: 'coexistence', colonies: [], pioneersActive: 0 };
                k.truces = {};
                k.warState = {};
                const faiths = Object.keys(Religion.getActiveFaiths ? Religion.getActiveFaiths() : Religion.FAITHS);
                const counts = {};
                for (const o of world.kingdoms) if (_alive(o) && o.religion) counts[o.religion.faithId] = (counts[o.religion.faithId] || 0) + 1;
                const faithId = faiths.slice().sort((a, b) => (counts[a] || 0) - (counts[b] || 0) || (a < b ? -1 : 1))[0];
                const f = Religion.FAITHS[faithId];
                if (f) k.religion = { faithId, name: f.name, icon: f.icon, piety: 60, unity: 60, heresies: [], holySites: [], pilgrimIncome: 0 };
                for (const o of world.kingdoms) {
                    if (!o.relations) o.relations = {};
                    o.relations[k.id] = -60;
                    k.relations[o.id] = -60;
                }
                world.kingdoms.push(k);
                c.data.realmId = k.id;
                c.data.realmLook = { colorLight: k.colorLight, preferredTerrain: k.preferredTerrain, foundedDay: day };
            }
            k.isAlive = true;
            k.conqueredDay = null;
            k.conqueredBy = null;
            k.foundedDay = k.foundedDay && k.foundedDay > 1 ? k.foundedDay : day;
            k.capital = { q: tile.q, r: tile.r };
            k.stability = 50;
            k.wars = [];
            Crises._seize(world, k, tile, def);
            for (const n of Hex.neighbors(tile.q, tile.r)) {
                const nt = world.getTile(Hex.wrapQ(n.q, world.width), n.r);
                if (!nt || !nt.terrain || !nt.terrain.passable || nt.settlement) continue;
                const owner = _kingdom(world, nt.kingdom);
                if (owner && Array.isArray(owner.territory)) owner.territory = owner.territory.filter(t => t.q !== nt.q || t.r !== nt.r);
                nt.kingdom = k.id;
                k.territory.push({ q: nt.q, r: nt.r });
            }
            k.population = _num(tile.settlement.population);
            k.military = Math.max(_num(k.military), 20);
            k.treasury = Math.max(_num(k.treasury), 300);
            if (!k.lord) {
                try { Kingdom.initializeKingdomStats(k, world.tiles, world.width, world.height); } catch (e) { /* a sparse realm */ }
                k.lord = NPCLords.generateLord(k);
                if (Characters && typeof Characters.generateRoyalFamily === 'function') {
                    k.characterData = Characters.generateRoyalFamily(k, world);
                    k.ruler = Characters.getDisplayName(k.characterData.ruler, k);
                }
                KingdomNavy.ensure(k);
            }
        });
        if (typeof world.invalidateSettlements === 'function') world.invalidateSettlements();
        for (const id of _arr(c.data.alliance)) Crises._war(world, k, _kingdom(world, id), c);
        if (def && _alive(def) && !(k.wars || []).includes(def.id)) Crises._war(world, k, def, c);
        Crises._log(world, c, again ? 'refounded' : 'founded', { people: people.name, realm: k.name, town: tile.settlement.name }, { big: true, at: tile, kingdomId: k.id });
        return k;
    },

    /** The realms near the danger are asked to join the Grand Alliance. */
    _askAlliance(world, c, at) {
        const I = Crises.config().invasion;
        const asked = new Set([...(c.data.alliance || []), ...(c.data.aloof || [])]);
        const near = world.kingdoms.filter(k => _alive(k) && k.id !== c.data.realmId && !asked.has(k.id) && k.capital && _dist(world, k.capital, at) <= I.allianceRadius)
            .sort((a, b) => _dist(world, a.capital, at) - _dist(world, b.capital, at));
        const joined = [], aloof = [];
        for (const k of near) {
            if ((c.data.alliance || []).length >= I.allianceMax) break;
            const chance = _clamp(I.joinBase + 0.2 * LordInfluence.lean(k, 'honor') - 0.15 * LordInfluence.lean(k, 'ambition'), 0.1, 0.95);
            if (_roll(world, `join:${c.uid}:${k.id}`) < chance) {
                for (const id of _arr(c.data.alliance)) {
                    const m = _kingdom(world, id);
                    if (!_alive(m)) continue;
                    if ((k.wars || []).includes(m.id)) KingdomAI.endWar(k, m, world, { text: `🕊️ ${k.name} and ${m.name} lay down their quarrel before the invaders.` });
                    if (!Array.isArray(k.allies)) k.allies = [];
                    if (!Array.isArray(m.allies)) m.allies = [];
                    if (!k.allies.includes(m.id)) k.allies.push(m.id);
                    if (!m.allies.includes(k.id)) m.allies.push(k.id);
                    k.relations[m.id] = _clamp(_num(k.relations[m.id]) + 15, -100, 100);
                    m.relations[k.id] = _clamp(_num(m.relations[k.id]) + 15, -100, 100);
                }
                c.data.alliance = _arr(c.data.alliance).concat([k.id]);
                joined.push(k.name);
                const realm = _kingdom(world, c.data.realmId);
                if (_alive(realm)) Crises._war(world, realm, k, c);
            } else {
                c.data.aloof = _arr(c.data.aloof).concat([k.id]);
                aloof.push(k.name);
            }
        }
        if (joined.length) Crises._log(world, c, 'alliance', { members: _listNames(joined) }, { at });
        if (aloof.length) Crises._log(world, c, 'aloof', { aloof: _listNames(aloof) }, { at });
    },

    // ── Plague ───────────────────────────────────────

    _plagueSeed(world, s, day, from) {
        const P = Crises.config().plague;
        if (!Illness.on || !Illness.on() || !Illness.def('plague')) return;
        if (_obj(s.folk) && Array.isArray(s.folk.people)) {
            Illness.state(world, s, s.folk, day);
            const rng = _rng(world, `seed:${s.q},${s.r}:${day}`);
            const open = Townsfolk.residents(s.folk).filter(p => !p.ill && !Illness._immune(p, 'plague', day));
            const n = Math.min(open.length, Math.round(P.seedCases[0] + rng() * (P.seedCases[1] - P.seedCases[0])));
            for (let i = 0; i < n; i++) Illness._infect(s.folk, open.splice(Math.floor(rng() * open.length), 1)[0], 'plague', day, rng, 'travel', from || null);
        } else {
            s.sickness = { k: 'plague', d: day, until: day + 21, abs: true, from: from || null };
        }
    },

    _strike(world, c, s, day, from, how) {
        const P = Crises.config().plague;
        const key = _key(s.q, s.r);
        const towns = c.data.towns;
        if (towns[key]) return false;
        const course = _irange(world, `course:${c.uid}:${key}`, P.courseDays);
        const mort = _range(world, `mort:${c.uid}:${key}`, P.mortality) * _num(P.typeMort[s.type], 1);
        towns[key] = { name: s.name, start: day, end: day + course, mort: Math.round(mort * 1000) / 1000, pop0: _num(s.population), dead: 0, kingdomId: s.kingdom || null };
        c.data.lastStrike = day;
        Crises._plagueSeed(world, s, day, from ? from.name : null);
        if (from) Crises._log(world, c, 'spread', { name: c.name, town: s.name, from: from.name, how }, { at: s, kingdomId: s.kingdom });
        return true;
    },

    // ── Choices ──────────────────────────────────────

    /** The crisis the player can act in today, with the choices open to them. */
    view(player, world) {
        const c = Crises.active(world);
        const out = { active: c, history: Crises.history(world).slice().reverse(), choices: [], here: null, nextDay: (Crises.state(world) || {}).nextDay };
        if (!c || !player) return out;
        out.choices = Crises.choices(player, world);
        out.here = Crises.near(player, world);
        return out;
    },

    /** What of the crisis is near the player: { host, dist, town, plague, region } (plain facts). */
    near(player, world) {
        const c = Crises.active(world);
        const out = {};
        if (!c || !player || !Number.isFinite(player.q)) return out;
        const here = { q: player.q, r: player.r };
        if (c.kind === 'invasion') {
            let best = null, bd = Infinity;
            for (const h of Crises._hosts(world, c)) { const d = _dist(world, h, here); if (d < bd) { bd = d; best = h; } }
            if (best) { out.host = best; out.dist = bd; }
        } else if (c.kind === 'plague') {
            let best = null, bd = Infinity;
            for (const [k, t] of Object.entries(c.data.towns || {})) {
                if (t.end < _day(world)) continue;
                const [q, r] = k.split(',').map(Number);
                const d = _dist(world, { q, r }, here);
                if (d < bd) { bd = d; best = { q, r, name: t.name }; }
            }
            if (best) { out.plague = best; out.dist = bd; }
        } else if (c.kind === 'famine') {
            const id = Harvests.regionOf(world, player.q, player.r);
            if (_arr(c.data.regions).includes(id)) out.region = Harvests.regionName(world, id);
        }
        const t = world.getTile(player.q, player.r);
        out.town = t && t.settlement ? t.settlement : null;
        return out;
    },

    _choice(id, icon, label, desc, ok, why = '', cost = 0) {
        return { id, icon, label, desc, ok: !!ok, why: ok ? '' : why, cost };
    },

    /** The choices open to the player now: [{ id, icon, label, desc, ok, why, cost, args? }]. */
    choices(player, world) {
        const c = Crises.active(world);
        if (!c || !player || c.phase === 'aftermath') return [];
        const X = Crises.config().choices;
        const gold = _num(player.gold);
        const near = Crises.near(player, world);
        const town = near.town;
        const out = [];
        const food = STAPLES.reduce((s, g) => s + _num(player.inventory && player.inventory[g]), 0);
        if (c.kind === 'invasion' && c.phase === 'war') {
            const host = near.host;
            const close = host && near.dist <= X.rallyRadius;
            const army = _arr(player.army).reduce((s, u) => s + _num(u && u.strength), 0);
            out.push(Crises._choice('rally', '⚔️', host ? `Ride against the vanguard of ${host.name}` : 'Ride against the invaders',
                host ? `Your companies fall on its vanguard (about ${Math.round(_num(host.strength) * X.vanguardShare)} strong). Every man you kill is one fewer at the walls.` : 'No host is near.',
                close && army > 0, !host ? 'No host is near.' : !close ? `The nearest host is ${near.dist} hexes off: come within ${X.rallyRadius}.` : 'You have no army.'));
            const member = Crises._defender(world, c, player);
            for (const amt of X.fundCost) {
                out.push(Object.assign(Crises._choice(`fund`, '🛡️', member ? `Pay ${amt}g toward ${member.name}'s levies` : 'Fund the defence',
                    member ? `About ${Math.floor(amt / X.goldPerSoldier)} more men under arms in its army. Its lord will remember it.` : 'No crown of the alliance is near.',
                    member && gold >= amt, !member ? 'No crown of the alliance is near.' : 'Not enough gold.', amt), { args: [amt] }));
            }
            out.push(Crises._choice('victual', '🍖', 'Sell victuals to the invaders',
                `Their quartermasters pay ${X.victualPremium}× for bread and grain out of their plunder (${Math.round(_num(c.data.chest))}g in the chest). The realms will hear of it.`,
                host && near.dist <= X.rallyRadius + 2 && food > 0 && _num(c.data.chest) > 0, !host || near.dist > X.rallyRadius + 2 ? 'Their camp is far off.' : food <= 0 ? 'You carry no grain or bread.' : 'Their chest is empty.'));
            out.push(Crises._choice('flee', '🏃', 'Flee to safety', `Take the road with the refugees to a town at least ${X.refugeDistance} hexes from any host (a carter's fare of ${X.fare}g).`,
                host && near.dist <= 10 && gold >= X.fare, !host || near.dist > 10 ? 'No host threatens you here.' : 'Not enough gold.', X.fare));
        } else if (c.kind === 'plague') {
            const struck = town && (c.data.towns || {})[_key(town.q, town.r)];
            out.push(Crises._choice('physicians', '⚕️', town ? `Pay physicians for ${town.name}` : 'Pay physicians',
                `${X.physicianCost}g into the town's purse for physicians and herbs: fewer of its people die of ${c.name} for ${X.careDays} days.`,
                !!town && gold >= X.physicianCost && !(town.crisisCare && town.crisisCare.until > _day(world)), !town ? 'You must be in a town.' : gold < X.physicianCost ? 'Not enough gold.' : 'Physicians are already paid here.', X.physicianCost));
            const ruled = Laws.ruled ? Laws.ruled(player, world) : null;
            if (ruled) {
                const shut = Laws.value(world, ruled.id, 'pestilence') === 'quarantine';
                out.push(Crises._choice('quarantine', '🚧', shut ? `Open the gates of ${ruled.name}` : `Proclaim quarantine in ${ruled.name}`,
                    shut ? 'Trade flows again, and the sickness with it.' : 'Sick towns shut their gates: the plague crosses a fraction as often, and trade dries up.', true));
            }
            out.push(Crises._choice('flee', '🏃', 'Flee the pestilence', `Ride out to a town at least ${X.refugeDistance} hexes from any stricken town (a ${X.fare}g fare).`,
                struck && gold >= X.fare, !struck ? 'The plague is not in this town.' : 'Not enough gold.', X.fare));
        } else if (c.kind === 'schism' && (c.phase === 'split' || c.phase === 'strife' || c.phase === 'dispute')) {
            const k = town ? _kingdom(world, town.kingdom) : null;
            const ofFaith = !!(k && k.religion && k.capital && (c.data.sides[k.id] || k.id === c.data.originId || _dist(world, k.capital, c.place) <= _num(c.data.reach, 30)));
            for (const side of ['orthodox', 'reformed']) {
                out.push(Object.assign(Crises._choice('preach', '📣', `Preach for ${Crises.sideName(c, side)}${k ? ` in ${Names.realm(k.name)}` : ''}`,
                    `${X.preachCost}g in alms and pamphlets to the clergy of ${town ? town.name : 'the town'}: the realm leans your way${k && k.religion && k.religion.rite ? ` (it holds to ${Crises.sideName(c, k.religion.rite)})` : ''}. Realms of that side think better of you; the other worse.`,
                    ofFaith && gold >= X.preachCost, !ofFaith ? 'Not in a realm the new church has reached.' : 'Not enough gold.', X.preachCost), { args: [side] }));
            }
            const purse = town ? _num(Economy.townPurse(town)) : 0;
            const take = Math.min(X.indulgenceMax, Math.floor(purse * X.indulgence));
            out.push(Crises._choice('indulgences', '📜', 'Sell indulgences', `The frightened faithful of ${town ? town.name : 'the town'} pay about ${take}g for pardons. The church's name suffers, and the reformers' case grows.`,
                ofFaith && take > 0, !ofFaith ? 'Not in a realm the new church has reached.' : 'The town has no coin to spare.'));
        } else if (c.kind === 'famine') {
            const hungry = town && near.region;
            out.push(Crises._choice('relief', '🍞', town ? `Give your grain and bread to ${town.name}` : 'Give food to the hungry',
                `Everything staple in your packs (${food}) goes into its market: bread grows cheaper there, and the town and its lord remember.`,
                hungry && food > 0, !hungry ? 'This town is not in the famine lands.' : 'You carry no grain or bread.'));
        } else if (c.kind === 'rush') {
            const boom = _live(world, _num(c.data.townQ), _num(c.data.townR));
            out.push(Crises._choice('stake', '⛏️', `Stake a claim at ${boom ? boom.name : 'the diggings'}`, 'Bid for the lease on the diggings when the crown auctions it (Hinterland panel there), or carry tools and food up to the miners, who pay boomtown prices.', false, `Go to ${boom ? boom.name : 'the boomtown'}: its markets and the mine lease are there.`));
        }
        return out;
    },

    sideName(c, side) {
        return side === 'reformed' ? (c.data.reformedName || 'the new church') : 'the old faiths';
    },

    /** The alliance crown the player stands nearest (for funding), or null. */
    _defender(world, c, player) {
        let best = null, bd = Infinity;
        for (const id of _arr(c.data.alliance)) {
            const k = _kingdom(world, id);
            if (!_alive(k) || !k.capital) continue;
            const d = _dist(world, k.capital, player);
            if (d < bd) { bd = d; best = k; }
        }
        return best && bd <= 30 ? best : null;
    },

    /** A safe town at least refugeDistance from the danger, nearest the player: { q, r, name } or null. */
    refuge(player, world) {
        const c = Crises.active(world);
        if (!c || !player) return null;
        const X = Crises.config().choices;
        const danger = c.kind === 'invasion' ? Crises._hosts(world, c).map(h => ({ q: h.q, r: h.r }))
            : Object.entries(c.data.towns || {}).filter(([, t]) => t.end >= _day(world)).map(([k]) => { const [q, r] = k.split(',').map(Number); return { q, r }; });
        let best = null, bd = Infinity;
        for (const s of _views(world)) {
            if (c.data.realmId && s.kingdom === c.data.realmId) continue;
            if (danger.some(d => _dist(world, d, s) < X.refugeDistance)) continue;
            const d = _dist(world, s, player);
            if (d < bd) { bd = d; best = s; }
        }
        return best ? { q: best.q, r: best.r, name: best.name } : null;
    },

    _record(player, world, c, id, text) {
        const ps = Crises.playerState(player);
        ps.acts.push({ uid: c.uid, id, day: _day(world) });
        if (ps.acts.length > 60) ps.acts.splice(0, ps.acts.length - 60);
        if (player.house && text) House._chronicle(player.house, world, text, ['crisis']);
        c.data.playerActs = (c.data.playerActs || 0) + 1;
    },

    /**
     * Take a choice. args by choice: fund [amount]; preach [side];
     * rally [{ victory, dealt }] — the caller fights the vanguard
     * (PlayerMilitary.combat) and hands in the result; flee — the caller
     * moves the player to Crises.refuge (the domain only charges the fare).
     * → { success, text, refuge? }
     */
    act(player, world, id, ...args) {
        const c = Crises.active(world);
        if (!c || !player) return { success: false, text: 'There is no crisis to act in.' };
        const ch = Crises.choices(player, world).find(x => x.id === id && (x.args == null || JSON.stringify(x.args) === JSON.stringify(args.slice(0, x.args.length))));
        if (!ch || !ch.ok) return { success: false, text: (ch && ch.why) || 'You cannot do that now.' };
        const X = Crises.config().choices;
        const near = Crises.near(player, world);
        const town = near.town;
        const day = _day(world);
        c.data.lastPlayerName = player.name || null;
        switch (id) {
            case 'rally': {
                const r = _obj(args[0]) || {};
                const host = near.host;
                const van = _num(host.strength) * X.vanguardShare;
                const loss = Math.round(van * (r.victory ? 0.6 : 0.15));
                host.strength = Math.max(0, Math.round(_num(host.strength) - loss));
                if (host.strength < Crises.config().invasion.minHostStrength) { host.destroyed = true; host.slainByPlayer = true; }
                for (const kid of _arr(c.data.alliance)) {
                    if (!player.reputation) player.reputation = {};
                    player.reputation[kid] = _num(player.reputation[kid]) + (r.victory ? 6 : 2);
                    NPCLords.rememberRealm(world, kid, 'war_aid', { day, note: `against ${host.name}` });
                }
                if (r.victory && player.house) House.award(player.house, 10, `broke the vanguard of ${host.name}`, day);
                Crises._record(player, world, c, 'rally', `${player.name || 'The head of the House'} rode against the vanguard of ${host.name}${r.victory ? ' and broke it' : ' and was beaten back'}.`);
                return { success: true, text: r.victory ? `The vanguard is broken: ${host.name} is ${loss} men weaker.` : `Beaten back; still, ${host.name} lost ${loss} men.` };
            }
            case 'fund': {
                const amt = _num(args[0]);
                const k = Crises._defender(world, c, player);
                player.gold -= amt;
                k.treasury = _num(k.treasury) + amt;
                k.military = _num(k.military) + Math.floor(amt / X.goldPerSoldier);
                Ledger.record(player, 'crisisAid', -amt);
                NPCLords.rememberRealm(world, k.id, 'war_aid', { day, weight: Math.min(10, 2 + amt / 100), note: 'gold for the levies' });
                if (!player.reputation) player.reputation = {};
                player.reputation[k.id] = _num(player.reputation[k.id]) + Math.round(amt / 50);
                Crises._record(player, world, c, 'fund', `${player.name || 'The House'} paid ${amt} gold toward the levies of ${Names.realm(k.name)} against the invaders.`);
                return { success: true, text: `${amt}g to ${Names.realm(k.name)}: ${Math.floor(amt / X.goldPerSoldier)} more men under arms.` };
            }
            case 'victual': {
                const host = near.host;
                let units = 0, pay = 0;
                for (const g of STAPLES) {
                    const have = Math.floor(_num(player.inventory && player.inventory[g]));
                    if (have <= 0) continue;
                    const unit = Math.max(1, Math.round(PlayerInventory.goodValue(g) || 2) * X.victualPremium);
                    const n = Math.min(have, Math.floor((_num(c.data.chest) - pay) / unit));
                    if (n <= 0) continue;
                    player.inventory[g] = have - n;
                    if (player.inventory[g] <= 0) delete player.inventory[g];
                    units += n;
                    pay += n * unit;
                }
                if (!units) return { success: false, text: 'Their chest cannot pay for what you carry.' };
                c.data.chest = Math.round(_num(c.data.chest) - pay);
                player.gold = _num(player.gold) + pay;
                Ledger.record(player, 'crisisTrade', pay);
                host.fedUntil = day + Math.min(60, units);
                player.karma = _num(player.karma) - 3;
                for (const kid of _arr(c.data.alliance)) {
                    if (!player.reputation) player.reputation = {};
                    player.reputation[kid] = _num(player.reputation[kid]) - 5;
                }
                Crises._record(player, world, c, 'victual', `${player.name || 'The House'} sold bread to the invaders' camp.`);
                return { success: true, text: `${units} measures of food sold for ${pay}g out of their plunder. The host is fed for ${Math.min(60, units)} days.` };
            }
            case 'flee': {
                const to = Crises.refuge(player, world);
                if (!to) return { success: false, text: 'There is nowhere safe to go.' };
                player.gold -= X.fare;
                const dest = _live(world, to.q, to.r);
                if (dest) Economy.payTown(dest, X.fare);
                Ledger.record(player, 'crisisAid', -X.fare);
                Crises._record(player, world, c, 'flee', null);
                return { success: true, text: `You take the road to ${to.name}.`, refuge: to };
            }
            case 'physicians': {
                player.gold -= X.physicianCost;
                Economy.payTown(town, X.physicianCost);
                town.crisisCare = { until: day + X.careDays, by: 'player' };
                Ledger.record(player, 'crisisAid', -X.physicianCost);
                if (town.kingdom) {
                    if (!player.reputation) player.reputation = {};
                    player.reputation[town.kingdom] = _num(player.reputation[town.kingdom]) + 4;
                    NPCLords.rememberRealm(world, town.kingdom, 'gift', { day, note: `physicians for ${town.name}` });
                }
                player.karma = _num(player.karma) + 2;
                Crises._record(player, world, c, 'physicians', `${player.name || 'The House'} paid physicians to fight ${c.name} in ${town.name}.`);
                return { success: true, text: `Physicians go house to house in ${town.name}.` };
            }
            case 'quarantine': {
                const k = Laws.ruled(player, world);
                const shut = Laws.value(world, k.id, 'pestilence') === 'quarantine';
                const res = Laws.enact(player, world, 'pestilence', shut ? 'open' : 'quarantine');
                if (res.success) Crises._record(player, world, c, 'quarantine', shut ? null : `${player.name || 'The crown'} shut the gates of ${Names.realm(k.name)}'s sick towns against ${c.name}.`);
                return { success: !!res.success, text: res.text || res.reason };
            }
            case 'preach': {
                const side = args[0] === 'reformed' ? 'reformed' : 'orthodox';
                const k = _kingdom(world, town.kingdom);
                player.gold -= X.preachCost;
                Economy.payTown(town, X.preachCost);
                Ledger.record(player, 'crisisAid', -X.preachCost);
                const lean = _obj(c.data.lean) || (c.data.lean = {});
                lean[k.id] = _clamp(_num(lean[k.id]) + (side === 'reformed' ? X.preachShift : -X.preachShift), -1, 1);
                Crises.playerState(player).sides[c.uid] = side;
                for (const o of world.kingdoms) {
                    if (!_alive(o) || !o.religion || o.religion.riteOf !== c.uid || !o.religion.rite) continue;
                    if (!player.reputation) player.reputation = {};
                    player.reputation[o.id] = _num(player.reputation[o.id]) + (o.religion.rite === side ? 3 : -3);
                }
                Crises._record(player, world, c, 'preach', `${player.name || 'The House'} preached for ${Crises.sideName(c, side)} in ${town.name}.`);
                return { success: true, text: `The crowds of ${town.name} hear you out. ${k.name} leans ${side === 'reformed' ? 'toward reform' : 'toward the old church'}.` };
            }
            case 'indulgences': {
                const k = _kingdom(world, town.kingdom);
                const take = Economy.drawTown(town, Math.min(X.indulgenceMax, Math.floor(_num(Economy.townPurse(town)) * X.indulgence)));
                player.gold = _num(player.gold) + take;
                Ledger.record(player, 'crisisTrade', take);
                player.karma = _num(player.karma) - 4;
                if (k && k.religion) k.religion.piety = Math.max(0, _num(k.religion.piety) - 2);
                const lean = _obj(c.data.lean) || (c.data.lean = {});
                if (k) lean[k.id] = _clamp(_num(lean[k.id]) + X.preachShift / 2, -1, 1);
                Crises._record(player, world, c, 'indulgences', null);
                return { success: true, text: `${take}g in pardons sold in ${town.name}. The reformers point at you from the pulpit.` };
            }
            case 'relief': {
                let n = 0;
                for (const g of STAPLES) {
                    const have = Math.floor(_num(player.inventory && player.inventory[g]));
                    if (have <= 0) continue;
                    const into = SettlementMarket.tracks(g) ? g : 'grain';
                    if (!SettlementMarket.tracks(into)) continue;
                    player.inventory[g] = 0;
                    delete player.inventory[g];
                    SettlementMarket.add(town, into, have * X.reliefPerUnit);
                    n += have;
                }
                if (!n) return { success: false, text: 'Nothing the market here can take.' };
                if (town.kingdom) {
                    if (!player.reputation) player.reputation = {};
                    player.reputation[town.kingdom] = _num(player.reputation[town.kingdom]) + Math.min(15, 2 + Math.floor(n / 5));
                    NPCLords.rememberRealm(world, town.kingdom, 'gift', { day, note: `bread for ${town.name}` });
                }
                player.karma = _num(player.karma) + Math.min(6, 1 + Math.floor(n / 10));
                Crises._record(player, world, c, 'relief', `${player.name || 'The House'} gave ${n} measures of food to the hungry of ${town.name}.`);
                return { success: true, text: `${n} measures of food go into the market of ${town.name}.` };
            }
            default:
                return { success: false, text: 'You cannot do that.' };
        }
    },

    // ── The Annals ───────────────────────────────────

    /**
     * Crises as chapters of the Annals (systems/annals.js `ages`): those the
     * world lived through since `fromDay`, oldest first.
     * → [{ id, kind, icon, title, fromYear, toYear, live, paragraphs: [{ text }] }]
     */
    annalChapters(world, fromDay = 0) {
        const st = world && _obj(world.crises);
        if (!st) return [];
        const list = [...st.history, ...(st.active ? [st.active] : [])].filter(c => (c.endDay == null || c.endDay >= fromDay) && c.log.length);
        const yr = (d) => (Number.isFinite(world && world.baseYear) ? world.baseYear : 1) + Math.floor((Math.max(1, Math.floor(_num(d, 1))) - 1) / YEAR);
        return list.map(c => {
            const info = KIND_INFO[c.kind];
            const byYear = new Map();
            for (const e of c.log) {
                const y = yr(e.day);
                if (!byYear.has(y)) byYear.set(y, []);
                byYear.get(y).push(Crises.line(world, c, e));
            }
            const paragraphs = [...byYear.entries()].map(([y, lines]) => ({ year: y, text: `In the year ${y}, ${lines.map((t, i) => (i === 0 ? t.charAt(0).toLowerCase() + t.slice(1) : t)).join(' ')}` }));
            const live = !c.endDay;
            return {
                id: `age_${c.uid}`, kind: c.kind, icon: info.icon,
                title: `${c.name.charAt(0).toUpperCase() + c.name.slice(1)}, ${live ? `year ${yr(c.startDay)} to the present` : `years ${yr(c.startDay)}–${yr(c.endDay)}`}`,
                fromYear: yr(c.startDay), toYear: live ? null : yr(c.endDay), live, outcome: c.outcome, paragraphs,
            };
        });
    },
};

// ── The kinds ────────────────────────────────────────────

const HANDLERS = {
    invasion: {
        eligible(world) { return world.kingdoms.filter(_alive).length >= 3 && !!Crises._beachhead(world); },
        begin(world, c, day) {
            const I = Crises.config().invasion;
            const at = Crises._beachhead(world);
            if (!at) return false;
            const people = _pick(world, `people:${c.uid}`, I.peoples) || DEFAULTS.invasion.peoples[0];
            const cultures = (Cultures.cultureNames ? Cultures.cultureNames() : []) || [];
            c.name = `the Coming of ${people.name.replace(/^the /, 'the ')}`;
            c.data = { people, culture: cultures.includes(people.culture) ? people.culture : (people.culture || 'Nomadic'), at: { q: at.q, r: at.r }, edge: at.edge, hosts: [], alliance: [], aloof: [], chest: 0, realmId: null };
            c.place = { q: at.q, r: at.r };
            Crises._phase(c, 'omens', day, day + _irange(world, `omens:${c.uid}`, I.omensDays));
            Crises._log(world, c, 'omens', { edge: at.edge, people: people.name, from: people.from }, { big: true, at });
            return true;
        },
        week(world, c, day) {
            const I = Crises.config().invasion;
            if (c.phase === 'omens' && day >= c.phaseEnd) {
                // The landing: the nearest realms' might sets the host's
                const at = c.data.at;
                const near = world.kingdoms.filter(k => _alive(k) && k.capital).sort((a, b) => _dist(world, a.capital, at) - _dist(world, b.capital, at)).slice(0, 3);
                const avg = near.reduce((s, k) => s + _num(k.military), 0) / Math.max(1, near.length);
                const total = Math.max(I.minHost, Math.round(avg * _range(world, `host:${c.uid}`, I.hostMult)));
                const n = _irange(world, `nhosts:${c.uid}`, I.hosts);
                for (let i = 0; i < n; i++) {
                    Crises._landHost(world, c, at, n > 1 ? `${c.data.people.host} (${['the Van', 'the Main', 'the Rear'][i] || `the ${i + 1}th`})` : c.data.people.host, Math.round(total / n));
                }
                c.data.strength0 = total;
                Crises._phase(c, 'war', day, day + Math.round(_range(world, `war:${c.uid}`, I.warYears) * YEAR));
                let target = null, bd = Infinity;
                for (const s of _views(world)) { const d = _dist(world, s, at); if (d < bd) { bd = d; target = s; } }
                Crises._log(world, c, 'landing', { people: c.data.people.name, edge: c.data.edge, hosts: n, strength: total, target: target ? target.name : 'the nearest towns' }, { big: true, at });
                Crises._askAlliance(world, c, at);
                return;
            }
            if (c.phase !== 'war') return;
            // Fresh waves from over the edge, a year apart, while the invasion lives
            const wave = Math.floor((day - c.phaseDay) / YEAR);
            if (wave >= 1 && wave <= I.waves && _num(c.data.waves) < wave && (Crises._hosts(world, c).length || _alive(_kingdom(world, c.data.realmId)))) {
                c.data.waves = wave;
                const str = Math.round(_num(c.data.strength0) * I.waveShare);
                Crises._landHost(world, c, c.data.at, `${c.data.people.host} (wave ${wave + 1})`, str);
                Crises._log(world, c, 'wave', { people: c.data.people.name, edge: c.data.edge, strength: str }, { big: true, at: c.data.at });
            }
            // Attrition: a host away from its own towns forages and starves
            const realm = _kingdom(world, c.data.realmId);
            for (const h of Crises._hosts(world, c)) {
                const t = world.getTile(h.q, h.r);
                const home = realm && t && t.kingdom === realm.id;
                if (!home && _num(h.fedUntil) < day) h.strength = Math.round(_num(h.strength) * (1 - I.attritionWeekly));
                if (_num(h.strength) < I.minHostStrength) h.destroyed = true;
            }
            const hosts = Crises._hosts(world, c).filter(h => !h.destroyed);
            const holds = _alive(realm) && KingdomAI._settlementsOf(realm, world).length > 0;
            if (!holds && (!hosts.length || day >= c.phaseEnd)) {
                // Broken, or never won a foothold before their years ran out: they sail home
                for (const h of hosts) h.destroyed = true;
                Crises._log(world, c, hosts.length ? 'withdrew' : 'repelled', { people: c.data.people.name, realm: realm ? realm.name : 'their realm' }, { big: true, at: c.data.at });
                Crises._finish(world, c, day, 'repelled');
            } else if ((!hosts.length && holds) || day >= c.phaseEnd) {
                // The hosts lay down their arms in the realm; peace with all
                for (const h of hosts) { realm.military = _num(realm.military) + Math.round(_num(h.strength) * 0.5); h.destroyed = true; }
                for (const id of [...(realm.wars || [])]) {
                    const o = _kingdom(world, id);
                    if (o) KingdomAI.endWar(realm, o, world, { text: `🕊️ ${o.name} makes peace with ${Names.realm(realm.name)}.` });
                }
                Crises._log(world, c, 'settled', { realm: realm.name }, { big: true, at: realm.capital, kingdomId: realm.id });
                Crises._finish(world, c, day, 'settled');
            }
        },
    },

    plague: {
        eligible(world) {
            return _views(world).some(s => s.market && _arr(s.market.links).length && KingdomNavy.isPortTile(world, s.q, s.r));
        },
        begin(world, c, day) {
            const P = Crises.config().plague;
            const ports = _views(world).filter(s => s.market && _arr(s.market.links).length && KingdomNavy.isPortTile(world, s.q, s.r))
                .sort((a, b) => _arr(b.market.links).length - _arr(a.market.links).length || _num(b.population) - _num(a.population) || (a.name < b.name ? -1 : 1));
            if (!ports.length) return false;
            const top = ports.slice(0, 5);
            const s = _live(world, ...(() => { const p = top[Math.floor(_roll(world, `port:${c.uid}`) * top.length) % top.length]; return [p.q, p.r]; })());
            if (!s) return false;
            c.name = _pick(world, `pname:${c.uid}`, P.names) || 'the Great Pestilence';
            c.data = { towns: {}, dead: 0, origin: s.name };
            c.place = { q: s.q, r: s.r };
            Crises._phase(c, 'spreading', day, day + Math.round(P.maxYears * YEAR));
            Crises._strike(world, c, s, day, null, '');
            Crises._log(world, c, 'start', { name: c.name, town: s.name }, { big: true, at: s, kingdomId: s.kingdom });
            return true;
        },
        week(world, c, day) {
            const P = Crises.config().plague;
            const views = _views(world);
            const byKey = new Map(views.map(s => [_key(s.q, s.r), s]));
            const towns = c.data.towns;
            // The course in each stricken town: its dead, week by week
            for (const [k, t] of Object.entries(towns)) {
                if (day > t.end) {
                    // Its course run: the dead go into a plague pit outside the walls, a mound
                    // the town keeps (systems/townMemory.js; only where enough died)
                    if (!t.pit) {
                        t.pit = true;
                        const s = byKey.get(k);
                        const live = s && _live(world, s.q, s.r);
                        if (live) TownMemory.mark(live, 'plague', { dead: t.dead }, world);
                    }
                    continue;
                }
                const s = byKey.get(k);
                const live = s && _live(world, s.q, s.r);
                if (!live) continue;
                const care = live.crisisCare && live.crisisCare.until >= day ? P.careMult : 1;
                const span = Math.max(7, t.end - t.start);
                const dead = Math.min(_num(live.population) - 20, Math.round(t.pop0 * t.mort * care * 7 / span));
                if (dead > 0) { live.population -= dead; t.dead += dead; c.data.dead += dead; }
                // Keep the sickness alive in the town while its course runs
                const sk = live.sickness;
                if (!sk || sk.k !== 'plague' || (sk.abs && sk.until < day + 7)) Crises._plagueSeed(world, live, day, null);
            }
            // Spreading along the trade links
            if (c.phase === 'spreading') {
                const age = (day - c.startDay) / YEAR;
                const decay = age > P.decayAfterYears ? Math.pow(P.decayWeekly, (day - c.startDay - P.decayAfterYears * YEAR) / 7) : 1;
                const cap = Math.ceil(views.length * P.maxShare);
                const add = [];
                for (const [k, t] of Object.entries(towns)) {
                    if (day > t.end || day < t.start + 7) continue;
                    const src = byKey.get(k);
                    if (!src || !src.market) continue;
                    const shutA = Illness.quarantined(world, src);
                    for (const [q, r, , sea, road] of _arr(src.market.links)) {
                        const dk = _key(q, r);
                        if (towns[dk] || add.some(x => x.k === dk)) continue;
                        const dst = byKey.get(dk);
                        if (!dst) continue;
                        // A shut gate at either end keeps most of it out (one fold, not two)
                        const shut = shutA || Illness.quarantined(world, dst) ? P.quarantine : 1;
                        const chance = P.spreadBase * (road ? P.road : 1) * (sea ? P.sea : 1) * shut * decay;
                        if (_roll(world, `spread:${c.uid}:${k}>${dk}:${day}`) < chance) add.push({ k: dk, dst, src, how: sea ? 'by ship' : road ? 'along the road' : 'by the carters' });
                    }
                }
                for (const x of add) {
                    if (Object.keys(towns).length >= cap) break;
                    const live = _live(world, x.dst.q, x.dst.r);
                    if (live) Crises._strike(world, c, live, day, x.src, x.how);
                }
                const running = Object.values(towns).some(t => t.end >= day);
                if ((!running && day - _num(c.data.lastStrike) >= 14) || day - _num(c.data.lastStrike) >= P.quietDays || day >= c.phaseEnd) {
                    Crises._phase(c, 'waning', day, null);
                    Crises._log(world, c, 'waning', { name: c.name, towns: Object.keys(towns).length }, {});
                }
            } else if (c.phase === 'waning' && !Object.values(towns).some(t => t.end >= day)) {
                // Burnt out for now. Within its years it may come back with the spring on
                // another ship (a port it has not yet struck); else it is over.
                const within = day - c.startDay < P.maxYears * YEAR && !c.data.noReturn;
                if (within && Seasons.dayOfYear(day) > 7) return;
                const ports = within ? views.filter(s => !towns[_key(s.q, s.r)] && s.market && _arr(s.market.links).length && KingdomNavy.isPortTile(world, s.q, s.r)) : [];
                if (ports.length && _roll(world, `rewave:${c.uid}:${day}`) < P.returnChance) {
                    const port = ports[Math.floor(_roll(world, `report:${c.uid}:${day}`) * ports.length) % ports.length];
                    const live = _live(world, port.q, port.r);
                    if (live) {
                        c.data.waves = _num(c.data.waves) + 1;
                        Crises._phase(c, 'spreading', day, c.startDay + Math.round(P.maxYears * YEAR));
                        Crises._strike(world, c, live, day, null, '');
                        Crises._log(world, c, 'return', { name: c.name, town: live.name }, { big: true, at: live, kingdomId: live.kingdom });
                        return;
                    }
                }
                Crises._log(world, c, 'end', { name: c.name, dead: Math.round(c.data.dead).toLocaleString('en-US'), towns: Object.keys(towns).length }, { big: true, at: c.place });
                Crises._finish(world, c, day, 'passed');
            }
        },
    },

    schism: {
        // A reformer splits a faith; the new church spreads beyond its realm, and every
        // crown within its reach must embrace it or hold to its old faith (where the
        // new teaching then lives on as a heresy, Religion's own heresies).
        eligible(world) { return world.kingdoms.filter(k => _alive(k) && k.religion && k.religion.faithId && !k.religion.rite).length >= 3; },
        _arena(world, c) {
            const o = _kingdom(world, c.data.originId);
            const at = (o && o.capital) || c.place;
            return world.kingdoms.filter(k => _alive(k) && k.religion && k.capital && (k.id === c.data.originId || c.data.sides[k.id] || _dist(world, k.capital, at) <= c.data.reach));
        },
        begin(world, c, day) {
            const S = Crises.config().schism;
            const realms = world.kingdoms.filter(k => _alive(k) && k.religion && k.religion.faithId && !k.religion.rite && k.capital)
                .sort((a, b) => (a.id < b.id ? -1 : 1));
            if (realms.length < 3) return false;
            const origin = realms[Math.floor(_roll(world, `origin:${c.uid}`) * realms.length) % realms.length];
            const town = _views(world).filter(s => s.kingdom === origin.id).sort((a, b) => _num(b.population) - _num(a.population))[0];
            if (!town) return false;
            const faithName = origin.religion.name || (Religion.FAITHS[origin.religion.faithId] || {}).name || 'the faith';
            const short = faithName.replace(/^(The|the) /, '').replace(/^Faith of the /, '');
            c.name = `the Schism of ${faithName.replace(/^The /, 'the ')}`;
            c.data = {
                faithId: origin.religion.faithId, faithName, originId: origin.id, town: town.name, reach: S.reach,
                reformer: _pick(world, `ref:${c.uid}`, S.reformers),
                reformedName: _fill(_pick(world, `rname:${c.uid}`, S.reformedNames), { faith: short, town: town.name }),
                lean: {}, sides: {}, wars: 0,
            };
            c.place = { q: town.q, r: town.r };
            Crises._phase(c, 'dispute', day, day + _irange(world, `disp:${c.uid}`, S.disputeDays));
            Crises._log(world, c, 'dispute', { reformer: c.data.reformer, town: town.name, faith: faithName }, { big: true, at: town, kingdomId: origin.id });
            return true;
        },
        _convert(c, k) {
            const r = k.religion;
            if (!r.oldFaith) r.oldFaith = { faithId: r.faithId, name: r.name, icon: r.icon };
            r.faithId = c.data.faithId;
            r.rite = 'reformed';
            r.name = c.data.reformedName.charAt(0).toUpperCase() + c.data.reformedName.slice(1);
            if (Array.isArray(r.heresies)) r.heresies = r.heresies.filter(h => h.id !== `reform_${c.uid}`);
        },
        _revert(k) {
            const r = k.religion;
            if (r.oldFaith) Object.assign(r, r.oldFaith);
            delete r.oldFaith;
            r.rite = 'orthodox';
        },
        _declare(world, c, k, side) {
            const S = Crises.config().schism;
            c.data.sides[k.id] = side;
            k.religion.riteOf = c.uid;
            if (side === 'reformed') {
                HANDLERS.schism._convert(c, k);
            } else {
                k.religion.rite = 'orthodox';
                // The new teaching lives on in its towns as a heresy (Religion.processTurn grows it, or it fizzles)
                if (!Array.isArray(k.religion.heresies)) k.religion.heresies = [];
                if (k.religion.heresies.length < 2) {
                    k.religion.heresies.push({
                        id: `reform_${c.uid}`, name: c.data.reformedName.charAt(0).toUpperCase() + c.data.reformedName.slice(1),
                        description: `The teaching of ${c.data.reformer}`, strength: S.heresyStrength, unityPenalty: -15, scholarshipBonus: 3, spreadChance: 0.03,
                    });
                }
            }
            k.stability = Math.max(0, _num(k.stability, 50) - 3);
            for (const [oid, os] of Object.entries(c.data.sides)) {
                const o = _kingdom(world, oid);
                if (!_alive(o) || o.id === k.id) continue;
                const d = os === side ? S.sameCamp : S.otherCamp;
                k.relations[o.id] = _clamp(_num(k.relations[o.id]) + d, -100, 100);
                if (o.relations) o.relations[k.id] = _clamp(_num(o.relations[k.id]) + d, -100, 100);
            }
            Crises._log(world, c, 'declare', { realm: k.name, side: Crises.sideName(c, side) }, { kingdomId: k.id, at: k.capital });
        },
        week(world, c, day) {
            const S = Crises.config().schism;
            const arena = HANDLERS.schism._arena(world, c);
            const o = _kingdom(world, c.data.originId);
            if (c.phase === 'dispute') {
                if (o && o.religion) o.religion.piety = Math.max(0, _num(o.religion.piety) + S.pietyWeekly);
                if (day >= c.phaseEnd) {
                    Crises._phase(c, 'split', day, day + _irange(world, `split:${c.uid}`, S.splitDays));
                    Crises._log(world, c, 'split', { faith: c.data.faithName, reformed: c.data.reformedName }, { big: true, at: c.place });
                    if (_alive(o)) HANDLERS.schism._declare(world, c, o, 'reformed');
                }
                return;
            }
            if (c.phase === 'split' || c.phase === 'strife') {
                const ref = Object.entries(c.data.sides).filter(([, sd]) => sd === 'reformed').map(([id]) => id);
                for (const k of arena) {
                    if (k.religion.piety != null) k.religion.piety = Math.max(0, _num(k.religion.piety) + S.pietyWeekly * 0.5);
                    if (c.data.sides[k.id]) continue;
                    if (_roll(world, `decl:${c.uid}:${k.id}:${day}`) >= S.declareWeekly * (c.phase === 'strife' ? 2 : 1)) continue;
                    // The lean: the lord's own, friendship with the new church's crowns, the player's
                    // preaching; a realm of the same old faith takes the reform more readily than a stranger
                    let lean = S.reformLean - 0.5 + (_roll(world, `lean:${c.uid}:${k.id}`) - 0.5) * 0.6
                        + 0.15 * LordInfluence.lean(k, 'ambition') - 0.1 * LordInfluence.lean(k, 'honor');
                    if (k.religion.faithId === c.data.faithId) lean += 0.15;
                    if (ref.length && k.relations) lean += ref.reduce((sum, id) => sum + _num(k.relations[id]), 0) / ref.length / 400;
                    lean += _num((c.data.lean || {})[k.id]);
                    HANDLERS.schism._declare(world, c, k, lean > 0 ? 'reformed' : 'orthodox');
                }
            }
            if (c.phase === 'split' && day >= c.phaseEnd) {
                for (const k of arena) if (!c.data.sides[k.id]) HANDLERS.schism._declare(world, c, k, 'orthodox');
                Crises._phase(c, 'strife', day, day + Math.round(_range(world, `strife:${c.uid}`, S.strifeYears) * YEAR));
            }
            if (c.phase !== 'strife') return;
            const camp = (side) => arena.filter(k => c.data.sides[k.id] === side);
            // Wars of religion between neighbours of the two camps on bad terms
            if (_num(c.data.wars) < S.maxWars) {
                outer: for (const a of camp('reformed')) {
                    for (const b of camp('orthodox')) {
                        if (_dist(world, a.capital, b.capital) > 25) continue;
                        if ((a.wars || []).includes(b.id) || KingdomAI.hasTruce(a, b, world) || KingdomAI.hasTruce(b, a, world)) continue;
                        if (_num(a.relations[b.id]) > -40) continue;
                        if (_roll(world, `holywar:${c.uid}:${a.id}:${b.id}:${day}`) >= S.warChance) continue;
                        Crises._war(world, a, b, c);
                        Crises._log(world, c, 'war', { a: a.name, b: b.name }, { big: true, at: a.capital });
                        break outer;
                    }
                }
            }
            if (day < c.phaseEnd) return;
            const might = (side) => camp(side).reduce((sum, k) => sum + _num(k.military), 0);
            const r = might('reformed'), od = might('orthodox');
            if (r > 0 && od > 0 && (r >= od * S.triumphRatio || od >= r * S.triumphRatio)) {
                const win = r > od ? 'reformed' : 'orthodox';
                for (const k of arena) {
                    if (!c.data.sides[k.id]) continue;
                    if (win === 'reformed') HANDLERS.schism._convert(c, k);
                    else if (c.data.sides[k.id] === 'reformed') HANDLERS.schism._revert(k);
                    c.data.sides[k.id] = win;
                }
                const winners = camp(win).sort((a, b) => _num(b.military) - _num(a.military));
                Crises._log(world, c, win === 'reformed' ? 'triumph' : 'triumphOld', { reformed: c.data.reformedName, side: Crises.sideName(c, win), faith: c.data.faithName, winner: winners[0] ? winners[0].name : 'the strongest crown' }, { big: true, at: c.place });
                Crises._finish(world, c, day, `triumph:${win}`);
            } else {
                Crises._log(world, c, 'peace', { orthodox: Crises.sideName(c, 'orthodox'), reformed: c.data.reformedName }, { big: true, at: c.place });
                Crises._finish(world, c, day, 'peace');
            }
        },
    },

    famine: {
        eligible(world) {
            const st = world && _obj(world.harvests);
            return !!(st && st.cur && st.cur.regions && Object.keys(st.cur.regions).length >= 2);
        },
        begin(world, c, day) {
            const F = Crises.config().famine;
            const st = world.harvests;
            const views = _views(world).filter(s => s.kingdom);
            if (!views.length) return false;
            // Where the climate's era bites hardest, if one does (world/climate.js); else anywhere
            const harsh = Climate.harshest(world, views, day, 5);
            const pool = harsh.length ? harsh : views.slice().sort((a, b) => (a.name < b.name ? -1 : 1));
            const center = pool[Math.floor(_roll(world, `center:${c.uid}`) * pool.length) % pool.length];
            const regions = new Set();
            for (const s of _views(world)) if (_dist(world, s, center) <= F.radius) regions.add(st.cur.towns[_key(s.q, s.r)] || Harvests.regionOfTown(world, s));
            const ids = [...regions].filter(Boolean);
            if (!ids.length) return false;
            c.name = _pick(world, `fname:${c.uid}`, F.names) || 'the Hungry Years';
            const years = _irange(world, `fyears:${c.uid}`, F.years);
            c.data = { regions: ids, center: center.name, years, planted: {} };
            c.place = { q: center.q, r: center.r };
            Crises._phase(c, 'hungry', day, day + years * YEAR);
            const realms = [...new Set(ids.map(id => (st.cur.regions[id] || {}).kingdomId).filter(Boolean))].map(id => (_kingdom(world, id) || {}).name).filter(Boolean);
            Crises._log(world, c, 'start', { region: `the lands about ${center.name}`, realms: _listNames(realms.slice(0, 4)) || 'the free towns' }, { big: true, at: center });
            HANDLERS.famine._plant(world, c, day);
            return true;
        },
        /** This year's blights laid in the harvest plan of the famine's regions. */
        _plant(world, c, day) {
            const F = Crises.config().famine;
            const st = world.harvests;
            if (!st || !st.cur || !st.cur.regions) return;
            const Y = st.cur.year;
            if (c.data.planted[Y] || st.cur.settled) return;
            c.data.planted[Y] = true;
            const n = Object.keys(c.data.planted).length;
            const ramp = n === 1 || n >= c.data.years ? F.ramp : 1;
            const doy = Seasons.dayOfYear(day);
            for (const id of c.data.regions) {
                const rec = st.cur.regions[id];
                if (!rec || !Array.isArray(rec.plan)) continue;
                const sev = Math.round(_range(world, `fsev:${c.uid}:${Y}:${id}`, F.severity) * ramp * 1000) / 1000;
                rec.plan = rec.plan.filter(p => p.kind !== 'rust');
                rec.plan.push({ kind: 'rust', day: doy + 1, sev });
                if (n % 2 === 0) rec.plan.push({ kind: 'murrain', day: doy + 5, sev: Math.round(sev * 0.5 * 1000) / 1000 });
            }
            if (n > 1) Crises._log(world, c, 'year', { region: `the lands about ${c.data.center}` }, { at: c.place });
        },
        week(world, c, day) {
            if (c.phase !== 'hungry') return;
            HANDLERS.famine._plant(world, c, day);
            if (day >= c.phaseEnd) {
                Crises._log(world, c, 'end', { region: `the lands about ${c.data.center}`, years: c.data.years }, { big: true, at: c.place });
                Crises._finish(world, c, day, 'passed');
            }
        },
    },

    rush: {
        eligible(world) { return !!HANDLERS.rush._find(world); },
        _find(world) {
            const towns = _views(world).filter(s => s.kingdom).sort((a, b) => (a.name < b.name ? -1 : 1));
            const C = Hinterland.config();
            for (const s of towns) {
                const hexes = Hinterland.prospectHexes(world, s).filter(h => _obj(h.weights) && _num(h.weights.gold_mine) > 0);
                if (hexes.length && C) return { town: s, hexes };
            }
            return null;
        },
        begin(world, c, day) {
            const R = Crises.config().rush;
            const all = _views(world).filter(s => s.kingdom);
            const cands = [];
            for (const s of all) {
                const hexes = Hinterland.prospectHexes(world, s).filter(h => _obj(h.weights) && _num(h.weights.gold_mine) > 0);
                if (hexes.length) cands.push({ s, hexes });
            }
            if (!cands.length) return false;
            cands.sort((a, b) => (a.s.name < b.s.name ? -1 : 1));
            const pick = cands[Math.floor(_roll(world, `rtown:${c.uid}`) * cands.length) % cands.length];
            const hx = pick.hexes[Math.floor(_roll(world, `rhex:${c.uid}`) * pick.hexes.length) % pick.hexes.length];
            const town = _live(world, pick.s.q, pick.s.r);
            const st = Hinterland.state(world);
            const market = Hinterland._marketFor(world, _views(world), town, hx.q, hx.r);
            const site = Hinterland._site(world, 'gold_mine', hx.q, hx.r, town, market, day);
            site.res0 = Math.round(_num(site.res0, 200) * R.reserveMult);
            site.res = site.res0;
            site.by = 'rush';
            Hinterland._toBuild(site, day, Math.max(10, Math.round(Hinterland.buildDays(world, 'gold_mine', town) * 0.3)));
            st.sites.push(site);
            Hinterland.touch(st);
            Hinterland.record(world, { key: `rush:${c.uid}`, kind: 'strike', q: town.q, r: town.r, place: town.name, site: 'Gold diggings', good: 'gold_ore', kingdomId: town.kingdom || null });
            c.name = _fill(_pick(world, `rname:${c.uid}`, R.names), { town: town.name });
            c.data = { townQ: town.q, townR: town.r, town: town.name, siteId: site.id, pop0: _num(town.population), moved: {}, gained: 0 };
            c.place = { q: town.q, r: town.r };
            Crises._phase(c, 'rush', day, day + Math.round(R.maxYears * YEAR));
            Crises._log(world, c, 'start', { town: town.name }, { big: true, at: town, kingdomId: town.kingdom });
            return true;
        },
        week(world, c, day) {
            const R = Crises.config().rush;
            const boom = _live(world, c.data.townQ, c.data.townR);
            if (!boom) { Crises._finish(world, c, day, 'lost'); return; }
            const site = Hinterland.site(world, c.data.siteId);
            if (c.phase === 'rush') {
                // People leave the towns about for the diggings (moved, not made)
                for (const s of _views(world)) {
                    if (s.q === boom.q && s.r === boom.r || _dist(world, s, boom) > R.radius) continue;
                    const live = _live(world, s.q, s.r);
                    if (!live) continue;
                    const k = _key(s.q, s.r);
                    const moved = _num(c.data.moved[k]);
                    if (moved >= _num(live.population) * R.migrateCap || _num(live.population) < 80) continue;
                    const n = Math.floor(_num(live.population) * R.migrateWeekly);
                    if (n <= 0) continue;
                    live.population -= n;
                    boom.population = _num(boom.population) + n;
                    c.data.moved[k] = moved + n;
                    c.data.gained += n;
                }
                if (!c.data.boomLogged && c.data.gained >= c.data.pop0 * 0.25) {
                    c.data.boomLogged = true;
                    Crises._log(world, c, 'rush', { town: boom.name, pop: Math.round(boom.population).toLocaleString('en-US') }, { at: boom, kingdomId: boom.kingdom });
                }
                if (!site || Hinterland.reserveFrac(site) < R.bustBelow || site.st === 'exhausted' || day >= c.phaseEnd) {
                    Crises._phase(c, 'bust', day, day + _irange(world, `bust:${c.uid}`, R.bustDays));
                    Crises._log(world, c, 'bust', { town: boom.name }, { big: true, at: boom });
                }
            } else if (c.phase === 'bust') {
                // Most go home again, a share each week
                const span = Math.max(7, _num(c.phaseEnd) - _num(c.phaseDay));
                for (const [k, n0] of Object.entries(c.data.moved)) {
                    const [q, r] = k.split(',').map(Number);
                    const live = _live(world, q, r);
                    if (!live || n0 <= 0) continue;
                    const n = Math.min(Math.ceil(n0 * R.returnShare * 7 / span), n0, Math.max(0, _num(boom.population) - 40));
                    live.population = _num(live.population) + n;
                    boom.population -= n;
                    c.data.moved[k] = n0 - n;
                    c.data.returned = _num(c.data.returned) + n;
                }
                if (day >= c.phaseEnd) {
                    const kept = Math.max(0, c.data.gained - _num(c.data.returned));
                    Crises._log(world, c, 'end', { name: c.name, town: boom.name, kept: kept.toLocaleString('en-US') }, { at: boom });
                    Crises._finish(world, c, day, 'bust');
                }
            }
        },
    },
};
