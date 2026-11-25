// ============================================
// FRATRICIDE — the law of the bowstring, and the cage
// ============================================
// A succession law (laws.succession in data/laws.json: 'mercy', 'cage',
// 'fratricide'). What it does (data/fratricide.json):
//
//   YOUR HEIR   On the player's succession (Relationships.succeedAsHeir calls
//               onSuccession after the household changes hands and before the
//               crown's claimants are weighed) the new ruler's brothers — the
//               late ruler's other sons, not his own uncles — are CONDEMNED
//               (child.fratricide.condemned) under fratricide, or CAGED for
//               life under the cage. Either way no brother can rise for the
//               crown (CrownSuccession.claimants skips them). The condemned
//               wait graceDays: the new ruler may SPARE one (the law broken:
//               stability, Prestige, the lords' opinion; karma for mercy) or
//               give the word at once. When the days run out the rest are
//               strangled with the silken bowstring: the family tree is a stump.
//               The late ruler's widow, their mother, never forgives it (Nemesis).
//   THE SPARED  A spared brother may plot (a yearly chance, more if ambitious):
//               the spymaster may catch it (then strangle him after all, or send
//               him abroad), else he flees in the night and swears himself your
//               nemesis. At the next succession he stands as an uncle with a
//               claim the stronger for it (CrownSuccession reads spared).
//   MOTHERS     While the player rules under fratricide, the mother of a son who
//               is not the heir schemes for hers to be the one who lives (a
//               monthly chance; children record their other parent, otherParentId):
//               a cup for the heir some weeks on. Revealed by a daily chance (the
//               spymaster helps): guard the boy (gold to the town's purse) or send
//               her from court. Unrevealed, the cup may kill him.
//   AI REALMS   A realm under fratricide strangles the brothers of every heir who
//               takes its throne (Characters.handleSuccession records it on
//               kingdom.lastSuccession; seen here); under the cage it shuts them
//               up. No succession crisis can come of a brother (Throne reads
//               quellsCrisis). A cruel, paranoid or wrathful ruler who came to
//               the throne through a crisis may proclaim the law; a just or devout
//               one may repeal it; the harems of fratricide realms poison a son
//               now and then.
//
// State: player.fratricide (saved: SaveLoad EXTRA_PLAYER_FIELDS) and the
// marks on the children (saved with them); world.fratricide (seen successions,
// the log; SaveLoad.serializeWorld). Player acts draw on Utils' stream; the
// daily tick on its own seeded stream (world seed + day + key). No domain
// globals, no import-time side effects.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Names } from '../core/names.js';
import { Economy } from '../world/economy.js';
import { MoneySupply } from '../world/moneySupply.js';
import { Laws } from './laws.js';
import { House } from './house.js';
import { Kingship } from './kingship.js';
import { Relationships } from './relationships.js';
import { Nemesis } from './nemesis.js';
import { KinCrimes } from './kinCrimes.js';
import { Inheritance } from './inheritance.js';
import { Ledger } from './ledger.js';
import { DynastyTree } from './dynastyTree.js';
import { Raising } from './raising.js';
import { Court } from './court.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _arr = v => (Array.isArray(v) ? v : []);
const _day = world => _num(world && world.day);
const _clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const _fill = (s, vars) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m));
const _Y = 360;

const DEFAULTS = {
    graceDays: 3,
    spare: { stability: 4, prestige: 10, opinion: 6, karma: 6 },
    strangle: { karma: -3, stabilityPer: 1, stabilityCap: 3, widowNemesis: 55, earlyKarma: -2 },
    cage: { karma: -1 },
    plot: { minAge: 16, yearly: 0.06, ambitious: 0.08, grudge: 0.05, revealBase: 0.45, revealSpymaster: 0.25, nemesisScore: 70, claimBonus: 12 },
    mothers: {
        monthly: 0.025, sameMother: 0.3, ambitious: 1.6, crowned: 1.3, leadMin: 40, leadMax: 120,
        revealDaily: 0.012, revealSpymaster: 0.015, success: 0.55, guardCost: 60, banishAffection: -30, banishBond: -8, exposedAffection: -20,
    },
    ai: { adoptOnCrisis: 0.4, adoptTraits: ['cruel', 'paranoid', 'wrathful'], repealTraits: ['just_ruler', 'devout'], repealChance: 0.12, haremYearly: 0.06, haremMinSons: 2 },
    logCap: 40,
    lines: {},
};

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}

