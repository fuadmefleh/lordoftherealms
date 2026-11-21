// ============================================
// HEIR PATHS — the years away that make a child
// ============================================
// On top of the education focus and tutors (systems/upbringing.js), the
// parent's own hand (systems/raising.js) and fostering, betrothals and
// commissions (systems/heirAgency.js), a child of 10–14 can be sent away for
// years on a FORMATIVE PATH (data/upbringing.json → paths.kinds):
//
//   squire      page and squire at another House's court (a realm's lord or
//               a rival House) — fee into its chests / the rival's purse
//   apprentice  bound to a guild master in a town with a guild — fee into
//               the guild's hall chest (systems/guilds.js)
//   novice      a monastery or cathedral chapter (kingdom.temples), else a
//               capital's priory — the alms into that town's purse
//   scholar     a cathedral school, or a great capital's university — fee
//               into that town's purse
//   abroad      a household of a realm of another tongue — fee into its
//               chests; the child learns the tongue (child.languages)
//
// Each costs a fee up front and board every year, paid to a real payee; an
// unpaid year sends the child home early. While away the path's master is
// the child's tutor (the path's focus, at pathTutorQuality), and every month
// the path teaches its own stats, skills and character seeds. At the end it
// leaves its mark (finish seeds/skills, letters) and CONTACTS: named people
// (relationship NPCs, npc.contactOf) who remember the child — a knight, a
// guild master, an abbot, a fellow student from abroad, a foster sibling.
// They become known to the House when the child comes home (Court prospects),
// can be wed by a grown child (wedContact → up.spouse kind 'contact', seated
// by Relationships._seatHeirSpouse), and if the child inherits they are the
// new ruler's friends (relationship score = their regard), and their realms
// think the better of the throne (HeirAgency.payoff).
//
// HOSTAGES. A child at a court whose regard for the House sours (or a rival
// House whose feud runs hot, or any host at war — never the church, never a
// guild) is held (up.heldBy, the same record HeirAgency and Mail use). The
// holder's AI then makes DEMANDS (a tribute, every demandEvery days, into
// its chests or purse): pay and the child comes home; refuse or let it lapse
// and the price rises and the child starts to TURN. Ransom by letter
// (systems/mail.js) still works; a RESCUE can be hired (a hash of nothing:
// Utils.random, a player action). A child held long enough turns against the
// House (up.turned): deceit and the host's ways, a broken bond, a worse
// officer (House._driftRoleLoyalty) and a mark at succession.
//
// WARDS AS LEVERAGE. A ward the House keeps (systems/raising.js) can be
// KEPT past their term (ward.kept: no fee, standing falls each month, the
// realm may spirit them away — a hash roll) or RANSOMED back to their realm
// (Economy.crownPays into the player's purse). At war, the realm's AI
// offers a ransom of its own (ward.offer).
//
// RIVALS' CHILDREN. A rival House sends a child of its own now and then: as
// a ward to the player's court (a seat free, the feud cool: Raising runs the
// months, ward.rivalId) or to another rival House it is friendly with. A
// rival's child at your court is leverage: they dare not plot or waylay you
// (RivalHouses._scores), you can keep them (the feud grows) or ransom them
// (from the rival's purse into yours), and they may spirit the child away.
// A squire's fellow squire is a real child of the host House where one is
// near the child's age (a rival head's child, or a royal child).
//
// THE INTERREGNUM. While the player is dead and the House waits in trust
// (player.interregnum), a held child's clocks stand still: no terms fall
// due and the child does not turn; they run on when an heir returns.
//
// State: child.upbringing.path / pathRecord / contacts / heldBy.demand /
// turn / turned (saved with player.children); child.languages; npc.contactOf
// (saved with the relationship NPCs); ward.kept / ward.offer (house.wards).
// Randomness: contacts are drawn from a seeded stream (world seed, child,
// day); the daily tick uses hash rolls only; a rescue is a player action
// (Utils.random). No import-time side effects.

import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { DataLoader } from '../core/dataLoader.js';
import { NPCLords } from '../world/npcLords.js';
import { Economy } from '../world/economy.js';
import { MoneySupply } from '../world/moneySupply.js';
import { Cultures } from '../world/cultures.js';
import { Upbringing } from './upbringing.js';
import { HeirAgency } from './heirAgency.js';
import { Raising } from './raising.js';
import { House } from './house.js';
import { Heirs } from './heirs.js';
import { Traits } from './traits.js';
import { Ledger } from './ledger.js';
import { Guilds } from './guilds.js';
import { CourtLetters } from './courtLetters.js';
import { Relationships } from './relationships.js';
import { Names } from '../core/names.js';
import { RivalHouses } from './rivalHouses.js';

const STATS = ['strength', 'charisma', 'intelligence', 'faith', 'luck'];

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = (world) => _num(world && world.day);
const _arr = (v) => (Array.isArray(v) ? v : []);

function _seed(world) {
    const p = world && world.generationParams;
    return (p && p.seed) || 0;
}

/** A hash roll in [0,1): the same world and key always roll the same. */
function _roll(world, key) {
    return ((Utils.hashStr(`${_seed(world)}|heirPaths|${key}`) >>> 0) % 1000003) / 1000003;
}

const DEFAULTS = {
    minAge: 10, maxAge: 14, minYears: 2,
    contactRegard: [40, 70], contactKnownShare: 0.4, contactSuccessionRep: 2, contactRepCap: 8, contactRivalFeud: 5,
    pathTutorQuality: 1.2, universityMinPop: 2500, venueCap: 8,
    hostage: {
        regard: -30, rivalFeud: 70, checkDays: 15,
        demandEvery: 60, demandDays: 30, demandBase: 120, demandRoyalOrHeir: 1.5, demandGoldShare: 0.05, demandMax: 900, demandGrowth: 1.25,
        paidReputation: 4, refusedReputation: -5, refusedTurn: 20,
        turnPerMonth: 6, turnCloseFactor: 0.5, turnDistantFactor: 1.5, turnAt: 100,
        turnedSeeds: { deceitful: 2, cunning: 1 }, turnedBond: -20, turnedPrestige: -6, turnedHostReputation: 10, turnedOfficeDrift: -3,
        heldPrestige: -5,
        rescueCost: 80, rescueBase: 0.3, rescueStealth: 0.04, rescueSpymaster: 0.01, rescueMin: 0.1, rescueMax: 0.8,
        rescueSuccessRep: -10, rescueFailRep: -15, rescueFailTurn: 15, rescueDeathChance: 0.1, rescueWoundHealth: 10,
    },
    wardLeverage: {
        keepReputation: -8, keepMonthlyReputation: -2, rescueChancePerMonth: 0.08, rescuedReputation: -5,
        ransomBase: 120, ransomRoyal: 180, ransomPeaceReputation: -15, ransomWarReputation: -3,
        offerEvery: 60, offerDays: 30,
    },
    kinds: {},
};

