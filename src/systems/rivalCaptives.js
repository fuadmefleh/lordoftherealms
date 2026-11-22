// ============================================
// RIVAL CAPTIVES — a rival House's children in your power
// ============================================
// The rival Houses (systems/rivalHouses.js) could harm your blood; now you can
// take theirs.
//
//   TAKEN     beat their retinue on the road — fall on it, or beat off its
//             ambush — and a grown child of the head riding with it may be
//             taken (a hash roll; the heir rides with the head more often
//             than not). A rival's ward at your court that you keep as a
//             hostage, or hold in a war (systems/heirPaths.js / raising.js),
//             is in your power too.
//   HELD      each month the feud grows, the House may get them back (a
//             rescue, a hash roll) and offers a ransom now and then. While
//             a child of theirs is held whole, the House dares not plot
//             against you or ride out to waylay you (RivalHouses.hostsChild).
//   RANSOMED  their House pays out of its own purse into yours.
//   RELEASED  for nothing: the feud cools, renown and mercy.
//   MAIMED    (🔪 The Knife, systems/maiming.js) the House becomes a blood
//             enemy: the feud runs to the top, its allies take it up, a
//             nemesis may rise; a blinded, slit-nosed, tongueless, gelded or
//             handless heir can never head the House (RivalHouses.heirOf
//             passes them by); your court's lords think the less of you; and
//             the House owes you blood (rival.maimOwed): its hired blades come
//             for your children (Maiming._enemiesWeek) and its waylaying men
//             take the same from you if they beat you (Maiming.roadMaim).
//   THE AI    a rival House holding a child of yours as a hostage, with a hot
//             feud and its terms refused (or blood owed), may maim the child.
//
// The body is the rival head's own child record (rival.head.children[i],
// saved with the House); the captive record (player.maiming.captives, saved
// with the maiming state) keeps only its uid: when the head dies the captive
// stays in the new head's household (or heads the House from your keeping).
// SEIZED under guest-right (an audience, a visit, your own table): a grave
// crime every House, realm and faith hears of. In your keeping they age, come
// of age, and may die (sickness, despair, a rescue gone wrong).
// Explicit params; hash rolls only.
// Content: data/maiming.json → rivals.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Interrupts } from '../core/interrupts.js';
import { MaimMarks } from './maimMarks.js';
import { House } from './house.js';
import { Ledger } from './ledger.js';
import { Traits } from './traits.js';
import { Nemesis } from './nemesis.js';
import { MaimFaith } from './maimFaith.js';
import { Atrocities } from './atrocities.js';
import { Devotion } from './devotion.js';
import { NPCLords } from '../world/npcLords.js';
// (run time only)
import { RivalHouses } from './rivalHouses.js';
import { Maiming } from './maiming.js';
import { Raising } from './raising.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = (world) => _num(world && world.day);

