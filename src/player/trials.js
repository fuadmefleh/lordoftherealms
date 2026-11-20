// ============================================
// TRIALS — law courts: the player tried, the player as judge, Houses at law
// ============================================
// Nothing tried anyone: an arrest was a sentence. This puts a court between
// them, built on what already keeps the evidence.
//
//   THE PLAYER TRIED. Any arrest (Underworld._arrest — the watch, a guard at
//   the gate, a bounty hunter's delivery, giving yourself up) holds the player
//   on REMAND in the jail town (jailState.trialId; the cell, its bribes and its
//   tunnel all still there, player/prison.js). The CASE is the town's own
//   (systems/watchQuestioning.js charges: the deed, its proof 0–3 and the
//   witnesses who saw it) and the crown's sheet in that realm
//   (systems/wanted.js). The JUDGE is the realm's lord in his capital (his
//   traits make his persona) or a magistrate of the town (a townsperson of
//   standing) elsewhere; the court keeps the realm's old CUSTOM (a magistrate's
//   bench, a jury of peers, oath-helpers, ordeal: a hash of the realm) under
//   its PUNISHMENT LAW (systems/laws.js). Before the day: hire an advocate (the
//   fee into a real townsperson's purse), bribe the judge (his purse, or his
//   crown's chests — refused, it is a new charge), sway, pay or threaten the
//   witnesses (paying or threatening one is a crime of its own), plead guilty.
//   The verdict weighs the evidence still standing against the advocate, the
//   player's name in the realm, the House's prestige and the coin: acquittal,
//   a fine (to the crown's chests when the lord judges, else to the town's
//   court purse), the cells (the jailState's days), a brand, exile from the
//   realm (come back and the watch may take you). Out on bail or escaped on
//   the day: tried in absence, and the sentence goes on the crown's sheet.
//
//   THE PLAYER AS JUDGE. Where the player rules (Petitions.holdingContexts: a
//   holding, an office's capital, a realm), the town's crimes come to court:
//   one on the town's record (settlement.npcCrimes — a burglar named, a brawl,
//   a looter), or a complaint the folk bring. The truth is hidden; the
//   evidence says how likely. The verdict's harshness against the crime moves
//   happiness, loyalty, prestige and the court's character (Petitions'
//   effects); the accused and their kin remember it (NpcMemory: condemned,
//   spared, hanged — the blood the avengers count), the victim too. A wrong
//   verdict may surface months later.
//
//   LAWSUITS. The player's House and a rival House (systems/rivalHouses.js)
//   may sue each other: an unpaid debt, an estate both claim, a broken
//   betrothal, slander. The hearing comes some days on before the realm's
//   lord; damages go purse to purse; prestige and the feud move. A rival head
//   with grounds and some honour goes to law rather than to blades: suing is
//   one of its errands (systems/rivalHouses.js 'law', weighed against the
//   rest); it rides to the court, pays the fee and leaves rival.suing, which
//   the courts' day enters as a suit. A betrothal the rival House broke with
//   the player's family (systems/heirAgency.js rival.brokeBetrothal) is
//   grounds for the player.
//
//   THE BRAND. A brand stays on the person for years (world/brands.js reads
//   it where it is seen: first impressions, lords, rival heads, the watch,
//   respectable trades, fine houses). It can be PARDONED: a royal pardon
//   bought into the crown's chests, one granted for the House's Prestige, a
//   petition of the folk (the crown answers in a month, a seeded roll) or a
//   public penance (alms, and months with no new conviction).
//
// State: player.trials (saved, systems/saveLoad.js). The day (processDay,
// from ui/game/endDay.js before the jail's night) draws its own seeded stream;
// the player's own acts (a bribe, a threat, a verdict) draw Utils.random.
// Coin moves through PlayerCoin / Economy, purse to purse, in whole cents.
// Content and tuning: data/trials.json. Explicit params; no DOM.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Estates } from '../world/estates.js';
import { WatchQuestioning } from '../systems/watchQuestioning.js';
import { Underworld } from '../systems/underworld.js';
import { Laws } from '../systems/laws.js';
import { Wanted } from '../systems/wanted.js';
import { Gossip } from '../systems/gossip.js';
import { NpcMemory } from '../systems/npcMemory.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { Petitions } from '../systems/petitions.js';
import { House } from '../systems/house.js';
import { RivalHouses } from '../systems/rivalHouses.js';
import { CourtLetters } from '../systems/courtLetters.js';
import { Brands } from '../world/brands.js';
import { Prison } from './prison.js';
import { PlayerCoin } from './playerCoin.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = world => _num(world && world.day, 0);
const _seed = world => (world && world.generationParams && world.generationParams.seed) || 0;
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _fill = (t, vars) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
const _byType = (table, type) => _num((table || {})[type], _num((table || {}).default, _num((table || {}).town, 0)));
const _logit = z => 1 / (1 + Math.exp(-z));
const _pname = p => (p ? `${p.first}${p.last ? ` ${p.last}` : ''}` : 'someone');

function _hash(str) {
    const s = String(str);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
    return h >>> 0;
}
const _frac = str => _hash(str) / 4294967296;

function _kingdom(world, id) {
    if (!world || id == null) return null;
    if (typeof world.getKingdom === 'function') return world.getKingdom(id) || null;
    return (world.kingdoms || []).find(k => k && k.id === id) || null;
}

function _tile(world, q, r) {
    return world && typeof world.getTile === 'function' && Number.isFinite(q) && Number.isFinite(r) ? world.getTile(q, r) : null;
}

/** Add an effects object into another (numbers add ×mult, `court` axes merge). */
function _addFx(into, fx, mult = 1) {
    for (const [k, v] of Object.entries(fx || {})) {
        if (k === 'court' && _obj(v)) {
            into.court = into.court || {};
            for (const [a, n] of Object.entries(v)) into.court[a] = _num(into.court[a]) + _num(n) * mult;
        } else if (typeof v === 'number') into[k] = _num(into[k]) + v * mult;
    }
    return into;
}

