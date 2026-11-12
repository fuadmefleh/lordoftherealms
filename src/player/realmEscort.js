// ============================================
// REALM ESCORT — the household guard a realm keeps for its lords and its crown
// ============================================
// A player who holds rank in a realm rides with an escort the realm keeps and
// pays — not the player's own hired army:
//
//   lord    a Lord's office (Marshal, Spymaster) or a few estates in the realm
//           one is sworn to: a few riders and men-at-arms
//   great   Chancellor, the Great Lord start's House in its realm, or many
//           estates there: a company of horse, foot and bows
//   crown   the realm the player rules: the Royal Guard (the Monarch start's
//           and a usurper's guard are this escort: Scenarios / Generalship
//           raise it through `raise`)
//
// THE MEN    Companies (player.army units tagged unit.realmGuard = kingdomId,
//            unit.upkeep 0: the player pays nothing for them) drawn out of
//            kingdom.military — never more than the rank's share of it — and
//            given back when the escort ends. They fight in every battle the
//            army fights (road encounters, field battles, the battlefield,
//            sieges); the fallen are the realm's dead. One lost company is
//            replaced now and then while the treasury and the army allow.
// THE ARMS   Each company is issued a kit out of the realm's armoury
//            (kingdom.armoury.stock: one piece per slot of its unit type's
//            kit, a quiver of arrows for its bowmen); the survivors hand back
//            what they carry, the fallen's arms are lost on the field.
// THE MONEY  The crown pays: each company's wage out of the treasury daily
//            (CrownBooks 'guard' line) into the men's pockets, spent in the
//            towns they lodge in; their bread from a town's granary, the crown
//            paying the town (as a general's host is fed). What the treasury
//            cannot pay is owed: morale falls and, past a week, the unpaid
//            slip away. When the escort ends, what is owed becomes the realm
//            army's arrears and the coin in the men's pockets goes home with
//            them to the capital.
// THE END    It leaves when the player loses the rank, is exiled, swears to
//            another crown or makes war on this one, is sent home (`sendHome`)
//            or deserts to the last man. A general's coup weighs it
//            (`coupSide`: a guard grown loyal enough joins the coup).
//
// State: player.realmEscort = { guard: {...} | null, home: { kingdomId: day },
// past: [] } (saved). Tuning: data/escort.json. Pure: explicit params, no RNG
// (nothing here draws dice), no globals.

import { DataLoader } from '../core/dataLoader.js';
import { Economy } from '../world/economy.js';
import { CrownBooks } from '../world/crownBooks.js';
import { RealmArms } from '../world/realmArms.js';
import { Estates } from '../world/estates.js';
import { Throne } from '../systems/throne.js';
import { Titles } from '../systems/titles.js';
import { RealmWars } from '../systems/realmWars.js';
import { Arms } from '../systems/arms.js';
import { PlayerMilitary } from './playerMilitary.js';
import { Names } from '../core/names.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _r2 = v => Math.round(v * 100) / 100;
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _day = world => _num(world && world.day);
const _same = (a, b) => a != null && b != null && String(a) === String(b);

const RANKS = ['lord', 'great', 'crown'];

function _kingdom(world, id) {
    if (id == null || !world) return null;
    if (typeof world.getKingdom === 'function') return world.getKingdom(id) || null;
    return (world.kingdoms || []).find(k => _same(k.id, id)) || null;
}

