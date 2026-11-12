// ============================================
// TOWN SCHOOL — the townsfolk's children learn their letters
// ============================================
// Over the roster (systems/townsfolk.js) and its families
// (systems/townFamily.js, which steps this every `stepDays`):
//
//   WHO GOES — each child of school age (data ages) is, for a year at a
//   time, at the parish school (the priest, in the church or chapel), the
//   town school (a schoolmaster, in towns and cities), tutored at home (the
//   well-off), or at work beside their parents. The share that goes is by
//   the family's station and the town's size, more where a patron has funded
//   the school; a few bright youths go on to the church's learning (the
//   cloister: the clergy, the scribe's desk). Girls and boys alike.
//   LEARNING — `p.school = { yrs, kind, lit }` while a child; at 16 their
//   literacy is settled (`p.literacy`, 0–100: schooling plus a literate
//   home). mailVoice reads it: a schooled townsperson writes their own
//   letters, the rest need the priest to write for them. The jobs system
//   reads `p.school.yrs` / `p.literacy` / `p.school.track` for clerks,
//   scribes, priests and merchants (`schooling(p)`).
//   FEES — real coin, each season: from a parent's purse to the teacher's;
//   a patron's fund pays first; the parish pays for the poor out of the
//   town's purse; a town school with no one paying turns the child away.
//   The schoolmaster is a real townsperson (`p.teaches`).
//   THE PLAYER — `donate` to the town's school (its fund: more children go,
//   the teacher and the parents think the better of you, a large gift is
//   Prestige), `sponsor` a bright poor child (their schooling paid; they
//   grow up loyal to you).
//
// Every roll is a hash of the world seed, the town, the child and the year —
// never the shared RNG. Data: data/townSchool.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Economy } from '../world/economy.js';
import { Townsfolk } from './townsfolk.js';
import { TownFamily } from './townFamily.js';
import { House } from './house.js';
import { Laws } from './laws.js';
import { Holdings } from './holdings.js';
import { Mail } from './mail.js';
import { MailVoice } from './mailVoice.js';

const DEFAULTS = {
    enabled: true,
    ages: [6, 13],
    cloisterAges: [12, 15],
    hours: [8, 12],
    restEvery: 7,
    writeAt: 50,
    share: { byStation: { 0: 0.05, 1: 0.3, 2: 0.85, 3: 1 }, byTown: { village: 0.8, town: 1, city: 1.15, capital: 1.25 }, fundPerCoin: 0.004, fundMax: 0.35 },
    kinds: {
        parish: { label: 'the parish school', teacher: 'priest', fee: 1, litPerYear: 12, buildings: ['chapel', 'church', 'temple'] },
        grammar: { label: 'the town school', teacher: 'schoolmaster', fee: 3, litPerYear: 16, towns: ['town', 'city', 'capital'], buildings: ['library', 'church', 'chapel', 'temple'] },
        tutor: { label: 'a tutor at home', teacher: 'schoolmaster', fee: 8, litPerYear: 20, minStation: 2 },
        cloister: { label: 'the church\'s learning', teacher: 'priest', fee: 0, litPerYear: 25, share: 0.08, minSchooling: 3 },
    },
    home: { literateParent: 15, base: 4 },
    truancy: 0.08,
    patron: { standingPerCoin: 0.05, maxStanding: 6, sponsorCost: 40, sponsorRegard: 20, prestigeAt: 100, loyalRegard: 85 },
    founding: { cost: 300, endowShare: 0.5, share: 0.12, perYear: 0.03, max: 0.3 },
    lines: {},
};

const LETTERED = ['priest', 'noble', 'merchant'];

let _cfg = null;
let _cfgSrc;

function _obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }
function _num(v, d = 0) { return typeof v === 'number' && isFinite(v) ? v : d; }
function _seed(world) { return (world && world.generationParams && world.generationParams.seed) || 1; }
function _h(...parts) { return ((Utils.hashStr(parts.join('|')) >>> 0) % 1000003) / 1000003; }