export const Trials = {
    // ── Tuning ───────────────────────────────────────

    config() {
        const g = DataLoader._gamedata;
        return (g && g.trials) || {};
    },

    _c(section) { return Trials.config()[section] || {}; },

    line(pool, key, vars = {}) {
        const list = (Trials._c('lines')[pool]) || [];
        if (!list.length) return '';
        return _fill(list[_hash(`${pool}|${key}`) % list.length], vars);
    },

    // ── State ────────────────────────────────────────

    _blank() {
        return { next: 1, trial: null, last: null, cases: [], judged: [], suits: [], history: [], tried: [], heard: [], exiles: [], brands: [], suitDay: {} };
    },

    state(player) {
        if (!player) return Trials._blank();
        if (!_obj(player.trials)) player.trials = Trials._blank();
        const st = player.trials;
        const b = Trials._blank();
        for (const k of Object.keys(b)) if (st[k] === undefined) st[k] = b[k];
        return st;
    },

    _log(player, world, text, kind = 'trial') {
        const st = Trials.state(player);
        st.history.push({ day: _day(world), text, kind });
        const cap = _num(Trials.config().historyCap, 30);
        if (st.history.length > cap) st.history.splice(0, st.history.length - cap);
    },

    _rng(world, salt) {
        return Utils.seededRandom((_hash(`${_seed(world)}|trials|${salt}`) % 233279) + 1);
    },

    // ── Courts: judges, customs, law ─────────────────

    persona(id) {
        const P = Trials._c('judges').personas || {};
        return { id, ...(P[id] || P.just || { severity: 0, venality: 0.1, mercy: 0, rank: 0, evidence: 1, advocate: 1 }) };
    },

    /** A realm's old court custom: a hash of the realm by the customs' shares. */
    custom(world, kingdomId) {
        const C = Trials._c('customs');
        const ids = Object.keys(C).filter(k => k !== '_doc');
        if (!ids.length) return 'magistrate';
        const k = _kingdom(world, kingdomId);
        if (!k) return ids.includes('magistrate') ? 'magistrate' : ids[0];
        const u = _frac(`${k.id}|${k.name || ''}|court`);
        let acc = 0;
        const total = ids.reduce((s, id) => s + _num(C[id].share, 1), 0) || 1;
        for (const id of ids) { acc += _num(C[id].share, 1) / total; if (u < acc) return id; }
        return ids[ids.length - 1];
    },

    customDef(id) {
        const C = Trials._c('customs');
        return { id, evidence: 1, advocate: 1, reputation: 1, bribe: 1, noise: 0.06, name: id, icon: '⚖️', ...(C[id] || {}) };
    },

    /** The realm's punishment law option ('lenient' | 'standard' | 'harsh'). */
    law(world, kingdomId) {
        return (kingdomId != null && Laws.value(world, kingdomId, 'punishment')) || 'standard';
    },

    _lordPersona(lord) {
        const map = Trials._c('judges').traitPersona || {};
        for (const t of (lord && lord.traits) || []) {
            const id = String((t && (t.id || t)) || '').toLowerCase();
            if (map[id]) return map[id];
        }
        return null;
    },

    /** Grown residents of a town (a roster), oldest first. */
    _folkOf(s) {
        return s && s.folk && Array.isArray(s.folk.people) ? s.folk : null;
    },

    /**
     * Who sits in judgement at a town: the realm's lord in his capital, a
     * magistrate of the town elsewhere. → { name, title, persona, lord, pid?, kingdomId }
     */
    judgeFor(world, s, q, r) {
        const J = Trials._c('judges');
        const personas = Object.keys(J.personas || {});
        const k = s ? _kingdom(world, s.kingdom) : null;
        const lord = k && k.lord;
        const lordP = Trials._lordPersona(lord);
        const cap = k && k.capital;
        if (lord && cap && cap.q === q && cap.r === r) {
            return { name: lord.name || k.ruler || 'the lord', title: `ruler of ${k.name}`, persona: lordP || personas[_hash(`${k.id}|lordjudge`) % Math.max(1, personas.length)] || 'just', lord: true, kingdomId: k.id };
        }
        // A magistrate: a townsperson of standing, by a hash of the town
        const day = _day(world);
        const folk = Trials._folkOf(s);
        const roles = J.magistrateRoles || ['noble', 'priest', 'merchant'];
        let who = null;
        if (folk) {
            const fit = Townsfolk.residents(folk).filter(p => roles.includes(p.role) && Townsfolk.age(p, day) >= 30);
            fit.sort((a, b) => roles.indexOf(a.role) - roles.indexOf(b.role) || a.id - b.id);
            who = fit[0] || null;
        }
        const weights = personas.map(id => (id === lordP ? _num(J.lordWeight, 3) : 1));
        const total = weights.reduce((a, b) => a + b, 0) || 1;
        let u = _frac(`${_seed(world)}|${q},${r}|magistrate|${who ? who.id : 'x'}`) * total;
        let persona = personas[0] || 'just';
        for (let i = 0; i < personas.length; i++) { u -= weights[i]; if (u < 0) { persona = personas[i]; break; } }
        const title = `${J.magistrateTitle || 'magistrate'} of ${(s && s.name) || 'the town'}`;
        return { name: who ? _pname(who) : `the ${J.magistrateTitle || 'magistrate'}`, title, persona, lord: false, pid: who ? who.id : null, kingdomId: k ? k.id : null };
    },

    /** The live settlement of a court ({ q, r }) and its folk. */
    _court(world, court) {
        const t = court ? _tile(world, court.q, court.r) : null;
        return (t && t.settlement) || null;
    },

    _person(world, court, pid) {
        const s = Trials._court(world, court);
        const folk = Trials._folkOf(s);
        const p = folk && pid != null ? Townsfolk.get(folk, pid) : null;
        return p && Townsfolk.isHere(p) ? { folk, p, s } : null;
    },

    /** Where coin to a person goes: their purse (rolled first so no coin is made), else the court's town. */
    _payeeFor(world, court, pid) {
        const f = Trials._person(world, court, pid);
        if (f) {
            Townsfolk.purse(f.folk, f.p, world);
            return { purse: f.p, key: 'purse' };
        }
        return Trials._court(world, court);
    },

    /** The judge's purse: a lord's crown's chests, a magistrate's own purse, else the town's court. */
    _judgePurse(world, court) {
        const j = court.judge || {};
        if (j.lord) {
            const k = _kingdom(world, j.kingdomId);
            if (k && 'treasury' in k) return k;
        }
        return Trials._payeeFor(world, court, j.pid);
    },

    // ── Advocates & bribes (a trial or a lawsuit: a "court" with q, r, type, judge) ──

    /** Advocates for hire at the court's town. → [{ id, name, pid, skill, fee, title }] */
    advocates(world, court) {
        const A = Trials._c('advocates');
        const s = Trials._court(world, court);
        const folk = Trials._folkOf(s);
        const base = _byType(A.baseFee, court.type);
        const titles = A.titles || ['advocate'];
        const out = [];
        const day = _day(world);
        if (folk) {
            const roles = A.roles || ['noble', 'priest', 'merchant'];
            const fit = Townsfolk.residents(folk).filter(p => roles.includes(p.role) && Townsfolk.age(p, day) >= _num(A.minAge, 24)
                && !(court.judge && court.judge.pid === p.id));
            fit.sort((a, b) => _hash(`${court.id}|adv|${a.id}`) - _hash(`${court.id}|adv|${b.id}`));
            for (const p of fit.slice(0, _num(A.max, 3))) {
                const skill = Math.min(9, 2 + (_hash(`${_seed(world)}|advskill|${p.id}|${p.born}`) % 7) + (p.role === 'noble' ? _num(A.nobleBonus, 1) : 0));
                out.push({ id: `p${p.id}`, name: _pname(p), pid: p.id, skill, fee: Utils.cents(base * (0.5 + skill / 6)), title: titles[_hash(`${p.id}|t`) % titles.length] });
            }
        }
        if (!out.length) {
            const skill = _num(A.pleaderSkill, 3);
            out.push({ id: 'pleader', name: `the court pleader of ${court.town || 'the town'}`, pid: null, skill, fee: Utils.cents(base * (0.5 + skill / 6)), title: 'pleader' });
        }
        return out;
    },

    hireAdvocate(player, world, court, advId) {
        if (!court) return { success: false, reason: 'There is no case to argue.' };
        if (court.advocate) return { success: false, reason: `${court.advocate.name} already pleads for you.` };
        const a = Trials.advocates(world, court).find(x => x.id === advId);
        if (!a) return { success: false, reason: 'That advocate is not to be had.' };
        if (_num(player.gold) < a.fee) return { success: false, reason: `${a.name} asks ${Utils.formatGold(a.fee)} gold.` };
        PlayerCoin.pay(world, player, a.fee, Trials._payeeFor(world, court, a.pid), 'lawyers');
        court.advocate = { name: a.name, pid: a.pid, skill: a.skill, fee: a.fee };
        return { success: true, text: `${a.name} takes your case for ${Utils.formatGold(a.fee)} gold (skill ${a.skill}).` };
    },

    bribeCost(court, step) {
        const B = Trials._c('bribe');
        const steps = B.steps || [1, 2.5, 5];
        return Utils.cents(_byType(Trials._c('advocates').baseFee, court.type) * _num(steps[step], steps[0] || 1));
    },

    bribeChance(player, court) {
        const B = Trials._c('bribe');
        const pj = Trials.persona(court.judge && court.judge.persona);
        return _clamp(_num(pj.venality) + _num(player.skills && player.skills.diplomacy) * _num(B.diplomacyPer, 0.03), 0.02, 0.95);
    },

    /** Offer the judge coin. Taken: it weighs at the verdict. Refused: a charge (a trial) or a black mark (a lawsuit), and heat. */
    bribe(player, world, court, step = 0) {
        if (!court) return { success: false, reason: 'There is no court to bribe.' };
        if (court.bribeRefused) return { success: false, reason: 'The judge has already refused your coin, loudly.' };
        if (court.bribeDay === _day(world)) return { success: false, reason: 'Your go-between has been to the judge once today.' };
        const amount = Trials.bribeCost(court, step);
        if (_num(player.gold) < amount) return { success: false, reason: `That takes ${Utils.formatGold(amount)} gold.` };
        court.bribeDay = _day(world);
        const j = court.judge || {};
        if (Utils.random() < Trials.bribeChance(player, court)) {
            PlayerCoin.pay(world, player, amount, Trials._judgePurse(world, court), 'bribes');
            court.bribe = Utils.cents(_num(court.bribe) + amount);
            return { success: true, text: `${j.name || 'The judge'} takes ${Utils.formatGold(amount)} gold and says nothing at all.` };
        }
        court.bribeRefused = true;
        if (court.kingdomId != null) Underworld.addHeat(player, court.kingdomId, _num(Trials._c('bribe').refusedHeat, 6), world);
        if (Array.isArray(court.charges)) {
            court.charges.push({ id: `bribe${_day(world)}`, ids: [], group: 'bribing the court', label: 'offering a bribe to the court', proof: 3, who: [j.name || 'the judge'], grave: false });
        }
        return { success: true, refused: true, text: `${j.name || 'The judge'} refuses your coin before the clerk${Array.isArray(court.charges) ? ': a new charge of bribing the court' : ''}.` };
    },

    // ══════════════════════════════════════════════
    // THE PLAYER TRIED
    // ══════════════════════════════════════════════

    /** The jail's town: { s, q, r } (the jailState's hex, the player's tile, or by name). */
    _jailTown(player, world) {
        const jail = player && player.jailState;
        if (!jail) return null;
        let t = _tile(world, jail.q, jail.r);
        if (t && t.settlement) return { s: t.settlement, q: t.q != null ? t.q : jail.q, r: t.r != null ? t.r : jail.r };
        t = _tile(world, player.q, player.r);
        if (t && t.settlement && (!jail.settlement || t.settlement.name === jail.settlement)) return { s: t.settlement, q: player.q, r: player.r };
        const views = world && typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        for (const v of views || []) {
            const s = (v && v.settlement) || v;
            if (s && s.name === jail.settlement) return { s, q: v.q != null ? v.q : s.q, r: v.r != null ? v.r : s.r };
        }
        return null;
    },

    /** The town's charges against the player (those it already counted answered included), and the crown's sheet. */
    _charges(player, world, s, key, kid) {
        const st = Trials.state(player);
        const tried = new Set(st.tried);
        const day = _day(world);
        const t = WatchQuestioning.state(player).towns[key];
        const saved = t ? t.done : null;
        if (t) t.done = [];
        let list = [];
        try { list = WatchQuestioning.charges(player, world, s, key); } finally { if (t) t.done = saved; }
        const out = [];
        for (const c of list) {
            const ids = c.ids || [c.id];
            if (c.proof < 1 || ids.some(id => tried.has(`${key}|${id}`))) continue;
            if (day - _num(c.day, day) > 240) continue;
            out.push({ id: String(c.id), ids, group: c.group, label: WatchQuestioning.chargeLabel(c, s.name), proof: c.proof, who: (c.who || []).slice(0, 3), grave: WatchQuestioning.isGrave(c.group) });
        }
        // The crown's warrants in this realm (systems/wanted.js)
        const rec = kid != null ? Wanted.realm(player, kid) : null;
        for (const [label, c] of Object.entries((rec && rec.charges) || {})) {
            out.push({ id: `w:${label}`, ids: [], group: label, label: `${label} (the crown's warrant${_num(c.n) > 1 ? `, ${c.n} counts` : ''})`, proof: 2, who: [], grave: !!c.grave, warrant: true });
        }
        return out;
    },

    _witnesses(world, s, charges) {
        const folk = Trials._folkOf(s);
        const out = [];
        charges.forEach((c, i) => {
            for (const w of c.who || []) {
                const name = String(w).split(',')[0].trim();
                if (!name) continue;
                let rec = out.find(x => x.name === name);
                if (!rec) {
                    let p = null;
                    if (folk) {
                        const live = Townsfolk.residents(folk);
                        p = live.find(o => _pname(o) === name) || null;
                        if (!p) { const same = live.filter(o => o.first === name); if (same.length === 1) p = same[0]; }
                    }
                    rec = { name, pid: p ? p.id : null, charges: [], state: 'stands', tried: false, honest: false, poor: false };
                    if (p) {
                        const W = Trials._c('witnesses');
                        const tr = (p.traits || []).map(x => String((x && x.id) || x).toLowerCase());
                        rec.honest = tr.some(x => (W.honestTraits || []).includes(x));
                        rec.poor = (W.poorRoles || []).includes(p.role);
                    }
                    out.push(rec);
                }
                if (!rec.charges.includes(i)) rec.charges.push(i);
            }
        });
        return out.slice(0, 6);
    },

    /** Hold the jailed player for trial. opts: { surrendered } → the trial, or null (no court to hear it). */
    openTrial(player, world, opts = {}) {
        const jail = player && player.jailState;
        if (!jail || Trials.config().enabled === false) return null;
        const where = Trials._jailTown(player, world);
        if (!where || !where.s) return null;
        const st = Trials.state(player);
        const s = where.s;
        const key = `${where.q},${where.r}`;
        const kid = s.kingdom != null ? s.kingdom : null;
        const day = _day(world);
        const charges = Trials._charges(player, world, s, key, kid);
        const offense = String(jail.offense || 'a breach of the peace');
        if (st.exileBroken != null && String(st.exileBroken) === String(kid)) {
            charges.push({ id: `exile${day}`, ids: [], group: 'breaking exile', label: 'returning from exile', proof: 3, who: ['the watch'], grave: true });
            st.exileBroken = null;
        }
        if (!charges.length) {
            charges.push({ id: `arrest${day}`, ids: [], group: offense, label: offense, proof: 2, who: ['the watchman who took you'], grave: Wanted.isGraveCrime(offense) });
        }
        const remand = Math.max(1, Math.round(_byType(Trials.config().remandDays, s.type)));
        const court = {
            id: st.next++, opened: day, day: day + remand, town: s.name || 'the town', q: where.q, r: where.r, key,
            kingdomId: kid, type: s.type || 'town', offense, offenseNumber: _num(jail.offenseNumber, 1), held: _num(jail.totalDays),
            charges, judge: Trials.judgeFor(world, s, where.q, where.r), custom: Trials.custom(world, kid), law: Trials.law(world, kid),
            advocate: null, bribe: 0, bribeRefused: false, bribeDay: null, plea: null, surrendered: !!opts.surrendered,
        };
        court.witnesses = Trials._witnesses(world, s, charges);
        jail.trialId = court.id;
        jail.daysRemaining = Math.max(_num(jail.daysRemaining), remand + 1);
        jail.totalDays = Math.max(_num(jail.totalDays), jail.daysRemaining);
        st.trial = court;
        return court;
    },

    /** Is the player here for the trial (in its cells, or out on bail and in the town)? */
    present(player, trial) {
        if (!player || !trial) return false;
        if (player.jailState) return player.jailState.trialId === trial.id;
        return player.q === trial.q && player.r === trial.r;
    },

    _witnessFactor(trial, i) {
        const ws = (trial.witnesses || []).filter(w => w.charges.includes(i));
        const c = trial.charges[i];
        if (!ws.length) return 1;
        const floor = _num((Trials._c('verdict').witnessFloor || {})[String(c.proof)], 0.15);
        return Math.max(floor, ws.filter(w => w.state === 'stands').length / ws.length);
    },

    /** The court's odds against the player. → { p (conviction), z, evidence, defence } */
    odds(player, world, trial, opts = {}) {
        const V = Trials._c('verdict');
        const pw = Trials.config().proofWeight || {};
        const cu = Trials.customDef(trial.custom);
        const pj = Trials.persona(trial.judge && trial.judge.persona);
        let evidence = 0;
        trial.charges.forEach((c, i) => { evidence += _num(pw[String(c.proof)], 1) * Trials._witnessFactor(trial, i); });
        let z = _num(V.base, -1.1) + evidence * _num(V.evidenceMult, 0.85) * _num(cu.evidence, 1) * _num(pj.evidence, 1)
            + _num(pj.severity) + _num((V.law || {})[trial.law]);
        const kid = trial.kingdomId;
        const adv = trial.advocate ? trial.advocate.skill * _num(V.advocatePer, 0.16) * _num(cu.advocate, 1) * _num(pj.advocate, 1) : 0;
        const rep = (kid != null ? _clamp(_num(player.reputation && player.reputation[kid]) / 100, -1, 1) : 0) * _num(V.reputationMult, 0.9) * _num(cu.reputation, 1);
        const prestige = Math.min(_num(V.prestigeCap, 0.8), _num(player.house && player.house.prestige) / _num(V.prestigeDiv, 300)) * _num(pj.rank);
        const bribe = Math.min(_num(V.bribeCap, 2.2), _num(trial.bribe) / _num(V.bribeScale, 100) * _num(pj.venality) * _num(cu.bribe, 1) * 2);
        const karma = _num(player.karma) / _num(V.karmaDiv, 100) * _num(pj.mercy);
        const defence = adv + rep + prestige + bribe + karma + (trial.surrendered ? _num(V.surrendered, 0.45) : 0);
        z -= defence;
        if (trial.bribeRefused) z += 0.3;
        if (opts.absent) z += _num(V.absent, 0.6);
        if (trial.plea === 'guilty') z = Math.max(z, _num(V.pleaGuilty, 3));
        return { p: _logit(z), z, evidence, defence };
    },

    /** Words for the odds, as an advocate would put them. */
    oddsWord(p) {
        return p >= 0.8 ? 'all but certain to be convicted' : p >= 0.6 ? 'likely to be convicted' : p >= 0.4 ? 'a close thing' : p >= 0.2 ? 'likely to walk free' : 'all but certain to walk free';
    },

    plead(player, world, plea) {
        const trial = Trials.state(player).trial;
        if (!trial) return { success: false, reason: 'You are not on trial.' };
        trial.plea = plea === 'guilty' ? 'guilty' : null;
        return { success: true, text: trial.plea ? 'You will plead guilty: the court is kinder to an honest sinner.' : 'You will plead not guilty, and let them prove it.' };
    },

    /** Work on a witness: 'persuade' | 'pay' | 'threaten' (each witness once). */
    sway(player, world, idx, how) {
        const trial = Trials.state(player).trial;
        const w = trial && trial.witnesses && trial.witnesses[idx];
        if (!w) return { success: false, reason: 'No such witness.' };
        if (w.tried) return { success: false, reason: `You have already been at ${w.name}.` };
        const W = Trials._c('witnesses');
        const skills = player.skills || {};
        const day = _day(world);
        const kid = trial.kingdomId;
        const f = w.pid != null ? Trials._person(world, trial, w.pid) : null;
        const charge = (label, proof) => trial.charges.push({ id: `${how}${day}${idx}`, ids: [], group: label, label, proof, who: [w.name], grave: false });
        if (how === 'pay') {
            const cost = Utils.cents(_byType((W.pay || {}).cost, trial.type));
            if (_num(player.gold) < cost) return { success: false, reason: `${w.name} would want ${Utils.formatGold(cost)} gold.` };
            w.tried = true;
            const P = W.pay || {};
            const chance = _clamp(_num(P.base, 0.55) + (w.honest ? _num(P.honest, -0.3) : 0) + (w.poor ? _num(P.poor, 0.15) : 0), 0.05, 0.95);
            if (Utils.random() < chance) {
                PlayerCoin.pay(world, player, cost, Trials._payeeFor(world, trial, w.pid), 'bribes');
                w.state = 'swayed';
                return { success: true, text: `${w.name} takes ${Utils.formatGold(cost)} gold and remembers nothing clearly.` };
            }
            if (Utils.random() < _num(P.reported, 0.5)) {
                charge('suborning a witness', 3);
                return { success: true, text: `${w.name} goes straight to the clerk: a new charge of suborning a witness.` };
            }
            return { success: true, text: `${w.name} will not take your coin.` };
        }
        if (how === 'threaten') {
            w.tried = true;
            const T = W.threaten || {};
            const chance = _clamp(_num(T.base, 0.45) + _num(player.strength) * _num(T.strength, 0.03) + _num(skills.combat) * _num(T.combat, 0.03), 0.05, 0.95);
            const ok = Utils.random() < chance;
            // (a threat is a crime whether it works or not)
            if (f) NpcMemory.remember(world, { folk: f.folk, person: f.p }, { kind: 'threatened', player });
            if (kid != null) Underworld.addHeat(player, kid, _num(T.heat, 4), world);
            const reported = Utils.random() < _num(T.reported, 0.35);
            if (reported) charge('threatening a witness', 2);
            if (ok) w.state = 'cowed';
            return { success: true, text: `${ok ? `${w.name} goes pale and will not testify.` : `${w.name} is not cowed.`}${reported ? ' Word of the threat reaches the court: a new charge.' : ''}` };
        }
        // Persuade
        w.tried = true;
        const Pp = W.persuade || {};
        const chance = _clamp(_num(Pp.base, 0.25) + _num(player.charisma) * _num(Pp.charisma, 0.03) + _num(skills.diplomacy) * _num(Pp.diplomacy, 0.04) + (w.honest ? _num(Pp.honest, -0.15) : 0), 0.03, 0.9);
        if (Utils.random() < chance) {
            w.state = 'swayed';
            return { success: true, text: `${w.name} is no longer so sure of what they saw.` };
        }
        return { success: true, text: `${w.name} hears you out, and is not moved.` };
    },

    /** Give yourself up in the town where you stand: arrested, and tried with the court's goodwill. */
    surrenderCheck(player, world) {
        if (!player || player.jailState) return { ok: false, reason: 'You are already in the cells.' };
        if (Trials.state(player).trial) return { ok: false, reason: 'You already await a trial.' };
        const t = _tile(world, player.q, player.r);
        const s = t && t.settlement;
        if (!s) return { ok: false, reason: 'There is no court out here.' };
        if (!WatchQuestioning.hasWatch(world, s)) return { ok: false, reason: `${s.name} keeps no watch or court.` };
        const key = `${t.q != null ? t.q : player.q},${t.r != null ? t.r : player.r}`;
        const charges = Trials._charges(player, world, s, key, s.kingdom != null ? s.kingdom : null);
        if (!charges.length) return { ok: false, reason: `${s.name} holds nothing against you.` };
        return { ok: true, town: s, charges: charges.length };
    },

    surrender(player, world) {
        const chk = Trials.surrenderCheck(player, world);
        if (!chk.ok) return { success: false, reason: chk.reason };
        Underworld._arrest(player, world, chk.town, 'giving yourself up');
        const trial = Trials.openTrial(player, world, { surrendered: true });
        if (!trial) return { success: false, reason: 'The court will not hear you.' };
        Trials._log(player, world, `Gave yourself up to the court of ${trial.town}.`);
        return { success: true, trial, text: `You give yourself up to the watch of ${trial.town}. ${trial.judge.name} will hear your case in ${trial.day - trial.opened} days; the court notes that you came of your own will.` };
    },

    _sentenceDays(trial, graveCs, lesserCs, sev, plea, lawJail) {
        const S = Trials._c('sentence');
        const D = (WatchQuestioning.config().days) || {};
        let days = 0;
        for (const c of graveCs) days += _num(D[c.group], 12) * _num(S.graveDays, 2.5);
        for (const c of lesserCs) days += _num(D[c.group], _num(D.default, 1)) * _num(S.lesserDays, 2);
        days = days * lawJail * (1 + sev) * plea;
        return Math.round(_clamp(days, _num(S.minDays, 3), _num(S.maxDays, 90)));
    },

    _fineFor(world, trial, cs, sev, plea) {
        const S = Trials._c('sentence');
        const F = (WatchQuestioning.config().fines) || {};
        const law = trial.kingdomId != null ? Laws.punishment(world, trial.kingdomId).fine : 1;
        const sum = cs.reduce((n, c) => n + _num(F[c.group], 15), 0);
        return Utils.cents(Math.max(_num(S.minFine, 10), sum * law * _num(S.fineMult, 1.2) * (1 + sev * 0.5) * plea));
    },

    /**
     * The trial's day: the verdict and its sentence. → { outcome, text, fine?, days?, convicted }
     * outcome: 'acquitted' | 'fined' | 'jailed' | 'branded' | 'exiled'
     */
    resolveTrial(player, world) {
        const st = Trials.state(player);
        const trial = st.trial;
        if (!trial) return null;
        const S = Trials._c('sentence');
        const day = _day(world);
        const kid = trial.kingdomId;
        const k = _kingdom(world, kid);
        const present = Trials.present(player, trial);
        const o = Trials.odds(player, world, trial, { absent: !present });
        const rng = Trials._rng(world, `trial|${trial.id}|${trial.opened}`);
        const cu = Trials.customDef(trial.custom);
        const noise = (rng() * 2 - 1) * (_num(cu.noise) + _num(Trials._c('verdict').noise));
        const convicted = trial.plea === 'guilty' || rng() < _clamp(o.p + noise, 0.02, 0.98);
        const pj = Trials.persona(trial.judge && trial.judge.persona);
        const sev = _num(pj.severity);
        const plea = trial.plea === 'guilty' ? _num(S.pleaMult, 0.7) : 1;
        const standing = trial.charges.filter((c, i) => Trials._witnessFactor(trial, i) > 0.5 || !(trial.witnesses || []).some(w => w.charges.includes(i)));
        const graveCs = standing.filter(c => c.grave);
        const lesserCs = (standing.length ? standing : trial.charges).filter(c => !c.grave);
        const vars = { judge: trial.judge.name, town: trial.town, realm: (k && k.name) || trial.town, man: player.gender === 'female' ? 'woman' : 'man' };
        const key = `${trial.id}|${day}`;
        const jail = player.jailState && player.jailState.trialId === trial.id ? player.jailState : null;
        const served = Math.max(0, day - trial.opened);
        let res;

        // The charges are answered, one way or the other
        for (const c of trial.charges) for (const id of c.ids || []) st.tried.push(`${trial.key}|${id}`);
        if (st.tried.length > 200) st.tried.splice(0, st.tried.length - 200);
        WatchQuestioning._answered(player, { key: trial.key, kingdom: kid, charges: trial.charges.filter(c => (c.ids || []).length) }, true);

        const release = (how) => { if (jail) Prison.release(player, world, how); };
        const rep = (n) => { if (kid != null) { if (!player.reputation) player.reputation = {}; player.reputation[kid] = _num(player.reputation[kid]) + n; } };

        if (!convicted) {
            release('acquitted');
            rep(_num(S.acquitReputation, 4));
            res = { outcome: 'acquitted', convicted: false, text: Trials.line('acquitted', key, vars) };
        } else {
            rep(_num(S.convictReputation, -4));
            // Served: the realm's sheet for these crimes is answered
            if (present && kid != null && trial.charges.some(c => c.warrant || c.grave || c.proof >= 2)) {
                Wanted.clearRealm(player, kid, { lesserOnly: !graveCs.length });
                Gossip.settleWithKingdom(player, kid);
            }
            const subject = Laws.isSubject(player, kid);
            let kind;
            if (graveCs.length) {
                const r3 = rng();
                if (kid != null && (trial.offenseNumber >= _num(S.exileOffenses, 3) || (!subject && r3 < _num(S.exileStranger, 0.35)))) kind = 'exiled';
                else if (rng() < _num(S.brandChance, 0.15) + Math.max(0, sev) * _num(S.brandSeverity, 0.5)) kind = 'branded';
                else kind = 'jailed';
            } else kind = trial.offenseNumber >= _num(S.repeatCells, 3) ? 'jailed' : 'fined';
            const law = kid != null ? Laws.punishment(world, kid) : { fine: 1, jail: 1 };
            const days = Trials._sentenceDays(trial, graveCs, graveCs.length ? [] : lesserCs, Math.max(-0.5, sev), plea, law.jail);
            if (kind === 'fined') {
                const fine = Trials._fineFor(world, trial, lesserCs.length ? lesserCs : trial.charges, sev, plea);
                const payee = trial.judge.lord && k && 'treasury' in k ? k : (Trials._court(world, trial) || { q: trial.q, r: trial.r });
                const payeeName = trial.judge.lord && k ? `the crown of ${k.name}` : `the court of ${trial.town}`;
                if (present) {
                    const paid = Math.min(fine, Utils.centsDown(Math.max(0, _num(player.gold))));
                    if (paid > 0) PlayerCoin.pay(world, player, paid, payee, 'fines');
                    const short = Utils.cents(fine - paid);
                    if (short > 0) {
                        const d = Math.round(_clamp(Math.ceil(short / _num(S.absentGoldPerDay, 6)), 2, _num(S.maxDays, 90)));
                        if (jail) { jail.daysRemaining = d; jail.totalDays = d; jail.tried = true; jail.bailCost = 0; jail.offense = 'a fine unpaid'; }
                        res = { outcome: 'jailed', convicted: true, fine, paid, days: d, text: `${_fill(Trials.line('fined', key, { ...vars, fine: Utils.formatGold(fine), payee: payeeName }))} You cannot pay it all: ${d} days in the cells for the rest.` };
                    } else {
                        release('fined');
                        res = { outcome: 'fined', convicted: true, fine, paid, text: Trials.line('fined', key, { ...vars, fine: Utils.formatGold(fine), payee: payeeName }) };
                    }
                } else {
                    if (kid != null) Wanted.charge(player, world, { kingdomId: kid, label: 'a fine unpaid to the court', gold: fine });
                    else WatchQuestioning.shift(player, trial.key, day, 20);
                    res = { outcome: 'fined', convicted: true, fine, paid: 0, absent: true, text: `Tried in your absence: fined ${Utils.formatGold(fine)} gold, unpaid. ${kid != null ? 'The crown adds it to your sheet.' : 'The town will remember.'}` };
                }
            } else if (kind === 'jailed') {
                if (present && jail) {
                    jail.daysRemaining = Math.max(1, days - served);
                    jail.totalDays = days;
                    jail.tried = true;
                    jail.bailCost = 0;
                    jail.offense = (graveCs[0] || lesserCs[0] || trial.charges[0] || {}).label || jail.offense;
                    res = { outcome: 'jailed', convicted: true, days, text: `${Trials.line('jailed', key, { ...vars, days })}${served ? ` (${served} days already held count against it.)` : ''}` };
                } else {
                    if (kid != null) Wanted.charge(player, world, { kingdomId: kid, label: 'fled the court', gold: days * _num(S.absentGoldPerDay, 6), grave: graveCs.length > 0 });
                    res = { outcome: 'jailed', convicted: true, days, absent: true, text: `Tried in your absence and sentenced to ${days} days. ${kid != null ? 'Your name goes on the crown\'s sheet.' : ''}`.trim() };
                }
            } else if (kind === 'branded') {
                const B = S.brand || {};
                if (present) {
                    release('branded');
                    rep(_num(B.reputation, -15));
                    player.renown = Math.max(0, _num(player.renown) + _num(B.renown, -5));
                    if (player.house) { const loss = Math.min(_num(player.house.prestige), _num(B.prestige, 10)); if (loss > 0) House.spend(player.house, loss, 'branded by a court', day); }
                    WatchQuestioning.shift(player, trial.key, day, _num(B.suspicion, 20));
                    st.brands.push({ kingdomId: kid, realm: vars.realm, day, crime: (graveCs[0] || {}).label || 'a grave crime', gen: player.house ? _num(player.house.generation, 1) : null });
                    if (st.brands.length > 10) st.brands.shift();
                    res = { outcome: 'branded', convicted: true, text: Trials.line('branded', key, vars) };
                } else {
                    if (kid != null) Wanted.charge(player, world, { kingdomId: kid, label: 'fled the court', gold: days * _num(S.absentGoldPerDay, 6), grave: true });
                    res = { outcome: 'branded', convicted: true, absent: true, text: 'Tried in your absence and condemned to the brand. The crown will want you for it.' };
                }
            } else {
                // Exiled
                release('exiled');
                const yearsDays = _num(S.exileDays, 480);
                st.exiles = (st.exiles || []).filter(e => String(e.kingdomId) !== String(kid));
                st.exiles.push({ kingdomId: kid, realm: vars.realm, day, until: day + yearsDays, grace: day + _num(S.exileGraceDays, 4) });
                const years = Math.max(1, Math.round(yearsDays / 120));
                res = { outcome: 'exiled', convicted: true, text: Trials.line('exiled', key, { ...vars, years, grace: _num(S.exileGraceDays, 4) }) };
            }
        }
        st.last = { day, town: trial.town, judge: trial.judge.name, outcome: res.outcome, text: res.text };
        st.trial = null;
        if (player.jailState && player.jailState.trialId === trial.id && res.outcome !== 'jailed') player.jailState.tried = true;
        Trials._log(player, world, `Tried at ${trial.town} before ${trial.judge.name}: ${res.outcome}.`);
        if (player.house) House._chronicle(player.house, world, `${player.name || 'The head of the House'} stood trial at ${trial.town}: ${res.outcome}.`, ['trial', res.outcome]);
        return res;
    },

    // ══════════════════════════════════════════════
    // THE PLAYER AS JUDGE
    // ══════════════════════════════════════════════

    seats(player, world) {
        const seen = new Set();
        const out = [];
        for (const c of Petitions.holdingContexts(player, world)) {
            if (!c.settlement || c.q == null) continue;
            const key = `${c.q},${c.r}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ q: c.q, r: c.r, settlement: c.settlement, kingdomId: c.kingdomId != null ? c.kingdomId : c.settlement.kingdom, key });
        }
        return out;
    },

    _crimeDef(k) {
        const C = Trials._c('judge').crimes || {};
        return C[k] || { label: String(k || 'a wrong').replace(/([A-Z])/g, ' $1').toLowerCase(), severity: 2, fine: 15 };
    },

    _makeCase(player, world, seat, rng) {
        const J = Trials._c('judge');
        const st = Trials.state(player);
        const s = seat.settlement;
        const folk = Trials._folkOf(s);
        if (!folk) return null;
        const day = _day(world);
        const busy = new Set(st.cases.map(c => c.accused.pid));
        const heard = new Set(st.heard);
        const ok = p => p && Townsfolk.isHere(p) && !busy.has(p.id) && !(_num(p.jailedUntil) > day);
        let c = null;
        // A crime on the town's record
        const rec = (s.npcCrimes || []).slice().reverse().find(e => e && e.byPid != null && day - _num(e.d) <= _num(J.recordDays, 40)
            && !heard.has(`${seat.key}#${e.id}`) && ok(Townsfolk.get(folk, e.byPid)));
        if (rec) {
            const G = J.guilt || {};
            const seen = (rec.seenBy || []).length;
            const proof = rec.caught ? 3 : seen ? 2 : 1;
            const pGuilt = rec.caught ? _num(G.caught, 0.92) : seen >= 2 ? _num(G.seen2, 0.8) : seen ? _num(G.seen1, 0.68) : _num(G.unseen, 0.5);
            const vm = /^pid(\d+)$/.exec(String(rec.vuid || ''));
            const acc = Townsfolk.get(folk, rec.byPid);
            st.heard.push(`${seat.key}#${rec.id}`);
            if (st.heard.length > 120) st.heard.splice(0, st.heard.length - 120);
            c = { crime: rec.k, accused: { name: _pname(acc), pid: acc.id }, victim: { name: rec.vuid === 'player' ? 'you' : rec.victim, pid: vm ? Number(vm[1]) : null }, proof, guilty: rng() < pGuilt, source: 'record', witnesses: (rec.seenBy || []).slice(0, 3) };
        } else if (rng() < _num(J.generatedShare, 0.6)) {
            const live = Townsfolk.residents(folk).filter(p => Townsfolk.age(p, day) >= _num(J.minAge, 16));
            const pool = live.filter(p => ok(p) && p.role !== 'noble');
            if (pool.length < 1 || live.length < 2) return null;
            const acc = pool[Math.floor(rng() * pool.length) % pool.length];
            const others = live.filter(p => p.id !== acc.id);
            const vic = others[Math.floor(rng() * others.length) % others.length];
            const crimes = Object.entries(J.crimes || {}).filter(([, d]) => _num(d.weight) > 0);
            if (!crimes.length) return null;
            const total = crimes.reduce((a, [, d]) => a + _num(d.weight), 0);
            let u = rng() * total;
            let crime = crimes[0][0];
            for (const [id, d] of crimes) { u -= _num(d.weight); if (u < 0) { crime = id; break; } }
            const proof = 1 + Math.floor(rng() * 3);
            c = { crime, accused: { name: _pname(acc), pid: acc.id }, victim: { name: _pname(vic), pid: vic.id }, proof, guilty: rng() < _num((J.guiltByProof || {})[String(proof)], 0.65), source: 'complaint', witnesses: [] };
        }
        if (!c) return null;
        const def = Trials._crimeDef(c.crime);
        const out = {
            id: st.next++, q: seat.q, r: seat.r, key: seat.key, town: s.name || 'the town', kingdomId: seat.kingdomId != null ? seat.kingdomId : null,
            opened: day, expires: day + _num(J.expireDays, 12), crimeLabel: def.label, severity: _num(def.severity, 2), ...c,
        };
        st.cases.push(out);
        return out;
    },

    proofText(c) {
        return (Trials._c('judge').proofText || {})[String(c.proof)] || '';
    },

    verdicts() {
        return Object.entries(Trials._c('judge').verdicts || {}).map(([id, v]) => ({ id, ...v }));
    },

    /** What a verdict would do to the town (before the hidden truth): the effects object. */
    verdictEffects(c, verdictId) {
        const J = Trials._c('judge');
        const E = J.effects || {};
        const v = (J.verdicts || {})[verdictId];
        const fx = {};
        if (!v) return fx;
        if (verdictId === 'acquit') return _addFx(fx, c.proof >= 3 ? E.acquitShown : E.acquitDoubt);
        const diff = _num(v.harsh) - _num(c.severity, 2);
        if (diff === 0) _addFx(fx, E.proportionate);
        else if (diff > 0) _addFx(fx, E.harshPer, diff);
        else _addFx(fx, E.lenientPer, -diff);
        return fx;
    },

    /** The player rules on a case before their court. */
    rule(player, world, caseId, verdictId) {
        const st = Trials.state(player);
        const J = Trials._c('judge');
        const c = st.cases.find(x => x.id === caseId);
        const v = (J.verdicts || {})[verdictId];
        if (!c || !v) return { success: false, reason: 'There is no such case before you.' };
        const day = _day(world);
        st.cases = st.cases.filter(x => x !== c);
        const f = Trials._person(world, c, c.accused.pid);
        if (!f) {
            Trials._log(player, world, `${c.accused.name} fled ${c.town} before your judgement.`, 'judge');
            return { success: true, text: `${c.accused.name} is gone from ${c.town}: the case falls.` };
        }
        const { folk, p, s } = f;
        const ctx = { q: c.q, r: c.r, kingdomId: c.kingdomId, name: c.accused.name };
        const fx = Trials.verdictEffects(c, verdictId);
        const victim = c.victim && c.victim.pid != null ? Trials._person(world, c, c.victim.pid) : null;
        let text;
        let surface = null;
        if (verdictId === 'acquit') {
            NpcMemory.remember(world, { folk, person: p }, { kind: 'spared_court', player, kin: true });
            if (victim && c.proof >= 2) NpcMemory.remember(world, { folk: victim.folk, person: victim.p }, { kind: 'denied_justice', player });
            if (c.guilty && Utils.random() < _num(J.freedGuiltySurface, 0.3)) surface = 'freed';
            text = `You acquit ${c.accused.name} of ${c.crimeLabel}.`;
        } else {
            const def = Trials._crimeDef(c.crime);
            if (verdictId === 'fine') {
                Townsfolk.purse(folk, p, world);
                const want = Utils.cents(_num(def.fine, 15));
                const got = PlayerCoin.receive(world, player, want, { purse: p, key: 'purse' }, 'courtFines', { strict: true });
                text = `You fine ${c.accused.name} ${Utils.formatGold(want)} gold for ${c.crimeLabel}${got < want ? `; they could pay only ${Utils.formatGold(got)}` : ''}.`;
            } else if (verdictId === 'stocks') {
                Townsfolk.note(p, day, 'jailed', null, 'a day in the stocks');
                text = `${c.accused.name} spends a day in the stocks of ${c.town} for ${c.crimeLabel}.`;
            } else if (verdictId === 'jail') {
                p.jailedUntil = day + _num(v.days, 20);
                Townsfolk.note(p, day, 'jailed', null, c.crimeLabel);
                text = `${c.accused.name} goes to the cells for ${_num(v.days, 20)} days for ${c.crimeLabel}.`;
            } else if (verdictId === 'exile') {
                Townsfolk.exile(folk, p, day, 'exile', world);
                text = `You banish ${c.accused.name} from ${c.town} for ${c.crimeLabel}.`;
            } else if (verdictId === 'hang') {
                NpcMemory.rememberKin(world, { folk, person: p }, { kind: 'hanged', player });
                NpcMemory.rememberTown(world, s, { kind: 'hanged', player, victim: c.accused.name });
                Townsfolk.slay(folk, p, day, 'the gallows', world);
                text = `${c.accused.name} hangs in the square of ${c.town} for ${c.crimeLabel}.`;
            }
            if (verdictId !== 'hang') NpcMemory.remember(world, { folk, person: p }, { kind: 'condemned', player, kin: true });
            if (victim && Townsfolk.isHere(victim.p)) NpcMemory.remember(world, { folk: victim.folk, person: victim.p }, { kind: 'justice_done', player });
            if (!c.guilty && Utils.random() < _num(J.surfaceChance, 0.55)) surface = 'wrongful';
            const diff = _num(v.harsh) - _num(c.severity, 2);
            if (diff >= 2 && verdictId !== 'hang') NpcMemory.rememberTown(world, s, { kind: 'ruled_harsh', player, victim: c.accused.name });
        }
        if (verdictId === 'acquit' && c.proof <= 1) NpcMemory.rememberTown(world, s, { kind: 'ruled_merciful', player, victim: c.accused.name });
        Petitions.applyEffects(player, world, ctx, fx);
        const [lo, hi] = Array.isArray(J.surfaceDays) ? J.surfaceDays : [30, 300];
        st.judged.push({
            id: c.id, q: c.q, r: c.r, key: c.key, town: c.town, kingdomId: c.kingdomId, name: c.accused.name, pid: c.accused.pid, crime: c.crimeLabel,
            verdict: verdictId, guilty: c.guilty, day, surface: surface ? day + Utils.randInt(lo, hi) : null, kind: surface, surfaced: false, amends: false,
        });
        if (st.judged.length > 40) st.judged.splice(0, st.judged.length - 40);
        Trials._log(player, world, text, 'judge');
        return { success: true, text, effects: fx };
    },

    _surface(player, world, j, out) {
        const E = Trials._c('judge').effects || {};
        j.surfaced = true;
        const ctx = { q: j.q, r: j.r, kingdomId: j.kingdomId, name: j.name };
        const f = Trials._person(world, j, j.pid);
        const s = Trials._court(world, j);
        if (j.kind === 'wrongful') {
            const hanged = j.verdict === 'hang';
            Petitions.applyEffects(player, world, ctx, hanged ? E.wrongfulHanged : E.wrongful);
            const folk = Trials._folkOf(s);
            const dead = folk && j.pid != null ? Townsfolk.get(folk, j.pid) : null;
            if (f) NpcMemory.remember(world, { folk: f.folk, person: f.p }, { kind: 'wrongly_condemned', player, kin: true });
            else if (dead) NpcMemory.rememberKin(world, { folk, person: dead }, { kind: 'wrongly_condemned', player });
            if (s) NpcMemory.rememberTown(world, s, { kind: 'ruled_unjust', player, victim: j.name });
            j.amends = true;
            const text = `The truth comes out in ${j.town}: ${j.name} was innocent of ${j.crime}. ${hanged ? 'They hanged for another\'s crime.' : 'You condemned the wrong one.'}`;
            out.notices.push({ icon: '⚖️', title: 'A Wrongful Verdict', text, type: 'error' });
            Trials._log(player, world, text, 'judge');
        } else {
            Petitions.applyEffects(player, world, ctx, E.freedGuilty);
            const text = `${j.name}, whom you acquitted in ${j.town}, was guilty after all: the town knows it now.`;
            out.notices.push({ icon: '⚖️', title: 'The Guilty Went Free', text, type: 'warning' });
            Trials._log(player, world, text, 'judge');
        }
    },

    /** Make amends for a wrongful verdict: coin to the wronged (or their family), the town's goodwill back. */
    amends(player, world, judgedId) {
        const st = Trials.state(player);
        const J = Trials._c('judge');
        const j = st.judged.find(x => x.id === judgedId);
        if (!j || !j.amends) return { success: false, reason: 'There is nothing to make amends for.' };
        const cost = Utils.cents(_num(J.amendsCost, 60));
        if (_num(player.gold) < cost) return { success: false, reason: `Amends would take ${Utils.formatGold(cost)} gold.` };
        const s = Trials._court(world, j);
        const folk = Trials._folkOf(s);
        const p = folk && j.pid != null ? Townsfolk.get(folk, j.pid) : null;
        let to = s || null;
        if (p && Townsfolk.isHere(p)) { Townsfolk.purse(folk, p, world); to = { purse: p, key: 'purse' }; } else if (folk && p) {
            const kin = [p.spouse, ...(p.kids || []), ...(p.parents || [])].map(id => Townsfolk.get(folk, id)).find(o => o && Townsfolk.isHere(o));
            if (kin) { Townsfolk.purse(folk, kin, world); to = { purse: kin, key: 'purse' }; }
        }
        PlayerCoin.pay(world, player, cost, to, 'charity');
        if (p) {
            if (Townsfolk.isHere(p)) NpcMemory.remember(world, { folk, person: p }, { kind: 'amends', player, kin: true });
            else NpcMemory.rememberKin(world, { folk, person: p }, { kind: 'amends', player });
        }
        Petitions.applyEffects(player, world, { q: j.q, r: j.r, kingdomId: j.kingdomId, name: j.name }, (J.effects || {}).amends);
        j.amends = false;
        const text = `You make amends for ${j.name}: ${Utils.formatGold(cost)} gold to the family, and your word before ${j.town}.`;
        Trials._log(player, world, text, 'judge');
        return { success: true, text };
    },

    // ══════════════════════════════════════════════
    // LAWSUITS BETWEEN HOUSES
    // ══════════════════════════════════════════════

    suitDef(kind) {
        return { name: kind, icon: '📜', merit: 0.5, prestige: 5, feud: 5, ...((Trials._c('suits').kinds || {})[kind] || {}) };
    },

    /** The grounds each side holds: { player: [{ kind, merit, amount?, estateId?, note }], rival: [...] } (systems/rivalHouses.js lawGrounds). */
    grounds(player, world, rival) {
        return RivalHouses.lawGrounds(player, world, rival);
    },

    /** The court a suit is heard at: a realm's capital (the given realm, else the player's own). */
    _venue(world, kingdomIds) {
        for (const id of kingdomIds) {
            const k = _kingdom(world, id);
            if (!k || k.isAlive === false || !k.capital) continue;
            const t = _tile(world, k.capital.q, k.capital.r);
            if (!t || !t.settlement) continue;
            return { q: k.capital.q, r: k.capital.r, town: t.settlement.name || k.name, type: t.settlement.type || 'capital', kingdomId: k.id, judge: Trials.judgeFor(world, t.settlement, k.capital.q, k.capital.r) };
        }
        return null;
    },

    openSuits(player) {
        return Trials.state(player).suits.filter(s => s.status === 'open');
    },

    _newSuit(player, world, rival, ground, plaintiff, venue, rng) {
        const st = Trials.state(player);
        const S = Trials._c('suits');
        const [lo, hi] = Array.isArray(S.hearingDays) ? S.hearingDays : [6, 12];
        const day = _day(world);
        const suit = {
            id: st.next++, kind: ground.kind, plaintiff, rivalId: rival.kingdomId, rivalName: rival.name, head: rival.head ? RivalHouses.headName(rival) : rival.name,
            filed: day, hearing: day + lo + Math.floor(rng() * (hi - lo + 1)), status: 'open', merit: ground.merit, amount: _num(ground.amount), estateId: ground.estateId || null, note: ground.note,
            ...venue, advocate: null, bribe: 0, bribeRefused: false, bribeDay: null, rivalAdvocate: 0, rivalBribe: 0,
        };
        // The rival hires its own advocate out of its purse (into the court town's)
        const R = S.rival || {};
        const spend = Utils.cents(Math.min(_num(R.advocateMax, 120), Math.max(0, _num(rival.gold)) * _num(R.advocateShare, 0.05)));
        if (spend > 0) {
            PlayerCoin.move(world, { purse: rival, key: 'gold' }, Trials._court(world, suit) || { q: suit.q, r: suit.r }, spend);
            suit.rivalAdvocate = Math.min(9, 2 + Math.round(spend / 20));
        }
        st.suits.push(suit);
        st.suitDay[String(rival.kingdomId)] = day;
        return suit;
    },

    fileSuit(player, world, rivalId, kind) {
        const S = Trials._c('suits');
        const rival = RivalHouses.rival(player, rivalId);
        if (!rival) return { success: false, reason: 'No such House.' };
        const ground = Trials.grounds(player, world, rival).player.find(g => g.kind === kind);
        if (!ground) return { success: false, reason: 'You have no grounds for that suit.' };
        const open = Trials.openSuits(player);
        if (open.length >= _num(S.maxOpen, 3)) return { success: false, reason: 'Your House already has as many suits before the courts as its clerks can follow.' };
        if (open.some(s => String(s.rivalId) === String(rivalId) && s.kind === kind)) return { success: false, reason: 'That suit is already before the court.' };
        const venue = Trials._venue(world, [rival.kingdomId, player.allegiance]);
        if (!venue) return { success: false, reason: 'No court will hear it: their realm has fallen.' };
        const fee = Utils.cents(_num(S.fee, 25));
        if (_num(player.gold) < fee) return { success: false, reason: `Filing the suit costs ${Utils.formatGold(fee)} gold.` };
        PlayerCoin.pay(world, player, fee, Trials._court(world, venue) || { q: venue.q, r: venue.r }, 'lawyers');
        const suit = Trials._newSuit(player, world, rival, ground, 'player', venue, () => Utils.random());
        // (a betrothal they broke is sued over once)
        if (kind === 'betrothal' && rival.brokeBetrothal) rival.brokeBetrothal.sued = _day(world);
        const D = Trials.suitDef(kind);
        Trials._log(player, world, `You sue ${rival.name} for ${D.name.toLowerCase()} before the court of ${venue.town}.`, 'suit');
        return { success: true, suit, text: `Your suit against ${rival.name} (${D.name.toLowerCase()}) is entered at ${venue.town}. The hearing is in ${suit.hearing - suit.filed} days.` };
    },

    /** End a suit early: your own withdrawn, or one against you settled for part of the claim. */
    settleSuit(player, world, suitId) {
        const st = Trials.state(player);
        const suit = st.suits.find(s => s.id === suitId && s.status === 'open');
        if (!suit) return { success: false, reason: 'No such suit.' };
        const rival = RivalHouses.rival(player, suit.rivalId);
        if (suit.plaintiff === 'player') {
            suit.status = 'withdrawn';
            Trials._log(player, world, `You withdrew your suit against ${suit.rivalName}.`, 'suit');
            return { success: true, text: `You withdraw your suit against ${suit.rivalName}. The fee is not returned.` };
        }
        const cost = Trials.settleCost(suit);
        if (_num(player.gold) < cost) return { success: false, reason: `Settling takes ${Utils.formatGold(cost)} gold.` };
        PlayerCoin.pay(world, player, cost, rival ? { purse: rival, key: 'gold' } : (Trials._court(world, suit) || null), 'lawsuits');
        suit.status = 'settled';
        Trials._log(player, world, `You settled ${suit.rivalName}'s suit for ${Utils.formatGold(cost)} gold.`, 'suit');
        return { success: true, text: `You settle out of court: ${Utils.formatGold(cost)} gold to ${suit.rivalName}, and the suit is dropped.` };
    },

    /** What settling a suit brought against you costs: part of the claim. */
    settleCost(suit) {
        const D = Trials.suitDef(suit.kind);
        const claim = suit.amount || _num(D.damages) || _num(D.costs, 40) * 3;
        return Utils.cents(claim * _num(Trials._c('suits').settleShare, 0.5));
    },

    /** The court's lean toward the plaintiff (before the noise). */
    suitOdds(player, world, suit) {
        const V = Trials._c('suits').verdict || {};
        const pj = Trials.persona(suit.judge && suit.judge.persona);
        const rival = RivalHouses.rival(player, suit.rivalId);
        const mine = suit.advocate ? suit.advocate.skill : 0;
        const pAdv = suit.plaintiff === 'player' ? mine : _num(suit.rivalAdvocate);
        const dAdv = suit.plaintiff === 'player' ? _num(suit.rivalAdvocate) : mine;
        const kid = suit.kingdomId;
        const myStanding = kid != null ? _num(player.reputation && player.reputation[kid]) : 0;
        const theirs = rival && rival.standing ? _num(rival.standing[kid]) : 0;
        const standing = (myStanding - theirs) / _num(V.standingDiv, 40) * (suit.plaintiff === 'player' ? 1 : -1);
        const bScale = _num(V.bribeScale, 150);
        const myBribe = Math.min(_num(V.bribeCap, 1.5), _num(suit.bribe) / bScale * _num(pj.venality) * 2);
        const theirBribe = Math.min(_num(V.bribeCap, 1.5), _num(suit.rivalBribe) / bScale * _num(pj.venality) * 2);
        const bribe = (myBribe - theirBribe) * (suit.plaintiff === 'player' ? 1 : -1) + (suit.bribeRefused ? (suit.plaintiff === 'player' ? -0.4 : 0.4) : 0);
        const z = (_num(suit.merit, 0.5) - 0.5) * _num(V.meritMult, 4) + (pAdv - dAdv) * _num(V.advocatePer, 0.15) * _num(pj.advocate, 1) + standing + bribe;
        return { p: _logit(z), z };
    },

    /** The hearing: the verdict, damages purse to purse, prestige and the feud. */
    resolveSuit(player, world, suit, rng) {
        const day = _day(world);
        const D = Trials.suitDef(suit.kind);
        const rival = RivalHouses.rival(player, suit.rivalId);
        const V = Trials._c('suits').verdict || {};
        const o = Trials.suitOdds(player, world, suit);
        const noise = (rng() * 2 - 1) * _num(V.noise, 0.1);
        const plaintiffWins = rng() < _clamp(o.p + noise, 0.03, 0.97);
        const playerWins = plaintiffWins === (suit.plaintiff === 'player');
        suit.status = 'decided';
        suit.won = playerWins;
        const court = Trials._court(world, suit) || { q: suit.q, r: suit.r };
        const rivalPurse = rival ? { purse: rival, key: 'gold' } : court;
        const vars = { court: suit.town, house: suit.rivalName };
        const parts = [];
        // Damages
        if (suit.kind === 'debt' && suit.plaintiff === 'player' && playerWins && rival) {
            const got = PlayerCoin.receive(world, player, suit.amount, rivalPurse, 'lawsuits', { strict: true });
            if (got >= suit.amount - 0.01) for (const l of rival.loans || []) if (l.defaulted && !l.repaid) l.repaid = day;
            parts.push(`${suit.rivalName} pays ${Utils.formatGold(got)} gold of the debt`);
        } else if (suit.kind === 'land') {
            const est = suit.estateId ? Estates.estate(world, suit.estateId) : null;
            const theirs = rival ? RivalHouses.holderId(rival) : null;
            if (plaintiffWins && est) {
                const from = suit.plaintiff === 'player' ? theirs : 'player';
                const to = suit.plaintiff === 'player' ? 'player' : theirs;
                if (to && est.holder === from) { Estates.setHolder(world, est, to); parts.push(`${est.name || 'the estate'} passes to ${playerWins ? 'your House' : suit.rivalName}`); }
            }
            const costs = Utils.cents(_num(D.costs, 40));
            if (playerWins && rival) PlayerCoin.move(world, rivalPurse, court, costs);
            else if (!playerWins) {
                const paid = Math.min(costs, Utils.centsDown(Math.max(0, _num(player.gold))));
                if (paid > 0) { PlayerCoin.pay(world, player, paid, court, 'lawyers'); parts.push(`you pay ${Utils.formatGold(paid)} gold in costs`); }
            }
        } else if (suit.amount > 0 && plaintiffWins) {
            // Damages from the defendant to the plaintiff (slander, betrothal)
            if (suit.plaintiff === 'player' && rival) {
                const got = PlayerCoin.receive(world, player, suit.amount, rivalPurse, 'lawsuits', { strict: true });
                parts.push(`${suit.rivalName} pays you ${Utils.formatGold(got)} gold in damages`);
            } else {
                const paid = Math.min(suit.amount, Utils.centsDown(Math.max(0, _num(player.gold))));
                if (paid > 0) PlayerCoin.pay(world, player, paid, rivalPurse, 'lawsuits');
                const short = Utils.cents(suit.amount - paid);
                parts.push(`you pay ${Utils.formatGold(paid)} gold in damages`);
                if (short > 0 && suit.kingdomId != null) {
                    Wanted.charge(player, world, { kingdomId: suit.kingdomId, label: 'contempt of court (damages unpaid)', gold: short });
                    parts.push(`the ${Utils.formatGold(short)} gold you could not pay goes on the crown's sheet`);
                }
            }
        } else if (!plaintiffWins) {
            // A suit thrown out: the plaintiff pays the court's costs
            const costs = Utils.cents(_num(Trials._c('suits').fee, 25));
            if (suit.plaintiff === 'player') {
                const paid = Math.min(costs, Utils.centsDown(Math.max(0, _num(player.gold))));
                if (paid > 0) { PlayerCoin.pay(world, player, paid, court, 'lawyers'); parts.push(`you pay ${Utils.formatGold(paid)} gold in costs`); }
            } else if (rival) PlayerCoin.move(world, rivalPurse, court, costs);
        }
        // Prestige and the feud
        const pr = _num(D.prestige, 5);
        if (player.house) {
            if (playerWins) House.award(player.house, pr, `a lawsuit won against ${suit.rivalName}`, day);
            else { const loss = Math.min(_num(player.house.prestige), pr); if (loss > 0) House.spend(player.house, loss, `a lawsuit lost to ${suit.rivalName}`, day); }
        }
        if (rival) {
            rival.renown = Math.max(0, _num(rival.renown) + (playerWins ? -pr / 2 : pr / 2));
            if (!Array.isArray(rival.memory)) rival.memory = [];
            rival.memory.push({ kind: playerWins ? 'lawsuitLost' : 'lawsuitWon', day, w: playerWins ? -_num(D.feud, 5) : 2, note: D.name.toLowerCase() });
            if (rival.memory.length > 14) rival.memory.splice(0, rival.memory.length - 14);
            RivalHouses._note(rival, world, playerWins ? `Lost a lawsuit to you at ${suit.town} (${D.name.toLowerCase()}).` : `Won a lawsuit against you at ${suit.town} (${D.name.toLowerCase()}).`, playerWins ? 'shamed' : 'triumph');
            House.accrueRivalFeud(player, world, suit.rivalId, playerWins ? _num(D.feud, 5) : -Math.round(_num(D.feud, 5) / 2), 'a lawsuit');
        }
        const linesS = (Trials._c('suits').lines || {})[playerWins ? 'won' : 'lost'] || [];
        const lead = _fill(linesS[suit.id % Math.max(1, linesS.length)] || '', vars);
        const text = `${lead}${parts.length ? ` ${parts.join('; ')}.` : ''} ${playerWins ? '+' : '−'}${pr} Prestige.`.trim();
        suit.text = text;
        Trials._log(player, world, text, 'suit');
        if (player.house) House._chronicle(player.house, world, `The suit with ${suit.rivalName} over ${D.name.toLowerCase()} is decided at ${suit.town}: ${playerWins ? 'won' : 'lost'}.`, ['rival', 'lawsuit']);
        return { won: playerWins, text };
    },

    /**
     * A rival head who rode to court and filed (systems/rivalHouses.js, the
     * 'law' errand: rival.suing, the fee already paid into the court town's
     * purse): the suit is entered, and the player summoned.
     */
    _rivalSues(player, world, rng, out) {
        const S = Trials._c('suits');
        const R = S.rival || {};
        for (const rival of RivalHouses.rivals(player)) {
            const filing = rival && rival.suing;
            if (!filing) continue;
            delete rival.suing;
            if (!rival.head || rival.kingdomId == null) continue;
            const open = Trials.openSuits(player);
            if (open.length >= _num(S.maxOpen, 3) || open.some(s => String(s.rivalId) === String(rival.kingdomId))) continue;
            const g = Trials.grounds(player, world, rival).rival;
            const ground = g.find(x => x.kind === filing.kind) || g[0];
            const venue = ground ? Trials._venue(world, [filing.kingdomId, player.allegiance, rival.kingdomId]) : null;
            if (!ground || !venue) {
                RivalHouses._note(rival, world, 'Their suit against you came to nothing: the court would not hear it.');
                continue;
            }
            const suit = Trials._newSuit(player, world, rival, ground, rival.kingdomId, venue, rng);
            // A House of little honour slips the judge something
            const honour = _num(rival.head.persona && rival.head.persona.honour, 5);
            if (honour <= _num(R.bribeMaxHonour, 3)) {
                const b = Utils.cents(Math.max(0, _num(rival.gold)) * _num(R.bribeShare, 0.04));
                if (b > 0 && rng() < Trials.persona(venue.judge.persona).venality) {
                    suit.rivalBribe = PlayerCoin.move(world, { purse: rival, key: 'gold' }, Trials._judgePurse(world, suit) || { q: suit.q, r: suit.r }, b);
                }
            }
            const D = Trials.suitDef(ground.kind);
            const lines = (S.lines || {}).filedAgainst || [];
            const text = _fill(lines[suit.id % Math.max(1, lines.length)] || '{house} sues you before the court of {court}.', { house: rival.name, kind: D.name.toLowerCase(), court: venue.town, days: suit.hearing - suit.filed });
            Trials._log(player, world, text, 'suit');
            out.notices.push({ icon: '📜', title: 'A Summons', text, type: 'warning' });
        }
    },

    // ══════════════════════════════════════════════
    // THE BRAND, AND ITS PARDON
    // ══════════════════════════════════════════════

    _pardonDef(id) {
        return (Trials._c('brands').pardon || {})[id] || null;
    },

    /** The brands the player's own body bears (an earlier head's died with them), with what a pardon would take. */
    brandsView(player, world) {
        const st = Trials.state(player);
        const borne = new Set(Brands.borne(player));
        return st.brands.map((brand, idx) => ({ brand, idx })).filter(x => borne.has(x.brand)).map(({ brand, idx }) => ({
            brand, idx, weight: Brands.weight(brand, world),
            options: brand.pardoned ? [] : Trials.pardonOptions(player, world, idx),
        }));
    },

    /** The town the player stands in, if it is one of the realm's: the settlement or null. */
    _townOfRealm(player, world, kingdomId) {
        const t = player ? _tile(world, player.q, player.r) : null;
        const s = t && t.settlement;
        return s && String(s.kingdom) === String(kingdomId) ? s : null;
    },

    /** The ways to a pardon for brand `idx`: [{ id, name, icon, desc, cost, prestige, ok, reason }]. */
    pardonOptions(player, world, idx) {
        const st = Trials.state(player);
        const b = st.brands[idx];
        if (!b || b.pardoned) return [];
        const day = _day(world);
        const k = _kingdom(world, b.kingdomId);
        const rep = _num(player.reputation && player.reputation[b.kingdomId]);
        const realm = b.realm || (k && k.name) || 'the realm';
        const busy = b.petition ? `Your petition is before the crown until day ${b.petition.until}.` : b.penance ? `Your penance runs until day ${b.penance.until}.` : null;
        const fallen = !k || k.isAlive === false ? `${realm} is no more: no crown is left to pardon you.` : null;
        const war = !fallen && CourtLetters.atWar(player, world, b.kingdomId) ? `You are at war with ${realm}.` : null;
        const town = Trials._townOfRealm(player, world, b.kingdomId);
        const out = [];
        const add = (id, extra, ...reasons) => {
            const P = Trials._pardonDef(id);
            if (!P) return;
            const reason = reasons.find(Boolean) || null;
            out.push({ id, name: P.name || id, icon: P.icon || '📜', desc: P.desc || '', ...extra, ok: !reason, reason });
        };
        const Ro = Trials._pardonDef('royal');
        if (Ro) {
            const cost = Utils.cents(_num(Ro.cost, 300) + _num(Ro.perOffense, 100) * Math.max(0, Brands.active(player).length - 1));
            add('royal', { cost }, fallen, busy, war,
                rep < _num(Ro.minReputation, -20) ? `${realm} thinks too ill of you to sell you its mercy (standing ${_num(Ro.minReputation, -20)} needed).` : null,
                _num(player.gold) < cost ? `The crown asks ${Utils.formatGold(cost)} gold.` : null);
        }
        const Pp = Trials._pardonDef('prestige');
        if (Pp) {
            const cost = _num(Pp.cost, 40);
            add('prestige', { prestige: cost }, fallen, busy, war,
                !player.house ? 'You have no House whose name could plead for you.' : null,
                player.house && _num(player.house.prestige) < cost ? `It takes ${cost} Prestige.` : null,
                rep < _num(Pp.minReputation, 10) ? `${realm} must think somewhat well of you (standing ${_num(Pp.minReputation, 10)}).` : null);
        }
        const Pe = Trials._pardonDef('petition');
        if (Pe) {
            const cost = Utils.cents(_num(Pe.fee, 10));
            add('petition', { cost, days: _num(Pe.days, 30) }, fallen, busy, war,
                !town ? `Stand in a town of ${realm} to gather its folk's names.` : null,
                rep < _num(Pe.minReputation, 20) ? `Too few in ${realm} would sign for you (standing ${_num(Pe.minReputation, 20)} needed).` : null,
                b.petitionRetry != null && day < b.petitionRetry ? `The crown refused your last petition: ask again from day ${b.petitionRetry}.` : null,
                _num(player.gold) < cost ? `The clerk's fee is ${Utils.formatGold(cost)} gold.` : null);
        }
        const Pn = Trials._pardonDef('penance');
        if (Pn) {
            const cost = Utils.cents(_num(Pn.alms, 60));
            add('penance', { cost, days: _num(Pn.days, 90) }, fallen, busy,
                !town ? `Do penance in a town of ${realm}, before its people.` : null,
                _num(player.karma) < _num(Pn.minKarma, -20) ? 'No church will hear the penance of so black a soul.' : null,
                _num(player.gold) < cost ? `The alms are ${Utils.formatGold(cost)} gold.` : null);
        }
        return out;
    },

    /** Seek a pardon for brand `idx` by `how` ('royal' | 'prestige' | 'petition' | 'penance'). */
    seekPardon(player, world, idx, how) {
        const st = Trials.state(player);
        const b = st.brands[idx];
        if (!b || !Brands.borne(player).includes(b)) return { success: false, reason: 'No such brand.' };
        if (b.pardoned) return { success: false, reason: 'That brand is already pardoned.' };
        const opt = Trials.pardonOptions(player, world, idx).find(o => o.id === how);
        if (!opt) return { success: false, reason: 'No such way to a pardon.' };
        if (!opt.ok) return { success: false, reason: opt.reason };
        const day = _day(world);
        const k = _kingdom(world, b.kingdomId);
        const realm = b.realm || (k && k.name) || 'the realm';
        if (how === 'royal') {
            PlayerCoin.pay(world, player, opt.cost, k, 'fines');
            return Trials._pardon(player, world, b, 'royal', `The crown of ${realm} sells you its pardon for ${Utils.formatGold(opt.cost)} gold.`);
        }
        if (how === 'prestige') {
            House.spend(player.house, opt.prestige, `a pardon from ${realm}`, day);
            return Trials._pardon(player, world, b, 'prestige', `For the name of ${player.house.name || 'your House'}, the crown of ${realm} pardons you (−${opt.prestige} Prestige).`);
        }
        const town = Trials._townOfRealm(player, world, b.kingdomId);
        if (how === 'petition') {
            PlayerCoin.pay(world, player, opt.cost, town, 'fines');
            b.petition = { since: day, until: day + opt.days, town: town.name };
            Trials._log(player, world, `You petition the crown of ${realm} for a pardon, with the names of the folk of ${town.name}.`, 'pardon');
            return { success: true, text: `The folk of ${town.name} put their names to your petition, and the clerk sends it to the crown of ${realm}. An answer comes by day ${b.petition.until}.` };
        }
        // Penance
        PlayerCoin.pay(world, player, opt.cost, town, 'alms');
        b.penance = { since: day, until: day + opt.days, town: town.name };
        Trials._log(player, world, `You begin a public penance at ${town.name}.`, 'pardon');
        return { success: true, text: `You give ${Utils.formatGold(opt.cost)} gold in alms at ${town.name} and kneel before its church. Keep clean of the courts until day ${b.penance.until}, and ${realm} will forgive the brand.` };
    },

    _pardon(player, world, b, how, lead) {
        const day = _day(world);
        b.pardoned = { day, how };
        delete b.petition;
        delete b.penance;
        const k = _kingdom(world, b.kingdomId);
        const text = `${lead} ${Trials.line('pardoned', `${b.kingdomId}|${b.day}`, { realm: b.realm || (k && k.name) || 'the realm' })}`.trim();
        Trials._log(player, world, text, 'pardon');
        if (player.house) House._chronicle(player.house, world, `${player.name || 'The head of the House'} is pardoned the brand of ${b.realm || 'a realm'}.`, ['trial', 'pardon']);
        return { success: true, text, pardoned: true };
    },

    /** The day's answers: a petition decided (a seeded roll), a penance done or undone by a new conviction. */
    _pardonsDay(player, world, rng, out) {
        const st = Trials.state(player);
        const day = _day(world);
        for (const b of Brands.active(player)) {
            const realm = b.realm || 'the realm';
            if (b.petition && day >= _num(b.petition.until)) {
                const Pe = Trials._pardonDef('petition') || {};
                const chance = _clamp(_num(Pe.base, 0.3) + _num(player.reputation && player.reputation[b.kingdomId]) * _num(Pe.perRep, 0.01) + _num(player.karma) * _num(Pe.perKarma, 0.005), 0, _num(Pe.max, 0.85));
                if (rng() < chance) {
                    const r = Trials._pardon(player, world, b, 'petition', `Your petition is granted.`);
                    out.notices.push({ icon: '📜', title: 'Pardoned', text: r.text, type: 'success' });
                } else {
                    delete b.petition;
                    b.petitionRetry = day + _num(Pe.retryDays, 120);
                    const text = Trials.line('petitionRefused', `${b.kingdomId}|${day}`, { realm });
                    Trials._log(player, world, text, 'pardon');
                    out.notices.push({ icon: '📜', title: 'Petition Refused', text, type: 'warning' });
                }
            } else if (b.penance) {
                const last = st.last;
                if (last && last.outcome !== 'acquitted' && _num(last.day) > _num(b.penance.since)) {
                    delete b.penance;
                    const text = Trials.line('penanceBroken', `${b.kingdomId}|${day}`, { realm });
                    Trials._log(player, world, text, 'pardon');
                    out.notices.push({ icon: '🕯️', title: 'Penance Undone', text, type: 'warning' });
                } else if (day >= _num(b.penance.until)) {
                    const r = Trials._pardon(player, world, b, 'penance', `Your penance at ${b.penance.town} is done.`);
                    out.notices.push({ icon: '🕯️', title: 'Penance Done', text: r.text, type: 'success' });
                }
            }
        }
    },

    // ══════════════════════════════════════════════
    // THE DAY
    // ══════════════════════════════════════════════

    /**
     * The courts' day (before the jail's night): open a trial for a new
     * arrest, hear the trial due, enforce exiles, bring townsfolk cases to
     * the player's court, surface old verdicts, rivals' suits and hearings.
     * Its own seeded stream. → { notices }
     */
    processDay(world, player = null) {
        const out = { notices: [] };
        if (!player || !world || Trials.config().enabled === false) return out;
        const st = Trials.state(player);
        const day = _day(world);
        Utils.withRng(Trials._rng(world, `day|${day}`), () => {
            const rng = () => Utils.random();
            // A new arrest: held for trial (an older trial pending elsewhere is heard first, in absence)
            const jail = player.jailState;
            if (jail && !jail.trialId && !jail.tried && !(jail.transport && !jail.transport.done)) {
                if (st.trial) {
                    const r = Trials.resolveTrial(player, world);
                    if (r) out.notices.push({ icon: '⚖️', title: 'Tried in Absence', text: r.text, type: 'warning' });
                }
                if (_num(jail.totalDays) <= 1) jail.tried = true;
                else {
                    const t = Trials.openTrial(player, world);
                    if (t) out.notices.push({ icon: '⚖️', title: 'Held for Trial', text: Trials.line('opened', `${t.id}`, { town: t.town, judge: t.judge.name, days: t.day - t.opened }), type: 'warning' });
                    else jail.tried = true;
                }
            }
            // The trial's day
            if (st.trial && day >= st.trial.day) {
                const r = Trials.resolveTrial(player, world);
                if (r) out.notices.push({ icon: '⚖️', title: r.convicted ? 'Guilty' : 'Not Guilty', text: r.text, type: r.convicted ? 'error' : 'success' });
            }
            // An exile seen in the realm that cast them out
            st.exiles = (st.exiles || []).filter(e => _num(e.until) > day);
            if (!player.jailState && st.exiles.length) {
                const t = _tile(world, player.q, player.r);
                const s = t && t.settlement;
                const ex = s && st.exiles.find(e => String(e.kingdomId) === String(s.kingdom) && day > _num(e.grace));
                if (ex && rng() < _num(Trials._c('sentence').exileArrest, 0.25)) {
                    st.exileBroken = ex.kingdomId;
                    Underworld._arrest(player, world, s, 'breaking exile');
                    out.notices.push({ icon: '🚪', title: 'Exile Broken', text: `The watch of ${s.name} knows the banished face of you: back to the cells, and to the court.`, type: 'error' });
                }
            }
            // Townsfolk cases before the player's court
            const J = Trials._c('judge');
            const lapsed = st.cases.filter(c => day > c.expires);
            for (const c of lapsed) {
                Petitions.applyEffects(player, world, { q: c.q, r: c.r, kingdomId: c.kingdomId }, (J.effects || {}).lapse);
                Trials._log(player, world, `The case against ${c.accused.name} of ${c.town} lapsed unheard.`, 'judge');
            }
            if (lapsed.length) st.cases = st.cases.filter(c => day <= c.expires);
            const seats = Trials.seats(player, world);
            for (const seat of seats) {
                if (st.cases.length >= _num(J.maxPending, 3)) break;
                if (!(rng() < _byType(J.perDay, seat.settlement.type))) continue;
                const c = Trials._makeCase(player, world, seat, rng);
                if (c) out.notices.push({ icon: '⚖️', title: 'A Case for Your Court', text: `${c.accused.name} of ${c.town} stands accused of ${c.crimeLabel}, against ${c.victim.name}. Judge it within ${c.expires - day} days (Family → Courts & Lawsuits).`, type: 'info' });
            }
            // Old verdicts surfacing
            for (const j of st.judged) if (!j.surfaced && j.surface != null && day >= j.surface) Trials._surface(player, world, j, out);
            // Pardons sought for a brand: a petition answered, a penance done (or broken)
            Trials._pardonsDay(player, world, rng, out);
            // Lawsuits: rivals who rode to court have filed; hearings due
            Trials._rivalSues(player, world, rng, out);
            for (const suit of st.suits) {
                if (suit.status !== 'open' || day < suit.hearing) continue;
                const r = Trials.resolveSuit(player, world, suit, rng);
                out.notices.push({ icon: '📜', title: r.won ? 'A Suit Won' : 'A Suit Lost', text: r.text, type: r.won ? 'success' : 'warning' });
            }
            st.suits = st.suits.filter(s => s.status === 'open' || day - _num(s.hearing, s.filed) <= 120).slice(-20);
        });
        return out;
    },

    // ── For the panel ────────────────────────────────

    view(player, world) {
        const st = Trials.state(player);
        const trial = st.trial;
        let t = null;
        if (trial) {
            const o = Trials.odds(player, world, trial, { absent: !Trials.present(player, trial) });
            t = {
                trial, odds: o, word: Trials.oddsWord(o.p), present: Trials.present(player, trial),
                persona: Trials.persona(trial.judge.persona), custom: Trials.customDef(trial.custom),
                advocates: trial.advocate ? [] : Trials.advocates(world, trial),
                bribes: (Trials._c('bribe').steps || [1]).map((s, i) => ({ step: i, cost: Trials.bribeCost(trial, i) })),
                bribeChance: Trials.bribeChance(player, trial), witnessCost: Utils.cents(_byType((Trials._c('witnesses').pay || {}).cost, trial.type)),
                daysLeft: Math.max(0, trial.day - _day(world)),
            };
        }
        const rivals = RivalHouses.rivals(player).filter(r => r && r.kingdomId != null).map(r => ({ rival: r, grounds: Trials.grounds(player, world, r).player }));
        return {
            trial: t, last: st.last, surrender: trial ? { ok: false } : Trials.surrenderCheck(player, world),
            cases: st.cases.map(c => ({ c, effects: Object.fromEntries(Trials.verdicts().map(v => [v.id, Trials.verdictEffects(c, v.id)])) })),
            wrongs: st.judged.filter(j => j.amends), seats: Trials.seats(player, world).length,
            suits: st.suits.map(s => ({ suit: s, odds: s.status === 'open' ? Trials.suitOdds(player, world, s) : null, advocates: s.status === 'open' && !s.advocate ? Trials.advocates(world, s) : [] })),
            rivals, exiles: st.exiles || [], brands: Trials.brandsView(player, world), history: st.history.slice().reverse(),
            fee: Utils.cents(_num(Trials._c('suits').fee, 25)),
        };
    },
};
