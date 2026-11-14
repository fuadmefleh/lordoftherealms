// ============================================
// LITERACY — who can read, town by town, and what letters change
// ============================================
// Over the townsfolk (systems/townsfolk.js) and their schooling
// (systems/townSchool.js, which settles a child's letters at 16):
//
//   THE PEOPLE   every grown townsperson can read or not (person.literacy,
//                0–100, on the person: it goes with them when they move
//                town). Grown folk the school book never saw are given their
//                letters once, from their trade, the town's size and its era
//                (a hash of the world seed, the town and the person).
//   THE TOWN     a town's rate (settlement.letters.rate) is the share of its
//                grown folk who can write (TownSchool's writeAt); a town with
//                no roster is estimated from its size, era and schools and
//                drifts toward that. A yearly sample is kept (letters.hist):
//                the rate rises and falls over decades as schooled children
//                grow up and the unlettered old die.
//   SCHOOLS      the parish (the priest) and the town school (TownSchool);
//                the church endows a school in the great towns (a tithe out
//                of the town's purse into the school fund, yearly); a rich
//                guild pays into it for its apprentices (out of its
//                guildhall); and the player may ENDOW a school anywhere they
//                have walked: coin, planks and stone (from the packs, else
//                bought off the town's market), a schoolmaster hired from the
//                town's lettered folk, and a monthly wage and fund from the
//                player's purse — unpaid two months, it closes.
//   WHAT IT DOES (each a factor between an unlettered town and one where
//                half can write; a town not yet reckoned is neutral):
//                taxes collected (systems/fiscal.js), the stability a new law
//                costs (systems/laws.js: a posted law is understood), the
//                watch knowing your face from the posters (systems/wanted.js),
//                oral rumour growing in the telling (systems/gossip.js,
//                systems/hearsay.js) and written tales — broadsheets the
//                player pays to have printed (pamphlet) — spreading
//                (systems/whispers.js), a bank's trust (systems/finance.js).
//   LETTERS      a letter to one who can't read waits for someone to read it
//                aloud (the priest, the schoolmaster, a lettered neighbour):
//                days late, and the reader may tell what was in it (a Gossip
//                rumour; a love letter, a scandal) — systems/mail.js.
//   THE PLAYER   their own letters (player.literacy.lv, for the life it was
//                reckoned for): below readAt no book can be read; below
//                writeAt a scribe writes their letters (a fee into the town's
//                purse). Lessons with a town's teacher, a little from every
//                book read. Their children learn at home (more with a
//                lettered parent), from a tutor and by their focus
//                (child.literacy); the heir carries it into rule.
//
// No shared RNG: every roll is a hash. State: settlement.letters and
// folk.school.{church,guild,endowed} (saved with the tile), player.literacy
// (systems/saveLoad.js), child.literacy (in player.children). Daily:
// processDay(world, player) from ui/game/endDay.js (and the interregnum's
// world tick, player null). Data: data/literacy.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { PlayerInventory } from '../core/inventory.js';
import { Economy } from '../world/economy.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { TownEras } from '../world/townEras.js';
import { Townsfolk } from './townsfolk.js';
import { TownSchool } from './townSchool.js';
import { Guilds } from './guilds.js';
import { House } from './house.js';
import { Ledger } from './ledger.js';
import { Gossip } from './gossip.js';
import { Whispers } from './whispers.js';

const DEFAULTS = {
    enabled: true, readAt: 40, writeAt: 50, refreshDays: 30, minKnown: 6, histCap: 200,
    baseline: {
        roles: { priest: 0.95, noble: 0.9, merchant: 0.7, guard: 0.18, blacksmith_npc: 0.22, farmer: 0.06, villager: 0.13, beggar: 0.02 },
        byTown: { village: 0.7, town: 1, city: 1.25, capital: 1.45 }, byEra: [0.75, 0.9, 1.1, 1.3], lettered: [55, 90], unlettered: [0, 35],
    },
    estimate: { byType: { village: 0.05, town: 0.13, city: 0.22, capital: 0.3 }, eraStep: 0.03, school: 0.1, church: 0.04, guild: 0.05, driftPerYear: 0.12 },
    effects: { span: 0.5, tax: [0.93, 1.07], lawStability: [1.3, 0.6], notices: [0.6, 1.4], oralDistort: [1.35, 0.8], writtenSpread: [0.3, 1.8], bankTrust: [-0.08, 0.12] },
    letters: { aloudDays: [1, 3], noReaderDays: [3, 6], leakChance: 0.3, leakWeight: {}, readerLiteracy: 50 },
    player: { base: 15, perIntelligence: 5, station: {}, scribeFee: 2, readPace: [0.6, 1], practicePerSitting: 0.4, lessons: { fee: 6, gain: 7, cap: 95, perDay: 1 } },
    heirs: { startAge: 5, endAge: 16, home: 2, literateParent: 3, tutor: 9, focus: {} },
    endow: { cost: 400, materials: { planks: 20, stone: 15 }, endowShare: 0.4, wage: 8, fund: 4, everyDays: 30, graceMonths: 2, regard: 8, prestigeScale: 2 },
    church: { types: ['city', 'capital'], townShare: 0.35, tithe: 12 },
    guild: { minTreasury: 60, give: 15, share: 0.1 },
    pamphlet: { cost: 30, spreads: 4, heat: 6, days: 40 },
};

const LETTERED_ROLES = ['priest', 'noble', 'merchant'];

let _cfg = null;
let _cfgSrc;