export const TownSchool = {
    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.townSchool : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            _cfg = { ...DEFAULTS, ...d };
            for (const k of ['share', 'home', 'patron', 'founding', 'lines']) _cfg[k] = { ...DEFAULTS[k], ...(_obj(d[k]) || {}) };
            _cfg.kinds = { ...DEFAULTS.kinds };
            for (const [k, v] of Object.entries(_obj(d.kinds) || {})) _cfg.kinds[k] = { ...(DEFAULTS.kinds[k] || {}), ...(_obj(v) || {}) };
        }
        return _cfg;
    },

    /** The town's school book: { v, fund, master, fees, given }. */
    state(folk) {
        if (!folk) return null;
        if (!_obj(folk.school)) folk.school = { v: 1, fund: 0, master: null, fees: 0, given: 0 };
        return folk.school;
    },

    _year(day) { return Math.floor((Math.max(1, _num(day, 1)) - 1) / Townsfolk.config().daysPerYear); },

    /** Who keeps the child: parents at home, else the guardian. */
    _keepers(folk, p) {
        const out = (p.parents || []).map(id => Townsfolk.get(folk, id)).filter(x => x && Townsfolk.isHere(x));
        if (!out.length && p.ward != null) { const g = Townsfolk.get(folk, p.ward); if (g && Townsfolk.isHere(g)) out.push(g); }
        return out;
    },

    /** The family's station (0 beggar … 3 noble): the higher of those who keep them. */
    familyStation(folk, p) {
        const k = TownSchool._keepers(folk, p);
        return k.length ? Math.max(...k.map(x => TownFamily.station(x, folk))) : 1;
    },

    /** The town's priest (the parish teacher), or null. */
    priest(folk) {
        return Townsfolk.residents(folk).filter(x => x.role === 'priest').sort((a, b) => a.id - b.id)[0] || null;
    },

    /** The schoolmaster: kept on the book while they live here, else a lettered grown townsperson takes it up. */
    master(world, folk, day) {
        const st = TownSchool.state(folk);
        const cur = Townsfolk.get(folk, st.master);
        if (cur && Townsfolk.isHere(cur) && Townsfolk.age(cur, day) < 75) return cur;
        const able = Townsfolk.residents(folk).filter(x => x.role !== 'child' && x.role !== 'guard' && Townsfolk.age(x, day) >= 25 && Townsfolk.age(x, day) < 70
            && (_num(x.literacy, LETTERED.includes(x.retired || x.role) ? 80 : 0) >= 60));
        if (!able.length) return TownSchool.priest(folk);
        able.sort((a, b) => _h(_seed(world), folk.q, folk.r, 'master', a.id) - _h(_seed(world), folk.q, folk.r, 'master', b.id));
        const m = able[0];
        if (cur && cur !== m) delete cur.teaches;
        st.master = m.id;
        m.teaches = 'schoolmaster';
        return m;
    },

    /** The teacher for a kind of schooling, or null (no priest: no parish school). */
    teacherFor(world, folk, kind, day) {
        const K = TownSchool.config().kinds[kind];
        if (!K) return null;
        return K.teacher === 'priest' ? TownSchool.priest(folk) : TownSchool.master(world, folk, day);
    },

    /**
     * This year's schooling for a child: 'parish' | 'grammar' | 'tutor' |
     * 'cloister' | null (at work beside their family). Hashed per child and year.
     */
    kindFor(world, settlement, folk, p, day) {
        const C = TownSchool.config();
        if (!C.enabled || !p || !Townsfolk.isHere(p)) return null;
        const age = Townsfolk.age(p, day);
        const yr = TownSchool._year(day);
        const type = (settlement && settlement.type) || 'village';
        const K = C.kinds;
        const u = k => _h(_seed(world), folk.q, folk.r, p.id, yr, k);
        // A few bright youths go on to the church's learning
        const [cl, ch] = C.cloisterAges;
        if (age >= cl && age <= ch && p.school && _num(p.school.yrs) >= _num(K.cloister.minSchooling, 3)
            && _h(_seed(world), folk.q, folk.r, p.id, 'bright') < _num(K.cloister.share, 0.08) && TownSchool.priest(folk)) return 'cloister';
        const [lo, hi] = C.ages;
        if (age < lo || age > hi || p.role !== 'child') return null;
        // (a school founded by decree: a town school even in a village, and more of the town sent to it)
        const founded = TownSchool.state(folk).founded;
        const grammar = (K.grammar.towns || []).includes(type) || !!founded;
        if (p.sponsored) return grammar ? 'grammar' : 'parish';
        const station = TownSchool.familyStation(folk, p);
        if (station >= _num(K.tutor.minStation, 2) && u('tutor') < (station >= 3 ? 0.7 : 0.35)) return 'tutor';
        const S = C.share;
        const fund = Math.min(_num(S.fundMax, 0.35), _num(TownSchool.state(folk).fund) * _num(S.fundPerCoin, 0.004));
        const share = _num(S.byStation[station], 0.3) * _num(S.byTown[type], 1) + fund + TownSchool.foundedShare(folk, day);
        if (u('go') >= share) return null;
        if (grammar && u('which') < 0.6) return 'grammar';
        return TownSchool.priest(folk) ? 'parish' : (grammar ? 'grammar' : null);
    },

    /** A school day (not every restEvery-th day)? */
    schoolDay(day) {
        const r = _num(TownSchool.config().restEvery, 7);
        return !(r > 0 && _num(day) % r === 0);
    },

    /** Is the child in class at this hour today? → { kind, truant } or null */
    inClass(world, settlement, folk, p, day, hour) {
        const C = TownSchool.config();
        if (!TownSchool.schoolDay(day) || hour < C.hours[0] || hour >= C.hours[1]) return null;
        const kind = TownSchool.kindFor(world, settlement, folk, p, day);
        if (!kind || (p.school && p.school.unpaid === TownSchool._year(day))) return null;
        const truant = kind !== 'tutor' && _h(_seed(world), folk.q, folk.r, p.id, day, 'truant') < _num(C.truancy, 0.08);
        return { kind, truant };
    },

    /**
     * Does the child carry a satchel now? A pupil of the parish or grammar school (paid up), on a
     * school day, from a little before class until a while after (satchelHours: [before, after]).
     */
    carriesSatchel(world, settlement, folk, p, day, hour) {
        const C = TownSchool.config();
        if (!C.enabled || !p || !TownSchool.schoolDay(day)) return false;
        const [before, after] = Array.isArray(C.satchelHours) ? C.satchelHours : [2, 2];
        if (hour < C.hours[0] - _num(before, 2) || hour >= C.hours[1] + _num(after, 2)) return false;
        const kind = TownSchool.kindFor(world, settlement, folk, p, day);
        if (kind !== 'parish' && kind !== 'grammar') return false;
        return !(p.school && p.school.unpaid === TownSchool._year(day));
    },

    // ──────────── THE STEP (from systems/townFamily.js) ────────────

    step(world, settlement, folk, day, player = null) {
        const C = TownSchool.config();
        if (!C.enabled) return;
        const Y = Townsfolk.config().daysPerYear;
        const stepDays = TownFamily.config().stepDays;
        const st = TownSchool.state(folk);
        const feeDay = _num(day) % Townsfolk.config().tickDays === 0;
        for (const p of Townsfolk.residents(folk)) {
            const age = Townsfolk.age(p, day);
            if (age >= Townsfolk.config().comeOfAge) {
                if (p.literacy == null && (p.school || p.born > _num(st.since, Infinity) - 16 * Y)) TownSchool._settle(folk, p, day, world, player);
                continue;
            }
            const kind = TownSchool.kindFor(world, settlement, folk, p, day);
            if (!kind) continue;
            const sc = p.school || (p.school = { yrs: 0, lit: 0, kind });
            if (feeDay && !TownSchool._payFee(world, settlement, folk, p, kind, day)) { sc.unpaid = TownSchool._year(day); continue; }
            if (sc.unpaid === TownSchool._year(day)) continue;
            const K = C.kinds[kind];
            sc.kind = kind;
            sc.yrs = Math.round((_num(sc.yrs) + stepDays / Y) * 1000) / 1000;
            sc.lit = Math.min(100, Math.round((_num(sc.lit) + _num(K.litPerYear, 12) * stepDays / Y) * 10) / 10);
            if (kind === 'cloister') sc.track = 'clergy';
        }
        if (st.since == null) st.since = day;
    },

    /** At 16: their letters settled for life. */
    _settle(folk, p, day, world = null, player = null) {
        const C = TownSchool.config();
        const keepers = (p.parents || []).map(id => Townsfolk.get(folk, id)).filter(Boolean);
        const lettered = keepers.some(x => _num(x.literacy, LETTERED.includes(x.retired || x.role) ? 80 : 0) >= C.writeAt);
        const lit = (p.school ? _num(p.school.lit) : 0) + _num(C.home.base, 4) + (lettered ? _num(C.home.literateParent, 15) : 0);
        p.literacy = Math.max(0, Math.min(100, Math.round(lit)));
        if (p.school && _num(p.school.yrs) >= 1) Townsfolk._log(p, day, 'schooled', null, p.school.kind);
        // A child the player schooled grows up loyal to them
        if (p.sponsored) TownSchool._grownLoyal(world, folk, p, day, player);
    },

    /** The season's fee: a parent's purse → the teacher's (a patron's fund, or the parish for the poor). */
    _payFee(world, settlement, folk, p, kind, day) {
        const K = TownSchool.config().kinds[kind];
        const fee = _num(K && K.fee);
        if (fee <= 0) return true;
        const st = TownSchool.state(folk);
        const teacher = TownSchool.teacherFor(world, folk, kind, day);
        if (!teacher) return false;
        Townsfolk.purse(folk, teacher, world);
        const pay = amt => { teacher.purse = _num(teacher.purse) + amt; st.fees = _num(st.fees) + amt; };
        // The patron's fund pays for the sponsored first, and for the poor
        const poor = TownSchool.familyStation(folk, p) <= 1;
        if ((p.sponsored || poor) && _num(st.fund) >= fee) { st.fund -= fee; st.given = _num(st.given) + fee; pay(fee); return true; }
        for (const k of TownSchool._keepers(folk, p)) {
            if (Townsfolk.purse(folk, k, world) >= fee) { k.purse -= fee; pay(fee); return true; }
        }
        // The parish keeps the poor at their letters out of the town's purse
        if (kind === 'parish' && settlement) {
            const got = Economy.drawTown(settlement, fee);
            if (got > 0) { pay(got); return true; }
        }
        return false;
    },

    // ──────────── WHAT OTHERS READ ────────────

    /** Literacy 0–100: settled, or a child's so far; null for those the book never saw (an old save's grown folk). */
    literacy(p) {
        if (!p) return null;
        if (typeof p.literacy === 'number') return p.literacy;
        return p.school ? _num(p.school.lit) : null;
    },

    /** Can they write a letter themselves? null when the book doesn't know (the caller keeps its old guess). */
    canWrite(p) {
        return typeof (p && p.literacy) === 'number' ? p.literacy >= TownSchool.config().writeAt : null;
    },

    /** { yrs, kind, track, literacy } — for the jobs system's clerks, scribes, priests and merchants. */
    schooling(p) {
        return { yrs: p && p.school ? _num(p.school.yrs) : 0, kind: p && p.school ? p.school.kind : null, track: p && p.school ? p.school.track || null : null, literacy: TownSchool.literacy(p) };
    },

    /** The town's grown literacy: { share able to write, of those the book knows }. */
    townLiteracy(folk, day) {
        const C = TownSchool.config();
        const grown = Townsfolk.residents(folk).filter(p => Townsfolk.age(p, day) >= 16 && typeof p.literacy === 'number');
        return { known: grown.length, share: grown.length ? grown.filter(p => p.literacy >= C.writeAt).length / grown.length : 0 };
    },

    /** The town's school as the player sees it: { pupils by kind, teacher, master, fund, fees }. */
    view(world, settlement, folk, day) {
        const by = {};
        for (const p of Townsfolk.residents(folk)) {
            const k = TownSchool.kindFor(world, settlement, folk, p, day);
            if (k) by[k] = (by[k] || 0) + 1;
        }
        const st = TownSchool.state(folk);
        const pr = TownSchool.priest(folk);
        const m = TownSchool.master(world, folk, day);
        return { pupils: by, priest: pr ? Townsfolk.name(pr) : null, master: m ? Townsfolk.name(m) : null, fund: _num(st.fund), fees: _num(st.fees), literacy: TownSchool.townLiteracy(folk, day) };
    },

    // ──────────── FOUNDED BY DECREE ────────────

    /** The extra share of the town sent to a school founded by decree: grows each year it stands. */
    foundedShare(folk, day) {
        const f = folk && folk.school && folk.school.founded;
        if (!f) return 0;
        const F = TownSchool.config().founding;
        const yrs = Math.max(0, (_num(day) - _num(f.d)) / Townsfolk.config().daysPerYear);
        return Math.min(_num(F.max, 0.3), _num(F.share, 0.12) + yrs * _num(F.perYear, 0.03));
    },

    /**
     * May the player found a school in this town by decree? The ruler of its
     * realm (from the crown's treasury) or its lord (a holding: from their own
     * purse). → { ok, reason?, cost, payer: 'crown'|'purse' }
     */
    canFound(player, world, settlement) {
        const C = TownSchool.config();
        const cost = Math.round(_num(C.founding.cost, 300));
        if (!C.enabled || !settlement || !settlement.folk) return { ok: false, reason: 'There is no town here to found a school in.', cost };
        if (settlement.folk.school && settlement.folk.school.founded) return { ok: false, reason: `${settlement.name || 'The town'} already has its school.`, cost };
        const k = Laws.ruled(player, world);
        if (k && settlement.kingdom != null && k.id === settlement.kingdom) {
            if (_num(k.treasury) < cost) return { ok: false, reason: `Founding a school costs the crown ${cost}g; the treasury holds ${Math.floor(_num(k.treasury))}g.`, cost, payer: 'crown' };
            return { ok: true, cost, payer: 'crown' };
        }
        if (Holdings.isHolding(player, world, settlement.q, settlement.r)) {
            if (_num(player.gold) < cost) return { ok: false, reason: `Founding a school costs ${cost}g.`, cost, payer: 'purse' };
            return { ok: true, cost, payer: 'purse' };
        }
        return { ok: false, reason: 'Only the ruler of the realm or the lord of the town may found its school.', cost };
    },

    /**
     * Found the town's school: the coin (the crown's or the lord's) goes half to
     * building and furnishing it (into the town's purse: its masons and joiners),
     * half to the school's fund; a schoolmaster is appointed from the town's
     * lettered folk; from now on it is a town school, and more of the town sends
     * its children each year. → { success, text|reason }
     */
    found(player, world, settlement) {
        const can = TownSchool.canFound(player, world, settlement);
        if (!can.ok) return { success: false, reason: can.reason };
        const C = TownSchool.config();
        const folk = settlement.folk;
        const day = _num(world && world.day, 1);
        if (can.payer === 'crown') {
            const k = Laws.ruled(player, world);
            k.treasury = _num(k.treasury) - can.cost;
        } else {
            player.gold = _num(player.gold) - can.cost;
        }
        const endow = Math.round(can.cost * _num(C.founding.endowShare, 0.5));
        Economy.payTown(settlement, can.cost - endow);
        const st = TownSchool.state(folk);
        st.fund = _num(st.fund) + endow;
        st.founded = { d: day, by: player.firstName || player.name || 'the crown', payer: can.payer };
        const m = TownSchool.master(world, folk, day);
        Townsfolk._annal(folk, world, day, { k: 'schoolFounded', a: m ? m.id : null, b: null, x: st.founded.by }, []);
        House.recordPlayerDeed(player, world, 'schoolFunded', { reason: `founded the school of ${settlement.name || 'a town'}`, scale: 2 });
        return { success: true, text: `By your decree ${settlement.name || 'the town'} has its school${m ? `, with ${Townsfolk.name(m)} as schoolmaster` : ''}. ${can.cost}g ${can.payer === 'crown' ? 'from the treasury' : 'from your purse'}: half to the building, ${endow}g to its fund.` };
    },

    /** The town's annal of its school's founding. */
    annalText(folk, entry, world) {
        if (entry.k !== 'schoolFounded') return null;
        const m = Townsfolk.get(folk, entry.a);
        return `The town school was founded ${Townsfolk.when(entry.d, world)} by the decree of ${entry.x || 'the crown'}${m ? `, with ${Townsfolk.name(m)} as its master` : ''}.`;
    },

    // ──────────── THE SPONSORED, GROWN ────────────

    /**
     * A child the player paid to school comes of age: loyal for life (high
     * regard, a memory), ready to serve (the dialog's offer: TownJobs' hire),
     * and a letter of thanks in their own hand that keeps them writing.
     */
    _grownLoyal(world, folk, p, day, player) {
        const P = TownSchool.config().patron;
        TownSchool._regard(p, 0);
        p.mem.disposition = Math.max(_num(p.mem.disposition, 50), _num(P.loyalRegard, 85));
        p.mem.timesSpoken = Math.max(1, _num(p.mem.timesSpoken));
        p.loyal = 'player';
        Townsfolk._log(p, day, 'sponsoredGrown', null, p.sponsored && p.sponsored.by ? (player && (player.firstName || player.name)) || 'my patron' : 'my patron');
        if (!player || !world || typeof world.getTile !== 'function') return;
        try {
            const key = `folk:${folk.q},${folk.r}:${p.id}`;
            const to = Mail.recipients(player, world).find(r => r.key === key);
            if (!to) return;
            Mail.state(player);
            const R = Mail._sendUnprompted(world, player, to, 'grateful', {}, 'In my own hand');
            // ...and a correspondent from now on (they write now and then)
            const corr = MailVoice.corr(player, key);
            corr.n = Math.max(1, _num(corr.n));
            p.thanked = R ? day : null;
        } catch { /* (a letter is a nicety: never let it stop the town's year) */ }
    },

    // ──────────── THE PLAYER ────────────

    _regard(p, d) {
        if (!p) return;
        if (!p.mem) p.mem = { timesSpoken: 0, disposition: 50, lastAction: null, giftsReceived: 0, threatened: false, flattered: false, questOffered: false, rumorsTold: 0, playerTitle: null };
        p.mem.disposition = Math.max(0, Math.min(100, _num(p.mem.disposition, 50) + d));
    },

    /** Give coin to the town's school fund: → { success, reason?, standing } */
    donate(player, world, settlement, amount) {
        const folk = settlement && settlement.folk;
        const g = Math.floor(_num(amount));
        if (!player || !folk || g <= 0) return { success: false, reason: 'Nothing to give.' };
        if (_num(player.gold) < g) return { success: false, reason: 'You haven\'t the coin.' };
        const C = TownSchool.config();
        const day = _num(world && world.day, 1);
        player.gold -= g;
        TownSchool.state(folk).fund = _num(TownSchool.state(folk).fund) + g;
        const standing = Math.min(_num(C.patron.maxStanding, 6), Math.round(g * _num(C.patron.standingPerCoin, 0.05)));
        // The teacher and the parents of the town's pupils think the better of you
        const touched = new Set();
        const pr = TownSchool.priest(folk);
        if (pr) touched.add(pr);
        for (const p of Townsfolk.residents(folk)) {
            if (p.school && Townsfolk.age(p, day) < 16) for (const k of TownSchool._keepers(folk, p)) touched.add(k);
        }
        for (const p of touched) TownSchool._regard(p, standing);
        let prestige = 0;
        if (g >= _num(C.patron.prestigeAt, 100)) prestige = House.recordPlayerDeed(player, world, 'schoolFunded', { reason: `funded the school of ${settlement.name || 'a town'}` });
        return { success: true, standing, touched: touched.size, prestige, fund: TownSchool.state(folk).fund };
    },

    /** Pay for a bright poor child's schooling: → { success, reason?, cost } */
    sponsor(player, world, settlement, p) {
        const folk = settlement && settlement.folk;
        const C = TownSchool.config();
        const cost = _num(C.patron.sponsorCost, 40);
        const day = _num(world && world.day, 1);
        if (!player || !folk || !p || !Townsfolk.isHere(p)) return { success: false, reason: 'No such child.' };
        if (p.sponsored) return { success: false, reason: `${p.first}'s schooling is already paid for.` };
        const age = Townsfolk.age(p, day);
        if (age < C.ages[0] || age > C.ages[1]) return { success: false, reason: `${p.first} is not of an age for school.` };
        if (_num(player.gold) < cost) return { success: false, reason: `It takes ${cost} gold.` };
        player.gold -= cost;
        TownSchool.state(folk).fund = _num(TownSchool.state(folk).fund) + cost;
        p.sponsored = { by: 'player', d: day };
        TownSchool._regard(p, _num(C.patron.sponsorRegard, 20));
        for (const k of TownSchool._keepers(folk, p)) TownSchool._regard(k, Math.round(_num(C.patron.sponsorRegard, 20) / 2));
        Townsfolk._log(p, day, 'sponsored', null, player.firstName || player.name || 'a patron');
        return { success: true, cost };
    },

    /** Children of the town the player could sponsor (poor, of school age, not yet at school): [person] */
    sponsorable(world, settlement, folk, day) {
        const C = TownSchool.config();
        return Townsfolk.residents(folk).filter(p => p.role === 'child' && !p.sponsored && TownSchool.familyStation(folk, p) <= 1
            && Townsfolk.age(p, day) >= C.ages[0] && Townsfolk.age(p, day) <= C.ages[1] && !TownSchool.kindFor(world, settlement, folk, p, day));
    },

    /** The kind's school building types on the street map (empty for a tutor at home). */
    buildingsFor(kind) {
        const K = TownSchool.config().kinds[kind];
        return K && Array.isArray(K.buildings) ? K.buildings : [];
    },

    line(key, seedKey = '') {
        const list = (TownSchool.config().lines || {})[key];
        if (!Array.isArray(list) || !list.length) return null;
        return list[Math.floor(_h(seedKey, key) * list.length) % list.length];
    },

    lifeText(folk, p, e, world) {
        const when = Townsfolk.when(e.d, world);
        const K = TownSchool.config().kinds[e.x] || {};
        if (e.k === 'schooled') return `I learned my letters at ${K.label || 'school'}.`;
        if (e.k === 'sponsored') return `${e.x || 'A patron'} paid for my schooling ${when}. I'll not forget it.`;
        if (e.k === 'sponsoredGrown') return `I'm grown now, and lettered, thanks to ${e.x || 'my patron'}. I owe them everything.`;
        return null;
    },

    biographyLine(folk, p, e, world) {
        const when = Townsfolk.when(e.d, world);
        const K = TownSchool.config().kinds[e.x] || {};
        if (e.k === 'schooled') return `Schooled at ${K.label || 'school'}.`;
        if (e.k === 'sponsored') return `Schooling paid for by ${e.x || 'a patron'} ${when}.`;
        if (e.k === 'sponsoredGrown') return `Came of age ${when}, loyal to ${e.x || 'their patron'} for the schooling.`;
        return null;
    },
};
