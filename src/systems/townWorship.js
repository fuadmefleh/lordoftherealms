// ============================================
// TOWN WORSHIP — who goes to church, and what their going does
// ============================================
// The church scene (world/innerMap/townScenes.js: the bell, the pews facing
// the altar, the priest preaching in the words of the town's faith) used to
// fill its pews by a flat share of each kind of townsperson. Here each
// person has a devotion (their traits, age, trade, grief, the realm's piety
// and the habit of going) and a faith — the town's, or for a few another
// (the player's own where it has a hold here), who pray at home instead.
// The devout go on the holy day and drop in on others; the idle, the
// impious and the tavern folk mostly don't.
//
// Off-screen (`processDay`, on every holy day, the same hash rolls the map
// uses): the churchgoers give their offerings — coin from their purses to
// the priest's (else the church box, the town's purse); the realm's piety
// moves with how full the churches are, the player's faith's hold grows with
// its own faithful's going, and a habit of going makes folk a little more
// devout. A feast of the year (data feasts) fills the church fuller. A
// townsperson's burial is attended by kin and the devout (an annal).
//
// The player: `attend` (sat through a service), `pray`, `donate`,
// `disrupt` (a scandal) — and folk notice who comes (p.mem.sawAtService).
//
// Deterministic: hashes of the town, the person and the day; no RNG drawn.
// Data: data/townWorship.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Economy } from '../world/economy.js';
import { Townsfolk } from './townsfolk.js';
import { Religion } from './religion.js';
import { Ledger } from './ledger.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _arr = (v) => (Array.isArray(v) ? v : []);
const _clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const _r2 = (v) => Math.round(v * 100) / 100;

let _cfg = null;
let _cfgSrc;

