// ============================================
// ORDEALS — trial by combat, by hot iron, water and bread, by oath-helpers
// ============================================
// The courts (player/trials.js) weigh evidence. Where a realm's law of TRIAL
// CUSTOMS (systems/laws.js 'trialCustoms': the court alone, the wager of
// battle, the church's ordeals, the old customs) and its FAITH (data
// ordeals.json faith: sacred / accepted / forbids — a forbidding clergy
// blesses no ordeal) allow it, a case may go to another judgement:
//
//   COMBAT. The accused (or a champion) fights the accuser's champion — the
//   strongest guard of the town, a real resident who can die of it, else the
//   court's champion — until one yields or falls. You fight in person in the
//   duel panel (systems/duels.js), or hire: a fighting companion of your party
//   (no fee: their life is the stake, Companions.fall) or a guard of the town
//   (the fee into his own purse). Crying craven is guilt.
//   THE HOT IRON. A real wound (systems/ailments.js burned_hand, a lasting
//   scar likely): unbound after three days; an infected burn, or one the
//   priest reads as festered, is guilt. THE WATER: sinking is innocence (half-
//   drowned: health lost). THE BREAD: choke and you are guilty. The priest can
//   be paid — never one of a sacred faith, who tells the court.
//   OATH-HELPERS. Your real ties swear with you: companions, friends, the
//   grown of your family, townsfolk who remember you well. Too few: guilty.
//   An oath against the plain proof (caught in the act) is perjury: it may be
//   found out months on, and shames every one who swore.
//
// Four courts use it: YOUR TRIAL (Trials.resolveTrial asks Ordeals.decide);
// the CASES BEFORE YOUR COURT (the accused may demand it as of right —
// refusing costs the town's regard; an ordeal's judgement heeded is believed
// by the faith's weight; Trials.rule asks Ordeals.adjustFx); A KINSMAN OF YOUR
// HOUSE ACCUSED (stand as their champion yourself); LAWSUITS between Houses
// (a rival head of might and honour demands the wager of battle; Trials.
// resolveSuit honours suit.combat). And you can hire yourself out as a
// CHAMPION in a town whose law allows combat: the client's fee from their own
// purse, their fate on your sword.
//
// State: player.ordeals (saved, systems/saveLoad.js); the trial's choice on
// trial.ordeal, a case's on case.ordeal / case.demand, a suit's on
// suit.combat / suit.combatDemand. The day (processDay, ui/game/endDay.js,
// before the courts) draws hash rolls only; the player's own acts draw
// Utils.random. Coin purse to purse (PlayerCoin). Content: data/ordeals.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Interrupts } from '../core/interrupts.js';
import { Laws } from '../systems/laws.js';
import { MaimFaith } from '../systems/maimFaith.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { NpcMemory } from '../systems/npcMemory.js';
import { Duels } from '../systems/duels.js';
import { Ailments } from '../systems/ailments.js';
import { Companions } from '../systems/companions.js';
import { Relationships } from '../systems/relationships.js';
import { RivalHouses } from '../systems/rivalHouses.js';
import { House } from '../systems/house.js';
import { Raising } from '../systems/raising.js';
import { MaimMarks } from '../systems/maimMarks.js';
import { Maiming } from '../systems/maiming.js';
import { Petitions } from '../systems/petitions.js';
import { Executions } from '../systems/executions.js';
import { Nemesis } from '../systems/nemesis.js';
import { PlayerCoin } from './playerCoin.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = world => _num(world && world.day, 0);
const _seed = world => (world && world.generationParams && world.generationParams.seed) || 0;
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _fill = (t, vars) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
const _byType = (table, type) => _num((table || {})[type], _num((table || {}).default, _num((table || {}).town, 0)));
const _pname = p => (p ? `${p.first}${p.last ? ` ${p.last}` : ''}` : 'someone');
const _cap = s => { const t = String(s || ''); return t.charAt(0).toUpperCase() + t.slice(1); };

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

function _town(world, q, r) {
    const t = world && typeof world.getTile === 'function' && Number.isFinite(q) && Number.isFinite(r) ? world.getTile(q, r) : null;
    return (t && t.settlement) || null;
}

const _folkOf = s => (s && s.folk && Array.isArray(s.folk.people) ? s.folk : null);

