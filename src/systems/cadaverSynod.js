// ============================================
// THE CADAVER SYNOD — putting a dead enemy on trial
// ============================================
// After the synod of 897, when a pope had his dead predecessor dug up, robed,
// seated and tried, his blessing fingers cut off and the body thrown in the
// Tiber (data/cadaverSynod.json):
//
//   TOMBS     The dead are kept where they lie: every AI king who dies (seen
//             on kingdom.lastSuccession, buried at his capital) and every rival
//             House head who dies (RivalHouses._succeed calls bury; laid in the
//             House's crypt at its seat). world.cadaverSynod.tombs.
//   THE TRIAL A ruler whose realm holds the town of a tomb (or who holds the
//             town himself) digs the dead man up and tries him: the crown's
//             treasury pays the diggers, the clerks and the bishops' keep into
//             the town's purse. Sentence 'river' (fingers cut off, body thrown
//             in the river; his grave goods come to your packs) or 'unhallowed'
//             (stripped and reburied outside the walls: half of everything).
//   HIS HEIRS A king whose dynasty still rules his realm: every act of his void,
//             the heir's rule in doubt — the realm's stability falls, its regard
//             for your realm, you gain a claim on its throne (Throne source
//             'annulled'), and its next succession is likelier to be contested
//             (kingdom.synodTaint, read by Throne._detectSuccessions). The old
//             royal line of the realm you rule: its pretender's claim is cut
//             (CrownSuccession reads annulled). A rival House head: the House's
//             feud, its favour at every court halved, a deed it remembers, a
//             nemesis.
//   THE FAITH The clergy are outraged: your own standing with your faith, karma,
//             your realm's stability, every realm's regard, more in the realms of
//             the dead man's faith. The chronicle records it.
//   AI CROWNS A cruel, wrathful, paranoid or devout crown that holds the tomb of
//             an enemy king tries him now and then.
//
// State: world.cadaverSynod (tombs, the synods held, seen successions; saved:
// SaveLoad.serializeWorld); kingdom.synodTaint rides with the realm. Player
// acts draw nothing random; the daily tick rolls on its own seeded stream.
// No domain globals, no import-time side effects.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Names } from '../core/names.js';
import { Economy } from '../world/economy.js';
import { MoneySupply } from '../world/moneySupply.js';
import { Laws } from './laws.js';
import { House } from './house.js';
import { Throne } from './throne.js';
import { Nemesis } from './nemesis.js';
import { Devotion } from './devotion.js';
import { RivalHouses } from './rivalHouses.js';
import { NamedLegacy } from './namedLegacy.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _arr = v => (Array.isArray(v) ? v : []);
const _day = world => _num(world && world.day);
const _clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const _fill = (s, vars) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m));
const _Y = 360;

const DEFAULTS = {
    cost: 300, minDeadDays: 30, goods: 3,
    sentences: { river: { label: 'Throw him in the river', scale: 1, goods: true }, unhallowed: { label: 'Rebury him in unhallowed ground', scale: 0.5, goods: false } },
    heir: { stability: 12, relations: 40, claim: 15, claimCap: 30, taintYears: 20, crisisMult: 2, pretenderCut: 0.5 },
    lord: { feud: 35, standingMult: 0.5, memory: -30, nemesisScore: 65 },
    outrage: { faith: -12, karma: -15, ownStability: 4, reputationAll: 4, sameFaith: 8 },
    tombsCap: 120,
    ai: { yearly: 0.15, traits: ['cruel', 'wrathful', 'paranoid', 'devout'], hostileBelow: -40 },
    lines: {},
};

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}

