// ============================================
// PLAGUE — the pestilence in a town: how bad, its gates, and the player in it
// ============================================
// Over the townsfolk's own sickness (systems/illness.js: who falls sick, the
// course, the healer, the deaths, town to town) and the great plague of the
// age (systems/crises.js: struck towns along the trade links), this keeps:
//
//   - SEVERITY  severityAt(world, s) 0..1 — a plague's sick share (a plague
//               town is never under plagueBase), a lesser epidemic's, the
//               great plague's struck towns while their course runs, an
//               abstract sickness in a town with no roster. The street map
//               (ui/innerMapPlague.js) reads it for how much shows; other
//               systems read it too (the migration of frightened families).
//   - GATES     a town's own gates shut against the sickness
//               (settlement.plagueGate = { shut, by, d, kid, leave }). Its
//               ruler shuts them (a weekly roll past closeAt, always under the
//               realm's Pestilence law of quarantine) and opens them a while
//               after the town is clean; a town the player holds is theirs to
//               shut (they are told), a realm they rule follows its law.
//               Illness.quarantined reads the shut gate, so the sickness
//               crosses to and from it a fraction as often (Illness._travel,
//               the great plague's spread) and trade on its links is cut
//               (systems/marketDynamics.js _quarantine). isQuarantined adds
//               the realm's law over a sick town. The player is turned away at
//               the gate (player/core/movement.js → canEnter) unless they rule
//               or hold it, keep a house there, paid its physicians, or bribed
//               the guards (a crime).
//   - ACTS      in a sick town (the street map's houses, the Sick of the Town
//               panel): nurse the sick laid up in a marked house; burn a dead
//               household's goods (the town's spread within its walls slowed:
//               settlement.plague.cleanse, read by Illness._env); sell
//               remedies at a plague price (coin out of the townsfolk's purses,
//               the remedy to a sick house); loot a dead household's house (a
//               burglary; the goods may carry it).
//
// State on the settlement (plagueGate, plague — plain data, saved with the
// tile; old saves have none). The daily tick rolls hashes of the world seed,
// the town and the day (never the shared RNG); the player's crimes draw
// Utils' stream. Runs with player = null. Content: data/plague.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { PlayerInventory } from '../core/inventory.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Economy } from '../world/economy.js';
import { Illness } from './illness.js';
import { Townsfolk } from './townsfolk.js';
import { Laws } from './laws.js';
import { Crises } from './crises.js';
import { Underworld } from './underworld.js';
import { NpcMemory } from './npcMemory.js';
import { Traits } from './traits.js';
import { Ailments } from './ailments.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _key = s => `${s.q},${s.r}`;
const _r3 = v => Math.round(v * 1000) / 1000;

let _cfg = null;
let _cfgSrc;

function _seed(world) { return (world && world.generationParams && world.generationParams.seed) || 1; }