const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _day = world => _num(world && world.day, 1);
const _seed = world => (world && world.generationParams && world.generationParams.seed) || 1;
const _key = (q, r) => `${q},${r}`;
function _h(...parts) { return ((Utils.hashStr(parts.join('|')) >>> 0) % 1000003) / 1000003; }
function _between(range, u) { const [a, b] = Array.isArray(range) ? range : [0, 0]; return Math.round(_num(a) + (_num(b) - _num(a)) * u); }
function _Y() { return Math.max(1, _num(Townsfolk.config().daysPerYear, 120)); }
function _tile(world, q, r) { return world && typeof world.getTile === 'function' && Number.isFinite(q) ? world.getTile(q, r) : null; }
function _views(world) { return world && typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : []; }

export const Literacy = {
    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.literacy : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            _cfg = { ...DEFAULTS, ...d };
            for (const k of ['baseline', 'estimate', 'effects', 'letters', 'player', 'heirs', 'endow', 'church', 'guild', 'pamphlet']) _cfg[k] = { ...DEFAULTS[k], ...(_obj(d[k]) || {}) };
            _cfg.player.lessons = { ...DEFAULTS.player.lessons, ...(_obj(_cfg.player.lessons) || {}) };
        }
        return _cfg;
    },

    // ──────────── THE PEOPLE ────────────

    /** A grown townsperson's letters the school book never set: from their trade, the town's size and era. */
    baselineFor(world, settlement, p) {
        const B = Literacy.config().baseline;
        const role = (p && (p.retired || p.role)) || 'villager';
        const type = (settlement && settlement.type) || 'village';
        const era = Literacy._eraIndex(settlement);
        const share = _num(B.roles[role], 0.13) * _num(B.byTown[type], 1) * _num((B.byEra || [])[era], 1);
        const at = `${_seed(world)}|${settlement ? _key(settlement.q, settlement.r) : '-'}|${p && p.id}`;
        return _h(at, 'lit') < share ? _between(B.lettered, _h(at, 'lv')) : _between(B.unlettered, _h(at, 'lv'));
    },

    _eraIndex(settlement) {
        const st = TownEras.state(settlement);
        const h = st && Array.isArray(st.history) ? st.history : [];
        if (!h.length) return 0;
        return Math.max(0, TownEras.eraIndex(h[h.length - 1][0]));
    },

    /** A person's letters 0–100, or null if unknown. */
    personLevel(p) {
        if (!p) return null;
        if (typeof p.literacy === 'number') return p.literacy;
        return TownSchool.literacy(p);
    },

    /** Can this townsperson read? (unknown — not yet reckoned — counts as yes: the old way) */
    personReads(p) {
        const lv = Literacy.personLevel(p);
        if (lv != null) return lv >= Literacy.config().readAt;
        return true;
    },

    /** Give every grown resident the school book never saw their letters (once, kept on the person). */
    seedFolk(world, settlement, day) {
        const folk = settlement && settlement.folk;
        if (!_obj(folk) || !Array.isArray(folk.people)) return 0;
        const since = folk.school && Number.isFinite(folk.school.since) ? folk.school.since : null;
        const Y = Townsfolk.config().daysPerYear;
        const grown = Townsfolk.config().comeOfAge;
        let n = 0;
        for (const p of Townsfolk.residents(folk)) {
            if (typeof p.literacy === 'number' || p.school || Townsfolk.age(p, day) < grown) continue;
            // (one born after the school book opened is settled by TownSchool at 16)
            if (since != null && p.born > since - 16 * Y) continue;
            p.literacy = Literacy.baselineFor(world, settlement, p);
            n++;
        }
        return n;
    },

    // ──────────── THE TOWN ────────────

    state(settlement) {
        if (!settlement) return null;
        if (!_obj(settlement.letters)) settlement.letters = { rate: null, d: null, known: 0, hist: [] };
        if (!Array.isArray(settlement.letters.hist)) settlement.letters.hist = [];
        return settlement.letters;
    },

    /** The town's reckoned rate (0–1), or null if it has never been reckoned (then every effect is neutral). */
    rate(world, settlement) {
        const L = settlement && _obj(settlement.letters);
        return L && typeof L.rate === 'number' ? L.rate : null;
    },

    /** What the town's letters would be by its size, era and schools. */
    target(world, settlement) {
        const E = Literacy.config().estimate;
        const C = Literacy.config();
        if (!settlement) return 0;
        const type = settlement.type || 'village';
        let t = _num(E.byType[type], 0.1) + Literacy._eraIndex(settlement) * _num(E.eraStep, 0.03);
        const sc = settlement.folk && settlement.folk.school;
        if (sc && (sc.founded || sc.endowed)) t += _num(E.school, 0.1);
        if ((sc && sc.church) || (C.church.types || []).includes(type)) t += _num(E.church, 0.04);
        if ((sc && sc.guild) || Guilds.townGuilds(settlement)) t += _num(E.guild, 0.05);
        return _clamp(t, 0, 0.95);
    },

    /** Reckon a town: seed its folk, measure (or drift the estimate), sample the year; the church and guild schools pay in. */
    refresh(world, settlement, day = _day(world)) {
        const C = Literacy.config();
        const st = Literacy.state(settlement);
        const Y = _Y();
        const folk = _obj(settlement.folk) && Array.isArray(settlement.folk.people) ? settlement.folk : null;
        let measured = null;
        if (folk) {
            Literacy.seedFolk(world, settlement, day);
            const lit = TownSchool.townLiteracy(folk, day);
            st.known = lit.known;
            if (lit.known >= _num(C.minKnown, 6)) measured = lit.share;
        }
        const target = Literacy.target(world, settlement);
        if (measured != null) {
            st.rate = measured;
            st.src = 'folk';
        } else if (typeof st.rate !== 'number') {
            st.rate = target;
            st.src = 'est';
        } else {
            const dt = st.d != null ? Math.max(0, day - st.d) : 0;
            st.rate = st.rate + (target - st.rate) * Math.min(1, _num(C.estimate.driftPerYear, 0.12) * dt / Y);
            st.src = 'est';
        }
        st.rate = Math.round(_clamp(st.rate, 0, 1) * 10000) / 10000;
        st.d = day;
        const year = Math.floor(day / Y);
        const last = st.hist[st.hist.length - 1];
        if (!last || last[0] < year) {
            st.hist.push([year, Math.round(st.rate * 1000) / 10]);
            if (st.hist.length > _num(C.histCap, 200)) st.hist.splice(0, st.hist.length - _num(C.histCap, 200));
            if (folk && last) Literacy._patrons(world, settlement, folk, day);
        }
        return st.rate;
    },

    /** The church's and the guild's money for the town's school (once a year). */
    _patrons(world, settlement, folk, day) {
        const C = Literacy.config();
        const sc = TownSchool.state(folk);
        const type = settlement.type || 'village';
        // The church endows a school in the great towns (and some lesser ones), out of the tithe
        const priest = TownSchool.priest(folk);
        if (priest && ((C.church.types || []).includes(type) || _h(_seed(world), settlement.q, settlement.r, 'churchSchool') < _num(C.church.townShare, 0.35))) {
            if (!sc.church) sc.church = { d: day };
            const got = Economy.drawTown(settlement, _num(C.church.tithe, 12));
            if (got > 0) { sc.fund = _num(sc.fund) + got; sc.church.given = Math.round(_num(sc.church.given) + got); }
        }
        // The richest guild keeps its apprentices at their letters, out of its guildhall
        const gs = Guilds.townGuilds(settlement);
        if (gs) {
            const best = Object.entries(gs).filter(([, g]) => _obj(g) && _num(g.treasury) >= _num(C.guild.minTreasury, 60))
                .sort((a, b) => _num(b[1].treasury) - _num(a[1].treasury) || (a[0] < b[0] ? -1 : 1))[0];
            if (best) {
                const [gid, g] = best;
                const give = Math.round(Math.min(_num(C.guild.give, 15), _num(g.treasury) * _num(C.guild.share, 0.1)) * 100) / 100;
                if (give > 0) {
                    g.treasury = Math.round((_num(g.treasury) - give) * 100) / 100;
                    sc.fund = _num(sc.fund) + give;
                    const def = Guilds.def(gid);
                    sc.guild = { id: gid, name: g.name || (def && def.name) || 'the guild', d: (sc.guild && sc.guild.d) || day, given: Math.round(_num(sc.guild && sc.guild.given) + give) };
                }
            }
        }
    },

    /** The realm's letters: its reckoned towns, weighted by people. null if none reckoned. */
    realmRate(world, kingdomId) {
        if (kingdomId == null) return null;
        let w = 0, sum = 0;
        for (const s of _views(world)) {
            if (!s || s.kingdom !== kingdomId) continue;
            const r = Literacy.rate(world, s);
            if (r == null) continue;
            const pop = Math.max(1, _num(s.population, 100));
            w += pop; sum += r * pop;
        }
        return w > 0 ? sum / w : null;
    },

    /** The rate some years ago (from the yearly samples), as 0–1, or null. */
    rateYearsAgo(settlement, years, day) {
        const L = settlement && _obj(settlement.letters);
        if (!L || !Array.isArray(L.hist) || !L.hist.length) return null;
        const want = Math.floor(_num(day) / _Y()) - years;
        let best = null;
        for (const [y, pct] of L.hist) if (y <= want) best = pct;
        return best == null ? null : best / 100;
    },

    // ──────────── WHAT IT DOES ────────────

    /** A factor between lo (no one reads) and hi (span or more can write); `fallback` when the rate is unknown. */
    factor(key, rate, fallback = 1) {
        if (rate == null || !Number.isFinite(rate)) return fallback;
        const E = Literacy.config().effects;
        const [lo, hi] = Array.isArray(E[key]) ? E[key] : [1, 1];
        const t = _clamp(rate / Math.max(0.01, _num(E.span, 0.5)), 0, 1);
        return lo + (hi - lo) * t;
    },

    /** Taxes collected in this town (×). */
    taxFactor(world, settlement) { return Literacy.factor('tax', Literacy.rate(world, settlement)); },
    /** The stability a realm's new law costs (×): a posted law is understood. */
    lawStabilityFactor(world, kingdomId) { return Literacy.factor('lawStability', Literacy.realmRate(world, kingdomId)); },
    /** The watch knowing a wanted face from the posters on the notice board (×). */
    noticeFactor(world, settlement) { return Literacy.factor('notices', Literacy.rate(world, settlement)); },
    /** How readily word of mouth changes a tale (×). */
    oralDistort(world, settlement) { return Literacy.factor('oralDistort', Literacy.rate(world, settlement)); },
    /** How readily a written tale reaches this town (×). */
    writtenSpread(world, settlement) { return Literacy.factor('writtenSpread', Literacy.rate(world, settlement)); },
    /** A bank's trust here: written receipts and contracts (+). */
    bankTrust(world, settlement) { return Literacy.factor('bankTrust', Literacy.rate(world, settlement), 0); },

    /** The settlement at "q,r". */
    at(world, key) {
        const [q, r] = String(key || '').split(',').map(Number);
        const t = _tile(world, q, r);
        return (t && t.settlement) || null;
    },

    // ──────────── THE PLAYER'S OWN LETTERS ────────────

    /** player.literacy: { lv, of (whose letters), lessonDay, schools: ["q,r"] } */
    record(player) {
        if (!player) return null;
        if (!_obj(player.literacy)) player.literacy = { lv: null, of: null, lessonDay: null, schools: [] };
        if (!Array.isArray(player.literacy.schools)) player.literacy.schools = [];
        return player.literacy;
    },

    _who(player) { return String((player && (player.name || player.firstName)) || ''); },

    /** The player's letters 0–100, or null while not yet reckoned for this life (everything reads as before). */
    level(player) {
        const r = player && _obj(player.literacy);
        if (!r || typeof r.lv !== 'number' || r.of !== Literacy._who(player)) return null;
        return r.lv;
    },

    canRead(player) { const lv = Literacy.level(player); return lv == null || lv >= Literacy.config().readAt; },
    canWrite(player) { const lv = Literacy.level(player); return lv == null || lv >= Literacy.config().writeAt; },

    /** A new life's letters: their wits and their station. */
    derive(player) {
        const P = Literacy.config().player;
        const S = _obj(P.station) || {};
        let bonus = 0;
        const kinds = [player.scenario && player.scenario.start && player.scenario.start.kind, player.origin && player.origin.station];
        if (player.throne && player.throne.ruling) kinds.push('royal');
        for (const k of kinds) if (k && S[k] != null) bonus = Math.max(bonus, _num(S[k]));
        return Math.round(_clamp(_num(P.base, 15) + _num(player.intelligence, 5) * _num(P.perIntelligence, 5) + bonus, 0, 100));
    },

    /** Reckon the player's letters for this life (once), keeping the House's schools. */
    ensurePlayer(player) {
        if (!player) return null;
        const r = Literacy.record(player);
        if (typeof r.lv !== 'number' || r.of !== Literacy._who(player)) {
            r.lv = Literacy.derive(player);
            r.of = Literacy._who(player);
            r.lessonDay = null;
        }
        return r;
    },

    /** The heir's letters carried into rule (systems/relationships/family.js succeedAsHeir). */
    takeHeir(player, child) {
        const r = Literacy.record(player);
        r.lv = typeof (child && child.literacy) === 'number' ? Math.round(child.literacy) : Math.max(Literacy.config().writeAt, Literacy.derive(player));
        r.of = Literacy._who(player);
        r.lessonDay = null;
    },

    /** Null if the player may read a book; else the reason. */
    readingGate(player) {
        if (Literacy.canRead(player)) return null;
        return 'The letters are only marks to you. You cannot read yet: a schoolmaster or a priest will teach you your letters (a town\'s School panel).';
    },

    /** How fast the player reads (×): halting near readAt, full pace when well lettered. */
    readingPace(player) {
        const lv = Literacy.level(player);
        if (lv == null) return 1;
        const C = Literacy.config();
        const [slow, full] = Array.isArray(C.player.readPace) ? C.player.readPace : [0.6, 1];
        return slow + (full - slow) * _clamp((lv - C.readAt) / 40, 0, 1);
    },

    /** A little better for every sitting with a book. */
    practice(player, n = null) {
        const lv = Literacy.level(player);
        if (lv == null) return;
        const C = Literacy.config();
        player.literacy.lv = Math.round(Math.min(100, lv + (n == null ? _num(C.player.practicePerSitting, 0.4) : n) * (1 - lv / 110)) * 100) / 100;
    },

    /** The scribe's fee for a letter (0 if the player writes their own). */
    scribeFee(player) { return Literacy.canWrite(player) ? 0 : Math.max(0, Math.round(_num(Literacy.config().player.scribeFee, 2))); },

    /** Pay the scribe (into the purse of the town you stand in). → the fee paid */
    payScribe(player, world) {
        const fee = Literacy.scribeFee(player);
        if (!(fee > 0)) return 0;
        player.gold = _num(player.gold) - fee;
        Ledger.record(player, 'schools', -fee);
        const t = _tile(world, player.q, player.r);
        if (t && t.settlement) Economy.payTown(t.settlement, fee);
        return fee;
    },

    /**
     * A letter come for a player who can't read: the town's scribe reads it out
     * (a fee into the town's purse) or, on the road, whoever rides with them.
     * → the note for the letter, or null when the player reads it themselves.
     */
    readToPlayer(player, world) {
        if (Literacy.canRead(player)) return null;
        const t = _tile(world, player.q, player.r);
        const s = t && t.settlement;
        const reader = s ? Literacy.teacher(world, s) : null;
        const fee = Math.max(0, Math.round(_num(Literacy.config().player.scribeFee, 2)));
        if (reader && _num(player.gold) >= fee) {
            player.gold = _num(player.gold) - fee;
            Ledger.record(player, 'schools', -fee);
            Townsfolk.purse(s.folk, reader, world);
            reader.purse = _num(reader.purse) + fee;
            return `(You cannot read it: ${Townsfolk.name(reader)} read it out to you for ${fee}g.)`;
        }
        return '(You cannot read it: someone you trust read it out to you, and knows what it says.)';
    },

    /** The town's teacher for a grown pupil: the schoolmaster, else the priest. */
    teacher(world, settlement, day = _day(world)) {
        const folk = settlement && settlement.folk;
        if (!_obj(folk) || !Array.isArray(folk.people)) return null;
        return TownSchool.master(world, folk, day) || TownSchool.priest(folk);
    },

    lessonTerms(player, world, settlement) {
        const C = Literacy.config();
        const L = C.player.lessons;
        const t = Literacy.teacher(world, settlement);
        const lv = Literacy.level(player);
        const fee = Math.round(_num(L.fee, 6));
        const out = { ok: false, fee, teacher: t ? Townsfolk.name(t) : null, lv };
        if (!t) return { ...out, reason: 'No one here keeps a school to teach you.' };
        if (lv == null) return { ...out, reason: 'Your letters have not been reckoned yet (a day passes first).' };
        if (lv >= _num(L.cap, 95)) return { ...out, reason: 'There is nothing more a schoolmaster can teach you.' };
        const r = Literacy.record(player);
        if (r.lessonDay === _day(world)) return { ...out, reason: 'You have had your lesson today.' };
        if (_num(player.gold) < fee) return { ...out, reason: `A lesson costs ${fee}g.` };
        return { ...out, ok: true };
    },

    /** An hour at the teacher's table: the fee into their purse, a little more of your letters. → { success, text|reason } */
    takeLesson(player, world, settlement) {
        const can = Literacy.lessonTerms(player, world, settlement);
        if (!can.ok) return { success: false, reason: can.reason };
        const C = Literacy.config();
        const t = Literacy.teacher(world, settlement);
        const folk = settlement.folk;
        player.gold = _num(player.gold) - can.fee;
        Ledger.record(player, 'schools', -can.fee);
        Townsfolk.purse(folk, t, world);
        t.purse = _num(t.purse) + can.fee;
        const r = Literacy.record(player);
        const before = r.lv;
        const wits = 0.7 + _num(player.intelligence, 5) * 0.06;
        r.lv = Math.round(Math.min(_num(C.player.lessons.cap, 95), before + _num(C.player.lessons.gain, 7) * wits * (1 - before / 120)) * 100) / 100;
        r.lessonDay = _day(world);
        let text = `${can.teacher} sets you letters to copy and hears you read. (Your letters ${Math.floor(before)} → ${Math.floor(r.lv)}.)`;
        if (before < C.readAt && r.lv >= C.readAt) text += ' The marks are words now: you can read.';
        else if (before < C.writeAt && r.lv >= C.writeAt) text += ' You can write a fair letter in your own hand: no more scribes.';
        return { success: true, text };
    },

    // ──────────── THE HEIRS ────────────

    /** A season of a child's letters: at home (more with a lettered parent), a tutor, the focus. */
    _heirs(player, world, days) {
        const H = Literacy.config().heirs;
        const Y = _Y();
        for (const c of player.children || []) {
            if (!c || c.isAlive === false) continue;
            const age = _num(c.age);
            const up = _obj(c.upbringing);
            if (age < _num(H.startAge, 5) || age >= _num(H.endAge, 16) || (up && up.comeOfAge)) continue;
            let per = _num(H.home, 2) + (Literacy.canWrite(player) ? _num(H.literateParent, 3) : 0);
            if (up && up.tutor) per += _num(H.tutor, 9) * Math.max(0.5, _num(up.tutor.quality, 1));
            if (up && up.focus) per += _num((H.focus || {})[up.focus]);
            c.literacy = Math.round(Math.min(100, _num(c.literacy) + per * days / Y) * 100) / 100;
        }
    },

    // ──────────── LETTERS TO THOSE WHO CAN'T READ ────────────

    /** Can the recipient of a letter read it themselves? */
    recipientReads(world, to, sub = {}) {
        if (!to) return true;
        if (to.type === 'folk') return sub.person ? Literacy.personReads(sub.person) : true;
        if (to.type === 'npc') {
            const npc = sub.npc || {};
            if (npc.folkUid) {
                const m = /^(-?\d+),(-?\d+)#(.+)$/.exec(String(npc.folkUid));
                const t = m ? _tile(world, Number(m[1]), Number(m[2])) : null;
                const folk = t && t.settlement && t.settlement.folk;
                const p = folk ? Townsfolk.get(folk, Number.isFinite(Number(m[3])) ? Number(m[3]) : m[3]) : null;
                if (p) return Literacy.personReads(p);
            }
            const occ = String(npc.occupation || '').toLowerCase();
            if (/noble|merchant|scholar|priest|scribe|clerk|physician|lord|lady|teacher|schoolmaster/.test(occ)) return true;
            const s = _tile(world, to.q, to.r);
            const rate = s && s.settlement ? Literacy.rate(world, s.settlement) : null;
            return rate == null || _h('npcReads', npc.id) < _clamp(rate * 1.4, 0.05, 0.95);
        }
        return true;
    },

    /** Who reads a letter aloud in a town: the priest, the schoolmaster, a lettered neighbour (kin first). */
    readerFor(world, settlement, person = null) {
        const folk = settlement && settlement.folk;
        if (!_obj(folk) || !Array.isArray(folk.people)) return null;
        const need = Literacy.config().letters.readerLiteracy;
        const kin = person ? new Set([person.spouse, ...(person.kids || []), ...(person.parents || [])].filter(x => x != null)) : new Set();
        const able = Townsfolk.residents(folk).filter(x => x !== person && x.role !== 'child' && _num(Literacy.personLevel(x), LETTERED_ROLES.includes(x.retired || x.role) ? 80 : 0) >= need);
        if (!able.length) return null;
        const score = x => (kin.has(x.id) ? 0 : x.role === 'priest' ? 1 : x.teaches ? 2 : 3) + _h(_seed(world), folk.q, folk.r, 'reader', person ? person.id : '-', x.id);
        able.sort((a, b) => score(a) - score(b));
        return able[0];
    },

    /**
     * A letter at the door of one who can't read (systems/mail.js _resolve, after
     * the road): it waits for its reader. → true when the letter waits (come back
     * on L.arriveDay), false when it is read now (or never needed reading).
     * Draws from the letter's own seeded stream (Utils, inside Mail's withRng).
     */
    atDoor(world, player, L, to, sub = {}) {
        if (!Literacy.config().enabled || !L) return false;
        if (L.aloud) return false;
        if (Literacy.recipientReads(world, to, sub)) return false;
        const T = Literacy.config().letters;
        const t = _tile(world, to.q, to.r);
        const s = t && t.settlement;
        const reader = Literacy.readerFor(world, s, sub.person || null);
        const [lo, hi] = reader ? T.aloudDays : T.noReaderDays;
        const wait = Utils.randInt(Math.max(0, _num(lo, 1)), Math.max(_num(lo, 1), _num(hi, 3)));
        L.aloud = { by: reader ? (reader.role === 'priest' ? `${reader.gender === 'female' ? 'Mother' : 'Father'} ${reader.first}` : Townsfolk.name(reader)) : 'a passing clerk', role: reader ? reader.role : null, pid: reader ? reader.id : null, wait };
        if (!(wait > 0)) return false;
        L.arriveDay = _day(world) + wait;
        return true;
    },

    /** The letter read aloud: the reader knows it now, and may tell it. → a line for the delivery note ('' if none). */
    afterAloud(world, player, L, to, out = null) {
        const A = L && L.aloud;
        if (!A) return '';
        const T = Literacy.config().letters;
        const w = _num((T.leakWeight || {})[L.kind], 1);
        let leak = Utils.random() < _num(T.leakChance, 0.3) * w;
        // (a priest keeps a confidence more often than a neighbour)
        if (leak && A.role === 'priest' && Utils.random() < 0.5) leak = false;
        A.leaked = leak;
        let line = ` (${A.by} read it aloud to them${A.wait ? `, ${A.wait} day${A.wait === 1 ? '' : 's'} late` : ''}.)`;
        if (!leak || !player) return line;
        const t = _tile(world, to.q, to.r);
        Gossip.spreadDeed(player, world, 'letter_aloud', { q: to.q, r: to.r, location: to.place, kingdom: t && t.settlement ? t.settlement.kingdom : to.kingdomId, victim: to.name });
        if (L.kind === 'love' && player.spouse && to.type !== 'spouse') {
            Gossip.spreadDeed(player, world, 'affair', { q: to.q, r: to.r, location: to.place, kingdom: t && t.settlement ? t.settlement.kingdom : to.kingdomId, victim: to.name });
        }
        line += ` ${A.by} has told the town what was in it.`;
        if (out) out.notices.push({ icon: '📖', title: 'Read Aloud', text: `Your letter to ${to.name} was read out to them by ${A.by} — and now ${to.place || 'the town'} knows what you wrote.`, type: 'warning' });
        return line;
    },

    // ──────────── ENDOWING A SCHOOL ────────────

    /** The town's lettered grown folk who could keep a school: [{ id, name, lit, age }]. */
    masterCandidates(world, settlement, day = _day(world)) {
        const folk = settlement && settlement.folk;
        if (!_obj(folk) || !Array.isArray(folk.people)) return [];
        return Townsfolk.residents(folk)
            .filter(x => x.role !== 'child' && x.role !== 'guard' && Townsfolk.age(x, day) >= 25 && Townsfolk.age(x, day) < 70
                && _num(Literacy.personLevel(x), LETTERED_ROLES.includes(x.retired || x.role) ? 80 : 0) >= 60)
            .map(x => ({ id: x.id, name: Townsfolk.name(x), lit: Math.round(_num(Literacy.personLevel(x), 80)), age: Townsfolk.age(x, day), role: Townsfolk.roleTitle(x) }))
            .sort((a, b) => b.lit - a.lit || a.id - b.id);
    },

    _materials(player, settlement) {
        const E = Literacy.config().endow;
        const need = _obj(E.materials) || {};
        const fromPacks = {}, toBuy = {};
        let cost = 0, short = null;
        for (const [id, n] of Object.entries(need)) {
            const have = Math.max(0, Math.floor(_num(player && player.inventory && player.inventory[id])));
            const take = Math.min(have, n);
            if (take > 0) fromPacks[id] = take;
            const buy = n - take;
            if (buy > 0) {
                if (SettlementMarket.stock(settlement, id) + 1e-9 < buy) { short = short || id; continue; }
                let k = 1;
                try { k = SettlementMarket.scarcity(settlement, id); } catch { k = 1; }
                cost += Math.max(1, Math.round(Math.max(1, PlayerInventory.goodValue(id) || 1) * (Number.isFinite(k) ? k : 1))) * buy;
                toBuy[id] = buy;
            }
        }
        return { fromPacks, toBuy, cost: Math.ceil(cost), short };
    },

    /** May the player endow a school here? → { ok, reason?, cost, goodsCost, total, materials, candidates, wage, fund } */
    endowTerms(player, world, settlement) {
        const C = Literacy.config();
        const E = C.endow;
        const cost = Math.round(_num(E.cost, 400));
        const out = { ok: false, cost, goodsCost: 0, total: cost, wage: _num(E.wage, 8), fund: _num(E.fund, 4), every: _num(E.everyDays, 30), candidates: [], materials: null };
        if (!C.enabled || !player || !settlement || !_obj(settlement.folk)) return { ...out, reason: 'There are no townsfolk here you know to school.' };
        const sc = settlement.folk.school;
        if (sc && sc.endowed && !sc.endowed.closed) return { ...out, reason: `${settlement.name || 'The town'} already keeps the school you endowed.` };
        if (sc && sc.founded) return { ...out, reason: `${settlement.name || 'The town'} already has its town school.` };
        const candidates = Literacy.masterCandidates(world, settlement);
        const mats = Literacy._materials(player, settlement);
        const res = { ...out, candidates, materials: mats, goodsCost: mats.cost, total: cost + mats.cost };
        if (!candidates.length) return { ...res, reason: 'No one in the town is lettered enough to keep a school.' };
        if (mats.short) return { ...res, reason: `Neither your packs nor ${settlement.name || 'the town'}'s market have the ${mats.short} to build it.` };
        if (_num(player.gold) < res.total) return { ...res, reason: `Endowing a school costs ${res.total}g with its materials.` };
        return { ...res, ok: true };
    },

    /**
     * Endow a school: the coin (part to its fund, the rest to the town's masons
     * and joiners), planks and stone (packs first, the rest bought off its
     * market), the chosen schoolmaster hired. A town school from now on.
     * → { success, text|reason }
     */
    endow(player, world, settlement, masterId = null) {
        const can = Literacy.endowTerms(player, world, settlement);
        if (!can.ok) return { success: false, reason: can.reason };
        const C = Literacy.config();
        const E = C.endow;
        const day = _day(world);
        const folk = settlement.folk;
        const pick = can.candidates.find(c => String(c.id) === String(masterId)) || can.candidates[0];
        const m = Townsfolk.get(folk, pick.id);
        // The materials
        for (const [id, n] of Object.entries(can.materials.fromPacks)) {
            player.inventory[id] = Math.max(0, _num(player.inventory[id]) - n);
            if (!player.inventory[id]) delete player.inventory[id];
        }
        for (const [id, n] of Object.entries(can.materials.toBuy)) SettlementMarket.take(settlement, id, n);
        // The coin
        player.gold = _num(player.gold) - can.total;
        Ledger.record(player, 'schools', -can.total);
        const endow = Math.round(can.cost * _num(E.endowShare, 0.4));
        Economy.payTown(settlement, can.total - endow);
        const sc = TownSchool.state(folk);
        sc.fund = _num(sc.fund) + endow;
        const by = player.firstName || player.name || 'a patron';
        sc.founded = { d: day, by, payer: 'patron' };
        sc.endowed = { d: day, by, house: player.house ? player.house.name || null : null, wage: _num(E.wage, 8), fund: _num(E.fund, 4), paid: day, missed: 0, closed: null };
        // The schoolmaster
        const old = Townsfolk.get(folk, sc.master);
        if (old && old !== m) delete old.teaches;
        sc.master = m.id;
        m.teaches = 'schoolmaster';
        TownSchool._regard(m, _num(E.regard, 8) * 2);
        for (const p of Townsfolk.residents(folk)) if (p.role === 'child') for (const k of TownSchool._keepers(folk, p)) TownSchool._regard(k, _num(E.regard, 8));
        const rec = Literacy.record(player);
        const key = _key(settlement.q, settlement.r);
        if (!rec.schools.includes(key)) rec.schools.push(key);
        Townsfolk._annal(folk, world, day, { k: 'schoolFounded', a: m.id, b: null, x: by }, []);
        House.recordPlayerDeed(player, world, 'schoolFunded', { reason: `endowed the school of ${settlement.name || 'a town'}`, scale: _num(E.prestigeScale, 2) });
        const goods = Object.entries(_obj(E.materials) || {}).map(([id, n]) => `${n} ${id}`).join(' and ');
        return { success: true, text: `You endow a school in ${settlement.name || 'the town'}, with ${Townsfolk.name(m)} as its master. ${can.total}g (${goods}${can.goodsCost ? `, ${can.goodsCost}g of it bought here` : ''}), ${endow}g of it to the school's fund. From your purse each month: ${sc.endowed.wage}g wage and ${sc.endowed.fund}g to the fund.` };
    },

    /** Stop paying for a school you endowed: it closes (its building stays the town's). */
    closeEndowment(player, world, settlement, why = 'You stop paying for it') {
        const sc = settlement && settlement.folk && settlement.folk.school;
        if (!sc || !sc.endowed || sc.endowed.closed) return { success: false, reason: 'You keep no school here.' };
        sc.endowed.closed = _day(world);
        if (sc.founded && sc.founded.payer === 'patron') delete sc.founded;
        const rec = Literacy.record(player);
        rec.schools = rec.schools.filter(k => k !== _key(settlement.q, settlement.r));
        return { success: true, text: `${why}: the school of ${settlement.name || 'the town'} closes its doors, and its children go back to the fields and the workshop.` };
    },

    /** Each month: the schoolmaster's wage and the fund, from the player's purse. */
    _upkeep(world, player, out) {
        const rec = player && _obj(player.literacy);
        if (!rec || !Array.isArray(rec.schools) || !rec.schools.length) return;
        const day = _day(world);
        const E = Literacy.config().endow;
        for (const key of rec.schools.slice()) {
            const s = Literacy.at(world, key);
            const sc = s && s.folk && s.folk.school;
            const en = sc && sc.endowed;
            if (!en || en.closed) { rec.schools = rec.schools.filter(k => k !== key); continue; }
            if (day - _num(en.paid, day) < _num(E.everyDays, 30)) continue;
            en.paid = day;
            const due = _num(en.wage) + _num(en.fund);
            if (_num(player.gold) < due) {
                en.missed = _num(en.missed) + 1;
                if (en.missed > _num(E.graceMonths, 2)) {
                    const r = Literacy.closeEndowment(player, world, s, `Unpaid ${en.missed} months`);
                    out.notices.push({ icon: '🏫', title: 'A School Closes', text: r.text, type: 'warning' });
                } else {
                    out.notices.push({ icon: '🏫', title: 'The Schoolmaster Unpaid', text: `You could not pay ${due}g for the school of ${s.name || 'the town'} this month (${en.missed} of ${_num(E.graceMonths, 2)} before it closes).`, type: 'warning' });
                }
                continue;
            }
            en.missed = 0;
            player.gold = _num(player.gold) - due;
            Ledger.record(player, 'schools', -due);
            const m = TownSchool.master(world, s.folk, day);
            if (m) { Townsfolk.purse(s.folk, m, world); m.purse = _num(m.purse) + _num(en.wage); } else Economy.payTown(s, _num(en.wage));
            sc.fund = _num(sc.fund) + _num(en.fund);
            en.spent = Math.round(_num(en.spent) + due);
        }
    },

    // ──────────── BROADSHEETS ────────────

    /** Have a tale printed and posted: costs the printer's coin, spreads by the letters of the towns it reaches. */
    pamphletTerms(player, world, id, q, r) {
        const P = Literacy.config().pamphlet;
        const sc = Whispers._live(player, id);
        const cost = Math.round(_num(P.cost, 30));
        if (!sc) return { ok: false, cost, reason: 'That talk has run its course.' };
        if (!sc.spreadTo.includes(_key(q, r))) return { ok: false, cost, reason: 'Nobody here is telling that tale.' };
        if (sc.written && _day(world) - _num(sc.written.d) < _num(P.days, 40)) return { ok: false, cost, reason: 'Broadsheets of it are posted already.' };
        if (_num(player.gold) < cost) return { ok: false, cost, reason: `The printer wants ${cost}g.` };
        return { ok: true, cost };
    },

    pamphlet(player, world, id, q, r) {
        const can = Literacy.pamphletTerms(player, world, id, q, r);
        if (!can.ok) return { ok: false, reason: can.reason };
        const P = Literacy.config().pamphlet;
        const sc = Whispers._live(player, id);
        const t = _tile(world, q, r);
        const s = t && t.settlement;
        player.gold = _num(player.gold) - can.cost;
        if (s) Economy.payTown(s, can.cost);
        sc.written = { d: _day(world), by: 'player' };
        sc.fannedByPlayer = true;
        const rate = s ? Literacy.rate(world, s) : null;
        sc.extra = _num(sc.extra) + Math.round(_num(P.heat, 6) * Literacy.factor('writtenSpread', rate));
        let reached = 0;
        for (let i = 0; i < _num(P.spreads, 4); i++) if (Whispers._spread(sc, world)) reached++;
        sc.heat = Whispers._heat(sc, world);
        const readers = rate == null ? '' : ` About ${Math.round(rate * 100)} in 100 here can read them.`;
        return { ok: true, text: `Broadsheets of the tale of ${sc.subject.name} go up on the doors and the market cross${reached ? `, and copies ride on to ${reached} more town${reached === 1 ? '' : 's'}` : ''}. Written down, it is told as it was written (heat ${sc.heat}).${readers}` };
    },

    // ──────────── THE VIEW ────────────

    /** The School panel's view of a town. */
    view(player, world, settlement) {
        const day = _day(world);
        const folk = settlement && _obj(settlement.folk) ? settlement.folk : null;
        if (settlement && Literacy.rate(world, settlement) == null) Literacy.refresh(world, settlement, day);
        const rate = Literacy.rate(world, settlement);
        const sc = folk ? TownSchool.state(folk) : null;
        const sv = folk ? TownSchool.view(world, settlement, folk, day) : null;
        const ago = [10, 30, 60].map(y => ({ years: y, rate: Literacy.rateYearsAgo(settlement, y, day) })).filter(x => x.rate != null);
        return {
            name: settlement ? settlement.name : '', type: settlement ? settlement.type : '', rate, src: settlement && settlement.letters ? settlement.letters.src : null,
            known: settlement && settlement.letters ? _num(settlement.letters.known) : 0, ago,
            school: sv, fund: sc ? Math.floor(_num(sc.fund)) : 0,
            founded: sc && sc.founded ? sc.founded : null, endowed: sc && sc.endowed && !sc.endowed.closed ? sc.endowed : null,
            church: sc && sc.church ? sc.church : null, guild: sc && sc.guild ? sc.guild : null,
            effects: {
                tax: Literacy.taxFactor(world, settlement), notices: Literacy.noticeFactor(world, settlement), oral: Literacy.oralDistort(world, settlement),
                written: Literacy.writtenSpread(world, settlement), trust: Literacy.bankTrust(world, settlement),
                law: settlement && settlement.kingdom != null ? Literacy.lawStabilityFactor(world, settlement.kingdom) : 1,
            },
            you: { lv: Literacy.level(player), canRead: Literacy.canRead(player), canWrite: Literacy.canWrite(player) },
            children: (player && player.children || []).filter(c => c && c.isAlive !== false).map(c => ({ name: c.firstName, age: _num(c.age), lit: typeof c.literacy === 'number' ? Math.floor(c.literacy) : null, tutor: !!(c.upbringing && c.upbringing.tutor) })),
        };
    },

    /** One line for the town info box: "18 in 100 (↑ from 12, 30 yrs ago)", or null. */
    infoLine(world, settlement) {
        const rate = Literacy.rate(world, settlement);
        if (rate == null) return null;
        const past = Literacy.rateYearsAgo(settlement, 30, _day(world)) ?? Literacy.rateYearsAgo(settlement, 10, _day(world));
        const now = Math.round(rate * 100);
        let trend = '';
        if (past != null) {
            const was = Math.round(past * 100);
            trend = was === now ? ' (steady)' : ` (${now > was ? '↑' : '↓'} from ${was})`;
        }
        return `${now} in 100 read & write${trend}`;
    },

    // ──────────── THE DAY ────────────

    /** Towns reckoned in turn, the endowed schools paid, the children's letters, the player's own. → { notices } */
    processDay(world, player = null) {
        const out = { notices: [] };
        const C = Literacy.config();
        if (!C.enabled || !world) return out;
        const day = _day(world);
        const every = Math.max(1, Math.floor(_num(C.refreshDays, 30)));
        for (const s of _views(world)) {
            if (!s) continue;
            const due = s.letters && s.letters.d != null ? day - s.letters.d >= every : (Utils.hashStr(_key(s.q, s.r)) >>> 0) % every === day % every;
            if (due) Literacy.refresh(world, s, day);
        }
        if (player) {
            Literacy.ensurePlayer(player);
            Literacy._upkeep(world, player, out);
            if (day % every === 0) Literacy._heirs(player, world, every);
        }
        return out;
    },

    serialize(player) {
        return player && _obj(player.literacy) ? JSON.parse(JSON.stringify(player.literacy)) : null;
    },
};
