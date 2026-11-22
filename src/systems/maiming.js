// ============================================
// MAIMING — hands, eyes, noses and tongues: the deed, and what it costs
// ============================================
// A medieval world mutilates: as punishment, as vengeance, in war and in
// politics. The body's losses and what they do live in systems/maimMarks.js;
// this is the deed itself, who it is done to, and the price of doing it.
//
//   THE ACTS (data/maiming.json acts): a hand (or both), an eye (or both:
//   blinded), an ear (or both), the nose slit, the tongue cut out, a foot (or
//   both), a brand on the face (done to others), gelding (dynastic politics).
//
//   WHO TO   on the street map, anyone you have beaten down or bound
//            (ui/innerMapMaiming.js) · a townsperson in your cellar
//            (systems/peopleCrimes.js captives) · an outlaw you have taken
//            for a bounty (systems/bountyHunting.js) · a lord of your royal
//            court — a rebel or broken lord as the crown's justice, an
//            innocent one as tyranny (systems/kingship.js) · a child or a
//            sibling of your House (the throne's oldest trick: a blinded or
//            slit-nosed son can never rule — the heir lists and the crown's
//            claimants read MaimMarks.barsRule) · the pretender of the old
//            royal line (systems/crownSuccession.js: his claim ends) · a
//            convict before your court, where the realm's law allows it
//            (player/trials.js; the law: systems/laws.js 'mutilation').
//   THE PRICE (brand): karma, cruelty and dread (systems/traits.js), the
//            name for cruelty (systems/atrocities.js butcher: a dreaded name
//            opens purses at a siege's terms), the court's name for severity
//            (systems/petitions.js), reputation in the victim's realm by its
//            culture's stance (data/peopleCrimes.json thief.stances) and by
//            whether it was lawful, heat with its crown when it was not, the
//            lords' memory (data/lordMemory.json mutilation), a rumour
//            (systems/gossip.js), the victim's and the kin's memory
//            (systems/npcMemory.js blinded / mutilated / maimed), a vendetta
//            that may become a NEMESIS (systems/nemesis.js), the House
//            chronicle (the Annals, through LlmProse). Fear deters as well as
//            shames: witnesses are cowed (threats fold easier), the court's
//            other lords are cowed (they lean less to a claimant and join no
//            faction while it lasts).
//   THE PLAYER MAIMED: a grave wound in a fight (a hash roll, no shared dice:
//            systems/ailments.js _graveWound, data player.graveWound), the court
//            under a hard law, one who beats you senseless with a grudge for
//            one you maimed (vengeance), an enemy's hired blades at your
//            children. The stump is a wound that may turn (fresh_stump); the
//            loss is for life. Aids made by a town's craftsmen (aidOptions /
//            buyAid: the fee into the maker's purse, the material out of the
//            town's market, its cost into the town's purse) give part of it back.
//   THE WORLD MAIMS TOO (processDay, weekly, its own hash rolls): a realm
//            whose law takes a thief's hand takes it from townsfolk caught at
//            theft; a raided town has its maimed; an AI succession crisis may
//            end with the loser blinded (onCrisisResolved). Sparse: no notice
//            unless it touches the player.
//
// State: player.maiming (the doer's record: history, stats; saved) and the
// bodies' own person.maimed (saved with the person). Explicit params, no
// globals; the player's own acts are choices and draw nothing; the world's
// day draws on hashes of the world seed.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Names } from '../core/names.js';
import { Economy } from '../world/economy.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { NPCLords } from '../world/npcLords.js';
import { Cultures } from '../world/cultures.js';
import { MaimMarks } from './maimMarks.js';
import { Traits } from './traits.js';
import { House } from './house.js';
import { Gossip } from './gossip.js';
import { NpcMemory } from './npcMemory.js';
import { NpcDisposition } from './npcDisposition.js';
import { Nemesis } from './nemesis.js';
import { Townsfolk } from './townsfolk.js';
import { TownJobs } from './townJobs.js';
import { Petitions } from './petitions.js';
import { Atrocities } from './atrocities.js';
import { Underworld } from './underworld.js';
import { Laws } from './laws.js';
import { Ailments } from './ailments.js';
import { Ledger } from './ledger.js';
import { PeopleCrimes } from './peopleCrimes.js';
import { LlmProse } from './llmProse.js';
// (run time only: the royal court, the throne, the crown's succession)
import { Throne } from './throne.js';
import { Kingship } from './kingship.js';
import { CrownSuccession } from './crownSuccession.js';
import { MaimFaith } from './maimFaith.js';
import { Devotion } from './devotion.js';
import { RivalHouses } from './rivalHouses.js';
import { RivalCaptives } from './rivalCaptives.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = (world) => _num(world && world.day);
const _fill = (t, vars) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
const _cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

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

/** 0..1, fixed for a key in this world (no shared stream). */
function _roll(world, key) {
    return (_hash(`${_seed(world)}|maiming|${key}`) % 100000) / 100000;
}

/** A weighted pick from { id: weight } by a 0..1 roll. */
function _pickW(pool, u) {
    const e = Object.entries(pool || {}).filter(([, w]) => _num(w) > 0);
    const total = e.reduce((s, [, w]) => s + _num(w), 0);
    let x = u * total;
    for (const [id, w] of e) { x -= _num(w); if (x < 0) return id; }
    return e.length ? e[e.length - 1][0] : null;
}

const DEFAULTS = {
    brand: {
        karmaPer: -3, cruelty: 1, dread: 0.8, butcherPer: 3, repPer: -3, heatPer: 5, severityPer: 0.5, lawfulMult: 0.3,
        stance: { approve: 0.25, tolerate: 0.6, condemn: 1 }, heardAt: 4, lordDeed: 'mutilation', heardDeed: 'mutilation_heard', gossip: 'mutilation',
        vassalsCowedDays: 120, grudgeOthers: 6, victimGrudge: 40, stabilityInnocent: -3, stabilityRebel: 1,
        nemesis: { commoner: 40, noble: 60, vassal: 65, kin: 70, royal: 80 }, kinGrievance: 60, kinPrestige: 15,
        pretenderStability: -6, pretenderPrestige: 5, pretenderYears: 40,
    },
    rank: { commoner: 1, outlaw: 0.7, noble: 1.6, vassal: 1.6, kin: 1.8, royal: 2.2 },
    player: { graveWound: {}, pool: { eye: 4, hand: 3, foot: 2, ear: 1 }, vengeance: { maimGrudge: 0.55, grudge: 0.08 }, enemies: { hatred: 85, feud: 90, weekly: 0.02, everyDays: 1200, minAge: 14, pool: { eye: 3, hand: 3 } } },
    ai: { everyDays: 7, recordDays: 40, lawHand: 0.6, raidDays: 30, raidMaim: 0.35, crisisBlind: 0.3, townsPerWeek: 40 },
    law: { never: {}, thieves: { theft: 'hand', repeat: true }, old: { theft: 'hand' }, crimeGroups: {} },
    road: { base: { robbed: 0.01, defeat: 0.02 }, types: { other: 0.7 }, cruelty: [0.5, 1.6], butcherNorm: 60, perBounty: 0.08, perMaimedOutlaw: 0.35, cap: 0.2, hunterAt: 4, pool: { ear: 3, nose: 2, hand: 1, eye: 1 }, owed: 0.5, feudAt: 95, feudChance: 0.05, lines: {} },
    lines: {},
};

let _cfg = null;
let _cfgSrc;