function _roll(...parts) {
    let h = Utils.hashStr(parts.join('|')) >>> 0;
    // (well mixed: similar strings must not give similar rolls)
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0; h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

export const TownWorship = {
    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.townWorship : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            _cfg = {
                enabled: d.enabled !== false && !!_obj(d.devotion),
                otherFaith: 0.07, holyShare: 0.95, dailyShare: 0.12, pietyRef: 0.35, pietyStep: 0.6, pietyMax: 1.5, playerPresence: 0.002,
                ...d,
                devotion: { base: 0.45, traits: {}, jobs: {}, ...(_obj(d.devotion) || {}) },
                offering: { poor: 0.05, plain: 0.2, rich: 0.8, ...(_obj(d.offering) || {}) },
                player: _obj(d.player) || {},
                lines: _obj(d.lines) || {},
                funerals: { mournerShare: 0.6, devoutShare: 0.25, ...(_obj(d.funerals) || {}) },
            };
        }
        return _cfg;
    },

    /** The holy day: the same week the church scene keeps (data/townScenes.json church.holyDay). */
    isHolyDay(day) {
        const ts = DataLoader._gamedata && DataLoader._gamedata.townScenes;
        const H = ts && ts.church && ts.church.holyDay;
        const every = _num(H && H.every, 7);
        if (!(every > 0)) return false;
        return ((Math.floor(day) - _num(H && H.offset)) % every + every) % every === 0;
    },

    /** A feast of the year on this day (its name and how much fuller the church), or null. */
    feast(day, faithId = null) {
        const C = TownWorship.config();
        const Y = Townsfolk.config().daysPerYear || 120;
        const doy = ((Math.floor(day) - 1) % Y + Y) % Y + 1;
        const f = _arr(C.feasts).find(x => x.day === doy);
        if (!f) return null;
        const own = faithId && _obj(C.feastNames) && C.feastNames[faithId] && C.feastNames[faithId][String(doy)];
        return { ...f, name: own || f.name };
    },

    /** The town's faith: { id, name } of the realm's church, or null. */
    townFaith(world, settlement) {
        const k = settlement && settlement.kingdom != null && world && typeof world.getKingdom === 'function' ? world.getKingdom(settlement.kingdom) : null;
        const id = k && k.religion && k.religion.faithId;
        const f = id && Religion.FAITHS ? Religion.FAITHS[id] : null;
        return id ? { id, name: (f && f.name) || id, kingdom: k } : null;
    },

    /**
     * A person's faith: the town's, or (for a few) another — the player's
     * own where it has a hold in this town. → 'town' | 'player' | 'other'
     */
    faithOf(folk, p, player = null) {
        const C = TownWorship.config();
        if (!p) return 'town';
        if (p.job && p.job.id === 'priest') return 'town';
        const u = _roll(folk.q, folk.r, p.id, 'faith');
        const rel = player && player.religion;
        const hold = rel ? Religion.getPresence(rel, folk.q, folk.r) : 0;
        if (hold > 0 && u < hold) return 'player';
        if (u > 1 - _num(C.otherFaith)) return 'other';
        return 'town';
    },

    /** How devout a person is, 0..1. */
    devotion(folk, p, day, piety = 50) {
        const C = TownWorship.config();
        const D = C.devotion;
        if (!p) return 0;
        if (p.job && p.job.id === 'priest') return 1;
        let v = _num(D.base, 0.45);
        for (const t of _arr(p.traits)) v += _num(D.traits && D.traits[t]);
        const age = Townsfolk.age(p, day);
        if (age >= _num(D.ageOld, 50)) v += _num(D.old);
        else if (age >= 12 && age < _num(D.ageYoung, 25)) v += _num(D.young);
        if (p.job) v += _num(D.jobs && D.jobs[p.job.id]);
        const Y = Townsfolk.config().daysPerYear;
        if (_arr(p.log).some(e => (e.k === 'widowed' || e.k === 'childDied' || e.k === 'parentDied') && day - e.d < Y)) v += _num(D.bereaved);
        v += (_num(piety, 50) - 50) * _num(D.pietyPer);
        v += _num(p.devout);
        return _clamp(v, 0, 1);
    },

    /** Does this person go to this service (svc: its index that day; holy: the holy day's)? */
    attends(folk, p, day, holy, svc = 0, opts = {}) {
        const C = TownWorship.config();
        if (!C.enabled || !p || !Townsfolk.isHere(p)) return false;
        if (p.jailedUntil != null && day < p.jailedUntil) return false;
        if (TownWorship.faithOf(folk, p, opts.player) !== 'town') return false;
        if (p.job && p.job.employer === 'player' && !holy) return false;
        const feast = holy ? TownWorship.feast(day, opts.faithId) : null;
        const share = holy ? _num(C.holyShare) * (feast ? _num(feast.share, 1) : 1) : _num(C.dailyShare);
        const dev = TownWorship.devotion(folk, p, day, opts.piety);
        // (the holy day's high service draws the most; its other services, and other days', a few)
        const want = holy ? dev * share * (svc === 2 ? 1 : 0.35) : dev * share;
        return _roll(folk.q, folk.r, p.id, day, svc, 'svc') < want;
    },

    /** The realm's piety where the town stands (50 when it has no church). */
    piety(world, settlement) {
        const f = TownWorship.townFaith(world, settlement);
        return f && f.kingdom && Number.isFinite(f.kingdom.religion.piety) ? f.kingdom.religion.piety : 50;
    },

    /**
     * The holy day off-screen: who went, their offerings to the priest (or
     * the church box), the habit of going, the realm's piety and the
     * player's faith's hold. → { went, of, offered } (per town, last day)
     */
    holyDay(world, settlement, day, player = null) {
        const C = TownWorship.config();
        const folk = settlement && settlement.folk;
        if (!C.enabled || !_obj(folk) || !Array.isArray(folk.people)) return null;
        const faith = TownWorship.townFaith(world, settlement);
        const piety = TownWorship.piety(world, settlement);
        const opts = { player, piety, faithId: faith && faith.id };
        const people = Townsfolk.residents(folk).filter(p => Townsfolk.age(p, day) >= 6);
        const priest = people.find(p => p.job && p.job.id === 'priest');
        let went = 0, offered = 0, theirs = 0, ofTheirs = 0;
        const coin = !settlement.inKind && Economy.townPurse(settlement) != null;
        for (const p of people) {
            const f = TownWorship.faithOf(folk, p, player);
            if (f === 'player') ofTheirs++;
            const go = TownWorship.attends(folk, p, day, true, 2, opts) || (f === 'player' && _roll(folk.q, folk.r, p.id, day, 'own') < TownWorship.devotion(folk, p, day, piety) * 0.8);
            if (!go) {
                p.devout = _r2(Math.max(0, _num(p.devout) - _num(C.devotion.decay) / 4));
                continue;
            }
            if (f === 'player') { theirs++; continue; }
            went++;
            p.devout = _r2(Math.min(_num(C.devotion.devoutMax, 0.2), _num(p.devout) + _num(C.devotion.attendGain)));
            p.atService = day;
            // The offering: a coin or two from their purse to the priest's (else the church box)
            if (coin && Townsfolk.age(p, day) >= 16 && p !== priest && typeof p.purse === 'number') {
                const give = Math.min(p.purse, _num(C.offering[p.diet || 'plain'], 0.2));
                if (give > 0) {
                    p.purse = _r2(p.purse - give);
                    if (priest) { Townsfolk.purse(folk, priest, world); priest.purse = _r2(priest.purse + give); } else Economy.payTown(settlement, give);
                    offered += give;
                }
            }
        }
        const share = people.length ? went / people.length : 0;
        // The realm's piety follows how full its churches are
        if (faith && faith.kingdom && faith.kingdom.religion && Number.isFinite(faith.kingdom.religion.piety)) {
            const dp = _clamp((share - _num(C.pietyRef)) * _num(C.pietyStep), -_num(C.pietyMax), _num(C.pietyMax)) / Math.max(1, (world.getSettlementViews ? world.getSettlementViews().length : 1) / 4);
            faith.kingdom.religion.piety = _clamp(Math.round((faith.kingdom.religion.piety + dp) * 1000) / 1000, 0, 100);
        }
        // The player's own faithful gathering win their faith a little more of the town
        if (player && player.religion && ofTheirs > 0 && theirs > 0) Religion.addPresence(player.religion, folk.q, folk.r, _num(C.playerPresence) * theirs);
        folk.worship = { d: day, went, of: people.length, offered: _r2(offered), theirs };
        return folk.worship;
    },

    /** Mourners at a burial: kin, friends and the devout. → count */
    mourners(folk, p, day) {
        const C = TownWorship.config();
        const kin = new Set([p.spouse, ...p.kids, ...p.parents].filter(x => x != null));
        let n = 0;
        for (const o of Townsfolk.residents(folk)) {
            if (o === p) continue;
            if (kin.has(o.id) || _roll(folk.q, folk.r, o.id, p.id, 'mourn') < _num(C.funerals.devoutShare) * TownWorship.devotion(folk, o, day) * 2) n++;
        }
        return n;
    },

    /** The daily hook: the holy day in every town with a roster; the burials of the season's dead. */
    processDay(world, player = null) {
        const C = TownWorship.config();
        if (!C.enabled || !world) return [];
        const day = _num(world.day, 1);
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        const holy = TownWorship.isHolyDay(day);
        // (the holy day just ended: the ruler in town who sat it out is noticed)
        const ruled = TownWorship.isHolyDay(day - 1) ? TownWorship._ruledBy(player) : null;
        for (const s of views) {
            const folk = s && s.folk;
            if (!_obj(folk) || !Array.isArray(folk.people)) continue;
            TownWorship.catchUp(world, s, day, player);
            if (ruled != null) TownWorship.rulerAbsent(world, s, day - 1, player);
        }
        void holy;
        return [];
    },

    /**
     * Every day of a town's worship not yet lived, up to `upTo`: its holy
     * days (the service, the offerings out of purses) and its burials — the
     * same whether lived day by day (processDay) or caught up late with the
     * town's other lives (systems/townsfolk.js _days). Kept on
     * folk.worshipDay (the last day lived; on first sight, yesterday). The
     * ruler's absence from the holy day is processDay's (the player's own,
     * the day after). Each day sees the world as of that day.
     */
    catchUp(world, s, upTo, player = null) {
        const C = TownWorship.config();
        const folk = s && s.folk;
        if (!C.enabled || !_obj(folk) || !Array.isArray(folk.people)) return;
        let last = folk.worshipDay;
        // (first sight: from today on — the days before were lived, or not, before this was kept;
        // systems/townsfolk.js _days walks every town from its roster's own first day, so a late
        // catch-up and day-by-day both first ask here for the same day)
        if (!Number.isFinite(last)) last = upTo - 1;
        for (let d = last + 1, guard = 0; d <= upTo && guard < 20000; d++, guard++) {
            let at = world;
            if (world && _num(world.day) !== d) { at = Object.create(world); at.day = d; }
            if (TownWorship.isHolyDay(d)) TownWorship.holyDay(at, s, d, player);
            // Burials: each death since the town was last seen to is buried, with its mourners
            for (const p of folk.people) {
                if (p.died == null || p.buried || d - p.died > 3 || p.died > d) continue;
                p.buried = d;
                const n = TownWorship.mourners(folk, p, d);
                Townsfolk._annal(folk, at, d, { k: 'worship', a: p.id, b: null, x: `funeral|${n}` }, []);
            }
            folk.worshipDay = d;
        }
    },

    /** The realm the player rules (player.throne.ruling: systems/throne.js), or null. */
    _ruledBy(player) {
        const r = player && player.throne && player.throne.ruling;
        return r && r.kingdomId != null ? r.kingdomId : null;
    },

    /**
     * The ruler was in this town on the holy day `day` and never came to
     * church: the devout think less of them, the realm's piety slips, and the
     * town talks of it (an annal). Once per holy day. → true when noticed.
     */
    rulerAbsent(world, settlement, day, player) {
        const C = TownWorship.config();
        const P = C.player;
        const folk = settlement && settlement.folk;
        const kid = TownWorship._ruledBy(player);
        if (!C.enabled || !_obj(folk) || kid == null || settlement.kingdom == null || String(settlement.kingdom) !== String(kid)) return false;
        if (player.q !== settlement.q || player.r !== settlement.r) return false;
        if (player.worship && player.worship.d === day) return false;
        if (folk.worship && folk.worship.absent === day) return false;
        const faith = TownWorship.townFaith(world, settlement);
        if (!faith) return false;
        const piety = TownWorship.piety(world, settlement);
        for (const p of Townsfolk.residents(folk)) {
            if (!p.mem) continue;
            const dev = TownWorship.devotion(folk, p, day, piety);
            if (dev < _num(P.absentDevotion, 0.45)) continue;
            p.mem.disposition = _clamp(_num(p.mem.disposition, 50) + _num(P.absentRegard, -4) * dev, 0, 100);
            p.mem.missedRuler = day;
        }
        const rel = faith.kingdom && faith.kingdom.religion;
        if (rel && Number.isFinite(rel.piety)) rel.piety = _clamp(Math.round((rel.piety - _num(P.absentPiety, 0.3)) * 1000) / 1000, 0, 100);
        folk.worship = { ...(_obj(folk.worship) || {}), absent: day };
        Townsfolk._annal(folk, world, day, { k: 'worship', a: null, b: null, x: `rulerAbsent|${[player.rulerTitle, player.name].filter(Boolean).join(' ') || 'The ruler'}` }, []);
        return true;
    },

    /** A line about a worship annal (Townsfolk.annalText). */
    annalText(folk, entry, world) {
        const L = TownWorship.config().lines;
        const [kind, n] = String(entry.x || '').split('|');
        const a = Townsfolk.get(folk, entry.a);
        const when = Townsfolk.when(entry.d, world);
        if (kind === 'funeral' && a) return String(L.funeral || '{a} was buried {when}.').replace('{a}', Townsfolk.name(a)).replace('{when}', when).replace('{n}', n || 'a few').replace('{him}', a.gender === 'female' ? 'her' : 'him');
        if (kind === 'disrupt') return String(L.disrupt || '').replace('{a}', n || 'A stranger').replace('{when}', when);
        if (kind === 'rulerAbsent') return String(L.rulerAbsent || '').replace('{a}', n || 'The ruler').replace('{when}', when);
        return null;
    },

    // ── The player ────────────────────────────────────────

    /** The player sat through a service in this town: faith and spirits, and the churchgoers see it. */
    attend(player, world, settlement, day = null) {
        const P = TownWorship.config().player;
        const d = day != null ? day : _num(world && world.day, 1);
        if (!player || (player.worship && player.worship.d === d && player.worship.town === (settlement && settlement.name))) return null;
        player.worship = { d, town: settlement ? settlement.name : null };
        if (typeof player.faith === 'number') player.faith = Math.min(10, player.faith + _num(P.attendFaith));
        if (typeof player.modifyNeed === 'function') for (const [k, v] of Object.entries(_obj(P.attendNeeds) || {})) player.modifyNeed(k, v);
        const folk = settlement && settlement.folk;
        let seen = 0;
        if (_obj(folk) && Array.isArray(folk.people)) {
            for (const p of Townsfolk.residents(folk)) {
                if (!p.mem || p.atService !== d && !TownWorship.attends(folk, p, d, TownWorship.isHolyDay(d), 2, { player })) continue;
                p.mem.sawAtService = d;
                p.mem.disposition = Math.min(100, _num(p.mem.disposition, 50) + _num(P.noticed, 2));
                seen++;
            }
        }
        return { seen };
    },

    /** The player prays (at an altar, a pew, a wayside stone). */
    pray(player) {
        const P = TownWorship.config().player;
        if (!player) return;
        if (typeof player.faith === 'number') player.faith = Math.min(10, player.faith + _num(P.prayFaith));
        if (typeof player.modifyNeed === 'function') for (const [k, v] of Object.entries(_obj(P.prayNeeds) || {})) player.modifyNeed(k, v);
    },

    /** The player gives to the church: from the player's purse to the priest's (else the church box). → { ok, text } */
    donate(player, world, settlement, amount) {
        const P = TownWorship.config().player;
        const g = Math.floor(_num(amount));
        if (!player || !(g > 0)) return { ok: false, text: 'Nothing to give.' };
        if (_num(player.gold) < g) return { ok: false, text: `You haven't ${g} gold to give.` };
        player.gold = _r2(_num(player.gold) - g);
        Ledger.record(player, 'charity', -g);
        const folk = settlement && settlement.folk;
        const priest = _obj(folk) && Array.isArray(folk.people) ? Townsfolk.residents(folk).find(p => p.job && p.job.id === 'priest') : null;
        if (priest) { Townsfolk.purse(folk, priest, world); priest.purse = _r2(priest.purse + g); } else Economy.payTown(settlement, g);
        if (typeof player.faith === 'number') player.faith = Math.min(10, player.faith + _num(P.donateFaith) * Math.sqrt(g));
        return { ok: true, text: g >= 50 ? 'The priest\'s eyes go wide. "The gods will remember this — and so will I."' : 'The coins chink into the box. "Bless you."', regard: Math.round(_num(P.donateRegard, 1) * Math.sqrt(g)) };
    },

    /** The player disrupts a service: a scandal — the devout turn on them, the town talks. */
    disrupt(player, world, settlement) {
        const P = TownWorship.config().player;
        const folk = settlement && settlement.folk;
        const d = _num(world && world.day, 1);
        if (!_obj(folk)) return { ok: false };
        for (const p of Townsfolk.residents(folk)) {
            if (!p.mem || TownWorship.devotion(folk, p, d) < 0.5) continue;
            p.mem.disposition = Math.max(0, _num(p.mem.disposition, 50) + _num(P.disruptRegard, -25) * TownWorship.devotion(folk, p, d));
        }
        if (typeof settlement.happiness === 'number') settlement.happiness = Math.max(0, settlement.happiness + _num(P.disruptHappiness, -1.5));
        Townsfolk._annal(folk, world, d, { k: 'worship', a: null, b: null, x: `disrupt|${(player && player.name) || 'A stranger'}` }, []);
        if (player && typeof player.faith === 'number') player.faith = Math.max(0, player.faith - 0.5);
        return { ok: true };
    },
};
