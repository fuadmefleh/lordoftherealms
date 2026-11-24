// ============================================
// PRISONER FATES — No quarter: what becomes of the men you beat
// ============================================
// A won battle against a band of men (a realm's war host or patrol; raiders,
// pirates, sellswords, smugglers) leaves captives: a COLUMN on
// player.prisonerFates.pending until you give your word (the 'captives'
// choice scene, ui/actionMenu/prisonerFates.js; walked away from, your
// captains settle it the next day with the merciful default).
//
//   THE KNIGHTS  a realm's column has its men of rank: captains, knights, a
//                lord (Interrogation.addPow — they lie in The Dungeon). Open
//                RANSOM TALKS (a price named, a herald, an answer days later:
//                agreed and paid out of their realm's treasury, a counter-offer
//                to take or press, a refusal), keep them in the dungeon, or let
//                them share the men's fate. Unpaid, a knight rots in your cells
//                (he may die there) or is SOLD to a crown hostile to his.
//   THE MEN      SERVICE: real companies in your army (turncoats: low loyalty
//                that grows, desertion home to their realm when it runs low or
//                you war on it). OATH: sent home sworn not to bear arms against
//                you; their crown may keep them home or march them anyway, and
//                oath-breakers met in battle are found out and remembered.
//                RELEASE: home disarmed. CUT THEM DOWN: their realm (or the
//                outlaws) fights to the death against you for months. BLIND
//                (Basil II, 1014): the column walks home on the world map, one
//                in a hundred left an eye to lead; the realm it comes into loses
//                heart (morale, no new war hosts, war will); every faith hates
//                you. IMPALE (Vlad): stakes along the road into your realm,
//                drawn on the world map and rotting over months; war hosts may
//                turn back from them and crowns not march, your name a tale in
//                every capital, your own lords cowed. Outlaws: HANG (the road's
//                law: the nearest town's thieves cowed), service, release, cut
//                down, impale.
//   YOUR MEN     beaten by a realm, some of your fallen are taken alive; its
//                lord decides their fate (his traits, and what you did to his
//                men): a ransom out of your purse, home in a week, into his
//                army, or killed — and your men want vengeance.
//   THE REALMS   their own battles leave captives too (world.captivesFeed,
//                from KingdomAI.simulateBattle): ransoms between treasuries,
//                men taken into service, slaughter, now and then a blinding or
//                stakes of their own.
//
// Every consequence is read elsewhere: Atrocities' butcher (terms and ransoms
// open to a dreaded name) and perfidy (towns refuse to surrender), karma and
// Traits, the realms' regard (RealmWars hostility, Fame), the lords' memory
// (data/lordMemory.json pow_*), the faiths' standing (Devotion), gossip, the
// House chronicle, the war score, your court's vassals (cowed, grudges), the
// enemy's spirit in battle (foeSpirit → PlayerMilitary.combat, FieldBattle),
// kingdom.captivity and world.prisonerFates (world/warStakes.js, read by
// KingdomAI and RealmWars), Nemesis.
//
// State: player.prisonerFates (saved, SaveLoad EXTRA_PLAYER_FIELDS); the
// stakes and columns on world.prisonerFates (saved with the world). Rolls are
// hashes of the world seed (no shared dice). Tuning: data/prisonerFates.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { Names } from '../core/names.js';
import { NPCLords } from '../world/npcLords.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { WarStakes } from '../world/warStakes.js';
import { Interrogation } from '../systems/interrogation.js';
import { Atrocities } from '../systems/atrocities.js';
import { Traits } from '../systems/traits.js';
import { House } from '../systems/house.js';
import { Gossip } from '../systems/gossip.js';
import { Devotion } from '../systems/devotion.js';
import { MaimFaith } from '../systems/maimFaith.js';
import { Kingship } from '../systems/kingship.js';
import { RealmWars } from '../systems/realmWars.js';
import { Nemesis } from '../systems/nemesis.js';
import { Ledger } from '../systems/ledger.js';
import { PlayerMilitary } from './playerMilitary/_ref.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = (world) => _num(world && world.day);
const _seed = (world) => (world && world.generationParams && world.generationParams.seed) || 0;
const _cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const _plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** 0..1, fixed for a key in this world (no shared stream). */
function _roll(world, key) {
    return ((Utils.hashStr(`${_seed(world)}|captives|${key}`) >>> 0) % 100000) / 100000;
}

/** A weighted pick by a hash roll: weights { id: w }. */
function _pick(world, key, weights) {
    const ids = Object.keys(weights).filter(k => _num(weights[k]) > 0).sort();
    const total = ids.reduce((t, k) => t + _num(weights[k]), 0);
    if (!ids.length || total <= 0) return null;
    let x = _roll(world, key) * total;
    for (const k of ids) { x -= _num(weights[k]); if (x < 0) return k; }
    return ids[ids.length - 1];
}

function _kingdom(world, id) {
    if (id == null || !world) return null;
    const k = typeof world.getKingdom === 'function' ? world.getKingdom(id) : (world.kingdoms || []).find(x => x && String(x.id) === String(id));
    return k && k.isAlive !== false ? k : null;
}

function _dist(world, q1, r1, q2, r2) {
    return Hex.wrappingDistance(q1, r1, q2, r2, (world && world.width) || 0);
}

function _lordTraits(k) {
    const t = k && k.lord && Array.isArray(k.lord.traits) ? k.lord.traits : [];
    return t.map(x => (x && x.id) || x).filter(Boolean);
}

const REALM_FATES = ['service', 'oath', 'release', 'slaughter', 'blind', 'impale'];
const OUTLAW_FATES = ['hang', 'service', 'release', 'slaughter', 'impale'];

const FATE_TEXT = {
    service: { icon: '🛡️', label: 'Take them into your service', hint: 'Real companies in your army, on low loyalty: they may desert home, more so near their realm or at war with it' },
    oath: { icon: '🕊️', label: 'Release them on oath', hint: 'Home, sworn not to bear arms against you. Their crown may keep them home, or march them anyway' },
    release: { icon: '🚶', label: 'Send them home disarmed', hint: 'No oath asked: home to their realm, and some thanks for it' },
    slaughter: { icon: '⚔️', label: 'Cut them down', hint: 'No quarter. Their kin will fight to the death against you for months; broken faith; the lords remember' },
    blind: { icon: '👁️', label: 'Blind them and send them home', hint: 'One in a hundred keeps an eye to lead them. The realm that sees the column loses heart; every faith hates you' },
    impale: { icon: '☠️', label: 'Impale them along the road', hint: 'A forest of stakes on the road into your realm. Invaders may turn back; your name a tale everywhere; your own lords fear you' },
    hang: { icon: '🪢', label: 'Hang them by the road', hint: 'The road\'s law: the nearest town\'s thieves are cowed; outlaws fight harder against you a while' },
};

let _cfg = null;
let _cfgSrc;