export const HeirPaths = {
    // ──────────── DATA ────────────

    config() {
        const d = _obj(DataLoader.upbringing && DataLoader.upbringing.paths) || {};
        return {
            ...DEFAULTS, ...d,
            hostage: { ...DEFAULTS.hostage, ...(_obj(d.hostage) || {}) },
            wardLeverage: { ...DEFAULTS.wardLeverage, ...(_obj(d.wardLeverage) || {}) },
            kinds: _obj(d.kinds) || {},
        };
    },

    kinds() {
        return HeirPaths.config().kinds;
    },

    kind(id) {
        return (id && HeirPaths.kinds()[id]) || null;
    },

    _Y() {
        return Upbringing._daysPerYear();
    },

    _child(player, childId) {
        return ((player && player.children) || []).find(c => c && c.id === childId) || null;
    },

    _kingdom(world, kid) {
        return world && typeof world.getKingdom === 'function' && kid ? world.getKingdom(kid) : null;
    },

    _rep(player, kid, n) {
        if (!kid || !n) return;
        if (!player.reputation) player.reputation = {};
        player.reputation[kid] = Utils.clamp(_num(player.reputation[kid]) + n, -100, 100);
    },

    _news(out, icon, title, text, type = 'info', childId = null) {
        out.notices.push({ icon, title, text, type, ...(childId ? { childId } : {}) });
    },

    /** The child's path record (backfilled; never draws RNG). */
    ensure(child) {
        if (!child) return null;
        const up = Upbringing.ensure(child);
        if (up.path === undefined) up.path = null;
        if (!Array.isArray(up.pathRecord)) up.pathRecord = [];
        if (!Array.isArray(up.contacts)) up.contacts = [];
        if (!Number.isFinite(up.turn)) up.turn = 0;
        if (up.turned === undefined) up.turned = null;
        return up;
    },

    isOnPath(child) {
        const p = child && child.upbringing && child.upbringing.path;
        return !!(p && p.active);
    },

    // ──────────── VENUES ────────────

    _settlementAt(world, q, r) {
        const t = world && typeof world.getTile === 'function' && Number.isFinite(q) ? world.getTile(q, r) : null;
        return (t && t.settlement) || null;
    },

    _towns(world) {
        return world && typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
    },

    _capital(world, k) {
        if (!k || !k.capital) return null;
        const s = HeirPaths._settlementAt(world, k.capital.q, k.capital.r);
        return s ? { s, q: k.capital.q, r: k.capital.r } : null;
    },

    _dist(player, q, r) {
        if (!player || !Number.isFinite(q)) return 9999;
        return Math.abs(_num(player.q) - q) + Math.abs(_num(player.r) - r);
    },

    /** The child's own tongue: the House's (the ruler's native tongue). */
    _nativeTongue(player, child) {
        return (child && child.nativeLanguage) || (player && player.nativeLanguage) || null;
    },

    /**
     * Where a path can be taken: [{ key, name, where, kingdomId, payee, q, r,
     * quality, note }]. Real places only: courts of realms and rival Houses,
     * guild halls, church houses, schools and households of other tongues.
     */
    venues(player, world, kindId, child = null, all = false) {
        const def = HeirPaths.kind(kindId);
        if (!def || !world) return [];
        const cfg = HeirPaths.config();
        const out = [];
        const kingdoms = Heirs.kingdoms(player, world);
        if (def.venue === 'court') {
            for (const k of kingdoms) {
                if (!k.lord) continue;
                const cap = HeirPaths._capital(world, k);
                out.push({
                    key: `k:${k.id}`, name: `the court of ${HeirAgency._lordName(k)}`, where: k.name, kingdomId: k.id,
                    payee: { type: 'kingdom', id: k.id }, q: cap ? cap.q : null, r: cap ? cap.r : null, quality: 1,
                    note: `standing ${Math.round(_num(player.reputation && player.reputation[k.id]))}`,
                });
            }
            for (const rv of Object.values((player.house && player.house.rivals) || {})) {
                if (!rv || !rv.kingdomId) continue;
                const k = HeirPaths._kingdom(world, rv.kingdomId);
                if (!k || k.isAlive === false) continue;
                const head = rv.head ? `${rv.head.firstName}${rv.name ? ` of ${rv.name}` : ''}` : rv.name;
                out.push({
                    key: `rival:${rv.kingdomId}`, name: `the hall of ${head || 'a rival House'}`, where: rv.name || k.name, kingdomId: rv.kingdomId,
                    payee: { type: 'rival', id: rv.kingdomId }, q: rv.seat ? rv.seat.q : null, r: rv.seat ? rv.seat.r : null, quality: 1.1,
                    note: `rival House · feud ${Math.round(_num(rv.feud))}`, rival: true,
                });
            }
        } else if (def.venue === 'guild') {
            for (const s of HeirPaths._towns(world)) {
                const gs = Guilds.townGuilds(s);
                if (!gs) continue;
                for (const [gid, g] of Object.entries(gs)) {
                    if (!g || !g.master) continue;
                    out.push({
                        key: `guild:${s.q},${s.r}:${gid}`, name: `${g.master.name} of the ${g.name || gid}`, where: s.name, kingdomId: s.kingdom || null,
                        payee: { type: 'guild', q: s.q, r: s.r, gid }, q: s.q, r: s.r, quality: 1 + Math.min(0.3, Math.max(0, _num(g.prosperity, 1) - 1)),
                        note: Guilds.def(gid) ? Guilds.def(gid).name : gid, master: g.master.name,
                    });
                }
            }
        } else if (def.venue === 'church') {
            const seen = new Set();
            for (const k of kingdoms) {
                for (const t of _arr(k.temples)) {
                    if (!t || !(t.type === 'monastery_npc' || t.type === 'cathedral') || !t.at) continue;
                    const s = HeirPaths._towns(world).find(x => x && x.name === t.at);
                    const key = `town:${s ? `${s.q},${s.r}` : t.at}:${t.type}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    out.push({
                        key, name: t.type === 'cathedral' ? `the cathedral chapter of ${t.at}` : `the abbey at ${t.at}`, where: k.name, kingdomId: k.id,
                        payee: s ? { type: 'town', q: s.q, r: s.r } : { type: 'kingdom', id: k.id }, q: s ? s.q : null, r: s ? s.r : null,
                        quality: t.type === 'cathedral' ? 1.15 : 1.05, note: t.type === 'cathedral' ? 'cathedral' : 'monastery',
                    });
                }
                // Every realm keeps a priory at its seat
                const cap = HeirPaths._capital(world, k);
                if (cap && !seen.has(`town:${cap.q},${cap.r}:priory`)) {
                    seen.add(`town:${cap.q},${cap.r}:priory`);
                    out.push({
                        key: `town:${cap.q},${cap.r}:priory`, name: `the priory at ${cap.s.name}`, where: k.name, kingdomId: k.id,
                        payee: { type: 'town', q: cap.q, r: cap.r }, q: cap.q, r: cap.r, quality: 0.85, note: 'priory',
                    });
                }
            }
        } else if (def.venue === 'school') {
            const seen = new Set();
            for (const k of kingdoms) {
                for (const t of _arr(k.temples)) {
                    if (!t || t.type !== 'cathedral' || !t.at) continue;
                    const s = HeirPaths._towns(world).find(x => x && x.name === t.at);
                    if (!s || seen.has(`${s.q},${s.r}`)) continue;
                    seen.add(`${s.q},${s.r}`);
                    out.push({
                        key: `town:${s.q},${s.r}:cathedralSchool`, name: `the cathedral school of ${s.name}`, where: k.name, kingdomId: k.id,
                        payee: { type: 'town', q: s.q, r: s.r }, q: s.q, r: s.r, quality: 1, note: 'cathedral school',
                    });
                }
                const cap = HeirPaths._capital(world, k);
                if (cap && _num(cap.s.population) >= cfg.universityMinPop && !seen.has(`${cap.q},${cap.r}:u`)) {
                    seen.add(`${cap.q},${cap.r}:u`);
                    out.push({
                        key: `town:${cap.q},${cap.r}:university`, name: `the university of ${cap.s.name}`, where: k.name, kingdomId: k.id,
                        payee: { type: 'town', q: cap.q, r: cap.r }, q: cap.q, r: cap.r, quality: 1.25, note: 'university',
                    });
                }
            }
        } else if (def.venue === 'march') {
            // The far borders of the realm the player rules: a march-warden's household
            // in its farthest towns (systems/realmDecline.js: a child raised away is not soft)
            const kid = player && player.throne && player.throne.ruling && player.throne.ruling.kingdomId;
            const k = HeirPaths._kingdom(world, kid);
            const cap = k && k.isAlive !== false ? HeirPaths._capital(world, k) : null;
            if (cap) {
                const far = HeirPaths._towns(world)
                    .filter(s => s && s.kingdom === k.id && !(s.q === cap.q && s.r === cap.r))
                    .map(s => ({ s, d: Hex.wrappingDistance(cap.q, cap.r, s.q, s.r, _num(world.width) || 9999) }))
                    .sort((a, b) => b.d - a.d || String(a.s.name).localeCompare(String(b.s.name)))
                    .slice(0, 3);
                for (const { s, d } of far) {
                    out.push({
                        key: `march:${s.q},${s.r}`, name: `the march-warden at ${s.name}`, where: k.name, kingdomId: k.id,
                        payee: { type: 'town', q: s.q, r: s.r }, q: s.q, r: s.r, quality: 1 + Math.min(0.2, d / 100),
                        note: `${d} leagues from the capital`,
                    });
                }
            }
        } else if (def.venue === 'abroad') {
            const native = HeirPaths._nativeTongue(player, child);
            for (const k of kingdoms) {
                if (!k.lord) continue;
                const lang = Cultures.languageOfCulture(k.culture);
                if (!lang || lang === native) continue;
                const known = _num(child && child.languages && child.languages[lang]);
                if (known >= 80) continue;
                const cap = HeirPaths._capital(world, k);
                out.push({
                    key: `abroad:${k.id}`, name: `a noble household of ${Names.realm(k.name)}`, where: k.name, kingdomId: k.id,
                    payee: { type: 'kingdom', id: k.id }, q: cap ? cap.q : null, r: cap ? cap.r : null, quality: 1,
                    note: `${Cultures.languageName(lang) || lang} spoken`, language: lang,
                });
            }
        }
        out.sort((a, b) => HeirPaths._dist(player, a.q, a.r) - HeirPaths._dist(player, b.q, b.r) || a.key.localeCompare(b.key));
        return all ? out : out.slice(0, Math.max(1, cfg.venueCap));
    },

    _venue(player, world, kindId, key, child) {
        // (a venue beyond the nearest few is still a real place: look it up in the whole list)
        return HeirPaths.venues(player, world, kindId, child, true).find(v => v.key === key) || null;
    },

    /** Why a venue will not take the child now, or null. */
    _venueBarred(player, world, v) {
        if (!v) return 'No such place.';
        if (v.payee.type === 'kingdom' || v.payee.type === 'rival') {
            const k = HeirPaths._kingdom(world, v.kingdomId);
            if (!k || k.isAlive === false) return 'That realm is no more.';
            if (CourtLetters.atWar(player, world, v.kingdomId)) return `You are at war with ${Names.realm(k.name)}.`;
            if (v.payee.type === 'kingdom' && _num(player.reputation && player.reputation[v.kingdomId]) < -10) return `${k.name} will not take in the child of a House it distrusts.`;
        }
        if (v.payee.type === 'rival') {
            const rv = player.house && player.house.rivals && player.house.rivals[v.kingdomId];
            if (rv && _num(rv.feud) >= HeirPaths.config().hostage.rivalFeud) return `The feud with ${rv.name} runs too hot to send them a child.`;
        }
        return null;
    },

    // ──────────── CHOOSING ────────────

    /** What the path costs: { fee, yearly, years }. */
    cost(kindId, child, world = null) {
        const def = HeirPaths.kind(kindId);
        if (!def) return null;
        const years = HeirPaths._years(def, child);
        return { fee: Utils.cents(_num(def.fee)), yearly: Utils.cents(_num(def.yearly)), years };
    },

    /** Years the path can run before the child comes of age (whole years of the data, at most). */
    _years(def, child) {
        const left = Math.max(0, Upbringing.config().comeOfAgeAge - _num(child && child.age));
        return Math.max(0, Math.min(_num(def.years, 3), left));
    },

    /** The day the child comes of age, by the yearly aging (Relationships.ageChildren on day % Y === 0). */
    _comeOfAgeDay(child, world) {
        const Y = HeirPaths._Y();
        const day = _day(world);
        const next = (Math.floor(day / Y) + 1) * Y;
        const left = Upbringing.config().comeOfAgeAge - _num(child.age);
        return next + Math.max(0, left - 1) * Y;
    },

    /** Why this child cannot take a path now, or null. */
    barred(player, world, child) {
        const cfg = HeirPaths.config();
        if (!child || child.isAlive === false) return 'No such child.';
        const up = HeirPaths.ensure(child);
        if (up.comeOfAge) return `${child.firstName} is grown.`;
        if (_num(child.age) < cfg.minAge) return `${child.firstName} is too young (paths from age ${cfg.minAge}).`;
        if (_num(child.age) > cfg.maxAge) return `${child.firstName} is too near coming of age to begin a path (up to age ${cfg.maxAge}).`;
        if (up.path && up.path.active) return `${child.firstName} is already away as a ${HeirPaths.kind(up.path.kind)?.name || 'student'}.`;
        if (up.pathRecord.length) return `${child.firstName} has had their years away.`;
        if (HeirAgency.isAway(child)) return `${child.firstName} is not at home.`;
        if (child.isSibling) return `${child.firstName} is your sibling, not yours to send.`;
        return null;
    },

    /**
     * Send a child away on a path. Pays the fee to the venue's payee, sets the
     * path master as the child's tutor, draws the contacts (seeded stream).
     * → { success, child, path, contacts } | { success: false, reason }
     */
    begin(player, world, childId, kindId, venueKey) {
        const child = HeirPaths._child(player, childId);
        const why = HeirPaths.barred(player, world, child);
        if (why) return { success: false, reason: why };
        const def = HeirPaths.kind(kindId);
        if (!def) return { success: false, reason: 'No such path.' };
        const v = HeirPaths._venue(player, world, kindId, venueKey, child);
        const vb = HeirPaths._venueBarred(player, world, v);
        if (vb) return { success: false, reason: vb };
        const cost = HeirPaths.cost(kindId, child, world);
        if (!(cost.years > 0)) return { success: false, reason: `${child.firstName} has no years left before coming of age.` };
        if (_num(player.gold) < cost.fee) return { success: false, reason: `The fee is ${Utils.formatGold(cost.fee)} gold.` };
        const cfg = HeirPaths.config();
        const up = HeirPaths.ensure(child);
        const day = _day(world);
        const Y = HeirPaths._Y();
        const until = Math.min(day + cost.years * Y, HeirPaths._comeOfAgeDay(child, world) - 1);
        HeirPaths._pay(player, world, v.payee, cost.fee);
        up.path = {
            kind: kindId, active: true, key: v.key, name: v.name, where: v.where, kingdomId: v.kingdomId || null,
            payee: { ...v.payee }, q: v.q, r: v.r, quality: _num(v.quality, 1), language: v.language || null, rival: !!v.rival,
            master: v.master || null, since: day, until, years: cost.years, paid: cost.fee, yearsPaid: 1, months: 0, held: false,
        };
        // The path's master teaches the child's lessons now; a tutor at home is let go
        const focus = def.focus && Upbringing.focus(def.focus) ? def.focus : null;
        up.tutor = {
            kind: 'path', id: `path_${kindId}`, name: v.master || `the masters of ${v.name}`, icon: def.icon || '🎓', focus,
            quality: Math.round(cfg.pathTutorQuality * _num(v.quality, 1) * 100) / 100, wage: 0, seeds: {}, since: day,
        };
        if (focus && !up.focus) up.focus = focus;
        // A rival House that takes in your child cools toward you
        if (v.rival && def.rivalFeudCut) {
            const rv = player.house && player.house.rivals && player.house.rivals[v.kingdomId];
            if (rv) rv.feud = Utils.clamp(_num(rv.feud) - _num(def.rivalFeudCut), 0, 100);
        }
        const k = HeirPaths._kingdom(world, v.kingdomId);
        if (def.fostered && k && k.lord && !v.rival) NPCLords.rememberDeed(world, k.lord, 'ward', { note: child.firstName });
        const contacts = HeirPaths._drawContacts(player, world, child, def, v);
        if (player.house) {
            House._chronicle(player.house, world, `${child.firstName}, aged ${child.age}, goes away as ${HeirPaths._article(def.name)} to ${v.name}${v.where && !v.name.includes(v.where) ? `, in ${v.where}` : ''}.`, ['heirs', 'upbringing']);
        }
        return { success: true, child, path: up.path, contacts, cost };
    },

    _article(name) {
        const n = String(name || 'student').toLowerCase();
        return /^[aeiou]/.test(n) ? `an ${n}` : `a ${n}`;
    },

    /** Call a child home before their time: the path counts for half. */
    recall(player, world, childId) {
        const child = HeirPaths._child(player, childId);
        const up = child && HeirPaths.ensure(child);
        if (!up || !up.path || !up.path.active) return { success: false, reason: 'They are not away on a path.' };
        if (up.heldBy) return { success: false, reason: `${child.firstName} is held; they cannot simply be called home.` };
        const out = { notices: [] };
        const rec = HeirPaths._end(player, world, child, 'recalled', out);
        return { success: true, child, record: rec };
    },

    // ──────────── COIN ────────────

    /** The player pays `amount` to a venue's payee: a crown's chests, a rival's purse, a guild's chest, a town's purse. */
    _pay(player, world, payee, amount) {
        const a = Utils.cents(Math.min(_num(amount), Math.max(0, _num(player.gold))));
        if (!(a > 0)) return 0;
        player.gold = Utils.cents(_num(player.gold) - a);
        Ledger.record(player, 'family', -a);
        HeirPaths._credit(player, world, payee, a);
        return a;
    },

    _credit(player, world, payee, a) {
        const p = payee || {};
        if (p.type === 'kingdom') {
            const k = HeirPaths._kingdom(world, p.id);
            if (k) { k.treasury = Utils.cents(_num(k.treasury) + a); return; }
        } else if (p.type === 'rival') {
            const rv = player.house && player.house.rivals && player.house.rivals[p.id];
            if (rv) { rv.gold = Utils.cents(_num(rv.gold) + a); return; }
        } else if (p.type === 'guild') {
            const s = HeirPaths._settlementAt(world, p.q, p.r) || HeirPaths._towns(world).find(x => x && x.q === p.q && x.r === p.r);
            const g = s && Guilds.guild(s, p.gid);
            if (g) { g.treasury = Utils.cents(_num(g.treasury) + a); return; }
            if (s && Economy.payTown(s, a)) return;
        } else if (p.type === 'town') {
            const s = HeirPaths._settlementAt(world, p.q, p.r) || HeirPaths._towns(world).find(x => x && x.q === p.q && x.r === p.r);
            if (s && Economy.payTown(s, a)) return;
        }
        // (the payee is gone: the coin is spent in the nearest town, else lost to the world, booked)
        if (!world || !Economy.payNearest(world, _num(player.q), _num(player.r), a)) MoneySupply.leak(world, -a, 'heirPaths');
    },

    // ──────────── CONTACTS ────────────

    /** The people the child will remember, drawn from a seeded stream (never the shared dice). */
    _drawContacts(player, world, child, def, v) {
        const cfg = HeirPaths.config();
        const up = HeirPaths.ensure(child);
        const day = _day(world);
        const rng = Utils.seededRandom(((Utils.hashStr(`${_seed(world)}|heirPaths|contacts|${child.id}|${day}`) >>> 0) % 233279) + 1);
        const made = [];
        Utils.withRng(rng, () => {
            for (const spec of _arr(def.contacts)) {
                let kid = v.kingdomId;
                if (spec.foreign) {
                    const others = Heirs.kingdoms(player, world).filter(k => k.id !== v.kingdomId);
                    if (others.length) kid = others[Utils.randInt(0, others.length - 1)].id;
                }
                const k = HeirPaths._kingdom(world, kid);
                const cap = k ? HeirPaths._capital(world, k) : null;
                const home = (Number.isFinite(v.q) && !spec.foreign ? HeirPaths._settlementAt(world, v.q, v.r) : null) || (cap && cap.s) || null;
                const settlement = home
                    ? { ...home, kingdom: home.kingdom || kid || null }
                    : { name: (k && k.name) || v.where || 'abroad', kingdom: kid || null };
                const npc = Relationships.generateNPC(settlement, world);
                if (spec.master && v.master) {
                    const [first, ...rest] = String(v.master).split(' ');
                    npc.firstName = first;
                    if (rest.length) npc.dynasty = rest.join(' ');
                }
                if (spec.opposite) npc.gender = child.gender === 'female' ? 'male' : 'female';
                if (spec.age === 'near') npc.age = Math.max(6, _num(child.age) + Utils.randInt(-1, 2));
                else if (Array.isArray(spec.age)) npc.age = Utils.randInt(spec.age[0], spec.age[1]);
                if (spec.occupation) npc.occupation = spec.occupation;
                if (spec.noble) npc.noble = true;
                // A fellow squire: a real child of the host House, where one is near the child's age
                const host = spec.hostChild ? HeirPaths._hostChild(player, world, child, v) : null;
                if (host) {
                    npc.firstName = host.firstName;
                    npc.dynasty = host.dynasty || npc.dynasty;
                    if (host.gender) npc.gender = host.gender;
                    npc.age = host.age;
                }
                const [lo, hi] = Array.isArray(cfg.contactRegard) ? cfg.contactRegard : [40, 70];
                const regard = Utils.randInt(lo, hi) + Math.max(0, _num(child.charisma) - 5) * 2;
                npc.contactOf = { childId: child.id, childName: child.firstName, path: def.name, role: spec.role, since: day };
                npc.pruneSeen = day;
                const c = {
                    npcId: npc.id, name: `${npc.firstName}${npc.dynasty ? ` ${npc.dynasty}` : ''}`, role: spec.role, label: spec.label || spec.role,
                    kingdomId: kid || null, kingdomName: k ? k.name : null, gender: npc.gender, path: def.name, pathKind: v.key, since: day,
                    regard: 0, target: Math.min(95, regard), rival: !!(v.rival && !spec.foreign),
                };
                if (host) {
                    c.hostChild = host.ref;
                    host.mark({ childId: child.id, name: child.firstName });
                }
                up.contacts.push(c);
                made.push(c);
            }
        });
        return made;
    },

    /** The living contacts of a child: [{ ...contact, npc }]. */
    contacts(player, child) {
        const up = child && HeirPaths.ensure(child);
        if (!up) return [];
        return up.contacts.map(c => ({ ...c, npc: Relationships.getNPC(c.npcId) }))
            .filter(c => c.npc && c.npc.isAlive !== false);
    },

    /** Contacts become known to the House (Court prospects) at a share of their regard. */
    _introduce(player, world, child, share) {
        for (const c of HeirPaths.contacts(player, child)) {
            const rel = Relationships.getRelationship(player, c.npcId);
            const v = Math.round(_num(c.regard) * share);
            if (v > _num(rel.score)) rel.score = v;
            if (Array.isArray(rel.history)) rel.history.push({ day: _day(world), action: 'known_through_child', result: child.firstName });
        }
    },

    /**
     * A grown child weds one of their contacts. The House marries a friend of
     * its child's youth: standing with their realm, a noble one costs no Prestige.
     */
    wedContact(player, world, childId, npcId) {
        const child = HeirPaths._child(player, childId);
        if (!child || child.isAlive === false) return { success: false, reason: 'No such child.' };
        const up = HeirPaths.ensure(child);
        if (!up.comeOfAge) return { success: false, reason: `${child.firstName} must come of age first.` };
        if (up.spouse) return { success: false, reason: `${child.firstName} is already wed.` };
        const a = HeirAgency.ensure(child);
        if (a.betrothal) return { success: false, reason: `${child.firstName} is promised to ${a.betrothal.name}.` };
        if (HeirAgency.isAway(child)) return { success: false, reason: `${child.firstName} is not at home.` };
        const c = up.contacts.find(x => x.npcId === npcId);
        const npc = c && Relationships.getNPC(npcId);
        if (!c || !npc || npc.isAlive === false) return { success: false, reason: 'They are gone.' };
        if (npc.isMarried || npc.marriedTo) return { success: false, reason: `${npc.firstName} is already wed.` };
        if (npc.gender === child.gender) return { success: false, reason: `${npc.firstName} cannot be ${child.firstName}'s match.` };
        if (_num(npc.age) < 16) return { success: false, reason: `${npc.firstName} is too young to wed.` };
        if (_num(c.regard) < 30) return { success: false, reason: `${npc.firstName} does not think warmly enough of ${child.firstName}.` };
        const day = _day(world);
        npc.isMarried = true;
        npc.wedHouse = player.house ? player.house.name : true;
        up.spouse = { kind: 'contact', npcId, name: c.name, kingdomId: c.kingdomId, kingdomName: c.kingdomName, day, noble: !!npc.noble };
        if (c.kingdomId) HeirPaths._rep(player, c.kingdomId, 4);
        if (player.house) {
            if (npc.noble) House.award(player.house, 2, `${child.firstName} weds ${c.name}`, day);
            else HeirAgency._prestige(player, -1, `${child.firstName} weds beneath the House`, world);
            House._chronicle(player.house, world, `${child.firstName} weds ${c.name}, ${c.label} from the years away.`, ['heirs', 'marriage']);
        }
        return { success: true, child, contact: c, spouse: up.spouse };
    },

    // ──────────── HOSTAGES ────────────

    /** The court holding a child (any cause): { kingdom, rival, held } or null. */
    holder(player, world, child) {
        const held = child && child.upbringing && child.upbringing.heldBy;
        if (!held) return null;
        const k = HeirPaths._kingdom(world, held.kingdomId);
        const rival = held.rival && player.house && player.house.rivals ? player.house.rivals[held.kingdomId] : null;
        return { kingdom: k, rival: rival || null, held };
    },

    _holderName(player, world, child) {
        const h = HeirPaths.holder(player, world, child);
        if (!h) return 'their captors';
        if (h.rival) return h.rival.name || 'a rival House';
        return h.kingdom ? `the court of ${Names.realm(h.kingdom.name)}` : 'a foreign court';
    },

    /** The demand a holder makes (the tribute's size). Pure. */
    demandAmount(player, world, child) {
        const H = HeirPaths.config().hostage;
        const held = child.upbringing.heldBy;
        const prior = _num(held.demands);
        let a = _num(H.demandBase) + _num(player.gold) * _num(H.demandGoldShare);
        if (player.heir === child.id) a *= _num(H.demandRoyalOrHeir, 1.5);
        a *= Math.pow(_num(H.demandGrowth, 1.25), prior);
        return Utils.cents(Math.min(_num(H.demandMax, 900), Math.round(a)));
    },

    /** The holder's AI sets out its terms. */
    _demand(player, world, child, out) {
        const H = HeirPaths.config().hostage;
        const held = child.upbringing.heldBy;
        const day = _day(world);
        const amount = HeirPaths.demandAmount(player, world, child);
        held.demand = { amount, day, due: day + _num(H.demandDays, 30), to: held.rival ? 'rival' : 'kingdom' };
        held.demands = _num(held.demands) + 1;
        const who = HeirPaths._holderName(player, world, child);
        HeirPaths._news(out, '📜', `Terms for ${child.firstName}`, `${who} sets its price for ${child.firstName}: ${Utils.formatGold(amount)} gold by day ${held.demand.due}. Pay, ransom by letter, or send blades to bring ${child.gender === 'female' ? 'her' : 'him'} home.`, 'warning', child.id);
    },

    /** Pay the holder's demand: the child comes home. */
    payDemand(player, world, childId) {
        const child = HeirPaths._child(player, childId);
        const held = child && child.upbringing && child.upbringing.heldBy;
        if (!held || !held.demand) return { success: false, reason: 'No terms have been set.' };
        const amt = _num(held.demand.amount);
        if (_num(player.gold) < amt) return { success: false, reason: `They ask ${Utils.formatGold(amt)} gold.` };
        const payee = held.rival ? { type: 'rival', id: held.kingdomId } : { type: 'kingdom', id: held.kingdomId };
        HeirPaths._pay(player, world, payee, amt);
        const H = HeirPaths.config().hostage;
        HeirPaths._rep(player, held.kingdomId, _num(H.paidReputation));
        const k = HeirPaths._kingdom(world, held.kingdomId);
        if (k && k.lord && !held.rival) NPCLords.rememberDeed(world, k.lord, 'tribute_paid', { note: child.firstName });
        const who = HeirPaths._holderName(player, world, child);
        HeirPaths._release(player, world, child, `${child.firstName} is ransomed from ${who} for ${Utils.formatGold(amt)} gold and comes home.`);
        return { success: true, child, cost: amt };
    },

    /** Refuse the holder's terms: the price rises, the child begins to turn. */
    refuseDemand(player, world, childId) {
        const child = HeirPaths._child(player, childId);
        const held = child && child.upbringing && child.upbringing.heldBy;
        if (!held || !held.demand) return { success: false, reason: 'No terms have been set.' };
        const out = { notices: [] };
        HeirPaths._refused(player, world, child, out);
        return { success: true, child, notices: out.notices };
    },

    _refused(player, world, child, out) {
        const H = HeirPaths.config().hostage;
        const up = HeirPaths.ensure(child);
        const held = up.heldBy;
        held.demand = null;
        held.lastDemandDay = _day(world);
        HeirPaths._rep(player, held.kingdomId, _num(H.refusedReputation));
        up.turn = _num(up.turn) + _num(H.refusedTurn);
        HeirPaths._news(out, '⛓️', `${child.firstName}'s Terms Refused`, `${HeirPaths._holderName(player, world, child)} has its answer. ${child.firstName} is told the House would not pay for them.`, 'warning', child.id);
        HeirPaths._turnCheck(player, world, child, out);
    },

    /** Odds a hired rescue brings the child home: { chance, cost }. Pure. */
    rescueOdds(player) {
        const H = HeirPaths.config().hostage;
        const stealth = _num(player && player.skills && player.skills.stealth);
        const spy = player && player.house ? _num(House.getRoleBonuses(player).espionageBonus) : 0;
        const chance = Utils.clamp(H.rescueBase + stealth * H.rescueStealth + spy * H.rescueSpymaster, H.rescueMin, H.rescueMax);
        return { chance: Math.round(chance * 100) / 100, cost: Utils.cents(H.rescueCost) };
    },

    /** Hire blades to bring a held child home. A player action: Utils.random decides. */
    rescue(player, world, childId) {
        const child = HeirPaths._child(player, childId);
        const up = child && HeirPaths.ensure(child);
        if (!up || !up.heldBy) return { success: false, reason: 'They are not held.' };
        const H = HeirPaths.config().hostage;
        const odds = HeirPaths.rescueOdds(player);
        if (_num(player.gold) < odds.cost) return { success: false, reason: `The blades want ${Utils.formatGold(odds.cost)} gold.` };
        // (the blades are hired, and spend it, in the town nearest you)
        HeirPaths._pay(player, world, null, odds.cost);
        const held = up.heldBy;
        const k = HeirPaths._kingdom(world, held.kingdomId);
        const who = HeirPaths._holderName(player, world, child);
        const roll = Utils.random();
        if (roll < odds.chance) {
            HeirPaths._rep(player, held.kingdomId, _num(H.rescueSuccessRep));
            if (k && k.lord && !held.rival) NPCLords.rememberDeed(world, k.lord, 'insult', { note: `${child.firstName} spirited away` });
            if (held.rival && player.house && player.house.rivals[held.kingdomId]) {
                const rv = player.house.rivals[held.kingdomId];
                rv.feud = Utils.clamp(_num(rv.feud) + 10, 0, 100);
            }
            HeirPaths._release(player, world, child, `Hired blades bring ${child.firstName} out of ${who} by night.`);
            return { success: true, rescued: true, child, chance: odds.chance, cost: odds.cost, text: `Your blades bring ${child.firstName} home from ${who}.` };
        }
        HeirPaths._rep(player, held.kingdomId, _num(H.rescueFailRep));
        up.turn = _num(up.turn) + _num(H.rescueFailTurn);
        let text;
        if (Utils.random() < _num(H.rescueDeathChance)) {
            child.isAlive = false;
            child.deathDay = _day(world);
            child.deathCause = 'killed in a failed rescue';
            text = `The rescue fails. ${child.firstName} is killed in the fighting at ${who}.`;
            if (player.house) House._chronicle(player.house, world, text, ['heirs', 'death']);
        } else {
            child.maxHealth = Math.max(40, _num(child.maxHealth, 100) - _num(H.rescueWoundHealth));
            text = `The rescue fails. ${child.firstName} is hurt in the struggle, and ${who} keeps a closer watch.`;
            if (held.demand) held.demand.amount = Utils.cents(Math.min(_num(H.demandMax, 900), held.demand.amount * 1.5));
            if (player.house) House._chronicle(player.house, world, text, ['heirs']);
        }
        const out = { notices: [] };
        if (child.isAlive !== false) HeirPaths._turnCheck(player, world, child, out);
        return { success: true, rescued: false, died: child.isAlive === false, child, chance: odds.chance, cost: odds.cost, text };
    },

    /** A held child comes home (paid, rescued, or Mail.release did it). */
    _release(player, world, child, text) {
        const up = HeirPaths.ensure(child);
        delete up.heldBy;
        // (a fosterage cut short this way counts for nothing at succession: HeirAgency records it recalled)
        if (up.placement && up.placement.kind === 'ward' && !up.placement.returned) {
            up.placement.returned = true;
            up.placement.recalled = true;
            if (up.tutor && up.tutor.kind === 'host') up.tutor = null;
        }
        if (up.path && up.path.active) HeirPaths._end(player, world, child, 'ransomed', { notices: [] });
        if (player.house && text) House._chronicle(player.house, world, text, ['heirs']);
    },

    /** Has the child held long enough turned against the House? */
    _turnCheck(player, world, child, out) {
        const H = HeirPaths.config().hostage;
        const up = HeirPaths.ensure(child);
        if (up.turned || _num(up.turn) < _num(H.turnAt, 100)) return;
        const held = up.heldBy;
        const k = held ? HeirPaths._kingdom(world, held.kingdomId) : null;
        up.turned = { kingdomId: held ? held.kingdomId : null, kingdomName: k ? k.name : null, day: _day(world) };
        Upbringing._addSeeds(child, H.turnedSeeds || {});
        // ...and the host's own ways
        const t = held && !held.rival ? Heirs.lordTrait(world, held.kingdomId) : null;
        if (t && Traits.TRAITS[t]) Upbringing._addSeeds(child, { [t]: Upbringing.config().seedThreshold });
        if (up.comeOfAge) {
            for (const id of Object.keys(H.turnedSeeds || {})) {
                const def = Traits.TRAITS[id];
                if (def && !up.adultTraits.includes(id) && !(def.opposite && up.adultTraits.includes(def.opposite))) { up.adultTraits.push(id); break; }
            }
        }
        const r = Raising.ensure(child);
        r.bond = Math.max(0, Math.round((_num(r.bond, 50) + _num(H.turnedBond)) * 10) / 10);
        const who = HeirPaths._holderName(player, world, child);
        if (player.house) House._chronicle(player.house, world, `${child.firstName}, long held by ${who}, has come to love their captors more than their House.`, ['heirs', 'threat']);
        HeirPaths._news(out, '🐍', `${child.firstName} Has Turned`, `Held too long at ${who}, ${child.firstName} now takes their part against yours: deceit learned, the bond with you broken.`, 'error', child.id);
    },

    // ──────────── PATH ENDS ────────────

    /** The path ends: completed, recalled, ransomed or unpaid. → the record entry. */
    _end(player, world, child, how, out) {
        const cfg = HeirPaths.config();
        const up = HeirPaths.ensure(child);
        const p = up.path;
        if (!p || !p.active) return null;
        const def = HeirPaths.kind(p.kind) || {};
        const day = _day(world);
        p.active = false;
        const done = how === 'completed';
        const span = Math.max(1, _num(p.until) - _num(p.since));
        const share = done ? 1 : Utils.clamp((day - _num(p.since)) / span, 0, 1) * 0.5;
        // The finishing mark
        if (done) {
            const fin = def.finish || {};
            if (!up.comeOfAge) Upbringing._addSeeds(child, fin.seeds || {});
            else {
                const best = Object.entries(fin.seeds || {}).sort((a, b) => b[1] - a[1])[0];
                const d = best && Traits.TRAITS[best[0]];
                if (d && !up.adultTraits.includes(best[0]) && !(d.opposite && up.adultTraits.includes(d.opposite))) up.adultTraits.push(best[0]);
            }
            for (const [s, n] of Object.entries(fin.skills || {})) child.skills[s] = Math.min(Upbringing.config().skillCap, _num(child.skills[s]) + _num(n));
        }
        if (def.literacy) child.literacy = Math.round(Math.min(100, _num(child.literacy) + _num(def.literacy) * (done ? 1 : share)) * 100) / 100;
        // The people they knew there: their regard is earned by the years
        for (const c of up.contacts) {
            if (c.pathKind !== p.key || c.regard) continue;
            c.regard = Math.round(Math.max(_num(c.target) * 0.3, _num(c.target) * (done ? 1 : Math.max(0.3, share * 2))));
        }
        HeirPaths._introduce(player, world, child, cfg.contactKnownShare);
        if (up.tutor && up.tutor.kind === 'path') up.tutor = null;
        // A court path is a fostering in the House's record (HeirAgency.payoff)
        if (def.fostered && p.kingdomId) {
            const a = HeirAgency.ensure(child);
            const k = HeirPaths._kingdom(world, p.kingdomId);
            a.record.fostered.push({
                kingdomId: p.kingdomId, kingdomName: k ? k.name : p.where, lordName: p.name.replace(/^the (court|hall) of /, ''),
                from: _num(p.since), to: day, minor: true, recalled: !done, path: p.kind,
            });
            if (done) a.record.bonds[p.kingdomId] = Math.min(HeirAgency.config().fosterBondCap, _num(a.record.bonds[p.kingdomId]) + 10);
        }
        if (done && p.rival) {
            const rv = player.house && player.house.rivals && player.house.rivals[p.kingdomId];
            if (rv) rv.feud = Utils.clamp(_num(rv.feud) - _num(def.rivalFeudCut), 0, 100);
        }
        const rec = {
            kind: p.kind, name: def.name || p.kind, icon: def.icon || '🎓', where: p.where, venue: p.name, kingdomId: p.kingdomId,
            from: _num(p.since), to: day, how, language: p.language || null, months: _num(p.months), paid: _num(p.paid),
        };
        up.pathRecord.push(rec);
        const verb = { completed: 'completes', recalled: 'is called home from', ransomed: 'comes home early from', unpaid: 'is sent home from' }[how] || 'leaves';
        const text = `${child.firstName} ${verb} ${p.kind === 'abroad' ? 'fosterage abroad' : `their years as ${HeirPaths._article(def.name)}`} at ${p.name}${how === 'unpaid' ? ', the board unpaid' : ''}.`;
        if (player.house) House._chronicle(player.house, world, text, ['heirs', 'upbringing']);
        if (done) {
            const names = HeirPaths.contacts(player, child).filter(c => c.pathKind === p.key).map(c => `${c.name} (${c.label})`);
            HeirAgency.letter(player, world, child, `Home from ${p.where || p.name}`, `My years at ${p.name} are done. I come home${names.length ? ` with friends I will not forget: ${names.join(', ')}` : ''}.`, p.kingdomId);
            HeirPaths._news(out, def.icon || '🎓', `${child.firstName} Comes Home`, text, 'success', child.id);
        } else {
            HeirPaths._news(out, def.icon || '🎓', `${child.firstName} Comes Home`, text, how === 'unpaid' ? 'warning' : 'info', child.id);
        }
        return rec;
    },

    // ──────────── DAILY ────────────

    /**
     * One day of paths, hostages and wards held as leverage. Draws no shared
     * RNG (hash rolls only). → { notices }
     */
    processDay(player, world) {
        const out = { notices: [] };
        if (!player || !world) return out;
        const cfg = HeirPaths.config();
        const H = cfg.hostage;
        const day = _day(world);
        const Y = HeirPaths._Y();
        const cadence = Upbringing.config().growthCadence > 0 ? Upbringing.config().growthCadence : 30;
        for (const child of (player.children || [])) {
            if (!child || child.isAlive === false) continue;
            const up = HeirPaths.ensure(child);
            const p = up.path;
            if (p && p.active) HeirPaths._pathDay(player, world, child, p, out, cadence, Y);
            // A held child (a path, a fostering, an embassy, a letter gone wrong): the holder's terms, the turning
            if (up.heldBy && child.isAlive !== false && player.interregnum) {
                // The House waits in trust: no terms fall due, the child does not turn (every clock stands still)
                HeirPaths._pauseHeld(up.heldBy);
            } else if (up.heldBy && child.isAlive !== false) {
                const held = up.heldBy;
                if (held.demand && day >= _num(held.demand.due)) HeirPaths._refused(player, world, child, out);
                else if (!held.demand && day - _num(held.lastDemandDay, _num(held.day)) >= (held.demands ? _num(H.demandEvery, 60) : 5)) {
                    held.lastDemandDay = day;
                    HeirPaths._demand(player, world, child, out);
                }
                if (day > _num(held.day) && (day - _num(held.day)) % cadence === 0 && !up.turned) {
                    const bond = _num(up.raising && up.raising.bond, 50);
                    const f = bond >= 70 ? H.turnCloseFactor : bond <= 25 ? H.turnDistantFactor : 1;
                    up.turn = Math.round((_num(up.turn) + _num(H.turnPerMonth) * f) * 10) / 10;
                    HeirPaths._turnCheck(player, world, child, out);
                }
            }
            // The child's friends from the years away stay in the House's life
            if (day % Y === 0) {
                for (const c of up.contacts) {
                    const npc = Relationships.getNPC(c.npcId);
                    if (npc && npc.isAlive !== false) npc.pruneSeen = day;
                }
            }
        }
        HeirPaths._wardsDay(player, world, out, cadence);
        // Rival Houses send their own children away (to your court, or another House's)
        if (!player.interregnum) HeirPaths._rivalChildrenDay(player, world, out);
        return out;
    },

    /** One day of the interregnum for a held child: every clock moves on a day, so none comes nearer. */
    _pauseHeld(held) {
        held.day = _num(held.day) + 1;
        if (held.lastDemandDay != null) held.lastDemandDay = _num(held.lastDemandDay) + 1;
        if (held.demand) held.demand.due = _num(held.demand.due) + 1;
        held.paused = _num(held.paused) + 1;
    },

    _pathDay(player, world, child, p, out, cadence, Y) {
        const H = HeirPaths.config().hostage;
        const up = child.upbringing;
        const def = HeirPaths.kind(p.kind) || {};
        const day = _day(world);
        // Mail.release (a ransom by letter) or another hand freed them: the path is over
        if (p.held && !up.heldBy) {
            p.held = false;
            HeirPaths._end(player, world, child, 'ransomed', out);
            return;
        }
        if (up.heldBy) { p.held = true; return; }
        const since = day - _num(p.since);
        // The board, each year
        if (since > 0 && since % Y === 0 && day < _num(p.until)) {
            const yearly = Utils.cents(_num(def.yearly));
            if (yearly > 0) {
                if (_num(player.gold) >= yearly) {
                    HeirPaths._pay(player, world, p.payee, yearly);
                    p.paid = Utils.cents(_num(p.paid) + yearly);
                    p.yearsPaid = _num(p.yearsPaid) + 1;
                } else {
                    HeirPaths._end(player, world, child, 'unpaid', out);
                    return;
                }
            }
        }
        // The month's learning: the path's own lessons (the master tutors the focus in Upbringing)
        if (since > 0 && since % cadence === 0) {
            p.months = _num(p.months) + 1;
            const years = cadence / Y;
            const q = _num(p.quality, 1);
            for (const [s, rate] of Object.entries(def.stats || {})) if (STATS.includes(s)) Upbringing._addXp(child, 'stat', s, _num(rate) * years * q);
            for (const [s, rate] of Object.entries(def.skills || {})) Upbringing._addXp(child, 'skill', s, _num(rate) * years * q);
            if (!up.comeOfAge) Upbringing._addSeeds(child, def.seeds || {}, years);
            if (p.language && def.languagePerYear) {
                if (!_obj(child.languages)) child.languages = {};
                child.languages[p.language] = Math.round(Math.min(100, _num(child.languages[p.language]) + _num(def.languagePerYear) * years) * 100) / 100;
            }
            for (const c of up.contacts) {
                if (c.pathKind === p.key && !c.regard) c.growing = Math.round(_num(c.target) * Math.min(1, since / Math.max(1, _num(p.until) - _num(p.since))));
            }
        }
        // A court that sours keeps the child
        if (H.checkDays > 0 && day % H.checkDays === 0) HeirPaths._hostageCheck(player, world, child, p, def, out);
        if (up.heldBy) { p.held = true; return; }
        if (day >= _num(p.until)) HeirPaths._end(player, world, child, 'completed', out);
    },

    _hostageCheck(player, world, child, p, def, out) {
        const H = HeirPaths.config().hostage;
        const mode = def.hostage || 'never';
        if (mode === 'never' || !p.kingdomId) return;
        const k = HeirPaths._kingdom(world, p.kingdomId);
        if (!k || k.isAlive === false) return;
        const atWar = CourtLetters.atWar(player, world, k.id);
        let hold = atWar;
        let why = atWar ? 'the war between your realms' : null;
        if (!hold && mode === 'regard') {
            if (p.rival) {
                const rv = player.house && player.house.rivals && player.house.rivals[p.kingdomId];
                if (rv && _num(rv.feud) >= _num(H.rivalFeud)) { hold = true; why = 'the feud between your Houses'; }
            } else if (k.lord && CourtLetters.regard(player, world, k) <= _num(H.regard)) {
                hold = true;
                why = 'their court\'s ill regard for your House';
            }
        }
        if (!hold) return;
        const up = child.upbringing;
        up.heldBy = { kingdomId: k.id, day: _day(world), rival: !!p.rival, path: p.kind, demands: 0 };
        p.held = true;
        HeirAgency._prestige(player, _num(H.heldPrestige), `${child.firstName} held at ${p.where || k.name}`, world);
        const who = HeirPaths._holderName(player, world, child);
        if (player.house) House._chronicle(player.house, world, `For ${why}, ${who} keeps ${child.firstName} as a hostage.`, ['heirs', 'threat']);
        HeirPaths._news(out, '⛓️', `${child.firstName} Held`, `For ${why}, ${who} keeps ${child.firstName} as a hostage. Terms will follow.`, 'error', child.id);
    },

    // ──────────── WARDS AS LEVERAGE ────────────

    /** Keep a ward past their term (or against their realm's wish): leverage over that realm. */
    keepWard(player, world, wardId) {
        const L = HeirPaths.config().wardLeverage;
        const ward = Raising.wards(player).find(w => w.id === wardId);
        if (!ward) return { success: false, reason: 'No such ward.' };
        if (ward.kept) return { success: false, reason: `${ward.firstName} is already kept.` };
        ward.kept = { day: _day(world) };
        const k = HeirPaths._kingdom(world, ward.kingdomId);
        if (ward.rivalId != null) {
            House.accrueRivalFeud(player, world, ward.rivalId, _num(HeirPaths._rivalWards().keepFeud, 10), `${ward.firstName} kept as a hostage`);
            const rv = HeirPaths._rivalOf(player, ward);
            if (rv) RivalHouses.remember(rv, world, 'threatened', `${ward.firstName} kept`);
        } else {
            HeirPaths._rep(player, ward.kingdomId, _num(L.keepReputation));
            if (k && k.lord) NPCLords.rememberDeed(world, k.lord, 'threat', { note: `${ward.firstName} kept` });
        }
        if (player.house) House._chronicle(player.house, world, `${player.house.name} will not send ${ward.firstName} home to ${ward.kingdomName}: the ward is a hostage now.`, ['heirs', 'court']);
        return { success: true, ward };
    },

    /** Let a kept ward go back to being a ward (they go home at their term). */
    releaseKept(player, world, wardId) {
        const ward = Raising.wards(player).find(w => w.id === wardId);
        if (!ward || !ward.kept) return { success: false, reason: 'They are not kept.' };
        ward.kept = null;
        return { success: true, ward };
    },

    /** What a ward's realm would pay to have them back. Pure. */
    wardRansom(world, ward) {
        const L = HeirPaths.config().wardLeverage;
        if (ward.offer && _num(ward.offer.until) >= _day(world)) return Utils.cents(ward.offer.amount);
        if (ward.rivalId != null) return Utils.cents(_num(HeirPaths._rivalWards().ransom, 150));
        return Utils.cents(ward.royalId ? _num(L.ransomRoyal) : _num(L.ransomBase));
    },

    /** Ransom a held or kept ward back to their realm: its crown pays into your purse. */
    ransomWard(player, world, wardId) {
        const L = HeirPaths.config().wardLeverage;
        const ward = Raising.wards(player).find(w => w.id === wardId);
        if (!ward) return { success: false, reason: 'No such ward.' };
        if (!ward.held && !ward.kept) return { success: false, reason: `${ward.firstName} is a ward, not a hostage. Keep them first.` };
        if (ward.rivalId != null) return HeirPaths._ransomRival(player, world, ward);
        const k = HeirPaths._kingdom(world, ward.kingdomId);
        if (!k || k.isAlive === false) return { success: false, reason: 'Their realm is no more.' };
        const want = HeirPaths.wardRansom(world, ward);
        const paid = Economy.crownPays(k, world, want);
        if (!(paid > 0)) return { success: false, reason: `${k.name} has nothing left to pay.` };
        player.gold = Utils.cents(_num(player.gold) + paid);
        Ledger.record(player, 'family', paid);
        const war = !!ward.held;
        HeirPaths._rep(player, k.id, war ? _num(L.ransomWarReputation) : _num(L.ransomPeaceReputation));
        if (k.lord) NPCLords.rememberDeed(world, k.lord, 'extorted', { note: ward.firstName });
        const text = `${ward.firstName} is ransomed home to ${ward.kingdomName} for ${Utils.formatGold(paid)} gold.`;
        Raising._wardGone(player, world, ward, 'ransomed', text);
        return { success: true, ward, paid, text };
    },

    /** The wards kept or held: standing falls, the realm may spirit them away or make an offer (hash rolls). */
    _wardsDay(player, world, out, cadence) {
        if (!player.house) return;
        const L = HeirPaths.config().wardLeverage;
        const day = _day(world);
        for (const ward of Raising.wards(player).slice()) {
            if (ward.rivalId != null) { HeirPaths._rivalWardDay(player, world, ward, out, cadence); continue; }
            const k = HeirPaths._kingdom(world, ward.kingdomId);
            if (!k || k.isAlive === false) continue;
            if (ward.offer && day > _num(ward.offer.until)) ward.offer = null;
            if (!ward.held && !ward.kept) continue;
            const since = day - _num((ward.kept && ward.kept.day) || ward.since);
            if (since <= 0 || since % cadence !== 0) continue;
            if (ward.kept) HeirPaths._rep(player, k.id, _num(L.keepMonthlyReputation));
            // The realm's answer: it spirits its child away...
            if (_roll(world, `${ward.id}:rescue:${day}`) < _num(L.rescueChancePerMonth)) {
                HeirPaths._rep(player, k.id, _num(L.rescuedReputation));
                const text = `${ward.firstName} is spirited away from your court by men of ${Names.realm(k.name)}.`;
                Raising._wardGone(player, world, ward, 'spirited away', text);
                HeirPaths._news(out, '🌒', 'A Ward Spirited Away', text, 'warning');
                continue;
            }
            // ...or offers to buy them back
            if (!ward.offer && since % Math.max(cadence, _num(L.offerEvery, 60)) === 0) {
                const base = ward.royalId ? _num(L.ransomRoyal) : _num(L.ransomBase);
                const can = Math.floor(_num(k.treasury) * 0.5);
                const amount = Utils.cents(Math.max(0, Math.min(base, can)));
                if (amount > 0) {
                    ward.offer = { amount, until: day + _num(L.offerDays, 30) };
                    HeirPaths._news(out, '💰', `An Offer for ${ward.firstName}`, `${k.name} offers ${Utils.formatGold(amount)} gold to have ${ward.firstName} home (Dynasty → Wards at Court).`, 'info');
                }
            }
        }
    },

    // ──────────── RIVALS' CHILDREN ────────────

    /** data/upbringing.json → raising.wards.rival (shared with systems/raising.js). */
    _rivalWards() {
        return Raising._rivalWardCfg();
    },

    _rivalOf(player, ward) {
        return Raising._rivalOf(player, ward);
    },

    /**
     * A real child of the host House for a squire's fellow squire: a rival
     * head's child, or a royal child of the realm, the nearest in age (within
     * hostChildGap years) and not already another's fellow. → { firstName,
     * dynasty, gender, age, ref, mark(by) } or null.
     */
    _hostChild(player, world, child, v) {
        const gap = _num(HeirPaths._rivalWards().hostChildGap, 3);
        const age = _num(child.age);
        const near = list => list.filter(c => c && c.isAlive !== false && !c.wed && !c.squireWith && Math.abs(_num(c.age) - age) <= gap)
            .sort((a, b) => Math.abs(_num(a.age) - age) - Math.abs(_num(b.age) - age) || String(a.firstName).localeCompare(String(b.firstName)))[0] || null;
        if (v.rival) {
            const rv = player.house && player.house.rivals ? player.house.rivals[v.kingdomId] : null;
            const c = rv && rv.head ? near(rv.head.children || []) : null;
            if (!c) return null;
            return {
                firstName: c.firstName, dynasty: RivalHouses.surname(rv), gender: c.gender, age: _num(c.age),
                ref: { rivalId: rv.kingdomId, firstName: c.firstName }, mark: by => { c.squireWith = by; },
            };
        }
        const k = HeirPaths._kingdom(world, v.kingdomId);
        const c = k && k.characterData ? near(k.characterData.children || []) : null;
        if (!c) return null;
        return {
            firstName: c.firstName, dynasty: c.dynasty || (k.characterData.ruler && k.characterData.ruler.dynasty) || '', gender: c.gender, age: _num(c.age),
            ref: { kingdomId: k.id, royalId: c.id || null, firstName: c.firstName }, mark: by => { c.squireWith = by; },
        };
    },

    /** A rival's child the House could send away: of age for it, unwed, at home, never sent before. */
    _sendable(rv, R) {
        const kids = (rv && rv.head && rv.head.children) || [];
        return kids.filter(c => c && c.isAlive !== false && !c.wed && !c.wardAt && !c.sentAway && !c.squireWith
            && _num(c.age) >= _num(R.minAge, 7) && _num(c.age) <= _num(R.maxAge, 13))
            .sort((a, b) => _num(a.age) - _num(b.age) || String(a.firstName).localeCompare(String(b.firstName)))[0] || null;
    },

    /**
     * Each month, a rival House may send a child of its own away (a hash
     * roll): to the player's court as a ward (a seat free, the feud cool
     * enough, no child of theirs there already), else to another rival House
     * it is on good terms with. Children fostered at another House come home
     * at their term.
     */
    _rivalChildrenDay(player, world, out) {
        if (!player.house || !player.house.rivals) return;
        const R = HeirPaths._rivalWards();
        const every = _num(R.checkDays, 30);
        const day = _day(world);
        if (!(every > 0) || day % every !== 0) return;
        const Y = HeirPaths._Y();
        const live = Object.values(player.house.rivals).filter(rv => rv && rv.head && rv.kingdomId != null);
        for (const rv of live) {
            // Home from another House at their term
            for (const c of rv.head.children || []) {
                if (!c || c.wardOf == null || c.wardOf === 'player' || day < _num(c.wardUntil)) continue;
                const host = live.find(x => String(x.kingdomId) === String(c.wardOf));
                if (host) RivalHouses.bond(rv, host, _num(R.homeBond, 5));
                RivalHouses._note(rv, world, `${c.firstName} comes home from ${c.wardAt}.`);
                delete c.wardAt;
                delete c.wardOf;
                delete c.wardUntil;
            }
            if (_roll(world, `rivalChild:${rv.kingdomId}:${day}`) >= _num(R.chance, 0.04)) continue;
            const c = HeirPaths._sendable(rv, R);
            if (!c) continue;
            const atYourCourt = Raising.wards(player).length < Raising.wardSeats(player)
                && _num(rv.feud) <= _num(R.maxFeud, 40) && !RivalHouses.hostsChild(player, rv);
            if (atYourCourt) {
                const ward = {
                    id: `ward_rival_${rv.kingdomId}_${day}`, firstName: c.firstName, dynasty: RivalHouses.surname(rv), gender: c.gender || 'male', age: _num(c.age),
                    royalId: null, rivalId: rv.kingdomId, rivalChild: c.firstName, kingdomId: rv.kingdomId, kingdomName: rv.name, lordName: RivalHouses.headName(rv),
                    since: day, until: day + _num(R.years, 3) * Y, held: false, repGiven: 0, feesPaid: 0, fateRolls: 0, feudGiven: 0,
                };
                Raising.wards(player).push(ward);
                c.wardAt = player.house.name || 'your court';
                c.wardOf = 'player';
                c.sentAway = true;
                RivalHouses._note(rv, world, `${c.firstName} is sent to be raised at the court of ${player.house.name}.`);
                const text = `${RivalHouses.headName(rv)} sends ${c.firstName}, aged ${ward.age}, to be raised at your court: a pledge of peace, and a hostage to fortune.`;
                House._chronicle(player.house, world, text, ['heirs', 'court', 'rival']);
                HeirPaths._news(out, '🎓', `${rv.name} Sends a Child`, `${text} While ${c.firstName} lives under your roof, ${rv.name} will not plot or ride against you (Dynasty → Wards at Court).`, 'info');
                continue;
            }
            // ...or to another House they are friendly with
            const hosts = live.filter(x => x !== rv && RivalHouses.tie(rv, x) >= _num(R.minTie, 10))
                .sort((a, b) => RivalHouses.tie(rv, b) - RivalHouses.tie(rv, a) || String(a.kingdomId).localeCompare(String(b.kingdomId)));
            const host = hosts[0];
            if (!host) continue;
            c.wardAt = host.name;
            c.wardOf = host.kingdomId;
            c.sentAway = true;
            c.wardUntil = day + _num(R.years, 3) * Y;
            RivalHouses.bond(rv, host, _num(R.tieBond, 10));
            RivalHouses._note(rv, world, `${c.firstName} is sent to be raised by ${host.name}.`);
            RivalHouses._note(host, world, `${RivalHouses.headName(rv)} sends ${c.firstName} to be raised in their hall.`);
        }
    },

    /** A kept or held rival's child, a month on: the feud grows while kept; they may steal the child back or offer to buy it. */
    _rivalWardDay(player, world, ward, out, cadence) {
        const R = HeirPaths._rivalWards();
        const L = HeirPaths.config().wardLeverage;
        const day = _day(world);
        const rv = HeirPaths._rivalOf(player, ward);
        if (!rv) return;
        if (ward.offer && day > _num(ward.offer.until)) ward.offer = null;
        if (!ward.held && !ward.kept) return;
        const since = day - _num((ward.kept && ward.kept.day) || ward.since);
        if (since <= 0 || since % cadence !== 0) return;
        if (ward.kept) House.accrueRivalFeud(player, world, ward.rivalId, _num(R.keepMonthlyFeud, 2));
        if (_roll(world, `${ward.id}:rescue:${day}`) < _num(L.rescueChancePerMonth)) {
            House.accrueRivalFeud(player, world, ward.rivalId, _num(R.rescuedFeud, 5));
            const text = `${ward.firstName} is spirited away from your court by men of ${rv.name}.`;
            Raising._wardGone(player, world, ward, 'spirited away', text);
            HeirPaths._news(out, '🌒', 'A Ward Spirited Away', text, 'warning');
            return;
        }
        if (!ward.offer && since % Math.max(cadence, _num(L.offerEvery, 60)) === 0) {
            const amount = Utils.cents(Math.max(0, Math.min(_num(R.ransom, 150), Math.floor(_num(rv.gold) * 0.5))));
            if (amount > 0) {
                ward.offer = { amount, until: day + _num(L.offerDays, 30) };
                HeirPaths._news(out, '💰', `An Offer for ${ward.firstName}`, `${rv.name} offers ${Utils.formatGold(amount)} gold to have ${ward.firstName} home (Dynasty → Wards at Court).`, 'info');
            }
        }
    },

    /** Ransom a rival's child home: the rival pays from its purse into yours; the feud remembers. */
    _ransomRival(player, world, ward) {
        const R = HeirPaths._rivalWards();
        const rv = HeirPaths._rivalOf(player, ward);
        if (!rv) return { success: false, reason: 'Their House is no more.' };
        const want = HeirPaths.wardRansom(world, ward);
        const paid = Utils.cents(Math.min(want, Math.max(0, _num(rv.gold))));
        if (!(paid > 0)) return { success: false, reason: `${rv.name} has nothing left to pay.` };
        rv.gold = Utils.cents(_num(rv.gold) - paid);
        player.gold = Utils.cents(_num(player.gold) + paid);
        Ledger.record(player, 'family', paid);
        House.accrueRivalFeud(player, world, ward.rivalId, _num(R.ransomFeud, 15), `${ward.firstName} ransomed`);
        RivalHouses.remember(rv, world, 'threatened', `${ward.firstName} ransomed`);
        const text = `${ward.firstName} is ransomed home to ${rv.name} for ${Utils.formatGold(paid)} gold.`;
        Raising._wardGone(player, world, ward, 'ransomed', text);
        return { success: true, ward, paid, text };
    },

    // ──────────── SUCCESSION ────────────

    /**
     * The heir's contacts and tongues come to the throne with them
     * (Relationships.succeedAsHeir, after HeirAgency.onSuccession, which
     * carries the standing and Prestige of HeirAgency.payoff).
     */
    onSuccession(player, world, child) {
        if (!player || !child) return null;
        const cfg = HeirPaths.config();
        const up = HeirPaths.ensure(child);
        const friends = [];
        for (const c of HeirPaths.contacts(player, child)) {
            const rel = Relationships.getRelationship(player, c.npcId);
            rel.score = Math.max(_num(rel.score), Math.round(_num(c.regard || c.growing)));
            if (Array.isArray(rel.history)) rel.history.push({ day: _day(world), action: 'friend_of_youth', result: c.label });
            if (c.rival) {
                const rv = player.house && player.house.rivals && player.house.rivals[c.kingdomId];
                if (rv) rv.feud = Utils.clamp(_num(rv.feud) - _num(cfg.contactRivalFeud), 0, 100);
            }
            friends.push(c.name);
        }
        // The tongues they learned abroad
        for (const [lang, v] of Object.entries(_obj(child.languages) || {})) {
            if (!_obj(player.languages)) player.languages = {};
            if (_num(v) > _num(player.languages[lang])) player.languages[lang] = Math.round(_num(v) * 100) / 100;
        }
        // The standing and Prestige of the years away, and their line in the Annals
        // (merged into the life-before-the-throne record HeirAgency.onSuccession wrote)
        const plan = HeirPaths.payoffLines(player, world, child);
        for (const [kid, n] of Object.entries(plan.reputation)) HeirPaths._rep(player, kid, n);
        if (plan.prestige) HeirAgency._prestige(player, plan.prestige, `${child.firstName}'s years away`, world);
        if (player.house && plan.lines.length) {
            const parts = plan.lines.map(l => l.text.replace(/\s*\([^)]*\)/g, '').replace(/\.$/, ''));
            const gen = player.house.generation || 1;
            const rec = _arr(player.house.history).slice().reverse().find(h => _arr(h.tags).includes('heirRecord') && (h.generation || 1) === gen);
            if (rec) rec.text = `${String(rec.text).replace(/\.$/, '')}; ${parts.join('; ')}.`;
            else House._chronicle(player.house, world, `${child.firstName} came to the seat with a life already lived: ${parts.join('; ')}.`, ['heirRecord']);
        }
        return { friends, turned: up.turned || null, plan };
    },

    /** Payoff lines for HeirAgency.payoff (pure): paths not at a court, the friends, a turned heir. */
    payoffLines(player, world, child) {
        const cfg = HeirPaths.config();
        const H = cfg.hostage;
        const out = { lines: [], prestige: 0, reputation: {} };
        const up = child && child.upbringing;
        if (!up) return out;
        for (const r of _arr(up.pathRecord)) {
            const def = HeirPaths.kind(r.kind) || {};
            if (def.fostered) continue; // (told as a fostering)
            out.lines.push({ icon: r.icon || '🎓', text: `${r.how === 'completed' ? 'Served' : 'Began'} as ${HeirPaths._article(r.name)} at ${r.venue}.` });
            if (r.how === 'completed') out.prestige += 1;
        }
        const live = _arr(up.contacts).filter(c => { const n = Relationships.getNPC(c.npcId); return n && n.isAlive !== false; });
        if (live.length) {
            let rep = 0;
            for (const c of live) {
                if (!c.kingdomId || rep >= cfg.contactRepCap) continue;
                const n = Math.min(_num(cfg.contactSuccessionRep), cfg.contactRepCap - rep);
                out.reputation[c.kingdomId] = _num(out.reputation[c.kingdomId]) + n;
                rep += n;
            }
            out.lines.push({ icon: '🤝', text: `Friends from the years away: ${live.slice(0, 4).map(c => c.name).join(', ')}${live.length > 4 ? ` and ${live.length - 4} more` : ''}${rep ? ` (+${rep} standing)` : ''}.` });
        }
        if (up.turned) {
            out.prestige += _num(H.turnedPrestige);
            if (up.turned.kingdomId) out.reputation[up.turned.kingdomId] = _num(out.reputation[up.turned.kingdomId]) + _num(H.turnedHostReputation);
            out.lines.push({ icon: '🐍', text: `Turned while a hostage at ${up.turned.kingdomName || 'a foreign court'}: that court counts the new ruler its creature (${_num(H.turnedPrestige)} Prestige).` });
        }
        return out;
    },

    // ──────────── VIEW ────────────

    /** One line for the Dynasty list: where a child on a path is. */
    status(child) {
        const p = child && child.upbringing && child.upbringing.path;
        if (!p || !p.active) return '';
        const def = HeirPaths.kind(p.kind) || {};
        return `${def.icon || '🎓'} ${def.name || p.kind} at ${p.name} until day ${p.until}`;
    },
};