function _hash(s) {
    let h = Utils.hashStr(String(s)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
}

function _roll(world, key) {
    const seed = (world && world.generationParams && world.generationParams.seed) || 0;
    return (_hash(`${seed}|rivalCaptives|${key}`) % 100000) / 100000;
}

function _pickW(pool, u) {
    const e = Object.entries(pool || {}).filter(([, w]) => _num(w) > 0);
    const total = e.reduce((s, [, w]) => s + _num(w), 0);
    let x = u * total;
    for (const [id, w] of e) { x -= _num(w); if (x < 0) return id; }
    return e.length ? e[e.length - 1][0] : null;
}

const DEFAULTS = {
    capture: { minAge: 12, chance: 0.45, heirShare: 0.6, feud: 15 },
    hold: { monthlyFeud: 3, rescueMonthly: 0.04, offerEvery: 60, offerDays: 30 },
    ransom: { base: 180, heir: 2, head: 4, purseShare: 0.4, headPurseShare: 0.75, barred: 0.4, feud: 10 },
    seize: { base: 0.2, perStealth: 4, feastBonus: 0.25, feastMaxFeud: 70, min: 0.1, max: 0.9, failShare: 0.5, failFeud: 40, allyFeud: 40, othersFeud: 20, enemyFeud: 5, karma: 15, deceit: 3, cruelty: 1, perfidy: 15, repHome: 20, repAll: 5, clergy: 10, faithLoss: 0.5, nemesis: 70 },
    death: { sickMonthly: 0.004, despairPerYear: 0.002, maimedMult: 3, youngMult: 1.5, rescueGoneWrong: 0.25, feud: 50, rescueFeud: 20, nemesis: 75 },
    release: { feud: -20, renown: 3, mercy: 2 },
    maim: { feud: 100, allyFeud: 25, othersFeud: 10, enemyFeud: -5, courtGrudge: 4, renownLoss: 20, nemesis: 85, owedDays: 1800 },
    hostage: { feud: 90, minRefused: 1, weekly: 0.03, pool: { eye: 3, hand: 2, nose: 2, ear: 1 } },
    owedWeekly: 0.08,
};

const he = (g) => (g === 'female' ? 'she' : 'he');
const him = (g) => (g === 'female' ? 'her' : 'him');
const _cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export const RivalCaptives = {
    DEFAULTS,

    config() {
        const d = _obj(DataLoader._gamedata && DataLoader._gamedata.maiming && DataLoader._gamedata.maiming.rivals) || {};
        const out = { ...DEFAULTS };
        for (const k of Object.keys(DEFAULTS)) if (_obj(DEFAULTS[k])) out[k] = { ...DEFAULTS[k], ...(_obj(d[k]) || {}) };
        if (d.owedWeekly != null) out.owedWeekly = _num(d.owedWeekly, DEFAULTS.owedWeekly);
        return out;
    },

    /** The captives you hold (player.maiming.captives). */
    list(player) {
        if (!player) return [];
        const st = Maiming.state(player);
        if (!Array.isArray(st.captives)) st.captives = [];
        return st.captives;
    },

    rivalOf(player, cap) {
        const rivals = player && player.house && player.house.rivals;
        return cap && rivals ? rivals[cap.rivalId] || null : null;
    },

    _uid(rival, c) {
        if (!c.uid) c.uid = `rc:${rival.houseKey || rival.kingdomId}:${c.firstName}:${_num(c.age)}`;
        return c.uid;
    },

    /**
     * The captive's body: always the living House record (the head, or one of
     * the head's household — a sibling carried over when a head dies). null
     * when the House no longer has them (dead, or the House gone).
     */
    body(player, cap) {
        return RivalHouses.childByUid(RivalCaptives.rivalOf(player, cap), cap && cap.uid);
    },

    /** Is the captive the head of their House now (it passed to them while you held them)? */
    isHead(player, cap) {
        const rival = RivalCaptives.rivalOf(player, cap);
        const c = RivalCaptives.body(player, cap);
        return !!rival && !!c && rival.head === c;
    },

    nameOf(rival, c) {
        return `${c.firstName || 'A child'} ${RivalHouses.surname(rival) || ''}`.trim();
    },

    /** Is this rival child the House's heir (the one who would head it now)? */
    isHeir(rival, c) {
        return !!rival && !!c && RivalHouses.heirOf(rival, { any: true }) === c;
    },

    /** Does the player hold a child of this House whole (leverage: they dare not strike)? */
    holdsWhole(player, rival) {
        return !!rival && RivalCaptives.list(player).some(cap => String(cap.rivalId) === String(rival.kingdomId) && !MaimMarks.any(RivalCaptives.body(player, cap) || {}));
    },

    // ── Taken ─────────────────────────────────────────────

    /** The grown children riding with the retinue who could be taken. */
    _candidates(rival) {
        const A = RivalCaptives.config().capture;
        return ((rival && rival.head && rival.head.children) || [])
            .filter(c => c && _num(c.age) >= _num(A.minAge, 12) && !c.wed && !c.captiveOf && !c.wardOf && !c.squireWith);
    },

    /**
     * You beat their retinue (RivalHouses.onAttacked, a waylay beaten off): a
     * child riding with them may be taken. A hash roll, once a day per House.
     * → the text, or null.
     */
    onBeaten(player, world, rival) {
        if (!player || !rival || !rival.head || !Maiming.enabled()) return null;
        const A = RivalCaptives.config().capture;
        const day = _day(world);
        if (rival.captureDay === day) return null;
        rival.captureDay = day;
        const can = RivalCaptives._candidates(rival);
        if (!can.length) return null;
        const key = `${rival.houseKey || rival.kingdomId}|${day}`;
        if (_roll(world, `take|${key}`) >= _num(A.chance, 0.45)) return null;
        const heir = RivalHouses.heirOf(rival, { any: true });
        const c = heir && can.includes(heir) && _roll(world, `heir|${key}`) < _num(A.heirShare, 0.6)
            ? heir : can[_hash(`${key}|who`) % can.length];
        const cap = RivalCaptives.capture(player, world, rival, c, 'the road');
        const name = cap.name;
        return `${name}, ${heir === c ? `the heir of ${rival.name}` : `a child of ${RivalHouses.headName(rival)}`}, is pulled from the saddle and taken: ${he(c.gender)} is your captive now (🔪 The Knife).`;
    },

    /** Take a rival's child into your keeping. → the captive record. */
    capture(player, world, rival, c, how = 'the road') {
        const A = RivalCaptives.config().capture;
        const st = Maiming.state(player);
        const list = RivalCaptives.list(player);
        const day = _day(world);
        st.nextCaptive = _num(st.nextCaptive, 1);
        const cap = {
            id: st.nextCaptive++, rivalId: rival.kingdomId, uid: RivalCaptives._uid(rival, c), name: RivalCaptives.nameOf(rival, c),
            gender: c.gender === 'female' ? 'female' : 'male', day, how, heirWhenTaken: RivalCaptives.isHeir(rival, c), offer: null, lastMonth: day,
            grown: _num(c.age) >= _num(RivalHouses.config().life.comeOfAge, 16),
        };
        c.captiveOf = 'player';
        list.push(cap);
        House.accrueRivalFeud(player, world, rival.kingdomId, _num(A.feud, 15), `${c.firstName} taken`);
        RivalHouses.remember(rival, world, 'captured', c.firstName);
        RivalHouses._note(rival, world, `Lost ${c.firstName} to your men on ${how}.`, 'attacked');
        if (player.house) House._chronicle(player.house, world, `${player.name || 'The head of the House'} took ${cap.name} of ${rival.name} captive on ${how}.`, ['rival', 'captive']);
        return cap;
    },

    // ── Ransomed, released ────────────────────────────────

    /** What their House would pay to have them home. Pure. */
    ransomPrice(player, world, cap) {
        const R = RivalCaptives.config().ransom;
        const rival = RivalCaptives.rivalOf(player, cap);
        const c = RivalCaptives.body(player, cap);
        if (!rival || !c) return 0;
        let want = _num(R.base, 180) * (rival.head === c ? _num(R.head, 4) : RivalCaptives.isHeir(rival, c) ? _num(R.heir, 2) : 1);
        if (MaimMarks.barsRule(c)) want *= _num(R.barred, 0.4);
        if (cap.offer && _num(cap.offer.until) >= _day(world)) want = Math.max(want, _num(cap.offer.amount));
        // (a House pays for its own head with most of what it has)
        const share = rival.head === c ? Math.max(_num(R.purseShare, 0.4), _num(R.headPurseShare, 0.75)) : _num(R.purseShare, 0.4);
        return Utils.cents(Math.max(0, Math.min(want, Math.floor(_num(rival.gold) * share))));
    },

    _free(player, world, cap) {
        const c = RivalCaptives.body(player, cap);
        if (c) c.captiveOf = null;
        const rival = RivalCaptives.rivalOf(player, cap);
        if (rival && rival.head === c) rival.headCaptive = false;
        const list = RivalCaptives.list(player);
        const i = list.indexOf(cap);
        if (i >= 0) list.splice(i, 1);
    },

    _get(player, capId) {
        return RivalCaptives.list(player).find(x => String(x.id) === String(capId)) || null;
    },

    /** Their House pays out of its purse into yours, and the captive goes home. */
    ransom(player, world, capId) {
        const cap = RivalCaptives._get(player, capId);
        if (!cap) return { success: false, reason: 'You hold no such captive.' };
        const rival = RivalCaptives.rivalOf(player, cap);
        if (!rival) { RivalCaptives._free(player, world, cap); return { success: false, reason: 'Their House is no more; no one will pay.' }; }
        const paid = RivalCaptives.ransomPrice(player, world, cap);
        if (!(paid > 0)) return { success: false, reason: `${rival.name} has nothing left to pay.` };
        rival.gold = Utils.cents(_num(rival.gold) - paid);
        player.gold = Utils.cents(_num(player.gold) + paid);
        Ledger.record(player, 'family', paid);
        House.accrueRivalFeud(player, world, rival.kingdomId, _num(RivalCaptives.config().ransom.feud, 10), `${cap.name} ransomed`);
        RivalHouses.remember(rival, world, 'ransomedKin', cap.name.split(' ')[0]);
        RivalCaptives._free(player, world, cap);
        const text = `${rival.name} pays ${Utils.formatGold(paid)} gold out of its coffers, and ${cap.name} rides home.`;
        if (player.house) House._chronicle(player.house, world, text, ['rival', 'captive']);
        return { success: true, paid, text };
    },

    /** Let them go for nothing. */
    release(player, world, capId) {
        const R = RivalCaptives.config().release;
        const cap = RivalCaptives._get(player, capId);
        if (!cap) return { success: false, reason: 'You hold no such captive.' };
        const rival = RivalCaptives.rivalOf(player, cap);
        const maimed = MaimMarks.any(RivalCaptives.body(player, cap) || {});
        const head = RivalCaptives.isHead(player, cap);
        RivalCaptives._free(player, world, cap);
        if (!rival) return { success: true, text: `${cap.name} goes free.` };
        // (a maimed child sent home is no gift)
        if (!maimed) {
            House.accrueRivalFeud(player, world, rival.kingdomId, _num(R.feud, -20) * (head ? 1.5 : 1));
            RivalHouses.remember(rival, world, 'releasedKin', cap.name.split(' ')[0]);
            player.renown = _num(player.renown) + _num(R.renown, 3);
            try { Traits.recordDeed(player, 'mercy', _num(R.mercy, 2)); } catch (e) { /* no traits */ }
        }
        const text = maimed ? `You send ${cap.name} home to ${rival.name}, what is left of ${him(cap.gender)}.` : `You send ${cap.name} home to ${rival.name} unharmed and unransomed. ${RivalHouses.headName(rival)} did not expect it: the feud cools (${_num(R.feud, -20)}), +${_num(R.renown, 3)} renown.`;
        if (player.house) House._chronicle(player.house, world, text, ['rival', 'captive', 'mercy']);
        return { success: true, text };
    },

    // ── The Knife's list ──────────────────────────────────

    /** The kept or held wards of rival Houses at your court: [{ ward, rival, body }]. */
    _heldWards(player) {
        const out = [];
        let wards = [];
        try { wards = Raising.wards(player); } catch (e) { wards = []; }
        for (const w of wards) {
            if (!w || w.rivalId == null || !(w.kept || w.held)) continue;
            const rival = Raising._rivalOf(player, w);
            const body = Raising._rivalChild(player, w);
            if (rival && body) out.push({ ward: w, rival, body });
        }
        return out;
    },

    /** For Maiming.targets: [{ id, name, rival, body, desc, ward }]. */
    targets(player, world) {
        const out = [];
        for (const cap of RivalCaptives.list(player).slice()) {
            const rival = RivalCaptives.rivalOf(player, cap);
            const body = RivalCaptives.body(player, cap);
            if (!rival || !body) { RivalCaptives._free(player, world, cap); continue; }
            const tag = MaimMarks.tag(body);
            const heir = RivalCaptives.isHeir(rival, body);
            const head = rival.head === body;
            out.push({ id: `c:${cap.id}`, cap, rival, body, name: cap.name, head, desc: `${head ? `Head of ${rival.name}, from your keeping` : heir ? `Heir of ${rival.name}` : `Of ${rival.name}`}, ${Math.floor(_num(body.age))} · taken ${cap.how === 'the road' ? 'on the road' : `at ${cap.how}`}, day ${cap.day}${cap.guestRight ? ' · guest-right broken' : ''}${tag ? ` · ${tag}` : ''}` });
        }
        for (const { ward, rival, body } of RivalCaptives._heldWards(player)) {
            const tag = MaimMarks.tag(body);
            out.push({ id: `w:${ward.id}`, ward, rival, body, name: RivalCaptives.nameOf(rival, body), desc: `${RivalCaptives.isHeir(rival, body) ? `Heir of ${rival.name}` : `Of ${rival.name}`}, ${Math.floor(_num(body.age))} · a ward at your court, ${ward.held ? 'held for the war' : 'kept as a hostage'}${tag ? ` · ${tag}` : ''}` });
        }
        return out;
    },

    /** Find a Knife target by its id ('c:<captive>' or 'w:<ward>'). */
    target(player, world, id) {
        return RivalCaptives.targets(player, world).find(t => t.id === String(id)) || null;
    },

    // ── Maimed ────────────────────────────────────────────

    /** The deed (🔪 The Knife, Maiming.act kind 'rival'). → { ok, text, reason, brand } */
    maim(player, world, id, act) {
        const t = RivalCaptives.target(player, world, id);
        if (!t) return { ok: false, reason: 'You hold no such captive.' };
        const def = MaimMarks.act(act);
        if (!def) return { ok: false, reason: 'No such thing.' };
        if (def.npcOnly && t.ward) return { ok: false, reason: 'Not a child raised at your court.' };
        const { rival, body: c } = t;
        const why = MaimMarks.whyNot(c, act);
        if (why) return { ok: false, reason: why };
        const M = RivalCaptives.config().maim;
        const day = _day(world);
        const wasHead = rival.head === c;
        const wasHeir = wasHead || RivalCaptives.isHeir(rival, c);
        const first = c.firstName || 'the child';
        const name = t.name;
        MaimMarks.mark(c, act, { day, by: Maiming._by(player), why: 'the feud', patch: true });
        const n = MaimMarks.count(c, act);
        const barred = MaimMarks.barsRule(c);
        // A head maimed past ruling is set aside: the House names another (the next fit child, else a cousin)
        let deposed = '';
        if (wasHead && barred) {
            RivalHouses._succeed(world, rival, { notices: [] }, player, { deposed: true });
            deposed = ` ${rival.name} sets ${him(c.gender)} aside: ${RivalHouses.headName(rival)} heads it now.`;
        }
        // Their House: a blood enemy now
        const want = Math.max(0, _num(M.feud, 100) - _num(rival.feud));
        House.accrueRivalFeud(player, world, rival.kingdomId, Math.max(want, 20), `what was done to ${first}`);
        rival.truceUntil = null;
        rival.maimOwed = { act, n, day, until: day + _num(M.owedDays, 1800), victim: first };
        RivalHouses.remember(rival, world, 'maimedKin', first);
        RivalHouses._note(rival, world, `${first} was ${Maiming.pastTense(act, n)} in your keeping.`, 'attacked');
        if (barred && wasHeir) rival.renown = Math.max(0, _num(rival.renown) - _num(M.renownLoss, 20) * (wasHead ? 1.5 : 1));
        // The other Houses: its friends take it up, the rest are wary of you, its enemies are glad
        RivalCaptives._housesReact(player, rival, { ally: _num(M.allyFeud, 25), enemy: _num(M.enemyFeud, -5), other: _num(M.othersFeud, 10) });
        // Your own court's lords think the less of a lord who does this (less under a harsh faith)
        const court = Maiming._court(player, world);
        if (court) {
            const ruling = player.throne && player.throne.ruling;
            const fx = { sacred: 1.5, harsh: 0.5 }[MaimFaith.realmStance(world, ruling ? ruling.kingdomId : null)] || 1;
            for (const v of court.vassals || []) v.grudge = _num(v.grudge) + Math.round(_num(M.courtGrudge, 4) * fx);
        }
        try {
            Nemesis.wrong(player, world, { kind: 'house', ref: { kingdomId: rival.kingdomId }, name: RivalHouses.headName(rival), line: rival.name, score: _num(M.nemesis, 85), age: _num(rival.head && rival.head.age, 40), gender: rival.head && rival.head.gender === 'female' ? 'female' : 'male', deed: { key: 'mutilation', label: `what you did to ${first}`, note: rival.name } });
        } catch (e) { /* no nemesis */ }
        const seat = rival.seat || {};
        const res = Maiming.brand(player, world, act, { name, rank: wasHead ? 'rivalHead' : wasHeir ? 'rivalHeir' : 'rival', kingdomId: rival.kingdomId, q: Number.isFinite(seat.q) ? seat.q : null, r: Number.isFinite(seat.r) ? seat.r : null }, {
            n, tags: t.ward ? ['betrayal', 'cruelty', 'rival'] : ['cruelty', 'rival'], place: seat.name || null,
            chronicle: `${Maiming._by(player)} had ${name}${wasHeir ? `, heir of ${rival.name},` : ` of ${rival.name}`} ${Maiming.pastTense(act, n)}${t.ward ? ', a ward raised under your own roof' : ''}.`,
        });
        const g = c.gender;
        let text = MaimMarks.act(act).done.replace(/\{victim\}/g, first);
        if (n >= 2 && def.doneBoth) text += ` ${def.doneBoth.replace(/\{victim\}/g, first)}`;
        if (deposed) text += deposed;
        else if (barred && wasHeir) text += ` ${_cap(he(g))} will never head ${rival.name}.`;
        else if (barred) text += ` ${_cap(he(g))} could never head ${rival.name} now.`;
        text += ` ${rival.name} is your blood enemy; every House hears of it.`;
        return { ok: true, text, brand: res, barred: !!barred, wasHeir };
    },

    /** Every other House reacts to what you did to this one: its friends, its enemies, the rest. */
    _housesReact(player, rival, add) {
        const T = (DataLoader._gamedata && DataLoader._gamedata.rivalHouses && DataLoader._gamedata.rivalHouses.ties) || {};
        for (const o of Object.values((player.house && player.house.rivals) || {})) {
            if (!o || o === rival) continue;
            const tie = _num(o.ties && o.ties[rival.kingdomId]);
            const d = tie >= _num(T.allyAt, 50) ? add.ally : tie <= _num(T.enemyAt, -50) ? add.enemy : add.other;
            o.feud = Utils.clamp(_num(o.feud) + _num(d), 0, 100);
        }
    },

    // ── Seized under guest-right ──────────────────────────

    /**
     * Who of this House is within reach to seize now: the head's grown
     * children riding with the retinue on your hex (an audience, a visit to
     * your town) — at your own table if you feasted in this town today.
     * → { rival, can: [child], feast, chance, tried } or null.
     */
    seizeChance(player, world, rival) {
        if (!player || !rival || !rival.head || !Maiming.enabled()) return null;
        const S = RivalCaptives.config().seize;
        const unit = RivalHouses.retinueOf(world, rival);
        if (!unit || !RivalHouses.meetable(player, world).includes(unit)) return null;
        const can = RivalCaptives._candidates(rival);
        if (!can.length) return null;
        const t = typeof world.getTile === 'function' ? world.getTile(player.q, player.r) : null;
        const town = t && t.settlement ? t.settlement.name : null;
        const last = player.feasts && Array.isArray(player.feasts.history) ? player.feasts.history[0] : null;
        const feast = !!(last && town && last.d === _day(world) && last.town === town && _num(rival.feud) <= _num(S.feastMaxFeud, 70));
        const mine = RivalHouses._playerStrength(player) + _num(player.skills && player.skills.stealth) * _num(S.perStealth, 4);
        const theirs = RivalHouses.strength(rival);
        let chance = _num(S.base, 0.2) + 0.6 * mine / Math.max(1, mine + theirs) + (feast ? _num(S.feastBonus, 0.25) : 0);
        chance = Math.max(_num(S.min, 0.1), Math.min(_num(S.max, 0.9), chance));
        return { rival, can, feast, chance, tried: rival.seizeDay === _day(world) };
    },

    /**
     * Seize a child of their House under guest-right: at your table, at an
     * audience, while they visit your town. One try a day; a hash roll by the
     * House and the day. Taken or not, guest-right is broken, and that is a
     * grave crime: every House, every realm and every faith hears of it.
     * → { success, ok, text, reason, cap }
     */
    seize(player, world, kingdomId, childName = null) {
        const rival = player && player.house && player.house.rivals ? player.house.rivals[kingdomId] : null;
        const sc = RivalCaptives.seizeChance(player, world, rival);
        if (!sc) return { success: false, reason: 'No one of that House is within reach.' };
        if (sc.tried) return { success: false, reason: 'They are on their guard now.' };
        const S = RivalCaptives.config().seize;
        const day = _day(world);
        rival.seizeDay = day;
        const heir = RivalHouses.heirOf(rival, { any: true });
        const c = (childName && sc.can.find(x => x.firstName === childName)) || (sc.can.includes(heir) ? heir : sc.can[0]);
        const ok = _roll(world, `seize|${rival.houseKey || rival.kingdomId}|${day}`) < sc.chance;
        const where = sc.feast ? 'your own table' : 'an audience';
        const cost = RivalCaptives._guestRight(player, world, rival, ok ? 1 : _num(S.failShare, 0.5), where);
        if (!ok) {
            House.accrueRivalFeud(player, world, rival.kingdomId, _num(S.failFeud, 40), `a hand laid on ${c.firstName} at ${where}`);
            RivalHouses.remember(rival, world, 'seizeFailed', c.firstName);
            RivalHouses._note(rival, world, `Your men tried to seize ${c.firstName} at ${where}; they fought clear.`, 'attacked');
            rival.plan = null;
            const text = `Your men lay hands on ${c.firstName} at ${where}, but ${rival.name}'s guards cut their way clear and ride off with ${him(c.gender)}. Guest-right is broken all the same: ${cost}`;
            if (player.house) House._chronicle(player.house, world, `${player.name || 'The head of the House'} tried to seize ${RivalCaptives.nameOf(rival, c)} at ${where}, against guest-right.`, ['rival', 'betrayal']);
            return { success: true, ok: false, text };
        }
        const cap = RivalCaptives.capture(player, world, rival, c, where);
        cap.guestRight = true;
        rival.feud = 100;
        rival.truceUntil = null;
        const text = `At ${where}, on your word, your men seize ${cap.name}${heir === c ? `, the heir of ${rival.name},` : ''} and drag ${him(c.gender)} below. ${rival.name}'s people ride off in a fury. You have broken guest-right: ${cost}`;
        if (player.house) House._chronicle(player.house, world, `${player.name || 'The head of the House'} seized ${cap.name} at ${where}, breaking guest-right.`, ['rival', 'betrayal', 'captive']);
        return { success: true, ok: true, text, cap };
    },

    /** The price of breaking guest-right (× share: a failed try costs part of it). → a line on what it cost. */
    _guestRight(player, world, rival, share, where) {
        const S = RivalCaptives.config().seize;
        const f = (k, d) => _num(S[k], d) * share;
        RivalCaptives._housesReact(player, rival, { ally: f('allyFeud', 40), enemy: f('enemyFeud', 5), other: f('othersFeud', 20) });
        player.karma = Math.max(-100, _num(player.karma) - Math.round(f('karma', 15)));
        try { Traits.recordDeeds(player, { deceit: Math.round(f('deceit', 3)), cruelty: Math.round(f('cruelty', 1)) }); } catch (e) { /* no traits */ }
        try {
            const at = Atrocities.state(player);
            if (at) at.perfidy = Math.min(_num(Atrocities.config().infamy.max, 300), _num(at.perfidy) + f('perfidy', 15));
        } catch (e) { /* no atrocities */ }
        // Every realm hears; the victim's realm most of all; every faith holds guest-right holy
        if (!player.reputation) player.reputation = {};
        for (const k of (world && world.kingdoms) || []) {
            if (!k || k.isAlive === false) continue;
            const home = String(k.id) === String(rival.kingdomId);
            player.reputation[k.id] = _num(player.reputation[k.id]) - Math.round(home ? f('repHome', 20) : f('repAll', 5));
            try { NPCLords.rememberRealm(world, k.id, home ? 'mutilation' : 'mutilation_heard', { note: `guest-right broken at ${where}` }); } catch (e) { /* no lord */ }
            const fid = k.religion && k.religion.faithId;
            if (fid && home) {
                const m = MaimFaith.realmStance(world, k.id) === 'sacred' ? 1.5 : 1;
                try { Devotion._addStanding(player, fid, -f('clergy', 10) * m); } catch (e) { /* no devotion */ }
            }
        }
        const creed = MaimFaith.creed(player);
        if (creed && creed.id !== 'own') { try { Devotion._addStanding(player, creed.id, -f('clergy', 10)); } catch (e) { /* no devotion */ } }
        if (Number.isFinite(player.faith)) player.faith = Math.max(0, Math.round((player.faith - f('faithLoss', 0.5)) * 100) / 100);
        if (world && Array.isArray(world.events)) world.events.push({ text: `${player.name || 'A lord'} laid hands on a child of ${rival.name} at ${where}, against guest-right.`, type: 'political', category: 'political', kingdom: rival.kingdomId });
        try {
            Nemesis.wrong(player, world, { kind: 'house', ref: { kingdomId: rival.kingdomId }, name: RivalHouses.headName(rival), line: rival.name, score: Math.round(f('nemesis', 70)), deed: { key: 'guest_right', label: `the guest-right you broke at ${where}`, note: rival.name } });
        } catch (e) { /* no nemesis */ }
        return `every House hears of it, every realm thinks the worse of you (−${Math.round(f('repAll', 5))}, −${Math.round(f('repHome', 20))} in their own), the priests call it sacrilege, karma −${Math.round(f('karma', 15))}.`;
    },


    // ── The days ──────────────────────────────────────────

    /**
     * Weekly (Maiming.processDay): your captives' months (feud, rescue,
     * offers) and the rival Houses' hostages of yours (they may be maimed).
     * Hash rolls only. → pushes onto out.notices.
     */
    week(world, player, day, out) {
        if (!player || !player.house || player.interregnum) return;
        const C = RivalCaptives.config();
        const H = C.hold;
        for (const cap of RivalCaptives.list(player).slice()) {
            const rival = RivalCaptives.rivalOf(player, cap);
            const c = RivalCaptives.body(player, cap);
            if (!rival || !c) {
                // (gone from the House's record: dead of old age as its head, or the House itself gone)
                RivalCaptives._free(player, world, cap);
                if (rival) out.notices.push({ icon: '⚰️', title: 'A Captive Dies', text: `${cap.name} has died in your keeping.`, type: 'info' });
                continue;
            }
            if (cap.offer && day > _num(cap.offer.until)) cap.offer = null;
            // Come of age in your keeping (they age with their House's year: systems/rivalHouses.js _yearOf)
            const grownAt = _num(RivalHouses.config().life.comeOfAge, 16);
            if (!cap.grown && _num(c.age) >= grownAt) {
                cap.grown = true;
                const text = `${cap.name} has come of age in your keeping${RivalCaptives.isHeir(rival, c) ? `, the heir of ${rival.name}` : ''}. ${rival.name} wants ${him(c.gender)} home more than ever.`;
                if (player.house) House._chronicle(player.house, world, `${cap.name} came of age a captive of ${player.house.name}.`, ['rival', 'captive']);
                out.notices.push({ icon: '⛓️', title: `${c.firstName} Comes of Age`, text, type: 'info' });
            }
            if (day - _num(cap.lastMonth, cap.day) < 28) continue;
            cap.lastMonth = day;
            House.accrueRivalFeud(player, world, rival.kingdomId, _num(H.monthlyFeud, 3));
            // Death in captivity: sickness, more so for the maimed and the young; despair, the longer they are held
            const years = (day - _num(cap.day)) / Math.max(1, _num(RivalHouses.config().life.daysPerYear, 120));
            const D = C.death;
            const risk = (_num(D.sickMonthly, 0.004) + _num(D.despairPerYear, 0.002) * Math.min(5, years))
                * (MaimMarks.any(c) ? _num(D.maimedMult, 3) : 1) * (_num(c.age) < 14 ? _num(D.youngMult, 1.5) : 1);
            if (_roll(world, `die|${cap.id}|${day}`) < risk) {
                RivalCaptives._died(player, world, cap, rival, c, MaimMarks.any(c) || years >= 2 ? 'despair' : 'sickness', out);
                continue;
            }
            if (_roll(world, `rescue|${cap.id}|${day}`) < _num(H.rescueMonthly, 0.04)) {
                // ...a rescue that goes wrong in the dark
                if (_roll(world, `rescueWrong|${cap.id}|${day}`) < _num(D.rescueGoneWrong, 0.25)) {
                    RivalCaptives._died(player, world, cap, rival, c, 'rescue', out);
                    continue;
                }
                RivalCaptives._free(player, world, cap);
                const text = `Men of ${rival.name} broke in by night and carried ${cap.name} home.`;
                RivalHouses._note(rival, world, `Got ${c.firstName} back from your keeping.`, 'triumph');
                if (player.house) House._chronicle(player.house, world, text, ['rival', 'captive']);
                out.notices.push({ icon: '🌒', title: 'A Captive Rescued', text, type: 'warning' });
                continue;
            }
            if (!cap.offer && day - _num(cap.offerDay, cap.day) >= _num(H.offerEvery, 60)) {
                cap.offerDay = day;
                const amount = RivalCaptives.ransomPrice(player, world, cap);
                if (amount > 0) {
                    cap.offer = { amount, until: day + _num(H.offerDays, 30) };
                    out.notices.push({ icon: '💰', title: `An Offer for ${c.firstName}`, text: `${rival.name} offers ${Utils.formatGold(amount)} gold to have ${cap.name} home (🔪 The Knife).`, type: 'info' });
                }
            }
        }
        RivalCaptives._hostagesWeek(world, player, day, out);
    },

    /**
     * A captive dies in your keeping (how: sickness | despair | rescue): gone
     * from their House's record; the House holds you to blame — the feud to
     * the top, blood owed, a nemesis — though less for a rescue gone wrong.
     */
    _died(player, world, cap, rival, c, how, out) {
        const D = RivalCaptives.config().death;
        const day = _day(world);
        const wasHead = rival.head === c;
        RivalCaptives._free(player, world, cap);
        const kids = (rival.head && rival.head.children) || [];
        const i = kids.indexOf(c);
        if (i >= 0) kids.splice(i, 1);
        if (wasHead) RivalHouses._succeed(world, rival, { notices: [] }, player, { deposed: false });
        const blame = how === 'rescue' ? _num(D.rescueFeud, 20) : _num(D.feud, 50);
        House.accrueRivalFeud(player, world, rival.kingdomId, blame, `${c.firstName} died in your keeping`);
        RivalHouses.remember(rival, world, 'diedCaptive', c.firstName);
        RivalHouses._note(rival, world, `${c.firstName} died a captive of yours.`, 'bereaved');
        if (how !== 'rescue') {
            rival.maimOwed = { act: 'eye', n: 1, day, until: day + _num(RivalCaptives.config().maim.owedDays, 1800), victim: c.firstName };
            try { Nemesis.wrong(player, world, { kind: 'house', ref: { kingdomId: rival.kingdomId }, name: RivalHouses.headName(rival), line: rival.name, score: _num(D.nemesis, 75), deed: { key: 'captive_died', label: `${c.firstName}, dead in your keeping`, note: rival.name } }); } catch (e) { /* no nemesis */ }
        }
        const why = { sickness: 'of a fever in the damp', despair: 'of despair, refusing food at the end', rescue: `in the dark, when men of ${rival.name} came to break ${him(c.gender)} out and it went wrong` }[how] || '';
        const text = `${cap.name} has died in your keeping, ${why}.${wasHead ? ` ${rival.name} has a new head: ${RivalHouses.headName(rival)}.` : ''} ${rival.name} holds you to blame.`;
        if (player.house) House._chronicle(player.house, world, `${cap.name} of ${rival.name} died a captive of ${player.house.name}.`, ['rival', 'captive', 'death']);
        out.notices.push({ icon: '⚰️', title: 'A Captive Dies', text, type: 'warning' });
        Interrupts.raise(world, { reason: `${cap.name} died in your keeping`, icon: '⚰️', source: 'rivalCaptives' });
    },

    /** A rival House holding a child of yours, its terms refused (or blood owed), may maim the child. */
    _hostagesWeek(world, player, day, out) {
        const Hs = RivalCaptives.config().hostage;
        for (const child of player.children || []) {
            const held = child && child.isAlive !== false && child.upbringing && child.upbringing.heldBy;
            if (!held || !held.rival) continue;
            const rival = player.house.rivals && player.house.rivals[held.kingdomId];
            if (!rival) continue;
            const owed = rival.maimOwed && day <= _num(rival.maimOwed.until) ? rival.maimOwed : null;
            if (!owed && (_num(rival.feud) < _num(Hs.feud, 90) || _num(held.demands) < 1 + _num(Hs.minRefused, 1))) continue;
            if (held.maimedDay != null && day - _num(held.maimedDay) < 360) continue;
            if (_roll(world, `hostage|${child.id}|${day}`) >= _num(Hs.weekly, 0.03) * (owed ? 3 : 1)) continue;
            const pool = { ...(Hs.pool || {}) };
            for (const a of Object.keys(pool)) if (MaimMarks.whyNot(child, a)) delete pool[a];
            const act = owed && !MaimMarks.whyNot(child, owed.act) ? owed.act : _pickW(pool, _roll(world, `hostageAct|${child.id}|${day}`));
            if (!act) continue;
            MaimMarks.mark(child, act, { day, by: rival.name, why: owed ? `what you did to ${owed.victim}` : 'your refusal' });
            held.maimedDay = day;
            if (owed) rival.maimOwed = null;
            const n = MaimMarks.count(child, act);
            const what = MaimMarks._shortOf(act, n);
            const barred = MaimMarks.barsRule(child);
            const text = owed
                ? `${rival.name} has paid you back for ${owed.victim}: ${child.firstName}, their hostage, is left ${what}.${barred ? ` ${child.firstName} can never sit the seat now.` : ''}`
                : `${rival.name} tires of waiting for your answer. ${child.firstName}, their hostage, is left ${what}.${barred ? ` ${child.firstName} can never sit the seat now.` : ''} Pay, or send blades.`;
            House._chronicle(player.house, world, `${child.firstName} was left ${what} by ${rival.name}, who held ${child.gender === 'female' ? 'her' : 'him'}.`, ['heirs', 'feud']);
            out.notices.push({ icon: (MaimMarks.act(act) || {}).icon || '🔪', title: `${child.firstName} Is Maimed`, text, type: 'error' });
            Interrupts.raise(world, { reason: `${child.firstName} is maimed by ${rival.name}`, icon: '🔪', source: 'rivalCaptives' });
        }
    },
};
