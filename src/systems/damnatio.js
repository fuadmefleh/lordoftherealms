// ============================================
// DAMNATIO — wiping a House's name from the world
// ============================================
// Damnatio memoriae (data/damnatio.json). A House the player has destroyed:
//
//   WHICH      the dynasty of a fallen realm whose old capital your realm now
//              holds (key 'realm:<id>'), or the old royal line of the realm you
//              rule, if your House took it rather than founded it ('line:<id>').
//   FOUR ACTS  each paid out of the crown's treasury into the capital's market
//              (CrownBooks.spendAtCapital: masons, clerks, hangmen):
//                tombs       its tombs defaced and emptied (systems/cadaverSynod.js
//                            tombs of its dead can no longer be tried); the faith
//                            is outraged
//                chronicles  its books burnt: from then on its name is struck from
//                            the Annals (Annals._events asks hides()), the Timeline
//                            (ui/actionMenu/timeline.js) and its kings' law codes
//                            (kingdom.laws.code renamed; the old name kept here)
//                towns       its old seat and every town of your realm bearing its
//                            name renamed (NamedLegacy._renameTown; towns of another
//                            culture resent it, NamedLegacy._react)
//                sons        its last sons killed or gelded (the old line's
//                            pretender ends: CrownSuccession.oldLine asks lineEnded)
//   ERASED     all four done: Prestige, the butcher's name (Atrocities), every
//              realm's regard. Unless a survivor REMEMBERS: a gelded son, a
//              daughter, or by chance a monk with a hidden copy, a child smuggled
//              out. The rememberer restores the name some years on (the Annals and
//              the claim return, and he swears himself your nemesis) unless you
//              silence him first; if he dies first, the name dies with him.
//   AI CROWNS  a cruel, wrathful or paranoid ruler who holds a fallen realm's old
//              capital may wipe its dynasty out in one stroke; its survivors may
//              restore it the same way.
//
// State: world.damnatio ({ houses: { key: rec }, seen }; SaveLoad.serializeWorld).
// Player acts draw on Utils' stream; the daily tick on its own seeded stream.
// No domain globals, no import-time side effects.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Names } from '../core/names.js';
import { Economy } from '../world/economy.js';
import { MoneySupply } from '../world/moneySupply.js';
import { CrownBooks } from '../world/crownBooks.js';
import { Characters } from '../world/characters.js';
import { Laws } from './laws.js';
import { House } from './house.js';
import { Nemesis } from './nemesis.js';
import { Devotion } from './devotion.js';
import { Atrocities } from './atrocities.js';
import { NamedLegacy } from './namedLegacy.js';
import { CadaverSynod } from './cadaverSynod.js';
import { CrownSuccession } from './crownSuccession.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _arr = v => (Array.isArray(v) ? v : []);
const _day = world => _num(world && world.day);
const _clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const _fill = (s, vars) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m));
const _Y = 360;
const ACTS = ['tombs', 'chronicles', 'towns', 'sons'];

const DEFAULTS = {
    acts: {
        tombs: { label: 'Deface their tombs', icon: '⚰️', gold: 250, karma: -8, faith: -6, stability: 1 },
        chronicles: { label: 'Burn their chronicles', icon: '🔥', gold: 150, karma: -4, faith: -2, stability: 0 },
        towns: { label: 'Rename their towns', icon: '🏷️', gold: 120, goldPerTown: 120, karma: -2, faith: 0, stability: 2 },
        sons: { label: 'Kill or geld their last sons', icon: '🗡️', gold: 100, karma: -10, karmaPer: -4, faith: -4, stability: 0 },
    },
    erased: { prestige: 30, butcher: 25, reputationAll: 6 },
    hiddenChance: 0.35,
    restoreYears: [6, 25],
    silence: { gold: 200, chance: 0.6, karma: -6, failYears: -3, nemesisScore: 60 },
    restore: { nemesisScore: 75 },
    ai: { chance: 0.35, traits: ['cruel', 'wrathful', 'paranoid'], rememberChance: 0.5 },
    townForms: ['{root}ton', '{root}stead'],
    neutralRoots: ['King', 'Crown'],
    hiddenKinds: { monk: { label: 'a monk who hid a copy of the chronicle', gender: 'male' }, child: { label: 'a child of the House smuggled out', gender: 'male' } },
    lines: {},
};

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}

