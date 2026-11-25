// ============================================
// BLOOD FEUDS — a killing makes the dead one's kin owe vengeance
// ============================================
// The game kept grudges person by person: a townsperson's memory of the
// player (systems/npcMemory.js), a child's blood debt that grows into an
// avenger (systems/wanted.js → systems/nemesis.js), a rival House's feud score
// (systems/rivalHouses.js), a lord's vendetta (world/npcLords.js), two
// townsfolk's street grudge (systems/brawls.js). This layer is the FAMILY's
// debt of blood: who killed whose kin, owed by one line to another, handed
// down the generations, and paid in blood, silver or a marriage.
//
//   SIDES      a townsfolk family (a surname in a town: everyone living there
//              born to it or wed out of it), a rival House (house.rivals[k]),
//              a realm's ruling line, and the player's own House. A feud is
//              { sides: [A, B], owes: the side with unavenged dead, heat,
//              deaths, gens, bearers }.
//   KILLINGS   by the player (every death the townsfolk's memory pins on the
//              House — a murder seen, a hanging, a burning, a starving,
//              torture — through NpcMemory.rememberKin; a rival House's head
//              cut down; a ruler assassinated), by townsfolk (a brawl that
//              bleeds, a trial by combat), by a House's men (a guard cut down
//              by raiders). A lawful death (the rope) lights a feud only when
//              the kin deem it unjust (a hash roll by kind; an innocent always).
//              A lone soul with no kin in town leaves no one to swear.
//   THE YEARS  heat cools each year (the realm's bloodPrice law sets how fast)
//              and flares on every killing. When the one who carries it dies
//              — the family's eldest grown kinsman, a House's head, your own
//              House at a succession — the next takes it up, a little cooler
//              (generations), or lets it lie.
//   AVENGERS   against your House, a month at a time and capped: the family
//              refuses to deal with you (NpcDisposition reads refusesTrade),
//              stands witness at your trial in their town (Trials odds read
//              witnessesAgainst), speaks against you in the realm, waylays you
//              on the road or puts a knife in you in town (a wound; one blow in
//              blowGapDays across every feud), and at the hottest hires a blade
//              (a sworn nemesis: Nemesis.wrong). A rival House carrying blood
//              keeps its feud score hot (its own waylaying and plots act).
//   SETTLING   a blood price (wergild: the dead's rank × the law's tariff,
//              paid into the bereaved's real purse before the arbiter the law
//              names — the priest and council take a tithe into the town's
//              purse, the crown's justiciar into the treasury); a match
//              between the families (your child promised into their House,
//              systems/betrothals.js; townsfolk wed one of each family); or
//              wiping out the other family by your own hand (huge infamy).
//              Settling also pays off the Wanted blood debts of that family,
//              ends the nemesis it raised, and softens the kin's memory.
//   THE WORLD  townsfolk families and rival Houses feud among themselves: an
//              avenger strikes now and then (one killing per feud a year at
//              most, one in the world every worldKillGap days), the town keeps
//              it in its annals (the town's news) and its mood (a 'feud' mark,
//              systems/townMemory.js), and the council or a priest settles it
//              with wergild moved from purse to purse, or a wedding. The
//              player may sit in judgement on a feud in a town they hold.
//
// Rules: explicit params, no domain globals; every roll is a hash of the world
// seed and a key (no shared dice, so the goldens stand). State on
// world.bloodFeuds (saved, systems/saveLoad.js). Tuning in data/bloodFeuds.json,
// the law in data/laws.json (bloodPrice).

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Interrupts } from '../core/interrupts.js';
import { Names } from '../core/names.js';
import { Economy } from '../world/economy.js';
import { MoneySupply } from '../world/moneySupply.js';
import { NPCLords } from '../world/npcLords.js';
import { Townsfolk } from './townsfolk.js';
import { House } from './house.js';
import { RivalHouses } from './rivalHouses.js';
import { Laws } from './laws.js';
import { Ledger } from './ledger.js';
import { Ailments } from './ailments.js';
import { Atrocities } from './atrocities.js';
import { TownMemory } from './townMemory.js';
// (the avenger who hires a blade, a family's nemesis ended by a settlement: run time only)
import { Nemesis } from './nemesis.js';
// (a family's blood debts paid off with the feud: run time only)
import { Wanted } from './wanted.js';
// (the kin's memory softened by a blood price: run time only)
import { NpcMemory } from './npcMemory.js';
// (a match between the Houses: run time only)
import { Betrothals } from './betrothals.js';
import { Taxation } from './marketDynamics.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = (world) => Math.floor(_num(world && world.day));
const _r1 = (v) => Math.round(v * 10) / 10;
const _clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function _seed(world) {
    const p = world && world.generationParams;
    return (p && p.seed) || 0;
}

/** A roll in [0,1): a hash of the world seed and the key. */
function _u(world, key) {
    return (_hash(`${_seed(world)}|bf|${key}`) % 100000) / 100000;
}

