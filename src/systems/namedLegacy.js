// ============================================
// NAMED LEGACY — write your name on the world
// ============================================
// Late-game spends of Prestige and gold that outlive the ruler who made them
// (data/namedLegacy.json; panel ui/actionMenu/namedLegacy.js, Dynasty → Your
// Name on the World):
//
//   THE CODE      a ruler sets jurists to compile the realm's laws into a code
//                 bearing their name ("the Code of Aldric"): Prestige, and gold
//                 from the treasury to the capital's jurists (CrownBooks), and
//                 code.days of their work. Proclaimed, it fixes every law as it
//                 stands (kingdom.laws.code, saved with the realm): Laws.canEnact
//                 charges Prestige, more gold and more stability to change one
//                 (and strikes it from the code). A code in force steadies the
//                 realm (stability now and month by month up to a cap), brings
//                 fewer cases and suits before the courts (player/trials.js reads
//                 disputeFactor / codeSettles, and names the code in verdicts),
//                 and the other realms are slower to band against a crown that
//                 rules by written law (systems/coalitions.js reads respectFactor).
//                 AI rulers of steady realms compile codes of their own, rarely —
//                 an heir who takes such a crown is bound by a stranger's book.
//   NAMES         a town, a region (the land about a town) or a sea (the water
//                 off a coastal town) named after the House or its ruler: the
//                 town's own name changes (settlement.name; settlement.foundingName
//                 keeps the old one; the townsfolk who know it by name are told);
//                 regions and seas are world.namedLegacy.places, drawn on the world
//                 map and named by the hex info. The town reacts by its culture: one
//                 of the House's own is proud (a 'name' mark — mood, a plaque — and a
//                 little Prestige each year), another resents it (a grudge on its
//                 mood, the realm's stability) and takes its old name back once it is
//                 out of the House's hands for revertYears.
//   THE MYTH      a founding myth the House adopts, drawn from its real record
//                 (the battles in its chronicle, crowns taken, temples raised, the
//                 crises lived through, the gold, the towns, the ships, a famous
//                 forebear): each reign may invoke it once — to rally the realm, to
//                 make a new reign legitimate (a steadier succession: House reads
//                 legitimacy()), or to press a claim (Throne.grantClaim). Townsfolk
//                 repeat it (systems/overheard.js reads overheardFacts).
//   FINAL CHAPTER an old ruler (minAge, or within nearDeathYears of their span)
//                 chooses what they are remembered for and the House's motto: the
//                 epitaph (systems/legacy.js epitaphLine), the Annals' Legacy
//                 (annalsLines), the chronicle book's epilogue (bookView), the Hall
//                 of Houses (systems/metaLegacy.js reads house.namedLegacy) say it; the heir takes the choice's trait
//                 (Traits.grantTraits, at onSuccession) when the reign earned it.
//
// State: world.namedLegacy (places, the AI's codes' memory; SaveLoad.serializeWorld),
// kingdom.laws.code (saved with the realm), settlement.foundingName/namedBy (with the
// tile), player.house.namedLegacy (myth, chapters, the heir's boon; with the House).
// Daily processDay(world, player) from ui/game/endDay.js — runs with player null in an
// interregnum. No Math.random and no shared RNG: rolls are hashes of the world's seed.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { Interrupts } from '../core/interrupts.js';
import { Economy } from '../world/economy.js';
import { CrownBooks } from '../world/crownBooks.js';
import { Seasons } from '../world/seasons.js';
import { Laws } from './laws.js';
import { House } from './house.js';
import { Ledger } from './ledger.js';
import { LlmProse } from './llmProse.js';
import { Traits } from './traits.js';
import { Throne } from './throne.js';
import { TownMemory } from './townMemory.js';
import { Crises } from './crises.js';
import { Relationships } from './relationships.js';
import { Taxation } from './marketDynamics.js';
import { Legacy } from './legacy.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _arr = v => (Array.isArray(v) ? v : []);
const _str = (v, d = '') => (typeof v === 'string' && v ? v : d);
const _day = world => _num(world && world.day);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _fill = (s, vars) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m));
const _cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const DEFAULTS = {
    code: {
        prestige: 80, goldBase: 1500, goldPerTown: 150, days: 240, minReignDays: 120,
        stabilityOnce: 6, stabilityPerMonth: 1, stabilityCap: 70, disputeFactor: 0.6, settleShare: 0.35,
        respect: 0.88, supersedeYears: 40,
        names: ['the Code of {name}'],
        repeal: { prestige: 25, treasury: 400, stability: 5 },
        ai: { minStability: 60, yearlyShare: 0.006, minDay: 600 },
    },
    names: {
        town: { prestige: 40, gold: 400, cooldownDays: 360 },
        region: { prestige: 60, gold: 800, radius: 4 },
        sea: { prestige: 50, gold: 600, radius: 7, search: 6 },
        maxPlaces: 6, revertYears: 10, prideYearly: 1,
        grudge: { mood: -4, years: 20, stability: 3 },
        townForms: ['{root}ton'], regionForms: ['the {root} March'], seaForms: ['the {root} Sea'],
    },
    myth: {
        prestige: 50, gold: 300, replacePrestige: 100, legitimacyDays: 240, legitimacyHoldDays: 480,
        rally: { stability: 6, loyalty: 5, renown: 6 },
        legitimacy: { stability: 8, loyalty: 10, dispute: 0.5 },
        claim: { amount: 15, cap: 45 },
        kinds: {},
    },
    finalChapter: { minAge: 60, nearDeathYears: 4, choices: {} },
    lines: {},
};

function _merge(base, over) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
        if (k.startsWith('_')) continue;
        out[k] = _obj(v) && _obj(base[k]) ? _merge(base[k], v) : v;
    }
    return out;
}

const _memo = { src: undefined, cfg: null };

function _seed(world) {
    const p = world && world.generationParams;
    return _num(p && p.seed, 1);
}

function _hash(s) {
    let h = 2166136261;
    const t = String(s);
    for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619);
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
    return h >>> 0;
}

/** A unit roll for `key` in this world (no RNG stream touched). */
function _roll(world, key) {
    return (_hash(`${_seed(world)}|namedLegacy|${key}`) % 100000) / 100000;
}

function _kingdom(world, id) {
    if (!world || id == null) return null;
    if (typeof world.getKingdom === 'function') return world.getKingdom(id) || null;
    return _arr(world.kingdoms).find(k => k && k.id === id) || null;
}

function _views(world) {
    return world && typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
}

function _dist(world, q1, r1, q2, r2) {
    const w = _num(world && world.width);
    return w > 0 ? Hex.wrappingDistance(q1, r1, q2, r2, w) : Hex.distance(q1, r1, q2, r2);
}

function _isWater(tile) {
    const id = tile && tile.terrain && tile.terrain.id;
    return ['ocean', 'deep_ocean', 'coast', 'lake', 'sea'].includes(id);
}

function _surname(house) {
    return String((house && house.name) || '').replace(/^house\s+/i, '').trim();
}

function _first(player) {
    return _str(player && player.firstName, String((player && player.name) || '').split(' ')[0]);
}

function _year(world, day) {
    const base = _num(world && world.baseYear, 1);
    return base + Math.floor((Math.max(1, Math.floor(_num(day, 1))) - 1) / Seasons.DAYS_PER_YEAR);
}