/** A well-mixed 32-bit hash of a string (Utils.hashStr alone barely moves with the last character). */
function _hash(str) {
    let h = Utils.hashStr(String(str)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
}

/** A unit roll for `key` in this world (no RNG stream touched). */
function _roll(world, key) {
    return _hash(`${_seed(world)}|plague|${key}`) / 4294967296;
}

/** A unit hash of the parts (the street map's picks: no world needed). */
function _frac(...parts) {
    return _hash(parts.join('|')) / 4294967296;
}

function _views(world) {
    return world && typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
}

export const Plague = {
    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.plague : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            const A = _obj(d.actions) || {};
            _cfg = {
                severity: { plagueBase: 0.4, plaguePerShare: 3, crisisFloor: 0.55, epiBase: 0.18, epiPerShare: 1.6, epiMax: 0.6, minorMax: 0.15, abstractPlague: 0.5, abstractOther: 0.2, ...(_obj(d.severity) || {}) },
                gates: { closeAt: 0.3, closeChance: 0.45, closeAtPlague: 0.25, plagueChance: 0.75, openAfterDays: 14, minDays: 21, happiness: -1, bribe: {}, bribeDays: 3, bribeCaught: 0.2, bribeScale: 0.5, ...(_obj(d.gates) || {}) },
                street: { stayHome: { base: 0.35, perSev: 0.5, max: 0.75 }, stallAbandon: 0.9, shopShut: 0.7, neverShut: [], boardAt: 0.3, bonfireAt: 0.25, bonfires: 3, burnDays: 3, doctorAt: 0.2, doctorLayers: [], pitDeaths: 2, pitDays: 60, abandonMax: 6, bellEvery: [7, 12], contact: {}, ...(_obj(d.street) || {}) },
                nurse: { careMult: 0.6, regard: 6, karma: 1, deeds: {}, ...(_obj(A.nurse) || {}) },
                burn: { cleanseMult: 0.6, cleanseDays: 20, karma: 1, deeds: {}, ...(_obj(A.burn) || {}) },
                remedies: { goods: [], premiumBase: 1.3, premiumPerSev: 2.4, perDay: 12, greedAt: 2.2, deeds: {}, ...(_obj(A.remedies) || {}) },
                loot: { crime: 'burglary', crimeScale: 0.7, seenBase: 0.3, emptyStreets: 0.6, catch: 0.35, table: [], ...(_obj(A.loot) || {}) },
                lines: _obj(d.lines) || {},
            };
        }
        return _cfg;
    },

    /** A line from data lines[key], picked by a hash of `hashKey`. */
    line(key, hashKey = '') {
        const list = Plague.config().lines[key];
        if (!Array.isArray(list) || !list.length) return null;
        return list[(Utils.hashStr(`${key}|${hashKey}`) >>> 0) % list.length];
    },

    // ──────────── HOW BAD ────────────

    /** Is the sickness in this town the plague? */
    isPlague(world, s, day = null) {
        const d = day == null ? _num(world && world.day, 1) : day;
        const sk = Illness.townSickness(s, d);
        if (sk && sk.k && (Illness.def(sk.k) || {}).plague) return true;
        return !!Plague._crisisTown(world, s, d);
    },

    /** The great plague's record of this town while its course runs, or null. */
    _crisisTown(world, s, day) {
        let c = null;
        try { c = Crises.active(world); } catch (e) { c = null; }
        if (!c || c.kind !== 'plague' || !c.data || !c.data.towns || !s) return null;
        const t = c.data.towns[_key(s)];
        return t && day >= _num(t.start) && day <= _num(t.end) ? t : null;
    },

    /**
     * How bad the sickness in a town is, 0 (none) .. 1 (the streets empty, the
     * carts full). Public: the street map, the migration of families, the talk.
     */
    severityAt(world, s, day = null) {
        if (!s) return 0;
        const d = day == null ? _num(world && world.day, 1) : day;
        const C = Plague.config().severity;
        let sev = 0;
        const sk = Illness.on() ? Illness.townSickness(s, d) : null;
        if (sk && sk.k) {
            const def = Illness.def(sk.k) || {};
            const share = _num(sk.share);
            if (sk.abs) sev = def.plague ? _num(C.abstractPlague) : def.serious ? Math.max(_num(C.abstractOther), Math.min(_num(C.epiMax), share * _num(C.epiPerShare))) : 0;
            else if (def.plague) sev = _num(C.plagueBase) + share * _num(C.plaguePerShare);
            else if (def.serious && sk.epi) sev = Math.min(_num(C.epiMax), _num(C.epiBase) + share * _num(C.epiPerShare));
            else if (def.serious) sev = Math.min(_num(C.minorMax), share * _num(C.epiPerShare));
        }
        if (Plague._crisisTown(world, s, d)) sev = Math.max(sev, _num(C.crisisFloor));
        return _r3(_clamp(sev, 0, 1));
    },

    // ──────────── THE GATES ────────────

    /** Are this town's gates shut against the sickness (its own order, or the realm's law over a sick town)? */
    isQuarantined(world, s) {
        if (!s) return false;
        if (s.plagueGate && s.plagueGate.shut) return true;
        if (!Illness.quarantined(world, s)) return false;
        const sk = Illness.townSickness(s, _num(world && world.day, 1));
        return !!(sk && sk.k && (Illness.def(sk.k) || {}).serious);
    },

    /** How the player commands this town: 'hold' (theirs), 'realm' (they rule its realm) or null. */
    controls(player, world, s) {
        if (!player || !s) return null;
        if (s.owner != null && player.id != null && s.owner === player.id) return 'hold';
        let k = null;
        try { k = Laws.ruled(player, world); } catch (e) { k = null; }
        if (k && s.kingdom != null && k.id === s.kingdom) return 'realm';
        return null;
    },

    /** Why the guards let the player through a shut gate: 'rule' | 'hold' | 'house' | 'physic' | 'leave' | null. */
    permitted(player, world, s) {
        if (!player || !s) return null;
        const day = _num(world && world.day, 1);
        const ctl = Plague.controls(player, world, s);
        if (ctl === 'hold') return 'hold';
        if (ctl === 'realm') return 'rule';
        if (Array.isArray(player.houses) && player.houses.some(h => h && h.q === s.q && h.r === s.r)) return 'house';
        const fund = s.folk && s.folk.ill && s.folk.ill.fund;
        if ((fund && fund.by === 'player' && _num(fund.until) >= day) || (s.crisisCare && s.crisisCare.by === 'player' && _num(s.crisisCare.until) >= day)) return 'physic';
        const g = s.plagueGate;
        if (g && _num(g.leave, -1) >= day) return 'leave';
        return null;
    },

    /** What the guards would take to look the other way here. */
    bribeCost(s) {
        const B = Plague.config().gates.bribe || {};
        return Math.max(1, Math.round(_num(B[(s && s.type) || 'village'], 15)));
    },

    /**
     * May the player come in? → { ok, permitted, why, bribe }. Never asked
     * for the town they already stand in.
     */
    canEnter(player, world, s) {
        if (!s || !Plague.isQuarantined(world, s)) return { ok: true, permitted: null, why: '', bribe: 0 };
        const p = Plague.permitted(player, world, s);
        if (p) return { ok: true, permitted: p, why: '', bribe: 0 };
        const by = s.plagueGate && s.plagueGate.shut ? (s.plagueGate.by === 'law' ? 'by the law of the realm' : 'by order of its lord') : 'by the law of the realm';
        return { ok: false, permitted: null, why: `The gates of ${s.name} are shut against the sickness, ${by}. The guards turn you back.`, bribe: Plague.bribeCost(s) };
    },

    /** Shut a town's gates (by: 'ruler' | 'law' | 'player'). */
    shut(world, s, by, day = null) {
        if (!s) return false;
        const d = day == null ? _num(world && world.day, 1) : day;
        const prev = s.plagueGate || {};
        s.plagueGate = { shut: true, by: by || 'ruler', d, kid: s.kingdom != null ? s.kingdom : null, leave: prev.leave != null ? prev.leave : null };
        return true;
    },

    /** Open them again (the record of the leave kept while it runs). */
    open(world, s) {
        if (!s || !s.plagueGate) return false;
        const leave = s.plagueGate.leave;
        if (leave != null && leave >= _num(world && world.day, 1)) s.plagueGate = { shut: false, leave };
        else delete s.plagueGate;
        return true;
    },

    /** The player (who holds or rules the town) shuts or opens its gates. */
    setGates(player, world, s, shut) {
        if (!s) return { success: false, reason: 'There is no town here.' };
        if (!Plague.controls(player, world, s)) return { success: false, reason: `${s.name}'s gates are not yours to command.` };
        const day = _num(world && world.day, 1);
        const was = !!(s.plagueGate && s.plagueGate.shut);
        if (shut === was) return { success: false, reason: shut ? 'The gates are already shut.' : 'The gates are already open.' };
        if (shut) Plague.shut(world, s, 'player', day);
        else Plague.open(world, s);
        if (!s.plague) s.plague = {};
        s.plague.asked = day;
        return {
            success: true,
            text: shut
                ? `By your order the gates of ${s.name} are shut and barred. Travellers are turned away, trade halts at the walls, and the sickness crosses to the towns about a fraction as often.`
                : `By your order the gates of ${s.name} are thrown open. The carts roll in again — and whatever rides with them.`,
        };
    },

    /** Slip the gate guards a coin to be let in (a crime, if they are caught at it). */
    bribeGate(player, world, s, rnd = Utils.random) {
        if (!player || !s) return { success: false, reason: 'There is no gate here.' };
        if (!Plague.isQuarantined(world, s)) return { success: false, reason: 'The gates are open.' };
        const G = Plague.config().gates;
        const cost = Plague.bribeCost(s);
        if (_num(player.gold) < cost) return { success: false, reason: `The guards want ${cost} gold.` };
        const day = _num(world && world.day, 1);
        player.gold -= cost;
        // The coin goes to the watch — into the town's purse, near enough
        Economy.payTown(s, cost);
        const g = s.plagueGate || (s.plagueGate = { shut: false });
        g.leave = day + Math.max(1, Math.round(_num(G.bribeDays, 3)));
        const caught = rnd() < _num(G.bribeCaught, 0.2);
        try { Underworld.recordCrime(player, world, 'smuggling', { kingdom: s.kingdom || null, caught, scale: _num(G.bribeScale, 0.5), q: s.q, r: s.r }); } catch (e) { /* no underworld */ }
        return {
            success: true, cost, caught,
            text: caught
                ? `You press ${cost} gold into a guard's palm and he lets you through — but his sergeant saw it. Word of it will go round.`
                : `You press ${cost} gold into a guard's palm. He looks the other way while you slip in. Be gone in ${G.bribeDays} days.`,
        };
    },

    // ──────────── THE DAY ────────────

    /**
     * The daily hook (ui/game/endDay.js, after the sicknesses): rulers shut
     * and open their towns' gates; a town the player holds tells them.
     * @returns {{ notices: Array<{icon,title,text,type}> }}
     */
    processDay(world, player = null) {
        const out = { notices: [] };
        if (!world) return out;
        const day = _num(world.day, 1);
        const G = Plague.config().gates;
        const here = player && typeof world.getTile === 'function' ? world.getTile(player.q, player.r) : null;
        const near = s => !!(player && Number.isFinite(player.q) && Math.max(Math.abs(s.q - player.q), Math.abs(s.r - player.r)) <= 6);
        for (const s of _views(world)) {
            if (!s || !Number.isFinite(s.q)) continue;
            const sev = Plague.severityAt(world, s, day);
            if (sev > 0) (s.plague || (s.plague = {})).last = day;
            const st = s.plague;
            if (st && st.cleanse && _num(st.cleanse.until) < day) delete st.cleanse;
            const g = s.plagueGate;
            if (g && !g.shut && !(_num(g.leave, -1) >= day)) delete s.plagueGate;
            const plague = sev > 0 && Plague.isPlague(world, s, day);
            const ctl = Plague.controls(player, world, s);
            let law = false;
            try { law = s.kingdom != null && Laws.value(world, s.kingdom, 'pestilence') === 'quarantine'; } catch (e) { law = false; }
            if (!(s.plagueGate && s.plagueGate.shut)) {
                if (!(sev >= (plague ? _num(G.closeAtPlague, 0.25) : _num(G.closeAt, 0.3)))) continue;
                if (ctl === 'hold') {
                    // Theirs to shut: told once an outbreak
                    if (!(st && _num(st.asked, -9999) >= _num(st.since, day))) {
                        s.plague.asked = day;
                        s.plague.since = s.plague.since || day;
                        out.notices.push({ icon: '🚧', title: `Sickness in ${s.name}`, type: 'warning', text: `${plague ? 'The plague' : 'An epidemic'} is in ${s.name}, which is yours. Shut its gates to keep it from the towns about (and halt its trade) — from the Sick of the Town, there.` });
                    }
                    continue;
                }
                // A realm the player rules follows its own law; another ruler weighs it weekly
                const weekly = ((day + (Utils.hashStr(_key(s)) >>> 0) % 7) % 7) === 0;
                const shut = law || (ctl !== 'realm' && weekly && _roll(world, `shut|${_key(s)}|${day}`) < (plague ? _num(G.plagueChance, 0.75) : _num(G.closeChance, 0.45)));
                if (!shut) continue;
                Plague.shut(world, s, law ? 'law' : 'ruler', day);
                (s.plague || (s.plague = {})).since = s.plague.since || day;
                if (near(s) || (here && here.settlement === s)) out.notices.push({ icon: '🚧', title: `${s.name} Shuts Its Gates`, type: 'warning', text: `For fear of the ${plague ? 'plague' : 'sickness'}, ${s.name}'s gates are shut and barred. No one goes in or out without leave, and its trade dries up.` });
            } else {
                const gs = s.plagueGate;
                // A week shut: the town frets (no trade, no news)
                if ((day - _num(gs.d)) % 7 === 6) s.happiness = _clamp(_num(s.happiness, 50) + _num(G.happiness, -1), 0, 100);
                const clean = sev <= 0 && day - _num(st && st.last, gs.d) >= _num(G.openAfterDays, 14) && day - _num(gs.d) >= _num(G.minDays, 21);
                if (!clean) continue;
                if (gs.by === 'player') {
                    if (ctl && !(st && _num(st.toldClean, -1) >= _num(gs.d))) {
                        s.plague.toldClean = day;
                        out.notices.push({ icon: '🚧', title: `${s.name} Is Clean`, type: 'info', text: `No one has been sick in ${s.name} for ${G.openAfterDays} days. You may open its gates again.` });
                    }
                    continue;
                }
                if (gs.by === 'law' && law) continue;
                Plague.open(world, s);
                if (s.plague) { delete s.plague.since; delete s.plague.asked; }
                if (near(s) || (here && here.settlement === s)) out.notices.push({ icon: '🚪', title: `${s.name} Opens Its Gates`, type: 'success', text: `The sickness has passed from ${s.name}. Its gates stand open again and the carts roll in.` });
            }
        }
        return out;
    },

    // ──────────── THE STREET MAP'S PICKS ────────────
    // (hashes of the town, the place and the day: the same all day, no stream drawn)

    /** The plague dead of the town these `days` (folk.ill.deaths). */
    deaths(s, day, days = null) {
        const D = s && s.folk && s.folk.ill && s.folk.ill.deaths;
        if (!Array.isArray(D)) return 0;
        const span = days == null ? _num(Plague.config().street.pitDays, 60) : days;
        let n = 0;
        for (const e of D) if (e && day - _num(e.d) <= span && day >= _num(e.d) && (Illness.def(e.k) || {}).plague) n++;
        return n;
    },

    /** The healthy keep indoors this share of the hours. */
    stayHome(sev) {
        const S = Plague.config().street.stayHome || {};
        return Math.min(_num(S.max, 0.75), _num(S.base, 0.35) + _num(S.perSev, 0.5) * sev);
    },

    /** Is this stall left with its wares under a cloth today? */
    stallAbandoned(sev, key, townKey, day) {
        return sev > 0 && _frac('stall', townKey, key, day) < sev * _num(Plague.config().street.stallAbandon, 0.9);
    },

    /** Is this shop shuttered against the plague today? */
    shopShut(sev, type, key, townKey, day) {
        const S = Plague.config().street;
        if (!(sev > 0) || (S.neverShut || []).includes(type)) return false;
        return _frac('shop', townKey, key, day) < sev * _num(S.shopShut, 0.7);
    },

    // ──────────── THE PLAYER'S HAND ────────────

    _st(s) { return s.plague || (s.plague = {}); },

    /**
     * Nurse the sick laid up in a house (the street map hands over who lies
     * there). → { success, text, contact, karma } or a reason.
     */
    nurse(player, world, s, people, houseKey) {
        const day = _num(world && world.day, 1);
        const sick = (people || []).filter(p => p && p.ill && Illness.isSick(p, day));
        if (!s || !sick.length) return { success: false, reason: 'No one in this house is sick.' };
        const N = Plague.config().nurse;
        const st = Plague._st(s);
        st.nursed = _obj(st.nursed) || {};
        for (const p of sick) {
            p.ill.hl = Math.min(_num(p.ill.hl, 1), _num(N.careMult, 0.6));
            p.ill.fam = true;
            p.ill.v = _num(p.ill.v) + 1;
            p.ill.vd = day;
            if (p.mem) p.mem.disposition = _clamp(_num(p.mem.disposition, 50) + _num(N.regard, 6), 0, 100);
            Townsfolk.note(p, day, 'nursed', null, 'medicine');
        }
        let karma = 0;
        if (player && st.nursed[houseKey] !== day) {
            karma = _num(N.karma, 1);
            player.karma = _num(player.karma) + karma;
            try { Traits.recordDeeds(player, N.deeds || {}); } catch (e) { /* none */ }
            try { NpcMemory.rememberTown(world, s, { kind: 'healed', player, day }); } catch (e) { /* none */ }
        }
        st.nursed[houseKey] = day;
        const k = sick[0].ill.k;
        const names = sick.slice(0, 3).map(p => p.first || Townsfolk.name(p));
        return {
            success: true, karma, k, contact: _num(Plague.config().street.contact.nurse, 4),
            text: `You sit with ${names.join(' and ')}${sick.length > 3 ? ` and ${sick.length - 3} more` : ''} — water, a cool cloth, the bedding changed. It is close in there, and the smell of it stays with you.`,
        };
    },

    /** Has a dead household's goods been burnt at this house? */
    burnt(s, houseKey) { return !!(s && s.plague && s.plague.burnt && s.plague.burnt[houseKey] != null); },

    /** Has this house been looted? */
    looted(s, houseKey) { return !!(s && s.plague && s.plague.looted && s.plague.looted[houseKey] != null); },

    /** Burn a dead household's bedding and clothes before its door: the town's spread slowed a while. */
    burnGoods(player, world, s, houseKey) {
        if (!s) return { success: false, reason: 'There is no town here.' };
        if (Plague.burnt(s, houseKey)) return { success: false, reason: 'Their goods are ash already.' };
        if (Plague.looted(s, houseKey)) return { success: false, reason: 'Someone has carried off what was in it.' };
        const B = Plague.config().burn;
        const day = _num(world && world.day, 1);
        const st = Plague._st(s);
        st.burnt = _obj(st.burnt) || {};
        st.burnt[houseKey] = day;
        const prev = st.cleanse && _num(st.cleanse.until) >= day ? st.cleanse : null;
        st.cleanse = { until: Math.max(prev ? prev.until : 0, day + Math.round(_num(B.cleanseDays, 20))), mult: _num(B.cleanseMult, 0.6) };
        if (player) {
            player.karma = _num(player.karma) + _num(B.karma, 1);
            try { Traits.recordDeeds(player, B.deeds || {}); } catch (e) { /* none */ }
            try { NpcMemory.rememberTown(world, s, { kind: 'healed', player, day }); } catch (e) { /* none */ }
        }
        return {
            success: true, contact: _num(Plague.config().street.contact.burn, 1),
            text: `You drag out the dead's straw ticks, blankets and clothes and put them to the torch before the door. The smoke is black and foul. For ${B.cleanseDays} days the sickness goes the slower through ${s.name}.`,
        };
    },

    /** What a remedy fetches here now (the good's price × the market's scarcity × the plague's premium). */
    remedyPrice(world, s, good) {
        const R = Plague.config().remedies;
        let base = PlayerInventory.goodValue(good);
        if (!(base > 0)) return 0;
        try { base *= _clamp(_num(SettlementMarket.scarcity(s, good), 1), 0.5, 3); } catch (e) { /* the base price */ }
        const sev = Plague.severityAt(world, s);
        return Math.max(1, Math.round(base * (_num(R.premiumBase, 1.3) + _num(R.premiumPerSev, 2.4) * sev)));
    },

    /** The remedies in the player's packs that sell here: [{ id, qty, price }]. */
    remedies(player, world, s) {
        const inv = (player && player.inventory) || {};
        return (Plague.config().remedies.goods || []).filter(g => _num(inv[g]) > 0).map(g => ({ id: g, qty: _num(inv[g]), price: Plague.remedyPrice(world, s, g) }));
    },

    /**
     * Sell remedies to the frightened at a plague price: coin out of the
     * townsfolk's purses (the fullest first; the town's purse where it keeps
     * no roster), each remedy to a sick house. → { success, text, gold, n, greedy }
     */
    sellRemedies(player, world, s) {
        if (!player || !s) return { success: false, reason: 'There is no one here to sell to.' };
        const day = _num(world && world.day, 1);
        const sev = Plague.severityAt(world, s, day);
        if (!(sev > 0)) return { success: false, reason: `No one in ${s.name} is sick enough to pay over the odds.` };
        const R = Plague.config().remedies;
        const st = Plague._st(s);
        const sold = st.sold && st.sold.d === day ? st.sold : (st.sold = { d: day, n: 0 });
        let left = Math.max(0, Math.round(_num(R.perDay, 12)) - sold.n);
        if (!left) return { success: false, reason: 'The town has bought all the physic it can pay for today.' };
        const folk = s.folk && Array.isArray(s.folk.people) ? s.folk : null;
        const buyers = folk ? Townsfolk.residents(folk).filter(p => Townsfolk.age(p, day) >= 16).sort((a, b) => Townsfolk.purse(folk, b, world) - Townsfolk.purse(folk, a, world) || a.id - b.id) : [];
        const sick = folk ? Townsfolk.residents(folk).filter(p => Illness.isSick(p, day)).sort((a, b) => _num(b.ill.sv) - _num(a.ill.sv) || a.id - b.id) : [];
        let gold = 0, n = 0, greedy = 0, bi = 0, si = 0;
        for (const r of Plague.remedies(player, world, s)) {
            const fair = Math.max(1, PlayerInventory.goodValue(r.id));
            while (left > 0 && _num(player.inventory[r.id]) > 0) {
                // Who can pay: the fullest purse that still holds the price
                let paid = 0;
                if (folk) {
                    while (bi < buyers.length && Townsfolk.purse(folk, buyers[bi], world) < r.price) bi++;
                    if (bi >= buyers.length) break;
                    const b = buyers[bi];
                    b.purse = Townsfolk.purse(folk, b, world) - r.price;
                    paid = r.price;
                } else {
                    paid = Economy.drawTown(s, r.price);
                    if (paid < r.price) { if (paid > 0) Economy.payTown(s, paid); break; }
                }
                player.inventory[r.id] -= 1;
                if (player.inventory[r.id] <= 0) delete player.inventory[r.id];
                gold += paid;
                n++;
                left--;
                if (r.price > fair * _num(R.greedAt, 2.2)) greedy++;
                // The remedy goes to a sick house
                const p = sick[si++ % Math.max(1, sick.length)];
                if (p && p.ill && p.ill.gift !== 'medicine') p.ill.gift = 'medicine';
            }
        }
        if (!n) return { success: false, reason: folk ? 'No one here can pay what the remedies fetch.' : `${s.name} has no coin to spare.` };
        sold.n += n;
        player.gold = _num(player.gold) + gold;
        if (greedy) {
            player.karma = _num(player.karma) - greedy;
            try { Traits.recordDeeds(player, Object.fromEntries(Object.entries(R.deeds || {}).map(([k, v]) => [k, _num(v) * greedy]))); } catch (e) { /* none */ }
            if (greedy >= 3) { try { NpcMemory.rememberTown(world, s, { kind: 'spoke_ill', player, day }); } catch (e) { /* none */ } }
        }
        return {
            success: true, gold, n, greedy,
            text: `You sell ${n} remed${n === 1 ? 'y' : 'ies'} to the frightened of ${s.name} for ${gold} gold${greedy ? ' — a plague price, and they know it' : ''}.`,
        };
    },

    /**
     * Loot a dead household's house: what the dead left in their purses, and
     * what the table rolls. A burglary (seen the less on empty streets), and
     * the goods may carry the plague. → { success, text, gold, items, seen, caught }
     */
    lootHouse(player, world, s, houseKey, dead = [], rnd = Utils.random) {
        if (!player || !s) return { success: false, reason: 'There is nothing here.' };
        if (Plague.looted(s, houseKey)) return { success: false, reason: 'Someone has been here before you. The chests stand open and empty.' };
        if (Plague.burnt(s, houseKey)) return { success: false, reason: 'Their goods were burnt before the door.' };
        const L = Plague.config().loot;
        const day = _num(world && world.day, 1);
        const sev = Plague.severityAt(world, s, day);
        const st = Plague._st(s);
        st.looted = _obj(st.looted) || {};
        st.looted[houseKey] = day;
        // What the dead left in their purses (no heir has it yet)
        let gold = 0;
        for (const p of dead || []) {
            const g = Math.floor(_num(p && p.purse));
            if (g > 0) { gold += g; p.purse -= g; }
        }
        const items = {};
        for (const [id, ch, lo, hi] of L.table || []) {
            if (rnd() < _num(ch)) items[id] = (items[id] || 0) + Math.max(1, Math.round(_num(lo, 1) + rnd() * (_num(hi, 1) - _num(lo, 1))));
        }
        player.gold = _num(player.gold) + gold;
        const got = PlayerInventory.addItems(player, items);
        const seen = rnd() < _num(L.seenBase, 0.3) * (1 - sev * _num(L.emptyStreets, 0.6));
        try { Underworld.recordCrime(player, world, L.crime || 'burglary', { kingdom: s.kingdom || null, caught: seen, scale: _num(L.crimeScale, 0.7), q: s.q, r: s.r, victim: { name: 'the dead', type: 'peasant', icon: '🕯️' } }); } catch (e) { /* none */ }
        if (seen) { try { NpcMemory.rememberTown(world, s, { kind: 'robbed', player, day }); } catch (e) { /* none */ } }
        // The dead's goods carry it
        let caught = null;
        if (Plague.isPlague(world, s, day) && rnd() < _num(L.catch, 0.35) * Math.max(0.3, sev)) {
            try { if (Ailments.def('plague') && !Ailments.has(player, 'plague')) caught = Ailments.inflict(player, world, 'plague', { source: 'looting' }); } catch (e) { caught = null; }
        }
        const what = Object.entries(got.added).map(([id, q]) => `${q} ${id.replace(/_/g, ' ')}`);
        const text = `${gold || what.length ? `You take ${[gold ? `${gold} gold from the dead's purses` : null, ...what].filter(Boolean).join(', ')}.` : 'You turn the house over and find nothing worth the risk.'}`
            + (seen ? ' Someone saw you come out — the watch will hear of a thief among the dead.' : '')
            + (caught ? ' That night the fever comes: the swellings in your armpits. The dead\'s goods carried it.' : '');
        return { success: true, gold, items: got.added, dropped: got.dropped, seen, caught: !!caught, contact: _num(Plague.config().street.contact.loot, 5), text };
    },

    // ──────────── AT A GLANCE ────────────

    /** The town's pestilence for the panel: severity, gates, who commands them, what the player may do. */
    view(player, world, s) {
        const day = _num(world && world.day, 1);
        const sev = Plague.severityAt(world, s, day);
        const g = s && s.plagueGate;
        return {
            sev,
            plague: sev > 0 && Plague.isPlague(world, s, day),
            quarantined: Plague.isQuarantined(world, s),
            gate: g ? { ...g } : null,
            controls: Plague.controls(player, world, s),
            permitted: Plague.permitted(player, world, s),
            deaths: Plague.deaths(s, day),
            cleanse: s && s.plague && s.plague.cleanse && _num(s.plague.cleanse.until) >= day ? { ...s.plague.cleanse } : null,
            remedies: Plague.remedies(player, world, s),
            bribe: Plague.bribeCost(s),
        };
    },
};