function _roll(world, key) {
    const seed = (world && world.generationParams && world.generationParams.seed) || 1;
    return (_hash(`${seed}|synod|${key}`) % 100000) / 100000;
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

function _pay(world, s, q, r, amount) {
    const a = Math.round(_num(amount) * 100) / 100;
    if (!(a > 0) || !world) return;
    if (s && Economy.payTown(s, a)) return;
    if (Number.isFinite(q) && Economy.payNearest(world, q, r, a)) return;
    MoneySupply.leak(world, -a, 'synod');
}

const _traitIds = p => _arr(p && p.traits).map(t => (t && (t.id || t)) || '').filter(Boolean);
const _dynOf = k => (k && k.characterData && k.characterData.dynasty && k.characterData.dynasty.name) || null;

export const CadaverSynod = {
    config() {
        const d = _obj(DataLoader._gamedata && DataLoader._gamedata.cadaverSynod) || {};
        const out = { ...DEFAULTS };
        for (const [k, v] of Object.entries(d)) {
            if (k.startsWith('_')) continue;
            out[k] = _obj(v) && _obj(DEFAULTS[k]) ? { ...DEFAULTS[k], ...v } : v;
        }
        return out;
    },

    line(key, vars, fallback = '') {
        return _fill((CadaverSynod.config().lines || {})[key] || fallback, vars);
    },

    state(world) {
        if (!world) return { tombs: [], synods: [], seen: {}, nextId: 1 };
        if (!_obj(world.cadaverSynod)) world.cadaverSynod = { tombs: [], synods: [], seen: {}, nextId: 1 };
        const st = world.cadaverSynod;
        if (!Array.isArray(st.tombs)) st.tombs = [];
        if (!Array.isArray(st.synods)) st.synods = [];
        if (!_obj(st.seen)) st.seen = {};
        if (!(st.nextId > 0)) st.nextId = 1;
        return st;
    },

    serialize(world) {
        return world && _obj(world.cadaverSynod) ? JSON.parse(JSON.stringify(world.cadaverSynod)) : null;
    },

    restore(saved, world) {
        if (!world) return;
        world.cadaverSynod = _obj(saved) ? JSON.parse(JSON.stringify(saved)) : null;
        CadaverSynod.state(world);
    },

    // ──────────── THE TOMBS ────────────

    /**
     * Lay a dead man in his tomb. spec: { kind: 'king'|'lord', name, dynasty,
     * house, kingdomId, q, r, town, heir, day }. → the tomb, or null.
     */
    bury(world, spec = {}) {
        if (!world || !spec.name || !Number.isFinite(spec.q)) return null;
        const st = CadaverSynod.state(world);
        const day = spec.day != null ? _num(spec.day) : _day(world);
        if (st.tombs.some(t => t.name === spec.name && t.kingdomId === spec.kingdomId && Math.abs(_num(t.died) - day) < 5)) return null;
        const tomb = {
            id: `tomb${st.nextId++}`, kind: spec.kind === 'lord' ? 'lord' : 'king', name: String(spec.name),
            dynasty: spec.dynasty || null, house: spec.house || (spec.dynasty ? `House ${spec.dynasty}` : null),
            kingdomId: spec.kingdomId != null ? spec.kingdomId : null, realm: spec.realm || null,
            q: spec.q, r: spec.r, town: spec.town || null, died: day, heir: spec.heir || null,
            faith: spec.faith || null, tried: null, defaced: null,
        };
        st.tombs.push(tomb);
        const cap = _num(CadaverSynod.config().tombsCap, 120);
        if (st.tombs.length > cap) {
            // (the untried and oldest go first; a tried tomb is history)
            const idx = st.tombs.findIndex(t => !t.tried);
            st.tombs.splice(idx >= 0 ? idx : 0, 1);
        }
        return tomb;
    },

    /** Every AI king who died since last seen is laid in his tomb at the capital. */
    _watch(world) {
        const st = CadaverSynod.state(world);
        for (const k of _arr(world.kingdoms)) {
            const succ = k && k.lastSuccession;
            if (!succ || !(succ.day > _num(st.seen[k.id], -1))) continue;
            st.seen[k.id] = succ.day;
            const cap = k.capital;
            if (!cap || !Number.isFinite(cap.q)) continue;
            const s = _settlementAt(world, cap.q, cap.r);
            CadaverSynod.bury(world, {
                kind: 'king', name: succ.oldRulerName || 'the late king', dynasty: _dynOf(k), kingdomId: k.id, realm: k.name,
                q: cap.q, r: cap.r, town: (s && s.name) || null, heir: succ.heirName || null, day: succ.day, faith: k.religion || null,
            });
        }
    },

    tomb(world, id) {
        return CadaverSynod.state(world).tombs.find(t => t.id === id) || null;
    },

    /** Is this realm's line (this dynasty) annulled by a synod on one of its kings? */
    annulled(world, kingdomId, dynasty = null) {
        return CadaverSynod.state(world).tombs.some(t => t.kind === 'king' && t.tried && t.kingdomId === kingdomId && (!dynasty || !t.dynasty || t.dynasty === dynasty));
    },

    /** Throne: a realm whose king was tried has a likelier succession crisis while the taint lasts. */
    crisisMult(world, kingdom) {
        const t = kingdom && _obj(kingdom.synodTaint);
        if (!t || _day(world) > _num(t.until)) return 1;
        return Math.max(1, _num(CadaverSynod.config().heir.crisisMult, 2));
    },

    // ──────────── THE TRIAL ────────────

    /** The tombs within the player's reach, with what stands in the way. */
    reachable(player, world) {
        const k = Laws.ruled(player, world);
        const st = CadaverSynod.state(world);
        return st.tombs.filter(t => !t.tried && !t.defaced).map(t => ({ tomb: t, can: CadaverSynod.canTry(player, world, t.id) }))
            .filter(x => x.can.ok || x.can.near)
            .sort((a, b) => (b.can.ok ? 1 : 0) - (a.can.ok ? 1 : 0) || _num(b.tomb.died) - _num(a.tomb.died))
            .map(x => ({ ...x, realm: k }));
    },

    /** Can the player put this dead man on trial? → { ok, reason, cost, near } */
    canTry(player, world, tombId) {
        const C = CadaverSynod.config();
        const t = CadaverSynod.tomb(world, tombId);
        if (!t) return { ok: false, reason: 'No such tomb.' };
        if (t.tried) return { ok: false, reason: `${t.name} was tried already.` };
        if (t.defaced) return { ok: false, reason: `The tomb of ${t.name} was broken and emptied.` };
        const s = _settlementAt(world, t.q, t.r);
        const k = Laws.ruled(player, world);
        const held = !!(s && NamedLegacy._held(player, world, s));
        const cost = Math.round(_num(C.cost, 300));
        if (!k) return { ok: false, reason: 'Only a crown can call a synod of its bishops.', cost, near: held };
        if (!held) return { ok: false, reason: `${t.name} lies in ${t.town || 'a town'} beyond your rule.`, cost };
        const mine = player.house && player.house.name;
        if (mine && t.house && t.house === mine) return { ok: false, reason: 'You will not put your own blood on trial.', cost, near: true };
        if (_day(world) - _num(t.died) < _num(C.minDeadDays, 30)) return { ok: false, reason: `${t.name} is not cold in his tomb yet.`, cost, near: true };
        if (_num(k.treasury) < cost) return { ok: false, reason: `The synod costs the crown ${Utils.formatGold(cost)}g; the treasury holds ${Utils.formatGold(_num(k.treasury))}g.`, cost, near: true };
        return { ok: true, cost, near: true, settlement: s, kingdom: k };
    },

    /** What the trial would do: the heirs touched, the outrage (for the panel). */
    forecast(player, world, tombId) {
        const t = CadaverSynod.tomb(world, tombId);
        if (!t) return null;
        const k = Laws.ruled(player, world);
        const realm = t.kind === 'king' ? _kingdom(world, t.kingdomId) : null;
        const heirsRule = !!(realm && realm.isAlive && _dynOf(realm) && _dynOf(realm) === t.dynasty);
        const own = !!(k && realm && realm.id === k.id);
        const rival = t.kind === 'lord' && player ? RivalHouses.rival(player, t.kingdomId) : null;
        return {
            heirsRule, own, rival: rival && rival.name === t.house ? rival.name : null,
            realm: realm ? Names.realm(realm.name) : null, ruler: realm ? realm.ruler : null,
        };
    },

    /**
     * Hold the synod. sentence 'river' | 'unhallowed'.
     * → { success, text, goods } | { success: false, reason }
     */
    hold(player, world, tombId, sentence = 'river') {
        const can = CadaverSynod.canTry(player, world, tombId);
        if (!can.ok) return { success: false, reason: can.reason };
        const C = CadaverSynod.config();
        const S = (C.sentences || {})[sentence];
        if (!S) return { success: false, reason: 'No such sentence.' };
        const t = CadaverSynod.tomb(world, tombId);
        const k = can.kingdom;
        const s = can.settlement;
        const day = _day(world);
        const scale = _num(S.scale, 1);
        // The crown pays: diggers, clerks, the bishops' keep — into the town
        k.treasury = _num(k.treasury) - can.cost;
        _pay(world, s, t.q, t.r, can.cost);
        // What lay with him: rings, a crown of gilt, the vestments' gold thread
        let goods = 0;
        if (S.goods) {
            goods = Math.max(0, Math.round(_num(C.goods, 3)));
            if (goods) {
                if (!_obj(player.inventory)) player.inventory = {};
                player.inventory.grave_goods = _num(player.inventory.grave_goods) + goods;
            }
        }
        t.tried = { day, by: player.name || 'you', byKingdom: k.id, sentence, ai: false };
        const vars = { ruler: player.name || 'The crown', name: t.name, town: t.town || 'his tomb', realm: Names.realm(k.name) };
        const parts = [CadaverSynod.line(sentence === 'river' ? 'synodRiver' : 'synodUnhallowed', vars, `${t.name} is tried and condemned.`)];
        const effects = CadaverSynod._onHeirs(player, world, t, k, scale);
        if (effects.text) parts.push(effects.text);
        CadaverSynod._outrage(player, world, t, k, scale);
        const text = parts.join(' ');
        if (player.house) House._chronicle(player.house, world, text, ['throne', 'betrayal']);
        const st = CadaverSynod.state(world);
        st.synods.unshift({ day, tombId: t.id, name: t.name, by: player.name || 'you', byKingdom: k.id, sentence, ai: false, text });
        if (st.synods.length > 30) st.synods.length = 30;
        if (Array.isArray(world.events)) world.events.push({ category: 'political', text: `⚰️ ${parts[0]}`, kingdom: k.id, impact: 'negative' });
        return { success: true, text: `${text}${goods ? ` (${goods} grave goods to your packs.)` : ''}`, goods, effects };
    },

    /** His heirs: a king's line annulled, a rival House shamed. */
    _onHeirs(player, world, t, k, scale) {
        const C = CadaverSynod.config();
        const H = C.heir;
        const day = _day(world);
        const out = { text: '' };
        if (t.kind === 'king') {
            const realm = _kingdom(world, t.kingdomId);
            if (!realm) return out;
            const heirsRule = realm.isAlive && _dynOf(realm) && _dynOf(realm) === t.dynasty;
            if (realm.id === k.id) {
                // The old line of your own realm: its pretender's claim is the weaker (CrownSuccession reads annulled)
                out.text = `The old line of ${t.dynasty || t.name} is declared bastard in the eyes of the Church.`;
                out.ownLine = true;
            } else if (heirsRule) {
                realm.stability = _clamp(_num(realm.stability, 50) - _num(H.stability) * scale, 0, 100);
                if (!_obj(realm.relations)) realm.relations = {};
                realm.relations[k.id] = _clamp(_num(realm.relations[k.id]) - _num(H.relations) * scale, -100, 100);
                if (!_obj(k.relations)) k.relations = {};
                k.relations[realm.id] = _clamp(_num(k.relations[realm.id]) - _num(H.relations) * scale / 2, -100, 100);
                realm.synodTaint = { day, until: day + Math.round(_num(H.taintYears, 20) * _Y), by: k.id, name: t.name };
                const claim = Throne.grantClaim(player, world, realm.id, 'annulled', Math.round(_num(H.claim) * scale), { mode: 'add', cap: _num(H.claimCap, 30) });
                out.text = CadaverSynod.line('annulled', { name: t.name, heir: realm.ruler || 'his heir', realm: Names.realm(realm.name) }, `${t.name}'s acts are void.`);
                out.claim = claim;
                out.realmId = realm.id;
            }
        } else {
            const rival = RivalHouses.rival(player, t.kingdomId);
            if (rival && rival.name === t.house) {
                const L = C.lord;
                House.accrueRivalFeud(player, world, rival.kingdomId, Math.round(_num(L.feud) * scale), `${t.name} put on trial in death`);
                for (const kid of Object.keys(_obj(rival.standing) || {})) rival.standing[kid] = Math.floor(_num(rival.standing[kid]) * _num(L.standingMult, 0.5));
                if (!Array.isArray(rival.memory)) rival.memory = [];
                rival.memory.push({ kind: 'desecrated', day, w: _num(L.memory) * scale, note: t.town || null });
                const M = RivalHouses.config().memory || {};
                if (rival.memory.length > _num(M.keep, 14)) rival.memory.splice(0, rival.memory.length - _num(M.keep, 14));
                try { RivalHouses._note(rival, world, `${t.name}, our father, was dug up and tried as a criminal.`, 'bereaved'); } catch (e) { /* no log */ }
                Nemesis.wrong(player, world, {
                    kind: 'house', ref: { kingdomId: rival.kingdomId }, name: rival.head ? RivalHouses.headName(rival) : rival.name, line: rival.name,
                    deed: { key: 'synod', label: `${t.name} dug up and tried`, note: t.town }, score: _num(L.nemesisScore, 65),
                });
                out.text = CadaverSynod.line('lordShamed', { house: rival.name, name: t.name }, `${rival.name} is shamed.`);
                out.rival = rival.name;
            }
        }
        return out;
    },

    /** The faith's outrage: the clergy, karma, the realm, every realm's regard. */
    _outrage(player, world, t, k, scale) {
        const O = CadaverSynod.config().outrage;
        const creed = Devotion.creed(player);
        if (creed && creed.id) Devotion._addStanding(player, creed.id, _num(O.faith) * scale);
        player.karma = _num(player.karma) + _num(O.karma) * scale;
        k.stability = _clamp(_num(k.stability, 50) - _num(O.ownStability) * scale, 0, 100);
        if (!_obj(player.reputation)) player.reputation = {};
        for (const r of _arr(world.kingdoms)) {
            if (!r || !r.isAlive || r.id === k.id) continue;
            const same = t.faith && r.religion && r.religion === t.faith;
            player.reputation[r.id] = _num(player.reputation[r.id]) - (_num(O.reputationAll) + (same ? _num(O.sameFaith) : 0)) * scale;
        }
    },

    // ──────────── THE AI CROWNS ────────────

    /** Yearly: a hard crown that holds an enemy king's tomb may try him. */
    _aiYear(world, player) {
        const C = CadaverSynod.config();
        const A = C.ai;
        const st = CadaverSynod.state(world);
        const ruled = player ? Laws.ruled(player, world) : null;
        const day = _day(world);
        for (const t of st.tombs) {
            if (t.tried || t.defaced || t.kind !== 'king' || day - _num(t.died) < _num(C.minDeadDays, 30)) continue;
            const s = _settlementAt(world, t.q, t.r);
            const holder = s && s.kingdom != null ? _kingdom(world, s.kingdom) : null;
            if (!holder || !holder.isAlive || holder.id === t.kingdomId || (ruled && ruled.id === holder.id)) continue;
            const ruler = holder.characterData && holder.characterData.ruler;
            if (!ruler || !_traitIds(ruler).some(id => _arr(A.traits).includes(id))) continue;
            const dead = _kingdom(world, t.kingdomId);
            const hostile = !dead || !dead.isAlive || _num(_obj(holder.relations) && holder.relations[dead.id]) < _num(A.hostileBelow, -40);
            if (!hostile) continue;
            if (_roll(world, `ai|${t.id}|${Math.floor(day / _Y)}`) >= _num(A.yearly, 0.15)) continue;
            t.tried = { day, by: holder.ruler || 'a king', byKingdom: holder.id, sentence: 'river', ai: true };
            const H = C.heir;
            if (dead && dead.isAlive && _dynOf(dead) === t.dynasty) {
                dead.stability = _clamp(_num(dead.stability, 50) - _num(H.stability), 0, 100);
                if (!_obj(dead.relations)) dead.relations = {};
                dead.relations[holder.id] = _clamp(_num(dead.relations[holder.id]) - _num(H.relations), -100, 100);
                dead.synodTaint = { day, until: day + Math.round(_num(H.taintYears, 20) * _Y), by: holder.id, name: t.name };
            }
            holder.stability = _clamp(_num(holder.stability, 50) - _num(C.outrage.ownStability), 0, 100);
            const text = CadaverSynod.line('aiSynod', { ruler: holder.ruler || 'The king', realm: Names.realm(holder.name), name: t.name, dead: Names.realm((dead && dead.name) || t.realm || 'his realm') }, `${holder.ruler} tries the corpse of ${t.name}.`);
            st.synods.unshift({ day, tombId: t.id, name: t.name, by: holder.ruler || 'a king', byKingdom: holder.id, sentence: 'river', ai: true, text });
            if (st.synods.length > 30) st.synods.length = 30;
            if (Array.isArray(world.events)) world.events.push({ category: 'political', text: `⚰️ ${text}`, kingdom: holder.id, impact: 'negative' });
            break;
        }
    },

    processDay(world, player = null) {
        const out = { notices: [] };
        if (!world) return out;
        CadaverSynod._watch(world);
        if (_day(world) % _Y === 200) CadaverSynod._aiYear(world, player);
        return out;
    },

    // ──────────── THE PANEL ────────────

    view(player, world) {
        const st = CadaverSynod.state(world);
        const k = Laws.ruled(player, world);
        const C = CadaverSynod.config();
        const rows = st.tombs.filter(t => !t.tried && !t.defaced).map(t => ({ tomb: t, can: CadaverSynod.canTry(player, world, t.id), forecast: CadaverSynod.forecast(player, world, t.id) }));
        return {
            ruler: k ? { id: k.id, name: Names.realm(k.name), treasury: _num(k.treasury) } : null,
            cost: Math.round(_num(C.cost, 300)),
            sentences: Object.entries(C.sentences || {}).map(([id, s]) => ({ id, label: s.label, scale: _num(s.scale, 1) })),
            reach: rows.filter(r => r.can.ok || r.can.near),
            known: rows.filter(r => !r.can.ok && !r.can.near).length,
            synods: st.synods.slice(0, 10),
        };
    },
};