function _fill(text, vars) {
    return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

function _pname(p) {
    return p ? `${p.first}${p.last ? ` ${p.last}` : ''}` : 'someone';
}

function _tile(world, q, r) {
    return world && typeof world.getTile === 'function' && Number.isFinite(q) ? world.getTile(q, r) : null;
}

function _settlement(world, q, r) {
    const t = _tile(world, q, r);
    return (t && t.settlement) || null;
}

function _kingdom(world, id) {
    if (!world || id == null) return null;
    if (typeof world.getKingdom === 'function') return world.getKingdom(id) || null;
    return (world.kingdoms || []).find(k => k && k.id === id) || null;
}

const DEFAULTS = {
    enabled: true, daysPerYear: 120, maxOpen: 40, maxNpcOpen: 20, maxPast: 24, maxDeaths: 8, maxActs: 8,
    fadeBelow: 8, coolPerYear: 7, comeOfAge: 16, inherit: { share: 0.8, letGoBelow: 15 },
    kinds: { murdered: { heat: 60, label: 'murdered' } },
    ranks: { low: 40, commoner: 80 }, roleRanks: {}, npcShare: 0.25,
    wergild: { heatDiv: 200, genShare: 0.8, base: 0.55, perDiplomacy: 0.03, perHeat: 0.004, min: 0.1, max: 0.95, feeShare: 0.1, refuseHeat: 4, cooldown: 60, amendsRep: 3 },
    marriage: { askShare: 0.5, minAge: 17, maxAge: 35 },
    wipe: { butcher: 30, karma: 20, reputation: 20, grief: -6, long: 4 },
    acts: {
        perHeatDiv: 280, gapDays: 45, blowAt: 55, blowGapDays: 300,
        blow: { base: 0.55, perMartial: 0.04, perMan: 0.002, maxMen: 0.25, companion: 0.08, min: 0.1, max: 0.75, health: [6, 16], wounds: ['gash'], sate: 18, slainChance: 0.2, foiledHeat: 5 },
        slander: { rep: [2, 5] }, refuseAt: 20, testifyAt: 25, perWitness: 0.25, maxWitnesses: 3, hireAt: 70, hireScore: 55, houseFloor: 0.7,
    },
    npc: { killAt: 40, killPerHeat: 0.0012, feudKillGap: 360, worldKillGap: 150, settleBase: 0.35, marryShare: 0.35, feeShare: 0.1, grudgeAt: 60, grudgeChance: 0.35, houseTieAt: -60, houseChance: 0.15, markMood: -2, markYears: 3 },
    text: {},
};

const LAW_DEFAULT = { tariff: 1, accept: 0, cool: 1, avenge: 1, arbiter: 'priest' };

export const BloodFeuds = {
    // ──────────── CONFIG & STATE ────────────

    config() {
        const d = _obj(DataLoader._gamedata && DataLoader._gamedata.bloodFeuds) || {};
        const C = { ...DEFAULTS, ...d };
        for (const k of ['inherit', 'wergild', 'marriage', 'wipe', 'npc', 'text']) C[k] = { ...DEFAULTS[k], ...(_obj(d[k]) || {}) };
        C.acts = { ...DEFAULTS.acts, ...(_obj(d.acts) || {}) };
        C.acts.blow = { ...DEFAULTS.acts.blow, ...(_obj(d.acts && d.acts.blow) || {}) };
        C.kinds = _obj(d.kinds) || DEFAULTS.kinds;
        C.ranks = { ...DEFAULTS.ranks, ...(_obj(d.ranks) || {}) };
        return C;
    },

    _text(key, fallback = '') {
        const t = BloodFeuds.config().text[key];
        return typeof t === 'string' ? t : fallback;
    },

    kindDef(kind) {
        return BloodFeuds.config().kinds[kind] || null;
    },

    state(world) {
        if (!world) return { v: 1, n: 1, list: [], past: [], lastNpcKill: -1e9, lastAct: -1e9, lastBlow: -1e9, lastMonth: -1e9, pending: [], playerGen: null };
        if (!_obj(world.bloodFeuds) || world.bloodFeuds.v !== 1) world.bloodFeuds = { v: 1, n: 1, list: [], past: [], lastNpcKill: -1e9, lastAct: -1e9, lastBlow: -1e9, lastMonth: -1e9, pending: [], playerGen: null };
        const st = world.bloodFeuds;
        if (!Array.isArray(st.list)) st.list = [];
        if (!Array.isArray(st.past)) st.past = [];
        if (!Array.isArray(st.pending)) st.pending = [];
        return st;
    },

    serialize(world) {
        return world && _obj(world.bloodFeuds) ? JSON.parse(JSON.stringify(world.bloodFeuds)) : null;
    },

    restore(saved, world) {
        if (!world) return;
        world.bloodFeuds = _obj(saved) && saved.v === 1 ? JSON.parse(JSON.stringify(saved)) : null;
        BloodFeuds.state(world);
    },

    /** The realm's bloodPrice law (data/laws.json) as numbers: { id, tariff, accept, cool, avenge, arbiter }. */
    law(world, kingdomId) {
        const o = kingdomId != null ? Laws.option(world, kingdomId, 'bloodPrice') : null;
        if (!o) return { id: 'customary', ...LAW_DEFAULT };
        return { id: o.id, tariff: _num(o.tariff, 1), accept: _num(o.accept), cool: _num(o.cool, 1), avenge: _num(o.avenge, 1), arbiter: o.arbiter || 'priest' };
    },

    // ──────────── SIDES ────────────

    /** The player's House as a side. */
    playerSide(player) {
        const name = (player && player.house && player.house.name) || (player && player.name ? `House of ${player.name}` : 'your House');
        return { kind: 'player', key: 'player', name };
    },

    /** A townsfolk family: a surname in a town. */
    folkSide(s, last) {
        return { kind: 'folk', key: `folk:${s.q},${s.r}:${last}`, q: s.q, r: s.r, last, town: s.name || null, kingdomId: s.kingdom != null ? s.kingdom : null, name: `${last} family` };
    },

    houseSide(rival) {
        return { kind: 'house', key: `house:${rival.kingdomId}`, kingdomId: rival.kingdomId, name: rival.name || 'a rival House' };
    },

    lordSide(k) {
        return { kind: 'lord', key: `lord:${k.id}`, kingdomId: k.id, name: `royal house of ${Names.realm(k.name)}` };
    },

    /** The words for a side ("Miller family", "House Voss"). */
    sideName(side) {
        return side ? side.name : 'a family';
    },

    _folk(world, side) {
        const s = _settlement(world, side.q, side.r);
        return s && s.folk && Array.isArray(s.folk.people) ? { s, folk: s.folk } : null;
    },

    /** The living members of a townsfolk family, here in town. */
    members(world, side, exclude = null) {
        if (!side || side.kind !== 'folk') return [];
        const f = BloodFeuds._folk(world, side);
        if (!f) return [];
        return f.folk.people.filter(p => p && p !== exclude && p.died == null && !p.away && (p.last === side.last || p.maiden === side.last));
    },

    _age(p, day) {
        return Townsfolk.age(p, day);
    },

    /** Who carries the feud for a side now: { id, name, person? } or null (nobody left). */
    bearer(world, player, side, exclude = null) {
        const day = _day(world);
        if (side.kind === 'player') return player ? { id: `player:${(player.house && player.house.generation) || 1}`, name: player.name || 'you' } : null;
        if (side.kind === 'folk') {
            const grown = BloodFeuds.members(world, side, exclude).filter(p => BloodFeuds._age(p, day) >= BloodFeuds.config().comeOfAge);
            if (!grown.length) return null;
            const pick = grown.filter(p => p.gender !== 'female').sort((a, b) => _num(a.born) - _num(b.born))[0]
                || grown.sort((a, b) => _num(a.born) - _num(b.born))[0];
            return { id: `p${pick.id}`, name: _pname(pick), person: pick };
        }
        if (side.kind === 'house') {
            const rv = BloodFeuds._rival(player, side.kingdomId);
            if (!rv || !rv.head) return null;
            return { id: `h${_num(rv.stats && rv.stats.heads, 1)}`, name: RivalHouses.headName(rv) };
        }
        if (side.kind === 'lord') {
            const k = _kingdom(world, side.kingdomId);
            if (!k || k.isAlive === false) return null;
            const name = (k.lord && k.lord.name) || k.ruler || `the ruler of ${Names.realm(k.name)}`;
            return { id: `l${name}`, name };
        }
        return null;
    },

    _rival(player, kingdomId) {
        const r = player && player.house && player.house.rivals;
        return r ? r[kingdomId] || null : null;
    },

    /** The rank of a dead townsperson (for the tariff). */
    folkRank(p, day) {
        if (!p) return 'commoner';
        if (BloodFeuds._age(p, day) < BloodFeuds.config().comeOfAge) return 'low';
        return BloodFeuds.config().roleRanks[p.role] || 'commoner';
    },

    tariff(rank) {
        return _num(BloodFeuds.config().ranks[rank], _num(BloodFeuds.config().ranks.commoner, 80));
    },

    // ──────────── THE BOOK ────────────

    open(world) {
        return BloodFeuds.state(world).list;
    },

    get(world, id) {
        return BloodFeuds.state(world).list.find(f => f.id === id) || null;
    },

    find(world, keyA, keyB) {
        return BloodFeuds.state(world).list.find(f => (f.sides[0].key === keyA && f.sides[1].key === keyB) || (f.sides[0].key === keyB && f.sides[1].key === keyA)) || null;
    },

    /** The index of the player's side in a feud (−1: not the player's feud). */
    playerIndex(f) {
        return f && f.sides ? f.sides.findIndex(s => s.kind === 'player') : -1;
    },

    /** Open feuds the player's House is party to. */
    ofPlayer(world) {
        return BloodFeuds.open(world).filter(f => BloodFeuds.playerIndex(f) >= 0);
    },

    /** Feuds a side is party to (by key). */
    ofSide(world, key) {
        return BloodFeuds.open(world).filter(f => f.sides[0].key === key || f.sides[1].key === key);
    },

    _note(world, f, kind, text) {
        if (!Array.isArray(f.acts)) f.acts = [];
        f.acts.unshift({ d: _day(world), kind, text });
        if (f.acts.length > BloodFeuds.config().maxActs) f.acts.length = BloodFeuds.config().maxActs;
    },

    /** A notice for the player (flushed by processDay), when the player is party or it is a world event worth hearing. */
    _tell(world, notice) {
        const st = BloodFeuds.state(world);
        st.pending.push(notice);
        if (st.pending.length > 12) st.pending.splice(0, st.pending.length - 12);
    },

    _chronicle(player, world, text, tags = ['feud']) {
        if (player && player.house) {
            try { House._chronicle(player.house, world, text, tags); } catch (e) { /* no chronicle */ }
        }
    },

    // ──────────── KILLINGS ────────────

    /**
     * A killing. spec: { victim: side, killer: side, dead: { name, rank, person? },
     * killerName, how (a kinds key), where: { q, r, town }, innocent, lawful,
     * byPlayer, player }. Creates the feud (the victim's side owes vengeance)
     * or flares the one there is. → the feud, or null (no kin to swear, a death
     * the kin take as just, the book full).
     */
    killing(world, spec = {}) {
        const C = BloodFeuds.config();
        if (!C.enabled || !world || !spec.victim || !spec.killer || spec.victim.key === spec.killer.key) return null;
        const def = BloodFeuds.kindDef(spec.how) || { heat: 40, label: 'killed' };
        const day = _day(world);
        const player = spec.player || null;
        const dead = spec.dead || { name: 'one of theirs', rank: 'commoner' };
        const st = BloodFeuds.state(world);
        let f = BloodFeuds.find(world, spec.victim.key, spec.killer.key);
        // A lawful death the kin accept (the rope for the guilty) lights nothing new
        const unjustKey = `${spec.victim.key}|${dead.name}|${day}|unjust`;
        if (!f && def.unjust != null && !spec.innocent && _u(world, unjustKey) >= _num(def.unjust)) return null;
        // (the same dead counted once: a hanging later found to have been wrongful flares, not doubles)
        if (f && f.deaths.some(x => x.name === dead.name && x.side === BloodFeuds._indexOf(f, spec.victim.key))) {
            f.heat = Math.min(100, _r1(f.heat + _num(def.heat) * 0.3));
            return f;
        }
        // Someone must be left to carry it
        const exclude = dead.person || null;
        if (spec.victim.kind === 'folk' && !BloodFeuds.members(world, spec.victim, exclude).length) {
            if (f && spec.byPlayer) return BloodFeuds._wiped(world, player, f, spec);
            return null;
        }
        const heat = _num(def.heat) * (spec.innocent ? 1.2 : 1);
        const rec = { d: day, name: dead.name, rank: dead.rank || 'commoner', how: spec.how, by: spec.killerName || BloodFeuds.sideName(spec.killer), side: 0 };
        const isNew = !f;
        if (!f) {
            const npc = spec.victim.kind !== 'player' && spec.killer.kind !== 'player';
            if (st.list.length >= C.maxOpen) return null;
            if (npc && st.list.filter(x => BloodFeuds.playerIndex(x) < 0).length >= C.maxNpcOpen) return null;
            f = {
                id: `bf${st.n++}`, sides: [{ ...spec.victim }, { ...spec.killer }], owes: 0, heat: 0, born: day, last: day,
                deaths: [], gens: [0, 0], bearers: [null, null], acts: [], lastKill: -1e9, nextOffer: day, place: spec.where || null,
                playerGen: player && player.house ? _num(player.house.generation, 1) : null,
            };
            f.bearers = [0, 1].map(i => { const b = BloodFeuds.bearer(world, player, f.sides[i], i === 0 ? exclude : null); return b ? b.id : null; });
            st.list.push(f);
        }
        const vi = BloodFeuds._indexOf(f, spec.victim.key);
        rec.side = vi;
        f.deaths.push(rec);
        if (f.deaths.length > C.maxDeaths) f.deaths.splice(0, f.deaths.length - C.maxDeaths);
        f.owes = vi;
        f.heat = Math.min(100, _r1(f.heat + heat));
        f.last = day;
        const vars = { dead: dead.name, how: def.label || 'killed', victims: BloodFeuds.sideName(spec.victim), killers: BloodFeuds.sideName(spec.killer), a: BloodFeuds.sideName(f.sides[0]), b: BloodFeuds.sideName(f.sides[1]) };
        // (spec.line: the caller's own words — blood owed for a maiming, where no one lies dead)
        const text = spec.line ? _fill(spec.line, vars) : isNew
            ? _fill(BloodFeuds._text(spec.killer.kind === 'player' ? 'bornYou' : 'born', '{dead} lies dead, and the {victims} swear vengeance on {killers}.'), vars)
            : _fill(BloodFeuds._text('flare', 'Fresh blood: {dead}. The feud burns hotter.'), vars);
        BloodFeuds._note(world, f, isNew ? 'born' : 'flare', text);
        const mine = BloodFeuds.playerIndex(f) >= 0;
        if (mine && !spec.quiet) {
            BloodFeuds._tell(world, { icon: '⚔️', title: isNew ? 'A Blood Feud' : 'The Feud Flares', text: `${text} See Dynasty → Blood Feuds.`, type: 'warning' });
            BloodFeuds._chronicle(player, world, text);
        }
        // The town keeps it: its news and its mood
        const where = spec.where || f.place;
        const s = where ? _settlement(world, where.q, where.r) : null;
        if (s && s.folk) BloodFeuds._annal(world, s, text);
        if (s && !mine) BloodFeuds._mark(world, s, f, dead.name);
        return f;
    },

    _indexOf(f, key) {
        return f.sides[0].key === key ? 0 : 1;
    },

    _annal(world, s, line) {
        try { Townsfolk.record(s.folk, world, _day(world), { k: 'bloodFeud', x: line.replace(/\.$/, '') + '.' }); } catch (e) { /* no annals */ }
    },

    _mark(world, s, f, deadName) {
        const N = BloodFeuds.config().npc;
        try { TownMemory.mark(s, 'feud', { mood: _num(N.markMood, -2), years: _num(N.markYears, 3), dead: deadName, a: f.sides[0].name, b: f.sides[1].name }, world); } catch (e) { /* no memory */ }
    },

    /** The player killed the last of a family: the feud ends in infamy. */
    _wiped(world, player, f, spec) {
        const C = BloodFeuds.config();
        const W = C.wipe;
        const day = _day(world);
        const side = spec.victim;
        if (player) {
            const at = Atrocities.state(player);
            if (at) at.butcher = Math.min(300, _num(at.butcher) + _num(W.butcher, 30));
            player.karma = _num(player.karma) - _num(W.karma, 20);
            if (side.kingdomId != null) {
                if (!player.reputation) player.reputation = {};
                player.reputation[side.kingdomId] = _num(player.reputation[side.kingdomId]) - _num(W.reputation, 20);
            }
        }
        const s = _settlement(world, side.q, side.r);
        const text = _fill(BloodFeuds._text('wiped', 'The last of the {side} is dead by your hand.'), { side: BloodFeuds.sideName(side) });
        if (s) {
            try { TownMemory.mark(s, 'atrocity', { grief: _num(W.grief, -6), long: _num(W.long, 4), line: `The last of the ${side.last} family was put in the ground {when}, and ${(player && player.name) || 'their killer'} walked free.` }, world); } catch (e) { /* no memory */ }
            if (s.folk) BloodFeuds._annal(world, s, `The last of the ${side.last} family is dead by ${(player && player.name) || 'a stranger'}'s hand`);
        }
        f.deaths.push({ d: day, name: (spec.dead && spec.dead.name) || 'the last of them', rank: (spec.dead && spec.dead.rank) || 'commoner', how: spec.how, by: spec.killerName || 'you', side: BloodFeuds._indexOf(f, side.key) });
        BloodFeuds._end(world, player, f, 'wiped', text);
        BloodFeuds._tell(world, { icon: '💀', title: 'A Family Wiped Out', text, type: 'error' });
        return f;
    },

    // ──────────── THE HOOKS ────────────

    /**
     * The townsfolk's memory pinned a death on the player's House
     * (NpcMemory.rememberKin: the person `p` of `folk`, a kind like 'murdered'
     * or 'hanged'). Only the kinds data/bloodFeuds.json names light a feud.
     */
    onKinMemory(world, player, folk, p, kind, opts = {}) {
        if (!world || !player || !folk || !p || !BloodFeuds.kindDef(kind) || !p.last) return null;
        // (only a death: a living victim's kin remember, they do not swear blood)
        if (p.died == null && !opts.dying && !['murdered', 'hanged', 'beheaded', 'burned', 'quartered', 'witch_burned', 'wrongly_condemned', 'starved', 'stocks_died', 'froze_evicted'].includes(kind)) return null;
        const s = _settlement(world, folk.q, folk.r);
        if (!s) return null;
        const day = _day(world);
        return BloodFeuds.killing(world, {
            player, victim: BloodFeuds.folkSide(s, p.last), killer: BloodFeuds.playerSide(player),
            dead: { name: _pname(p), rank: BloodFeuds.folkRank(p, day), person: p }, killerName: player.name || 'you',
            how: kind, where: { q: s.q, r: s.r, town: s.name }, innocent: kind === 'wrongly_condemned' || !!opts.innocent, byPlayer: true,
        });
    },

    /** One townsperson killed another (a brawl that bled, a trial by combat). */
    onFolkKilling(world, s, victim, killer, how = 'brawl', player = null) {
        if (!world || !s || !victim || !killer || !victim.last || !killer.last || victim.last === killer.last) return null;
        const day = _day(world);
        return BloodFeuds.killing(world, {
            player, victim: BloodFeuds.folkSide(s, victim.last), killer: BloodFeuds.folkSide(s, killer.last),
            dead: { name: _pname(victim), rank: BloodFeuds.folkRank(victim, day), person: victim }, killerName: _pname(killer),
            how, where: { q: s.q, r: s.r, town: s.name },
        });
    },

    /** A townsperson cut down by a rival House's men (a raid it paid for). */
    onHouseKilledFolk(world, player, s, victim, rival, how = 'raid') {
        if (!world || !s || !victim || !victim.last || !rival) return null;
        return BloodFeuds.killing(world, {
            player, victim: BloodFeuds.folkSide(s, victim.last), killer: BloodFeuds.houseSide(rival),
            dead: { name: _pname(victim), rank: BloodFeuds.folkRank(victim, _day(world)), person: victim }, killerName: rival.name,
            how, where: { q: s.q, r: s.r, town: s.name },
        });
    },

    /** The player's hand (or men) killed one of a rival House: its head, or kin. */
    onHouseBlood(world, player, rival, deadName, how = 'battle', head = true) {
        if (!world || !player || !rival) return null;
        return BloodFeuds.killing(world, {
            player, victim: BloodFeuds.houseSide(rival), killer: BloodFeuds.playerSide(player),
            dead: { name: deadName || RivalHouses.headName(rival), rank: head ? 'houseHead' : 'houseKin' }, killerName: player.name || 'you',
            how, byPlayer: true,
        });
    },

    /** The player's hand killed a ruler or royal kin (an assassination). */
    onLordBlood(world, player, kingdom, deadName, how = 'assassinated', ruler = true) {
        if (!world || !player || !kingdom) return null;
        return BloodFeuds.killing(world, {
            player, victim: BloodFeuds.lordSide(kingdom), killer: BloodFeuds.playerSide(player),
            dead: { name: deadName || 'the ruler', rank: ruler ? 'lord' : 'lordKin' }, killerName: player.name || 'you', how, byPlayer: true,
        });
    },

    // ──────────── ENDINGS ────────────

    _end(world, player, f, how, text) {
        const st = BloodFeuds.state(world);
        f.ended = { d: _day(world), how, text };
        st.list = st.list.filter(x => x !== f);
        st.past.unshift({ id: f.id, sides: f.sides, born: f.born, deaths: f.deaths.length, gens: f.gens, ended: f.ended, mine: BloodFeuds.playerIndex(f) >= 0 });
        if (st.past.length > BloodFeuds.config().maxPast) st.past.length = BloodFeuds.config().maxPast;
        if (BloodFeuds.playerIndex(f) >= 0) BloodFeuds._chronicle(player, world, text);
        return f;
    },

    /** A feud ended by a settlement: the Wanted blood debts of that family paid, its nemesis at peace, the kin's memory softened. */
    _settledRipples(world, player, f) {
        if (!player || BloodFeuds.playerIndex(f) < 0) return;
        const other = f.sides[1 - BloodFeuds.playerIndex(f)];
        if (other.kind === 'folk') {
            try {
                const ws = Wanted.state(player);
                for (const d of ws.debts || []) {
                    if (d.paid || d.risen || d.town !== other.town || d.last !== other.last) continue;
                    d.paid = true;
                    d.closedDay = _day(world);
                }
            } catch (e) { /* no wanted */ }
            const soften = _num(Wanted.config && Wanted.config().weregild && Wanted.config().weregild.memorySoften, 0.3);
            const f2 = BloodFeuds._folk(world, other);
            for (const p of BloodFeuds.members(world, other)) {
                for (const e of p.nm || []) if (e && _num(e.w) < 0 && BloodFeuds.kindDef(e.k)) e.w = Math.round(_num(e.w) * soften);
            }
            const b = BloodFeuds.bearer(world, player, other);
            if (b && b.person && f2) {
                try { NpcMemory.remember(world, { folk: f2.folk, person: b.person }, { kind: 'amends', player }); } catch (e) { /* no memory */ }
            }
            // The nemesis this family raised lays down the feud
            try {
                for (const nm of Nemesis.active(player).slice()) {
                    const ref = nm.ref && nm.ref.folkRef;
                    const m = typeof ref === 'string' ? /^(-?\d+),(-?\d+)#(\d+)$/.exec(ref) : null;
                    if (!m || +m[1] !== other.q || +m[2] !== other.r) continue;
                    const p = f2 ? Townsfolk.get(f2.folk, +m[3]) : null;
                    if (p && (p.last === other.last || p.maiden === other.last)) Nemesis._end(player, world, nm, 'reconciled', { notices: [] });
                }
            } catch (e) { /* no nemesis */ }
        }
        if (other.kind === 'house') {
            House.accrueRivalFeud(player, world, other.kingdomId, -30, 'a blood price paid');
        }
        if (other.kind === 'lord') {
            const k = _kingdom(world, other.kingdomId);
            if (k && k.lord) {
                try { NPCLords.rememberDeed(world, k.lord, 'gift', { weight: 20, note: 'a blood price' }); } catch (e) { /* no memory */ }
            }
        }
    },

    // ──────────── WERGILD ────────────

    /** The dead still unavenged on the owing side (since the last blood they took). */
    unavenged(f) {
        const out = [];
        for (let i = f.deaths.length - 1; i >= 0; i--) {
            const d = f.deaths[i];
            if (d.side !== f.owes) break;
            out.push(d);
        }
        return out.length ? out : f.deaths.filter(d => d.side === f.owes).slice(-1);
    },

    _kingdomOf(world, f) {
        for (const s of f.sides) if (s.kingdomId != null && s.kind === 'folk') return s.kingdomId;
        if (f.place && f.place.q != null) { const s = _settlement(world, f.place.q, f.place.r); if (s && s.kingdom != null) return s.kingdom; }
        for (const s of f.sides) if (s.kingdomId != null) return s.kingdomId;
        return null;
    },

    /** The blood price owed to the bereaved: { price, law, dead }. npc: what townsfolk ask townsfolk. */
    price(world, f, npc = false) {
        const C = BloodFeuds.config();
        const W = C.wergild;
        const law = BloodFeuds.law(world, BloodFeuds._kingdomOf(world, f));
        const dead = BloodFeuds.unavenged(f);
        let sum = dead.reduce((s, d) => s + BloodFeuds.tariff(d.rank), 0);
        sum *= law.tariff * (1 + _num(f.heat) / _num(W.heatDiv, 200)) * Math.pow(_num(W.genShare, 0.8), _num(f.gens && f.gens[f.owes]));
        if (npc) sum *= _num(C.npcShare, 0.25);
        return { price: Math.max(5, Math.round(sum)), law, dead };
    },

    /** Coin into the bereaved side's real purse: the bearer's purse, a House's gold, a crown's treasury. → what was paid in */
    _payInto(world, player, side, amount) {
        const a = Utils.cents(amount);
        if (!(a > 0)) return 0;
        if (side.kind === 'folk') {
            const b = BloodFeuds.bearer(world, player, side);
            const f = BloodFeuds._folk(world, side);
            if (b && b.person && f) {
                Townsfolk.purse(f.folk, b.person, world);
                b.person.purse = Utils.cents(_num(b.person.purse) + a);
                return a;
            }
            if (f && f.s.economy && Economy.payTown(f.s, a)) return a;
        } else if (side.kind === 'house') {
            const rv = BloodFeuds._rival(player, side.kingdomId);
            if (rv) { rv.gold = Utils.cents(_num(rv.gold) + a); return a; }
        } else if (side.kind === 'lord') {
            const k = _kingdom(world, side.kingdomId);
            if (k) { k.treasury = Utils.cents(_num(k.treasury) + a); return a; }
        } else if (side.kind === 'player' && player) {
            player.gold = Utils.cents(_num(player.gold) + a);
            Ledger.record(player, 'bloodPrice', a);
            return a;
        }
        MoneySupply.leak(world, -a, 'bloodPrice');
        return a;
    },

    /** Coin out of a side's purses (townsfolk: every member's, eldest first), at most `amount`. → what was drawn */
    _drawFrom(world, player, side, amount) {
        let want = Utils.cents(amount);
        let got = 0;
        if (side.kind === 'folk') {
            const f = BloodFeuds._folk(world, side);
            if (!f) return 0;
            for (const p of BloodFeuds.members(world, side).sort((a, b) => _num(a.born) - _num(b.born))) {
                if (!(want > 0)) break;
                Townsfolk.purse(f.folk, p, world);
                const take = Math.min(want, Math.max(0, _num(p.purse)));
                p.purse = Utils.cents(_num(p.purse) - take);
                got += take;
                want = Utils.cents(want - take);
            }
        } else if (side.kind === 'house') {
            const rv = BloodFeuds._rival(player, side.kingdomId);
            if (rv) { const take = Math.min(want, Math.max(0, _num(rv.gold))); rv.gold = Utils.cents(_num(rv.gold) - take); got = take; }
        } else if (side.kind === 'lord') {
            const k = _kingdom(world, side.kingdomId);
            if (k) { const take = Math.min(want, Math.max(0, _num(k.treasury))); k.treasury = Utils.cents(_num(k.treasury) - take); got = take; }
        }
        return Utils.cents(got);
    },

    /** The arbiter's fee: the town's purse (priest and council), the crown's treasury, or no one (the kin's right). → { to, paid } */
    _fee(world, f, law, amount) {
        if (!(amount > 0) || law.arbiter === 'kin') return { to: 'kin', paid: 0 };
        if (law.arbiter === 'crown') {
            const k = _kingdom(world, BloodFeuds._kingdomOf(world, f));
            if (k) { k.treasury = Utils.cents(_num(k.treasury) + amount); return { to: 'crown', paid: amount }; }
        }
        const p = f.place || f.sides.find(s => s.kind === 'folk');
        const s = p ? _settlement(world, p.q, p.r) : null;
        if (s && Economy.payTown(s, amount)) return { to: 'priest', paid: amount };
        if (p && Economy.payNearest(world, p.q, p.r, amount)) return { to: 'priest', paid: amount };
        MoneySupply.leak(world, -amount, 'bloodPrice');
        return { to: 'priest', paid: amount };
    },

    /** What the player may offer: { ok, reason, price, chance, payee, arbiter }. */
    wergildQuote(world, player, id) {
        const f = BloodFeuds.get(world, id);
        const pi = BloodFeuds.playerIndex(f);
        if (!f || pi < 0) return { ok: false, reason: 'There is no such feud.' };
        if (f.owes === pi) return { ok: false, reason: 'The blood is owed to you: it is theirs to pay.' };
        const W = BloodFeuds.config().wergild;
        const { price, law } = BloodFeuds.price(world, f);
        const other = f.sides[1 - pi];
        const bearer = BloodFeuds.bearer(world, player, other);
        const dip = _num(player.skills && player.skills.diplomacy);
        const chance = _clamp(_num(W.base) + _num(W.perDiplomacy) * dip + law.accept - _num(W.perHeat) * _num(f.heat), _num(W.min, 0.1), _num(W.max, 0.95));
        const arbiter = BloodFeuds.config().text.arbiter ? BloodFeuds.config().text.arbiter[law.arbiter] || law.arbiter : law.arbiter;
        const base = { price, chance, payee: other.name, bearer: bearer ? bearer.name : null, arbiter, law: law.id };
        if (!bearer) return { ok: false, reason: `No one of the ${other.name} is left to take it.`, ...base };
        if (_day(world) < _num(f.nextOffer)) return { ok: false, reason: `They spurned your last offer; wait until day ${f.nextOffer}.`, ...base };
        if (_num(player.gold) < price) return { ok: false, reason: `The blood price is ${Utils.formatGold(price)}g.`, ...base };
        return { ok: true, ...base };
    },

    /** Offer the blood price. The roll is a hash of the feud and the day. → { success, accepted, text, cost } */
    offerWergild(world, player, id) {
        const q = BloodFeuds.wergildQuote(world, player, id);
        if (!q.ok) return { success: false, reason: q.reason };
        const f = BloodFeuds.get(world, id);
        const W = BloodFeuds.config().wergild;
        const day = _day(world);
        const pi = BloodFeuds.playerIndex(f);
        const other = f.sides[1 - pi];
        if (_u(world, `${f.id}|${day}|offer`) >= q.chance) {
            f.heat = Math.min(100, _r1(f.heat + _num(W.refuseHeat, 4)));
            f.nextOffer = day + _num(W.cooldown, 60);
            const text = _fill(BloodFeuds._text('refused', 'The {payee} spit on your blood price.'), { payee: other.name });
            BloodFeuds._note(world, f, 'refused', text);
            return { success: true, accepted: false, text };
        }
        const { law } = BloodFeuds.price(world, f);
        player.gold = Utils.cents(_num(player.gold) - q.price);
        Ledger.record(player, 'bloodPrice', -q.price);
        const fee = Utils.cents(q.price * (law.arbiter === 'kin' ? 0 : _num(W.feeShare, 0.1)));
        const fe = BloodFeuds._fee(world, f, law, fee);
        BloodFeuds._payInto(world, player, other, q.price - fe.paid);
        const kid = BloodFeuds._kingdomOf(world, f);
        if (kid != null) {
            if (!player.reputation) player.reputation = {};
            player.reputation[kid] = _num(player.reputation[kid]) + _num(W.amendsRep, 3);
        }
        BloodFeuds._settledRipples(world, player, f);
        const text = _fill(BloodFeuds._text('wergildYou', 'You pay {amount}g blood price to the {payee}.'), {
            amount: Utils.formatGold(q.price), payee: other.name, bearer: q.bearer || 'the kin',
            fee: fe.paid > 0 ? ` before ${q.arbiter} (${Utils.formatGold(fe.paid)}g to them)` : '',
        });
        BloodFeuds._end(world, player, f, 'wergild', text);
        return { success: true, accepted: true, text, cost: q.price };
    },

    // ──────────── MARRIAGE ────────────

    /** Your children who could be promised into the other House to end it: { ok, reason, options: [{ childId, child, suitor }] }. */
    marriageOptions(world, player, id) {
        const f = BloodFeuds.get(world, id);
        const pi = BloodFeuds.playerIndex(f);
        if (!f || pi < 0) return { ok: false, reason: 'There is no such feud.', options: [] };
        const other = f.sides[1 - pi];
        if (other.kind === 'folk') return { ok: false, reason: `The ${other.name} will not send a child to the House that shed their blood; offer the blood price.`, options: [] };
        const options = [];
        let why = null;
        for (const child of Betrothals.eligibleChildren(player)) {
            let suitors = [];
            try { suitors = Betrothals.suitors(player, world, child.id); } catch (e) { suitors = []; }
            for (const s of suitors) {
                if (String(s.kingdomId) !== String(other.kingdomId) || (other.kind === 'house' ? s.kind !== 'rival' : s.kind !== 'royal')) continue;
                // (the feud's heat is the reason for the match: only war stands in the way)
                if (!s.ok && !/feud/i.test(String(s.why || ''))) { why = why || s.why; continue; }
                options.push({ childId: child.id, child, suitor: { ...s, ok: true, why: null } });
            }
        }
        if (!options.length) return { ok: false, reason: why || `You have no child free to promise into the ${other.name}, or they none of an age.`, options };
        return { ok: true, options };
    },

    /** Promise a child into the other House (systems/betrothals.js) at askShare of the usual price: the feud ends with the match. */
    proposeMarriage(world, player, id, childId = null, suitorId = null) {
        const opt = BloodFeuds.marriageOptions(world, player, id);
        if (!opt.ok) return { success: false, reason: opt.reason };
        const pick = opt.options.find(o => (childId == null || o.childId === childId) && (suitorId == null || o.suitor.id === suitorId)) || opt.options[0];
        const M = BloodFeuds.config().marriage;
        let ask = null;
        try {
            const q = Betrothals.quote(player, world, pick.childId, pick.suitor.id, { line: 'theirs' }, { suitor: pick.suitor });
            ask = Math.round(_num(q.ask) * _num(M.askShare, 0.5));
        } catch (e) { ask = null; }
        const res = Betrothals.propose(player, world, pick.childId, pick.suitor.id, { line: 'theirs' }, { suitor: pick.suitor, ask: ask != null ? ask : undefined });
        if (!res || !res.success) return { success: false, reason: (res && res.reason) || 'The match cannot be made.' };
        const f = BloodFeuds.get(world, id);
        const other = f.sides[1 - BloodFeuds.playerIndex(f)];
        BloodFeuds._settledRipples(world, player, f);
        const text = _fill(BloodFeuds._text('marriedYou', '{child} is promised to {who} of {house}, and the blood feud ends.'), { child: pick.child.firstName, who: pick.suitor.name, house: other.name });
        BloodFeuds._end(world, player, f, 'married', text);
        return { success: true, text, cost: res.cost || 0 };
    },

    // ──────────── THE PLAYER AS JUDGE ────────────

    /** Does the player hold this town, or rule its realm (and so may sit in judgement on its feuds)? */
    holdsTown(world, player, s) {
        if (!player || !s) return false;
        try { if (Taxation.getPlayerSettlements(player, world).some(r => r.q === s.q && r.r === s.r)) return true; } catch (e) { /* none */ }
        const ruled = Laws.ruled(player, world);
        return !!(ruled && s.kingdom != null && String(ruled.id) === String(s.kingdom));
    },

    /** The townsfolk feuds the player may judge here: [{ feud, price, payer, payee }]. */
    judgeable(world, player, s) {
        if (!BloodFeuds.holdsTown(world, player, s)) return [];
        return BloodFeuds.open(world).filter(f => f.sides.every(x => x.kind === 'folk') && f.sides.some(x => x.q === s.q && x.r === s.r))
            .map(f => ({ feud: f, price: BloodFeuds.price(world, f, true).price, payer: f.sides[1 - f.owes], payee: f.sides[f.owes] }));
    },

    /** Sit in judgement: the killers' family pays the wergild you set into the bereaved's purse, your fee into yours. */
    arbitrate(world, player, id) {
        const f = BloodFeuds.get(world, id);
        if (!f || !f.sides.every(x => x.kind === 'folk')) return { success: false, reason: 'There is no such feud before you.' };
        const s = _settlement(world, f.sides[0].q, f.sides[0].r);
        if (!BloodFeuds.holdsTown(world, player, s)) return { success: false, reason: 'You have no right to judge in this town.' };
        const N = BloodFeuds.config().npc;
        const { price } = BloodFeuds.price(world, f, true);
        const payer = f.sides[1 - f.owes];
        const payee = f.sides[f.owes];
        const got = BloodFeuds._drawFrom(world, player, payer, price);
        if (got < price * 0.5) {
            // (what they had goes back: a judgement they cannot meet settles nothing)
            BloodFeuds._payInto(world, player, payer, got);
            return { success: false, reason: `The ${payer.name} have not ${Utils.formatGold(price)}g between them (only ${Utils.formatGold(got)}g).` };
        }
        const fee = Utils.cents(got * _num(N.feeShare, 0.1));
        BloodFeuds._payInto(world, player, payee, got - fee);
        if (fee > 0) { player.gold = Utils.cents(_num(player.gold) + fee); Ledger.record(player, 'arbiterFees', fee); }
        if (s) {
            if (!player.reputation) player.reputation = {};
            if (s.kingdom != null) player.reputation[s.kingdom] = _num(player.reputation[s.kingdom]) + 2;
        }
        const text = `At your judgement the ${payer.name} pay ${Utils.formatGold(got)}g blood price to the ${payee.name}${fee > 0 ? ` (${Utils.formatGold(fee)}g to your purse)` : ''}. The feud is ended.`;
        if (s && s.folk) BloodFeuds._annal(world, s, `The ${payer.name} paid the blood price to the ${payee.name} at the lord's judgement`);
        BloodFeuds._end(world, player, f, 'judged', text);
        return { success: true, text, paid: got, fee };
    },

    // ──────────── WHAT THE OTHER SYSTEMS READ ────────────

    /** The feud this townsperson's family holds against the player's House (they owe vengeance), or null. */
    _familyFeud(world, npc) {
        const p = npc && (npc._person || (npc.first ? npc : null));
        const folk = npc && npc._folk;
        if (!p || !p.last || !world) return null;
        let q = folk && Number.isFinite(folk.q) ? folk.q : null;
        let r = folk && Number.isFinite(folk.r) ? folk.r : null;
        if (q == null) return null;
        const keys = [`folk:${q},${r}:${p.last}`];
        if (p.maiden && p.maiden !== p.last) keys.push(`folk:${q},${r}:${p.maiden}`);
        for (const f of BloodFeuds.ofPlayer(world)) {
            const i = f.sides.findIndex(s => keys.includes(s.key));
            if (i >= 0 && f.owes === i) return f;
        }
        return null;
    },

    /** Will this townsperson refuse to deal with the player (their family owes blood vengeance)? → { refuses, reason } */
    refusesTrade(world, player, npc) {
        if (!player || !world) return { refuses: false };
        const f = BloodFeuds._familyFeud(world, npc);
        if (!f || _num(f.heat) < _num(BloodFeuds.config().acts.refuseAt, 20)) return { refuses: false };
        const dead = BloodFeuds.unavenged(f)[0];
        return { refuses: true, reason: `${npc.name || 'They'} will not deal with you: there is blood between your House and theirs${dead ? ` (${dead.name})` : ''}.` };
    },

    /** The kin who stand witness against the player at a trial in this town: [{ name, family }]. */
    witnessesAgainst(world, player, s) {
        if (!player || !s) return [];
        const A = BloodFeuds.config().acts;
        const out = [];
        for (const f of BloodFeuds.ofPlayer(world)) {
            const side = f.sides[f.owes];
            if (side.kind !== 'folk' || side.q !== s.q || side.r !== s.r || _num(f.heat) < _num(A.testifyAt, 25)) continue;
            const b = BloodFeuds.bearer(world, player, side);
            if (b) out.push({ name: b.name, family: side.name });
            if (out.length >= _num(A.maxWitnesses, 3)) break;
        }
        return out;
    },

    /** What blood-feud witnesses add to the court's case (Trials.odds z). */
    testimony(trial) {
        const A = BloodFeuds.config().acts;
        const n = Math.min(_num(A.maxWitnesses, 3), ((trial && trial.bloodWitnesses) || []).length);
        return n * _num(A.perWitness, 0.25);
    },

    // ──────────── THE DAY ────────────

    /** One day: every thirtieth day the month of the feuds. → { notices } */
    processDay(world, player = null) {
        const out = { notices: [] };
        if (!world || !BloodFeuds.config().enabled) return out;
        const st = BloodFeuds.state(world);
        const day = _day(world);
        if (player && !player.interregnum) {
            BloodFeuds._watchSuccession(world, player);
            for (const n of st.pending.splice(0)) out.notices.push(n);
        } else st.pending.length = Math.min(st.pending.length, 6);
        if (day - _num(st.lastMonth, -1e9) < 30) return out;
        st.lastMonth = day;
        const live = player && !player.interregnum ? player : null;
        for (const f of st.list.slice()) BloodFeuds._monthOf(world, live, f, out);
        if (live) BloodFeuds._avengers(world, live, out);
        BloodFeuds._npcMonth(world, live, out);
        if (live) for (const n of st.pending.splice(0)) out.notices.push(n);
        return out;
    },

    /** A new head on the player's seat: the House's feuds pass to the heir, a generation cooler (some let go). */
    _watchSuccession(world, player) {
        const st = BloodFeuds.state(world);
        const gen = _num(player.house && player.house.generation, 1);
        if (st.playerGen == null) { st.playerGen = gen; return; }
        if (gen === st.playerGen) return;
        st.playerGen = gen;
        const I = BloodFeuds.config().inherit;
        for (const f of BloodFeuds.ofPlayer(world)) {
            const pi = BloodFeuds.playerIndex(f);
            f.gens[pi] = _num(f.gens[pi]) + 1;
            f.heat = _r1(f.heat * _num(I.share, 0.8));
            const other = f.sides[1 - pi];
            if (f.heat < _num(I.letGoBelow, 15)) {
                BloodFeuds._end(world, player, f, 'letGo', _fill(BloodFeuds._text('letGo', 'The {side} let the old feud with the {other} lie.'), { side: other.name, other: f.sides[pi].name }));
                continue;
            }
            const text = _fill(BloodFeuds._text('inheritedYou', 'The blood feud with the {other} passes to {ruler}.'), { other: other.name, ruler: player.name || 'the heir' });
            BloodFeuds._note(world, f, 'inherited', text);
            BloodFeuds._tell(world, { icon: '⚔️', title: 'An Inherited Feud', text, type: 'warning' });
        }
    },

    /** The month of one feud: it cools, its bearers die and pass it on, a family dies out. */
    _monthOf(world, player, f, out) {
        const C = BloodFeuds.config();
        const law = BloodFeuds.law(world, BloodFeuds._kingdomOf(world, f));
        f.heat = Math.max(0, _r1(f.heat - _num(C.coolPerYear, 7) * law.cool * 30 / _num(C.daysPerYear, 120)));
        if (f.heat < _num(C.fadeBelow, 8)) {
            BloodFeuds._end(world, player, f, 'faded', _fill(BloodFeuds._text('faded', 'The feud between the {a} and the {b} is forgotten.'), { a: f.sides[0].name, b: f.sides[1].name }));
            return;
        }
        for (const i of [0, 1]) {
            const side = f.sides[i];
            if (side.kind === 'player') continue;
            // (a rival House gone from the book, a realm fallen: the feud ends with them)
            if (side.kind === 'house' && player && !BloodFeuds._rival(player, side.kingdomId)) { BloodFeuds._end(world, player, f, 'extinct', `${side.name} is no more; the feud ends with it.`); return; }
            if (side.kind === 'house' && !player) continue;
            const b = BloodFeuds.bearer(world, player, side);
            if (!b) {
                const text = `No one of the ${side.name} is left to carry the feud with the ${f.sides[1 - i].name}.`;
                BloodFeuds._end(world, player, f, 'extinct', text);
                return;
            }
            if (f.bearers[i] && f.bearers[i] !== b.id) {
                f.gens[i] = _num(f.gens[i]) + 1;
                if (i === f.owes) f.heat = _r1(f.heat * _num(C.inherit.share, 0.8));
                const text = _fill(BloodFeuds._text('inherited', '{bearer} takes up the blood feud of the {side}.'), { bearer: b.name, side: side.name, other: f.sides[1 - i].name });
                BloodFeuds._note(world, f, 'inherited', text);
                if (BloodFeuds.playerIndex(f) >= 0 && i === f.owes) BloodFeuds._tell(world, { icon: '⚔️', title: 'The Feud Passes On', text, type: 'info' });
                if (i === f.owes && f.heat < _num(C.inherit.letGoBelow, 15)) {
                    BloodFeuds._end(world, player, f, 'letGo', _fill(BloodFeuds._text('letGo', 'The {side} let the old feud lie.'), { side: side.name, other: f.sides[1 - i].name }));
                    return;
                }
            }
            f.bearers[i] = b.id;
        }
        // A rival House carrying blood keeps its feud with you hot (its waylaying and plots act on it)
        const pi = BloodFeuds.playerIndex(f);
        if (player && pi >= 0) {
            const other = f.sides[1 - pi];
            if (other.kind === 'house' && f.owes !== pi) {
                const rv = BloodFeuds._rival(player, other.kingdomId);
                const floor = Math.round(f.heat * _num(C.acts.houseFloor, 0.7));
                if (rv && _num(rv.feud) < floor) House.accrueRivalFeud(player, world, other.kingdomId, floor - _num(rv.feud), 'the blood between your Houses');
            }
        }
    },

    // ──────────── AVENGERS ────────────

    /** The month's vengeance against the player's House: at most one act, capped by gapDays and blowGapDays. */
    _avengers(world, player, out) {
        const C = BloodFeuds.config();
        const A = C.acts;
        const st = BloodFeuds.state(world);
        const day = _day(world);
        if (day - _num(st.lastAct, -1e9) < _num(A.gapDays, 45)) return;
        const feuds = BloodFeuds.ofPlayer(world).filter(f => f.owes !== BloodFeuds.playerIndex(f) && f.sides[f.owes].kind === 'folk')
            .sort((a, b) => b.heat - a.heat);
        for (const f of feuds) {
            const law = BloodFeuds.law(world, BloodFeuds._kingdomOf(world, f));
            const chance = _num(f.heat) / _num(A.perHeatDiv, 280) * law.avenge;
            if (_u(world, `${f.id}|${day}|act`) >= chance) continue;
            const side = f.sides[f.owes];
            const b = BloodFeuds.bearer(world, player, side);
            if (!b) continue;
            let res = null;
            if (_num(f.heat) >= _num(A.hireAt, 70) && !f.hired) res = BloodFeuds._hire(world, player, f, side, b);
            if (!res && _num(f.heat) >= _num(A.blowAt, 55) && day - _num(st.lastBlow, -1e9) >= _num(A.blowGapDays, 300)) res = BloodFeuds._blow(world, player, f, side, b);
            if (!res) res = BloodFeuds._slander(world, player, f, side);
            if (!res) continue;
            st.lastAct = day;
            BloodFeuds._note(world, f, res.kind, res.text);
            out.notices.push({ icon: res.icon || '⚔️', title: res.title || 'Blood Vengeance', text: res.text, type: res.type || 'warning' });
            if (res.kind === 'blow' || res.kind === 'blowSlain') Interrupts.raise(world, { reason: res.text, icon: '🗡️', source: 'bloodFeuds' });
            return;
        }
    },

    _deadName(f) {
        const d = BloodFeuds.unavenged(f)[0];
        return d ? d.name : 'their dead';
    },

    /** The family's bitterest hires a blade: a sworn nemesis (capped and paced by systems/nemesis.js). */
    _hire(world, player, f, side, b) {
        if (!b.person) return null;
        f.hired = true;
        const A = BloodFeuds.config().acts;
        const day = _day(world);
        let g = null;
        try {
            g = Nemesis.wrong(player, world, {
                kind: 'blood', name: b.name, line: side.last, ref: { folkRef: `${side.q},${side.r}#${b.person.id}` },
                score: _num(A.hireScore, 55), age: BloodFeuds._age(b.person, day), gender: b.person.gender === 'female' ? 'female' : 'male',
                deed: { key: 'blood_feud', label: `the blood of ${BloodFeuds._deadName(f)}`, note: side.town },
            });
        } catch (e) { g = null; }
        if (!g) return null;
        return { kind: 'hired', icon: '🗡️', title: 'A Blade Is Hired', text: _fill(BloodFeuds._text('hired', '{bearer} of the {side} has hired a blade against you.'), { bearer: b.name, side: side.name }), type: 'warning' };
    },

    /** A blow: a knife in town, an ambush on the road. Struck: a wound; foiled: driven off, or killed in your defence. */
    _blow(world, player, f, side, b) {
        const A = BloodFeuds.config().acts;
        const B = A.blow;
        const st = BloodFeuds.state(world);
        const day = _day(world);
        st.lastBlow = day;
        const here = _settlement(world, player.q, player.r);
        const where = here ? `in the streets of ${here.name}` : 'on the road';
        const martial = _num(player.skills && player.skills.combat, 1);
        const men = ((player.army) || []).reduce((s, u) => s + _num(u && (u.count != null ? u.count : u.strength), 1), 0);
        const party = ((player.travelParty && player.travelParty.members) || player.companions || []).length || 0;
        const law = BloodFeuds.law(world, BloodFeuds._kingdomOf(world, f));
        const chance = _clamp(_num(B.base) * Math.min(1.2, law.avenge) - _num(B.perMartial) * martial - Math.min(_num(B.maxMen, 0.25), _num(B.perMan) * men) - (party > 0 ? _num(B.companion) : 0), _num(B.min, 0.1), _num(B.max, 0.75));
        const vars = { bearer: b.name, side: side.name, where, dead: BloodFeuds._deadName(f) };
        if (_u(world, `${f.id}|${day}|blow`) < chance) {
            const wounds = Array.isArray(B.wounds) && B.wounds.length ? B.wounds : ['gash'];
            const id = wounds[Math.floor(_u(world, `${f.id}|${day}|wound`) * wounds.length) % wounds.length];
            let w = null;
            try { w = Ailments.inflict(player, world, id, { source: 'feud' }); } catch (e) { w = null; }
            const [h0, h1] = Array.isArray(B.health) ? B.health : [6, 16];
            const loss = Math.round(h0 + (h1 - h0) * _u(world, `${f.id}|${day}|hp`));
            player.health = Math.max(1, _num(player.health, 100) - loss);
            f.heat = Math.max(0, _r1(f.heat - _num(B.sate, 18)));
            return { kind: 'blow', icon: '🗡️', title: 'Blood Vengeance', text: _fill(BloodFeuds._text('blowStruck', '{bearer} of the {side} falls on you {where}.'), { ...vars, wound: w ? String(w.name).toLowerCase() : `−${loss} health` }), type: 'error' };
        }
        // Foiled: driven off — or dead on your blade, and the feud the hotter for it
        if (b.person && _u(world, `${f.id}|${day}|slain`) < _num(B.slainChance, 0.2)) {
            const fo = BloodFeuds._folk(world, side);
            if (fo) {
                Townsfolk.slay(fo.folk, b.person, day, `killed attacking ${player.name || 'a stranger'}`, world);
                Townsfolk.record(fo.folk, world, day, { k: 'died', a: b.person.id, x: `killed attacking ${player.name || 'a stranger'}` });
            }
            BloodFeuds.killing(world, {
                player, victim: side, killer: BloodFeuds.playerSide(player), dead: { name: b.name, rank: BloodFeuds.folkRank(b.person, day), person: b.person },
                killerName: player.name || 'you', how: 'selfDefence', where: { q: side.q, r: side.r, town: side.town }, quiet: true,
            });
            return { kind: 'blowSlain', icon: '⚔️', title: 'An Avenger Slain', text: _fill(BloodFeuds._text('blowSlain', '{bearer} of the {side} came at you {where} and died on your blade.'), vars), type: 'warning' };
        }
        f.heat = Math.min(100, _r1(f.heat + _num(B.foiledHeat, 5)));
        return { kind: 'blowFoiled', icon: '🛡️', title: 'An Avenger Driven Off', text: _fill(BloodFeuds._text('blowFoiled', '{bearer} of the {side} came at you {where}, but you were ready.'), vars), type: 'warning' };
    },

    _slander(world, player, f, side) {
        const kid = side.kingdomId;
        if (kid == null) return null;
        const S = BloodFeuds.config().acts.slander || {};
        const [a, b] = Array.isArray(S.rep) ? S.rep : [2, 5];
        const loss = Math.round(a + (b - a) * _u(world, `${f.id}|${_day(world)}|slander`));
        if (!player.reputation) player.reputation = {};
        player.reputation[kid] = _num(player.reputation[kid]) - loss;
        const k = _kingdom(world, kid);
        return { kind: 'slander', icon: '🗣️', title: 'Bad Blood Spoken Of', text: `${_fill(BloodFeuds._text('slander', 'The {side} speak of {dead}\'s blood on your hands in {realm}.'), { side: side.name, dead: BloodFeuds._deadName(f), realm: k ? Names.realm(k.name) : 'the realm' })} (−${loss} reputation)`, type: 'info' };
    },

    // ──────────── THE WORLD'S OWN FEUDS ────────────

    _npcFeuds(world) {
        return BloodFeuds.open(world).filter(f => BloodFeuds.playerIndex(f) < 0);
    },

    /** A grown member of a side the avenger can strike at: { person, folk, s } | { retainer: true } | null. */
    _target(world, player, side, key) {
        const day = _day(world);
        if (side.kind === 'folk') {
            const fo = BloodFeuds._folk(world, side);
            const grown = BloodFeuds.members(world, side).filter(p => BloodFeuds._age(p, day) >= BloodFeuds.config().comeOfAge);
            if (!fo || !grown.length) return null;
            const men = grown.filter(p => p.gender !== 'female');
            const pool = men.length ? men : grown;
            return { person: pool[Math.floor(_u(world, `${key}|target`) * pool.length) % pool.length], folk: fo.folk, s: fo.s };
        }
        if (side.kind === 'house') {
            const rv = BloodFeuds._rival(player, side.kingdomId);
            if (!rv || !rv.head) return null;
            const heir = RivalHouses.heirOf(rv);
            const kin = (rv.head.children || []).filter(c => c && c !== heir && !c.captiveOf && _num(c.age) >= BloodFeuds.config().comeOfAge && c.isAlive !== false);
            if (kin.length) return { house: rv, child: kin[Math.floor(_u(world, `${key}|kin`) * kin.length) % kin.length] };
            return { house: rv, retainer: true };
        }
        return null;
    },

    /** The month among the world's own: avengers strike (capped), feuds are settled, new blood is shed. */
    _npcMonth(world, player, out) {
        const C = BloodFeuds.config();
        const N = C.npc;
        const st = BloodFeuds.state(world);
        const day = _day(world);
        const Y = _num(C.daysPerYear, 120);
        for (const f of BloodFeuds._npcFeuds(world)) {
            // (a feud with a House is the player's world's: without the House record it waits)
            if (!player && f.sides.some(s => s.kind === 'house')) continue;
            // Once a year, on its own month: the council or a priest may settle it
            if (Math.floor((day - f.born) / 30) % Math.max(1, Math.round(Y / 30)) === Math.max(1, Math.round(Y / 30)) - 1) {
                if (BloodFeuds._npcSettle(world, player, f)) continue;
            }
            if (_num(f.heat) < _num(N.killAt, 40) || day - _num(f.lastKill, -1e9) < _num(N.feudKillGap, 360) || day - _num(st.lastNpcKill, -1e9) < _num(N.worldKillGap, 150)) continue;
            const law = BloodFeuds.law(world, BloodFeuds._kingdomOf(world, f));
            if (_u(world, `${f.id}|${day}|npcKill`) >= _num(f.heat) * _num(N.killPerHeat, 0.0012) * 30 * law.avenge / 3) continue;
            BloodFeuds._npcKill(world, player, f);
        }
        if (Math.floor(day / 30) % Math.max(1, Math.round(Y / 30)) === 0) BloodFeuds._npcBirths(world, player);
    },

    /** An avenger of the owing side kills one of the other: the debt passes over to them. */
    _npcKill(world, player, f) {
        const st = BloodFeuds.state(world);
        const day = _day(world);
        const avengers = f.sides[f.owes];
        const foes = f.sides[1 - f.owes];
        const b = BloodFeuds.bearer(world, player, avengers);
        const t = BloodFeuds._target(world, player, foes, `${f.id}|${day}`);
        if (!b || !t) return false;
        f.lastKill = day;
        st.lastNpcKill = day;
        let deadName;
        let person = null;
        const cause = `killed in the blood feud by ${b.name}`;
        if (t.person) {
            person = t.person;
            deadName = _pname(t.person);
            Townsfolk.slay(t.folk, t.person, day, cause, world);
            Townsfolk.record(t.folk, world, day, { k: 'died', a: t.person.id, x: cause });
        } else if (t.child) {
            deadName = `${t.child.firstName} ${RivalHouses.surname(t.house)}`;
            const kids = t.house.head.children || [];
            const i = kids.indexOf(t.child);
            if (i >= 0) kids.splice(i, 1);
            RivalHouses._note(t.house, world, `${t.child.firstName} was killed by ${avengers.name}'s men, for the blood between the Houses.`, 'bereaved');
        } else {
            deadName = `a sworn man of ${t.house.name}`;
            t.house.guard = Math.max(0, _num(t.house.guard) - 1);
        }
        const rank = t.person ? BloodFeuds.folkRank(t.person, day) : t.child ? 'houseKin' : 'commoner';
        BloodFeuds.killing(world, { player, victim: foes, killer: avengers, dead: { name: deadName, rank, person }, killerName: b.name, how: 'feud', where: f.place || (foes.kind === 'folk' ? { q: foes.q, r: foes.r } : null) });
        if (avengers.kind === 'house' && foes.kind === 'house') {
            const ra = BloodFeuds._rival(player, avengers.kingdomId);
            const rb = BloodFeuds._rival(player, foes.kingdomId);
            if (ra && rb) RivalHouses.bond(ra, rb, -20);
        }
        const s = f.place ? _settlement(world, f.place.q, f.place.r) : null;
        if (s && s.folk) {
            BloodFeuds._annal(world, s, _fill(BloodFeuds._text('npcKill', '{killer} of the {a} killed {dead} of the {b} {when}.'), { killer: b.name, a: avengers.name, dead: deadName, b: foes.name }));
        }
        return true;
    },

    /** The year's settling of a feud among the world's own: a wedding, or wergild before the council and the priest. */
    _npcSettle(world, player, f) {
        const C = BloodFeuds.config();
        const N = C.npc;
        const day = _day(world);
        const law = BloodFeuds.law(world, BloodFeuds._kingdomOf(world, f));
        const chance = _num(N.settleBase, 0.35) * (1 - _num(f.heat) / 100) * (1 + law.accept);
        if (_u(world, `${f.id}|${day}|settle`) >= chance) return false;
        const [A, B] = f.sides;
        const s = f.place ? _settlement(world, f.place.q, f.place.r) : (A.kind === 'folk' ? _settlement(world, A.q, A.r) : null);
        // A wedding between two townsfolk families
        if (A.kind === 'folk' && B.kind === 'folk' && _u(world, `${f.id}|${day}|marry`) < _num(N.marryShare, 0.35)) {
            const M = C.marriage;
            const free = (side) => BloodFeuds.members(world, side).filter(p => p.spouse == null && BloodFeuds._age(p, day) >= _num(M.minAge, 17) && BloodFeuds._age(p, day) <= _num(M.maxAge, 35));
            const xs = free(A);
            const x = xs[0];
            const y = x && free(B).find(p => p.gender !== x.gender);
            const fo = BloodFeuds._folk(world, A);
            if (x && y && fo && A.q === B.q && A.r === B.r) {
                const xn = _pname(x);
                const yn = _pname(y);
                Townsfolk._wed(fo.folk, x, y, day);
                Townsfolk.record(fo.folk, world, day, { k: 'wed', a: x.id, b: y.id });
                const text = _fill(BloodFeuds._text('married', '{x} of the {a} weds {y} of the {b}, and the feud ends at the altar.'), { x: xn, y: yn, a: A.name, b: B.name });
                BloodFeuds._annal(world, fo.s, text);
                BloodFeuds._end(world, player, f, 'married', text);
                return true;
            }
        }
        // Two Houses: a match between their children
        if (A.kind === 'house' && B.kind === 'house' && player) {
            const ra = BloodFeuds._rival(player, A.kingdomId);
            const rb = BloodFeuds._rival(player, B.kingdomId);
            const L = RivalHouses.config().life;
            const free = (r) => ((r && r.head && r.head.children) || []).filter(c => c.age >= _num(L.marryFrom, 16) && !c.wed && !c.betrothed && !c.captiveOf);
            const ca = free(ra)[0];
            const cb = ca && free(rb).find(c => c.gender !== ca.gender);
            if (ca && cb && _u(world, `${f.id}|${day}|hmarry`) < _num(N.marryShare, 0.35)) {
                ca.wed = 'another House'; ca.wedHouse = rb.name;
                cb.wed = 'another House'; cb.wedHouse = ra.name;
                RivalHouses.bond(ra, rb, 40);
                const text = `${ca.firstName} ${RivalHouses.surname(ra)} weds ${cb.firstName} ${RivalHouses.surname(rb)}: the blood between ${ra.name} and ${rb.name} is ended at the altar.`;
                RivalHouses._note(ra, world, text, 'wedding');
                RivalHouses._note(rb, world, text, 'wedding');
                BloodFeuds._end(world, player, f, 'married', text);
                BloodFeuds._tell(world, { icon: '💍', title: 'A Feud Ends at the Altar', text, type: 'info' });
                return true;
            }
        }
        // Wergild, from the killers' purses to the bereaved's, the arbiter's fee taken
        const { price } = BloodFeuds.price(world, f, A.kind === 'folk' && B.kind === 'folk');
        const payer = f.sides[1 - f.owes];
        const payee = f.sides[f.owes];
        const got = BloodFeuds._drawFrom(world, player, payer, price);
        if (got < price * 0.5) {
            BloodFeuds._payInto(world, player, payer, got);
            return false;
        }
        const fee = Utils.cents(got * _num(N.feeShare, 0.1));
        const fe = BloodFeuds._fee(world, f, law, law.arbiter === 'kin' ? 0 : fee);
        BloodFeuds._payInto(world, player, payee, got - fe.paid);
        const arbiter = (C.text.arbiter && C.text.arbiter[law.arbiter]) || 'the elders';
        const text = _fill(BloodFeuds._text('wergild', 'The {payer} pay {amount}g blood price to the {payee}.'), { payer: payer.name, payee: payee.name, amount: Utils.formatGold(got), arbiter });
        if (s && s.folk) BloodFeuds._annal(world, s, text);
        if (payer.kind === 'house' || payee.kind === 'house') {
            const ra = BloodFeuds._rival(player, (payer.kind === 'house' ? payer : payee).kingdomId);
            if (ra) RivalHouses._note(ra, world, text, null);
        }
        BloodFeuds._end(world, player, f, 'wergild', text);
        return true;
    },

    /** The year's new blood among the world's own: a hot street grudge turns to murder; two Houses at daggers drawn spill blood. */
    _npcBirths(world, player) {
        const C = BloodFeuds.config();
        const N = C.npc;
        const st = BloodFeuds.state(world);
        const day = _day(world);
        if (day - _num(st.lastNpcKill, -1e9) < _num(N.worldKillGap, 150)) return;
        if (BloodFeuds._npcFeuds(world).length >= C.maxNpcOpen) return;
        // A street grudge (systems/brawls.js) gone past words
        if (_u(world, `${day}|grudgeBirth`) < _num(N.grudgeChance, 0.35)) {
            const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
            let best = null;
            for (const s of views) {
                const feuds = s && s.brawls && s.brawls.feuds;
                if (!feuds || !s.folk) continue;
                for (const g of Object.values(feuds)) {
                    if (!g || _num(g.heat) < _num(N.grudgeAt, 60) || (best && g.heat <= best.g.heat)) continue;
                    const a = Townsfolk.get(s.folk, g.a);
                    const b = Townsfolk.get(s.folk, g.b);
                    if (!a || !b || a.died != null || b.died != null || a.away || b.away || !a.last || !b.last || a.last === b.last) continue;
                    best = { s, g, a, b };
                }
            }
            if (best) {
                const { s, a, b } = best;
                const cause = `killed by ${_pname(a)} over an old grudge`;
                Townsfolk.slay(s.folk, b, day, cause, world);
                Townsfolk.record(s.folk, world, day, { k: 'died', a: b.id, x: cause });
                st.lastNpcKill = day;
                BloodFeuds.onFolkKilling(world, s, b, a, 'murdered', player);
                return;
            }
        }
        // Two rival Houses whose regard has gone to hatred
        if (player && player.house && _u(world, `${day}|houseBirth`) < _num(N.houseChance, 0.15)) {
            const live = RivalHouses.rivals(player).filter(r => r && r.head);
            for (let i = 0; i < live.length; i++) {
                for (let j = i + 1; j < live.length; j++) {
                    const a = live[i];
                    const b = live[j];
                    if (RivalHouses.tie(a, b) > _num(N.houseTieAt, -60) || BloodFeuds.find(world, `house:${a.kingdomId}`, `house:${b.kingdomId}`)) continue;
                    const t = BloodFeuds._target(world, player, BloodFeuds.houseSide(b), `${day}|hb`);
                    if (!t) continue;
                    let deadName;
                    if (t.child) {
                        deadName = `${t.child.firstName} ${RivalHouses.surname(b)}`;
                        const kids = b.head.children || [];
                        const k = kids.indexOf(t.child);
                        if (k >= 0) kids.splice(k, 1);
                    } else {
                        deadName = `a sworn man of ${b.name}`;
                        b.guard = Math.max(0, _num(b.guard) - 1);
                    }
                    st.lastNpcKill = day;
                    RivalHouses._note(b, world, `${deadName} was cut down by men of ${a.name}.`, 'bereaved');
                    RivalHouses.bond(a, b, -15);
                    const f = BloodFeuds.killing(world, { player, victim: BloodFeuds.houseSide(b), killer: BloodFeuds.houseSide(a), dead: { name: deadName, rank: t.child ? 'houseKin' : 'commoner' }, killerName: a.name, how: 'battle' });
                    if (f) BloodFeuds._tell(world, { icon: '⚔️', title: 'Blood Between Houses', text: `${deadName} was cut down by men of ${a.name}. ${b.name} swears vengeance.`, type: 'info' });
                    return;
                }
            }
        }
    },

    // ──────────── THE PANEL ────────────

    /** Everything the Blood Feuds panel shows. */
    view(world, player) {
        const mine = BloodFeuds.ofPlayer(world).map(f => {
            const pi = BloodFeuds.playerIndex(f);
            const other = f.sides[1 - pi];
            const owed = f.owes === pi;
            const b = BloodFeuds.bearer(world, player, other);
            return {
                feud: f, other, owed, bearer: b ? b.name : null, dead: BloodFeuds.unavenged(f),
                wergild: owed ? null : BloodFeuds.wergildQuote(world, player, f.id),
                marriage: owed ? null : BloodFeuds.marriageOptions(world, player, f.id),
                gens: _num(f.gens[pi]),
            };
        }).sort((a, b) => b.feud.heat - a.feud.heat);
        const here = player ? _settlement(world, player.q, player.r) : null;
        const judge = here ? BloodFeuds.judgeable(world, player, here) : [];
        const world_ = BloodFeuds._npcFeuds(world).slice().sort((a, b) => b.heat - a.heat).slice(0, 8);
        const past = BloodFeuds.state(world).past.slice(0, 10);
        return { mine, judge, here, world: world_, past };
    },
};