export const Ordeals = {
    // ── Tuning ───────────────────────────────────────

    config() {
        const g = DataLoader._gamedata;
        return (g && g.ordeals) || {};
    },

    _c(section) { return Ordeals.config()[section] || {}; },

    enabled() { return Ordeals.config().enabled !== false && !!DataLoader._gamedata && !!DataLoader._gamedata.ordeals; },

    method(id) {
        const M = Ordeals._c('methods');
        return { id, name: id, icon: '⚖️', desc: '', ...(M[id] || {}) };
    },

    line(pool, key, vars = {}) {
        const list = (Ordeals._c('lines')[pool]) || [];
        if (!list.length) return '';
        return _fill(list[_hash(`${pool}|${key}`) % list.length], vars);
    },

    _u(world, key) { return _frac(`${_seed(world)}|ordeals|${key}`); },

    // ── State ────────────────────────────────────────

    _blank() {
        return { next: 1, calls: [], kin: null, perjuries: [], history: [], stats: { wins: 0, losses: 0, ordeals: 0, oaths: 0 }, kinDay: {} };
    },

    state(player) {
        if (!player) return Ordeals._blank();
        if (!_obj(player.ordeals)) player.ordeals = Ordeals._blank();
        const st = player.ordeals;
        const b = Ordeals._blank();
        for (const k of Object.keys(b)) if (st[k] === undefined) st[k] = b[k];
        return st;
    },

    _log(player, world, text) {
        const st = Ordeals.state(player);
        st.history.push({ day: _day(world), text });
        if (st.history.length > 30) st.history.splice(0, st.history.length - 30);
    },

    // ── The law and the faith ─────────────────────────

    /** The realm's law of trial customs: its option id ('court' when no realm). */
    lawOption(world, kingdomId) {
        if (kingdomId == null) return 'court';
        try { return Laws.value(world, kingdomId, 'trialCustoms') || 'court'; } catch (e) { return 'court'; }
    },

    lawDef(world, kingdomId) {
        let o = null;
        try { o = kingdomId != null ? Laws.option(world, kingdomId, 'trialCustoms') : null; } catch (e) { o = null; }
        return o || { id: 'court', label: 'The court alone', allows: [] };
    },

    /** A faith's stance on ordeals: 'sacred' | 'accepted' | 'forbids'. */
    stanceOfFaith(faithId) {
        const f = (Ordeals._c('faith').faiths || {})[faithId];
        return f === 'sacred' || f === 'forbids' ? f : 'accepted';
    },

    stanceOfTenets(tenets) {
        const T = Ordeals._c('faith').tenets || {};
        const s = (Array.isArray(tenets) ? tenets : []).reduce((a, t) => a + _num(T[t]), 0);
        return s >= 2 ? 'sacred' : s <= -2 ? 'forbids' : 'accepted';
    },

    realmStance(world, kingdomId) {
        const f = MaimFaith.realmFaith(world, kingdomId);
        return f ? Ordeals.stanceOfFaith(f) : 'accepted';
    },

    /** The stance of the creed the player keeps, or null. */
    creedStance(player) {
        const r = _obj(player && player.religion);
        if (r && r.name) return r.worldFaithId ? Ordeals.stanceOfFaith(r.worldFaithId) : Ordeals.stanceOfTenets(r.tenets);
        const c = MaimFaith.creed(player);
        return c ? Ordeals.stanceOfFaith(c.id) : null;
    },

    stanceDef(stance) {
        const S = Ordeals._c('faith').stances || {};
        return { label: stance, icon: '🕯️', believe: 1, priestBribe: true, ...(S[stance] || {}) };
    },

    /** How much the realm believes an ordeal's judgement. */
    belief(world, kingdomId) {
        return _num(Ordeals.stanceDef(Ordeals.realmStance(world, kingdomId)).believe, 1);
    },

    /** May this method settle a case in this realm? → { ok, why } */
    allowed(world, kingdomId, methodId) {
        const M = Ordeals.method(methodId);
        const law = Ordeals.lawDef(world, kingdomId);
        if (!(law.allows || []).includes(methodId)) return { ok: false, why: `The law of the realm (${String(law.label || 'the court alone').toLowerCase()}) does not allow it.` };
        if (M.kind === 'ordeal' && Ordeals.realmStance(world, kingdomId) === 'forbids') {
            const f = MaimFaith.realmFaith(world, kingdomId);
            return { ok: false, why: `The clergy of ${f ? MaimFaith.faithName(f) : 'the realm'} will bless no ordeal.` };
        }
        return { ok: true, why: '' };
    },

    /** The realm's customs in words, for the panel. */
    customsView(world, kingdomId) {
        const law = Ordeals.lawDef(world, kingdomId);
        const stance = Ordeals.realmStance(world, kingdomId);
        const f = MaimFaith.realmFaith(world, kingdomId);
        return { law, stance, stanceDef: Ordeals.stanceDef(stance), faith: f ? MaimFaith.faithName(f) : null, methods: Object.keys(Ordeals._c('methods')).filter(m => Ordeals.allowed(world, kingdomId, m).ok) };
    },

    /** A player whose creed forbids ordeals pays in karma for taking part. → text or '' */
    _creedCost(player, methodId) {
        if (Ordeals.method(methodId).kind !== 'ordeal' || Ordeals.creedStance(player) !== 'forbids') return '';
        player.karma = _num(player.karma) + _num(Ordeals._c('faith').creedKarma, -4);
        return ' Your own faith forbids it: it weighs on your soul.';
    },

    // ── Fighters ──────────────────────────────────────

    /** A townsperson as a duellist. */
    _folkFighter(p, world, title = null) {
        let c;
        try { c = Duels.fromNpc({ type: p.role === 'soldier' ? 'guard' : p.role, personalityTraits: p.traits || [], id: `f${p.id}`, fullName: _pname(p), _person: p }, { world }); } catch (e) { c = null; }
        if (!c) c = Duels.fromProfile({ ...(((Duels.config().npcs || {}).guard) || {}), name: _pname(p) });
        c.name = _pname(p);
        if (title) c.title = title;
        return c;
    },

    /** The court's champion profile by town type. */
    _courtChampion(type) {
        const C = Ordeals._c('combat').champions || {};
        const prof = C[type] || C.town || { name: 'the court\'s champion', attack: 4, defense: 3, power: 7, hp: 30, stamina: 12 };
        const c = Duels.fromProfile({ ...prof, name: _cap(prof.name), icon: '🛡️', kind: 'npc' });
        return c;
    },

    /** Guards of a town who could fight: [{ p, skill }], by strength. exclude: pids. */
    _guards(world, s, exclude = []) {
        const folk = _folkOf(s);
        if (!folk) return [];
        const day = _day(world);
        const ex = new Set(exclude.filter(x => x != null));
        return Townsfolk.residents(folk)
            .filter(p => (p.role === 'guard' || p.role === 'soldier') && !ex.has(p.id) && Townsfolk.age(p, day) >= 18 && Townsfolk.age(p, day) <= 55 && !Townsfolk.injury(p, day))
            .map(p => ({ p, skill: 2 + (_hash(`${folk.q},${folk.r}#${p.id}|champ`) % 7) }))
            .sort((a, b) => b.skill - a.skill || a.p.id - b.p.id);
    },

    /** The accuser's champion at a court: the strongest guard, else the court's champion. */
    accuserChampion(world, court, exclude = []) {
        const s = _town(world, court.q, court.r);
        const g = Ordeals._guards(world, s, exclude)[0];
        if (g) {
            const c = Ordeals._folkFighter(g.p, world, `${Townsfolk.roleTitle(g.p)} of ${court.town || (s && s.name) || 'the town'}`);
            c.attack += g.skill * 0.25;
            return { name: _pname(g.p), pid: g.p.id, combatant: c };
        }
        const c = Ordeals._courtChampion((s && s.type) || court.type || 'town');
        return { name: c.name, pid: null, combatant: c };
    },

    _companionFighter(player, npc) {
        const occ = _num((Ordeals._c('combat').companionOccupations || {})[npc.occupation]);
        const g = (Duels.config().npcs || {}).guard || {};
        const lvl = _num(npc.level, 1);
        return Duels.fromProfile({
            ...g, id: `c${npc.id}`, kind: 'npc', icon: '🧑', name: `${npc.firstName}${npc.dynasty ? ` ${npc.dynasty}` : ''}`,
            attack: _num(g.attack, 4) + occ + lvl * 0.2, defense: _num(g.defense, 3.5) + occ * 0.7, power: _num(g.power, 8) + occ, hp: _num(g.hp, 34) + occ * 2,
            temperament: 'balanced', ref: npc,
        });
    },

    /**
     * Who could fight for one in this court: yourself, the fighting companions
     * of your party, the town's guards for a fee. → [{ id, name, desc, fee, power }]
     */
    champions(player, world, court, exclude = []) {
        const out = [{ id: 'self', name: 'Fight yourself', desc: 'In person, before the court', fee: 0, self: true }];
        const C = Ordeals._c('combat');
        const occ = C.companionOccupations || {};
        for (const npc of Companions.members(player, world)) {
            if (!npc || npc.isAlive === false || !(npc.occupation in occ)) continue;
            out.push({ id: `comp:${npc.id}`, name: `${npc.firstName}${npc.dynasty ? ` ${npc.dynasty}` : ''}`, desc: `your companion, ${npc.occupation}: no fee, but their life is the stake`, fee: 0 });
        }
        const s = _town(world, court.q, court.r);
        const guards = Ordeals._guards(world, s, exclude);
        // (the strongest guard is the accuser's champion: the rest may be hired)
        for (const g of guards.slice(1, 4)) {
            const fee = Utils.cents(_byType(C.championFee, (s && s.type) || court.type) * (0.6 + g.skill / 8));
            out.push({ id: `guard:${g.p.id}`, name: _pname(g.p), desc: `${Townsfolk.roleTitle(g.p)} of ${s.name}, a fighter of some skill (${g.skill})`, fee, pid: g.p.id, skill: g.skill });
        }
        return out;
    },

    /** Build our side's fighter from a champion id: { combatant, kind, ref, fee, name } or { error } */
    _ourSide(player, world, court, champId) {
        if (champId === 'self') return { combatant: Duels.fromPlayer(player), kind: 'player', name: 'you', fee: 0 };
        const [kind, id] = String(champId || '').split(':');
        if (kind === 'comp') {
            const npc = Companions.members(player, world).find(n => String(n.id) === id);
            if (!npc) return { error: 'They are not with you.' };
            return { combatant: Ordeals._companionFighter(player, npc), kind: 'companion', ref: npc, fee: 0, name: npc.firstName };
        }
        if (kind === 'guard') {
            const s = _town(world, court.q, court.r);
            const folk = _folkOf(s);
            const p = folk ? Townsfolk.get(folk, Number(id)) : null;
            const ch = Ordeals.champions(player, world, court).find(c => c.id === champId);
            if (!p || !ch || !Townsfolk.isHere(p)) return { error: 'That champion is not to be had.' };
            if (_num(player.gold) < ch.fee) return { error: `${_pname(p)} wants ${Utils.formatGold(ch.fee)} gold.` };
            const c = Ordeals._folkFighter(p, world, 'your champion');
            c.attack += ch.skill * 0.25;
            return { combatant: c, kind: 'folk', ref: p, folk, fee: ch.fee, name: _pname(p) };
        }
        return { error: 'No such champion.' };
    },

    /** Pay a hired champion his fee (into his own purse). */
    _payChampion(player, world, side) {
        if (!side || !(side.fee > 0) || side.kind !== 'folk') return;
        Townsfolk.purse(side.folk, side.ref, world);
        PlayerCoin.pay(world, player, side.fee, { purse: side.ref, key: 'purse' }, 'mercenaryWages');
    },

    /**
     * What a bout did to the two who fought (outcome: Duels.result; a = our
     * side). The player's harm and wounds, a companion or townsperson who fell
     * dying of it, the craven's shame. key: a hash key. → { cleared, parts[] }
     */
    _aftermath(player, world, outcome, us, them, key) {
        const C = Ordeals._c('combat');
        const day = _day(world);
        const parts = [];
        const cleared = !!outcome.playerWon;
        const yieldedUs = outcome.yielded === 'a';
        const fell = (lost, hp) => !(hp > 0) || lost >= 0.98;
        const dies = (k) => Ordeals._u(world, `${key}|${k}|death`) < _num(C.deathChance, 0.55);
        // Our side
        if (us.kind === 'player') {
            const range = cleared ? (C.playerWinHarm || [2, 16]) : (C.playerFallHarm || [20, 45]);
            const harm = yieldedUs ? Duels.harm(outcome.aLost, C.playerWinHarm || [2, 16]) : Duels.harm(outcome.aLost, range);
            player.health = Math.max(1, _num(player.health, 100) - harm);
            parts.push(`−${harm} health`);
            if (!cleared && !yieldedUs) {
                const w = Ailments.maybeWound(player, world, 'duel', { chanceMult: 3 });
                if (w) parts.push(`${w.icon || ''} ${w.name}`.trim());
            }
            if (yieldedUs) { player.renown = Math.max(0, _num(player.renown) + _num(C.cravenRenown, -8)); parts.push(`${_num(C.cravenRenown, -8)} renown: you cried craven`); }
            else if (cleared) player.renown = _num(player.renown) + _num(C.winRenown, 6);
        } else if (!cleared && !yieldedUs && fell(outcome.aLost, outcome.aHp)) {
            if (us.kind === 'companion' && dies('us')) { Companions.fall(player, us.ref, world, `${them.name} in a trial by combat`); parts.push(`${us.name} died on the field`); }
            else if (us.kind === 'folk' && dies('us')) { Townsfolk.slay(us.folk, us.ref, day, 'a trial by combat', world); parts.push(`${us.name} died on the field`); }
            else if (us.kind === 'folk') { Townsfolk.injure(us.ref, day, 2, 30); parts.push(`${us.name} was carried off`); }
            else parts.push(`${us.name} was carried off, badly hurt`);
        }
        // Theirs
        if (cleared && outcome.yielded !== 'b' && fell(outcome.bLost, outcome.bHp)) {
            if (them.kind === 'folk' && them.ref && dies('them')) { Townsfolk.slay(them.folk, them.ref, day, 'a trial by combat', world); parts.push(`${them.name} lies dead`); }
            else if (them.kind === 'folk' && them.ref) { Townsfolk.injure(them.ref, day, 2, 30); parts.push(`${them.name} is carried off`); }
            else if (them.kind === 'rival' && them.ref) Ordeals._rivalFell(player, world, them, dies('them'), parts);
            else if (them.kind === 'rival') parts.push(`${them.name} is carried from the field`);
        } else if (cleared && outcome.yielded === 'b') parts.push(`${them.name} yields`);
        const st = Ordeals.state(player);
        if (us.kind === 'player') { if (cleared) st.stats.wins++; else st.stats.losses++; }
        return { cleared, yielded: yieldedUs, parts };
    },

    /**
     * A rival House's fighter down in the lists. Their sworn sword (a guard of
     * the House) dead: one guard fewer, the feud up. Their head dead: the House
     * passes to the heir (RivalHouses._succeed), the feud flares, and the new
     * head swears vengeance (a Nemesis grudge of the House).
     */
    _rivalFell(player, world, them, dies, parts) {
        const rival = them.ref;
        const R = Ordeals._c('combat').rival || {};
        if (them.sworn) {
            if (!dies) { parts.push(`${them.name} is carried from the field`); return; }
            rival.guard = Math.max(0, _num(rival.guard) - 1);
            rival.feud = Math.min(100, _num(rival.feud) + _num(R.swornFeud, 10));
            RivalHouses._note(rival, world, `Lost ${them.name}, their sworn sword, in the lists against you.`, 'bereaved');
            parts.push(`${them.name} dies on the field`);
            return;
        }
        if (!(Ordeals._u(world, `rivalHead|${rival.kingdomId}|${_day(world)}`) < _num(R.headDeathChance, 0.35))) { parts.push(`${them.name} is carried from the field, badly hurt`); return; }
        const oldName = RivalHouses.headName(rival);
        const out = { notices: [] };
        try { RivalHouses._succeed(world, rival, out, player); } catch (e) { return; }
        rival.feud = Math.min(100, _num(rival.feud) + _num(R.headFeud, 30));
        if (!Array.isArray(rival.memory)) rival.memory = [];
        rival.memory.push({ kind: 'headSlain', day: _day(world), w: -_num(R.headFeud, 30), note: `${oldName}, in the lists` });
        if (rival.memory.length > 14) rival.memory.splice(0, rival.memory.length - 14);
        const heir = RivalHouses.headName(rival);
        Nemesis.wrong(player, world, {
            kind: 'house', name: heir, ref: { kingdomId: rival.kingdomId }, line: rival.name,
            deed: { key: 'head_slain', label: `the death of ${oldName} in the lists`, note: 'trial by combat' },
            score: _num(R.nemesisScore, 60), age: rival.head && rival.head.age, gender: rival.head && rival.head.gender,
        });
        parts.push(`${oldName} dies on the field; ${heir} now heads ${rival.name} and swears vengeance`);
        if (player.house) House._chronicle(player.house, world, `${oldName} of ${rival.name} died in the lists, in a trial by combat against ${player.name || 'the House'}.`, ['rival', 'death', 'trial']);
    },

    /** Who fights for a rival House: its head, or — old, maimed or no fighter, with guards to send — a sworn sword. */
    _rivalChampion(rival) {
        const h = rival.head || {};
        const R = Ordeals._c('combat').rival || {};
        const unfit = _num(h.age, 40) > _num(R.swornAge, 55) || _num(h.martial, 5) < _num(R.swornMartial, 5) || MaimMarks.barsRule(h);
        if (unfit && _num(rival.guard) > 0) {
            const prof = (Ordeals._c('combat').champions || {}).city || {};
            const name = `the sworn sword of ${rival.name}`;
            return { combatant: Duels.fromProfile({ ...prof, name: _cap(name), icon: '🛡️', kind: 'npc' }), them: { kind: 'rival', ref: rival, name: _cap(name), sworn: true }, label: _cap(name) };
        }
        const name = RivalHouses.headName(rival);
        return { combatant: RivalHouses.duelist(rival), them: { kind: 'rival', ref: rival, name }, label: name };
    },

    /** The bout as the panel shows it: who fought, the last exchanges. */
    _boutOf(outcome, aName, bName) {
        if (!outcome || !Array.isArray(outcome.log)) return null;
        return { a: aName, b: bName, rounds: outcome.rounds, won: !!outcome.playerWon, yielded: outcome.yielded || null, log: outcome.log.slice(-6).map(e => ({ round: e.round, aMove: e.aMove, bMove: e.bMove, text: e.text })) };
    },

    /** The other side as an aftermath record: { kind, ref, folk, name } */
    _theirSide(world, court, champ) {
        if (champ && champ.pid != null) {
            const s = _town(world, court.q, court.r);
            const folk = _folkOf(s);
            const p = folk ? Townsfolk.get(folk, champ.pid) : null;
            if (p) return { kind: 'folk', ref: p, folk, name: champ.name };
        }
        return { kind: 'profile', name: champ ? champ.name : 'the champion' };
    },

    /** Duel settings for the panel. */
    duelSpec(a, b, title, intro) {
        const C = Ordeals._c('combat');
        return { a, b, mode: C.mode || 'toDeath', rounds: _num(C.rounds, 24), title, intro };
    },

    // ── Oath-helpers ──────────────────────────────────

    /**
     * Who would swear for you at this court: companions who think well of you,
     * friends, the grown of your family, townsfolk of the town who remember you
     * well. → [{ type, id, name, why, warmth }]
     */
    oathHelpers(player, world, court) {
        const C = Ordeals._c('compurgation');
        const out = [];
        const day = _day(world);
        const seen = new Set();
        for (const npc of Companions.members(player, world)) {
            const a = _num(npc.companion && npc.companion.approval, 50);
            if (a < _num(C.minApproval, 55)) continue;
            seen.add(npc.id);
            out.push({ type: 'npc', id: npc.id, name: npc.firstName, why: 'your companion', warmth: a / 100 });
        }
        for (const npc of Relationships._npcs || []) {
            if (!npc || npc.isAlive === false || seen.has(npc.id)) continue;
            const rel = player.relationships && player.relationships[npc.id];
            if (!rel || _num(rel.score) < _num(C.minFriendScore, 25)) continue;
            seen.add(npc.id);
            out.push({ type: 'npc', id: npc.id, name: `${npc.firstName}${npc.dynasty ? ` ${npc.dynasty}` : ''}`, why: player.spouse === npc.id ? 'your spouse' : 'a friend', warmth: _clamp(_num(rel.score) / 100, 0.2, 1) });
        }
        for (const c of player.children || []) {
            if (!c || c.isAlive === false || _num(c.age) < 16) continue;
            out.push({ type: 'kin', id: c.id, name: c.firstName, why: c.gender === 'female' ? 'your daughter' : 'your son', warmth: 0.9 });
        }
        const s = court ? _town(world, court.q, court.r) : null;
        const folk = _folkOf(s);
        if (folk && player) {
            for (const p of Townsfolk.residents(folk)) {
                if (Townsfolk.age(p, day) < 18) continue;
                let op = 0;
                try { op = NpcMemory.opinion(world, { folk, person: p }, player); } catch (e) { op = 0; }
                if (op < _num(C.townWarmth, 6)) continue;
                out.push({ type: 'folk', id: p.id, q: folk.q, r: folk.r, name: _pname(p), why: `of ${s.name}, who remembers you well`, warmth: _clamp(op / 30, 0.3, 1) });
            }
        }
        return out.slice(0, _num(C.maxHelpers, 14));
    },

    need(court) {
        return Math.max(1, Math.round(_byType(Ordeals._c('compurgation').need, court && court.type)));
    },

    /** Each helper at the altar: do they swear? (the player's act: Utils' dice) → sworn helpers */
    _swear(helpers) {
        const sw = _num(Ordeals._c('compurgation').swear, 0.85);
        return helpers.filter(h => Utils.random() < sw * (0.6 + 0.4 * h.warmth));
    },

    /** An oath that may be found out as perjury: kept, to surface later. */
    _perjuryRisk(player, world, sworn, where) {
        const C = Ordeals._c('compurgation');
        if (!sworn.length || !(Utils.random() < _num(C.perjuryChance, 0.4))) return;
        const [lo, hi] = Array.isArray(C.perjuryDays) ? C.perjuryDays : [40, 360];
        const st = Ordeals.state(player);
        st.perjuries.push({ id: st.next++, day: _day(world), surface: _day(world) + Utils.randInt(lo, hi), kingdomId: where.kingdomId, town: where.town, q: where.q, r: where.r, helpers: sworn.slice(0, 14).map(h => ({ type: h.type, id: h.id, q: h.q, r: h.r, name: h.name })) });
        if (st.perjuries.length > 10) st.perjuries.shift();
    },

    _surfacePerjury(player, world, pj, out) {
        const C = Ordeals._c('compurgation');
        for (const h of pj.helpers) {
            if (h.type === 'npc') {
                const rel = Relationships.getRelationship(player, h.id);
                if (rel) rel.score = Math.max(-100, _num(rel.score) - _num(C.perjuryRegard, 20));
                const npc = Relationships.getNPC(h.id);
                if (npc && npc.companion) Companions.adjust(npc, -_num(C.perjuryRegard, 20), 'shamed for the false oath they swore for you', _day(world));
            } else if (h.type === 'folk') {
                const s = _town(world, h.q, h.r);
                const folk = _folkOf(s);
                const p = folk ? Townsfolk.get(folk, h.id) : null;
                if (p && Townsfolk.isHere(p)) NpcMemory.remember(world, { folk, person: p }, { kind: 'perjury_shamed', player });
            } else if (h.type === 'kin') {
                const c = (player.children || []).find(x => x && x.id === h.id);
                if (c) Raising._addBond(c, -Math.round(_num(C.perjuryRegard, 20) / 2));
            }
        }
        if (pj.kingdomId != null) {
            if (!player.reputation) player.reputation = {};
            player.reputation[pj.kingdomId] = _num(player.reputation[pj.kingdomId]) - _num(C.perjuryRep, 12);
        }
        if (player.house) { const loss = Math.min(_num(player.house.prestige), _num(C.perjuryPrestige, 10)); if (loss > 0) House.spend(player.house, loss, 'perjury found out', _day(world)); }
        const text = `The oath sworn for you at ${pj.town} is found out as perjury. ${pj.helpers.length} who swore with you are shamed before the realm, and your name with them.`;
        out.notices.push({ icon: '🤝', title: 'Perjury Found Out', text, type: 'error' });
        Ordeals._log(player, world, text);
        if (player.house) House._chronicle(player.house, world, `Perjury at ${pj.town}: the oath-helpers of ${player.name || 'the House'} shamed.`, ['trial', 'perjury']);
    },

    // ── The priest ────────────────────────────────────

    priestFee(court) { return Utils.cents(_byType(Ordeals._c('priest').fee, court && court.type)); },

    /** The priest of the town who blesses the ordeal: a real priest's purse, else the town's. */
    _priest(world, court) {
        const s = _town(world, court.q, court.r);
        const folk = _folkOf(s);
        const p = folk ? Townsfolk.residents(folk).find(x => x.role === 'priest') : null;
        return { s, folk, p, name: p ? _pname(p) : 'the priest' };
    },

    /** Pay the priest to go easy (a cooler iron, a slacker rope). target: the court (trial, case, kin). */
    payPriest(player, world, target) {
        if (!target) return { success: false, reason: 'There is no ordeal to arrange.' };
        if (target.priestPaid) return { success: false, reason: 'The priest has your coin already.' };
        const fee = Ordeals.priestFee(target);
        if (_num(player.gold) < fee) return { success: false, reason: `The priest would want ${Utils.formatGold(fee)} gold.` };
        const pr = Ordeals._priest(world, target);
        const stance = Ordeals.realmStance(world, target.kingdomId);
        if (!Ordeals.stanceDef(stance).priestBribe) {
            target.priestRefused = true;
            if (Array.isArray(target.charges)) target.charges.push({ id: `priest${_day(world)}`, ids: [], group: 'tampering with an ordeal', label: 'tampering with God\'s judgement', proof: 2, who: [pr.name], grave: false });
            return { success: true, refused: true, text: `${_cap(pr.name)} will not sell God's judgement, and tells the court you tried.` };
        }
        if (pr.p) { Townsfolk.purse(pr.folk, pr.p, world); PlayerCoin.pay(world, player, fee, { purse: pr.p, key: 'purse' }, 'bribes'); } else PlayerCoin.pay(world, player, fee, pr.s || { q: target.q, r: target.r }, 'bribes');
        target.priestPaid = true;
        return { success: true, text: `${_cap(pr.name)} takes ${Utils.formatGold(fee)} gold. The iron will be cooler, the rope looser, the bread softer.` };
    },

    /** The chance the ordeal goes your way. who: { luck, strength, swim, karma }, proof: the strongest charge's. */
    chance(methodId, who, proof, priestPaid) {
        if (methodId === 'iron') {
            const I = Ordeals._c('iron');
            const fester = _clamp(_num(I.base, 0.3) + _num(I.guiltPer, 0.06) * proof - _num(who.luck, 5) * _num(I.luckPer, 0.015) - (priestPaid ? _num(I.priestPaid, 0.15) : 0), _num(I.min, 0.08), _num(I.max, 0.8));
            return 1 - fester;
        }
        if (methodId === 'water') {
            const W = Ordeals._c('water');
            return _clamp(_num(W.base, 0.5) + _num(who.strength, 5) * _num(W.strengthPer, 0.02) - _num(who.swim) * _num(W.swimPer, 0.04) + (priestPaid ? _num(W.priestPaid, 0.15) : 0), _num(W.min, 0.12), _num(W.max, 0.88));
        }
        if (methodId === 'bread') {
            const B = Ordeals._c('bread');
            return _clamp(_num(B.base, 0.62) + _num(who.karma) * _num(B.karmaPer, 0.002) - _num(B.guiltPer, 0.05) * proof + (priestPaid ? _num(B.priestPaid, 0.12) : 0), _num(B.min, 0.15), _num(B.max, 0.9));
        }
        return 0.5;
    },

    _playerWho(player) {
        const sk = player.skills || {};
        return { luck: _num(player.luck, 5), strength: _num(player.strength, 5), swim: _num(sk.swimming, _num(sk.swim)), karma: _num(player.karma) };
    },

    _maxProof(trial) { return Math.max(0, ...((trial && trial.charges) || []).map(c => _num(c.proof))); },

    // ══════════════════════════════════════════════
    // YOUR TRIAL
    // ══════════════════════════════════════════════

    _present(player, trial) {
        if (!player || !trial) return false;
        if (player.jailState) return player.jailState.trialId === trial.id;
        return player.q === trial.q && player.r === trial.r;
    },

    /** The other judgements open at your trial: [{ id, name, icon, desc, ok, why, odds? }] */
    trialOptions(player, world, trial) {
        if (!Ordeals.enabled() || !trial) return [];
        const present = Ordeals._present(player, trial);
        const proof = Ordeals._maxProof(trial);
        const who = Ordeals._playerWho(player);
        return Object.keys(Ordeals._c('methods')).map(id => {
            const M = Ordeals.method(id);
            const a = Ordeals.allowed(world, trial.kingdomId, id);
            let why = a.why;
            if (a.ok && !present) why = 'You must stand before the court for it.';
            if (a.ok && trial.plea === 'guilty') why = 'You have pleaded guilty.';
            if (a.ok && trial.ordeal) why = 'Your case already goes to another judgement.';
            const opt = { id, name: M.name, icon: M.icon, desc: M.desc, ok: a.ok && !why, why };
            if (M.kind === 'ordeal') opt.odds = Ordeals.chance(id, who, proof, trial.priestPaid);
            if (id === 'compurgation') { opt.helpers = Ordeals.oathHelpers(player, world, trial).length; opt.need = Ordeals.need(trial); }
            return opt;
        });
    },

    /**
     * Ask for trial by combat. champId: 'self' | 'comp:<id>' | 'guard:<pid>'.
     * Self → { success, duel } (the panel fights it, then settleTrialCombat);
     * a champion → fought on the spot by instinct and settled.
     */
    trialCombat(player, world, champId) {
        const trial = player && player.trials && player.trials.trial;
        const opt = trial && Ordeals.trialOptions(player, world, trial).find(o => o.id === 'combat');
        if (!opt || !opt.ok) return { success: false, reason: (opt && opt.why) || 'There is no such right here.' };
        const foe = Ordeals.accuserChampion(world, trial);
        const us = Ordeals._ourSide(player, world, trial, champId);
        if (us.error) return { success: false, reason: us.error };
        trial.ordeal = { method: 'combat', champ: champId, foe: { name: foe.name, pid: foe.pid }, day: _day(world), pending: true };
        if (us.kind === 'player') {
            return { success: true, duel: Ordeals.duelSpec(us.combatant, foe.combatant, '⚔️ Trial by Combat', `The court of <b>${trial.town}</b> stands at the lists. ${foe.name} fights for your accusers. Yield, and it is guilt.`) };
        }
        Ordeals._payChampion(player, world, us);
        const outcome = Duels.autoResolve(us.combatant, foe.combatant, { mode: Ordeals._c('combat').mode || 'toDeath', rounds: _num(Ordeals._c('combat').rounds, 24) });
        const r = Ordeals._settleTrialBout(player, world, trial, outcome, us, foe);
        r.bout = Ordeals._boutOf(outcome, us.name, foe.name);
        return r;
    },

    /** The duel panel's result for a trial by combat you fought yourself. */
    settleTrialCombat(player, world, outcome) {
        const trial = player && player.trials && player.trials.trial;
        if (!trial || !trial.ordeal || trial.ordeal.method !== 'combat' || !trial.ordeal.pending || !outcome) return { success: false, reason: 'There is no such fight.' };
        const foe = { name: trial.ordeal.foe.name, pid: trial.ordeal.foe.pid };
        return Ordeals._settleTrialBout(player, world, trial, outcome, { kind: 'player', name: 'you' }, foe);
    },

    _settleTrialBout(player, world, trial, outcome, us, foe) {
        const them = Ordeals._theirSide(world, trial, foe);
        const a = Ordeals._aftermath(player, world, outcome, us, them, `trial${trial.id}`);
        const vars = { town: trial.town };
        const lead = a.yielded ? Ordeals.line('craven', trial.id, vars) : Ordeals.line(a.cleared ? 'combatWon' : 'combatLost', trial.id, vars);
        trial.ordeal = { method: 'combat', champ: trial.ordeal && trial.ordeal.champ, cleared: a.cleared, text: `${lead}${a.parts.length ? ` (${a.parts.join('; ')}.)` : ''}`, day: _day(world) };
        Ordeals._log(player, world, `Trial by combat at ${trial.town}: ${a.cleared ? 'won' : 'lost'}.`);
        return { success: true, resolveNow: true, cleared: a.cleared, text: trial.ordeal.text };
    },

    /** Undergo the iron, the water or the bread at your trial. */
    trialOrdeal(player, world, methodId) {
        const trial = player && player.trials && player.trials.trial;
        const opt = trial && Ordeals.trialOptions(player, world, trial).find(o => o.id === methodId);
        if (!opt || !opt.ok || Ordeals.method(methodId).kind !== 'ordeal') return { success: false, reason: (opt && opt.why) || 'There is no such ordeal here.' };
        const day = _day(world);
        const st = Ordeals.state(player);
        st.stats.ordeals++;
        const creed = Ordeals._creedCost(player, methodId);
        const vars = { town: trial.town };
        if (methodId === 'iron') {
            const I = Ordeals._c('iron');
            const w = Ailments.inflict(player, world, I.wound || 'burned_hand', { source: 'ordeal' });
            const unbind = day + _num(I.unbindDays, 3);
            trial.ordeal = { method: 'iron', day, unbind, woundKey: w ? w.key : null, odds: opt.odds };
            trial.day = Math.max(_num(trial.day), unbind);
            if (player.jailState && player.jailState.trialId === trial.id) player.jailState.daysRemaining = Math.max(_num(player.jailState.daysRemaining), unbind - day + 1);
            Ordeals._log(player, world, `Carried the hot iron at ${trial.town}.`);
            return { success: true, scene: { method: 'iron', who: 'you', pending: true }, text: `You carry the red iron nine paces before the court of ${trial.town}. The priest binds your hand and seals it: it will be unbound on day ${unbind}.${creed}` };
        }
        const ok = Utils.random() < opt.odds;
        let extra = '';
        if (methodId === 'water') {
            const H = Ordeals._c('water').health || [4, 14];
            const lost = Utils.randInt(H[0], H[1]);
            player.health = Math.max(1, _num(player.health, 100) - lost);
            extra = ` (−${lost} health)`;
        }
        const pool = methodId === 'water' ? (ok ? 'waterSank' : 'waterFloated') : (ok ? 'breadClean' : 'breadChoked');
        trial.ordeal = { method: methodId, day, cleared: ok, text: `${Ordeals.line(pool, trial.id, vars)}${extra}${creed}` };
        Ordeals._log(player, world, `${Ordeals.method(methodId).name} at ${trial.town}: ${ok ? 'cleared' : 'guilty'}.`);
        return { success: true, resolveNow: true, cleared: ok, text: trial.ordeal.text, scene: { method: methodId, who: 'you', cleared: ok } };
    },

    /** Clear yourself with oath-helpers at your trial. */
    trialOath(player, world) {
        const trial = player && player.trials && player.trials.trial;
        const opt = trial && Ordeals.trialOptions(player, world, trial).find(o => o.id === 'compurgation');
        if (!opt || !opt.ok) return { success: false, reason: (opt && opt.why) || 'Oath-helpers are not heard here.' };
        const need = Ordeals.need(trial);
        const sworn = Ordeals._swear(Ordeals.oathHelpers(player, world, trial));
        const ok = sworn.length >= need;
        const st = Ordeals.state(player);
        st.stats.oaths++;
        const vars = { town: trial.town, n: sworn.length, need };
        // (an oath against the plain proof is perjury, and may come out)
        if (ok && Ordeals._maxProof(trial) >= 3) Ordeals._perjuryRisk(player, world, sworn, trial);
        trial.ordeal = { method: 'compurgation', day: _day(world), cleared: ok, sworn: sworn.map(h => h.name), text: Ordeals.line(ok ? 'oathCarried' : 'oathFailed', trial.id, vars) };
        Ordeals._log(player, world, `Oath-helpers at ${trial.town}: ${sworn.length} of ${need} swore.`);
        return { success: true, resolveNow: true, cleared: ok, scene: { method: 'compurgation', who: 'you', cleared: ok, n: sworn.length, need }, text: `${trial.ordeal.text}${sworn.length ? ` (${sworn.slice(0, 6).map(h => h.name).join(', ')}${sworn.length > 6 ? '…' : ''}.)` : ''}` };
    },

    /**
     * Read by Trials.resolveTrial: the judgement another way has given.
     * → null (the court decides) or { convicted, text }
     */
    decide(player, world, trial) {
        const o = trial && trial.ordeal;
        if (!o || o.pending || trial.plea === 'guilty') return null;
        let cleared = o.cleared;
        let text = o.text || '';
        if (o.method === 'iron') {
            const rec = o.woundKey ? (Ailments.list(player) || []).find(a => a.key === o.woundKey) : null;
            const festered = (rec && rec.infected) || Ordeals._u(world, `iron|${trial.id}|${o.day}`) >= _num(o.odds, 0.6);
            cleared = !festered;
            text = Ordeals.line(cleared ? 'ironClean' : 'ironFoul', trial.id, { town: trial.town });
        }
        if (cleared == null) return null;
        if (cleared) {
            const belief = Ordeals.belief(world, trial.kingdomId);
            if (trial.kingdomId != null) {
                if (!player.reputation) player.reputation = {};
                player.reputation[trial.kingdomId] = _num(player.reputation[trial.kingdomId]) + Math.round(_num(Ordeals._c('outcome').acquitRep, 6) * belief);
            }
            // The accusers are shamed
            const s = _town(world, trial.q, trial.r);
            const folk = _folkOf(s);
            for (const w of trial.witnesses || []) {
                if (w.state !== 'stands' || w.pid == null || !folk) continue;
                const p = Townsfolk.get(folk, w.pid);
                if (!p || !Townsfolk.isHere(p)) continue;
                NpcMemory.remember(world, { folk, person: p }, { kind: 'ordeal_shamed', player });
                Townsfolk.note(p, _day(world), 'shamed', null, 'an ordeal');
            }
        }
        return { convicted: !cleared, text };
    },

    // ══════════════════════════════════════════════
    // THE CASES BEFORE YOUR COURT
    // ══════════════════════════════════════════════

    /** Read by Trials._makeCase: what the accused demands as of right (a hash of the case). → id or null */
    demandFor(world, c, folk = null) {
        if (!Ordeals.enabled() || !c) return null;
        const D = Ordeals._c('demand');
        if (_num(c.severity, 2) < _num(D.minSeverity, 2)) return null;
        const p = folk && c.accused ? Townsfolk.get(folk, c.accused.pid) : null;
        const fighter = p && (Ordeals._c('combat').fighterRoles || []).includes(p.role);
        const u = Ordeals._u(world, `demand|${c.key}|${c.id}`);
        if (fighter && Ordeals.allowed(world, c.kingdomId, 'combat').ok && u < _num(D.combatShare, 0.45)) return 'combat';
        if (Ordeals.realmStance(world, c.kingdomId) !== 'forbids') {
            for (const m of ['iron', 'water']) if (Ordeals.allowed(world, c.kingdomId, m).ok && u < _num(D.ordealShare, 0.3)) return m;
        }
        const kin = p ? [p.spouse, ...(p.kids || []), ...(p.parents || [])].filter(id => { const o = folk && Townsfolk.get(folk, id); return o && Townsfolk.isHere(o); }).length : 0;
        if (kin >= 2 && Ordeals.allowed(world, c.kingdomId, 'compurgation').ok && u < _num(D.oathShare, 0.25)) return 'compurgation';
        return null;
    },

    _caseOf(player, caseId) {
        return ((player && player.trials && player.trials.cases) || []).find(c => c.id === caseId) || null;
    },

    _casePeople(world, c) {
        const s = _town(world, c.q, c.r);
        const folk = _folkOf(s);
        const acc = folk ? Townsfolk.get(folk, c.accused.pid) : null;
        const vic = folk && c.victim && c.victim.pid != null ? Townsfolk.get(folk, c.victim.pid) : null;
        return { s, folk, acc: acc && Townsfolk.isHere(acc) ? acc : null, vic: vic && Townsfolk.isHere(vic) ? vic : null };
    },

    /** The other judgements a case before your court may go to: [{ id, name, icon, desc, ok, why, demanded }] */
    caseOptions(player, world, c) {
        if (!Ordeals.enabled() || !c || c.ordeal) return [];
        return Object.keys(Ordeals._c('methods')).map(id => {
            const M = Ordeals.method(id);
            const a = Ordeals.allowed(world, c.kingdomId, id);
            return { id, name: M.name, icon: M.icon, desc: M.desc, ok: a.ok, why: a.why, demanded: c.demand === id };
        }).filter(o => o.ok || o.demanded);
    },

    /**
     * Put a case to another judgement. method: 'combat' | 'iron' | 'water' |
     * 'bread' | 'compurgation'. opts.self (combat): you stand as the crown's
     * champion against the accused → { success, duel } (then settleCaseCombat).
     * → { success, text, cleared } — cleared: acquit the case now (the panel
     * calls Trials.rule 'acquit'); guilty: the case waits for your sentence.
     */
    judgeCase(player, world, caseId, methodId, opts = {}) {
        const c = Ordeals._caseOf(player, caseId);
        if (!c) return { success: false, reason: 'There is no such case before you.' };
        if (c.ordeal) return { success: false, reason: 'That case has had its judgement.' };
        const a = Ordeals.allowed(world, c.kingdomId, methodId);
        if (!a.ok) return { success: false, reason: a.why };
        const { s, folk, acc, vic } = Ordeals._casePeople(world, c);
        if (!acc) return { success: false, reason: `${c.accused.name} is gone from ${c.town}.` };
        const day = _day(world);
        const key = `case${c.id}`;
        const name = c.accused.name;
        let cleared;
        let text;
        let caseBout = null;
        if (methodId === 'combat') {
            const accF = Ordeals._folkFighter(acc, world, 'the accused');
            if (opts.self) {
                c.ordeal = { method: 'combat', pending: true, self: true };
                return { success: true, duel: Ordeals.duelSpec(Duels.fromPlayer(player), accF, '⚔️ Trial by Combat', `You stand as champion of your own court against <b>${name}</b>, who demands God's judgement. If you fall, ${acc.gender === 'female' ? 'she' : 'he'} goes free.`) };
            }
            // The accuser fights, or hires the town's best guard to fight for them
            const foe = vic ? { p: vic, c: Ordeals._folkFighter(vic, world, 'the accuser') } : null;
            const hired = Ordeals._guards(world, s, [acc.id, vic && vic.id])[0];
            let them = foe;
            let hiredText = '';
            if (hired && (!foe || !(Ordeals._c('combat').fighterRoles || []).includes(vic.role))) {
                const fee = Utils.cents(_byType(Ordeals._c('combat').championFee, s.type) * 0.6);
                if (vic) { Townsfolk.purse(folk, vic, world); Townsfolk.purse(folk, hired.p, world); const paid = Math.min(fee, _num(vic.purse)); vic.purse = Math.round((vic.purse - paid) * 100) / 100; hired.p.purse = Math.round((hired.p.purse + paid) * 100) / 100; }
                them = { p: hired.p, c: Ordeals._folkFighter(hired.p, world, 'champion of the accuser') };
                hiredText = ` ${_pname(hired.p)} fights for ${vic ? c.victim.name : 'the town'}.`;
            }
            if (!them) them = { p: null, c: Ordeals._courtChampion(s.type) };
            const r = Duels.autoResolve(accF, them.c, { mode: Ordeals._c('combat').mode || 'toDeath', rounds: _num(Ordeals._c('combat').rounds, 24), rng: Utils.seededRandom((_hash(`${_seed(world)}|${key}|bout`) % 233279) + 1) });
            caseBout = Ordeals._boutOf(r, name, them.c.name);
            cleared = !!r.playerWon;
            const loser = cleared ? them.p : acc;
            const lostHp = cleared ? r.bHp : r.aHp;
            let dead = '';
            if (loser && !(lostHp > 0) && Ordeals._u(world, `${key}|fell`) < _num(Ordeals._c('combat').deathChance, 0.55)) {
                Townsfolk.slay(folk, loser, day, 'a trial by combat', world);
                dead = ` ${_pname(loser)} died of it.`;
            } else if (loser) Townsfolk.injure(loser, day, 3, 30);
            text = `${name} fights for ${acc.gender === 'female' ? 'her' : 'his'} innocence before ${c.town}.${hiredText} ${cleared ? `${name} wins: God has spoken.` : `${name} goes down.`}${dead}`;
            if (!cleared && acc.died != null) {
                // (the accused died on the field: the case is closed by it)
                c.ordeal = { method: 'combat', guilty: true, dead: true, text };
                player.trials.cases = player.trials.cases.filter(x => x !== c);
                Ordeals._log(player, world, text);
                return { success: true, text, cleared: false, dead: true };
            }
        } else if (methodId === 'compurgation') {
            const kin = [acc.spouse, ...(acc.kids || []), ...(acc.parents || [])].map(id => Townsfolk.get(folk, id)).filter(o => o && Townsfolk.isHere(o) && Townsfolk.age(o, day) >= 16);
            const friends = Townsfolk.residents(folk).filter(o => o.id !== acc.id && !kin.includes(o) && Townsfolk.age(o, day) >= 18 && Ordeals._u(world, `${key}|friend|${o.id}`) < 0.12);
            const need = Ordeals.need(s);
            const n = kin.length + friends.length;
            cleared = n >= need;
            text = `${name} brings ${n} oath-helper${n === 1 ? '' : 's'} of the ${need} the custom asks. ${cleared ? 'They swear, and the oath carries.' : 'Too few: the oath fails.'}`;
            if (cleared && c.guilty && c.proof >= 3) {
                // (perjury before your own court: it may come out, and those who swore are shamed)
                for (const o of [...kin, ...friends].slice(0, 6)) NpcMemory.remember(world, { folk, person: o }, { kind: 'perjury_shamed', player, day: day + 90 });
            }
        } else {
            // The iron, the water, the bread: on the accused (their fate a hash of the case)
            const who = { luck: 5, strength: acc.role === 'guard' || acc.role === 'blacksmith_npc' ? 7 : 5, swim: 0, karma: c.guilty ? -20 : 10 };
            const odds = Ordeals.chance(methodId, who, c.proof, false);
            cleared = Ordeals._u(world, `${key}|${methodId}`) < odds;
            NpcMemory.remember(world, { folk, person: acc }, { kind: 'put_to_ordeal', player, kin: true });
            if (methodId === 'iron') Townsfolk.injure(acc, day, 4, 20);
            const M = Ordeals.method(methodId);
            text = `${name} is put to the ${M.name.replace(/^Ordeal of (the )?/i, '').toLowerCase()} before ${c.town}: ${cleared ? 'cleared by God\'s judgement' : 'found guilty by it'}.${Ordeals._creedCost(player, methodId)}`;
        }
        c.ordeal = { method: methodId, guilty: !cleared, text };
        if (cleared) Ordeals._falseAccuser(player, world, c, folk, acc, vic);
        Ordeals._log(player, world, text);
        return { success: true, text, cleared, bout: caseBout, scene: { method: methodId, who: name, cleared } };
    },

    /** The duel panel's result: you fought the accused as your court's champion. */
    settleCaseCombat(player, world, caseId, outcome) {
        const c = Ordeals._caseOf(player, caseId);
        if (!c || !c.ordeal || !c.ordeal.pending || !outcome) return { success: false, reason: 'There is no such fight.' };
        const { folk, acc, vic } = Ordeals._casePeople(world, c);
        const them = acc ? { kind: 'folk', ref: acc, folk, name: c.accused.name } : { kind: 'profile', name: c.accused.name };
        const a = Ordeals._aftermath(player, world, outcome, { kind: 'player', name: 'you' }, them, `case${c.id}`);
        // (you are the accuser's side: your win is the accused's guilt)
        const cleared = !a.cleared;
        const text = `${a.cleared ? `You beat ${c.accused.name} in the lists: guilty, by God's judgement.` : `${c.accused.name} beats you before the whole of ${c.town}: innocent, by God's judgement.`}${a.parts.length ? ` (${a.parts.join('; ')}.)` : ''}`;
        const dead = acc && acc.died != null;
        c.ordeal = { method: 'combat', guilty: !cleared, dead, text };
        if (dead) player.trials.cases = player.trials.cases.filter(x => x !== c);
        if (cleared) Ordeals._falseAccuser(player, world, c, folk, acc, vic);
        Ordeals._log(player, world, text);
        return { success: true, text, cleared, dead };
    },

    /** Cleared by God's judgement: the accuser pays the cleared for the false accusation. */
    _falseAccuser(player, world, c, folk, acc, vic) {
        if (!vic || !acc || !folk) return;
        const fine = _num(Ordeals._c('outcome').falseAccusation, 8);
        Townsfolk.purse(folk, vic, world);
        Townsfolk.purse(folk, acc, world);
        const paid = Math.min(fine, Math.max(0, _num(vic.purse)));
        vic.purse = Math.round((vic.purse - paid) * 100) / 100;
        acc.purse = Math.round((acc.purse + paid) * 100) / 100;
        Townsfolk.note(vic, _day(world), 'shamed', acc.id, 'a false accusation');
        NpcMemory.remember(world, { folk, person: vic }, { kind: 'ordeal_shamed', player });
    },

    /**
     * Read by Trials.rule: an ordeal's judgement heeded is believed by the
     * faith's weight; a right demanded and refused costs the town's regard.
     * Mutates fx (the verdict's effects).
     */
    adjustFx(world, c, verdictId, fx, player = null) {
        if (!c || !fx) return fx;
        const O = Ordeals._c('outcome');
        const add = (src, mult) => {
            for (const [k, v] of Object.entries(src || {})) {
                if (k === 'court' && _obj(v)) { fx.court = fx.court || {}; for (const [ax, n] of Object.entries(v)) fx.court[ax] = _num(fx.court[ax]) + _num(n) * mult; } else if (typeof v === 'number') fx[k] = _num(fx[k]) + v * mult;
            }
        };
        if (c.ordeal && !c.ordeal.pending) {
            const heeds = c.ordeal.guilty ? verdictId !== 'acquit' : verdictId === 'acquit';
            if (heeds) add(O.heeded, Ordeals.belief(world, c.kingdomId));
            else add(O.deniedRight, Ordeals.belief(world, c.kingdomId));
        } else if (c.demand && verdictId !== 'acquit') {
            add(O.deniedRight, 1);
            if (player && world) {
                const { folk, acc } = Ordeals._casePeople(world, c);
                if (acc) NpcMemory.remember(world, { folk, person: acc }, { kind: 'denied_justice', player });
            }
        }
        return fx;
    },

    // ══════════════════════════════════════════════
    // A KINSMAN ACCUSED
    // ══════════════════════════════════════════════

    _kinCourt(player, world) {
        const here = _town(world, player.q, player.r);
        if (here && here.kingdom != null) return { s: here, q: player.q, r: player.r };
        if (!world || typeof world.getSettlementViews !== 'function') return null;
        let best = null;
        let bd = Infinity;
        for (const s of world.getSettlementViews()) {
            if (!s || s.kingdom == null || !Number.isFinite(s.q)) continue;
            const d = Math.abs(s.q - _num(player.q)) + Math.abs(s.r - _num(player.r));
            if (d < bd) { bd = d; best = s; }
        }
        return best ? { s: best, q: best.q, r: best.r } : null;
    },

    _kinDay(player, world, out) {
        const st = Ordeals.state(player);
        const K = Ordeals._c('kin');
        const day = _day(world);
        if (st.kin) {
            if (day >= st.kin.day) {
                const r = Ordeals.kinAct(player, world, 'court');
                if (r.success) out.notices.push({ icon: '⚖️', title: r.guilty ? 'Your Kin Condemned' : 'Your Kin Cleared', text: r.text, type: r.guilty ? 'warning' : 'success' });
            }
            return;
        }
        const yearDays = 120;
        for (const c of player.children || []) {
            if (!c || c.isAlive === false || c.isSibling || _num(c.age) < _num(K.minAge, 16)) continue;
            if (c.away || (c.heirPath && c.heirPath.away)) continue;
            const traits = (c.traits || []).map(t => (t && t.id) || t);
            const mult = traits.some(t => (K.traits || []).includes(t)) ? _num(K.traitMult, 2) : 1;
            if (!(Ordeals._u(world, `kin|${c.id}|${day}`) < _num(K.perYear, 0.05) / yearDays * mult)) continue;
            const court = Ordeals._kinCourt(player, world);
            if (!court) return;
            const crimes = Object.entries(K.crimes || {});
            const total = crimes.reduce((a, [, d]) => a + _num(d.weight, 1), 0) || 1;
            let x = Ordeals._u(world, `kin|${c.id}|${day}|crime`) * total;
            let crime = crimes[0] && crimes[0][0];
            for (const [id, d] of crimes) { x -= _num(d.weight, 1); if (x < 0) { crime = id; break; } }
            const def = (K.crimes || {})[crime] || { label: 'a wrong' };
            const folk = _folkOf(court.s);
            const pool = folk ? Townsfolk.residents(folk).filter(p => Townsfolk.age(p, day) >= 18) : [];
            const accuser = pool.length ? pool[_hash(`${day}|${c.id}|accuser`) % pool.length] : null;
            const proof = 1 + (_hash(`${day}|${c.id}|proof`) % 3);
            st.kin = {
                id: st.next++, childId: c.id, name: c.firstName, gender: c.gender, crime, label: def.label, proof, opened: day, day: day + _num(K.days, 6),
                town: court.s.name || 'the town', q: court.q, r: court.r, type: court.s.type || 'town', kingdomId: court.s.kingdom,
                accuser: accuser ? { pid: accuser.id, name: _pname(accuser) } : null,
                guilty: Ordeals._u(world, `kin|${c.id}|${day}|truth`) < _num((K.guiltByProof || {})[String(proof)], 0.6),
            };
            const text = `${c.firstName} stands accused of ${def.label} at ${st.kin.town}${accuser ? `, by ${st.kin.accuser.name}` : ''}. The court sits on day ${st.kin.day} (Family → Courts & Lawsuits).`;
            out.notices.push({ icon: '⚖️', title: 'Your Kin Accused', text, type: 'warning' });
            Interrupts.raise(world, { reason: `${c.firstName} is accused of ${def.label}`, icon: '⚖️', source: 'ordeals' });
            Ordeals._log(player, world, text);
            return;
        }
    },

    /** Options for the kin case: [{ id, name, icon, desc, ok, why, fee? }] */
    kinOptions(player, world) {
        const k = Ordeals.state(player).kin;
        if (!k) return [];
        const out = [{ id: 'court', name: 'Let the court decide', icon: '⚖️', desc: `The evidence: ${['', 'one word against another', 'witnesses', 'caught in the act'][k.proof] || 'some'}. Your House's name weighs with the judge.`, ok: true }];
        for (const id of Object.keys(Ordeals._c('methods'))) {
            const M = Ordeals.method(id);
            const a = Ordeals.allowed(world, k.kingdomId, id);
            if (id === 'combat') {
                const here = player.q === k.q && player.r === k.r;
                out.push({ id: 'champion', name: `Stand as ${k.name}'s champion`, icon: '⚔️', desc: 'Fight in person against the accuser\'s champion', ok: a.ok && here, why: a.ok ? `You must be at ${k.town}.` : a.why });
                for (const ch of Ordeals.champions(player, world, k).filter(x => !x.self)) out.push({ id: `hire:${ch.id}`, name: `Hire ${ch.name} as champion`, icon: '🛡️', desc: ch.desc, fee: ch.fee, ok: a.ok && _num(player.gold) >= ch.fee, why: a.ok ? 'You cannot pay the fee.' : a.why });
                continue;
            }
            out.push({ id, name: M.name, icon: M.icon, desc: M.desc, ok: a.ok, why: a.why });
        }
        return out;
    },

    /**
     * Answer for your kinsman. how: 'court' | 'champion' (→ { duel }, then
     * settleKinCombat) | 'hire:<champId>' | 'iron' | 'water' | 'bread' |
     * 'compurgation'. → { success, text, guilty }
     */
    kinAct(player, world, how) {
        const st = Ordeals.state(player);
        const k = st.kin;
        if (!k) return { success: false, reason: 'None of your kin stands accused.' };
        const child = (player.children || []).find(c => c && c.id === k.childId);
        if (!child || child.isAlive === false) { st.kin = null; return { success: true, text: 'The case falls: there is no one left to try.', guilty: false }; }
        const K = Ordeals._c('kin');
        const key = `kin${k.id}`;
        if (how === 'court') {
            const pr = player.house ? _num(player.house.prestige) / _num(K.prestigeDiv, 200) : 0;
            const p = _clamp(_num((K.guiltByProof || {})[String(k.proof)], 0.6) - pr * 0.3 + (k.guilty ? 0.1 : -0.1), 0.05, 0.95);
            return Ordeals._kinVerdict(player, world, child, Ordeals._u(world, `${key}|court`) < p, `The court of ${k.town} hears the case against ${k.name}.`);
        }
        const M = Ordeals.method(how.startsWith('hire') || how === 'champion' ? 'combat' : how);
        const a = Ordeals.allowed(world, k.kingdomId, M.id);
        if (!a.ok) return { success: false, reason: a.why };
        if (how === 'champion') {
            if (player.q !== k.q || player.r !== k.r) return { success: false, reason: `You must be at ${k.town}.` };
            const foe = Ordeals.accuserChampion(world, k);
            k.pending = { foe: { name: foe.name, pid: foe.pid } };
            return { success: true, duel: Ordeals.duelSpec(Duels.fromPlayer(player), foe.combatant, '⚔️ Champion of Your Blood', `You stand for <b>${k.name}</b> before the court of ${k.town}. ${foe.name} fights for the accuser.`) };
        }
        if (how.startsWith('hire:')) {
            const us = Ordeals._ourSide(player, world, k, how.slice(5));
            if (us.error) return { success: false, reason: us.error };
            const foe = Ordeals.accuserChampion(world, k, [us.ref && us.ref.id]);
            Ordeals._payChampion(player, world, us);
            const outcome = Duels.autoResolve(us.combatant, foe.combatant, { mode: Ordeals._c('combat').mode || 'toDeath', rounds: _num(Ordeals._c('combat').rounds, 24) });
            const af = Ordeals._aftermath(player, world, outcome, us, Ordeals._theirSide(world, k, foe), key);
            const r = Ordeals._kinVerdict(player, world, child, !af.cleared, `${us.name} fights for ${k.name} against ${foe.name}: ${af.cleared ? 'and wins' : 'and loses'}${af.parts.length ? ` (${af.parts.join('; ')})` : ''}.`);
            r.bout = Ordeals._boutOf(outcome, us.name, foe.name);
            return r;
        }
        if (how === 'compurgation') {
            const need = Ordeals.need(k);
            const helpers = Ordeals.oathHelpers(player, world, k).filter(h => !(h.type === 'kin' && h.id === child.id));
            const sworn = Ordeals._swear([{ type: 'player', name: player.name || 'you', warmth: 1 }, ...helpers]);
            if (sworn.length >= need && k.proof >= 3) Ordeals._perjuryRisk(player, world, sworn.filter(h => h.type !== 'player'), k);
            const r = Ordeals._kinVerdict(player, world, child, sworn.length < need, `${sworn.length} of the ${need} oath-helpers needed swear for ${k.name}.`);
            r.scene = { method: 'compurgation', who: k.name, cleared: sworn.length >= need, n: sworn.length, need };
            return r;
        }
        const who = { luck: 5, strength: 5, swim: 0, karma: k.guilty ? -10 : 10 };
        const ok = Ordeals._u(world, `${key}|${how}`) < Ordeals.chance(how, who, k.proof, k.priestPaid);
        Ordeals.state(player).stats.ordeals++;
        Raising._addBond(child, -3);
        const hurt = how === 'iron' ? Ordeals._burnChild(child, world, !ok, k.town) : how === 'water' ? Ordeals._halfDrown(child) : '';
        const r = Ordeals._kinVerdict(player, world, child, !ok, `${k.name} is put to the ${M.name.replace(/^Ordeal of (the )?/i, '').toLowerCase()}: ${ok ? 'and comes through it' : 'and fails it'}.${hurt}${Ordeals._creedCost(player, how)}`);
        r.scene = { method: how, who: k.name, cleared: ok };
        return r;
    },

    /**
     * The iron on a child of the House: the wound is theirs (the burned_hand
     * wound's days and name, data/ailments.json), health lost; festered, it
     * costs max health for good; it may scar. Kept on child.ordealMarks, read
     * by the child's page (Ordeals.childMarks). → text
     */
    _burnChild(child, world, festered, town) {
        const I = Ordeals._c('iron');
        const C = I.child || {};
        const def = Ailments.def(I.wound || 'burned_hand') || { name: 'Burned Hand', icon: '🔥', days: [10, 16] };
        const day = _day(world);
        const [lo, hi] = Array.isArray(def.days) ? def.days : [10, 16];
        const key = `${child.id}|${day}|burn`;
        const days = lo + (_hash(key) % Math.max(1, hi - lo + 1));
        const H = Array.isArray(C.health) ? C.health : [8, 16];
        const lost = H[0] + (_hash(`${key}|hp`) % Math.max(1, H[1] - H[0] + 1));
        child.health = Math.max(1, _num(child.health, _num(child.maxHealth, 100)) - lost);
        if (festered) child.maxHealth = Math.max(50, _num(child.maxHealth, 100) + _num(C.festeredMaxHealth, -4));
        const scar = festered || _frac(`${key}|scar`) < _num((def.permanent || {}).chance, 0.6);
        if (!Array.isArray(child.ordealMarks)) child.ordealMarks = [];
        child.ordealMarks.push({ kind: I.wound || 'burned_hand', day, heals: day + days, festered: !!festered, scar, town: town || null });
        if (child.ordealMarks.length > 6) child.ordealMarks.shift();
        const pr = child.gender === 'female' ? 'her' : 'his';
        return ` ${def.icon || '🔥'} ${def.name || 'A burned hand'}: −${lost} health, ${days} days to heal${festered ? `, and it festered: ${pr} strength is less for good (max health ${_num(C.festeredMaxHealth, -4)})` : ''}${scar ? `; it will leave a scar on ${pr} hand` : ''}.`;
    },

    _halfDrown(child) {
        const H = Ordeals._c('water').health || [4, 14];
        const lost = H[0] + (_hash(`${child.id}|water`) % Math.max(1, H[1] - H[0] + 1));
        child.health = Math.max(1, _num(child.health, _num(child.maxHealth, 100)) - lost);
        return ` Hauled up half-drowned (−${lost} health).`;
    },

    /** A child's ordeal marks as the family page tells them: [{ icon, text }] */
    childMarks(child, day) {
        const out = [];
        for (const m of (child && child.ordealMarks) || []) {
            const where = m.town ? ` at ${m.town}` : '';
            if (_num(day) < _num(m.heals)) out.push({ icon: '🔥', text: `A burned hand from the ordeal of the iron${where}${m.festered ? ', festering' : ''}: healing until day ${m.heals}` });
            else if (m.scar) out.push({ icon: '✋', text: `The scar of the hot iron on one hand${where} (day ${m.day})${m.festered ? ': it festered, and took some strength with it' : ''}` });
        }
        return out;
    },

    settleKinCombat(player, world, outcome) {
        const st = Ordeals.state(player);
        const k = st.kin;
        if (!k || !k.pending || !outcome) return { success: false, reason: 'There is no such fight.' };
        const child = (player.children || []).find(c => c && c.id === k.childId);
        const af = Ordeals._aftermath(player, world, outcome, { kind: 'player', name: 'you' }, Ordeals._theirSide(world, k, k.pending.foe), `kin${k.id}`);
        if (child) Raising._addBond(child, _num(Ordeals._c('kin').championBond, 12));
        if (!child) { st.kin = null; return { success: true, text: 'The case falls.', guilty: false }; }
        return Ordeals._kinVerdict(player, world, child, !af.cleared, `You fight for ${k.name} before ${k.town}: ${af.cleared ? 'and win' : af.yielded ? 'and cry craven' : 'and fall'}${af.parts.length ? ` (${af.parts.join('; ')})` : ''}.`);
    },

    _kinVerdict(player, world, child, guilty, lead) {
        const st = Ordeals.state(player);
        const k = st.kin;
        const K = Ordeals._c('kin');
        const day = _day(world);
        const parts = [];
        if (guilty) {
            const def = (K.crimes || {})[k.crime] || {};
            const law = k.kingdomId != null ? (Laws.punishment(world, k.kingdomId) || { fine: 1 }).fine : 1;
            const fine = Utils.cents(_num(def.fine, 15) * _num(law, 1));
            const realm = _kingdom(world, k.kingdomId);
            const paid = Math.min(fine, Utils.centsDown(Math.max(0, _num(player.gold))));
            if (paid > 0) PlayerCoin.pay(world, player, paid, realm && 'treasury' in realm ? realm : (_town(world, k.q, k.r) || { q: k.q, r: k.r }), 'fines');
            parts.push(`a fine of ${Utils.formatGold(fine)} gold${paid < fine ? ` (you could pay ${Utils.formatGold(paid)})` : ''}`);
            if (player.house) { const loss = Math.min(_num(player.house.prestige), _num(K.prestige, 6)); if (loss > 0) { House.spend(player.house, loss, `${k.name} condemned at ${k.town}`, day); parts.push(`−${loss} Prestige`); } }
            const act = k.kingdomId != null ? Maiming.judgeAct(world, k.kingdomId, k.crime) : null;
            if (act && !MaimMarks.whyNot(child, act) && MaimMarks.mark(child, act, { day, by: `the court of ${k.town}`, why: k.label })) parts.push(`and by the law of the realm, ${child.firstName} loses ${MaimMarks._shortOf(act, MaimMarks.count(child, act))}`);
        } else {
            const folk = _folkOf(_town(world, k.q, k.r));
            const acc = folk && k.accuser ? Townsfolk.get(folk, k.accuser.pid) : null;
            if (acc && Townsfolk.isHere(acc)) {
                Townsfolk.purse(folk, acc, world);
                const got = PlayerCoin.receive(world, player, _num(K.damages, 30), { purse: acc, key: 'purse' }, 'lawsuits', { strict: true });
                if (got > 0) parts.push(`${k.accuser.name} pays your House ${Utils.formatGold(got)} gold for the false accusation`);
                Townsfolk.note(acc, day, 'shamed', null, 'a false accusation');
            }
        }
        const text = `${lead} ${guilty ? `${k.name} is found guilty of ${k.label}: ${parts.join('; ')}.` : `${k.name} is cleared.${parts.length ? ` ${_cap(parts.join('; '))}.` : ''}`}`.trim();
        st.kin = null;
        Ordeals._log(player, world, text);
        if (player.house) House._chronicle(player.house, world, `${k.name} of ${player.house.name || 'the House'} stood trial at ${k.town} for ${k.label}: ${guilty ? 'guilty' : 'cleared'}.`, ['trial', 'kin']);
        return { success: true, text, guilty };
    },

    // ══════════════════════════════════════════════
    // LAWSUITS: THE WAGER OF BATTLE
    // ══════════════════════════════════════════════

    _suit(player, suitId) {
        return ((player && player.trials && player.trials.suits) || []).find(s => s.id === suitId && s.status === 'open') || null;
    },

    suitCombatOk(world, suit) {
        return !!suit && suit.status === 'open' && !suit.combat && Ordeals.allowed(world, suit.kingdomId, 'combat').ok;
    },

    /** Offer (or accept) the wager of battle in a suit; champId as for a trial. */
    suitCombat(player, world, suitId, champId) {
        const suit = Ordeals._suit(player, suitId);
        if (!suit) return { success: false, reason: 'There is no such suit.' };
        const a = Ordeals.allowed(world, suit.kingdomId, 'combat');
        if (!a.ok) return { success: false, reason: a.why };
        if (suit.combat) return { success: false, reason: 'The suit is settled by battle already.' };
        const rival = RivalHouses.rival(player, suit.rivalId);
        if (!rival || !rival.head) return { success: false, reason: 'There is no one to fight.' };
        const D = Ordeals._c('demand').rival || {};
        const honour = _num(rival.head.persona && rival.head.persona.honour, 5);
        if (!suit.combatDemand && honour < _num(D.minHonour, 4) && _num(rival.head.martial, 5) < _num(D.mightAt, 6)) {
            suit.combatRefused = true;
            rival.renown = Math.max(0, _num(rival.renown) - 3);
            return { success: true, text: `${RivalHouses.headName(rival)} will not put the suit to the sword: it goes to the judge. (Their name suffers a little for it.)` };
        }
        const champ = Ordeals._rivalChampion(rival);
        const foe = champ.combatant;
        const us = Ordeals._ourSide(player, world, suit, champId);
        if (us.error) return { success: false, reason: us.error };
        if (us.kind === 'player') {
            suit.combat = { pending: true, champ: champId, sworn: !!champ.them.sworn };
            return { success: true, duel: Ordeals.duelSpec(us.combatant, foe, '⚔️ The Wager of Battle', `<b>${champ.label}</b> fights for ${suit.rivalName} before ${suit.town}. The suit goes with the victor.`) };
        }
        Ordeals._payChampion(player, world, us);
        const outcome = Duels.autoResolve(us.combatant, foe, { mode: Ordeals._c('combat').mode || 'toDeath', rounds: _num(Ordeals._c('combat').rounds, 24) });
        const r = Ordeals._settleSuitBout(player, world, suit, outcome, us, rival, champ.them);
        r.bout = Ordeals._boutOf(outcome, us.name, champ.label);
        return r;
    },

    settleSuitCombat(player, world, suitId, outcome) {
        const suit = Ordeals._suit(player, suitId);
        if (!suit || !suit.combat || !suit.combat.pending || !outcome) return { success: false, reason: 'There is no such fight.' };
        const rival = RivalHouses.rival(player, suit.rivalId);
        const them = rival ? { kind: 'rival', ref: rival, name: suit.combat.sworn ? _cap(`the sworn sword of ${rival.name}`) : RivalHouses.headName(rival), sworn: !!suit.combat.sworn } : null;
        return Ordeals._settleSuitBout(player, world, suit, outcome, { kind: 'player', name: 'you' }, rival, them);
    },

    _settleSuitBout(player, world, suit, outcome, us, rival, them = null) {
        const name = them ? them.name : rival ? RivalHouses.headName(rival) : suit.rivalName;
        const af = Ordeals._aftermath(player, world, outcome, us, them || { kind: 'rival', name }, `suit${suit.id}`);
        const plaintiffWon = af.cleared === (suit.plaintiff === 'player');
        suit.combat = { done: true, plaintiffWon, won: af.cleared };
        if (rival) {
            if (!Array.isArray(rival.memory)) rival.memory = [];
            rival.memory.push({ kind: af.cleared ? 'duelYouWon' : 'duelYouLost', day: _day(world), w: af.cleared ? -4 : 2, note: 'the wager of battle' });
            if (rival.memory.length > 14) rival.memory.splice(0, rival.memory.length - 14);
        }
        const text = `${us.kind === 'player' ? 'You' : us.name} and ${name} fight for the suit before ${suit.town}: ${af.cleared ? 'your side wins' : 'their side wins'}${af.parts.length ? ` (${af.parts.join('; ')})` : ''}.`;
        Ordeals._log(player, world, text);
        return { success: true, resolveSuit: true, text };
    },

    /** Refuse a rival's demand of battle: Prestige, and the rival remembers. */
    refuseSuitCombat(player, world, suitId) {
        const suit = Ordeals._suit(player, suitId);
        if (!suit || !suit.combatDemand || suit.combat) return { success: false, reason: 'No one demands battle of you.' };
        suit.combatDemand = false;
        suit.combatRefused = true;
        const n = _num((Ordeals._c('demand').rival || {}).refusePrestige, 8);
        let loss = 0;
        if (player.house) { loss = Math.min(_num(player.house.prestige), n); if (loss > 0) House.spend(player.house, loss, `refused ${suit.rivalName}'s wager of battle`, _day(world)); }
        const rival = RivalHouses.rival(player, suit.rivalId);
        if (rival) RivalHouses._note(rival, world, 'Demanded the wager of battle; you refused it.', 'gloat');
        return { success: true, text: `You refuse the wager of battle. The suit goes to the judge, and the realm says your House fears the sword.${loss ? ` −${loss} Prestige.` : ''}` };
    },

    _suitsDay(player, world, out) {
        const D = Ordeals._c('demand').rival || {};
        const day = _day(world);
        for (const suit of (player.trials && player.trials.suits) || []) {
            if (suit.status !== 'open' || suit.combat) continue;
            if (suit.combatDemand && day >= _num(suit.hearing)) {
                const r = Ordeals.refuseSuitCombat(player, world, suit.id);
                if (r.success) out.notices.push({ icon: '⚔️', title: 'The Wager Unanswered', text: `You never answered ${suit.rivalName}'s demand of battle. ${r.text}`, type: 'warning' });
                continue;
            }
            if (suit.combatAsked || suit.combatRefused) continue;
            suit.combatAsked = true;
            const rival = RivalHouses.rival(player, suit.rivalId);
            if (!rival || !rival.head || !Ordeals.allowed(world, suit.kingdomId, 'combat').ok) continue;
            const honour = _num(rival.head.persona && rival.head.persona.honour, 5);
            if (_num(rival.head.martial, 5) < _num(D.mightAt, 6) || honour < _num(D.minHonour, 4)) continue;
            if (!(Ordeals._u(world, `suitDemand|${suit.id}|${suit.rivalId}`) < _num(D.chance, 0.5))) continue;
            suit.combatDemand = true;
            const text = `${RivalHouses.headName(rival)} demands that the suit over ${String(suit.kind)} be settled by the wager of battle, as the law of the realm allows. Answer before the hearing on day ${suit.hearing} (Family → Courts & Lawsuits).`;
            out.notices.push({ icon: '⚔️', title: 'A Wager of Battle', text, type: 'warning' });
            Interrupts.raise(world, { reason: `${RivalHouses.headName(rival)} demands trial by combat`, icon: '⚔️', source: 'ordeals' });
        }
    },

    // ══════════════════════════════════════════════
    // A CHAMPION FOR HIRE
    // ══════════════════════════════════════════════

    _callsDay(player, world, out) {
        const st = Ordeals.state(player);
        const H = Ordeals._c('hire');
        const day = _day(world);
        st.calls = st.calls.filter(c => day <= c.expires);
        if (st.calls.length || player.jailState) return;
        const s = _town(world, player.q, player.r);
        const folk = _folkOf(s);
        if (!s || !folk || s.kingdom == null || !Ordeals.allowed(world, s.kingdom, 'combat').ok) return;
        const mult = Math.min(_num(H.maxMult, 2.5), 1 + st.stats.wins * _num(H.perWin, 0.15));
        if (!(Ordeals._u(world, `call|${player.q},${player.r}|${day}`) < _byType(H.perDay, s.type) * mult)) return;
        const live = Townsfolk.residents(folk).filter(p => Townsfolk.age(p, day) >= 18 && p.role !== 'guard');
        if (!live.length) return;
        const client = live[_hash(`${day}|call|client`) % live.length];
        const crimes = H.crimes || ['theft'];
        const crime = crimes[_hash(`${day}|call|crime`) % crimes.length];
        const side = _hash(`${day}|call|side`) % 3 === 0 ? 'accuser' : 'accused';
        const foe = Ordeals.accuserChampion(world, { q: player.q, r: player.r, town: s.name, type: s.type }, [client.id]);
        Townsfolk.purse(folk, client, world);
        const fee = Utils.cents(Math.min(Math.max(1, _num(client.purse)), _byType(H.fee, s.type) * (1 + st.stats.wins * _num(H.feePerWin, 0.1))));
        const crimeLabel = ((((DataLoader._gamedata || {}).trials || {}).judge || {}).crimes || {})[crime];
        st.calls.push({ id: st.next++, day, expires: day + _num(H.expireDays, 4), q: player.q, r: player.r, town: s.name, type: s.type, kingdomId: s.kingdom, clientPid: client.id, client: _pname(client), gender: client.gender, crime, crimeLabel: (crimeLabel && crimeLabel.label) || crime, side, fee, foe: { name: foe.name, pid: foe.pid } });
        out.notices.push({ icon: '🛡️', title: 'A Champion Wanted', text: `${_pname(client)} of ${s.name}, ${side === 'accused' ? 'accused of' : 'bringing a charge of'} ${(crimeLabel && crimeLabel.label) || crime}, seeks a champion for the lists: ${Utils.formatGold(fee)} gold if you win (Family → Courts & Lawsuits).`, type: 'info' });
    },

    /** Take up a call: the duel to fight. → { success, duel } */
    takeCall(player, world, callId) {
        const st = Ordeals.state(player);
        const call = st.calls.find(c => c.id === callId);
        if (!call) return { success: false, reason: 'No one needs a champion now.' };
        if (player.q !== call.q || player.r !== call.r) return { success: false, reason: `You must be at ${call.town}.` };
        const foe = Ordeals.accuserChampion(world, call, [call.clientPid]);
        call.foe = { name: foe.name, pid: foe.pid };
        call.pending = true;
        return { success: true, duel: Ordeals.duelSpec(Duels.fromPlayer(player), foe.combatant, '🛡️ A Champion\'s Fight', `You fight for <b>${call.client}</b> before the court of ${call.town}. ${foe.name} stands for the other side.`) };
    },

    /** The duel panel's result for a champion's fight: the fee, the client's fate. */
    settleCall(player, world, callId, outcome) {
        const st = Ordeals.state(player);
        const call = st.calls.find(c => c.id === callId);
        if (!call || !call.pending || !outcome) return { success: false, reason: 'There is no such fight.' };
        st.calls = st.calls.filter(c => c !== call);
        const s = _town(world, call.q, call.r);
        const folk = _folkOf(s);
        const client = folk ? Townsfolk.get(folk, call.clientPid) : null;
        const af = Ordeals._aftermath(player, world, outcome, { kind: 'player', name: 'you' }, Ordeals._theirSide(world, call, call.foe), `call${call.id}`);
        const day = _day(world);
        const parts = [...af.parts];
        if (af.cleared) {
            if (client && Townsfolk.isHere(client)) {
                Townsfolk.purse(folk, client, world);
                const got = PlayerCoin.receive(world, player, call.fee, { purse: client, key: 'purse' }, 'tournament', { strict: true });
                if (got > 0) parts.push(`${call.client} pays you ${Utils.formatGold(got)} gold`);
                NpcMemory.remember(world, { folk, person: client }, { kind: 'championed', player, kin: true });
            }
        } else if (client && Townsfolk.isHere(client) && call.side === 'accused') {
            // The client takes the sentence
            parts.push(Ordeals._sentenceFolk(player, world, s, folk, client, call));
        }
        const text = `${af.cleared ? `You win the fight for ${call.client}.` : `You lose the fight for ${call.client}.`} ${parts.filter(Boolean).join('; ')}.`.replace(/\s+\./, '.');
        Ordeals._log(player, world, text);
        return { success: true, text, won: af.cleared };
    },

    /** A townsperson condemned by a lost trial by combat: the rope, the hand, or the cells. → text */
    _sentenceFolk(player, world, s, folk, p, call) {
        const day = _day(world);
        const name = _pname(p);
        if (call.crime === 'murder' || call.crime === 'arson') {
            // (a court of yours sends the condemned to your list for the scaffold: systems/executions.js; another's hangs them)
            const yours = Petitions.holdingContexts(player, world).some(h => h.q === call.q && h.r === call.r);
            if (yours && Executions.enabled()) {
                const e = Executions.condemn(player, world, { kind: 'folk', q: call.q, r: call.r, pid: p.id }, { crime: call.crime, crimeLabel: call.crimeLabel, source: 'trial by combat', guilty: true, quiet: true });
                if (e) return `${name} is condemned, and waits on your word for the scaffold`;
            }
            Townsfolk.slay(folk, p, day, 'the gallows', world);
            return `${name} hangs for it`;
        }
        const act = call.kingdomId != null ? Maiming.judgeAct(world, call.kingdomId, call.crime) : null;
        if (act) {
            // (the court's knife, not yours: the body marked, no brand on you)
            if (!MaimMarks.whyNot(p, act) && MaimMarks.mark(p, act, { day, by: `the court of ${call.town}`, why: call.crimeLabel })) {
                Townsfolk.injure(p, day, 3, 10);
                return `${name} loses ${MaimMarks._shortOf(act, MaimMarks.count(p, act))} by the law of the realm`;
            }
        }
        p.jailedUntil = day + 20;
        Townsfolk.note(p, day, 'jailed', null, call.crimeLabel);
        return `${name} goes to the cells`;
    },

    // ── The day ───────────────────────────────────────

    /**
     * Each day (ui/game/endDay.js, before the courts): perjury coming out, a
     * kinsman accused or tried, rivals demanding battle, a champion wanted.
     * Hash rolls only. → { notices }
     */
    processDay(world, player = null) {
        const out = { notices: [] };
        if (!player || !world || !Ordeals.enabled()) return out;
        const st = Ordeals.state(player);
        const day = _day(world);
        for (const pj of st.perjuries.filter(x => day >= x.surface)) Ordeals._surfacePerjury(player, world, pj, out);
        st.perjuries = st.perjuries.filter(x => day < x.surface);
        Ordeals._kinDay(player, world, out);
        Ordeals._suitsDay(player, world, out);
        Ordeals._callsDay(player, world, out);
        return out;
    },

    // ── For the panel ────────────────────────────────

    view(player, world) {
        const st = Ordeals.state(player);
        const here = _town(world, player.q, player.r);
        return {
            kin: st.kin, kinOptions: Ordeals.kinOptions(player, world), calls: st.calls, stats: st.stats,
            perjuries: st.perjuries.length, history: st.history.slice().reverse(),
            here: here && here.kingdom != null ? { town: here.name, ...Ordeals.customsView(world, here.kingdom) } : null,
        };
    },
};

// (the odds word for an ordeal's chance)
export function ordealOddsWord(p) {
    return p >= 0.7 ? 'likely to clear you' : p >= 0.5 ? 'a fair chance' : p >= 0.3 ? 'against you' : 'all but sure to condemn you';
}