export const Maiming = {
    DEFAULTS,

    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.maiming : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            const P = _obj(d.player) || {};
            _cfg = {
                ...d,
                enabled: d.enabled !== false,
                brand: { ...DEFAULTS.brand, ...(_obj(d.brand) || {}), stance: { ...DEFAULTS.brand.stance, ...((_obj(d.brand) || {}).stance || {}) } },
                rank: { ...DEFAULTS.rank, ...(_obj(d.rank) || {}) },
                player: { ...DEFAULTS.player, ...P, enemies: { ...DEFAULTS.player.enemies, ...(_obj(P.enemies) || {}) }, vengeance: { ...DEFAULTS.player.vengeance, ...(_obj(P.vengeance) || {}) } },
                ai: { ...DEFAULTS.ai, ...(_obj(d.ai) || {}) },
                road: { ...DEFAULTS.road, ...(_obj(d.road) || {}) },
                law: { ...DEFAULTS.law, ...(_obj(d.law) || {}) },
                lines: { ...DEFAULTS.lines, ...(_obj(d.lines) || {}) },
            };
        }
        return _cfg;
    },

    enabled() { return Maiming.config().enabled !== false; },

    /** The acts that can be done to others, in order: [{ id, ...def }]. */
    acts() {
        return MaimMarks.PARTS.map(id => ({ id, ...(MaimMarks.act(id) || {}) })).filter(a => a.label);
    },

    line(key, vars = {}, salt = '') {
        const pool = Maiming.config().lines[key];
        const list = Array.isArray(pool) ? pool : pool ? [pool] : [];
        if (!list.length) return '';
        return _fill(list[_hash(`${key}|${salt}`) % list.length], vars);
    },

    // ── State (the doer's record) ──────────────────────────────

    _blank() { return { v: 1, history: [], stats: { total: 0, byAct: {}, suffered: 0 }, enemyDays: {}, captives: [], nextCaptive: 1 }; },

    state(player) {
        if (!player) return null;
        if (!_obj(player.maiming)) player.maiming = Maiming._blank();
        const st = player.maiming;
        const b = Maiming._blank();
        if (!Array.isArray(st.history)) st.history = [];
        st.stats = { ...b.stats, ...(_obj(st.stats) || {}) };
        if (!_obj(st.stats.byAct)) st.stats.byAct = {};
        if (!_obj(st.enemyDays)) st.enemyDays = {};
        if (!Array.isArray(st.captives)) st.captives = [];
        return st;
    },

    serialize(player) {
        return player && _obj(player.maiming) ? JSON.parse(JSON.stringify(player.maiming)) : null;
    },

    loadState(player) {
        if (!player) return;
        if (player.maiming) Maiming.state(player);
    },

    _by(player) { return (player && player.name) || 'a stranger'; },

    /** Severity of the act on this body (the second eye — blinding — weighs more). */
    _severity(act, n) {
        const def = MaimMarks.act(act) || {};
        let s = _num(def.severity, 2);
        if (act === 'eye' && n >= 2) s += 2;
        if (act === 'hand' && n >= 2) s += 1;
        return s;
    },

    /** How the culture of a realm or a town takes a mutilation: 'approve' | 'tolerate' | 'condemn'. */
    stanceOf(world, settlement = null, kingdomId = null) {
        let culture = null;
        try {
            if (settlement) culture = Cultures.cultureOf(world, settlement);
            else if (kingdomId != null && world && typeof world.getKingdom === 'function') culture = (world.getKingdom(kingdomId) || {}).culture || null;
        } catch (e) { culture = null; }
        const T = (PeopleCrimes.config() || {}).thief || {};
        return (culture && (T.stances || {})[culture]) || 'tolerate';
    },

    // ── The brand: what a deed costs the one who does it ────────

    /**
     * victim { name, rank ('commoner'|'outlaw'|'noble'|'vassal'|'kin'|'royal'),
     * kingdomId, settlement, q, r }; ctx { lawful, seen (default true), place,
     * chronicle (text), tags, n (the count now: 2 = both) }.
     * → { s, rep, heat, karma }
     */
    brand(player, world, act, victim = {}, ctx = {}) {
        if (!player) return { s: 0, rep: 0, heat: 0, karma: 0 };
        const C = Maiming.config();
        const B = C.brand;
        const st = Maiming.state(player);
        const day = _day(world);
        const def = MaimMarks.act(act) || {};
        const rankMult = _num(C.rank[victim.rank || 'commoner'], 1);
        const s = Maiming._severity(act, _num(ctx.n, 1)) * rankMult;
        const seen = ctx.seen !== false;
        const lawful = !!ctx.lawful;
        const kid = victim.kingdomId != null ? victim.kingdomId : (victim.settlement && victim.settlement.kingdom != null ? victim.settlement.kingdom : null);
        const stance = Maiming.stanceOf(world, victim.settlement || null, kid);
        const stanceMult = _num(B.stance[stance], 0.6);
        // The faith of the realm and the creed you keep (systems/maimFaith.js): a sacred body, or the god's justice
        const rf = MaimFaith.realmFaith(world, kid);
        const realmF = MaimFaith.def(rf ? MaimFaith.stanceOfFaith(rf) : 'mild');
        const creed = MaimFaith.creed(player);
        const ownF = MaimFaith.def(creed ? creed.stance : 'mild');
        const lawMult = lawful ? (rf ? _num(realmF.lawful, 0.3) : _num(B.lawfulMult, 0.3)) : 1;
        // Character: karma, cruelty and dread
        const karma = Math.round(_num(B.karmaPer) * s * (lawful ? 0.5 : 1) * _num(ownF.karma, 1));
        player.karma = Math.max(-100, Math.min(100, _num(player.karma) + karma));
        try { Traits.recordAggression(player, kid, { cruelty: _num(B.cruelty) * s * (lawful ? 0.5 : 1) * _num(ownF.cruelty, 1), dread: _num(B.dread) * s }); } catch (e) { /* no traits */ }
        // The clergy: the realm's priests (when it was seen), and your own creed's, who know what you did
        let faithLine = '';
        if (rf && seen) {
            const lost = _num(realmF.clergy) * s * (lawful ? _num(realmF.lawfulClergy) : 1);
            if (lost > 0) { try { Devotion._addStanding(player, rf, -lost); } catch (e) { /* no devotion */ } }
            if (realmF.line && !(lawful && !_num(realmF.lawfulClergy))) faithLine = _fill(realmF.line, { faith: MaimFaith.faithName(rf) });
        }
        if (creed) {
            const own = _num(ownF.ownClergy) * s * (lawful ? 0.5 : 1);
            if (own > 0 && creed.id !== 'own' && creed.id !== rf) { try { Devotion._addStanding(player, creed.id, -own); } catch (e) { /* no devotion */ } }
            const fl = _num(ownF.faithLoss) * s * (lawful ? 0.5 : 1);
            if (fl > 0 && Number.isFinite(player.faith)) player.faith = Math.max(0, Math.round((player.faith - fl) * 100) / 100);
            if (!faithLine && creed.stance === 'sacred' && fl > 0) faithLine = `${creed.name} holds the body sacred: your prayers come harder now.`;
        }
        // The name for cruelty (a dreaded name opens purses: Atrocities.termsShift)
        const at = Atrocities.state(player);
        if (at) at.butcher = Math.min(_num(Atrocities.config().infamy.max, 300), _num(at.butcher) + _num(B.butcherPer) * s * (seen ? 1 : 0.4));
        // The court's name for severity
        const court = player.petitions && player.petitions.court;
        if (court) {
            const cap = _num(Petitions.config().courtCap) || 100;
            const sev = Math.max(1, Math.round(_num(B.severityPer) * s));
            court.severity = Utils.clamp(_num(court.severity) + sev, -cap, cap);
            court.mercy = Utils.clamp(_num(court.mercy) - sev, -cap, cap);
        }
        // The realm's regard, by its culture's stance and the law; the crown's heat if it was no lawful deed
        let rep = 0;
        let heat = 0;
        if (seen && kid != null) {
            if (!player.reputation) player.reputation = {};
            rep = Math.round(_num(B.repPer) * s * stanceMult * lawMult * _num(realmF.rep, 1));
            if (rep) player.reputation[kid] = _num(player.reputation[kid]) + rep;
            if (!lawful && !PeopleCrimes._aboveLaw(player, kid)) {
                const h = _num(B.heatPer) * s * stanceMult * _num(realmF.heat, 1);
                try { heat = Underworld.addHeat(player, kid, h, world) ? h : 0; } catch (e) { heat = 0; }
            }
        }
        // The lords remember: the victim's realm for a man of rank done unlawfully; every realm for the worst
        const note = victim.name ? String(victim.name).slice(0, 60) : undefined;
        if (kid != null && !lawful && ['noble', 'vassal', 'royal', 'rival', 'rivalHeir', 'rivalHead'].includes(victim.rank) && B.lordDeed) {
            try { NPCLords.rememberRealm(world, kid, B.lordDeed, { note }); } catch (e) { /* no lord */ }
        }
        if (s >= _num(B.heardAt, 4) && seen && B.heardDeed) {
            for (const k of (world && world.kingdoms) || []) {
                if (!k || k.isAlive === false || k.id === kid) continue;
                try { NPCLords.rememberRealm(world, k.id, B.heardDeed, { note }); } catch (e) { /* no lord */ }
            }
        }
        // The talk of the towns
        const place = ctx.place || (victim.settlement && victim.settlement.name) || null;
        if (seen && B.gossip && Number.isFinite(victim.q)) {
            try { Gossip.spreadDeed(player, world, B.gossip, { q: victim.q, r: victim.r, location: place || undefined, kingdom: kid, victim: victim.name || 'someone' }); } catch (e) { /* no gossip */ }
        }
        // The House chronicle (the Annals): every deed done to one of rank, and the rest when known
        const chron = ctx.chronicle || `${Maiming._by(player)} had ${victim.name || 'a man'} ${Maiming.pastTense(act, _num(ctx.n, 1))}${place ? ` at ${place}` : ''}.`;
        const key = `maim:${day}:${act}:${victim.name || ''}`;
        let text = chron;
        if (player.house && (seen || rankMult > 1)) {
            if (rankMult > 1) {
                try {
                    text = LlmProse.write(world, { kind: 'deeds', key, facts: { event: 'a mutilation', act: def.label || act, victim: victim.name || 'someone', victimIs: victim.rank || 'commoner', by: Maiming._by(player), place: place || 'unknown', lawful }, fallback: chron });
                } catch (e) { text = chron; }
            }
            House._chronicle(player.house, world, chron, ctx.tags || ['cruelty']);
        }
        if (rankMult > 1 && seen && world && Array.isArray(world.events)) world.events.push({ text: chron, type: 'political', category: 'political', kingdom: kid });
        // The doer's own record
        st.stats.total = _num(st.stats.total) + 1;
        st.stats.byAct[act] = _num(st.stats.byAct[act]) + 1;
        st.history.unshift({ day, act, n: _num(ctx.n, 1), name: victim.name || 'someone', rank: victim.rank || 'commoner', place, lawful, seen, key, text: chron });
        if (st.history.length > 30) st.history.length = 30;
        return { s, rep, heat, karma, stance, text, faith: rf ? MaimFaith.stanceOfFaith(rf) : 'mild', faithLine };
    },

    /** "had his hand cut off" style words: the act as done. */
    pastTense(act, n = 1) {
        return ({
            hand: n >= 2 ? 'lose both hands' : 'lose a hand', eye: n >= 2 ? 'blinded' : 'lose an eye', ear: 'cropped of an ear',
            nose: 'slit-nosed', tongue: 'lose the tongue', foot: 'lose a foot', brand: 'branded on the face', geld: 'gelded',
        })[act] || 'maimed';
    },

    // ── Done to a townsperson ──────────────────────────────────

    /**
     * Maim one of a town's people. o = { settlement, folk, person, act, seen,
     * lawful, why, rank, inCellar }. → { ok, text, reason }
     */
    maimFolk(player, world, o = {}) {
        const { folk, person: p, act } = o;
        const s = o.settlement || null;
        if (!p || p.died != null) return { ok: false, reason: 'There is no one to maim.' };
        const why = MaimMarks.whyNot(p, act);
        if (why) return { ok: false, reason: why };
        const day = _day(world);
        const def = MaimMarks.mark(p, act, { day, by: Maiming._by(player), why: o.why || null, patch: _roll(world, `patch|${folk && folk.q},${folk && folk.r}#${p.id}`) < 0.7 });
        const n = MaimMarks.count(p, act);
        const name = Townsfolk.name(p);
        Townsfolk.injure(p, day, 3, 10);
        const lost = Maiming._loseTrade(folk, p, day);
        // (blinded is both eyes; a hand taken for a theft is the thief's 'maimed'; the rest, 'mutilated')
        const kind = act === 'eye' ? (n >= 2 ? 'blinded' : 'mutilated')
            : act === 'hand' && /thie|theft|purse|housebreak|steal|loot|grave/i.test(String(o.why || '')) ? 'maimed' : 'mutilated';
        if (folk) {
            NpcMemory.remember(world, { folk, person: p }, { kind, player, kin: !o.inCellar });
            if (o.seen !== false && !o.inCellar) NpcMemory.rememberTown(world, folk, { kind, player, victim: name });
            const N = Maiming.config().brand.nemesis || {};
            const rank = o.rank || (p.role === 'noble' ? 'noble' : 'commoner');
            if (!o.lawful) PeopleCrimes._nemesis(player, world, folk, p, Math.round(_num(N[rank], 40) * Math.min(2, Maiming._severity(act, n) / 2)), { key: kind, label: `the ${act === 'eye' && n >= 2 ? 'eyes' : act} you took`, note: s ? s.name : null });
            if (o.seen !== false && !o.inCellar) PeopleCrimes._annal(folk, world, `${name} was maimed by ${Maiming._by(player)}: ${MaimMarks._shortOf(act, n)}`);
        }
        const res = Maiming.brand(player, world, act, { name, rank: o.rank || (p.role === 'noble' ? 'noble' : 'commoner'), settlement: s, q: s ? s.q : null, r: s ? s.r : null }, { lawful: !!o.lawful, seen: o.seen !== false && !o.inCellar, n });
        const done = n >= 2 && def.doneBoth ? `${_fill(def.done, { victim: name })} ${_fill(def.doneBoth, { victim: name })}` : _fill(def.done, { victim: name });
        return { ok: true, text: `${done}${lost ? ` ${p.first} will never work as a ${String(lost).replace(/_/g, ' ')} again.` : ''}`, n, brand: res };
    },

    /** A townsperson who can no longer work their trade loses it, and begs. → the trade lost, or null. */
    _loseTrade(folk, p, day) {
        const j = p && p.job;
        if (!j || !j.id || j.id === 'beggar' || j.employer === 'player') return null;
        if (MaimMarks.keepsTrade(p, j.id)) return null;
        let occ = null;
        try { occ = TownJobs.occ('beggar'); } catch (e) { occ = null; }
        if (!occ) return null;
        const lost = j.id;
        p.job = { id: 'beggar', rank: 'master', since: day, lostTrade: lost };
        return lost;
    },

    // ── Those in your power ────────────────────────────────────

    /** The court of the realm the player rules, or null. */
    _court(player, world) {
        try { return Throne.ruledKingdom(player, world) ? Kingship.court(player) : null; } catch (e) { return null; }
    },

    /** Is a vassal fair game for the crown's justice: in revolt, or broken for it? */
    _vassalGuilty(v, world) {
        return !!(v && (v.rebel || _num(v.cowedUntil) > _day(world) || _num(v.powerMult, 1) < 1 || v.factionId));
    },

    /**
     * Everyone in the player's power to whom it could be done:
     * [{ kind, id, name, desc, rank, lawful, icon, acts: [{ id, label, icon, ok, why }] }].
     */
    targets(player, world) {
        const out = [];
        if (!player || !Maiming.enabled()) return out;
        const acts = (p, opts = {}) => Maiming.acts().filter(a => !(opts.noBrand && a.npcOnly) && (!opts.only || opts.only.includes(a.id)))
            .map(a => { const why = MaimMarks.whyNot(p, a.id); return { id: a.id, label: a.label, icon: a.icon, ok: !why, why: why || '' }; });
        const court = Maiming._court(player, world);
        if (court) {
            for (const v of court.vassals || []) {
                const guilty = Maiming._vassalGuilty(v, world);
                const tag = MaimMarks.tag(v);
                out.push({ kind: 'vassal', id: v.id, name: Kingship.fullName(v), icon: '🏰', rank: 'vassal', lawful: guilty, gender: v.gender === 'female' ? 'female' : 'male',
                    desc: `${v.seat ? `Lord of ${v.seat.name}` : 'A landless lord'}${v.rebel ? ' · in revolt' : guilty ? ' · broken by the crown' : ''}${tag ? ` · ${tag}` : ''}`, acts: acts(v, { noBrand: true }) });
            }
            const { k } = CrownSuccession._court(player, world);
            const line = k ? CrownSuccession.oldLine(player, world, k) : null;
            if (line) {
                const body = Maiming._pretenderBody(player, k);
                out.push({ kind: 'pretender', id: String(k.id), name: line.name, icon: '👑', rank: 'royal', lawful: false, gender: line.gender === 'female' ? 'female' : 'male',
                    desc: `Of the old royal line of ${Names.realm(k.name)}: ${line.gender === 'female' ? 'her claim ends if she is' : 'his claim ends if he is'} unfit to rule`, acts: acts(body || {}, { only: ['eye', 'nose', 'tongue', 'geld'] }) });
            }
        }
        for (const c of player.children || []) {
            if (!c || c.isAlive === false || _num(c.age) < 6) continue;
            const tag = MaimMarks.tag(c);
            out.push({ kind: 'kin', id: c.id, name: `${c.firstName || 'A child'} ${c.dynasty || ''}`.trim(), icon: c.isSibling ? '👥' : '🌑', rank: 'kin', lawful: false, gender: c.gender === 'female' ? 'female' : 'male',
                desc: `${c.isSibling ? 'Your sibling' : player.heir === c.id ? 'Your heir' : 'Your child'}, ${Math.floor(_num(c.age))}${tag ? ` · ${tag}` : ''}`, acts: acts(c, { noBrand: true }) });
        }
        for (const cap of PeopleCrimes.captives(player)) {
            const { p } = PeopleCrimes.personAt(world, cap.q, cap.r, cap.pid);
            if (!p || p.died != null) continue;
            const tag = MaimMarks.tag(p);
            out.push({ kind: 'captive', id: cap.id, name: cap.name, icon: '⛓️', rank: p.role === 'noble' ? 'noble' : 'commoner', lawful: false, gender: p.gender === 'female' ? 'female' : 'male',
                desc: `In your cellar at ${cap.town || 'a town'}${tag ? ` · ${tag}` : ''}`, acts: acts(p) });
        }
        // A rival House's child you took on the road, or a rival's ward you keep as a hostage (systems/rivalCaptives.js)
        for (const t of RivalCaptives.targets(player, world)) {
            out.push({ kind: 'rival', id: t.id, name: t.name, icon: t.ward ? '🏰' : t.head ? '👑' : '⛓️', rank: t.head ? 'rivalHead' : RivalCaptives.isHeir(t.rival, t.body) ? 'rivalHeir' : 'rival', lawful: false,
                gender: t.body.gender === 'female' ? 'female' : 'male', desc: t.desc, house: t.rival.name, ward: !!t.ward,
                ransom: t.cap ? RivalCaptives.ransomPrice(player, world, t.cap) : null, captiveId: t.cap ? t.cap.id : null, acts: acts(t.body, { noBrand: !!t.ward }) });
        }
        for (const b of player.activeBounties || []) {
            if (!b || b.type !== 'criminal_hunt' || b.status !== 'captured_pending_decision') continue;
            const tag = MaimMarks.tag(b);
            out.push({ kind: 'bounty', id: b.id, name: b.targetName || 'the outlaw', icon: '🗡️', rank: 'outlaw', lawful: false,
                desc: `Taken for ${b.crime || 'his crimes'}, awaiting your word${tag ? ` · ${tag}` : ''}`, acts: acts(b) });
        }
        return out;
    },

    /** Run an act on one in your power. kind: vassal|kin|pretender|captive|bounty|rival. → { success, message|reason } */
    act(player, world, kind, id, act) {
        if (!Maiming.enabled()) return { success: false, reason: 'Not in this world.' };
        let r;
        if (kind === 'vassal') r = Maiming.maimVassal(player, world, id, act);
        else if (kind === 'kin') r = Maiming.maimKin(player, world, id, act);
        else if (kind === 'pretender') r = Maiming.maimPretender(player, world, act);
        else if (kind === 'captive') r = Maiming.maimCaptive(player, world, Number(id), act);
        else if (kind === 'bounty') r = Maiming.maimBounty(player, world, id, act);
        else if (kind === 'rival') r = RivalCaptives.maim(player, world, id, act);
        else r = { ok: false, reason: 'No one by that name is in your power.' };
        // (what the faith makes of it: systems/maimFaith.js)
        const fl = r.ok && r.brand && r.brand.faithLine ? ` ${r.brand.faithLine}` : '';
        return r.ok ? { success: true, message: `${r.text}${fl}` } : { success: false, reason: r.reason || 'It cannot be done.' };
    },

    /** A lord of the royal court: the crown's justice on a rebel, or tyranny on an innocent. */
    maimVassal(player, world, vassalId, act) {
        const court = Maiming._court(player, world);
        const v = court && (court.vassals || []).find(x => x.id === vassalId);
        if (!v) return { ok: false, reason: 'No such lord at your court.' };
        if (MaimMarks.act(act) && MaimMarks.act(act).npcOnly) return { ok: false, reason: 'Not a lord.' };
        const why = MaimMarks.whyNot(v, act);
        if (why) return { ok: false, reason: why };
        const B = Maiming.config().brand;
        const k = Throne.ruledKingdom(player, world);
        const day = _day(world);
        const guilty = Maiming._vassalGuilty(v, world);
        const name = Kingship.fullName(v);
        MaimMarks.mark(v, act, { day, by: Maiming._by(player), why: guilty ? 'rebellion' : 'the crown\'s displeasure' });
        const n = MaimMarks.count(v, act);
        const s = Maiming._severity(act, n);
        v.grudge = _num(v.grudge) + _num(B.victimGrudge);
        v.opinion = _num(v.opinion) - _num(B.victimGrudge);
        // Fear runs through the hall: the rest are cowed; an innocent lord's fate makes them hate you too
        const until = day + Math.round(_num(B.vassalsCowedDays, 120) * s / 3);
        for (const o of court.vassals) {
            if (o === v) continue;
            o.cowedUntil = Math.max(_num(o.cowedUntil), until);
            if (!guilty) o.grudge = _num(o.grudge) + _num(B.grudgeOthers);
        }
        if (k) k.stability = Utils.clamp(_num(k.stability, 50) + _num(guilty ? B.stabilityRebel : B.stabilityInnocent), 0, 100);
        try {
            Nemesis.wrong(player, world, { kind: 'blood', ref: { vassalId: v.id }, name, line: v.dynasty || null, score: Math.round(_num((B.nemesis || {}).vassal, 65) * s / 3), age: _num(v.age, 30), gender: v.gender === 'female' ? 'female' : 'male', deed: { key: 'mutilation', label: `the ${MaimMarks._shortOf(act, n)} you left ${v.gender === 'female' ? 'her' : 'him'}`, note: k ? k.name : null } });
        } catch (e) { /* no nemesis */ }
        const res = Maiming.brand(player, world, act, { name, rank: 'vassal', kingdomId: k ? k.id : null, q: v.seat ? v.seat.q : null, r: v.seat ? v.seat.r : null }, {
            lawful: guilty, n, place: v.seat ? v.seat.name : null, tags: ['cruelty', 'court'],
            chronicle: `${Maiming._by(player)} had ${name}${guilty ? ', a rebel,' : ''} ${Maiming.pastTense(act, n)}.`,
        });
        const barred = MaimMarks.barsOffice(v);
        return { ok: true, text: `${_fill(MaimMarks.act(act).done, { victim: name })}${guilty ? ' The crown\'s justice on a rebel: the court is cowed.' : ` ${v.gender === 'female' ? 'She' : 'He'} had done nothing the court can name. The lords are cowed, and hate you for it.`}${barred ? ` ${v.gender === 'female' ? 'She' : 'He'} will never sit your council.` : ''}`, brand: res };
    },

    /** A child or sibling of your own House: the throne's oldest trick. */
    maimKin(player, world, childId, act) {
        const c = (player.children || []).find(x => x && x.id === childId && x.isAlive !== false);
        if (!c) return { ok: false, reason: 'No such child of the House.' };
        if (MaimMarks.act(act) && MaimMarks.act(act).npcOnly) return { ok: false, reason: 'Not your own blood.' };
        const why = MaimMarks.whyNot(c, act);
        if (why) return { ok: false, reason: why };
        const B = Maiming.config().brand;
        const day = _day(world);
        const name = `${c.firstName || 'Your child'} ${c.dynasty || ''}`.trim();
        MaimMarks.mark(c, act, { day, by: Maiming._by(player), why: 'the seat' });
        const n = MaimMarks.count(c, act);
        if (!_obj(c.kin)) c.kin = {};
        c.kin.grievance = _num(c.kin.grievance) + _num(B.kinGrievance);
        if (player.house) {
            const loss = Math.min(_num(player.house.prestige), _num(B.kinPrestige));
            if (loss > 0) House.spend(player.house, loss, `maimed ${c.firstName || 'a child'} of the House`, day);
        }
        try {
            Nemesis.wrong(player, world, { kind: 'blood', ref: { childId: c.id }, name, line: c.dynasty || null, score: Math.round(_num((B.nemesis || {}).kin, 70) * Maiming._severity(act, n) / 3), age: _num(c.age, 16), gender: c.gender === 'female' ? 'female' : 'male', deed: { key: 'mutilation', label: 'what you did to your own blood', note: null } });
        } catch (e) { /* no nemesis */ }
        const k = Throne.ruledKingdom(player, world);
        const res = Maiming.brand(player, world, act, { name, rank: 'kin', kingdomId: k ? k.id : (player.allegiance != null ? player.allegiance : null) }, {
            n, tags: ['betrayal', 'heirs'], chronicle: `${Maiming._by(player)} had ${c.firstName || 'a child of the House'}, of the House's own blood, ${Maiming.pastTense(act, n)}.`,
        });
        const barred = MaimMarks.barsRule(c);
        return { ok: true, text: `${_fill(MaimMarks.act(act).done, { victim: c.firstName || name })}${barred ? ` ${c.firstName || 'They'} can never sit the seat now.` : ''}`, brand: res };
    },

    /** The old line's pretender's body, kept on the crown's preparation record. */
    _pretenderBody(player, k) {
        try {
            const prep = CrownSuccession.prep(player, k.id);
            return prep.pretender || null;
        } catch (e) { return null; }
    },

    /** The old royal line's claimant: blind him, slit his nose, take his tongue or geld him, and his claim ends. */
    maimPretender(player, world, act) {
        const { k } = CrownSuccession._court(player, world);
        const line = k ? CrownSuccession.oldLine(player, world, k) : null;
        if (!line) return { ok: false, reason: 'No old royal line troubles this crown.' };
        if (!['eye', 'nose', 'tongue', 'geld'].includes(act)) return { ok: false, reason: 'That would not end his claim.' };
        const prep = CrownSuccession.prep(player, k.id);
        const body = prep.pretender || {};
        if (act === 'eye') {
            // (blinding is both eyes, done at once)
            if (!_obj(body.maimed)) body.maimed = { parts: {}, log: [] };
            body.maimed.parts.eye = 1;
        }
        const why = MaimMarks.whyNot(body, act);
        if (why) return { ok: false, reason: why };
        const B = Maiming.config().brand;
        const day = _day(world);
        MaimMarks.mark(body, act, { day, by: Maiming._by(player), why: 'his claim' });
        const n = MaimMarks.count(body, act);
        if (!MaimMarks.barsRule(body)) return { ok: false, reason: 'That would not end his claim.' };
        // The claim is ended for a generation: the line has no one fit to press it
        prep.brokenUntil = day + Math.round(_num(B.pretenderYears, 40) * Atrocities._yearDays());
        if (line.charId && k.characterData && Array.isArray(k.characterData.children)) {
            const royal = k.characterData.children.find(c => c.id === line.charId);
            if (royal) { royal.maimed = JSON.parse(JSON.stringify(body.maimed)); royal.unfitToRule = true; }
        }
        prep.pretender = null;
        prep.maimedPretender = { name: line.name, act, day };
        k.stability = Utils.clamp(_num(k.stability, 50) + _num(B.pretenderStability), 0, 100);
        if (player.house) {
            const loss = Math.min(_num(player.house.prestige), _num(B.pretenderPrestige));
            if (loss > 0) House.spend(player.house, loss, `maimed ${line.name}`, day);
        }
        try {
            Nemesis.wrong(player, world, { kind: 'blood', ref: { kingdomId: `old:${k.id}` }, name: line.name, line: line.dynasty || null, score: _num((B.nemesis || {}).royal, 80), age: _num(line.age, 30), gender: line.gender === 'female' ? 'female' : 'male', deed: { key: 'mutilation', label: 'the eyes of the old line', note: k.name } });
        } catch (e) { /* no nemesis */ }
        const res = Maiming.brand(player, world, act, { name: line.name, rank: 'royal', kingdomId: k.id, q: k.capital ? k.capital.q : null, r: k.capital ? k.capital.r : null }, {
            n: act === 'eye' ? 2 : n, tags: ['throne', 'succession', 'cruelty'],
            chronicle: `${Maiming._by(player)} had ${line.name}, the last claimant of the old line of ${Names.realm(k.name)}, ${Maiming.pastTense(act, act === 'eye' ? 2 : n)}. No one so marked may ever wear the crown.`,
        });
        const done = act === 'eye' ? `${line.name}'s eyes are put out.` : _fill(MaimMarks.act(act).done, { victim: line.name });
        return { ok: true, text: `${done} The old line has no one left fit to press its claim; the realm mutters (${B.pretenderStability} stability), and every court hears of it.`, brand: res };
    },

    /** One you keep in a cellar (systems/peopleCrimes.js captives). */
    maimCaptive(player, world, captiveId, act) {
        const cap = PeopleCrimes.captives(player).find(x => x.id === captiveId);
        if (!cap) return { ok: false, reason: 'No such captive.' };
        const { s, folk, p } = PeopleCrimes.personAt(world, cap.q, cap.r, cap.pid);
        if (!p || p.died != null) return { ok: false, reason: 'They are past your knife.' };
        const r = Maiming.maimFolk(player, world, { settlement: s, folk, person: p, act, seen: false, inCellar: true });
        if (r.ok) cap.maimed = true;
        return r;
    },

    /** An outlaw you took for a bounty, before you turn him in or take him into your company. */
    maimBounty(player, world, bountyId, act) {
        const b = (player.activeBounties || []).find(x => x && x.id === bountyId && x.status === 'captured_pending_decision');
        if (!b) return { ok: false, reason: 'You hold no such outlaw.' };
        const why = MaimMarks.whyNot(b, act);
        if (why) return { ok: false, reason: why };
        MaimMarks.mark(b, act, { day: _day(world), by: Maiming._by(player), why: b.crime || null });
        const n = MaimMarks.count(b, act);
        const name = b.targetName || 'the outlaw';
        const res = Maiming.brand(player, world, act, { name, rank: 'outlaw', kingdomId: b.kingdomId != null ? b.kingdomId : null }, { seen: false, n, tags: ['cruelty'] });
        return { ok: true, text: `${_fill(MaimMarks.act(act).done, { victim: name })} The magistrate pays the same for what is left; as a sword in your company he is worth ${Math.round(MaimMarks.fightShare(b) * 100)}% of what he was.`, brand: res };
    },

    // ── The law: what a realm's courts take ────────────────────

    /** The realm's mutilation law: 'never' | 'thieves' | 'old' (its custom until a ruler sets it). */
    lawOption(world, kingdomId) {
        if (kingdomId == null) return 'never';
        try { return Laws.value(world, kingdomId, 'mutilation') || 'never'; } catch (e) { return 'never'; }
    },

    /**
     * What the realm's law takes for one of these crimes (trial charge groups
     * or judge crime ids), on this offence → the act, or null. groups: [string].
     */
    lawAct(world, kingdomId, groups, offenseNumber = 1) {
        const L = Maiming.config().law;
        const rule = _obj(L[Maiming.lawOption(world, kingdomId)]) || {};
        if (rule.repeat && _num(offenseNumber, 1) < 2) return null;
        const map = _obj(L.crimeGroups) || {};
        for (const g of groups || []) {
            const grp = map[g] || g;
            if (rule[grp] && MaimMarks.act(rule[grp])) return rule[grp];
        }
        return null;
    },

    /** The player as judge: what the 'maim' verdict would take for this case's crime (null: the law takes nothing). */
    judgeAct(world, kingdomId, crimeId) {
        const L = Maiming.config().law;
        const rule = _obj(L[Maiming.lawOption(world, kingdomId)]) || {};
        const grp = (_obj(L.crimeGroups) || {})[crimeId] || crimeId;
        return rule[grp] && MaimMarks.act(rule[grp]) ? rule[grp] : null;
    },

    // ── The player maimed ──────────────────────────────────────

    /**
     * The player loses a part. o = { by, why, source, lawful, kingdomId,
     * noWound }. The body, the stump (a wound that may turn), the chronicle.
     * → { ok, act, n, text, wound } or { ok: false, reason }
     */
    maimPlayer(player, world, act, o = {}) {
        if (!player || !Maiming.enabled()) return { ok: false, reason: 'Not in this world.' };
        const why = MaimMarks.whyNot(player, act);
        if (why) return { ok: false, reason: why };
        const day = _day(world);
        const def = MaimMarks.mark(player, act, { day, by: o.by || null, why: o.why || o.source || null });
        const n = MaimMarks.count(player, act);
        const st = Maiming.state(player);
        st.stats.suffered = _num(st.stats.suffered) + 1;
        let wound = null;
        if (!o.noWound && act !== 'brand') {
            try { wound = Ailments.inflict(player, world, Maiming.config().stumpWound || 'fresh_stump', { source: 'maimed' }); } catch (e) { wound = null; }
        }
        const base = n >= 2 && act === 'eye' ? 'Your other eye is put out. You are blind.' : (def.suffer || 'You are maimed.');
        const text = `${base}${o.by ? ` (${o.by}${o.why ? `, for ${o.why}` : ''}.)` : ''}`;
        if (player.house) House._chronicle(player.house, world, `${player.name || 'The head of the House'} ${Maiming.pastTense(act, n).replace(/^lose/, 'lost').replace(/^(blinded|branded|gelded|cropped|slit-nosed)/, 'was $1')}${o.by ? ` at the hands of ${o.by}` : ''}${o.why ? `, for ${o.why}` : ''}.`, ['wounds']);
        return { ok: true, act, n, text, wound };
    },

    /**
     * The one who beat the player senseless on the street map: if they hold a
     * grudge for one the player maimed (or any grudge, rarely), they may take
     * the same while the player lies there. → the act, or null.
     */
    vengeance(npc, player, world) {
        if (!npc || !player || !Maiming.enabled() || ['guard', 'child'].includes(npc.type)) return null;
        const V = Maiming.config().player.vengeance;
        const mem = NpcDisposition.getMemory(npc) || {};
        // (the one maimed, or kin of one maimed, holds it hardest; any other grudge, rarely)
        const g = mem.maimedBy ? { severity: 'maimed', act: mem.maimedBy.act } : mem.grudge;
        if (!g) return null;
        const chance = g.severity === 'maimed' ? _num(V.maimGrudge) : _num(V.grudge);
        if (_roll(world, `venge|${npc.uid || npc.id}|${_day(world)}`) >= chance) return null;
        const want = g.act && !MaimMarks.whyNot(player, g.act) ? g.act : null;
        if (want) return want;
        for (const a of ['hand', 'eye', 'ear']) if (!MaimMarks.whyNot(player, a)) return a;
        return null;
    },

    /**
     * Beaten on the road (player/roadEncounters.js: robbed alone, or your army
     * beaten): bandits, outlaws, raiders and pirates may take something — a
     * thief-hunter's hand, an ear, the nose — rarely, likelier for a cruel
     * band and a name they hate (cruelty, outlaws you hunted or maimed). A
     * rival House's waylaying men take what is owed them (rival.maimOwed).
     * how: 'robbed' | 'defeat'. A hash roll. → { act, text, wound } or null.
     */
    roadMaim(player, world, attacker, how = 'robbed') {
        if (!player || !attacker || !Maiming.enabled() || player.isAlive === false) return null;
        if (attacker.type === 'beast' || attacker.type === 'monster' || attacker.bountyHunt) return null;
        const R = _obj(Maiming.config().road) || {};
        const L = _obj(R.lines) || {};
        const day = _day(world);
        const key = `${attacker.id != null ? attacker.id : attacker.name}|${day}|${how}`;
        const u = _roll(world, `road|${key}`);
        const first = (o) => { for (const a of o) if (MaimMarks.act(a) && !MaimMarks.whyNot(player, a)) return a; return null; };
        let act = null;
        let lead = '';
        let by = attacker.name || 'the band';
        // A rival House's men (systems/rivalHouses.js waylay): blood owed for blood
        let rival = null;
        try { rival = RivalHouses.isRetinue(attacker) ? RivalHouses.rivalOfUnit(player, attacker) : null; } catch (e) { rival = null; }
        if (rival) {
            const owed = rival.maimOwed && day <= _num(rival.maimOwed.until) ? rival.maimOwed : null;
            by = `${RivalHouses.headName(rival)}'s men`;
            if (owed && u < _num(R.owed, 0.5)) {
                act = first([owed.act, 'eye', 'hand', 'ear']);
                lead = _fill(L.owed || '', { house: rival.name, victim: owed.victim });
                if (act) rival.maimOwed = null;
            } else if (!owed && _num(rival.feud) >= _num(R.feudAt, 95) && u < _num(R.feudChance, 0.05)) {
                act = first(['ear', 'nose', 'hand']);
                lead = _fill(L.feud || '', { house: rival.name });
            }
        } else {
            const base = _num((_obj(R.base) || {})[how], how === 'defeat' ? 0.02 : 0.01);
            const T = _obj(R.types) || {};
            const kindMult = _num(T[attacker.type], _num(T.other, 0.7));
            const [c0, c1] = Array.isArray(R.cruelty) ? R.cruelty : [0.5, 1.6];
            const cruelty = _num(c0, 0.5) + (_hash(`${_seed(world)}|bandCruelty|${attacker.id != null ? attacker.id : attacker.name}`) % 1000) / 1000 * (_num(c1, 1.6) - _num(c0, 0.5));
            const st = Maiming.state(player);
            const outlawsMaimed = st.history.filter(h => h && h.rank === 'outlaw').length;
            const hunted = _num(player.bountiesCompleted);
            const name = 1 + Atrocities.butcher(player) / Math.max(1, _num(R.butcherNorm, 60)) + hunted * _num(R.perBounty, 0.08) + outlawsMaimed * _num(R.perMaimedOutlaw, 0.35);
            const chance = Math.min(_num(R.cap, 0.2), base * kindMult * cruelty * name);
            if (u >= chance) return null;
            // A thief-hunter's grudge takes the hand that dragged their own to the rope
            if (hunted >= _num(R.hunterAt, 4) || outlawsMaimed > 0) { act = first(['hand', 'ear', 'nose']); lead = L.hunter || ''; }
            if (!act) {
                const pool = { ...(_obj(R.pool) || { ear: 3, nose: 2, hand: 1, eye: 1 }) };
                for (const a of Object.keys(pool)) if (!MaimMarks.act(a) || MaimMarks.whyNot(player, a)) delete pool[a];
                act = _pickW(pool, _roll(world, `roadAct|${key}`));
                lead = L.band || '';
            }
        }
        if (!act) return null;
        const r = Maiming.maimPlayer(player, world, act, { by, why: rival ? 'the feud' : 'sport', source: 'road' });
        if (!r.ok) return null;
        return { act, text: `${lead ? `${lead} ` : ''}${r.text}`, wound: r.wound };
    },

    // ── Aids, made by a town's craftsmen ───────────────────────

    /**
     * The craftsman in town who makes this aid: a townsperson of one of its
     * trades; else (a town whose folk have no trade yet — they get theirs on
     * the first town turn — or none of that trade) the town's market stalls,
     * which make one to order when the market has the material: { stall: true,
     * name } (the fee then goes to the town's purse). null when neither.
     */
    _maker(world, settlement, aid) {
        const folk = settlement && settlement.folk;
        const makers = Array.isArray(aid.makers) ? aid.makers : [];
        if (folk && Array.isArray(folk.people)) {
            // (give the grown their trades now if the town has not yet had its turn)
            try { TownJobs.ensure(folk, settlement, world); } catch (e) { /* no jobs */ }
            const day = _day(world);
            const can = folk.people.filter(p => Townsfolk.isHere(p) && p.job && makers.includes(p.job.id) && Townsfolk.age(p, day) >= 16 && MaimMarks.workFactor(p, p.job.id) > 0.3);
            can.sort((a, b) => (a.job.rank === 'master' ? 0 : 1) - (b.job.rank === 'master' ? 0 : 1) || a.id - b.id);
            if (can[0]) return can[0];
        }
        if (settlement && settlement.market) return { stall: true, name: `the stalls of ${settlement.name}'s market` };
        return null;
    },

    /** The aids that would serve the player's losses here: [{ id, name, icon, desc, cost, ok, why, maker, worn }]. */
    aidOptions(player, world, settlement) {
        const out = [];
        if (!player || !MaimMarks.any(player)) return out;
        for (const [id, a] of Object.entries(MaimMarks.config().aids)) {
            if (!MaimMarks.has(player, a.fits)) continue;
            if (a.maxCount != null && MaimMarks.count(player, a.fits) > _num(a.maxCount)) continue;
            const worn = MaimMarks.wears(player, id);
            const maker = settlement ? Maiming._maker(world, settlement, a) : null;
            const qty = Math.max(1, _num(a.qty, 1));
            const stock = settlement ? SettlementMarket.available(settlement, a.material) : 0;
            const cost = Utils.cents(_num(a.fee) + _num(a.materialCost) * qty);
            let why = '';
            if (worn) why = 'You wear one already.';
            else if (!settlement) why = 'Only a town\'s craftsmen make these.';
            else if (!maker) why = `No ${a.makers.join(' or ')} in ${settlement.name} to make one.`;
            else if (stock < qty) why = `${settlement.name}'s market has no ${String(a.material).replace(/_/g, ' ')} to make it from.`;
            else if (_num(player.gold) < cost) why = `It costs ${Utils.formatGold(cost)}g.`;
            out.push({ id, name: a.name, icon: a.icon, desc: a.desc || '', cost, ok: !why, why, worn, maker: maker ? (maker.stall ? maker.name : `${Townsfolk.name(maker)}, ${String(maker.job.id).replace(/_/g, ' ')}`) : null });
        }
        return out;
    },

    /** Have an aid made and fitted: the fee to the maker, the material from the market (its cost to the town). */
    buyAid(player, world, settlement, aidId) {
        const opt = Maiming.aidOptions(player, world, settlement).find(o => o.id === aidId);
        if (!opt) return { success: false, reason: 'Nothing like that would help you.' };
        if (!opt.ok) return { success: false, reason: opt.why };
        const a = MaimMarks.aid(aidId);
        const maker = Maiming._maker(world, settlement, a);
        const qty = Math.max(1, _num(a.qty, 1));
        const took = SettlementMarket.take(settlement, a.material, qty);
        if (took < qty) return { success: false, reason: `${settlement.name}'s market has no ${a.material} to make it from.` };
        const fee = Utils.cents(_num(a.fee));
        const mat = Utils.cents(_num(a.materialCost) * qty);
        player.gold = Utils.cents(_num(player.gold) - fee - mat);
        Ledger.record(player, 'medicine', -(fee + mat));
        // (the craftsman's labour into their purse — a market stall's into the town's — and the material's price into the town's)
        if (maker.stall) Economy.payTown(settlement, fee);
        else {
            Townsfolk.purse(settlement.folk, maker, world);
            maker.purse = Utils.cents(_num(maker.purse) + fee);
        }
        if (mat > 0) Economy.payTown(settlement, mat);
        MaimMarks.fitAid(player, aidId, _day(world));
        return { success: true, message: `${maker.stall ? _cap(maker.name) : Townsfolk.name(maker)} makes you ${/^[aeiou]/i.test(a.name) ? 'an' : 'a'} ${a.name.toLowerCase()} and fits it (${Utils.formatGold(fee + mat)}g). ${a.desc || ''}`.trim() };
    },

    // ── What others see of you ─────────────────────────────────

    /** A line for a townsperson's greeting, the first time they see what you lost (null when whole). */
    lookLine(player, npc) {
        if (!player || !MaimMarks.any(player)) return null;
        const what = MaimMarks.looks(player);
        if (!what) return null;
        const mem = npc && npc._dialogMemory;
        if (mem && mem.sawMaim === what) return null;
        if (mem) mem.sawMaim = what;
        return Maiming.line('lookAtYou', { name: (npc && npc.name) || 'They', what: `your ${what.split(', ')[0].replace(/^the /, '').replace(/^a /, '')}` }, `${npc && (npc.uid || npc.id)}`);
    },

    // ── The world's day ────────────────────────────────────────

    /**
     * Weekly: harsh realms take thieves' hands, raided towns count their
     * maimed, an enemy may have one of the player's children maimed. Own hash
     * rolls; no notice unless it touches the player. → { notices }
     */
    processDay(world, player = null) {
        const out = { notices: [] };
        if (!world || !Maiming.enabled()) return out;
        const A = Maiming.config().ai;
        const day = _day(world);
        const every = Math.max(1, Math.round(_num(A.everyDays, 7)));
        if (day % every !== 0) return out;
        Maiming._worldWeek(world, day, A);
        if (player) Maiming._enemiesWeek(world, player, day, out);
        // Your captives of the rival Houses, and theirs of yours (systems/rivalCaptives.js)
        if (player) RivalCaptives.week(world, player, day, out);
        return out;
    },

    _worldWeek(world, day, A) {
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        let n = 0;
        for (const s of views) {
            if (!s || !s.folk || !Array.isArray(s.folk.people)) continue;
            if (n >= _num(A.townsPerWeek, 40)) break;
            let did = false;
            // The law of the realm takes the hand of a thief caught (systems/streetCrime.js recordNpcCrime)
            const law = s.kingdom != null ? Maiming.lawOption(world, s.kingdom) : 'never';
            if (law !== 'never' && Array.isArray(s.npcCrimes)) {
                for (const e of s.npcCrimes) {
                    if (!e || !e.caught || e.maimDone || e.byPid == null || day - _num(e.d) > _num(A.recordDays, 40)) continue;
                    const act = Maiming.lawAct(world, s.kingdom, [e.k], 2);
                    if (!act) continue;
                    e.maimDone = true;
                    // (a faith that holds the body sacred stays the court's hand; a harsh one hastens it)
                    if (_roll(world, `law|${s.q},${s.r}|${e.id}`) >= _num(A.lawHand, 0.6) * _num(MaimFaith.def(MaimFaith.realmStance(world, s.kingdom)).aiLaw, 1)) continue;
                    const p = Townsfolk.get(s.folk, e.byPid);
                    if (!p || !Townsfolk.isHere(p) || MaimMarks.whyNot(p, act)) continue;
                    MaimMarks.mark(p, act, { day, by: 'the court', why: 'theft', patch: true });
                    Maiming._loseTrade(s.folk, p, day);
                    Townsfolk.record(s.folk, world, day, { k: 'townMemory', x: `${Townsfolk.name(p)} lost a hand to the court for a thief {when}` });
                    did = true;
                }
            }
            // A town raided lately: someone came home from it maimed (once per raid)
            const raided = _num(s.lastRaidedDay, -1e9);
            if (day - raided <= _num(A.raidDays, 30) && s.folk.maimRaid !== raided) {
                s.folk.maimRaid = raided;
                if (_roll(world, `raid|${s.q},${s.r}|${raided}`) < _num(A.raidMaim, 0.35)) {
                    const adults = Townsfolk.residents(s.folk).filter(p => Townsfolk.age(p, day) >= 16 && p.role !== 'noble');
                    if (adults.length) {
                        const p = adults[_hash(`${_seed(world)}|raidWho|${s.q},${s.r}|${raided}`) % adults.length];
                        const act = _roll(world, `raidAct|${s.q},${s.r}|${raided}`) < 0.5 ? 'eye' : 'hand';
                        if (!MaimMarks.whyNot(p, act)) {
                            MaimMarks.mark(p, act, { day, by: 'the raiders', why: 'the raid', patch: _roll(world, `patch|${s.q},${s.r}#${p.id}`) < 0.7 });
                            Maiming._loseTrade(s.folk, p, day);
                            Townsfolk.record(s.folk, world, day, { k: 'townMemory', x: `${Townsfolk.name(p)} lost ${act === 'eye' ? 'an eye' : 'a hand'} when the raiders came {when}` });
                            did = true;
                        }
                    }
                }
            }
            if (did) n++;
        }
    },

    /** An enemy at its worst has one of your grown children maimed (rare; once in years per enemy). */
    _enemiesWeek(world, player, day, out) {
        const E = Maiming.config().player.enemies;
        const st = Maiming.state(player);
        const foes = [];
        try { for (const nm of Nemesis.active(player)) if (_num(nm.hatred) >= _num(E.hatred, 85)) foes.push({ key: `nm:${nm.id}`, name: nm.name }); } catch (e) { /* none */ }
        for (const r of Object.values((player.house && player.house.rivals) || {})) {
            // (a House whose child you maimed owes you blood: its blades come sooner, for the same: systems/rivalCaptives.js)
            const owed = r && r.maimOwed && day <= _num(r.maimOwed.until) ? r.maimOwed : null;
            if (r && (owed || _num(r.feud) >= _num(E.feud, 90))) foes.push({ key: `rh:${r.kingdomId}`, name: r.name || 'a rival House', owed, rival: r });
        }
        for (const f of foes) {
            if (!f.owed && day - _num(st.enemyDays[f.key], -1e9) < _num(E.everyDays, 1200)) continue;
            if (_roll(world, `enemy|${f.key}|${day}`) >= (f.owed ? _num(RivalCaptives.config().owedWeekly, 0.08) : _num(E.weekly, 0.02))) continue;
            const kids = (player.children || []).filter(c => c && c.isAlive !== false && !c.isSibling && _num(c.age) >= _num(E.minAge, 14));
            if (!kids.length) continue;
            const c = kids[_hash(`${_seed(world)}|enemyKid|${f.key}|${day}`) % kids.length];
            const pool = { ...(E.pool || {}) };
            for (const a of Object.keys(pool)) if (MaimMarks.whyNot(c, a)) delete pool[a];
            const act = f.owed && !MaimMarks.whyNot(c, f.owed.act) ? f.owed.act : _pickW(pool, _roll(world, `enemyAct|${f.key}|${day}`));
            if (!act) continue;
            st.enemyDays[f.key] = day;
            if (f.owed) f.rival.maimOwed = null;
            MaimMarks.mark(c, act, { day, by: f.name, why: 'a feud' });
            const n = MaimMarks.count(c, act);
            const what = MaimMarks._shortOf(act, n);
            const barred = MaimMarks.barsRule(c);
            const text = `Hired men in the pay of ${f.name} fell on ${c.firstName} on the road and left them ${what}.${f.owed ? ` Blood for ${f.owed.victim}'s.` : ''}${barred ? ` ${c.firstName} can never sit the seat now.` : ''}`;
            if (player.house) House._chronicle(player.house, world, `${c.firstName} was left ${what} by hired men of ${f.name}.`, ['heirs', 'feud']);
            out.notices.push({ icon: MaimMarks.act(act).icon || '🔪', title: `${c.firstName} Is Maimed`, text, type: 'error' });
            break;
        }
    },

    /**
     * An AI realm's succession crisis ends (systems/throne.js _resolveCrisis):
     * the winner may blind the loser, or slit his nose, so he never rises
     * again. A hash roll. → the text, or null.
     */
    onCrisisResolved(world, crisis, winner) {
        if (!world || !crisis || !winner || !Maiming.enabled()) return null;
        const loser = (crisis.claimants || []).find(c => c !== winner);
        if (!loser) return null;
        const u = _roll(world, `crisis|${crisis.id}|${crisis.kingdomId}`);
        if (u >= _num(Maiming.config().ai.crisisBlind, 0.3)) return null;
        const act = u < _num(Maiming.config().ai.crisisBlind, 0.3) * 0.7 ? 'eye' : 'nose';
        const body = loser.character || loser;
        if (act === 'eye') {
            if (!_obj(body.maimed)) body.maimed = { parts: {}, log: [] };
            body.maimed.parts.eye = 1;
        }
        MaimMarks.mark(body, act, { day: _day(world), by: winner.name, why: 'the crown' });
        loser.maimed = body.maimed;
        const text = act === 'eye'
            ? `${winner.name} has the eyes of ${loser.name} put out, so that he may never again press a claim to the crown of ${Names.realm(crisis.kingdomName || 'the realm')}.`
            : `${winner.name} has the nose of ${loser.name} slit: by the old law, no one so marked may sit the throne of ${Names.realm(crisis.kingdomName || 'the realm')}.`;
        if (Array.isArray(world.events)) world.events.push({ text: `👁️ ${text}`, type: 'political', category: 'political', kingdom: crisis.kingdomId });
        return text;
    },
};