export const PrisonerFates = {
    REALM_FATES,
    OUTLAW_FATES,
    FATE_TEXT,

    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.prisonerFates : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            const out = {};
            for (const k of ['capture', 'service', 'oath', 'ransom', 'slaughter', 'blind', 'impale', 'outlaws', 'yourMen', 'ai']) out[k] = { ...(_obj(d[k]) || {}) };
            out.history = _num(d.history, 40);
            _cfg = out;
        }
        return _cfg;
    },

    // ── State ───────────────────────────────────────────────────

    _blank() {
        return {
            v: 1, nextId: 1, pending: null, oaths: [], held: [], noQuarter: {}, vengeance: {}, wrongs: {}, history: [],
            stats: { columns: 0, ransomed: 0, ransomGold: 0, sold: 0, rotted: 0, served: 0, deserted: 0, sworn: 0, released: 0, slain: 0, blinded: 0, impaled: 0, hanged: 0, oathsBroken: 0, menLost: 0, menBought: 0 },
        };
    },

    /** player.prisonerFates, created on demand. */
    state(player) {
        if (!player) return null;
        if (!_obj(player.prisonerFates)) player.prisonerFates = PrisonerFates._blank();
        const st = player.prisonerFates;
        const b = PrisonerFates._blank();
        for (const k of ['oaths', 'held', 'history']) if (!Array.isArray(st[k])) st[k] = [];
        for (const k of ['noQuarter', 'vengeance', 'wrongs']) if (!_obj(st[k])) st[k] = {};
        if (!_obj(st.pending)) st.pending = null;
        st.nextId = Math.max(1, _num(st.nextId, 1));
        st.stats = { ...b.stats, ...(_obj(st.stats) || {}) };
        return st;
    },

    loadState(player) { if (player && player.prisonerFates) PrisonerFates.state(player); },

    serializeWorld(world) {
        return world && _obj(world.prisonerFates) ? JSON.parse(JSON.stringify({ ...world.prisonerFates, feedDay: undefined })) : null;
    },

    restoreWorld(saved, world) {
        if (!world) return;
        world.prisonerFates = _obj(saved) ? JSON.parse(JSON.stringify(saved)) : undefined;
        if (world.prisonerFates) WarStakes.state(world);
        if (!Array.isArray(world.captivesFeed)) world.captivesFeed = [];
    },

    _history(player, world, fate, text, extra = {}) {
        const st = PrisonerFates.state(player);
        st.history.unshift({ day: _day(world), fate, text, ...extra });
        if (st.history.length > PrisonerFates.config().history) st.history.length = PrisonerFates.config().history;
    },

    _by(player) { return (player && player.house && player.house.name) || (player && player.name) || 'a lord'; },

    // ── The enemy's spirit in battle ────────────────────────────

    /** The realm of a world unit (war hosts carry kingdomId, patrols kingdom), or null. */
    unitRealm(unit) {
        if (!unit) return null;
        return unit.kingdomId != null ? unit.kingdomId : unit.kingdom != null ? unit.kingdom : null;
    },

    /** Could a beaten `unit` leave captives? → 'realm' | 'outlaw' | null. */
    kindOf(unit, world = null) {
        const C = PrisonerFates.config().capture;
        if (!unit || !(C.types || []).includes(unit.type)) return null;
        const kid = PrisonerFates.unitRealm(unit);
        if (kid != null && (!world || _kingdom(world, kid))) return 'realm';
        if ((C.outlawTypes || []).includes(unit.type)) return 'outlaw';
        return null;
    },

    _quarterKey(unit) {
        const kid = PrisonerFates.unitRealm(unit);
        return kid != null ? String(kid) : 'outlaws';
    },

    /**
     * How the men of `unit` fight you today: { noRout, moraleBonus, power,
     * casualtyMult, oathBreakers, text }. noRout — you gave their kin no
     * quarter: they do not break and run; oath-breakers among them shame them
     * and anger your men; vengeance for your own men they killed.
     */
    foeSpirit(player, world, unit) {
        const out = { noRout: false, moraleBonus: 0, power: 1, casualtyMult: 1, oathBreakers: 0, text: '' };
        if (!player || !unit) return out;
        // (no record yet: nothing you did to anyone's men, but a realm may still have lost heart)
        const st = player.prisonerFates ? PrisonerFates.state(player) : PrisonerFates._blank();
        const day = _day(world);
        const S = PrisonerFates.config().slaughter;
        const O = PrisonerFates.config().oath;
        const Y = PrisonerFates.config().yourMen;
        const kind = PrisonerFates.kindOf(unit, world);
        if (!kind) return out;
        if (_num(st.noQuarter[PrisonerFates._quarterKey(unit)]) > day) {
            out.noRout = true;
            out.moraleBonus += _num(S.moraleBonus, 0.12);
            out.casualtyMult *= _num(S.casualtyMult, 1.2);
            out.text = 'They know you give no quarter: they will fight to the last man.';
        }
        if (_num(unit.oathBreakers) > 0) {
            out.oathBreakers = _num(unit.oathBreakers);
            out.moraleBonus += _num(O.shameMorale, -0.08);
            out.power *= 1 + _num(O.angerPower, 0.08);
            out.text = `${out.text ? `${out.text} ` : ''}Men you freed on their oath march in their ranks: yours are angry, and they ashamed.`;
        }
        const kid = PrisonerFates.unitRealm(unit);
        if (kid != null && _num(st.vengeance[kid]) > day) out.power *= 1 + _num(Y.vengeancePower, 0.06);
        // A realm whose blinded army came home fights with less heart (world/warStakes.js)
        const dismay = WarStakes.dismay(_kingdom(world, kid), day);
        if (dismay > 0) out.moraleBonus -= dismay;
        return out;
    },

    // ── After a battle ──────────────────────────────────────────

    /**
     * A battle with a world unit is over (PlayerMilitary.attackUnit): oath-
     * breakers found out; won, the captives taken (a column awaiting your
     * word); lost to a realm, some of your fallen taken alive.
     * → { column, oathText, takenText } (any of them null).
     */
    afterBattle(player, world, unit, result) {
        const out = { column: null, oathText: null, takenText: null };
        if (!player || !world || !unit || !result || result.noArmy || result.withdrew) return out;
        const kind = PrisonerFates.kindOf(unit, world);
        if (!kind) return out;
        const breakers = _num(unit.oathBreakers);
        if (breakers > 0) out.oathText = PrisonerFates._revealOath(player, world, unit);
        if (result.victory) out.column = PrisonerFates.capture(player, world, unit, result, { oathBreakers: breakers });
        else if (kind === 'realm' && !result.captured && result.theatre !== 'sea') out.takenText = PrisonerFates._yourMenTaken(player, world, unit, result);
        return out;
    },

    /** Take the beaten band's survivors captive: the column, set pending. → it, or null. */
    capture(player, world, unit, result = {}, opts = {}) {
        const C = PrisonerFates.config().capture;
        const kind = PrisonerFates.kindOf(unit, world);
        if (!kind) return null;
        const st = PrisonerFates.state(player);
        const day = _day(world);
        const spirit = PrisonerFates.foeSpirit(player, world, unit);
        const survivors = result.enemyRemaining != null ? _num(result.enemyRemaining) : _num(result.enemyStrength, _num(unit.strength)) * _num(C.survivors, 0.4);
        const routed = result.tactics && result.tactics.moraleBreak === 'enemy';
        const share = spirit.noRout ? _num(C.lastStandShare, 0.08) : routed ? _num(C.routShare, 0.6) : _num(C.share, 0.4);
        const strength = Math.round(Math.max(0, survivors) * share);
        if (strength < _num(C.minStrength, 3)) return null;
        // A column already awaiting your word is settled first (your captains' default)
        if (st.pending) PrisonerFates.settleDefault(player, world);
        const kid = kind === 'realm' ? PrisonerFates.unitRealm(unit) : null;
        const k = _kingdom(world, kid);
        const men = Math.max(1, Math.round(strength * _num(C.menPerStrength, 2)));
        const col = {
            id: st.nextId++, day, q: _num(unit.q, _num(player.q)), r: _num(unit.r, _num(player.r)), kingdomId: kid,
            realm: k ? Names.realm(k.name) : null, outlaw: kind === 'outlaw', name: unit.name || (kind === 'outlaw' ? 'outlaws' : 'soldiers'),
            unitType: unit.type, men, strength, nobles: [], noblesDone: true, nobleShare: 0,
            oathBreakers: 0, oathDone: true,
            sea: result.theatre === 'sea',
        };
        // The men of rank: the dungeon's prisoner taken today (FieldBattle.finish) and more, by the host's size
        if (k && Interrogation.enabled()) {
            const ist = Interrogation.state(player);
            const claimed = ist.pows.filter(w => w && w.day === day && String(w.kingdomId) === String(kid) && w.column == null);
            const want = strength >= _num(C.knightFrom, 15) ? Math.min(_num(C.maxKnights, 4), 1 + Math.floor(strength / Math.max(1, _num(C.knightPer, 50)))) : 0;
            const list = claimed.slice(0, Math.max(claimed.length, want));
            for (let i = list.length; i < want; i++) {
                const w = Interrogation.addPow(player, world, { kingdomId: kid, strength: i === 0 ? strength : Math.min(strength, 39), how: 'in the field', rank: i === 0 ? null : (i % 2 ? 'knight' : 'captain') });
                if (w) list.push(w);
            }
            for (const w of list) { w.column = col.id; col.nobles.push(w.id); }
            col.noblesDone = !col.nobles.length;
        }
        // (oath-breakers found among them: their share of the captives)
        const breakers = Math.min(men, Math.round(_num(opts.oathBreakers != null ? opts.oathBreakers : unit.oathBreakers) * share));
        if (breakers > 0) { col.oathBreakers = breakers; col.oathDone = false; }
        st.pending = col;
        st.stats.columns++;
        return col;
    },

    pending(player) {
        return player && player.prisonerFates && player.prisonerFates.pending ? player.prisonerFates.pending : null;
    },

    _nobles(player, col) {
        if (!col || !col.nobles.length) return [];
        const ist = Interrogation.state(player);
        return col.nobles.map(id => ist.pows.find(w => w && String(w.id) === String(id))).filter(Boolean);
    },

    /** The fates open for this column: [{ id, icon, label, hint, can, reason }]. */
    options(player, world, col = null) {
        col = col || PrisonerFates.pending(player);
        if (!col) return [];
        const B = PrisonerFates.config().blind;
        const I = PrisonerFates.config().impale;
        const ids = col.outlaw ? OUTLAW_FATES : REALM_FATES;
        const k = _kingdom(world, col.kingdomId);
        return ids.map(id => {
            const t = FATE_TEXT[id];
            let can = true; let reason = '';
            if (id === 'blind' && col.men < _num(B.minMen, 10)) { can = false; reason = `Too few to make a column (${_num(B.minMen, 10)} or more)`; }
            if (id === 'impale' && col.men < _num(I.minMen, 6)) { can = false; reason = `Too few to make a line of stakes (${_num(I.minMen, 6)} or more)`; }
            if ((id === 'blind' || id === 'oath' || id === 'release') && !col.outlaw && !k) { can = false; reason = 'Their realm is no more: there is no home to send them to'; }
            if (id === 'blind' && col.sea) { can = false; reason = 'Not at sea'; }
            return { id, icon: t.icon, label: t.label, hint: t.hint, can, reason, isDefault: id === PrisonerFates.defaultFate(col) };
        });
    },

    defaultFate(col) { return col && col.outlaw ? 'hang' : 'oath'; },

    /** The knights' fate: 'ransom' (talks opened for each) | 'dungeon' | 'share' (their lot is the men's). */
    decideNobles(player, world, choice) {
        const col = PrisonerFates.pending(player);
        if (!col || col.noblesDone) return { success: false, reason: 'There are no knights awaiting your word.' };
        const nobles = PrisonerFates._nobles(player, col);
        let text;
        if (choice === 'ransom') {
            const asked = [];
            for (const w of nobles) { const r = PrisonerFates.openTalks(player, world, w.id, 'fair'); if (r.success) asked.push(w.name); }
            text = asked.length ? `Heralds ride to ${col.realm} with your price for ${asked.join(', ')}.` : 'No herald could be sent.';
        } else if (choice === 'share') {
            for (const w of nobles) Interrogation._powGone(player, w);
            col.nobleShare = nobles.length;
            text = `${_plural(nobles.length, 'man of rank', 'men of rank')} will share the fate of the men.`;
        } else {
            text = `${nobles.map(w => w.name).join(', ')} go down to your dungeon.`;
        }
        for (const w of nobles) delete w.column;
        col.noblesDone = true;
        return { success: true, text };
    },

    /** Hang the oath-breakers found among the captives, by right (no stain), or let them be with the rest. */
    decideOathBreakers(player, world, hang) {
        const col = PrisonerFates.pending(player);
        if (!col || col.oathDone) return { success: false, reason: 'No oath-breakers await your word.' };
        col.oathDone = true;
        const n = Math.min(col.men, _num(col.oathBreakers));
        if (!hang || n <= 0) return { success: true, text: 'The oath-breakers stand with the rest.' };
        col.men = Math.max(0, col.men - n);
        col.strength = Math.max(0, col.strength - Math.round(n / Math.max(1, _num(PrisonerFates.config().capture.menPerStrength, 2))));
        player.renown = _num(player.renown) + 2;
        try { Traits.recordDeed(player, 'dread', 1); } catch (e) { /* no traits */ }
        const st = PrisonerFates.state(player);
        st.stats.hanged += n;
        const text = `${_plural(n, 'man', 'men')} who broke ${n === 1 ? 'his' : 'their'} oath to you hang by the road. No one calls it cruelty.`;
        PrisonerFates._history(player, world, 'hang', text, { realm: col.realm, men: n });
        if (player.house) House._chronicle(player.house, world, `${PrisonerFates._by(player)} hanged ${_plural(n, 'oath-breaker', 'oath-breakers')} of ${col.realm || 'the enemy'} taken in battle.`, ['war', 'justice']);
        if (col.men <= 0) st.pending = null;
        return { success: true, text };
    },

    /** Your word on the men: one of options(). → { success, text } */
    decide(player, world, fate) {
        const st = PrisonerFates.state(player);
        const col = st.pending;
        if (!col) return { success: false, reason: 'No captives await your word.' };
        const opt = PrisonerFates.options(player, world, col).find(o => o.id === fate);
        if (!opt) return { success: false, reason: 'That cannot be done with these men.' };
        if (!opt.can) return { success: false, reason: opt.reason };
        // Knights not yet decided: the captains offer them back for a fair ransom
        if (!col.noblesDone) PrisonerFates.decideNobles(player, world, 'ransom');
        col.oathDone = true;
        const text = PrisonerFates[`_${fate}`](player, world, col);
        st.pending = null;
        if (col.kingdomId != null) st.wrongs[col.kingdomId] = { fate, day: _day(world) };
        PrisonerFates._history(player, world, fate, text, { realm: col.realm || 'outlaws', men: col.men });
        return { success: true, text, fate };
    },

    /** Walked away from: the captains' merciful default (the oath; outlaws hang). */
    settleDefault(player, world) {
        const col = PrisonerFates.pending(player);
        if (!col) return null;
        if (!col.oathDone) PrisonerFates.decideOathBreakers(player, world, false);
        const fate = PrisonerFates.options(player, world, col).find(o => o.isDefault && o.can) ? PrisonerFates.defaultFate(col) : 'release';
        const r = PrisonerFates.decide(player, world, fate);
        if (!r.success) PrisonerFates.state(player).pending = null;
        return r.success ? r : null;
    },

    // ── The fates ───────────────────────────────────────────────

    _homeTo(world, col, strength) {
        const k = _kingdom(world, col.kingdomId);
        if (k && strength > 0) k.military = _num(k.military) + Math.round(strength);
        return k;
    },

    _service(player, world, col) {
        const S = PrisonerFates.config().service;
        const st = PrisonerFates.state(player);
        const def = PlayerMilitary.getUnitDef(col.outlaw ? S.outlawUnit || 'militia' : S.unitType || 'soldier') || PlayerMilitary.getUnitDef('militia');
        const per = Math.max(1, _num(def && def.strength, 5));
        const n = def ? Math.min(_num(S.maxUnits, 6), Math.max(col.strength * _num(S.share, 0.5) >= per / 2 ? 1 : 0, Math.floor(col.strength * _num(S.share, 0.5) / per))) : 0;
        if (!player.army) player.army = [];
        for (let i = 0; i < n; i++) {
            const u = PlayerMilitary.makeArmyUnit(def);
            u.name = `${col.outlaw ? 'Turned outlaws' : `Turncoats of ${col.realm}`}`;
            u.turncoat = { kingdomId: col.kingdomId, realm: col.realm, outlaw: !!col.outlaw, loyalty: _num(col.outlaw ? S.outlawLoyalty : S.loyalty, 25), day: _day(world) };
            player.army.push(u);
        }
        st.stats.served += n;
        // The rest walk home disarmed
        const rest = Math.max(0, col.strength - n * per);
        if (!col.outlaw) PrisonerFates._homeTo(world, col, rest);
        if (col.nobleShare && !col.outlaw) PrisonerFates._noblesHome(player, world, col);
        return n
            ? `${_plural(n, 'company', 'companies')} of ${col.outlaw ? 'the outlaws' : `${col.realm}'s men`} take your pay${rest > 0 ? '; the rest are stripped and sent off' : ''}. Watch them: they are not yours yet.`
            : 'None of them is fit to serve; they are stripped and sent off.';
    },

    _noblesHome(player, world, col) {
        if (!(col.nobleShare > 0)) return;
        if (!player.reputation) player.reputation = {};
        player.reputation[col.kingdomId] = _num(player.reputation[col.kingdomId]) + col.nobleShare * 2;
    },

    _oath(player, world, col) {
        const O = PrisonerFates.config().oath;
        const st = PrisonerFates.state(player);
        const day = _day(world);
        const k = PrisonerFates._homeTo(world, col, col.strength);
        const until = day + _num(O.days, 240);
        const oath = { id: `oath${col.id}`, kingdomId: col.kingdomId, realm: col.realm, men: col.men, day, until, place: col.name, broken: 0 };
        st.oaths.push(oath);
        if (k) WarStakes.captivity(k).oathBound.push({ id: oath.id, men: col.men, until });
        if (!player.reputation) player.reputation = {};
        player.reputation[col.kingdomId] = _num(player.reputation[col.kingdomId]) + _num(O.rep, 6);
        player.karma = _num(player.karma) + _num(O.karma, 3);
        try { Traits.recordDeeds(player, { mercy: 2, honesty: 1 }); } catch (e) { /* no traits */ }
        try { NPCLords.rememberRealm(world, col.kingdomId, 'pow_spared', { note: col.name }); } catch (e) { /* no lord */ }
        PrisonerFates._lordsLove(player, world, 1);
        PrisonerFates._noblesHome(player, world, col);
        st.stats.sworn += col.men;
        if (player.house) House._chronicle(player.house, world, `${PrisonerFates._by(player)} sent ${col.men} men of ${col.realm} home on their oath not to bear arms against ${player.name || 'them'} again.`, ['war', 'mercy']);
        return `${col.men} men of ${col.realm} swear on their swords and their gods never to bear arms against you, and walk home. ${col.realm} thinks the better of you (+${_num(O.rep, 6)}).`;
    },

    _release(player, world, col) {
        const O = PrisonerFates.config().oath;
        const U = PrisonerFates.config().outlaws;
        const st = PrisonerFates.state(player);
        st.stats.released += col.men;
        if (col.outlaw) {
            player.karma = _num(player.karma) + _num(U.releaseKarma, 3);
            try { Traits.recordDeed(player, 'mercy', 1); } catch (e) { /* no traits */ }
            return `You let ${col.men} of the ${col.name} go with their lives. Some will go back to the road.`;
        }
        PrisonerFates._homeTo(world, col, col.strength);
        if (!player.reputation) player.reputation = {};
        player.reputation[col.kingdomId] = _num(player.reputation[col.kingdomId]) + Math.round(_num(O.rep, 6) / 2);
        player.karma = _num(player.karma) + 1;
        try { Traits.recordDeed(player, 'mercy', 1); } catch (e) { /* no traits */ }
        PrisonerFates._noblesHome(player, world, col);
        return `${col.men} men of ${col.realm} are stripped of their arms and sent home, free to fight again.`;
    },

    _hang(player, world, col) {
        const U = PrisonerFates.config().outlaws;
        const S = PrisonerFates.config().slaughter;
        const st = PrisonerFates.state(player);
        const day = _day(world);
        player.renown = _num(player.renown) + _num(U.hangRenown, 2);
        try { Traits.recordDeed(player, 'dread', 1); } catch (e) { /* no traits */ }
        const s = PrisonerFates._nearestTown(world, col.q, col.r);
        if (s) {
            if (s.kingdom != null) {
                if (!player.reputation) player.reputation = {};
                player.reputation[s.kingdom] = _num(player.reputation[s.kingdom]) + _num(U.hangRep, 2);
            }
            // (the town's thieves cowed a while: systems/npcTheft.js reads gallowsFear, as for the scaffold)
            const until = day + _num(U.fearDays, 45);
            const m = _num(U.fearMult, 0.6);
            s.gallowsFear = { until, m: s.gallowsFear && _num(s.gallowsFear.until) > day ? Math.min(_num(s.gallowsFear.m, 1), m) : m };
        }
        st.noQuarter.outlaws = Math.max(_num(st.noQuarter.outlaws), day + Math.round(_num(S.noQuarterDays, 240) / 2));
        st.stats.hanged += col.men;
        if (player.house) House._chronicle(player.house, world, `${PrisonerFates._by(player)} hanged ${col.men} of the ${col.name} by the road${s ? ` near ${s.name}` : ''}.`, ['justice']);
        return `${col.men} of the ${col.name} hang from the trees by the road${s ? ` near ${s.name}` : ''}. The thieves there will think twice; the outlaws will fight you harder.`;
    },

    _slaughter(player, world, col) {
        const S = PrisonerFates.config().slaughter;
        const U = PrisonerFates.config().outlaws;
        const st = PrisonerFates.state(player);
        const day = _day(world);
        st.noQuarter[col.outlaw ? 'outlaws' : String(col.kingdomId)] = day + _num(S.noQuarterDays, 240);
        st.stats.slain += col.men;
        if (col.outlaw) {
            player.karma = _num(player.karma) + _num(U.slayKarma, -5);
            try { Traits.recordDeeds(player, { cruelty: 1 }); } catch (e) { /* no traits */ }
            return `${col.men} of the ${col.name} are cut down where they knelt. The outlaws of these roads will not yield to you again.`;
        }
        PrisonerFates._brand(player, world, 'slaughter', col);
        return `${col.men} men of ${col.realm} are cut down where they knelt. ${col.realm} will give you no quarter now: its men will fight to the last.`;
    },

    _blind(player, world, col) {
        const B = PrisonerFates.config().blind;
        const st = PrisonerFates.state(player);
        const day = _day(world);
        const k = _kingdom(world, col.kingdomId);
        const ws = WarStakes.state(world);
        const leaders = Math.max(1, Math.floor(col.men / Math.max(1, _num(B.leaderEvery, 100))));
        const home = k && k.capital ? k.capital : { q: col.q, r: col.r };
        const leader = `${Interrogation._powName(world, col.kingdomId, `blind|${col.id}|${day}`)} One-Eye`;
        ws.columns.push({ id: ws.nextId++, kingdomId: col.kingdomId, realm: col.realm, men: col.men, leaders, leader, q: col.q, r: col.r, fq: col.q, fr: col.r, toQ: home.q, toR: home.r, day, byPlayer: true, by: PrisonerFates._by(player) });
        PrisonerFates._brand(player, world, 'blind', col);
        st.stats.blinded += col.men;
        // A one-eyed captain who led them home may never forgive it
        try {
            Nemesis.wrong(player, world, { kind: 'blood', name: leader, line: col.realm, score: _num(B.nemesis, 75), age: 30, gender: 'male', deed: { key: 'blinded', label: `the eyes you put out at ${col.name}`, note: col.realm } });
        } catch (e) { /* no nemesis */ }
        return `The eyes of ${col.men} men of ${col.realm} are put out. ${_plural(leaders, 'man is', 'men are')} left one eye to lead the rest home: the column sets out for ${k ? Names.realm(k.name) : 'home'}, and every town on its road will see it.`;
    },

    /** The road into your realm: toward your crown's capital, your nearest holding, or your liege's capital. */
    _homeward(player, world, q, r) {
        const realm = KingdomAI.playerRealm(world);
        if (realm && realm.capital) return { q: realm.capital.q, r: realm.capital.r };
        let best = null;
        try {
            for (const h of RealmWars.holdings(player, world)) {
                const d = _dist(world, q, r, h.q, h.r);
                if (!best || d < best.d) best = { q: h.q, r: h.r, d };
            }
        } catch (e) { best = null; }
        if (best) return best;
        const liege = _kingdom(world, player.allegiance);
        return liege && liege.capital ? { q: liege.capital.q, r: liege.capital.r } : null;
    },

    _stakeTiles(player, world, q, r, n) {
        const to = PrisonerFates._homeward(player, world, q, r);
        const ok = (t) => {
            const tile = world && typeof world.getTile === 'function' ? world.getTile(t.q, t.r) : null;
            return !tile || !tile.terrain || tile.terrain.passable !== false;
        };
        let pts = [];
        if (to && (to.q !== q || to.r !== r)) pts = Hex.lineDraw(q, r, to.q, to.r).slice(0, n + 4).filter(ok);
        if (pts.length < Math.min(n, 2)) pts = [{ q, r }, ...Hex.neighbors(q, r)].filter(ok);
        return pts.slice(0, Math.max(1, n)).map(t => ({ q: t.q, r: t.r }));
    },

    _impale(player, world, col) {
        const I = PrisonerFates.config().impale;
        const U = PrisonerFates.config().outlaws;
        const st = PrisonerFates.state(player);
        const day = _day(world);
        const ws = WarStakes.state(world);
        const tiles = PrisonerFates._stakeTiles(player, world, col.q, col.r, _num(I.tiles, 6));
        const near = PrisonerFates._nearestTown(world, col.q, col.r);
        const place = near ? `the road by ${near.name}` : 'the road';
        ws.stakes.push({ id: ws.nextId++, byPlayer: true, by: PrisonerFates._by(player), kingdomId: col.kingdomId, realm: col.realm || 'outlaws', men: col.men, day, q: col.q, r: col.r, tiles, rotDays: _num(I.rotDays, 90), place });
        st.stats.impaled += col.men;
        if (col.outlaw) {
            player.karma = _num(player.karma) + _num(U.impaleKarma, -10);
            player.renown = _num(player.renown) + _num(U.impaleRenown, 15);
            const at = Atrocities.state(player);
            at.butcher = Math.min(_num(Atrocities.config().infamy.max, 300), at.butcher + _num(U.impaleButcher, 15));
            try { Traits.recordDeeds(player, { cruelty: 3, dread: 3 }); } catch (e) { /* no traits */ }
            try { Gossip.spreadDeed(player, world, 'prisoners_impaled', { q: col.q, r: col.r, location: near ? near.name : undefined, victim: `${col.men} outlaws` }); } catch (e) { /* no gossip */ }
            PrisonerFates._lordsFear(player, world, I);
            if (player.house) House._chronicle(player.house, world, `${PrisonerFates._by(player)} set ${col.men} of the ${col.name} on stakes along ${place}.`, ['justice', 'cruelty']);
            return `${col.men} of the ${col.name} are set on stakes along ${place}. Travellers will speak of it for years.`;
        }
        PrisonerFates._brand(player, world, 'impale', col, { place });
        // The victims' realm, and its neighbours, dread a war on your realm while the stakes are fresh
        const until = day + Math.round(_num(I.rotDays, 90) * (1 - _num(I.fearFresh, 0.4)));
        const victims = _kingdom(world, col.kingdomId);
        for (const k of (world.kingdoms || [])) {
            if (!k || k.isAlive === false) continue;
            const near2 = k === victims || (k.capital && _dist(world, k.capital.q, k.capital.r, col.q, col.r) <= _num(I.fearRadius, 30));
            if (near2) { const c = WarStakes.captivity(k); c.fearOf.player = Math.max(_num(c.fearOf.player), until); }
        }
        return `${col.men} men of ${col.realm} are set on stakes along ${place}, into your realm. Any army that comes that way will walk between them.`;
    },

    // ── The marks every cruelty leaves ──────────────────────────

    _lordsFear(player, world, K) {
        const court = (() => { try { return Kingship.court(player); } catch (e) { return null; } })();
        if (!court || !Array.isArray(court.vassals)) return 0;
        const day = _day(world);
        let n = 0;
        for (const v of court.vassals) {
            if (!v || v.rebel) continue;
            v.cowedUntil = Math.max(_num(v.cowedUntil), day + _num(K.cowedDays));
            v.grudge = _num(v.grudge) + _num(K.grudge);
            n++;
        }
        return n;
    },

    _lordsLove(player, world, n) {
        const court = (() => { try { return Kingship.court(player); } catch (e) { return null; } })();
        if (!court || !Array.isArray(court.vassals)) return;
        for (const v of court.vassals) if (v && !v.rebel) v.grudge = _num(v.grudge) - n;
    },

    /** Every faith of the world's realms (their ids, once each). */
    _faiths(world) {
        const out = [];
        for (const k of (world && world.kingdoms) || []) {
            const f = k && k.isAlive !== false && k.religion && k.religion.faithId;
            if (f && !out.includes(f)) out.push(f);
        }
        return out;
    },

    /**
     * The consequences slaughter, blinding and the stakes share (config C[kind]):
     * the name for cruelty and broken faith, karma and traits, every realm's
     * regard and lords' memory, the faiths, gossip (in every capital for the
     * worst), your own lords' fear, the war score, renown, the chronicle.
     */
    _brand(player, world, kind, col, opts = {}) {
        const K = PrisonerFates.config()[kind] || {};
        const day = _day(world);
        const kid = col.kingdomId;
        const at = Atrocities.state(player);
        const max = _num(Atrocities.config().infamy.max, 300);
        at.butcher = Math.min(max, at.butcher + _num(K.butcher));
        at.perfidy = Math.min(max, at.perfidy + _num(K.perfidy));
        player.karma = _num(player.karma) + _num(K.karma);
        player.renown = _num(player.renown) + _num(K.renown);
        try { Traits.recordAggression(player, kid, K.deeds || {}); } catch (e) { /* no traits */ }
        if (!player.reputation) player.reputation = {};
        for (const k of (world && world.kingdoms) || []) {
            if (!k || k.isAlive === false) continue;
            const own = String(k.id) === String(kid);
            const rep = own ? _num(K.rep) - _num(col.nobleShare) * 5 : _num(K.otherRep);
            if (rep) player.reputation[k.id] = _num(player.reputation[k.id]) + rep;
            const deed = own ? K.lordDeed : K.othersDeed;
            if (deed) { try { NPCLords.rememberRealm(world, k.id, deed, { note: col.name }); } catch (e) { /* no lord */ } }
            if (own && col.nobleShare > 0) { try { NPCLords.rememberRealm(world, k.id, 'execution_highborn', { note: col.name }); } catch (e) { /* no lord */ } }
        }
        // The faiths: the realm's own clergy, and for the worst every faith
        const own = MaimFaith.realmFaith(world, kid);
        try {
            if (own && _num(K.faith)) Devotion._addStanding(player, own, -_num(K.faith));
            if (_num(K.allFaiths)) for (const f of PrisonerFates._faiths(world)) if (f !== own) Devotion._addStanding(player, f, -_num(K.allFaiths));
        } catch (e) { /* no devotion */ }
        // The talk: where it happened, and for blinding and the stakes in every capital
        const near = PrisonerFates._nearestTown(world, col.q, col.r);
        const victim = `${col.men} men of ${col.realm}`;
        try {
            Gossip.spreadDeed(player, world, K.gossip, { q: col.q, r: col.r, location: near ? near.name : undefined, kingdom: kid, victim });
            if (kind !== 'slaughter') {
                for (const k of (world && world.kingdoms) || []) {
                    if (!k || k.isAlive === false || !k.capital) continue;
                    const t = world.getTile ? world.getTile(k.capital.q, k.capital.r) : null;
                    if (t && t.settlement) Gossip.spreadDeed(player, world, K.gossip, { q: k.capital.q, r: k.capital.r, location: t.settlement.name, kingdom: k.id, victim });
                }
            }
        } catch (e) { /* no gossip */ }
        PrisonerFates._lordsFear(player, world, K);
        // At war with them: it weighs on their war (your war score)
        try {
            const war = player.realmWars && player.realmWars.wars && player.realmWars.wars[kid];
            if (war && _num(K.warScore)) war.score = _num(war.score) + _num(K.warScore);
        } catch (e) { /* no war */ }
        const words = { slaughter: `cut down ${victim} who had yielded`, blind: `put out the eyes of ${victim} and sent them home`, impale: `set ${victim} on stakes along ${opts.place || 'the road'}` }[kind];
        if (player.house) House._chronicle(player.house, world, `${PrisonerFates._by(player)} ${words}.`, ['war', 'cruelty']);
        if (world && Array.isArray(world.events)) world.events.push({ text: `${player.name || 'A lord'} ${words}.`, type: 'military', kingdom: kid, day });
    },

    _nearestTown(world, q, r) {
        let best = null;
        const views = world && typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        for (const v of views || []) {
            if (!v) continue;
            const d = _dist(world, q, r, v.q, v.r);
            if (!best || d < best.d) best = { v, d };
        }
        if (!best) return null;
        const t = world.getTile ? world.getTile(best.v.q, best.v.r) : null;
        return (t && t.settlement) || best.v;
    },

    // ── Oaths ───────────────────────────────────────────────────

    /** Oath-breakers among a host you met: found out, remembered. → the text. */
    _revealOath(player, world, unit) {
        const O = PrisonerFates.config().oath;
        const st = PrisonerFates.state(player);
        const kid = PrisonerFates.unitRealm(unit);
        const k = _kingdom(world, kid);
        const oath = st.oaths.find(o => String(o.kingdomId) === String(kid) && _num(o.until) > _day(world)) || st.oaths.find(o => String(o.kingdomId) === String(kid));
        const n = _num(unit.oathBreakers);
        unit.oathBreakers = 0;
        if (oath) oath.broken = _num(oath.broken) + n;
        st.stats.oathsBroken += n;
        if (!player.reputation) player.reputation = {};
        // Their crown's broken word: the other realms think less of it, and better of you
        for (const other of (world && world.kingdoms) || []) {
            if (!other || other.isAlive === false || other === k || !other.relations || !k) continue;
            other.relations[k.id] = Utils.clamp(_num(other.relations[k.id]) + _num(O.othersRelations, -6), -100, 100);
        }
        if (k) {
            for (const other of world.kingdoms || []) if (other && other !== k && other.isAlive !== false) player.reputation[other.id] = _num(player.reputation[other.id]) + Math.round(_num(O.brokenRep, 4) / 2);
        }
        const realm = k ? Names.realm(k.name) : 'their realm';
        const text = `Among the ${unit.name || 'enemy'} were ${n} men you sent home on their oath. ${realm} broke its word, and every court will hear of it.`;
        if (player.house) House._chronicle(player.house, world, `${realm} sent against ${PrisonerFates._by(player)} ${n} men who had sworn never to bear arms against ${player.name || 'them'} again.`, ['war', 'betrayal']);
        PrisonerFates._history(player, world, 'oath_broken', text, { realm, men: n });
        return text;
    },

    // ── Ransom talks for the men of rank ───────────────────────

    _talksCap(world, w) {
        const R = PrisonerFates.config().ransom;
        const P = Interrogation.config().pow;
        const k = _kingdom(world, w.kingdomId);
        if (!k) return 0;
        const base = _num((P.ransom || {})[w.rank], { lord: 500, knight: 200, captain: 80 }[w.rank] || 100);
        const lord = k.lord || {};
        const greed = _num(R.greedBase, 1.3) + (_num(lord.ambition, 5) - 5) * _num(R.greedPerAmbition, 0.05) + (_num(lord.honor, 5) - 5) * _num(R.honourPer, 0.03);
        return Math.max(0, Math.floor(Math.min(base * Math.max(0.5, greed), _num(k.treasury) * _num(R.treasuryShare, 0.35))));
    },

    /** The price named for a knight at `askKey` (fair | high | ruinous). */
    askFor(world, w, askKey = 'fair') {
        const R = PrisonerFates.config().ransom;
        const P = Interrogation.config().pow;
        const base = _num((P.ransom || {})[w.rank], 100);
        return Math.max(1, Math.round(base * _num((R.asks || {})[askKey], 1)));
    },

    _replyDays(world, w) {
        const R = PrisonerFates.config().ransom;
        const k = _kingdom(world, w.kingdomId);
        const d = k && k.capital && Number.isFinite(w.q) ? _dist(world, w.q, w.r, k.capital.q, k.capital.r) : 0;
        return Math.max(1, _num(R.replyDays, 3) + Math.floor(d / Math.max(1, _num(R.distPer, 12))));
    },

    /** Name a price for a prisoner of war: a herald rides to his crown. */
    openTalks(player, world, powId, askKey = 'fair') {
        const R = PrisonerFates.config().ransom;
        const w = Interrogation._pow(player, powId);
        if (!w) return { success: false, reason: 'You hold no such prisoner.' };
        if (!_kingdom(world, w.kingdomId)) return { success: false, reason: `${w.realm} is no more.` };
        if (w.talks && ['asked', 'agreed'].includes(w.talks.stage)) return { success: false, reason: 'Talks are under way.' };
        const day = _day(world);
        const ask = PrisonerFates.askFor(world, w, askKey);
        w.talks = { stage: 'asked', ask, offer: 0, paid: 0, rounds: 0, opened: day, replyDay: day + PrisonerFates._replyDays(world, w), due: day + _num(R.dueDays, 30), askKey };
        return { success: true, text: `A herald rides for ${w.realm} with your price for ${w.name}: ${Utils.formatGold(ask)} gold.` };
    },

    /** Take their counter-offer. */
    acceptOffer(player, world, powId) {
        const R = PrisonerFates.config().ransom;
        const w = Interrogation._pow(player, powId);
        const t = w && w.talks;
        if (!t || t.stage !== 'offered') return { success: false, reason: 'There is no offer to take.' };
        t.ask = t.offer;
        t.stage = 'agreed';
        t.payDay = _day(world) + _num(R.payDays, 4);
        return { success: true, text: `You take ${w.realm}'s ${Utils.formatGold(t.offer)} gold for ${w.name}. The coin is on its way.` };
    },

    /** Press for more than they offered: a lower ask, and their patience thinner. */
    press(player, world, powId) {
        const R = PrisonerFates.config().ransom;
        const w = Interrogation._pow(player, powId);
        const t = w && w.talks;
        if (!t || t.stage !== 'offered') return { success: false, reason: 'There is no offer to answer.' };
        t.rounds = _num(t.rounds) + 1;
        if (t.rounds >= _num(R.maxRounds, 3)) {
            t.stage = 'refused';
            return { success: true, text: `${w.realm} will haggle no more: ${w.name} is yours to keep.` };
        }
        t.ask = Math.max(t.offer + 1, Math.round(t.ask * (1 - _num(R.pressCut, 0.2))));
        t.stage = 'asked';
        t.replyDay = _day(world) + PrisonerFates._replyDays(world, w);
        return { success: true, text: `Your herald rides back: ${Utils.formatGold(t.ask)} gold, and not a coin less.` };
    },

    /** Crowns that would buy a knight of `w`'s realm: at war with it, or no friend of it. */
    buyers(player, world, w) {
        const R = PrisonerFates.config().ransom;
        const P = Interrogation.config().pow;
        const own = _kingdom(world, w.kingdomId);
        const base = _num((P.ransom || {})[w.rank], 100);
        const out = [];
        for (const k of (world && world.kingdoms) || []) {
            if (!k || k.isAlive === false || !own || k === own) continue;
            const atWar = (k.wars || []).includes(own.id);
            const rel = _num(k.relations && k.relations[own.id]);
            if (!atWar && rel >= 0) continue;
            const price = Math.floor(Math.min(base * _num(R.sale, 0.6), _num(k.treasury) * _num(R.saleTreasuryShare, 0.25)));
            if (price > 0) out.push({ kingdomId: k.id, realm: Names.realm(k.name), price, atWar });
        }
        return out.sort((a, b) => b.price - a.price);
    },

    /** Sell a knight to a crown hostile to his: its treasury pays you, and his realm hears of it. */
    sell(player, world, powId, buyerId) {
        const R = PrisonerFates.config().ransom;
        const w = Interrogation._pow(player, powId);
        if (!w) return { success: false, reason: 'You hold no such prisoner.' };
        if (w.talks && w.talks.stage === 'agreed') return { success: false, reason: 'His ransom is agreed: the coin is on its way.' };
        const b = PrisonerFates.buyers(player, world, w).find(x => String(x.kingdomId) === String(buyerId));
        if (!b) return { success: false, reason: 'No such crown will buy him.' };
        const k = _kingdom(world, b.kingdomId);
        k.treasury = _num(k.treasury) - b.price;
        player.gold = Utils.cents(_num(player.gold) + b.price);
        try { Ledger.record(player, 'warRansoms', b.price); } catch (e) { /* no ledger */ }
        Interrogation._powGone(player, w);
        if (!player.reputation) player.reputation = {};
        player.reputation[w.kingdomId] = _num(player.reputation[w.kingdomId]) + _num(R.saleRep, -8);
        player.reputation[b.kingdomId] = _num(player.reputation[b.kingdomId]) + 2;
        try { NPCLords.rememberRealm(world, w.kingdomId, 'pow_sold', { note: w.name }); } catch (e) { /* no lord */ }
        const st = PrisonerFates.state(player);
        st.stats.sold++;
        st.stats.ransomGold += b.price;
        const text = `${b.realm} pays ${Utils.formatGold(b.price)} gold out of its treasury for ${w.name} of ${w.realm}. ${w.realm} will not forget it.`;
        PrisonerFates._history(player, world, 'sold', text, { realm: w.realm });
        if (player.house) House._chronicle(player.house, world, `${PrisonerFates._by(player)} sold ${w.name} of ${w.realm} to ${b.realm}.`, ['war']);
        return { success: true, text, paid: b.price };
    },

    /** The talks still open, for panels: [{ pow, talks }]. */
    talks(player) {
        if (!player || !player.interrogation) return [];
        return Interrogation.state(player).pows.filter(w => w && w.talks).map(w => ({ pow: w, talks: w.talks }));
    },

    _talksDay(player, world, out) {
        const R = PrisonerFates.config().ransom;
        const st = PrisonerFates.state(player);
        const day = _day(world);
        for (const w of Interrogation.state(player).pows.slice()) {
            const t = w && w.talks;
            if (!t) continue;
            const k = _kingdom(world, w.kingdomId);
            if (!k) { t.stage = 'refused'; continue; }
            if (t.stage === 'asked' && day >= _num(t.replyDay)) {
                const cap = PrisonerFates._talksCap(world, w);
                if (cap <= 0) {
                    t.stage = 'refused';
                    out.notices.push({ icon: '💰', title: `No Ransom for ${w.name}`, text: `${w.realm} sends word it has nothing to pay. ${w.name} stays in your dungeon (🛡️ Prisoners of War).`, type: 'warning' });
                } else if (t.ask <= cap) {
                    t.stage = 'agreed';
                    t.payDay = day + _num(R.payDays, 4);
                    out.notices.push({ icon: '💰', title: `${w.realm} Agrees`, text: `${w.realm} will pay ${Utils.formatGold(t.ask)} gold for ${w.name}. The coin is on its way.`, type: 'success' });
                } else {
                    t.stage = 'offered';
                    t.offer = cap;
                    out.notices.push({ icon: '💰', title: `An Offer for ${w.name}`, text: `${w.realm} will not pay ${Utils.formatGold(t.ask)}, but offers ${Utils.formatGold(cap)} gold (🛡️ Prisoners of War).`, type: 'info' });
                }
            } else if (t.stage === 'agreed' && day >= _num(t.payDay)) {
                const owed = Math.max(0, _num(t.ask) - _num(t.paid));
                const pay = Math.max(0, Math.min(owed, Math.floor(_num(k.treasury))));
                if (pay > 0) {
                    k.treasury = _num(k.treasury) - pay;
                    player.gold = Utils.cents(_num(player.gold) + pay);
                    t.paid = _num(t.paid) + pay;
                    st.stats.ransomGold += pay;
                    try { Ledger.record(player, 'warRansoms', pay); } catch (e) { /* no ledger */ }
                }
                if (_num(t.paid) >= _num(t.ask)) {
                    Interrogation._powGone(player, w);
                    st.stats.ransomed++;
                    const text = `${w.realm} pays ${Utils.formatGold(t.paid)} gold out of its treasury, and ${w.name} rides home.`;
                    PrisonerFates._history(player, world, 'ransomed', text, { realm: w.realm });
                    out.notices.push({ icon: '💰', title: `${w.name} Ransomed`, text, type: 'success' });
                } else if (day >= _num(t.due)) {
                    t.stage = 'broken';
                    out.notices.push({ icon: '💰', title: `${w.realm} Defaults`, text: `${w.realm} paid ${Utils.formatGold(t.paid)} of ${Utils.formatGold(t.ask)} and can pay no more. ${w.name} stays in your dungeon, to rot or to be sold (🛡️ Prisoners of War).`, type: 'warning' });
                } else {
                    t.payDay = day + _num(R.payDays, 4);
                }
            } else if (t.stage === 'offered' && day >= _num(t.due)) {
                t.stage = 'refused';
                out.notices.push({ icon: '💰', title: `${w.realm} Withdraws`, text: `Unanswered, ${w.realm} withdraws its offer for ${w.name}.`, type: 'info' });
            }
        }
    },

    /** Long in your cells, a prisoner of war may die there: no ransom for the dead, and his realm remembers. */
    _rotDay(player, world, out) {
        const R = PrisonerFates.config().ransom;
        const st = PrisonerFates.state(player);
        const day = _day(world);
        for (const w of Interrogation.state(player).pows.slice()) {
            if (!w || w.condemned || (w.talks && w.talks.stage === 'agreed')) continue;
            if (day - _num(w.day) < _num(R.rotAfter, 120) || (day + _num(w.id)) % 10 !== 0) continue;
            if (_roll(world, `rot|${w.id}|${day}`) >= _num(R.rotChance, 0.04)) continue;
            Interrogation._powGone(player, w);
            if (!player.reputation) player.reputation = {};
            player.reputation[w.kingdomId] = _num(player.reputation[w.kingdomId]) + _num(R.deathRep, -10);
            try { NPCLords.rememberRealm(world, w.kingdomId, 'pow_rotted', { note: w.name }); } catch (e) { /* no lord */ }
            st.stats.rotted++;
            const text = `${w.name} of ${w.realm} dies in your dungeon after ${day - _num(w.day)} days in the dark. No ransom comes for the dead.`;
            PrisonerFates._history(player, world, 'rotted', text, { realm: w.realm });
            if (player.house) House._chronicle(player.house, world, text, ['war', 'cruelty']);
            out.notices.push({ icon: '⛓️', title: 'Dead in the Dungeon', text, type: 'warning' });
        }
    },

    // ── Turncoats in your army ─────────────────────────────────

    turncoats(player) {
        return ((player && player.army) || []).filter(u => u && u.turncoat);
    },

    _turncoatDay(player, world, out) {
        const S = PrisonerFates.config().service;
        const st = PrisonerFates.state(player);
        const day = _day(world);
        const homeCache = {};
        const nearHome = (kid) => {
            if (kid == null) return false;
            if (homeCache[kid] !== undefined) return homeCache[kid];
            const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
            homeCache[kid] = (views || []).some(v => v && String(v.kingdom) === String(kid) && _dist(world, player.q, player.r, v.q, v.r) <= _num(S.homeRadius, 6));
            return homeCache[kid];
        };
        const gone = [];
        for (const u of player.army || []) {
            const t = u && u.turncoat;
            if (!t) continue;
            const atWar = t.kingdomId != null && RealmWars.atWarWith(player, t.kingdomId);
            t.loyalty = Math.min(100, _num(t.loyalty) + _num(S.loyaltyPerDay, 0.4) * (atWar ? 0.5 : 1));
            if (t.loyalty >= _num(S.loyalTo, 70)) {
                delete u.turncoat;
                u.name = PlayerMilitary.getUnitDef(u.type) ? PlayerMilitary.getUnitDef(u.type).name : u.name;
                out.notices.push({ icon: '🛡️', title: 'Yours Now', text: `The ${t.outlaw ? 'outlaws' : `men of ${t.realm}`} who took your pay are yours: they will not desert now.`, type: 'success' });
                continue;
            }
            const p = _num(S.desert, 0.03) * (1 - t.loyalty / 100) * (nearHome(t.kingdomId) ? _num(S.homeMult, 2) : 1) * (atWar ? _num(S.warMult, 2.5) : 1);
            if (_roll(world, `desert|${t.day}|${player.army.indexOf(u)}|${day}`) < p) gone.push(u);
        }
        for (const u of gone) {
            const i = player.army.indexOf(u);
            if (i >= 0) player.army.splice(i, 1);
            const k = _kingdom(world, u.turncoat.kingdomId);
            if (k) k.military = _num(k.military) + _num(u.strength);
            st.stats.deserted++;
        }
        if (gone.length) {
            const t = gone[0].turncoat;
            out.notices.push({ icon: '🏃', title: 'Turncoats Desert', text: `${_plural(gone.length, 'company', 'companies')} of ${t.outlaw ? 'turned outlaws' : `${t.realm}'s men`} slipped away in the night${t.outlaw ? '' : `, home to ${t.realm}`}.`, type: 'warning' });
        }
    },

    // ── Your own men in their hands ────────────────────────────

    _yourMenTaken(player, world, unit, result) {
        const Y = PrisonerFates.config().yourMen;
        const st = PrisonerFates.state(player);
        const kid = PrisonerFates.unitRealm(unit);
        const k = _kingdom(world, kid);
        const lost = _num(result.casualties);
        if (!k || lost <= 0) return null;
        const n = Math.max(1, Math.round(lost * _num(Y.taken, 0.35)));
        const day = _day(world);
        const realm = Names.realm(k.name);
        // Their lord decides: his temper, and what you did to his men
        const w = { ...(Y.weights || {}) };
        const traits = _lordTraits(k);
        const add = (o) => { for (const [f, v] of Object.entries(o || {})) w[f] = _num(w[f]) + _num(v); };
        if (traits.includes('cruel')) add(Y.cruel);
        if (traits.includes('honorable')) add(Y.honourable);
        if (traits.includes('greedy')) add(Y.greedy);
        const wrong = st.wrongs[kid];
        if (wrong && ['slaughter', 'blind', 'impale'].includes(wrong.fate)) { w.slaughter = _num(w.slaughter) + 4; if (wrong.fate !== 'slaughter') w.blind = _num(w.blind) + 1.5; w.release = 0; }
        else if (wrong && ['oath', 'release'].includes(wrong.fate)) w.release = _num(w.release) + 3;
        const fate = _pick(world, `yours|${kid}|${day}|${st.nextId}`, w) || 'ransom';
        const h = { id: st.nextId++, kingdomId: kid, realm, units: n, type: 'soldier', day, fate, ask: 0, due: 0, returnDay: 0 };
        let text;
        if (fate === 'ransom') {
            h.ask = n * _num(Y.perUnit, 40);
            h.due = day + _num(Y.dueDays, 30);
            st.held.push(h);
            text = `${_plural(n, 'company', 'companies')} of your fallen were taken alive. ${realm} asks ${Utils.formatGold(h.ask)} gold to send them back by day ${h.due} (🛡️ Prisoners of War).`;
        } else if (fate === 'release') {
            h.returnDay = day + _num(Y.releaseDays, 7);
            st.held.push(h);
            text = `${_plural(n, 'company', 'companies')} of your fallen were taken alive. ${realm} will send them home, unransomed.`;
        } else if (fate === 'service') {
            k.military = _num(k.military) + n * 10;
            st.stats.menLost += n;
            text = `${_plural(n, 'company', 'companies')} of your men were taken alive, and ${realm} has put them in its own ranks.`;
        } else {
            st.vengeance[kid] = day + _num(Y.vengeanceDays, 120);
            st.stats.menLost += n;
            text = fate === 'blind'
                ? `${realm} put out the eyes of ${_plural(n, 'company', 'companies')} of your men taken alive and sent them back to you, led by the hand. Your men want blood.`
                : `${realm} cut down ${_plural(n, 'company', 'companies')} of your men who had yielded. Your soldiers will remember it in the next battle.`;
            if (player.house) House._chronicle(player.house, world, text, ['war']);
        }
        PrisonerFates._history(player, world, `yours_${fate}`, text, { realm, men: n });
        return text;
    },

    /** Pay the ransom for your men: out of your purse into their treasury; they come back to you. */
    buyBack(player, world, id) {
        const st = PrisonerFates.state(player);
        const h = st.held.find(x => String(x.id) === String(id) && x.fate === 'ransom');
        if (!h) return { success: false, reason: 'No such men are held for ransom.' };
        if (_num(player.gold) < h.ask) return { success: false, reason: `You need ${Utils.formatGold(h.ask)} gold.` };
        const k = _kingdom(world, h.kingdomId);
        player.gold = Utils.cents(_num(player.gold) - h.ask);
        if (k) k.treasury = _num(k.treasury) + h.ask;
        try { Ledger.record(player, 'warRansoms', -h.ask); } catch (e) { /* no ledger */ }
        PrisonerFates._returnMen(player, h);
        st.held = st.held.filter(x => x !== h);
        st.stats.menBought += h.units;
        return { success: true, text: `You pay ${h.realm} ${Utils.formatGold(h.ask)} gold, and ${_plural(h.units, 'company', 'companies')} of your men march back into camp.` };
    },

    _returnMen(player, h) {
        const def = PlayerMilitary.getUnitDef(h.type || 'soldier');
        if (!def) return 0;
        if (!player.army) player.army = [];
        for (let i = 0; i < h.units; i++) player.army.push(PlayerMilitary.makeArmyUnit(def));
        return h.units;
    },

    _heldDay(player, world, out) {
        const st = PrisonerFates.state(player);
        const day = _day(world);
        for (const h of st.held.slice()) {
            const k = _kingdom(world, h.kingdomId);
            if (h.fate === 'release' && day >= _num(h.returnDay)) {
                PrisonerFates._returnMen(player, h);
                st.held = st.held.filter(x => x !== h);
                out.notices.push({ icon: '🕊️', title: 'Your Men Come Home', text: `${h.realm} sends ${_plural(h.units, 'company', 'companies')} of your men back to you, unransomed.`, type: 'success' });
            } else if (h.fate === 'ransom' && (day > _num(h.due) || !k)) {
                st.held = st.held.filter(x => x !== h);
                if (k) k.military = _num(k.military) + h.units * 10;
                st.stats.menLost += h.units;
                out.notices.push({ icon: '⛓️', title: 'Your Men Unransomed', text: `No ransom came, and ${h.realm} has put ${_plural(h.units, 'company', 'companies')} of your men in its own ranks.`, type: 'warning' });
            }
        }
    },

    // ── The world: columns on the road, stakes rotting, the realms' own captives ──

    _columnsDay(world, player, out) {
        const B = PrisonerFates.config().blind;
        const ws = WarStakes.state(world);
        const day = _day(world);
        for (const c of ws.columns.slice()) {
            const d = _dist(world, c.q, c.r, c.toQ, c.toR);
            const k = _kingdom(world, c.kingdomId);
            // (a road that will not bring them in: they straggle home within a season all the same)
            if (d > _num(B.speed, 3) && k && day - _num(c.day) < 120) {
                const line = Hex.lineDraw(c.q, c.r, c.toQ, c.toR);
                const next = line[Math.min(line.length - 1, _num(B.speed, 3))] || { q: c.toQ, r: c.toR };
                if (next.q === c.q && next.r === c.r) { c.q = c.toQ; c.r = c.toR; } else { c.q = next.q; c.r = next.r; }
                continue;
            }
            ws.columns = ws.columns.filter(x => x !== c);
            if (!k) continue;
            const cap = WarStakes.captivity(k);
            cap.dismay = { until: Math.max(_num(cap.dismay && cap.dismay.until), day + _num(B.dismayDays, 120)), m: Math.max(_num(cap.dismay && cap.dismay.m), _num(B.dismay, 0.15)), since: day };
            k.stability = Math.max(0, _num(k.stability, 60) - _num(B.stability, 8));
            const realm = Names.realm(k.name);
            const text = `The blinded column comes into ${realm}, ${c.men} men led by ${_plural(c.leaders, 'one-eyed man', 'one-eyed men')}. The realm loses heart.`;
            if (Array.isArray(world.events)) world.events.push({ text, type: 'military', kingdom: k.id, day });
            if (player && c.byPlayer) {
                out.notices.push({ icon: '👁️', title: 'The Column Comes Home', text: `${text} It will send no new armies against you for a season.`, type: 'warning' });
                if (player.house) House._chronicle(player.house, world, text, ['war', 'cruelty']);
            }
        }
    },

    _stakesDay(world) {
        const ws = WarStakes.state(world);
        const day = _day(world);
        // (shown rotting, then gone half a rot again after)
        ws.stakes = ws.stakes.filter(s => day - _num(s.day) <= _num(s.rotDays, 90) * 1.5);
    },

    /** The realms' battles (world.captivesFeed): the victor treats its captives, cheaply. */
    _aiDay(world, player) {
        const A = PrisonerFates.config().ai;
        const feed = Array.isArray(world.captivesFeed) ? world.captivesFeed : null;
        if (!feed) { world.captivesFeed = []; return; }
        if (!feed.length) return;
        const take = feed.splice(0, feed.length).slice(0, _num(A.perDay, 4));
        const day = _day(world);
        for (const b of take) {
            const v = _kingdom(world, b.victor);
            const l = _kingdom(world, b.loser);
            if (!v || !l) continue;
            const men = Math.round(_num(b.lost) * _num(A.share, 0.3));
            if (men < _num(A.minMen, 20)) continue;
            const w = { ...(A.weights || {}) };
            const traits = _lordTraits(v);
            const add = (o) => { for (const [f, x] of Object.entries(o || {})) w[f] = _num(w[f]) + _num(x); };
            if (traits.includes('cruel')) add(A.cruel);
            if (traits.includes('honorable')) add(A.honourable);
            const fate = _pick(world, `ai|${v.id}|${l.id}|${day}|${b.q},${b.r}`, w) || 'release';
            const vr = Names.realm(v.name);
            const lr = Names.realm(l.name);
            if (!l.relations) l.relations = {};
            const rel = (x) => { l.relations[v.id] = Utils.clamp(_num(l.relations[v.id]) + x, -100, 100); };
            if (fate === 'ransom') {
                const pay = Math.floor(Math.min(men * _num(A.perMan, 2), _num(l.treasury) * _num(A.treasuryShare, 0.1)));
                if (pay > 0) { l.treasury = _num(l.treasury) - pay; v.treasury = _num(v.treasury) + pay; }
                l.military = _num(l.military) + men;
            } else if (fate === 'release') {
                l.military = _num(l.military) + men;
                rel(3);
            } else if (fate === 'service') {
                v.military = _num(v.military) + Math.round(men * _num(A.serviceShare, 0.5));
            } else if (fate === 'slaughter') {
                rel(_num(A.slaughterRelations, -10));
                if (Array.isArray(world.events)) world.events.push({ text: `⚔️ ${vr} cut down ${men} men of ${lr} who had yielded.`, type: 'military', kingdom: l.id, day });
            } else if (fate === 'blind') {
                rel(_num(A.blindRelations, -20));
                const ws = WarStakes.state(world);
                const home = l.capital || { q: b.q, r: b.r };
                ws.columns.push({ id: ws.nextId++, kingdomId: l.id, realm: lr, men, leaders: Math.max(1, Math.floor(men / 100)), q: b.q, r: b.r, fq: b.q, fr: b.r, toQ: home.q, toR: home.r, day, byPlayer: false, by: vr });
                if (Array.isArray(world.events)) world.events.push({ text: `👁️ ${vr} blinded ${men} men of ${lr} and sent them home.`, type: 'military', kingdom: l.id, day });
            } else if (fate === 'impale') {
                rel(_num(A.blindRelations, -20));
                const I = PrisonerFates.config().impale;
                const ws = WarStakes.state(world);
                const tiles = [{ q: b.q, r: b.r }, ...Hex.neighbors(b.q, b.r).slice(0, 2)].map(t => ({ q: t.q, r: t.r }));
                ws.stakes.push({ id: ws.nextId++, byPlayer: false, by: vr, byKingdom: v.id, kingdomId: l.id, realm: lr, men, day, q: b.q, r: b.r, tiles, rotDays: _num(I.rotDays, 90), place: 'the field' });
                const c = WarStakes.captivity(l);
                c.fearOf[v.id] = Math.max(_num(c.fearOf[v.id]), day + Math.round(_num(I.rotDays, 90) * (1 - _num(I.fearFresh, 0.4))));
                if (Array.isArray(world.events)) world.events.push({ text: `☠️ ${vr} set ${men} men of ${lr} on stakes where they were beaten.`, type: 'military', kingdom: l.id, day });
            }
        }
    },

    // ── The day ─────────────────────────────────────────────────

    /**
     * The day's turn (ui/game/endDay.js; Afterlife's world tick with no
     * player): the realms' own captives, the blinded columns walking, the
     * stakes rotting, oaths running out; with a player, a column left
     * undecided settled by the captains, ransom talks, turncoats, your men
     * held. Hash rolls only. → { notices }
     */
    processDay(world, player = null) {
        const out = { notices: [] };
        if (!world) return out;
        PrisonerFates._aiDay(world, player);
        if (world.prisonerFates) {
            PrisonerFates._columnsDay(world, player, out);
            PrisonerFates._stakesDay(world);
        }
        const day = _day(world);
        for (const k of world.kingdoms || []) {
            const c = k && k.captivity;
            if (c && Array.isArray(c.oathBound) && c.oathBound.length) c.oathBound = c.oathBound.filter(o => _num(o.until) > day);
        }
        if (!player || !player.prisonerFates) return out;
        const st = PrisonerFates.state(player);
        if (st.pending && _num(st.pending.day) < day) {
            const col = st.pending;
            const r = PrisonerFates.settleDefault(player, world);
            if (r) out.notices.push({ icon: '⛓️', title: 'Your Captains Decide', text: `No word came about the ${col.men} captives of the ${col.name}: ${r.text}`, type: 'info' });
        }
        st.oaths = st.oaths.filter(o => _num(o.until) + 120 > day);
        if (player.interrogation) {
            PrisonerFates._talksDay(player, world, out);
            PrisonerFates._rotDay(player, world, out);
        }
        if (PrisonerFates.turncoats(player).length) PrisonerFates._turncoatDay(player, world, out);
        if (st.held.length) PrisonerFates._heldDay(player, world, out);
        return out;
    },

    /** Anything for the Prisoners of War panel? */
    hasBusiness(player, world) {
        if (!player) return false;
        const st = player.prisonerFates;
        return !!((st && (st.pending || st.held.length || st.oaths.length)) || PrisonerFates.talks(player).length
            || PrisonerFates.turncoats(player).length || WarStakes.stakes(world).some(s => s.byPlayer));
    },

    // ── The choice scene (ui/actionMenu/prisonerFates.js registers it) ──

    /** The scene's view: the oath-breakers, the knights, then the men. */
    view(player, world) {
        const col = PrisonerFates.pending(player);
        if (!col) return null;
        const who = col.outlaw ? `${col.men} of the ${col.name}` : `${col.men} men of ${col.realm}`;
        const stats = [`⛓️ ${col.men} captives`, col.outlaw ? '🗡️ Outlaws' : `🏰 ${col.realm}`];
        const spirit = PrisonerFates.foeSpirit(player, world, { type: col.unitType, kingdomId: col.kingdomId });
        if (spirit.noRout) stats.push('⚔️ They expect no quarter');
        if (!col.oathDone) {
            return {
                icon: '🕊️', title: 'Oath-Breakers', stats,
                text: `${_plural(col.oathBreakers, 'man', 'men')} among the captives swore to you once never to bear arms against you again. By any law of war, their lives are yours.`,
                options: [
                    { id: 'oath_hang', icon: '🪢', label: 'Hang the oath-breakers', hint: 'By right: no one calls it cruelty', chance: null, odds: false, can: true, isDefault: true },
                    { id: 'oath_spare', icon: '🤝', label: 'Let them stand with the rest', hint: 'Their fate is the others\'', chance: null, odds: false, can: true },
                ],
            };
        }
        if (!col.noblesDone) {
            const nobles = PrisonerFates._nobles(player, col);
            const worth = nobles.reduce((t, w) => t + PrisonerFates.askFor(world, w, 'fair'), 0);
            return {
                icon: '🛡️', title: 'The Men of Rank', stats,
                text: `Among ${who}: ${nobles.map(w => w.name).join(', ')}. Their crown would pay to have them back; your dungeon will hold them meanwhile.`,
                options: [
                    { id: 'nobles_ransom', icon: '💰', label: 'Ransom them', hint: `Heralds to ${col.realm} with a fair price (about ${Utils.formatGold(worth)} gold in all): their answer comes in days, out of their treasury`, chance: null, odds: false, can: true, isDefault: true },
                    { id: 'nobles_dungeon', icon: '🔗', label: 'To the dungeon', hint: 'Hold them: question them, ransom them later, or let them rot', chance: null, odds: false, can: true },
                    { id: 'nobles_share', icon: '⚖️', label: 'They share the fate of the men', hint: 'No ransom: whatever you do to the men, you do to them (a lord\'s death is remembered)', chance: null, odds: false, can: true },
                ],
            };
        }
        return {
            icon: '⛓️', title: 'The Fate of the Captives', stats,
            text: `${_cap(who)} knelt and gave up their arms${col.sea ? ' on the deck' : ' on the field'}. What becomes of them is your word.`,
            options: PrisonerFates.options(player, world, col).map(o => ({ ...o, chance: null, odds: false })),
            footer: 'Walk away and your captains send them home on their oath (outlaws hang) at the day\'s end.',
        };
    },

    /** A choice in the scene. → { state } (go on) | { notification } (done) | { invalid, notification } */
    act(player, world, state, choice) {
        let r;
        if (choice === 'oath_hang' || choice === 'oath_spare') r = PrisonerFates.decideOathBreakers(player, world, choice === 'oath_hang');
        else if (choice.startsWith('nobles_')) r = PrisonerFates.decideNobles(player, world, choice.slice(7));
        else r = PrisonerFates.decide(player, world, choice);
        if (!r || !r.success) return { invalid: true, notification: { title: 'Not Possible', body: (r && r.reason) || 'That cannot be done.', type: 'error' } };
        const log = [...((state && state.log) || []), r.text];
        if (PrisonerFates.pending(player)) return { state: { ...(state || {}), log }, notification: null };
        const cruel = ['slaughter', 'blind', 'impale'].includes(r.fate);
        return { notification: { title: `${(FATE_TEXT[r.fate] || { icon: '⛓️' }).icon} ${r.fate ? _cap(FATE_TEXT[r.fate] ? FATE_TEXT[r.fate].label : 'Done') : 'Done'}`, body: r.text, type: cruel ? 'warning' : 'success' }, log: log.slice(0, -1) };
    },
};