function _rng(world, key) {
    const seed = (world && world.generationParams && world.generationParams.seed) || 1;
    let a = _hash(`${seed}|damnatio|${_day(world)}|${key}`) || 1;
    return () => {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function _kingdom(world, id) {
    if (!world || id == null) return null;
    if (typeof world.getKingdom === 'function') return world.getKingdom(id) || null;
    return _arr(world.kingdoms).find(k => k && k.id === id) || null;
}

function _settlementAt(world, q, r) {
    const t = world && typeof world.getTile === 'function' && Number.isFinite(q) ? world.getTile(q, r) : null;
    return (t && t.settlement) || null;
}

function _views(world) {
    if (world && typeof world.getSettlementViews === 'function') return _arr(world.getSettlementViews()).filter(Boolean);
    return [];
}

function _list(names) {
    if (names.length <= 1) return names.join('');
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const _esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const _traitIds = p => _arr(p && p.traits).map(t => (t && (t.id || t)) || '').filter(Boolean);
const _dynOf = k => (k && k.characterData && k.characterData.dynasty && k.characterData.dynasty.name) || null;
const _full = c => { try { return Characters.getFullName(c); } catch (e) { return `${c.firstName || ''} ${c.dynasty || ''}`.trim(); } };

export const Damnatio = {
    ACTS,

    config() {
        const d = _obj(DataLoader._gamedata && DataLoader._gamedata.damnatio) || {};
        const out = { ...DEFAULTS };
        for (const [k, v] of Object.entries(d)) {
            if (k.startsWith('_')) continue;
            out[k] = _obj(v) && _obj(DEFAULTS[k]) ? { ...DEFAULTS[k], ...v } : v;
        }
        out.acts = { ...DEFAULTS.acts };
        for (const id of ACTS) out.acts[id] = { ...DEFAULTS.acts[id], ...(_obj(_obj(d.acts) && d.acts[id]) || {}) };
        return out;
    },

    line(key, vars, fallback = '') {
        return _fill((Damnatio.config().lines || {})[key] || fallback, vars);
    },

    state(world) {
        if (!world) return { houses: {}, seen: {} };
        if (!_obj(world.damnatio)) world.damnatio = { houses: {}, seen: {} };
        const st = world.damnatio;
        if (!_obj(st.houses)) st.houses = {};
        if (!_obj(st.seen)) st.seen = {};
        return st;
    },

    serialize(world) {
        return world && _obj(world.damnatio) ? JSON.parse(JSON.stringify(world.damnatio)) : null;
    },

    restoreState(saved, world) {
        if (!world) return;
        world.damnatio = _obj(saved) ? JSON.parse(JSON.stringify(saved)) : null;
        Damnatio.state(world);
        _memo.delete(world);
    },

    // ──────────── READERS ────────────

    /** The names struck from the record (a House whose chronicles burnt, not restored): [{ name, dynasty, re }]. */
    struck(world) {
        const st = Damnatio.state(world);
        let m = _memo.get(world);
        const sig = Object.values(st.houses).map(r => `${r.key}:${r.steps && r.steps.chronicles ? 1 : 0}:${r.restored ? 1 : 0}`).join('|');
        if (m && m.sig === sig) return m.list;
        const list = Object.values(st.houses).filter(r => r && r.steps && r.steps.chronicles && !r.restored && r.dynasty)
            .map(r => ({ name: r.name, dynasty: r.dynasty, re: new RegExp(`\\b${_esc(r.dynasty)}\\b`) }));
        _memo.set(world, { sig, list });
        return list;
    },

    /** Should this line of the record be left out (it names a House struck from the world)? */
    hides(world, text) {
        if (!world || !text) return false;
        const list = Damnatio.struck(world);
        if (!list.length) return false;
        const t = String(text);
        return list.some(x => x.re.test(t));
    },

    /** The old royal line of this realm has no sons left to claim it (CrownSuccession.oldLine). */
    lineEnded(world, kingdomId) {
        const r = Damnatio.state(world).houses[`line:${kingdomId}`];
        return !!(r && r.steps && r.steps.sons && !r.restored);
    },

    isErased(world, key) {
        const r = Damnatio.state(world).houses[key];
        return !!(r && r.erased && !r.restored);
    },

    // ──────────── THE HOUSES ────────────

    /** The Houses the player has destroyed and may wipe out: [{ key, kind, kingdomId, dynasty, name, realm, seat }]. */
    candidates(player, world) {
        const k = Laws.ruled(player, world);
        if (!player || !k) return [];
        const out = [];
        const mine = player.house && player.house.name ? player.house.name.replace(/^House\s+/i, '').trim().toLowerCase() : String(player.lastName || '').toLowerCase();
        for (const F of _arr(world.kingdoms)) {
            if (!F || F.isAlive !== false) continue;
            const dyn = _dynOf(F);
            const cap = F.capital;
            if (!dyn || !cap || dyn.toLowerCase() === mine) continue;
            const s = _settlementAt(world, cap.q, cap.r);
            if (!s || s.kingdom !== k.id) continue;
            out.push({ key: `realm:${F.id}`, kind: 'realm', kingdomId: F.id, dynasty: dyn, name: `House ${dyn}`, realm: F.name, seat: { q: cap.q, r: cap.r, name: s.name } });
        }
        const r = player.throne && player.throne.ruling;
        const dyn = _dynOf(k);
        if (r && r.kingdomId === k.id && !r.founded && dyn && dyn.toLowerCase() !== mine) {
            const cap = k.capital;
            const s = cap ? _settlementAt(world, cap.q, cap.r) : null;
            out.push({ key: `line:${k.id}`, kind: 'line', kingdomId: k.id, dynasty: dyn, name: `House ${dyn}`, realm: k.name, seat: cap ? { q: cap.q, r: cap.r, name: (s && s.name) || null } : null });
        }
        return out;
    },

    record(world, key) {
        return Damnatio.state(world).houses[key] || null;
    },

    _ensure(world, cand, by) {
        const st = Damnatio.state(world);
        if (!st.houses[cand.key]) {
            st.houses[cand.key] = {
                key: cand.key, kind: cand.kind, kingdomId: cand.kingdomId, dynasty: cand.dynasty, name: cand.name, realm: cand.realm || null,
                seat: cand.seat || null, steps: {}, erased: null, rememberer: null, restored: null, renamed: [], codes: [], sons: [],
                by: by.name, byKingdom: by.kingdomId, byPlayer: !!by.player, started: _day(world),
            };
        }
        return st.houses[cand.key];
    },

    /** The House's last sons within reach: [{ who, name, ref }] (ref 'child:<id>' or 'pretender'). */
    sons(player, world, cand) {
        const out = [];
        const k = _kingdom(world, cand.kingdomId);
        const data = k && k.characterData;
        for (const c of _arr(data && data.children)) {
            if (!c || !c.isAlive || c.gender !== 'male' || (c.dynasty && c.dynasty !== cand.dynasty)) continue;
            if (data.ruler && c.id === data.ruler.id) continue;
            out.push({ who: c, name: _full(c), ref: `child:${c.id}` });
        }
        if (cand.kind === 'line' && player) {
            const prep = CrownSuccession.prep(player, cand.kingdomId);
            const p = prep && prep.pretender;
            if (p && !p.charId && !p.dead && !p.gelded) out.push({ who: p, name: p.name, ref: 'pretender' });
        }
        return out;
    },

    _daughters(world, cand) {
        const k = _kingdom(world, cand.kingdomId);
        const data = k && k.characterData;
        return _arr(data && data.children).filter(c => c && c.isAlive && c.gender === 'female' && (!c.dynasty || c.dynasty === cand.dynasty));
    },

    _towns(player, world, cand) {
        const out = [];
        const seen = new Set();
        const re = new RegExp(`\\b${_esc(cand.dynasty)}`, 'i');
        const add = (s) => { if (s && !seen.has(`${s.q},${s.r}`) && NamedLegacy._held(player, world, s)) { seen.add(`${s.q},${s.r}`); out.push(s); } };
        if (cand.kind === 'realm' && cand.seat) add(_settlementAt(world, cand.seat.q, cand.seat.r));
        for (const s of _views(world)) if (s && s.name && re.test(s.name)) add(s);
        return out;
    },

    /** The cost of an act now, and whether it can be done. → { ok, reason, gold } */
    canAct(player, world, key, act) {
        const cand = Damnatio.candidates(player, world).find(c => c.key === key);
        const rec = Damnatio.record(world, key);
        const A = Damnatio.config().acts[act];
        if (!A) return { ok: false, reason: 'No such act.' };
        if (!cand) return { ok: false, reason: 'That House is beyond your reach.' };
        if (rec && rec.steps[act]) return { ok: false, reason: 'It is done.' };
        if (rec && rec.restored) return { ok: false, reason: `${rec.name} was restored: its name is cried again.` };
        const k = Laws.ruled(player, world);
        let gold = Math.round(_num(A.gold));
        if (act === 'towns') gold += Math.round(_num(A.goldPerTown) * Damnatio._towns(player, world, cand).length);
        if (_num(k.treasury) < gold) return { ok: false, reason: `It costs the crown ${Utils.formatGold(gold)}g; the treasury holds ${Utils.formatGold(_num(k.treasury))}g.`, gold };
        return { ok: true, gold, cand, kingdom: k };
    },

    /** The shared price of an act: the treasury, karma, the faith, the realm. */
    _pay(player, world, k, A, gold) {
        k.treasury = _num(k.treasury) - gold;
        CrownBooks.spendAtCapital(world, k, gold);
        player.karma = _num(player.karma) + _num(A.karma);
        const creed = Devotion.creed(player);
        if (creed && creed.id && _num(A.faith)) Devotion._addStanding(player, creed.id, _num(A.faith));
        k.stability = _clamp(_num(k.stability, 50) + _num(A.stability), 0, 100);
    },

    /**
     * Do one of the four acts. act 'tombs' | 'chronicles' | 'towns' | 'sons';
     * opts.how 'kill' | 'geld' for the sons. → { success, text, erased } | { success: false, reason }
     */
    act(player, world, key, act, opts = {}, rnd = Utils.random) {
        const can = Damnatio.canAct(player, world, key, act);
        if (!can.ok) return { success: false, reason: can.reason };
        const C = Damnatio.config();
        const A = C.acts[act];
        const k = can.kingdom;
        const cand = can.cand;
        const rec = Damnatio._ensure(world, cand, { name: player.name || 'you', kingdomId: k.id, player: true });
        const day = _day(world);
        const vars = { ruler: player.name || 'The crown', house: rec.name };
        let text = '';
        Damnatio._pay(player, world, k, A, can.gold);
        if (act === 'tombs') {
            for (const t of CadaverSynod.state(world).tombs) if (t && t.dynasty === rec.dynasty && !t.defaced) t.defaced = day;
            text = Damnatio.line('tombs', vars, `The tombs of ${rec.name} are broken.`);
        } else if (act === 'chronicles') {
            Damnatio._strikeCodes(world, rec);
            text = Damnatio.line('chronicles', vars, `The chronicles of ${rec.name} are burnt.`);
        } else if (act === 'towns') {
            const towns = Damnatio._towns(player, world, cand);
            const done = [];
            for (const s of towns) {
                const nm = Damnatio._newName(player, world, s, done.map(d => d.to));
                const from = s.name;
                NamedLegacy._renameTown(world, player, s, nm);
                done.push({ q: s.q, r: s.r, from, to: nm });
            }
            if (towns.length) try { NamedLegacy._react(world, player, towns, 0.5); } catch (e) { /* no reaction */ }
            rec.renamed.push(...done);
            text = done.length ? Damnatio.line('towns', { ...vars, list: done.map(d => `${d.from} is ${d.to}`).join('; ') }, 'The towns are renamed.') : Damnatio.line('townsNone', vars, 'No town bears their name.');
        } else if (act === 'sons') {
            const how = opts.how === 'geld' ? 'geld' : 'kill';
            const list = Damnatio.sons(player, world, cand);
            for (const s of list) {
                if (s.ref === 'pretender') {
                    if (how === 'kill') s.who.dead = day; else s.who.gelded = day;
                } else if (how === 'kill') {
                    s.who.isAlive = false;
                    s.who.deathDay = day;
                    s.who.deathCause = 'put to death, and his name with him';
                } else {
                    if (!_obj(s.who.maimed)) s.who.maimed = { parts: {}, aids: {} };
                    if (!_obj(s.who.maimed.parts)) s.who.maimed.parts = {};
                    s.who.maimed.parts.geld = 1;
                }
                rec.sons.push({ name: s.name, how, ref: s.ref, charId: s.ref.startsWith('child:') ? s.who.id : null });
            }
            player.karma = _num(player.karma) + _num(A.karmaPer) * list.length;
            if (how === 'kill' && list.length) {
                const at = Atrocities.state(player);
                if (at) at.butcher = Math.min(300, _num(at.butcher) + 5 * list.length);
            }
            text = list.length
                ? Damnatio.line(how === 'kill' ? 'sonsKill' : 'sonsGeld', { ...vars, list: _list(list.map(s => s.name)) }, 'The last sons are gone.')
                : Damnatio.line('sonsNone', vars, 'No son is left.');
        }
        rec.steps[act] = { day, how: opts.how || null };
        if (player.house) House._chronicle(player.house, world, text, ['conquest', 'betrayal']);
        const erased = Damnatio._checkErased(player, world, rec, rnd);
        if (erased) text += ` ${erased}`;
        return { success: true, text, erased: !!rec.erased };
    },

    /** A new name for a renamed town: from the House's own names, else a plain one. */
    _newName(player, world, s, taken = []) {
        const avoid = new Set(taken);
        try { for (const nm of NamedLegacy.nameOptions(player, world, 'town', s)) if (!avoid.has(nm)) return nm; } catch (e) { /* no options */ }
        return Damnatio._plainName(world, s, null, avoid);
    },

    _plainName(world, s, root = null, avoid = new Set()) {
        const C = Damnatio.config();
        const forms = _arr(C.townForms).filter(f => typeof f === 'string' && f.includes('{root}'));
        const roots = root ? [root] : _arr(C.neutralRoots);
        const names = new Set(_views(world).map(v => v.name));
        const h = _hash(`${s.q},${s.r}|${s.name}`);
        for (let i = 0; i < forms.length * roots.length; i++) {
            const nm = _fill(forms[(h + i) % forms.length], { root: roots[(Math.floor(h / 7) + i) % roots.length] });
            if (!names.has(nm) && !avoid.has(nm)) return nm;
        }
        return `${roots[0] || 'King'}s ${s.q}`;
    },

    /** Their kings' codes lose their names (the old names kept, should the House be restored). */
    _strikeCodes(world, rec) {
        for (const k of [_kingdom(world, rec.kingdomId)]) {
            const c = k && _obj(k.laws) && _obj(k.laws.code);
            if (!c || c.houseId || c.struckName) continue;
            rec.codes.push({ kingdomId: k.id, name: c.name });
            c.struckName = c.name;
            c.name = 'the old code';
        }
    },

    _unstrikeCodes(world, rec) {
        for (const x of _arr(rec.codes)) {
            const k = _kingdom(world, x.kingdomId);
            const c = k && _obj(k.laws) && _obj(k.laws.code);
            if (c && c.struckName) { c.name = c.struckName; delete c.struckName; }
        }
    },

    /** All four done: the House is erased — unless someone remembers. → the line told, or '' */
    _checkErased(player, world, rec, rnd) {
        if (rec.erased || !ACTS.every(a => rec.steps[a])) return '';
        const C = Damnatio.config();
        const E = C.erased;
        const day = _day(world);
        rec.erased = { day };
        if (player) {
            if (player.house) House.award(player.house, _num(E.prestige), `${rec.name} wiped from the world`, day);
            const at = Atrocities.state(player);
            if (at) at.butcher = Math.min(300, _num(at.butcher) + _num(E.butcher));
            if (!_obj(player.reputation)) player.reputation = {};
            for (const r of _arr(world.kingdoms)) if (r && r.isAlive && r.id !== rec.byKingdom) player.reputation[r.id] = _num(player.reputation[r.id]) - _num(E.reputationAll);
        }
        rec.rememberer = Damnatio._rememberer(world, rec, rnd, _num(C.hiddenChance, 0.35));
        let text = Damnatio.line('erased', { house: rec.name }, `${rec.name} is no more.`);
        if (rec.rememberer) text += ` ${Damnatio.line('remembers', { who: rec.rememberer.label || rec.rememberer.name }, 'But someone remembers.')}`;
        if (player && player.house) House._chronicle(player.house, world, text, ['conquest', 'betrayal']);
        return text;
    },

    /** Who survives to remember: a gelded son, a daughter, or by chance one hidden. */
    _rememberer(world, rec, rnd, hiddenChance) {
        const C = Damnatio.config();
        const [lo, hi] = _arr(C.restoreYears).length === 2 ? C.restoreYears : [6, 25];
        const day = _day(world);
        const restoreDay = day + Math.round((_num(lo) + rnd() * (_num(hi) - _num(lo))) * _Y);
        const k = _kingdom(world, rec.kingdomId);
        const kids = _arr(k && k.characterData && k.characterData.children);
        const gelded = rec.sons.filter(s => s.how === 'geld' && s.charId).map(s => kids.find(c => c && c.id === s.charId)).filter(c => c && c.isAlive);
        if (gelded.length) return { name: _full(gelded[0]), label: `${_full(gelded[0])}, gelded but alive`, kind: 'son', charId: gelded[0].id, restoreDay };
        const daughters = Damnatio._daughters(world, rec);
        if (daughters.length) return { name: _full(daughters[0]), label: `${_full(daughters[0])}, a daughter of the House`, kind: 'daughter', charId: daughters[0].id, restoreDay };
        if (rnd() >= hiddenChance) return null;
        const kind = rnd() < 0.5 ? 'monk' : 'child';
        const def = (C.hiddenKinds || {})[kind] || {};
        let name = kind === 'monk' ? 'Brother Anselm' : `young ${rec.dynasty}`;
        try {
            Utils.withRng(_rng(world, `hidden:${rec.key}`), () => {
                const ch = Characters.generateCharacter({ culture: (k && k.culture) || 'Imperial', age: kind === 'monk' ? 50 : 8, dynasty: kind === 'child' ? rec.dynasty : undefined, gender: 'male' });
                name = kind === 'monk' ? `Brother ${ch.firstName}` : _full(ch);
            });
        } catch (e) { /* the default name */ }
        const town = (rec.seat && rec.seat.name) || 'the old seat';
        return { name, label: `${name}, ${_fill(def.label || 'one who hid', { town })}`, kind, charId: null, restoreDay };
    },

    /** Hire blades to silence the one who remembers. → { success, text } */
    silence(player, world, key, rnd = Utils.random) {
        const rec = Damnatio.record(world, key);
        if (!rec || !rec.erased || rec.restored || !rec.rememberer) return { success: false, reason: 'No one is left who remembers.' };
        if (!rec.byPlayer) return { success: false, reason: 'It was not your hand that struck their name.' };
        const S = Damnatio.config().silence;
        const gold = Math.round(_num(S.gold));
        if (_num(player.gold) < gold) return { success: false, reason: `Blades cost ${Utils.formatGold(gold)}g.` };
        player.gold = _num(player.gold) - gold;
        if (!Economy.payNearest(world, player.q, player.r, gold)) MoneySupply.leak(world, -gold, 'damnatio');
        const who = rec.rememberer;
        if (rnd() < _num(S.chance)) {
            if (who.charId) {
                const k = _kingdom(world, rec.kingdomId);
                const c = _arr(k && k.characterData && k.characterData.children).find(x => x && x.id === who.charId);
                if (c) { c.isAlive = false; c.deathDay = _day(world); c.deathCause = 'a knife in the dark'; }
            }
            rec.rememberer = null;
            player.karma = _num(player.karma) + _num(S.karma);
            const text = Damnatio.line('silenced', { house: rec.name, who: who.name }, `${who.name} is silenced.`);
            if (player.house) House._chronicle(player.house, world, text, ['betrayal']);
            return { success: true, text };
        }
        who.restoreDay = Math.max(_day(world) + 30, _num(who.restoreDay) + Math.round(_num(S.failYears, -3) * _Y));
        Nemesis.wrong(player, world, {
            kind: 'house', ref: { damnatio: rec.key }, name: who.name, line: rec.name,
            deed: { key: 'damnatio', label: `the name of ${rec.name} struck from the world`, note: rec.realm }, score: _num(S.nemesisScore, 60),
        });
        return { success: true, failed: true, text: Damnatio.line('silenceFailed', { who: who.name }, `${who.name} escapes.`) };
    },

    /** The name cried again: the record returns, the line's claim with it. */
    _restore(world, player, rec, out) {
        const day = _day(world);
        const who = rec.rememberer;
        rec.restored = { day, by: who.name };
        Damnatio._unstrikeCodes(world, rec);
        const town = (rec.seat && rec.seat.name) || 'the old seat';
        const text = Damnatio.line('restored', { who: who.name, house: rec.name, town }, `${rec.name} is restored.`);
        if (rec.byPlayer && player) {
            Nemesis.wrong(player, world, {
                kind: 'house', ref: { damnatio: rec.key }, name: who.name, line: rec.name,
                deed: { key: 'damnatio', label: `the name of ${rec.name} struck from the world`, note: rec.realm }, score: _num(Damnatio.config().restore.nemesisScore, 75),
            });
            if (player.house) House._chronicle(player.house, world, text, ['threat']);
            // (the old line's claim returns: a hidden child grown is its pretender)
            if (rec.kind === 'line' && who.kind === 'child') {
                const prep = CrownSuccession.prep(player, rec.kingdomId);
                prep.pretender = { name: who.name, firstName: String(who.name).split(' ')[0], dynasty: rec.dynasty, gender: 'male', age: 20, culture: null, charId: null };
            }
            out.notices.push({ icon: '📜', title: 'A Name Restored', text, type: 'warning' });
        }
        if (Array.isArray(world.events)) world.events.push({ category: 'political', text: `📜 ${text}`, kingdom: rec.kingdomId, impact: 'neutral' });
        _memo.delete(world);
    },

    /** Yearly: the rememberers die, or restore the name. */
    _year(world, player, out) {
        const day = _day(world);
        for (const rec of Object.values(Damnatio.state(world).houses)) {
            const who = rec && rec.erased && !rec.restored ? rec.rememberer : null;
            if (!who) continue;
            if (who.charId) {
                const k = _kingdom(world, rec.kingdomId);
                const c = _arr(k && k.characterData && k.characterData.children).find(x => x && x.id === who.charId);
                if (!c || !c.isAlive) {
                    rec.rememberer = null;
                    const text = Damnatio.line('forgotten', { who: who.name, house: rec.name }, `${rec.name} is forgotten.`);
                    if (rec.byPlayer && player) out.notices.push({ icon: '🕯️', title: 'A Name Forgotten', text, type: 'info' });
                    continue;
                }
            }
            if (day >= _num(who.restoreDay, Infinity)) Damnatio._restore(world, player, rec, out);
        }
    },

    /** Monthly: an AI conqueror of a hard temper wipes out a fallen realm's dynasty. */
    _aiMonth(world, player) {
        const C = Damnatio.config();
        const A = C.ai;
        const st = Damnatio.state(world);
        const ruled = player ? Laws.ruled(player, world) : null;
        for (const F of _arr(world.kingdoms)) {
            if (!F || F.isAlive !== false || st.seen[F.id]) continue;
            st.seen[F.id] = _day(world);
            const dyn = _dynOf(F);
            const cap = F.capital;
            if (!dyn || !cap) continue;
            const s = _settlementAt(world, cap.q, cap.r);
            const H = s && s.kingdom != null ? _kingdom(world, s.kingdom) : null;
            if (!H || !H.isAlive || (ruled && ruled.id === H.id) || st.houses[`realm:${F.id}`]) continue;
            const ruler = H.characterData && H.characterData.ruler;
            if (!ruler || !_traitIds(ruler).some(t => _arr(A.traits).includes(t))) continue;
            const rnd = _rng(world, `ai:${F.id}`);
            if (rnd() >= _num(A.chance)) continue;
            const rec = Damnatio._ensure(world, { key: `realm:${F.id}`, kind: 'realm', kingdomId: F.id, dynasty: dyn, name: `House ${dyn}`, realm: F.name, seat: { q: cap.q, r: cap.r, name: s.name } }, { name: H.ruler || 'a king', kingdomId: H.id, player: false });
            const day = _day(world);
            for (const c of _arr(F.characterData.children)) if (c && c.isAlive && c.gender === 'male') { c.isAlive = false; c.deathDay = day; c.deathCause = 'put to death, and his name with him'; rec.sons.push({ name: _full(c), how: 'kill', ref: `child:${c.id}`, charId: c.id }); }
            for (const t of CadaverSynod.state(world).tombs) if (t && t.dynasty === dyn && !t.defaced) t.defaced = day;
            Damnatio._strikeCodes(world, rec);
            const from = s.name;
            const nm = Damnatio._plainName(world, s, _dynOf(H) || null);
            NamedLegacy._renameTown(world, player, s, nm);
            rec.renamed.push({ q: s.q, r: s.r, from, to: nm });
            for (const a of ACTS) rec.steps[a] = { day, how: a === 'sons' ? 'kill' : null };
            rec.erased = { day };
            rec.rememberer = Damnatio._rememberer(world, rec, rnd, _num(A.rememberChance, 0.5));
            const text = Damnatio.line('aiErased', { ruler: H.ruler || 'The king', realm: Names.realm(H.name), house: rec.name, town: from, newName: nm }, `${H.ruler} wipes out ${rec.name}.`);
            if (Array.isArray(world.events)) world.events.push({ category: 'political', text: `🔥 ${text}`, kingdom: H.id, impact: 'negative' });
            rec.aiText = text;
        }
    },

    processDay(world, player = null) {
        const out = { notices: [] };
        if (!world) return out;
        const day = _day(world);
        if (day % 30 === 20) Damnatio._aiMonth(world, player);
        if (day % _Y === 270) Damnatio._year(world, player, out);
        return out;
    },

    // ──────────── THE PANEL ────────────

    view(player, world) {
        const C = Damnatio.config();
        const cands = Damnatio.candidates(player, world);
        const keys = new Set(cands.map(c => c.key));
        const houses = cands.map(c => {
            const rec = Damnatio.record(world, c.key);
            return {
                ...c, rec,
                acts: ACTS.map(a => ({ id: a, label: C.acts[a].label, icon: C.acts[a].icon, done: !!(rec && rec.steps[a]), can: Damnatio.canAct(player, world, c.key, a) })),
                sons: Damnatio.sons(player, world, c).map(s => s.name),
                towns: Damnatio._towns(player, world, c).map(s => s.name),
            };
        });
        const past = Object.values(Damnatio.state(world).houses).filter(r => r && !keys.has(r.key) && (r.erased || r.restored));
        return { ruler: !!Laws.ruled(player, world), houses, past, silenceGold: Math.round(_num(C.silence.gold)), silenceChance: _num(C.silence.chance) };
    },
};

// (the struck names' patterns, rebuilt when the record changes; not state)
const _memo = new WeakMap();