function _list(items) {
    const a = items.filter(Boolean);
    if (a.length <= 1) return a.join('');
    return `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
}

export const NamedLegacy = {
    config() {
        const raw = DataLoader._gamedata && DataLoader._gamedata.namedLegacy;
        if (_memo.cfg && _memo.src === raw) return _memo.cfg;
        _memo.src = raw;
        _memo.cfg = _merge(DEFAULTS, _obj(raw) || {});
        return _memo.cfg;
    },

    // ── State ───────────────────────────────────────

    state(world) {
        if (!world) return { v: 1, places: [], seq: 0 };
        let st = _obj(world.namedLegacy);
        if (!st) st = world.namedLegacy = { v: 1, places: [], seq: 0 };
        if (!Array.isArray(st.places)) st.places = [];
        if (!Number.isFinite(st.seq)) st.seq = 0;
        return st;
    },

    houseState(house) {
        if (!house) return null;
        let st = _obj(house.namedLegacy);
        if (!st) st = house.namedLegacy = { myth: null, chapters: [], heirBoon: null, invoked: {}, legitimacy: null };
        if (!Array.isArray(st.chapters)) st.chapters = [];
        if (!_obj(st.invoked)) st.invoked = {};
        return st;
    },

    serialize(world) {
        const st = world && _obj(world.namedLegacy);
        return st ? JSON.parse(JSON.stringify(st)) : null;
    },

    restore(saved, world) {
        if (!world) return;
        world.namedLegacy = _obj(saved) ? JSON.parse(JSON.stringify(saved)) : null;
        NamedLegacy.state(world);
    },

    // ══════════════════════════════════════════════
    // THE CODE
    // ══════════════════════════════════════════════

    /** A realm's code (compiling or in force), or null. */
    code(world, kingdomOrId) {
        const k = _obj(kingdomOrId) || _kingdom(world, kingdomOrId);
        const c = k && _obj(k.laws) && _obj(k.laws.code);
        return c || null;
    },

    /** A realm's code in force, or null. */
    inForce(world, kingdomOrId) {
        const c = NamedLegacy.code(world, kingdomOrId);
        return c && c.stage === 'proclaimed' ? c : null;
    },

    /** The name a code takes after its maker: "the Code of Aldric". */
    codeNameFor(name, salt = '') {
        const forms = _arr(NamedLegacy.config().code.names).filter(f => typeof f === 'string' && f.includes('{name}'));
        const list = forms.length ? forms : ['the Code of {name}'];
        // (the -ine form wants a name ending in a consonant: Aldric → Aldricine)
        const n = String(name || 'the Crown').trim();
        const ok = list.filter(f => !f.includes('{name}ine') || /[^aeiouy]$/i.test(n));
        return _fill(ok[_hash(`${n}|${salt}`) % ok.length], { name: n });
    },

    /** The ruler's reign so far, in days (the House's reign record, else the throne). */
    _reignDays(player, world) {
        const r = player && player.house && player.house.currentReign;
        const ruling = player && player.throne && player.throne.ruling;
        const since = r && Number.isFinite(r.startDay) ? r.startDay : ruling && Number.isFinite(ruling.since) ? ruling.since : _day(world);
        return _day(world) - since;
    },

    /** The towns of a realm (views). */
    _realmTowns(world, kid) {
        return _views(world).filter(s => s && s.kingdom === kid);
    },

    /** What compiling a code would cost the ruler now. → { ok, reason, prestige, gold, days, name, kingdom } */
    canCompile(player, world) {
        const C = NamedLegacy.config().code;
        const k = Laws.ruled(player, world);
        if (!k) return { ok: false, reason: 'Only the ruler of a realm may set jurists to write its laws into a code.' };
        const house = player.house;
        const towns = NamedLegacy._realmTowns(world, k.id).length;
        const gold = Math.round(_num(C.goldBase) + _num(C.goldPerTown) * towns);
        const prestige = Math.round(_num(C.prestige));
        const name = NamedLegacy.codeNameFor(_first(player), k.id);
        const base = { prestige, gold, days: Math.round(_num(C.days, 240)), name, kingdom: k };
        const cur = NamedLegacy.code(world, k);
        if (cur && cur.stage === 'compiling') return { ...base, ok: false, reason: `The jurists are at work on ${cur.name} already: done on day ${cur.readyDay}.` };
        if (cur && cur.stage === 'proclaimed') {
            const age = (_day(world) - _num(cur.day)) / Seasons.DAYS_PER_YEAR;
            if (age < _num(C.supersedeYears, 40)) return { ...base, ok: false, reason: `${_cap(cur.name)} stands, proclaimed in the year ${_year(world, cur.day)}. A code under ${_num(C.supersedeYears, 40)} years old is not rewritten: strike its laws one by one.` };
        }
        if (NamedLegacy._reignDays(player, world) < _num(C.minReignDays, 120)) return { ...base, ok: false, reason: 'The jurists will not write a code for a ruler new to the seat. Reign a while first.' };
        if (!house || _num(house.prestige) < prestige) return { ...base, ok: false, reason: `A code in your name needs ${prestige} Prestige (you have ${Math.floor(_num(house && house.prestige))}).` };
        if (_num(k.treasury) < gold) return { ...base, ok: false, reason: `The jurists' fees are ${Utils.formatGold(gold)}g; the treasury holds ${Utils.formatGold(_num(k.treasury))}g.` };
        return { ...base, ok: true };
    },

    /** Set the jurists to work. → { success, text|reason } */
    compile(player, world) {
        const can = NamedLegacy.canCompile(player, world);
        if (!can.ok) return { success: false, reason: can.reason };
        const k = can.kingdom;
        const day = _day(world);
        House.spend(player.house, can.prestige, `jurists set to ${can.name}`, day);
        k.treasury = _num(k.treasury) - can.gold;
        // (the fees are the capital's: the jurists, scribes and parchment-makers are paid there)
        CrownBooks.spendAtCapital(world, k, can.gold);
        if (!_obj(k.laws)) k.laws = {};
        const old = _obj(k.laws.code);
        if (old && old.stage === 'proclaimed') {
            if (!Array.isArray(k.laws.codes)) k.laws.codes = [];
            k.laws.codes.push({ name: old.name, ruler: old.ruler, day: old.day, until: day });
        }
        k.laws.code = {
            name: can.name, ruler: player.name || _first(player), rulerId: player.id || null,
            house: player.house ? player.house.name : null, houseId: player.house ? player.house.id : null,
            by: 'player', stage: 'compiling', startDay: day, readyDay: day + can.days, laws: {}, struck: {},
            supersedes: old && old.stage === 'proclaimed' ? old.name : null,
        };
        House._chronicle(player.house, world, `${player.name} set the jurists of ${k.name} to write its laws into ${can.name}.`, ['law', 'legacy']);
        return { success: true, text: `The jurists of ${k.name} begin ${can.name}: ${can.prestige} Prestige and ${Utils.formatGold(can.gold)}g from the treasury. It will be proclaimed on day ${day + can.days}.` };
    },

    /** The jurists' work is done: the code fixes the realm's laws as they stand. */
    _proclaim(world, k, c, out, player = null) {
        const C = NamedLegacy.config().code;
        const day = _day(world);
        c.stage = 'proclaimed';
        c.day = day;
        c.laws = {};
        for (const law of Laws.list()) {
            const v = Laws.value(world, k.id, law.id);
            if (v != null) c.laws[law.id] = v;
        }
        k.stability = _clamp(_num(k.stability, 50) + _num(C.stabilityOnce, 6), 0, 100);
        const named = Object.keys(c.laws).map(id => {
            const L = Laws.law(id);
            const o = L && L.options.find(x => x.id === c.laws[id]);
            return L && o ? `${L.name.toLowerCase()}: ${o.label.toLowerCase()}` : null;
        }).filter(Boolean);
        const fallback = `In the year ${_year(world, day)} ${c.ruler} of ${k.name} proclaimed ${c.name}, written by the jurists over ${Math.round((day - _num(c.startDay, day)) / Seasons.DAYS_PER_YEAR * 10) / 10} years: ${_list(named)}.`;
        c.preamble = fallback;
        try { LlmProse.write(world, { kind: 'townMark', key: `code:${k.id}:${_num(c.startDay)}`, facts: { code: c.name, ruler: c.ruler, realm: k.name, year: _year(world, day), laws: named }, fallback }); } catch (e) { /* the clerk's words stand */ }
        const mine = player && player.house && c.houseId && c.houseId === player.house.id;
        if (mine) {
            House._chronicle(player.house, world, `${_cap(c.name)} was proclaimed in ${k.name}: the realm's laws, written and kept.`, ['law', 'legacy']);
            out.notices.push({ icon: '📕', title: `${_cap(c.name)} Proclaimed`, text: `The jurists have finished. ${_cap(c.name)} is read in the squares of ${k.name}: its laws are fixed, and heirs will not easily unmake them (stability +${_num(C.stabilityOnce, 6)}).`, type: 'success' });
            Interrupts.raise(world, { reason: `${_cap(c.name)} is proclaimed`, icon: '📕', source: 'namedLegacy' });
        } else if (player && Laws.ruled(player, world) === null && player.allegiance === k.id) {
            out.notices.push({ icon: '📕', title: 'A Code Proclaimed', text: `${c.ruler} of ${k.name} has proclaimed ${c.name}.`, type: 'info' });
        }
    },

    /**
     * What it takes to change a law the realm's code has fixed (Laws.canEnact):
     * null when the law is free, else { prestige, treasury, stability, name }.
     */
    codeBinding(world, kingdom, lawId) {
        const c = NamedLegacy.inForce(world, kingdom);
        if (!c || !_obj(c.laws) || c.laws[lawId] == null || (_obj(c.struck) && c.struck[lawId] != null)) return null;
        const R = NamedLegacy.config().code.repeal || {};
        return { prestige: Math.round(_num(R.prestige, 25)), treasury: Math.round(_num(R.treasury, 400)), stability: Math.round(_num(R.stability, 5)), name: c.name };
    },

    /** The code's preamble now (the chronicler's once written), or ''. */
    codeText(world, kingdom) {
        const c = NamedLegacy.inForce(world, kingdom);
        if (!c || !c.preamble) return '';
        const k = _obj(kingdom) || _kingdom(world, kingdom);
        try { return LlmProse.text(world, `code:${k.id}:${_num(c.startDay)}`, c.preamble) || c.preamble; } catch (e) { return c.preamble; }
    },

    /** A law struck from the code (Laws.enact, after the binding was paid). */
    strike(world, kingdom, lawId) {
        const c = NamedLegacy.inForce(world, kingdom);
        if (!c) return false;
        if (!_obj(c.struck)) c.struck = {};
        c.struck[lawId] = _day(world);
        return true;
    },

    /** How often cases come before the courts of this realm (×). */
    disputeFactor(world, kingdomId) {
        return NamedLegacy.inForce(world, kingdomId) ? _clamp(_num(NamedLegacy.config().code.disputeFactor, 0.6), 0, 1) : 1;
    },

    /** Does the realm's code shut a suit before it is heard? (a hash of the key) */
    codeSettles(world, kingdomId, key) {
        if (!NamedLegacy.inForce(world, kingdomId)) return false;
        return _roll(world, `settle|${kingdomId}|${key}`) < _num(NamedLegacy.config().code.settleShare, 0.35);
    },

    /** The other realms' hostility toward a crown under a code (×; systems/coalitions.js). */
    respectFactor(world, realm) {
        return realm && NamedLegacy.inForce(world, realm) ? _clamp(_num(NamedLegacy.config().code.respect, 0.88), 0.3, 1) : 1;
    },

    /** "judged under the Code of Aldric", or '' (the courts' words: player/trials.js). */
    courtLine(world, kingdomId) {
        const c = NamedLegacy.inForce(world, kingdomId);
        if (!c) return '';
        return _fill(NamedLegacy.config().lines.codeCourt || 'judged under {code}', { code: c.name });
    },

    /** The line a lawsuit's clerk writes when the code shuts the matter. */
    settledLine(world, kingdomId, court, house) {
        const c = NamedLegacy.inForce(world, kingdomId);
        return _fill(NamedLegacy.config().lines.codeSettled || 'The clerks opened {code} and shut the matter.', { code: c ? c.name : 'the code', court: court || 'the court', house: house || 'the rival House' });
    },

    /** Each realm's code: the jurists' progress, the monthly steadying, and the AI crowns compiling their own. */
    _codesDay(world, player, out) {
        const C = NamedLegacy.config().code;
        const day = _day(world);
        const ruled = player ? Laws.ruled(player, world) : null;
        for (const k of _arr(world.kingdoms)) {
            if (!k || k.isAlive === false) continue;
            const c = NamedLegacy.code(world, k);
            if (c && c.stage === 'compiling' && day >= _num(c.readyDay, Infinity)) NamedLegacy._proclaim(world, k, c, out, player);
            else if (c && c.stage === 'proclaimed') {
                if (day % 30 === 0 && _num(k.stability, 50) < _num(C.stabilityCap, 70)) {
                    k.stability = Math.min(_num(C.stabilityCap, 70), _num(k.stability, 50) + _num(C.stabilityPerMonth, 1));
                }
            } else if (!c && day % 7 === 0 && !(ruled && ruled.id === k.id)) {
                // An AI crown of a steady realm writes its laws down (rarely: a few a century)
                const A = C.ai || {};
                if (day < _num(A.minDay, 600) || _num(k.stability, 50) < _num(A.minStability, 60)) continue;
                if (_roll(world, `ai|${k.id}|${Math.floor(day / 7)}`) >= _num(A.yearlyShare, 0.006) * 7 / Seasons.DAYS_PER_YEAR) continue;
                const ruler = k.characterData && k.characterData.ruler;
                const rname = String((ruler && (ruler.firstName || ruler.name)) || k.ruler || 'the King').split(' ')[0];
                if (!_obj(k.laws)) k.laws = {};
                k.laws.code = {
                    name: NamedLegacy.codeNameFor(rname, k.id), ruler: (ruler && ruler.name) || k.ruler || rname, rulerId: null,
                    house: null, houseId: null, by: 'crown', stage: 'compiling', startDay: day, readyDay: day + Math.round(_num(C.days, 240)), laws: {}, struck: {},
                };
            }
        }
    },

    // ══════════════════════════════════════════════
    // NAMES ON THE MAP
    // ══════════════════════════════════════════════

    /** The roots a new name may be made from: the ruler's first name, the House's. */
    roots(player) {
        const out = [];
        const f = _first(player);
        const s = _surname(player && player.house);
        if (f) out.push(f);
        if (s && s !== f) out.push(s);
        return out;
    },

    /** The towns the player may rename: holdings, and the towns of the realm they rule. */
    nameableTowns(player, world) {
        if (!player || !world) return [];
        const seen = new Set();
        const out = [];
        const add = (s) => {
            if (!s || !Number.isFinite(s.q) || seen.has(`${s.q},${s.r}`)) return;
            seen.add(`${s.q},${s.r}`);
            out.push(s);
        };
        try { for (const ref of Taxation.getPlayerSettlements(player, world)) add(ref.settlement); } catch (e) { /* none */ }
        const k = Laws.ruled(player, world);
        if (k) for (const s of NamedLegacy._realmTowns(world, k.id)) add(s);
        return out;
    },

    _held(player, world, s) {
        if (!player || !s) return false;
        const k = Laws.ruled(player, world);
        if (k && s.kingdom === k.id) return true;
        try { return Taxation.getPlayerSettlements(player, world).some(ref => ref.q === s.q && ref.r === s.r); } catch (e) { return false; }
    },

    _coastal(world, s) {
        for (const n of Hex.neighbors(s.q, s.r)) {
            const t = world.getTile(Hex.wrapQ(n.q, _num(world.width, 1)), n.r);
            if (_isWater(t)) return true;
        }
        return false;
    },

    /** A few new names for a place (deterministic). kind 'town' | 'region' | 'sea'. */
    nameOptions(player, world, kind, place = null) {
        const N = NamedLegacy.config().names;
        let forms = _arr(kind === 'sea' ? N.seaForms : kind === 'region' ? N.regionForms : N.townForms).filter(f => typeof f === 'string');
        if (kind === 'town' && place && world && !NamedLegacy._coastal(world, place)) forms = forms.filter(f => !/^Port /.test(f));
        if (!forms.length) return [];
        const out = [];
        for (const root of NamedLegacy.roots(player)) {
            const h = _hash(`${kind}|${root}|${place ? `${place.q},${place.r}` : ''}`);
            for (let i = 0; i < 2; i++) {
                const n = _fill(forms[(h + i * 3) % forms.length], { root });
                if (!out.includes(n)) out.push(n);
            }
        }
        const taken = new Set([..._views(world).map(s => s.name), ...NamedLegacy.state(world).places.map(p => p.name)]);
        return out.filter(n => !taken.has(n));
    },

    /** Named places (regions and seas). */
    places(world) {
        return NamedLegacy.state(world).places.filter(p => p && (p.kind === 'region' || p.kind === 'sea'));
    },

    /** The towns renamed after a House: [{ s, rec }]. */
    renamedTowns(world) {
        return _views(world).filter(s => s && _obj(s.namedBy)).map(s => ({ s, rec: s.namedBy }));
    },

    /** The named region or sea a hex lies in (the nearest anchor of its kind within its radius), or null. */
    placeAt(world, q, r) {
        if (!world) return null;
        const t = typeof world.getTile === 'function' ? world.getTile(q, r) : null;
        if (!t) return null;
        const water = _isWater(t);
        let best = null;
        for (const p of NamedLegacy.places(world)) {
            if ((p.kind === 'sea') !== water) continue;
            const d = _dist(world, q, r, p.q, p.r);
            if (d <= _num(p.radius) && (!best || d < best.d)) best = { d, p };
        }
        return best ? best.p : null;
    },

    /** The world map's labels: [{ name, q, r, kind }]. */
    mapLabels(world) {
        return NamedLegacy.places(world).map(p => ({ name: p.name, q: p.q, r: p.r, kind: p.kind }));
    },

    /** Can the player put this name on this place? → { ok, reason, prestige, gold, anchor } */
    canName(player, world, kind, q, r, name) {
        const N = NamedLegacy.config().names;
        const P = _obj(N[kind]);
        if (!P) return { ok: false, reason: 'No such place.' };
        const house = player && player.house;
        if (!house) return { ok: false, reason: 'Only a House can put its name on the land.' };
        const tile = world && world.getTile(q, r);
        const s = tile && tile.settlement;
        if (!s || !NamedLegacy.nameableTowns(player, world).includes(s)) return { ok: false, reason: 'You may name only what you hold: a holding of yours, or a town of the realm you rule.' };
        const prestige = Math.round(_num(P.prestige));
        const gold = Math.round(_num(P.gold));
        const out = { prestige, gold, anchor: { q, r } };
        const nm = String(name || '').trim();
        if (!nm || nm.length > 40) return { ...out, ok: false, reason: 'Give it a name.' };
        if (kind === 'town') {
            const rec = _obj(s.namedBy);
            if (rec && rec.house === house.name) return { ...out, ok: false, reason: `${s.name} already bears your House's name.` };
            if (rec && _day(world) - _num(rec.day) < _num(P.cooldownDays, 360)) return { ...out, ok: false, reason: `${s.name} was renamed lately; it will not take another name so soon.` };
        } else {
            const st = NamedLegacy.state(world);
            if (NamedLegacy.places(world).filter(p => p.house === house.name).length >= _num(N.maxPlaces, 6)) return { ...out, ok: false, reason: 'Enough of the map bears your name already.' };
            let anchor = { q, r };
            if (kind === 'sea') {
                anchor = NamedLegacy._seaAnchor(world, s, _num(P.search, 6));
                if (!anchor) return { ...out, ok: false, reason: `There is no open water near ${s.name} to name.` };
            }
            const near = st.places.find(p => p.kind === kind && _dist(world, p.q, p.r, anchor.q, anchor.r) <= Math.max(_num(p.radius), _num(P.radius)));
            if (near) return { ...out, ok: false, reason: `This is ${near.name} already, named by ${near.house || 'another'}.` };
            out.anchor = anchor;
        }
        if (_num(house.prestige) < prestige) return { ...out, ok: false, reason: `It needs ${prestige} Prestige (you have ${Math.floor(_num(house.prestige))}).` };
        if (_num(player.gold) < gold) return { ...out, ok: false, reason: `The heralds, masons and new charters cost ${Utils.formatGold(gold)}g.` };
        return { ...out, ok: true };
    },

    /** The water nearest a coastal town, within `search` hexes. */
    _seaAnchor(world, s, search) {
        let best = null;
        for (const h of Hex.hexesInRange(s.q, s.r, search)) {
            const q = Hex.wrapQ(h.q, _num(world.width, 1));
            if (h.r < 0 || h.r >= _num(world.height, 0)) continue;
            const t = world.getTile(q, h.r);
            if (!_isWater(t)) continue;
            const d = _dist(world, s.q, s.r, q, h.r);
            if (d > 0 && (!best || d < best.d)) best = { q, r: h.r, d };
        }
        return best ? { q: best.q, r: best.r } : null;
    },

    /** Gold from the purse into the town (the heralds, masons and clerks are paid there). */
    _payInto(player, world, s, gold) {
        player.gold = _num(player.gold) - gold;
        Ledger.record(player, 'legacyWorks', -gold);
        if (!(s && Economy.townPurse(s) != null && Economy.payTown(s, gold))) Economy.payNearest(world, s.q, s.r, gold);
    },

    /** Put the House's name on a town, a region or a sea. → { success, text|reason } */
    name(player, world, kind, q, r, name) {
        const can = NamedLegacy.canName(player, world, kind, q, r, name);
        if (!can.ok) return { success: false, reason: can.reason };
        const N = NamedLegacy.config().names;
        const s = world.getTile(q, r).settlement;
        const house = player.house;
        const day = _day(world);
        const nm = String(name).trim();
        House.spend(house, can.prestige, `${nm} named`, day);
        NamedLegacy._payInto(player, world, s, can.gold);
        let text;
        if (kind === 'town') {
            const old = s.name;
            NamedLegacy._renameTown(world, player, s, nm);
            s.namedBy = { house: house.name, houseId: house.id || null, ruler: player.name, day, from: old };
            const react = NamedLegacy._react(world, player, [s], 1);
            s.namedBy.mood = react.proud.length ? 'proud' : 'resent';
            const L = NamedLegacy.config().lines;
            text = _fill(react.proud.length ? L.renamedProud || '{old} is {new} now.' : L.renamedResent || '{old} is {new} now, and does not like it.', { old, new: nm });
            House._chronicle(house, world, `${old} was renamed ${nm}, after ${house.name}.`, ['legacy', 'naming']);
        } else {
            const P = N[kind];
            const st = NamedLegacy.state(world);
            const place = { id: ++st.seq, kind, name: nm, q: can.anchor.q, r: can.anchor.r, radius: _num(P.radius), house: house.name, houseId: house.id || null, ruler: player.name, day, town: s.name };
            st.places.push(place);
            let towns = [];
            if (kind === 'region') towns = _views(world).filter(t => t && _dist(world, t.q, t.r, place.q, place.r) <= place.radius);
            const react = towns.length ? NamedLegacy._react(world, player, towns, 0.5) : { proud: [], resent: [] };
            place.proud = react.proud.length;
            place.resent = react.resent.length;
            text = kind === 'sea'
                ? `The waters off ${s.name} are ${nm} on every chart drawn from now on.`
                : `The country about ${s.name} is ${nm} now.${react.proud.length ? ` ${_list(react.proud.map(t => t.name))} take${react.proud.length === 1 ? 's' : ''} pride in it.` : ''}${react.resent.length ? ` ${_list(react.resent.map(t => t.name))} resent${react.resent.length === 1 ? 's' : ''} it.` : ''}`;
            House._chronicle(house, world, `${kind === 'sea' ? 'The sea' : 'The land'} by ${s.name} was named ${nm}, after ${house.name}.`, ['legacy', 'naming']);
        }
        return { success: true, text: `${text} (${can.prestige} Prestige, ${Utils.formatGold(can.gold)}g.)` };
    },

    /** The town's name changed, and those who know it by name told (its people, the player's homes there). */
    _renameTown(world, player, s, nm) {
        const old = s.name;
        if (!s.foundingName) s.foundingName = old;
        s.name = nm;
        // (the relationship NPCs of the town are kept by its name: systems/relationships/npcs.js)
        for (const n of _arr(Relationships._npcs)) if (n && n.settlementName === old) n.settlementName = nm;
        for (const h of _arr(player && player.houses)) if (h && h.settlementName === old) h.settlementName = nm;
    },

    /** The towns' reactions by culture. → { proud: [s], resent: [s] } */
    _react(world, player, towns, scale = 1) {
        const N = NamedLegacy.config().names;
        const G = N.grudge || {};
        const house = player.house;
        const mine = player.culture || null;
        const out = { proud: [], resent: [] };
        const realms = new Map();
        for (const s of towns) {
            const theirs = s.culture || null;
            const proud = !mine || !theirs || theirs === mine;
            if (proud) {
                out.proud.push(s);
                if (scale >= 1) try { TownMemory.mark(s, 'name', { house: house.name, what: 'town', name: s.name, state: 'kept' }, world); } catch (e) { /* no memory */ }
            } else {
                out.resent.push(s);
                try { TownMemory.mark(s, 'grudge', { mood: _num(G.mood, -4) * scale, years: _num(G.years, 20), why: 'renamed', house: house.name }, world); } catch (e) { /* no memory */ }
                if (s.kingdom != null) realms.set(s.kingdom, (realms.get(s.kingdom) || 0) + 1);
            }
        }
        for (const [kid, n] of realms) {
            const k = _kingdom(world, kid);
            if (k) k.stability = _clamp(_num(k.stability, 50) - Math.min(3, n) * _num(G.stability, 3) * scale, 0, 100);
        }
        return out;
    },

    /** Yearly: proud towns' Prestige; resentful towns long out of the House's hands take their old name back. */
    _placesDay(world, player, out) {
        const N = NamedLegacy.config().names;
        const day = _day(world);
        if (day % 30 !== 0) return;
        const Y = Seasons.DAYS_PER_YEAR;
        const house = player && player.house;
        for (const { s, rec } of NamedLegacy.renamedTowns(world)) {
            const ours = !!house && rec.house === house.name;
            const held = ours && NamedLegacy._held(player, world, s);
            const mark = _arr(s.memory && s.memory.marks).find(m => m && m.k === 'name' && m.what === 'town' && m.house === rec.house);
            if (held) delete rec.absent;
            else if (rec.absent == null) rec.absent = day;
            const reverted = mark && mark.state === 'reverted';
            if (reverted || (rec.mood === 'resent' && rec.absent != null && day - rec.absent >= _num(N.revertYears, 10) * Y)) {
                const now = s.name;
                const back = rec.from || s.foundingName || now;
                NamedLegacy._renameTown(world, player, s, back);
                if (mark) { mark.state = 'reverted'; mark.changed = day; }
                delete s.namedBy;
                if (ours) {
                    out.notices.push({ icon: '🪧', title: 'A Name Taken Back', text: _fill(NamedLegacy.config().lines.renamedReverted, { new: now, old: back }), type: 'warning' });
                    House._chronicle(house, world, `${now} took back its old name, ${back}.`, ['legacy', 'naming']);
                }
                continue;
            }
            // A year on: a proud town's name is a little glory for the House
            if (ours && rec.mood === 'proud' && day > _num(rec.day) && (day - _num(rec.day)) % Y < 30) House.award(house, _num(N.prideYearly, 1), `${s.name} bears the House's name`, day);
        }
    },

    // ══════════════════════════════════════════════
    // THE FOUNDING MYTH
    // ══════════════════════════════════════════════

    /** The tales the House's real record bears out: [{ id, name, icon, tale, gist }]. */
    mythCandidates(player, world) {
        const M = NamedLegacy.config().myth;
        const K = _obj(M.kinds) || {};
        const house = player && player.house;
        if (!house) return [];
        const stats = _obj(house.stats) || {};
        const hist = _arr(house.history);
        const out = [];
        const add = (id, vars) => {
            const d = _obj(K[id]);
            if (!d) return;
            out.push({ id, icon: d.icon || '📜', name: _fill(d.name, vars), tale: _fill(d.tale, vars), gist: _fill(d.gist, vars), vars });
        };
        // The field: the first great victory in the chronicle
        const wins = hist.filter(h => h && h.battle && h.battle.outcome === 'victory');
        const fieldWins = wins.filter(h => h.battle.kind !== 'sea');
        if (fieldWins.length >= 3 || _num(stats.battleWon) >= 5) {
            const first = fieldWins[0] || wins[0];
            add('sword', { place: (first && first.battle.place) || 'the first battle', foe: (first && first.battle.foe) || 'their foes' });
        }
        // A crown taken
        const ruling = player.throne && player.throne.ruling;
        const crown = ruling ? _kingdom(world, ruling.kingdomId) : null;
        const crowned = hist.find(h => h && _arr(h.tags).some(t => t === 'throne' || t === 'crown'));
        if (crown || crowned || _num(stats.crowned) > 0) add('crown', { realm: crown ? crown.name : 'a realm' });
        // Faith
        if (_num(stats.religionFounded) > 0 || _num(stats.templeRaised) >= 2) add('faith', { temples: Math.max(1, _num(stats.templeRaised)) });
        // A crisis lived through
        try {
            const lived = Crises.history(world).filter(c => c && c.endDay != null && _num(c.endDay) >= _num(house.foundedDay));
            if (lived.length) add('storm', { crisis: lived[0].name || 'the great crisis' });
        } catch (e) { /* no crises */ }
        // Gold
        const peak = Math.max(_num(house.wealthPeak && house.wealthPeak.gold), _num(player.gold));
        if (peak >= 20000) add('gold', { gold: Utils.formatGold(Math.round(peak / 1000) * 1000) });
        // Towns
        if (_num(stats.settlementHeld) >= 3) add('founders', { towns: _num(stats.settlementHeld) });
        // Ships
        if (_arr(player.ships).length >= 3 || wins.filter(h => h.battle.kind === 'sea').length >= 2) add('sea', {});
        // A forebear of note
        const best = _arr(house.reigns).slice().sort((a, b) => _num(b.score) - _num(a.score))[0];
        if (best && best.name) add('elder', { elder: `${String(best.name).split(' ')[0]}${best.epithet ? ` ${best.epithet}` : ''}` });
        // Always: risen from the road
        add('road', {});
        return out;
    },

    /** The House's myth, or null. */
    myth(house) {
        const st = house && _obj(house.namedLegacy);
        return (st && _obj(st.myth)) || null;
    },

    canAdopt(player, world, id) {
        const M = NamedLegacy.config().myth;
        const house = player && player.house;
        if (!house) return { ok: false, reason: 'No House to tell of.' };
        const cand = NamedLegacy.mythCandidates(player, world).find(c => c.id === id);
        if (!cand) return { ok: false, reason: 'The House\'s record does not bear that tale out.' };
        const had = NamedLegacy.myth(house);
        if (had && had.id === id) return { ok: false, reason: 'That is the House\'s tale already.' };
        const prestige = Math.round(had ? _num(M.replacePrestige, 100) : _num(M.prestige, 50));
        const gold = Math.round(_num(M.gold, 300));
        if (_num(house.prestige) < prestige) return { ok: false, reason: `It needs ${prestige} Prestige${had ? ' to make folk forget the old tale' : ''} (you have ${Math.floor(_num(house.prestige))}).`, prestige, gold, cand };
        if (_num(player.gold) < gold) return { ok: false, reason: `The bards and heralds want ${Utils.formatGold(gold)}g.`, prestige, gold, cand };
        return { ok: true, prestige, gold, cand, replaces: had ? had.name : null };
    },

    /** The House takes up a founding myth. → { success, text|reason } */
    adoptMyth(player, world, id) {
        const can = NamedLegacy.canAdopt(player, world, id);
        if (!can.ok) return { success: false, reason: can.reason };
        const house = player.house;
        const day = _day(world);
        const st = NamedLegacy.houseState(house);
        House.spend(house, can.prestige, `the myth of ${can.cand.name}`, day);
        // (the bards are paid where the House sits: the capital it rules, else where the ruler stands)
        const k = Laws.ruled(player, world);
        const capTile = k && k.capital ? world.getTile(k.capital.q, k.capital.r) : null;
        const hereTile = world.getTile(player.q, player.r);
        const town = (capTile && capTile.settlement) || (hereTile && hereTile.settlement) || null;
        if (town) NamedLegacy._payInto(player, world, town, can.gold);
        else { player.gold = _num(player.gold) - can.gold; Ledger.record(player, 'legacyWorks', -can.gold); Economy.payNearest(world, player.q, player.r, can.gold); }
        const fallback = `${house.name} are ${can.cand.name}: ${can.cand.tale}.`;
        st.myth = { id, name: can.cand.name, icon: can.cand.icon, tale: can.cand.tale, gist: can.cand.gist, day, by: player.name, text: fallback };
        try { LlmProse.write(world, { kind: 'familyStory', key: `myth:${house.id || house.name}`, facts: { house: house.name, myth: can.cand.name, tale: can.cand.tale }, fallback }); } catch (e) { /* the bards' words stand */ }
        House._chronicle(house, world, `${house.name} took up its founding tale: ${can.cand.name}, ${can.cand.tale}.`, ['legacy', 'myth']);
        return { success: true, text: `The bards sing it in every hall: ${fallback}${can.replaces ? ` (The old tale, ${can.replaces}, is let fall.)` : ''}` };
    },

    /** The myth's words now (the chronicler's retelling once written). */
    mythText(world, house) {
        const m = NamedLegacy.myth(house);
        if (!m) return '';
        try { return LlmProse.text(world, `myth:${house.id || house.name}`, m.text) || m.text; } catch (e) { return m.text; }
    },

    _reignKey(house) {
        return `g${_num(house && house.generation, 1)}`;
    },

    /** Can this reign invoke the myth this way? use 'rally' | 'legitimacy' | 'claim'. */
    canInvoke(player, world, use, kid = null) {
        const M = NamedLegacy.config().myth;
        const house = player && player.house;
        const m = NamedLegacy.myth(house);
        if (!m) return { ok: false, reason: 'The House has no founding tale to call on.' };
        const st = NamedLegacy.houseState(house);
        const used = st.invoked[NamedLegacy._reignKey(house)];
        if (used) return { ok: false, reason: `This reign called on the tale already (day ${used.day}, ${used.use}). Each reign may, once.` };
        if (use === 'legitimacy') {
            // (any time: the next succession steadier; in a reign's first days, the seat too)
        } else if (use === 'claim') {
            const ok = NamedLegacy.claimTargets(player, world).some(k => k.id === kid);
            if (!ok) return { ok: false, reason: 'The tale may strengthen a claim the House holds, on a realm it does not rule.' };
        } else if (use !== 'rally') return { ok: false, reason: 'No such thing.' };
        return { ok: true };
    },

    /** The realms the myth may press a claim on: those the House already has a claim on. */
    claimTargets(player, world) {
        let claims = [];
        try { claims = Throne.claims(player, world); } catch (e) { claims = []; }
        return claims.map(c => c.kingdom).filter(k => k && k.isAlive !== false);
    },

    /** Call on the tale. → { success, text|reason } */
    invoke(player, world, use, kid = null) {
        const can = NamedLegacy.canInvoke(player, world, use, kid);
        if (!can.ok) return { success: false, reason: can.reason };
        const M = NamedLegacy.config().myth;
        const house = player.house;
        const day = _day(world);
        const st = NamedLegacy.houseState(house);
        const m = st.myth;
        const k = Laws.ruled(player, world);
        let text = '';
        if (use === 'rally' || use === 'legitimacy') {
            const E = use === 'rally' ? M.rally : M.legitimacy;
            const parts = [];
            // (legitimacy steadies the seat itself only in a new reign's first days, an heir's)
            const early = use === 'rally' || (_num(house.generation, 1) >= 2 && NamedLegacy._reignDays(player, world) <= _num(M.legitimacyDays, 240));
            if (early) {
                const loy = _num(E.loyalty);
                if (k) { k.stability = _clamp(_num(k.stability, 50) + _num(E.stability), 0, 100); parts.push(`stability of ${k.name} +${_num(E.stability)}`); }
                let raised = 0;
                for (const id of Object.keys(_obj(house.roleLoyalty) || {})) { house.roleLoyalty[id] = _clamp(_num(house.roleLoyalty[id]) + loy, 0, 100); raised++; }
                for (const e of _arr(house.court)) if (e && Number.isFinite(e.loyalty)) { e.loyalty = _clamp(e.loyalty + loy, 0, 100); raised++; }
                if (raised) parts.push(`your officers and court +${loy} loyalty`);
            }
            if (use === 'rally' && !k) { player.renown = _num(player.renown) + _num(E.renown); parts.push(`renown +${_num(E.renown)}`); }
            if (use === 'legitimacy') {
                st.legitimacy = { gen: _num(house.generation, 1), until: day + _num(M.legitimacyHoldDays, 480), day };
                parts.push(`the succession steadier until day ${st.legitimacy.until}`);
            }
            text = use === 'rally'
                ? `You call on the tale of ${m.name} before the court and the crowd: ${_list(parts)}.`
                : `Heralds cry it from the steps: ${player.name} is of ${m.name}, ${m.tale}. The lords bend the knee easier: ${_list(parts)}.`;
        } else {
            const target = _kingdom(world, kid);
            const before = Throne.claimStrength(player, kid);
            const now = Throne.grantClaim(player, world, kid, 'purchased', _num(M.claim.amount, 15), { mode: 'add', cap: _num(M.claim.cap, 45) });
            text = `Genealogists find ${m.name} in the old rolls of ${target ? target.name : 'the realm'}: your claim there ${now > before ? `grows to ${now}` : 'is as strong as the tale can make it'}.`;
        }
        st.invoked[NamedLegacy._reignKey(house)] = { day, use };
        House._chronicle(house, world, `${player.name} called on the tale of ${m.name} (${use}).`, ['legacy', 'myth']);
        return { success: true, text };
    },

    /** A steadier succession: the House's dispute chance × (House._disputeChance reads it). */
    legitimacy(player, world) {
        const house = player && player.house;
        const st = house && _obj(house.namedLegacy);
        const L = st && _obj(st.legitimacy);
        const on = !!L && _day(world) <= _num(L.until);
        return { active: on, factor: on ? _clamp(_num(NamedLegacy.config().myth.legitimacy.dispute, 0.5), 0, 1) : 1, until: L ? L.until : null };
    },

    /** Dispute-chance multiplier for a House (no world: whatever the record says). */
    disputeFactorFor(house, day) {
        const st = house && _obj(house.namedLegacy);
        const L = st && _obj(st.legitimacy);
        if (!L || (day != null && day > _num(L.until))) return 1;
        return _clamp(_num(NamedLegacy.config().myth.legitimacy.dispute, 0.5), 0, 1);
    },

    /**
     * What townsfolk say of the House's tale (systems/overheard.js): where the House
     * rules or holds, or where it is known, one fact. → [fact]
     */
    overheardFacts(player, world, settlement, who, pn = {}) {
        const house = player && player.house;
        const m = NamedLegacy.myth(house);
        if (!m || !settlement) return [];
        const k = Laws.ruled(player, world);
        const near = (k && settlement.kingdom === k.id) || (player.allegiance != null && settlement.kingdom === player.allegiance) || NamedLegacy._held(player, world, settlement);
        if (!near) return [];
        const facts = [{ key: `myth:${m.id}`, src: 'myth', kind: m.id, v: 1, w: 4, who, gist: _fill(m.gist, pn), from: null }];
        const rec = _obj(settlement.namedBy);
        if (rec && house && rec.house === house.name) {
            facts.push({ key: `renamed:${rec.day}`, src: 'town', kind: 'renamed', v: rec.mood === 'resent' ? -1 : 1, w: 4, who, gist: rec.mood === 'resent' ? `made us call the town ${settlement.name}, after ${pn.their || 'their'} own House` : `gave the town ${pn.their || 'their'} House's name`, from: null });
        }
        return facts;
    },

    // ══════════════════════════════════════════════
    // THE FINAL CHAPTER
    // ══════════════════════════════════════════════

    /** Is the ruler old enough, or near enough the end, to write it? → { ok, reason } */
    canWriteFinal(player, world) {
        const F = NamedLegacy.config().finalChapter;
        const house = player && player.house;
        if (!house) return { ok: false, reason: 'Only the head of a House writes its last chapter.' };
        const age = _num(player.age);
        const span = _num(player.maxLifespan, 70);
        const old = age >= _num(F.minAge, 60) || (span > 0 && age >= span - _num(F.nearDeathYears, 4));
        if (!old) return { ok: false, reason: `It is written at the end of a life: at ${_num(F.minAge, 60)}, or with death near. You are ${Math.floor(age)}.` };
        const st = NamedLegacy.houseState(house);
        const mine = st.chapters.find(c => c.gen === _num(house.generation, 1));
        if (mine) return { ok: false, reason: `You have written your last chapter: remembered for ${mine.label}.` };
        return { ok: true };
    },

    /** The choices, each with whether the reign earned it (an earned one passes its trait to the heir). */
    finalChoices(player, world) {
        const F = NamedLegacy.config().finalChapter;
        const house = player && player.house;
        let rec = null;
        try { rec = house && house.currentReign ? Legacy.summarize(player, world) : null; } catch (e) { rec = null; }
        const r = rec || {};
        const stats = _obj(house && house.stats) || {};
        const living = _arr(player && player.children).filter(c => c && c.isAlive !== false).length;
        const codeOfHouse = _arr(world && world.kingdoms).some(k => { const c = NamedLegacy.code(world, k); return c && house && c.houseId === house.id && c.ruler === player.name; });
        const fits = {
            conquest: _num(r.battles) >= 3 || _num(r.crownsWon) >= 1 || _num(r.settlements) >= 2,
            law: codeOfHouse,
            faith: _num(stats.templeRaised) >= 1 || _num(stats.religionFounded) >= 1 || !!r.religion,
            wealth: _num(player && player.gold) >= 10000 || _num(house && house.wealthPeak && house.wealthPeak.gold) >= 20000,
            building: _num(r.greatWorks) >= 1 || _num(r.holdingProjects) >= 3,
            peace: _num(r.battles) === 0 && _num(r.wars) === 0 && _num(r.years) >= 10,
            family: living >= 3,
            sea: _arr(player && player.ships).length >= 2,
        };
        return Object.entries(_obj(F.choices) || {}).map(([id, c]) => ({
            id, label: c.label || id, icon: c.icon || '📜', line: c.line || '', trait: c.trait || null,
            mottos: _arr(c.mottos).filter(x => typeof x === 'string'), fits: !!fits[id],
        }));
    },

    /** The old ruler sets down the last chapter. → { success, text|reason } */
    writeFinalChapter(player, world, choiceId, motto = '') {
        const can = NamedLegacy.canWriteFinal(player, world);
        if (!can.ok) return { success: false, reason: can.reason };
        const ch = NamedLegacy.finalChoices(player, world).find(c => c.id === choiceId);
        if (!ch) return { success: false, reason: 'No such thing to be remembered for.' };
        const house = player.house;
        const day = _day(world);
        const m = String(motto || '').replace(/[<>{}[\]`"]/g, '').trim().slice(0, 60);
        const st = NamedLegacy.houseState(house);
        if (m) house.motto = m;
        const fallback = `In the year ${_year(world, day)}, old and near the end, ${player.name} set down the last chapter of ${player.gender === 'female' ? 'her' : 'his'} life: let ${house.name} remember ${ch.line}${m ? `, under the words "${m}"` : ''}.`;
        const entry = { gen: _num(house.generation, 1), ruler: player.name, day, year: _year(world, day), choice: ch.id, label: ch.label, line: ch.line, motto: m || house.motto || '', earned: ch.fits, trait: ch.fits ? ch.trait : null, text: fallback };
        st.chapters.push(entry);
        if (st.chapters.length > 40) st.chapters.splice(0, st.chapters.length - 40);
        st.heirBoon = ch.fits && ch.trait ? { trait: ch.trait, from: player.name, choice: ch.id, gen: entry.gen } : null;
        try { LlmProse.write(world, { kind: 'epilogue', key: `finalChapter:${house.id || house.name}:${entry.gen}`, facts: { house: house.name, ruler: player.name, rememberedFor: ch.line, motto: entry.motto || null, year: entry.year }, fallback }); } catch (e) { /* the words stand */ }
        House._chronicle(house, world, `${player.name} wrote the last chapter: to be remembered for ${ch.label}${m ? `; the House's words, "${m}"` : ''}.`, ['legacy', 'finalChapter']);
        const trait = ch.fits && ch.trait && Traits.TRAITS[ch.trait] ? Traits.TRAITS[ch.trait].name || ch.trait : null;
        return { success: true, text: `It is written: ${house.name} will remember ${ch.line}.${m ? ` Its words are "${m}".` : ''}${trait ? ` Your heir will be raised to it: ${trait}.` : ' The court nods politely: the reign did not quite earn it, and the heir inherits only the words.'}` };
    },

    /** The words of a chapter now (the chronicler's once written). */
    chapterText(world, house, entry) {
        if (!entry) return '';
        try { return LlmProse.text(world, `finalChapter:${house.id || house.name}:${entry.gen}`, entry.text) || entry.text; } catch (e) { return entry.text; }
    },

    /** The latest last chapter written, or null. */
    lastChapter(house) {
        const st = house && _obj(house.namedLegacy);
        const list = st ? _arr(st.chapters) : [];
        return list[list.length - 1] || null;
    },

    /** The heir takes up the mantle (systems/relationships/family.js): the old ruler's boon, a new reign's tale. */
    onSuccession(player, world, opts = {}) {
        const out = { notices: [] };
        const house = player && player.house;
        const st = house && _obj(house.namedLegacy);
        if (!st) return out;
        const b = _obj(st.heirBoon);
        if (b && b.trait) {
            const got = Traits.grantTraits(player, [b.trait]);
            if (got.length) {
                const def = Traits.TRAITS[b.trait] || {};
                out.notices.push({ icon: def.icon || '📜', title: 'Raised to It', text: `${opts.oldName || b.from} wished to be remembered for ${b.choice}. You were raised to it: ${def.name || b.trait}.`, type: 'success' });
                House._chronicle(house, world, `${player.name} was raised to what ${opts.oldName || b.from} wished the House remembered for: ${def.name || b.trait}.`, ['legacy', 'finalChapter']);
            }
        }
        st.heirBoon = null;
        return out;
    },

    // ── What the record says ────────────────────────

    /** The epitaph's line (systems/legacy.js), or '' to keep its own. */
    epitaphLine(house) {
        const c = NamedLegacy.lastChapter(house);
        return c ? `Remembered for ${c.line}, as ${c.ruler} wished.` : '';
    },

    /** Sentences for the Annals' Legacy (systems/annals.js). */
    annalsLines(player, world) {
        const house = player && player.house;
        if (!house) return [];
        const out = [];
        const m = NamedLegacy.myth(house);
        if (m) out.push(`${house.name} tell of themselves that they are ${m.name}: ${m.tale}`);
        const codes = _arr(world && world.kingdoms).map(k => ({ k, c: NamedLegacy.code(world, k) })).filter(x => x.c && x.c.stage === 'proclaimed' && x.c.houseId && x.c.houseId === house.id);
        for (const { k, c } of codes) out.push(`${_cap(c.name)} has been the law of ${k.name} since the year ${_year(world, c.day)}${Object.keys(_obj(c.struck) || {}).length ? ', though heirs have struck from it' : ''}`);
        const named = [
            ...NamedLegacy.renamedTowns(world).filter(x => x.rec.house === house.name).map(x => x.s.name),
            ...NamedLegacy.places(world).filter(p => p.house === house.name).map(p => p.name),
        ];
        if (named.length) out.push(`The map bears the House's name: ${_list(named.slice(0, 6))}`);
        for (const c of _arr(_obj(house.namedLegacy) && house.namedLegacy.chapters).slice(-3)) out.push(`${c.ruler} asked to be remembered for ${c.line}${c.motto ? `, and gave the House its words, "${c.motto}"` : ''}`);
        return out;
    },

    /** The chronicle book's epilogue additions (systems/chronicleBook.js). */
    bookView(player, world) {
        const house = player && player.house;
        if (!house) return { epilogue: '', chapters: [] };
        const st = _obj(house.namedLegacy) || {};
        const chapters = _arr(st.chapters).map(c => ({ ruler: c.ruler, year: c.year, label: c.label, motto: c.motto, text: NamedLegacy.chapterText(world, house, c) }));
        const parts = chapters.slice(-3).map(c => c.text);
        const m = NamedLegacy.myth(house);
        if (m) parts.push(NamedLegacy.mythText(world, house));
        return { epilogue: parts.filter(Boolean).join('\n\n'), chapters, myth: m ? m.name : null };
    },

    /** The panel's view. */
    view(player, world) {
        const house = player && player.house;
        const k = Laws.ruled(player, world);
        const code = k ? NamedLegacy.code(world, k) : null;
        return {
            house, kingdom: k, code, compile: NamedLegacy.canCompile(player, world),
            towns: NamedLegacy.nameableTowns(player, world),
            places: NamedLegacy.places(world).filter(p => house && p.house === house.name),
            renamed: NamedLegacy.renamedTowns(world).filter(x => house && x.rec.house === house.name),
            myth: house ? NamedLegacy.myth(house) : null, candidates: NamedLegacy.mythCandidates(player, world),
            invoked: house ? NamedLegacy.houseState(house).invoked[NamedLegacy._reignKey(house)] || null : null,
            claimTargets: NamedLegacy.claimTargets(player, world),
            final: NamedLegacy.canWriteFinal(player, world), choices: NamedLegacy.finalChoices(player, world),
            chapters: house ? NamedLegacy.houseState(house).chapters.slice() : [],
            legitimacy: NamedLegacy.legitimacy(player, world),
            cfg: NamedLegacy.config(),
        };
    },

    // ── The day ─────────────────────────────────────

    /** The daily tick (ui/game/endDay.js; player may be null). → { notices } */
    processDay(world, player = null) {
        const out = { notices: [] };
        if (!world) return out;
        try {
            NamedLegacy._codesDay(world, player, out);
            NamedLegacy._placesDay(world, player, out);
        } catch (e) {
            /* the names stand as they were */
        }
        return out;
    },
};