/** A deterministic stream for one purpose on one day (draws nothing from the shared RNG). */
function _rng(world, key) {
    const seed = (world && world.generationParams && world.generationParams.seed) || 1;
    let a = _hash(`${seed}|fratricide|${_day(world)}|${key}`) || 1;
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

function _list(names) {
    if (names.length <= 1) return names.join('');
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const _name = c => `${c.firstName || ''}${c.dynasty ? ` ${c.dynasty}` : ''}`.trim() || 'a son of the House';
const _traitIds = p => _arr(p && p.traits).map(t => (t && (t.id || t)) || '').filter(Boolean);

export const Fratricide = {
    config() {
        const d = _obj(DataLoader._gamedata && DataLoader._gamedata.fratricide) || {};
        const out = { ...DEFAULTS };
        for (const [k, v] of Object.entries(d)) {
            if (k.startsWith('_')) continue;
            out[k] = _obj(v) && _obj(DEFAULTS[k]) ? { ...DEFAULTS[k], ...v } : v;
        }
        return out;
    },

    line(key, vars, fallback = '') {
        const L = Fratricide.config().lines || {};
        return _fill(L[key] || fallback, vars);
    },

    /** The realm's law on the heir's brothers: 'mercy' | 'cage' | 'fratricide'. */
    law(world, kingdomId) {
        if (kingdomId == null) return 'mercy';
        return Laws.value(world, kingdomId, 'succession') || 'mercy';
    },

    // ──────────── STATE ────────────

    state(player) {
        if (!player) return null;
        if (!_obj(player.fratricide)) player.fratricide = { pending: null, spared: [], schemes: [], history: [], nextId: 1, stats: { strangled: 0, spared: 0, caged: 0, poisoned: 0 } };
        const st = player.fratricide;
        if (!Array.isArray(st.spared)) st.spared = [];
        if (!Array.isArray(st.schemes)) st.schemes = [];
        if (!Array.isArray(st.history)) st.history = [];
        if (!_obj(st.stats)) st.stats = { strangled: 0, spared: 0, caged: 0, poisoned: 0 };
        if (!(st.nextId > 0)) st.nextId = 1;
        if (st.pending === undefined) st.pending = null;
        return st;
    },

    worldState(world) {
        if (!world) return { seen: {}, log: [] };
        if (!_obj(world.fratricide)) world.fratricide = { seen: {}, log: [] };
        const w = world.fratricide;
        if (!_obj(w.seen)) w.seen = {};
        if (!Array.isArray(w.log)) w.log = [];
        return w;
    },

    serializeWorld(world) {
        return world && _obj(world.fratricide) ? JSON.parse(JSON.stringify(world.fratricide)) : null;
    },

    restoreWorld(saved, world) {
        if (!world) return;
        world.fratricide = _obj(saved) ? JSON.parse(JSON.stringify(saved)) : null;
        Fratricide.worldState(world);
    },

    _log(world, rec) {
        const w = Fratricide.worldState(world);
        w.log.unshift({ day: _day(world), ...rec });
        const cap = _num(Fratricide.config().logCap, 40);
        if (w.log.length > cap) w.log.length = cap;
    },

    _history(player, world, text, kind) {
        const st = Fratricide.state(player);
        st.history.unshift({ day: _day(world), text, kind });
        if (st.history.length > 30) st.history.length = 30;
    },

    _chronicle(player, world, text, tags = ['heirs']) {
        if (player && player.house) House._chronicle(player.house, world, text, tags);
    },

    /** Is the child one of the condemned, the caged? */
    isCondemned(c) { return !!(c && c.isAlive !== false && _obj(c.fratricide) && c.fratricide.condemned != null && c.fratricide.spared == null); },
    isCaged(c) { return !!(c && c.isAlive !== false && _obj(c.fratricide) && c.fratricide.caged != null); },
    isSpared(c) { return !!(c && c.isAlive !== false && _obj(c.fratricide) && c.fratricide.spared != null); },
    /** No brother of this mark can rise for the crown (read by CrownSuccession.claimants). */
    barsClaim(c) { return Fratricide.isCondemned(c) || Fratricide.isCaged(c); },

    _ruled(player, world) {
        return Laws.ruled(player, world);
    },

    // ──────────── THE PLAYER'S SUCCESSION ────────────

    /**
     * The new ruler has taken the seat (the late ruler's other children are
     * player.children with isSibling). ctx is CrownSuccession.capture's (read
     * for who is an uncle); opts.widowId the late ruler's spouse. Under the
     * law the brothers are condemned (or caged) and dropped from ctx.siblings
     * so no claim rises from them. → { law, condemned: [names], caged: [names], text } | null
     */
    onSuccession(player, world, ctx = null, opts = {}) {
        const k = Fratricide._ruled(player, world);
        if (!player || !k) return null;
        const law = Fratricide.law(world, k.id);
        if (law === 'mercy') return null;
        const uncles = new Set(_arr(ctx && ctx.siblings).filter(s => s && s.uncle).map(s => s.id));
        const day = _day(world);
        const brothers = _arr(player.children).filter(c => c && c.isAlive !== false && c.isSibling && c.gender === 'male' && !uncles.has(c.id)
            && !c.crownedIn && !(c.crownSuccession && (c.crownSuccession.exiled || c.crownSuccession.renounced)) && !(_obj(c.fratricide) && (c.fratricide.caged != null || c.fratricide.fled != null)));
        if (!brothers.length) return { law, condemned: [], caged: [], text: '' };
        const C = Fratricide.config();
        const st = Fratricide.state(player);
        const realm = Names.realm(k.name);
        const names = brothers.map(c => c.firstName || _name(c));
        let text;
        if (law === 'cage') {
            for (const c of brothers) c.fratricide = { ...(_obj(c.fratricide) || {}), caged: day };
            st.stats.caged += brothers.length;
            player.karma = _num(player.karma) + _num(C.cage.karma) * brothers.length;
            text = Fratricide.line('caged', { realm, ruler: player.name, names: _list(names) }, `The brothers of ${player.name} are shut up in the cage: ${_list(names)}.`);
            Fratricide._chronicle(player, world, text, ['heirs']);
            Fratricide._history(player, world, text, 'caged');
        } else {
            for (const c of brothers) c.fratricide = { ...(_obj(c.fratricide) || {}), condemned: day };
            st.pending = { day, until: day + Math.max(1, Math.round(_num(C.graceDays, 3))), kingdomId: k.id, ids: brothers.map(c => c.id), widowId: opts.widowId || null, announced: false };
            text = Fratricide.line('pending', { realm, names: _list(names), days: Math.round(_num(C.graceDays, 3)) }, `${_list(names)} must die by the law.`);
        }
        if (ctx && Array.isArray(ctx.siblings)) {
            const out = new Set(brothers.map(c => c.id));
            ctx.siblings = ctx.siblings.filter(s => !out.has(s.id));
        }
        return { law, condemned: law === 'fratricide' ? names : [], caged: law === 'cage' ? names : [], text };
    },

    /** The brothers who wait for the word: [child]. */
    condemned(player) {
        const st = Fratricide.state(player);
        if (!st || !st.pending) return [];
        const ids = new Set(st.pending.ids);
        return _arr(player.children).filter(c => ids.has(c.id) && Fratricide.isCondemned(c));
    },

    /** What sparing a brother would cost now. */
    spareCost(player, world) {
        const C = Fratricide.config().spare;
        return { stability: _num(C.stability), prestige: _num(C.prestige), opinion: _num(C.opinion), karma: _num(C.karma) };
    },

    /** Spare a condemned brother: the law broken for him. → { success, text|reason } */
    spare(player, world, childId) {
        const st = Fratricide.state(player);
        const c = Fratricide.condemned(player).find(x => x.id === childId);
        if (!c) return { success: false, reason: 'He is not waiting for the bowstring.' };
        const k = _kingdom(world, st.pending.kingdomId) || Fratricide._ruled(player, world);
        const cost = Fratricide.spareCost(player, world);
        const day = _day(world);
        c.fratricide.spared = day;
        st.spared.push({ id: c.id, day, plotted: null });
        st.pending.ids = st.pending.ids.filter(id => id !== c.id);
        st.stats.spared++;
        if (k) k.stability = _clamp(_num(k.stability, 50) - cost.stability, 0, 100);
        if (player.house) House.spend(player.house, Math.min(cost.prestige, Math.max(0, _num(player.house.prestige))), 'a brother spared against the law', day);
        const court = Kingship.court(player);
        if (court) for (const v of _arr(court.vassals)) v.opinion = _clamp(_num(v.opinion) - cost.opinion, -100, 100);
        player.karma = _num(player.karma) + cost.karma;
        const text = Fratricide.line('spared', { ruler: player.name, poss: player.gender === 'female' ? 'her' : 'his', name: c.firstName, realm: Names.realm((k && k.name) || 'the realm') }, `You spare ${c.firstName}.`);
        Fratricide._chronicle(player, world, text, ['heirs']);
        Fratricide._history(player, world, text, 'spared');
        if (!st.pending.ids.length) st.pending = null;
        return { success: true, text: `${text} (Stability −${cost.stability}, Prestige −${cost.prestige}, the lords' opinion −${cost.opinion}.)` };
    },

    /**
     * Give the word: a condemned brother strangled now, or a spared one who
     * plotted (why 'plot': no new shame — he earned it), or a spared one on a
     * whim (why 'whim': the law kept late, karma the worse). → { success, text|reason }
     */
    strangle(player, world, childId, why = 'law') {
        const st = Fratricide.state(player);
        const c = _arr(player.children).find(x => x && x.id === childId && x.isAlive !== false);
        if (!c || !_obj(c.fratricide)) return { success: false, reason: 'No such brother waits for the bowstring.' };
        const C = Fratricide.config().strangle;
        if (Fratricide.isCondemned(c)) {
            Fratricide._strangle(player, world, [c]);
            st.pending.ids = st.pending.ids.filter(id => id !== c.id);
            if (!st.pending.ids.length) st.pending = null;
            return { success: true, text: Fratricide.line('strangledOne', { realm: Names.realm((Fratricide._ruled(player, world) || {}).name || 'the realm'), name: c.firstName, ruler: player.name }, `${c.firstName} is strangled.`) };
        }
        if (Fratricide.isSpared(c)) {
            const sp = st.spared.find(s => s.id === c.id);
            const plotted = !!(sp && sp.plotted);
            if (!plotted) player.karma = _num(player.karma) + _num(C.earlyKarma) * 2;
            st.spared = st.spared.filter(s => s.id !== c.id);
            Fratricide._strangle(player, world, [c]);
            const text = plotted
                ? `${c.firstName}, spared once and caught plotting, met the bowstring after all.`
                : `${c.firstName}, spared once, met the bowstring after all. The court learns that your mercy is a loan.`;
            Fratricide._chronicle(player, world, text, ['heirs', 'betrayal']);
            Fratricide._history(player, world, text, 'strangled');
            return { success: true, text };
        }
        return { success: false, reason: `${c.firstName} is not under the law.` };
    },

    /** Send a spared brother who plotted abroad under guard (no claimant, alive). */
    exile(player, world, childId) {
        const st = Fratricide.state(player);
        const sp = st.spared.find(s => s.id === childId);
        const c = _arr(player.children).find(x => x && x.id === childId && x.isAlive !== false);
        if (!sp || !c) return { success: false, reason: 'He is not one you spared.' };
        if (!_obj(c.crownSuccession)) c.crownSuccession = {};
        c.crownSuccession.exiled = true;
        c.fratricide.exiled = _day(world);
        st.spared = st.spared.filter(s => s.id !== childId);
        const k = Fratricide._ruled(player, world);
        const text = Fratricide.line('exiled', { name: c.firstName, realm: Names.realm((k && k.name) || 'the realm') }, `${c.firstName} is sent abroad.`);
        Fratricide._chronicle(player, world, text, ['heirs']);
        Fratricide._history(player, world, text, 'exiled');
        return { success: true, text };
    },

    /** The bowstring: each dies, his portion comes home, the tree is closed on him. */
    _strangle(player, world, list) {
        if (!list.length) return;
        const C = Fratricide.config().strangle;
        const st = Fratricide.state(player);
        const day = _day(world);
        const k = Fratricide._ruled(player, world) || (st.pending ? _kingdom(world, st.pending.kingdomId) : null);
        for (const c of list) {
            c.isAlive = false;
            c.deathDay = day;
            c.deathCause = 'strangled with the bowstring';
            c.fratricide.strangled = day;
            KinCrimes._clearPosts(player, world, c.id);
            const portion = Math.max(0, _num(c.purse));
            if (portion > 0) {
                c.purse = 0;
                Inheritance.setCoin(player, Inheritance.coin(player) + portion);
                Ledger.record(player, 'family', portion);
            }
            player.karma = _num(player.karma) + _num(C.karma);
        }
        st.stats.strangled += list.length;
        if (k) k.stability = _clamp(_num(k.stability, 50) + Math.min(_num(C.stabilityCap, 3), list.length * _num(C.stabilityPer, 1)), 0, 100);
        // Their mother does not forgive it
        const widowId = st.pending && st.pending.widowId;
        const widow = widowId ? Relationships.getNPC(widowId) : null;
        if (widow && widow.isAlive !== false) {
            Nemesis.wrong(player, world, {
                kind: 'kin', name: widow.name || `${widow.firstName || ''} ${widow.lastName || ''}`.trim(), ref: { npcId: widow.id }, line: widow.dynasty || null,
                deed: { key: 'fratricide', label: list.length > 1 ? 'her sons strangled' : 'her son strangled', note: list.map(c => c.firstName).join(', ') },
                score: _num(C.widowNemesis, 55), gender: widow.gender === 'male' ? 'male' : 'female', age: _num(widow.age, 45),
            });
        }
        try { DynastyTree.sync(player, world, { npc: id => Relationships.getNPC(id) }); } catch (e) { /* no tree */ }
    },

    /** The days run out: the rest are strangled. */
    _expire(player, world, out) {
        const st = Fratricide.state(player);
        const list = Fratricide.condemned(player);
        const k = _kingdom(world, st.pending.kingdomId) || Fratricide._ruled(player, world);
        if (list.length) {
            Fratricide._strangle(player, world, list);
            const text = Fratricide.line('strangled', { realm: Names.realm((k && k.name) || 'the realm'), ruler: player.name, names: _list(list.map(c => c.firstName)) }, `The brothers are strangled: ${_list(list.map(c => c.firstName))}.`);
            Fratricide._chronicle(player, world, text, ['heirs']);
            Fratricide._history(player, world, text, 'strangled');
            out.notices.push({ icon: '➰', title: 'The Bowstring', text, type: 'warning' });
        }
        st.pending = null;
    },

    // ──────────── THE SPARED ────────────

    _spymaster(player) {
        const roles = player && player.house && player.house.roles;
        return !!(roles && roles.spymaster);
    },

    /** Yearly, for each spared brother of age: a plot, caught or not. */
    _sparedYear(player, world, out) {
        const st = Fratricide.state(player);
        const P = Fratricide.config().plot;
        const k = Fratricide._ruled(player, world);
        for (const sp of st.spared.slice()) {
            const c = _arr(player.children).find(x => x && x.id === sp.id);
            if (!c || c.isAlive === false) { st.spared = st.spared.filter(s => s !== sp); continue; }
            if (sp.plotted || _num(c.age) < _num(P.minAge, 16)) continue;
            const rnd = _rng(world, `plot:${c.id}`);
            const tr = _traitIds(c);
            let chance = _num(P.yearly) + (tr.includes('ambitious') ? _num(P.ambitious) : 0) + (c.crownSuccession && c.crownSuccession.grudge ? _num(P.grudge) : 0);
            if (c.upbringing && c.upbringing.turned) chance += _num(P.grudge);
            if (rnd() >= chance) continue;
            const realm = Names.realm((k && k.name) || 'the realm');
            if (rnd() < _num(P.revealBase) + (Fratricide._spymaster(player) ? _num(P.revealSpymaster) : 0)) {
                sp.plotted = _day(world);
                const text = Fratricide.line('plotRevealed', { name: c.firstName, realm }, `${c.firstName} plots.`);
                Fratricide._history(player, world, text, 'plot');
                out.notices.push({ icon: '➰', title: 'A Spared Brother Plots', text: `${text} Dynasty → The Bowstring.`, type: 'warning' });
            } else {
                if (!_obj(c.crownSuccession)) c.crownSuccession = {};
                c.crownSuccession.exiled = true;
                c.fratricide.fled = _day(world);
                st.spared = st.spared.filter(s => s !== sp);
                Nemesis.wrong(player, world, {
                    kind: 'kin', name: _name(c), ref: { childId: c.id }, line: c.dynasty || null,
                    deed: { key: 'fratricide', label: 'the bowstring that waited for him', note: realm }, score: _num(P.nemesisScore, 70),
                    age: _num(c.age), gender: 'male',
                });
                const text = Fratricide.line('plotFled', { name: c.firstName, realm }, `${c.firstName} flees.`);
                Fratricide._chronicle(player, world, text, ['heirs', 'betrayal']);
                Fratricide._history(player, world, text, 'fled');
                out.notices.push({ icon: '➰', title: 'A Spared Brother Flees', text, type: 'error' });
            }
        }
    },

    // ──────────── THE MOTHERS ────────────

    /** Living sons of the ruler's own (not siblings): [child]. */
    _sons(player) {
        return _arr(player && player.children).filter(c => c && c.isAlive !== false && !c.isSibling && c.gender === 'male' && !Fratricide.barsClaim(c));
    },

    /** The son the crown would go to: the named heir, else the eldest son. */
    _heirSon(player) {
        const sons = Fratricide._sons(player);
        return sons.find(c => c.id === player.heir) || sons.slice().sort((a, b) => _num(b.age) - _num(a.age))[0] || null;
    },

    _motherOf(player, c) {
        const id = c.otherParentId || player.spouse || null;
        const npc = id ? Relationships.getNPC(id) : null;
        return { id: id || 'unknown', npc, name: npc ? (npc.name || `${npc.firstName || ''} ${npc.lastName || ''}`.trim()) : 'the boy\'s mother' };
    },

    /** Monthly: a mother whose son is not the heir may begin to scheme. */
    _mothersMonth(player, world, out) {
        const C = Fratricide.config().mothers;
        const st = Fratricide.state(player);
        const sons = Fratricide._sons(player);
        const heir = Fratricide._heirSon(player);
        if (sons.length < 2 || !heir) return;
        const heirMother = Fratricide._motherOf(player, heir);
        const groups = new Map();
        for (const c of sons) {
            if (c.id === heir.id) continue;
            const m = Fratricide._motherOf(player, c);
            if (m.npc && m.npc.isAlive === false) continue;
            if (!groups.has(m.id)) groups.set(m.id, { m, sons: [] });
            groups.get(m.id).sons.push(c);
        }
        const day = _day(world);
        for (const { m, sons: hers } of groups.values()) {
            if (st.schemes.some(s => s.motherId === m.id && !s.ended)) continue;
            const rnd = _rng(world, `mother:${m.id}`);
            let chance = _num(C.monthly);
            if (m.id === heirMother.id) chance *= _num(C.sameMother, 0.3);
            if (m.npc && _traitIds(m.npc).includes('ambitious')) chance *= _num(C.ambitious, 1.6);
            if (player.crownSuccession && Object.values(_obj(player.crownSuccession.prep) || {}).some(p => p && p.crowned && p.crowned.heirId === heir.id)) chance *= _num(C.crowned, 1.3);
            if (rnd() >= chance) continue;
            const forSon = hers.slice().sort((a, b) => _num(b.age) - _num(a.age))[0];
            const lead = Math.round(_num(C.leadMin, 40) + rnd() * (_num(C.leadMax, 120) - _num(C.leadMin, 40)));
            const s = {
                id: `fs${st.nextId++}`, motherId: m.id, motherName: m.name, forId: forSon.id, forName: forSon.firstName,
                againstId: heir.id, againstName: heir.firstName, hatched: day, strikeDay: day + lead, revealed: null, guarded: false, ended: null,
            };
            st.schemes.push(s);
            Fratricide._history(player, world, Fratricide.line('motherHatched', { mother: m.name, forName: forSon.firstName }, `${m.name} schemes.`), 'scheme');
        }
    },

    /** Daily: hidden schemes come to light, or strike. */
    _schemesDay(player, world, out) {
        const C = Fratricide.config().mothers;
        const st = Fratricide.state(player);
        const day = _day(world);
        for (const s of st.schemes) {
            if (s.ended) continue;
            const target = _arr(player.children).find(c => c && c.id === s.againstId);
            const forSon = _arr(player.children).find(c => c && c.id === s.forId);
            if (!target || target.isAlive === false || !forSon || forSon.isAlive === false) { s.ended = { day, how: 'moot' }; continue; }
            const rnd = _rng(world, `scheme:${s.id}`);
            const vars = { mother: s.motherName, forName: s.forName, againstName: s.againstName };
            if (!s.revealed && rnd() < _num(C.revealDaily) + (Fratricide._spymaster(player) ? _num(C.revealSpymaster) : 0)) {
                s.revealed = day;
                const text = Fratricide.line('motherRevealed', vars, `${s.motherName} schemes against ${s.againstName}.`);
                out.notices.push({ icon: '🍷', title: 'A Mother\'s Scheme', text: `${text} Dynasty → The Bowstring.`, type: 'warning' });
            }
            if (day < s.strikeDay) continue;
            if (s.guarded) {
                s.ended = { day, how: 'foiled' };
                const text = Fratricide.line('motherFoiled', vars, 'The plot is foiled.');
                Fratricide._mothersShame(player, world, s);
                Fratricide._chronicle(player, world, text, ['heirs', 'scheme']);
                Fratricide._history(player, world, text, 'foiled');
                out.notices.push({ icon: '🛡️', title: 'The Cup Caught', text, type: 'success' });
                continue;
            }
            if (rnd() < _num(C.success, 0.55)) {
                target.isAlive = false;
                target.deathDay = day;
                target.deathCause = 'a sudden fever';
                target.fratricide = { ...(_obj(target.fratricide) || {}), poisoned: day, by: s.motherName };
                KinCrimes._clearPosts(player, world, target.id);
                st.stats.poisoned++;
                s.ended = { day, how: 'poisoned' };
                const text = Fratricide.line('motherPoisoned', vars, `${s.againstName} dies.`);
                Fratricide._chronicle(player, world, text, ['heirs', 'scheme']);
                Fratricide._history(player, world, text, 'poisoned');
                out.notices.push({ icon: '⚰️', title: 'A Son Dead', text, type: 'error' });
                try { DynastyTree.sync(player, world, { npc: id => Relationships.getNPC(id) }); } catch (e) { /* no tree */ }
            } else {
                s.ended = { day, how: 'failed' };
                Fratricide._mothersShame(player, world, s);
                const text = Fratricide.line('motherFailed', vars, `${s.againstName} lives.`);
                Fratricide._chronicle(player, world, text, ['heirs', 'scheme']);
                Fratricide._history(player, world, text, 'failed');
                out.notices.push({ icon: '🍷', title: 'A Cup That Failed', text, type: 'warning' });
            }
        }
        if (st.schemes.length > 12) st.schemes = st.schemes.filter(s => !s.ended || day - s.ended.day < 720).slice(-12);
    },

    /** A mother found out: the ruler's affection, if she is the consort. */
    _mothersShame(player, world, s) {
        const C = Fratricide.config().mothers;
        if (s.motherId && s.motherId === player.spouse) {
            const rel = Relationships.getRelationship(player, s.motherId);
            if (rel) rel.affection = _clamp(_num(rel.affection, 50) + _num(C.exposedAffection), 0, 100);
        }
    },

    /** Set guards on the boy a revealed scheme aims at: gold to the town's purse. */
    guard(player, world, schemeId) {
        const st = Fratricide.state(player);
        const s = st.schemes.find(x => x.id === schemeId && !x.ended);
        if (!s || !s.revealed) return { success: false, reason: 'No such scheme is known.' };
        if (s.guarded) return { success: false, reason: 'The boy is guarded already.' };
        const cost = _num(Fratricide.config().mothers.guardCost, 60);
        if (_num(player.gold) < cost) return { success: false, reason: `Guards and a taster cost ${Utils.formatGold(cost)}g.` };
        player.gold = _num(player.gold) - cost;
        Ledger.record(player, 'family', -cost);
        if (!Economy.payNearest(world, player.q, player.r, cost)) MoneySupply.leak(world, -cost, 'fratricide');
        s.guarded = true;
        return { success: true, text: `Guards and a taster watch over ${s.againstName} day and night (${Utils.formatGold(cost)}g).` };
    },

    /** Send the scheming mother from court (the consort's love the price). */
    banish(player, world, schemeId) {
        const C = Fratricide.config().mothers;
        const st = Fratricide.state(player);
        const s = st.schemes.find(x => x.id === schemeId && !x.ended);
        if (!s || !s.revealed) return { success: false, reason: 'No such scheme is known.' };
        s.ended = { day: _day(world), how: 'banished' };
        if (s.motherId === player.spouse) {
            const rel = Relationships.getRelationship(player, s.motherId);
            if (rel) rel.affection = _clamp(_num(rel.affection, 50) + _num(C.banishAffection), 0, 100);
        } else if (Court.isMember(player, s.motherId)) {
            try { Court._remove(player, world, s.motherId, 'dismissed'); } catch (e) { /* not at court */ }
        }
        const son = _arr(player.children).find(c => c && c.id === s.forId);
        if (son) try { Raising._addBond(son, _num(C.banishBond)); } catch (e) { /* no bond */ }
        const text = Fratricide.line('motherBanished', { mother: s.motherName, againstName: s.againstName }, `${s.motherName} is sent away.`);
        Fratricide._chronicle(player, world, text, ['heirs', 'scheme']);
        Fratricide._history(player, world, text, 'banished');
        return { success: true, text };
    },

    // ──────────── THE AI REALMS ────────────

    /** Throne: no succession crisis comes of a brother where the law strangles or cages them. */
    quellsCrisis(world, kingdom, succ) {
        if (!kingdom || !succ || succ.type !== 'heir') return false;
        return Fratricide.law(world, kingdom.id) !== 'mercy';
    },

    _aiSuccessions(world, player, out) {
        const w = Fratricide.worldState(world);
        const ruled = player ? Fratricide._ruled(player, world) : null;
        const C = Fratricide.config();
        const A = C.ai;
        for (const k of _arr(world.kingdoms)) {
            const succ = k && k.lastSuccession;
            if (!k || !k.isAlive || !succ || !(succ.day > _num(w.seen[k.id], -1))) continue;
            w.seen[k.id] = succ.day;
            if (ruled && ruled.id === k.id) continue;
            const data = k.characterData;
            const ruler = data && data.ruler;
            if (!ruler) continue;
            const law = Fratricide.law(world, k.id);
            const rname = Names.realm(k.name);
            const traits = _traitIds(ruler);
            if (law !== 'mercy' && succ.type === 'heir') {
                const brothers = _arr(data.children).filter(c => c && c.isAlive && c.id !== ruler.id && c.gender === 'male'
                    && ruler.parentId != null && (c.parentId === ruler.parentId || c.parentId2 === ruler.parentId) && !c.caged);
                if (brothers.length) {
                    for (const c of brothers) {
                        if (law === 'cage') c.caged = succ.day;
                        else { c.isAlive = false; c.deathDay = _day(world); c.deathCause = 'strangled with the bowstring'; }
                    }
                    const n = brothers.length;
                    const text = Fratricide.line(law === 'cage' ? 'aiCaged' : 'aiStrangled', { ruler: k.ruler || ruler.firstName, realm: rname, n, s: n === 1 ? '' : 's' }, `${k.ruler} disposes of ${n} brothers.`);
                    Fratricide._log(world, { kingdomId: k.id, kind: law === 'cage' ? 'caged' : 'strangled', n, names: brothers.map(c => c.firstName), text });
                    if (Array.isArray(world.events)) world.events.push({ category: 'political', text: `➰ ${text}`, kingdom: k.id, impact: 'negative' });
                }
            }
            // A crown won through blood may make the bowstring law; a just or pious one may unmake it
            const rnd = _rng(world, `adopt:${k.id}:${succ.day}`);
            if (law === 'mercy' && succ.crisis && traits.some(t => _arr(A.adoptTraits).includes(t)) && rnd() < _num(A.adoptOnCrisis)) {
                if (Laws.proclaim(world, k, 'succession', 'fratricide', { why: 'crisis' })) {
                    const text = Fratricide.line('aiAdopt', { ruler: k.ruler || ruler.firstName, realm: rname }, `${rname} adopts the law of fratricide.`);
                    Fratricide._log(world, { kingdomId: k.id, kind: 'adopt', text });
                    if (Array.isArray(world.events)) world.events.push({ category: 'political', text: `➰ ${text}`, kingdom: k.id, impact: 'negative' });
                }
            } else if (law === 'fratricide' && traits.some(t => _arr(A.repealTraits).includes(t)) && rnd() < _num(A.repealChance)) {
                if (Laws.proclaim(world, k, 'succession', 'mercy', { why: 'mercy' })) {
                    const text = Fratricide.line('aiRepeal', { ruler: k.ruler || ruler.firstName, realm: rname }, `${rname} repeals the law of fratricide.`);
                    Fratricide._log(world, { kingdomId: k.id, kind: 'repeal', text });
                    if (Array.isArray(world.events)) world.events.push({ category: 'political', text: `🕊️ ${text}`, kingdom: k.id, impact: 'positive' });
                }
            }
        }
    },

    /** Yearly: in the fratricide realms the mothers' war takes a son now and then. */
    _aiHarems(world, player) {
        const A = Fratricide.config().ai;
        const ruled = player ? Fratricide._ruled(player, world) : null;
        for (const k of _arr(world.kingdoms)) {
            if (!k || !k.isAlive || (ruled && ruled.id === k.id) || Fratricide.law(world, k.id) !== 'fratricide') continue;
            const data = k.characterData;
            const ruler = data && data.ruler;
            if (!ruler) continue;
            const sons = _arr(data.children).filter(c => c && c.isAlive && c.gender === 'male' && (c.parentId === ruler.id || c.parentId2 === ruler.id) && !c.caged);
            if (sons.length < _num(A.haremMinSons, 2)) continue;
            const rnd = _rng(world, `harem:${k.id}`);
            if (rnd() >= _num(A.haremYearly)) continue;
            // (never the eldest: his brothers' mothers want him gone, but he is watched — a younger one dies)
            const pool = sons.slice().sort((a, b) => _num(b.age) - _num(a.age)).slice(1);
            const victim = pool[Math.floor(rnd() * pool.length)] || sons[0];
            victim.isAlive = false;
            victim.deathDay = _day(world);
            victim.deathCause = 'poison';
            const text = Fratricide.line('aiHarem', { ruler: k.ruler || ruler.firstName, realm: Names.realm(k.name), name: victim.firstName }, `A son of ${k.ruler} is poisoned.`);
            Fratricide._log(world, { kingdomId: k.id, kind: 'harem', names: [victim.firstName], text });
            if (Array.isArray(world.events)) world.events.push({ category: 'political', text: `🍷 ${text}`, kingdom: k.id, impact: 'negative' });
        }
    },

    // ──────────── THE DAY ────────────

    processDay(world, player = null) {
        const out = { notices: [] };
        if (!world) return out;
        const day = _day(world);
        Fratricide._aiSuccessions(world, player, out);
        if (day % _Y === 180) Fratricide._aiHarems(world, player);
        if (!player) return out;
        const st = Fratricide.state(player);
        if (st.pending) {
            if (!st.pending.announced) {
                st.pending.announced = true;
                const list = Fratricide.condemned(player);
                if (list.length) {
                    const k = _kingdom(world, st.pending.kingdomId);
                    out.notices.push({ icon: '➰', title: 'The Law of Fratricide', text: `${Fratricide.line('pending', { realm: Names.realm((k && k.name) || 'the realm'), names: _list(list.map(c => c.firstName)), days: Math.max(0, st.pending.until - day) }, '')} Dynasty → The Bowstring.`, type: 'warning' });
                }
            }
            if (day >= st.pending.until) Fratricide._expire(player, world, out);
        }
        if (st.spared.length && day % _Y === 90) Fratricide._sparedYear(player, world, out);
        const k = Fratricide._ruled(player, world);
        if (k && Fratricide.law(world, k.id) === 'fratricide' && day % 30 === 15) Fratricide._mothersMonth(player, world, out);
        if (st.schemes.length) Fratricide._schemesDay(player, world, out);
        return out;
    },

    // ──────────── THE PANEL ────────────

    view(player, world) {
        const st = Fratricide.state(player);
        const k = Fratricide._ruled(player, world);
        const law = k ? Fratricide.law(world, k.id) : null;
        const day = _day(world);
        const lawOpt = k ? Laws.option(world, k.id, 'succession') : null;
        const sons = Fratricide._sons(player);
        return {
            realm: k ? { id: k.id, name: Names.realm(k.name) } : null,
            law, lawLabel: lawOpt ? lawOpt.label : null,
            pending: st.pending ? { until: st.pending.until, daysLeft: Math.max(0, st.pending.until - day), brothers: Fratricide.condemned(player).map(c => ({ id: c.id, name: c.firstName, age: _num(c.age) })) } : null,
            spareCost: Fratricide.spareCost(player, world),
            spared: st.spared.map(sp => {
                const c = _arr(player.children).find(x => x && x.id === sp.id);
                return c ? { id: c.id, name: c.firstName, age: _num(c.age), day: sp.day, plotted: sp.plotted } : null;
            }).filter(Boolean),
            caged: _arr(player.children).filter(c => Fratricide.isCaged(c)).map(c => ({ id: c.id, name: c.firstName, age: _num(c.age), since: c.fratricide.caged })),
            dead: _arr(player.children).filter(c => c && c.isAlive === false && _obj(c.fratricide) && (c.fratricide.strangled != null || c.fratricide.poisoned != null))
                .map(c => ({ name: c.firstName, how: c.fratricide.strangled != null ? 'strangled' : 'poisoned', day: c.deathDay })),
            sons: sons.map(c => ({ id: c.id, name: c.firstName, age: _num(c.age), heir: player.heir === c.id, mother: Fratricide._motherOf(player, c).name })),
            schemes: st.schemes.filter(s => s.revealed && !s.ended),
            history: st.history.slice(0, 10),
            stats: { ...st.stats },
            world: Fratricide.worldState(world).log.slice(0, 8),
        };
    },
};