export const RealmEscort = {
    RANKS,

    // ── Data ────────────────────────────────────────

    config() {
        return _obj(DataLoader._gamedata && DataLoader._gamedata.escort) || {};
    },

    enabled() {
        const C = RealmEscort.config();
        return C.enabled !== false && !!_obj(C.ranks);
    },

    rankDef(rank) {
        return (_obj(RealmEscort.config().ranks) || {})[rank] || null;
    },

    /** player.realmEscort, created when missing. */
    state(player) {
        if (!player) return null;
        let st = _obj(player.realmEscort);
        if (!st) st = player.realmEscort = {};
        if (st.guard !== null && !_obj(st.guard)) st.guard = null;
        if (!_obj(st.home)) st.home = {};
        if (!Array.isArray(st.past)) st.past = [];
        return st;
    },

    /** The guard riding with the player, or null. */
    guard(player) {
        const st = player && _obj(player.realmEscort);
        return st && _obj(st.guard) ? st.guard : null;
    },

    // ── Who rates an escort ─────────────────────────

    /** The player's estates in a realm's towns (world/estates.js, holder 'player'). */
    estatesIn(player, world, kid) {
        if (!world || !_obj(world.estates) || !Estates.enabled()) return 0;
        let n = 0;
        for (const e of Estates.heldBy(world, 'player')) {
            const [q, r] = String(e.town || '').split(',').map(Number);
            const t = Number.isFinite(q) && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
            if (t && t.settlement && _same(t.settlement.kingdom, kid)) n++;
        }
        return n;
    },

    /**
     * The rank the player holds in a realm, and why: { rank, kingdom, why }
     * or null. The realm ruled first; else the realm sworn to (not exiled
     * from, not at war with), by office, estates or the Great Lord's House.
     */
    standing(player, world) {
        if (!player || !world || !RealmEscort.enabled()) return null;
        const ruled = Throne.ruledKingdom(player, world);
        if (ruled) return { rank: 'crown', kingdom: ruled, why: `you wear the crown of ${ruled.name}` };
        const k = _kingdom(world, player.allegiance);
        if (!k || k.isAlive === false) return null;
        if (Throne.isExiledFrom(player, world, k.id) || RealmWars.atWarWith(player, k.id)) return null;
        const Q = RealmEscort.config().qualify || {};
        const t = Titles.getActiveTitle(player);
        const office = t ? _num(t.rank) : 0;
        const estates = RealmEscort.estatesIn(player, world, k.id);
        const start = player.scenario && player.scenario.start;
        const greatHouse = !!(start && start.kind === 'great_lord' && _same(start.kingdomId, k.id));
        if (office >= _num(Q.greatOfficeRank, 4)) return { rank: 'great', kingdom: k, why: `you are ${t.name} of ${Names.realm(k.name)}` };
        if (greatHouse) return { rank: 'great', kingdom: k, why: `your House is the greatest of ${Names.realm(k.name)}` };
        if (estates >= _num(Q.greatEstates, 5)) return { rank: 'great', kingdom: k, why: `you hold ${estates} estates in ${Names.realm(k.name)}` };
        if (office >= _num(Q.lordOfficeRank, 3)) return { rank: 'lord', kingdom: k, why: `you are ${t.name} of ${Names.realm(k.name)}` };
        if (estates >= _num(Q.lordEstates, 2)) return { rank: 'lord', kingdom: k, why: `you hold ${estates} estates in ${Names.realm(k.name)}` };
        return null;
    },

    // ── The men ─────────────────────────────────────

    /** The guard's companies in the player's army (of one realm, or any). */
    units(player, kid = null) {
        return ((player && player.army) || []).filter(u => u && u.realmGuard != null && (kid == null || _same(u.realmGuard, kid)));
    },

    /** Men (unit strength) of the guard riding with the player. */
    men(player, kid = null) {
        return RealmEscort.units(player, kid).reduce((s, u) => s + _num(u.strength), 0);
    },

    /** The crown's daily wage for the guard (each company its type's upkeep × pay.mult). */
    wage(player, kid = null) {
        const mult = _num((RealmEscort.config().pay || {}).mult, 1);
        return _r2(RealmEscort.units(player, kid).reduce((s, u) => s + _num(u.crownWage), 0) * mult);
    },

    /** The companies a rank rides with: { type: n } (plus `extra` companies asked for). */
    spec(rank, extra = 0) {
        const R = RealmEscort.rankDef(rank);
        const out = { ...((R && _obj(R.units)) || {}) };
        const n = Math.max(0, Math.floor(_num(extra)));
        if (n > 0 && R && R.extraUnit) out[R.extraUnit] = _num(out[R.extraUnit]) + n;
        return out;
    },

    /** The most men a rank may draw out of the realm's army (its share of the army as it stands). */
    cap(kingdom, rank, already = 0) {
        const R = RealmEscort.rankDef(rank) || {};
        return Math.floor((Math.max(0, _num(kingdom && kingdom.military)) + Math.max(0, already)) * _num(R.maxShare, 0.05));
    },

    /** One piece of an arms good of these classes out of the armoury stock (the best tier held), or null. */
    _takePiece(stock, classes) {
        let best = null;
        for (const [id, n] of Object.entries(stock || {})) {
            if (!(_num(n) >= 1)) continue;
            const def = Arms.item(id);
            if (!def || !classes.includes(def.class)) continue;
            if (!best || _num(def.tier, 1) > _num(best.def.tier, 1)) best = { id, def };
        }
        if (!best) return null;
        stock[best.id] = _r2(_num(stock[best.id]) - 1);
        return best.id;
    },

    /**
     * Arm a company out of the realm's armoury: a piece for each slot of its
     * kit (data/arms.json troops.kits) the stock holds, a quiver for a bowman.
     * A slot the armoury cannot fill stays empty (he fights the worse for it).
     */
    _armFromArmoury(kingdom, unit) {
        const spec = Arms.kitSpec(unit.type);
        if (!kingdom) return;
        const stock = RealmArms.state(kingdom).stock;
        if (spec) {
            const kit = { g: {}, cond: 100 };
            for (const [slot, s] of Object.entries(spec.slots || {})) {
                const id = RealmEscort._takePiece(stock, Array.isArray(s.classes) ? s.classes : []);
                if (id) kit[slot] = id;
            }
            unit.kit = kit;
        }
        const good = Arms.ammoGood(unit);
        if (good) {
            const want = Arms.quiverOf(unit).quiver;
            const got = Math.min(want, Math.floor(_num(stock[good])));
            stock[good] = _r2(_num(stock[good]) - got);
            unit.ammo = got;
        }
    },

    /** A company's arms back into the armoury (the survivors hand in their kit and arrows). */
    _disarm(kingdom, unit) {
        if (!kingdom || !unit) return 0;
        const stock = RealmArms.state(kingdom).stock;
        let n = 0;
        const kit = _obj(unit.kit);
        if (kit) {
            for (const s of ['main', 'off', 'head', 'body']) {
                if (!Arms.item(kit[s])) continue;
                stock[kit[s]] = _r2(_num(stock[kit[s]]) + 1);
                n++;
            }
            delete unit.kit;
        }
        const good = Arms.ammoGood({ ...unit, kit });
        if (good && _num(unit.ammo) > 0) {
            stock[good] = _r2(_num(stock[good]) + Math.floor(_num(unit.ammo)));
            n += Math.floor(_num(unit.ammo));
        }
        return n;
    },

    /**
     * Draw companies out of a realm's army into the player's: each unit's
     * strength leaves kingdom.military (never more than it has, nor past
     * `opts.cap` men), armed from the armoury when opts.armed. With opts.tag
     * they are the realm's household guard (unit.realmGuard; the crown pays
     * them, unit.upkeep 0). → the companies drawn.
     */
    draw(player, kingdom, spec, opts = {}) {
        if (!Array.isArray(player.army)) player.army = [];
        let pool = Math.max(0, Math.floor(_num(kingdom && kingdom.military)));
        let room = Number.isFinite(opts.cap) ? Math.max(0, opts.cap) : Infinity;
        const out = [];
        for (const [type, n] of Object.entries(_obj(spec) || {})) {
            const def = PlayerMilitary.getUnitDef(type);
            if (!def) continue;
            for (let i = 0; i < Math.max(0, Math.floor(_num(n))); i++) {
                const str = _num(def.strength, 10);
                if (pool < str || room < str) break;
                pool -= str;
                room -= str;
                const unit = PlayerMilitary.makeArmyUnit(def);
                if (opts.tag != null) {
                    unit.realmGuard = opts.tag;
                    unit.crownWage = _num(def.upkeep);
                    unit.upkeep = 0;
                }
                if (opts.armed && kingdom) RealmEscort._armFromArmoury(kingdom, unit);
                player.army.push(unit);
                out.push(unit);
            }
        }
        if (kingdom) kingdom.military = pool;
        return out;
    },

    // ── Raising and ending the guard ────────────────

    _log(g, world, text) {
        if (!Array.isArray(g.log)) g.log = [];
        g.log.unshift({ day: _day(world), text });
        if (g.log.length > 20) g.log.length = 20;
    },

    /**
     * The realm sends (or adds to) the player's guard: `spec` companies
     * (default: the rank's own), drawn out of its army and armed out of its
     * armoury. The Monarch start and a usurper's court call this with their
     * own guard. → { men, units, guard } (men: the companies drawn).
     */
    raise(player, world, kingdom, rank, spec = null, opts = {}) {
        const st = RealmEscort.state(player);
        if (!st || !kingdom || !RealmEscort.rankDef(rank)) return { men: 0, units: 0, guard: null };
        const C = RealmEscort.config();
        let g = st.guard;
        if (g && !_same(g.kingdomId, kingdom.id)) {
            RealmEscort.end(player, world, 'another', null);
            g = null;
        }
        const day = _day(world);
        if (!g) {
            const L = C.loyalty || {};
            g = st.guard = {
                kingdomId: kingdom.id, kingdomName: kingdom.name, rank, since: day,
                morale: _num((C.morale || {}).start, 65),
                loyalty: rank === 'crown' ? _num(L.crownStart, 55) : _num(L.start, 30),
                owed: 0, arrearsDays: 0, supplies: 0, pockets: 0, extra: 0, men: 0,
                lastRefill: day, lastAsk: -1e9,
                record: { paid: 0, fed: 0, fallen: 0, deserted: 0, battles: 0, won: 0 },
                log: [],
            };
            delete st.home[kingdom.id];
        }
        g.rank = rank;
        const want = spec || RealmEscort.spec(rank, g.extra);
        const cap = opts.cap === false ? Infinity : Math.max(0, RealmEscort.cap(kingdom, rank, g.men) - RealmEscort.men(player, kingdom.id));
        const drawn = RealmEscort.draw(player, kingdom, want, { tag: kingdom.id, armed: true, cap });
        const men = drawn.reduce((s, u) => s + _num(u.strength), 0);
        g.men = RealmEscort.men(player, kingdom.id);
        if (men > 0) RealmEscort._log(g, world, `${men} men of ${Names.realm(kingdom.name)}'s army ride out to join you.`);
        return { men: drawn.length, strength: men, units: drawn.length, guard: g };
    },

    /** Companies the rank's spec lacks that the guard has not got (by type). */
    _missing(player, g) {
        const want = RealmEscort.spec(g.rank, g.extra);
        const have = {};
        for (const u of RealmEscort.units(player, g.kingdomId)) have[u.type] = _num(have[u.type]) + 1;
        const out = {};
        for (const [t, n] of Object.entries(want)) if (_num(n) > _num(have[t])) out[t] = _num(n) - _num(have[t]);
        return out;
    },

    /** Send companies above the rank's spec home (a fall in rank). → men sent home */
    _trim(player, world, g, kingdom) {
        const want = RealmEscort.spec(g.rank, g.extra);
        const seen = {};
        let men = 0;
        for (const u of RealmEscort.units(player, g.kingdomId)) {
            seen[u.type] = _num(seen[u.type]) + 1;
            if (seen[u.type] <= _num(want[u.type])) continue;
            men += RealmEscort._release(player, kingdom, u);
        }
        g.men = RealmEscort.men(player, g.kingdomId);
        return men;
    },

    /** A company leaves the player's army for the realm's: its men back to kingdom.military, its arms to the armoury. */
    _release(player, kingdom, unit) {
        const i = player.army.indexOf(unit);
        if (i >= 0) player.army.splice(i, 1);
        if (!kingdom || kingdom.isAlive === false) return 0;
        RealmEscort._disarm(kingdom, unit);
        kingdom.military = Math.max(0, _num(kingdom.military)) + _num(unit.strength);
        return _num(unit.strength);
    },

    /**
     * The escort ends (why: 'title', 'exile', 'turned', 'fallen', 'home',
     * 'deserted', 'another', 'loyal', 'treason'): the survivors ride home to
     * the realm's army with their arms (opts.lostShare of them cut down
     * first, as in a crushed coup), what the crown owes them becomes its
     * army's arrears, the coin in their pockets goes home to the capital.
     */
    end(player, world, why, out = null, opts = {}) {
        const st = RealmEscort.state(player);
        const g = st && st.guard;
        if (!g) return null;
        const k = _kingdom(world, g.kingdomId);
        const alive = k && k.isAlive !== false;
        const units = RealmEscort.units(player, g.kingdomId);
        // (a guard of another realm somehow left behind goes too)
        const lostShare = _clamp(_num(opts.lostShare), 0, 1);
        let home = 0;
        let lost = 0;
        units.forEach((u, i) => {
            if (lostShare > 0 && i < Math.round(units.length * lostShare)) {
                const j = player.army.indexOf(u);
                if (j >= 0) player.army.splice(j, 1);
                lost += _num(u.strength);
                return;
            }
            home += RealmEscort._release(player, alive ? k : null, u);
        });
        if (alive) {
            if (_num(g.owed) > 0 && CrownBooks.enabled()) {
                const f = CrownBooks.state(k);
                f.arrears.army = _r2(_num(f.arrears.army) + _num(g.owed));
            }
            if (_num(g.pockets) > 0) CrownBooks.spendAtCapital(world, k, g.pockets);
        }
        g.record.fallen = _num(g.record.fallen) + lost;
        st.past.unshift({ kingdomId: g.kingdomId, kingdomName: g.kingdomName, rank: g.rank, since: g.since, ended: _day(world), why, record: { ...g.record } });
        if (st.past.length > 8) st.past.length = 8;
        st.guard = null;
        if (why === 'home') st.home[g.kingdomId] = _day(world) + _num((RealmEscort.config().sendHome || {}).days, 60);
        // A guard that starved or went unpaid until the last man slipped away is
        // not sent again the next morning, drawn afresh from the army and armed
        // out of the armoury at the crown's cost (asked for, it still comes)
        else if (why === 'deserted') st.home[g.kingdomId] = _day(world) + _num((RealmEscort.config().deserted || {}).days, 45);
        const R = RealmEscort.rankDef(g.rank) || {};
        const text = {
            title: `You hold no rank in ${g.kingdomName} now: its ${R.label || 'guard'} rides home to the realm's army.`,
            exile: `Exiled from ${g.kingdomName}, you lose its ${R.label || 'guard'}: the men ride home.`,
            turned: `You have turned against ${g.kingdomName}: its ${R.label || 'guard'} will not ride with you, and goes home.`,
            fallen: `${g.kingdomName} is no more: its ${R.label || 'guard'} scatters.`,
            home: `You send the ${R.label || 'guard'} of ${g.kingdomName} home: ${home} men ride back to the realm's army.`,
            deserted: `The last of the ${R.label || 'guard'} of ${g.kingdomName} has slipped away, unpaid.`,
            another: `The ${R.label || 'guard'} of ${g.kingdomName} rides home: another realm's men ride with you now.`,
            loyal: `The ${R.label || 'guard'} of ${g.kingdomName} stood with the old crown and is gone.`,
            treason: `The ${R.label || 'guard'} of ${g.kingdomName} is broken with your coup${lost ? `: ${lost} of them cut down` : ''}.`,
        }[why] || `The ${R.label || 'guard'} of ${g.kingdomName} rides home.`;
        if (out && out.notices) out.notices.push({ icon: '🛡️', title: 'Household Guard', text, type: why === 'home' ? 'info' : 'warning' });
        return { why, home, lost, text };
    },

    // ── The player's choices ────────────────────────

    /** Send the guard home (it is not sent again unasked for a while). */
    sendHome(player, world) {
        if (!RealmEscort.guard(player)) return { success: false, reason: 'No guard rides with you.' };
        const r = RealmEscort.end(player, world, 'home', null);
        return { success: true, message: r.text };
    },

    /**
     * Ask the crown for more men (or for a guard back, or at all): the realm
     * must spare them (its army, its share cap) and afford them (its
     * treasury after, past its reserve); a subject pays in standing with
     * the realm (reputation), a ruler only in the treasury. → { ok, reason }
     * and, done, { success, message }.
     */
    askOdds(player, world) {
        const s = RealmEscort.standing(player, world);
        if (!s) return { ok: false, reason: 'You hold no rank in a realm that would keep a guard for you.' };
        const k = s.kingdom;
        const A = RealmEscort.config().ask || {};
        const g = RealmEscort.guard(player);
        const R = RealmEscort.rankDef(s.rank) || {};
        const sub = s.rank !== 'crown';
        if (g && _same(g.kingdomId, k.id) && _day(world) - _num(g.lastAsk, -1e9) < _num(A.cooldownDays, 20)) return { ok: false, reason: 'You asked lately. The crown will not be pestered.' };
        let add;
        if (!g || !_same(g.kingdomId, k.id)) add = RealmEscort.spec(s.rank, 0);
        else {
            const miss = RealmEscort._missing(player, g);
            if (Object.keys(miss).length) add = miss;
            else if (_num(g.extra) < _num(R.extra, 0) && R.extraUnit) add = { [R.extraUnit]: 1 };
            else return { ok: false, reason: `${k.name} will spare no more men for a ${s.rank === 'crown' ? 'royal' : 'lord\'s'} guard.` };
        }
        let men = 0, wage = 0;
        for (const [t, n] of Object.entries(add)) {
            const def = PlayerMilitary.getUnitDef(t);
            if (!def) continue;
            men += _num(def.strength) * n;
            wage += _num(def.upkeep) * n;
        }
        wage *= _num((RealmEscort.config().pay || {}).mult, 1);
        const room = RealmEscort.cap(k, s.rank, g ? g.men : 0) - RealmEscort.men(player, k.id);
        if (men > room) return { ok: false, reason: `${k.name}'s army (${Math.floor(_num(k.military))} men) cannot spare ${men} more for your guard.` };
        const totalWage = RealmEscort.wage(player, k.id) + wage;
        const reserve = _num(A.reserveBase, 300) + _num(A.reserveDays, 30) * totalWage;
        if (_num(k.treasury) < reserve) return { ok: false, reason: `The treasury of ${Names.realm(k.name)} is too poor to keep more men (${Math.floor(_num(k.treasury))}g; it would want ${Math.round(reserve)}g in hand).` };
        const cost = sub ? _num(A.reputation, 8) : 0;
        const rep = _num(player.reputation && player.reputation[k.id]);
        if (sub && rep - cost < _num(A.minReputation, 10)) return { ok: false, reason: `Your standing with ${Names.realm(k.name)} (${Math.round(rep)}) is too low to ask the crown for more.` };
        return { ok: true, kingdom: k, rank: s.rank, add, men, wage: _r2(wage), cost };
    },

    ask(player, world) {
        const o = RealmEscort.askOdds(player, world);
        if (!o.ok) return { success: false, reason: o.reason };
        const k = o.kingdom;
        const st = RealmEscort.state(player);
        const had = RealmEscort.guard(player);
        delete st.home[k.id];
        const wasExtra = had && _same(had.kingdomId, k.id) && !Object.keys(RealmEscort._missing(player, had)).length;
        const r = RealmEscort.raise(player, world, k, o.rank, had ? o.add : null);
        if (r.guard && !RealmEscort.men(player, k.id)) st.guard = null;
        if (!r.strength) return { success: false, reason: `${k.name} has no men to spare.` };
        if (wasExtra && r.guard) r.guard.extra = _num(r.guard.extra) + 1;
        if (r.guard) r.guard.lastAsk = _day(world);
        if (o.cost > 0) {
            if (!player.reputation) player.reputation = {};
            player.reputation[k.id] = _num(player.reputation[k.id]) - o.cost;
        }
        return { success: true, message: `${k.name} sends ${r.strength} more men to your ${(RealmEscort.rankDef(o.rank) || {}).label || 'guard'}${o.cost ? ` (−${o.cost} standing with the crown)` : ''}.` };
    },

    // ── The coup ────────────────────────────────────

    /**
     * A general turns the host on `kid`'s crown: the guard of that realm
     * riding with them joins the coup if loyal enough, else stands with the
     * crown. → { men, joins, loyalty }
     */
    coupSide(player, kid) {
        const g = RealmEscort.guard(player);
        const men = RealmEscort.men(player, kid);
        if (!g || !_same(g.kingdomId, kid) || !men) return { men: 0, joins: false, loyalty: 0 };
        const at = _num((RealmEscort.config().loyalty || {}).coupJoinAt, 60);
        return { men, joins: _num(g.loyalty) >= at, loyalty: Math.round(_num(g.loyalty)) };
    },

    // ── Battles ─────────────────────────────────────

    /** A battle the guard fought in is over (any of the player's battles): morale and loyalty. */
    afterBattle(player, victory) {
        const g = RealmEscort.guard(player);
        if (!g) return;
        const M = RealmEscort.config().morale || {};
        const L = RealmEscort.config().loyalty || {};
        g.record.battles = _num(g.record.battles) + 1;
        if (victory) {
            g.record.won = _num(g.record.won) + 1;
            g.morale = _clamp(_num(g.morale) + _num(M.victory, 6), 0, 100);
            g.loyalty = _clamp(_num(g.loyalty) + _num(L.victory, 3), 0, 100);
        } else {
            g.morale = _clamp(_num(g.morale) + _num(M.defeat, -10), 0, 100);
        }
    },

    // ── The day ─────────────────────────────────────

    /** A shooter's quiver topped up out of the armoury (in a town of the realm). */
    _refillQuivers(player, k) {
        const stock = RealmArms.state(k).stock;
        for (const u of RealmEscort.units(player, k.id)) {
            const good = Arms.ammoGood(u);
            if (!good) continue;
            const want = Arms.quiverOf(u).quiver - Math.floor(_num(u.ammo));
            const got = Math.min(Math.max(0, want), Math.floor(_num(stock[good])));
            if (!(got > 0)) continue;
            stock[good] = _r2(_num(stock[good]) - got);
            u.ammo = _num(u.ammo) + got;
        }
    },

    /** Bread for the guard from the settlement's granary, the crown paying the town (as a general's host). */
    _feed(player, world, g, k, s) {
        const S = RealmEscort.config().supply || {};
        if (!s) return 0;
        if (!s.economy && _num(s.population) > 0) Economy.initSettlement(s);
        if (!s.economy) return 0;
        const need = g.men * _num(S.perMan, 0.02);
        const want = Math.max(0, need * _num(S.topUpDays, 10) - _num(g.supplies));
        const price = _num(S.foodPrice, 1.2);
        let take = Math.min(want, Math.max(0, _num(s.economy.food)) * _num(S.maxTownShare, 0.2), Math.max(0, _num(k.treasury)) / price);
        take = Math.floor(take * 100) / 100;
        if (!(take > 0)) return 0;
        const cost = _r2(take * price);
        k.treasury = _r2(_num(k.treasury) - cost);
        CrownBooks.note(k, 'guard', cost);
        s.economy.food = _r2(_num(s.economy.food) - take);
        Economy.payTown(s, cost);
        g.supplies = _r2(_num(g.supplies) + take);
        g.record.fed = _r2(_num(g.record.fed) + cost);
        return take;
    },

    /** Unpaid or starving men slip away: the last companies first, their arms with them. → men gone */
    _desert(player, g, share) {
        const units = RealmEscort.units(player, g.kingdomId);
        const n = Math.max(1, Math.round(units.length * share));
        let men = 0;
        for (const u of units.slice(-n)) {
            const i = player.army.indexOf(u);
            if (i >= 0) player.army.splice(i, 1);
            men += _num(u.strength);
        }
        g.record.deserted = _num(g.record.deserted) + men;
        return men;
    },

    /**
     * The day (PlayerActions.endDay): who rates a guard, the guard sent or
     * recalled, its losses counted, its pay and bread, its morale and loyalty,
     * desertion. → { notices }
     */
    processDay(player, world) {
        const out = { notices: [] };
        if (!player || !world || !RealmEscort.enabled()) return out;
        const st = RealmEscort.state(player);
        const day = _day(world);
        const s = RealmEscort.standing(player, world);
        let g = st.guard;

        // Companies of a realm no longer riding with you go home
        for (const u of RealmEscort.units(player)) {
            if (g && _same(u.realmGuard, g.kingdomId)) continue;
            RealmEscort._release(player, _kingdom(world, u.realmGuard), u);
        }

        // The guard leaves with the rank
        if (g) {
            const k = _kingdom(world, g.kingdomId);
            let why = null;
            if (!k || k.isAlive === false) why = 'fallen';
            else if (Throne.isExiledFrom(player, world, k.id)) why = 'exile';
            else if (RealmWars.atWarWith(player, k.id)) why = 'turned';
            else if (!s) why = player.allegiance != null && !_same(player.allegiance, k.id) ? 'turned' : 'title';
            else if (!_same(s.kingdom.id, k.id)) why = 'another';
            if (why) {
                RealmEscort.end(player, world, why, out);
                g = null;
            } else if (s.rank !== g.rank) {
                const up = RANKS.indexOf(s.rank) > RANKS.indexOf(g.rank);
                g.rank = s.rank;
                g.extra = 0;
                const R = RealmEscort.rankDef(s.rank) || {};
                if (up) {
                    const r = RealmEscort.raise(player, world, k, s.rank, RealmEscort._missing(player, g));
                    out.notices.push({ icon: '🛡️', title: R.label || 'Household Guard', text: `Your rank in ${Names.realm(k.name)} has risen: your guard is now its ${R.label || 'guard'}${r.strength ? `, ${r.strength} more men riding out to join it` : ''}.`, type: 'success' });
                } else {
                    const home = RealmEscort._trim(player, world, g, k);
                    out.notices.push({ icon: '🛡️', title: R.label || 'Household Guard', text: `Your rank in ${Names.realm(k.name)} has fallen: your guard is cut to a ${String(R.label || 'guard').toLowerCase()}${home ? ` and ${home} men ride home` : ''}.`, type: 'warning' });
                }
            }
        }

        // A rank with no guard: the realm sends one (unless it was sent home lately)
        if (!g && s && !(_num(st.home[s.kingdom.id], -1) > day)) {
            const r = RealmEscort.raise(player, world, s.kingdom, s.rank);
            g = r.guard;
            if (g && r.strength > 0) {
                const R = RealmEscort.rankDef(s.rank) || {};
                out.notices.push({ icon: '🛡️', title: R.label || 'Household Guard', text: `As ${s.why}, ${s.kingdom.name} sends ${r.strength} of its soldiers to ride with you: ${R.blurb || 'a guard'}, paid and fed by the crown.`, type: 'success' });
            } else if (g && !RealmEscort.men(player, g.kingdomId)) {
                // (the realm has no men to spare: nothing rides out)
                st.guard = null;
                g = null;
            }
        }
        if (!g) return out;
        const k = _kingdom(world, g.kingdomId);
        const C = RealmEscort.config();
        const M = C.morale || {};
        const L = C.loyalty || {};
        const P = C.pay || {};
        const A = C.arrears || {};

        // The fallen: companies gone from the army since yesterday (battles took them; their arms with them)
        const now = RealmEscort.men(player, g.kingdomId);
        if (now < _num(g.men)) {
            const lost = _num(g.men) - now;
            g.record.fallen = _num(g.record.fallen) + lost;
            RealmEscort._log(g, world, `${lost} of the guard lost.`);
        }
        g.men = now;
        if (!now) {
            RealmEscort.end(player, world, 'fallen', out);
            return out;
        }

        // A lost company replaced now and then, while the realm can spare it and the treasury pays
        const RF = C.refill || {};
        if (day - _num(g.lastRefill) >= _num(RF.days, 30)) {
            g.lastRefill = day;
            const miss = RealmEscort._missing(player, g);
            const t = Object.keys(miss)[0];
            if (t && g.arrearsDays === 0 && _num(k.treasury) > _num((C.ask || {}).reserveBase, 300)) {
                const r = RealmEscort.raise(player, world, k, g.rank, { [t]: 1 });
                if (r.strength) out.notices.push({ icon: '🛡️', title: 'Fresh Men', text: `${k.name} sends ${r.strength} men to fill the gaps in your guard.`, type: 'info' });
            }
        }

        // Wages: owed daily, paid out of the treasury into the men's pockets
        const wage = RealmEscort.wage(player, g.kingdomId);
        g.owed = _r2(_num(g.owed) + wage);
        const paid = Math.max(0, Math.min(g.owed, Math.floor(_num(k.treasury) * 100) / 100));
        if (paid > 0) {
            k.treasury = _r2(_num(k.treasury) - paid);
            CrownBooks.note(k, 'guard', paid);
            g.owed = _r2(g.owed - paid);
            g.pockets = _r2(_num(g.pockets) + paid);
            g.record.paid = _r2(_num(g.record.paid) + paid);
        }
        if (g.owed > wage + 0.01) {
            g.arrearsDays = _num(g.arrearsDays) + 1;
            g.morale = _clamp(_num(g.morale) + _num(M.arrearsMorale, -3), 0, 100);
            if (g.arrearsDays === 1) out.notices.push({ icon: '💰', title: 'The Guard Goes Unpaid', text: `The treasury of ${Names.realm(k.name)} cannot pay your guard (${Math.round(g.owed)}g owed). Unpaid for a week, they will slip away.`, type: 'warning' });
        } else g.arrearsDays = 0;

        // The men spend their pay where they lodge
        const here = typeof world.getTile === 'function' ? world.getTile(player.q, player.r) : null;
        const town = here && here.settlement;
        if (town && _num(g.pockets) > 0) {
            const spend = _r2(_num(g.pockets) * _clamp(_num(P.spendShare, 0.5), 0, 1));
            if (spend > 0) g.pockets = _r2(_num(g.pockets) - Economy.payTown(town, spend));
        }

        // Bread: carried, topped up from a town's granary at the crown's cost
        const S = C.supply || {};
        const need = g.men * _num(S.perMan, 0.02);
        if (town && _num(g.supplies) < need * _num(S.topUpDays, 10) / 2) RealmEscort._feed(player, world, g, k, town);
        if (town && _same(town.kingdom, k.id)) RealmEscort._refillQuivers(player, k);
        let hungry = false;
        if (_num(g.supplies) >= need) g.supplies = _r2(_num(g.supplies) - need);
        else {
            hungry = true;
            g.supplies = 0;
            g.morale = _clamp(_num(g.morale) + _num(S.hungerMorale, -5), 0, 100);
        }

        // Morale drifts home; loyalty grows with service
        if (!hungry && !(g.arrearsDays > 0)) g.morale = _clamp(_num(g.morale) + (_num(M.base, 65) - _num(g.morale)) * _num(M.drift, 0.06), 0, 100);
        if (!(g.arrearsDays > 0)) g.loyalty = Math.min(_num(L.max, 85), _num(g.loyalty) + _num(L.perDay, 0.08));

        // Desertion: unpaid past the grace, starving, or with morale gone
        let gone = 0;
        if (g.arrearsDays > _num(A.graceDays, 7)) gone += RealmEscort._desert(player, g, _num(A.desertRate, 0.15));
        else if (hungry && _num(g.morale) < _num(M.desertBelow, 25)) gone += RealmEscort._desert(player, g, _num(S.hungerDesert, 0.03));
        else if (_num(g.morale) < _num(M.desertBelow, 25) && day % 7 === 0) gone += RealmEscort._desert(player, g, 0.1);
        if (gone) {
            out.notices.push({ icon: '🏳️', title: 'Desertion', text: `${gone} men of your guard slip away${g.arrearsDays > 0 ? ', unpaid' : ''}.`, type: 'warning' });
            RealmEscort._log(g, world, `${gone} men deserted.`);
        }
        g.men = RealmEscort.men(player, g.kingdomId);
        if (!g.men) RealmEscort.end(player, world, 'deserted', out);
        return out;
    },

    // ── For the panels ──────────────────────────────

    view(player, world) {
        const g = RealmEscort.guard(player);
        const s = RealmEscort.standing(player, world);
        const st = RealmEscort.state(player);
        const k = g ? _kingdom(world, g.kingdomId) : (s ? s.kingdom : null);
        const units = g ? RealmEscort.units(player, g.kingdomId) : [];
        return {
            guard: g, standing: s, kingdom: k,
            rank: g ? RealmEscort.rankDef(g.rank) : (s ? RealmEscort.rankDef(s.rank) : null),
            units: units.map(u => ({ type: u.type, name: u.name, icon: u.icon, strength: _num(u.strength), wage: _num(u.crownWage), kit: Arms.kitLabel(u), ammo: u.ammo })),
            men: g ? RealmEscort.men(player, g.kingdomId) : 0,
            wage: g ? RealmEscort.wage(player, g.kingdomId) : 0,
            supplyDays: g && g.men ? Math.floor(_num(g.supplies) / Math.max(0.01, g.men * _num((RealmEscort.config().supply || {}).perMan, 0.02))) : 0,
            ask: RealmEscort.askOdds(player, world),
            homeUntil: k ? _num(st.home[k.id], 0) : 0,
            past: st.past.slice(),
        };
    },

    /** One line for the HUD: "Royal Guard of Avaria: 86 men, paid by the crown" ('' without a guard). */
    hudLine(player) {
        const g = RealmEscort.guard(player);
        if (!g) return '';
        const R = RealmEscort.rankDef(g.rank) || {};
        return `${R.label || 'Household guard'} of ${g.kingdomName}: ${RealmEscort.men(player, g.kingdomId)} men, paid by the crown${g.arrearsDays > 0 ? ` (unpaid ${g.arrearsDays} days)` : ''}`;
    },
};
