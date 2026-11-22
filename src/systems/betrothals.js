// ============================================
// BETROTHALS — the House's children promised to bind Houses and realms
// ============================================
// systems/heirAgency.js already let the House promise a child to "a realm's
// nobility" (an invented noble, half the dowry now, the match at coming of
// age; war or a hot rival feud breaks it; a broken one is grounds for a
// suit). This system makes the promise a negotiation with a real person:
//
//   WHO        a rival House's child (house.rivals[k].head.children), a lord of
//              your own realm's house (Kingship vassals, when you rule), a
//              foreign crown's prince or princess (k.characterData.children —
//              the eldest is the heir; one who comes to the throne is a
//              reigning monarch at the wedding), or a realm's nobility (the
//              old heirAgency kind, 'noble'). Infants may be promised.
//   TERMS      whose House the couple's line belongs to (line 'ours': their
//              child takes your name, they ask more; 'theirs': yours goes to
//              them, they ask less), a ward arrangement (your child raised at
//              their court until the wedding — HeirAgency.fosterChild, so the
//              host's court shapes the upbringing — or theirs at yours, a ward
//              of systems/raising.js and a hostage in all but name), and the
//              dowry in coin and land (one of your estates, settled at the
//              wedding). Their asking price (`quote`) is the kind's base price ×
//              status (their weight over your Prestige) less what they think of
//              you, moved by the terms. A negative ask: they pay you. Half the
//              coin changes hands now, the rest and the land at the wedding.
//              Coin goes into their real purse (the rival's gold, the crown's
//              treasury, the realm's towns for a lord) and comes out of it.
//   THE BOND   while it stands: a rival House keeps a truce (rival.truceUntil
//              — no plots, agents or waylaying) and its feud eases; a realm
//              you rule and the betrothed's realm keep a truce
//              (kingdom.truces, read by KingdomAI) and warm to each other; the
//              realm is slower to join a league (Heirs.kinshipWith →
//              coalitions); a lord of your realm is favoured (vassal.favour,
//              read by Kingship.opinion), and a royal match pleases all of them.
//   THE WEDDING when your child has come of age and theirs is of an age: the
//              rest of the dowry and the land; the match (up.spouse) as the
//              marriage code writes it; a royal match grants a marriage claim
//              (Throne.grantClaim — the claim High Crowns' councils honour),
//              more for the heir or a reigning monarch, more again when your
//              child goes to them; a lord's house becomes kin (vassal.kin).
//   BREAKING   by you: what they paid goes back, what you paid is lost,
//              Prestige, standing, a hotter feud, the lord's memory of
//              'betrothal_broken' (grounds for their suit: rivalHouses
//              lawGrounds). Free when their child was maimed or taken captive.
//              By them (war, a hot feud — heirAgency; a better match when your
//              House falls from grace; a maimed child of yours refused; a
//              rival of little honour): they send back what you paid, as far as
//              their purse allows; a rival's broken word (rival.brokeWord,
//              rival.brokeBetrothal) is grounds for your suit.
//   THE AI     rival Houses on good terms promise their young children to each
//              other, break the promise when their regard sours and keep it
//              with a wedding; now and then a House or crown on good terms
//              offers you a match (player.betrothals.offers).
//
// State: the promise on child.upbringing.agency.betrothal (the same slot the
// old kind used, so every reader of it keeps working) with `kind`, `terms`,
// and the other side's ids; markers on the other side (rival child
// .betrothed, royal .betrothedTo, vassal .betrothedTo); offers, history and
// counts on player.betrothals (SaveLoad EXTRA_PLAYER_FIELDS). Draws no RNG:
// every roll is a hash of (world seed, key). Content: data/betrothals.json.
// No import-time side effects.

import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { Names } from '../core/names.js';
import { Interrupts } from '../core/interrupts.js';
import { NPCLords } from '../world/npcLords.js';
import { Economy } from '../world/economy.js';
import { MoneySupply } from '../world/moneySupply.js';
import { Estates } from '../world/estates.js';
import { House } from './house.js';
import { Upbringing } from './upbringing.js';
import { Heirs } from './heirs.js';
import { HeirAgency } from './heirAgency.js';
import { Raising } from './raising.js';
import { RivalHouses } from './rivalHouses.js';
import { Throne } from './throne.js';
import { Kingship } from './kingship.js';
import { LandMarket } from './landMarket.js';
import { Ledger } from './ledger.js';
import { CourtLetters } from './courtLetters.js';
import { MaimMarks } from './maimMarks.js';
import { Traits } from './traits.js';

const DEFAULTS = {
    minAge: 0, maxAgeGap: 8, marryAge: { royal: 16, vassal: 16, noble: 16 },
    price: { noble: 120, vassal: 100, rival: 220, royal: 600, royalHeir: 1400 },
    weight: { noble: 60, vassal: 45, rival: 70, rivalPerRenown: 0.5, royal: 220, royalHeir: 400, rivalHeir: 1.3 },
    statusClamp: [0.35, 2.6], regardPerPoint: 0.006, regardClamp: [-0.4, 0.4],
    line: { ours: 0.6, theirs: -0.35 }, ward: { oursThere: -0.3, theirsHere: 0.35 },
    nowShare: 0.5, minRealmReputation: -10, rivalMaxFeud: 60, maxBetrothed: 6,
    onBetroth: { reputation: 8, rivalFeud: -15, rivalMemory: 12, vassalFavour: 15, royalFavourAll: 3, prestigeRoyal: 4, prestige: 2 },
    bond: { everyDays: 7, truceDays: 10, rivalFeudWeekly: -1, rivalFeudFloor: 10, realmRelations: 1, realmRelationsCap: 40 },
    wed: { prestige: 4, prestigeOurs: 4, rivalFeud: -30, reputation: 7, vassalFavour: 10, claim: 15, claimHeir: 30, claimRuler: 40, claimTheirs: 1.3, shortReputation: -8, rivalMemory: 10 },
    breakByYou: { prestige: 6, prestigeRoyal: 12, reputation: -15, rivalFeud: 25, vassalFavour: -25, vassalGrudge: 20, royalFavourAll: -3, rivalMemory: -18, flawFree: true },
    ai: { checkDays: 30, fallShare: 0.5, fallChance: 0.15, maimedChance: 0.5, lowHonourChance: 0.06, lowHonourFeud: 40 },
    houses: { tieMin: 15, chance: 0.25, bond: 15, breakTie: -10, breakBond: -20, wedBond: 25 },
    offers: { checkDays: 30, chance: 0.05, cooldownDays: 240, offerDays: 45, minRealmReputation: 15, rivalMaxFeud: 30, discount: 0.8 },
    vassalWard: { favourPerMonth: 1, favourCap: 10 },
    issue: { chance: 0.3, max: 4, motherFrom: 16, motherTo: 42, rivalFeud: -5, bloodClaim: 12, bloodClaimHeir: 25, bloodClaimRuler: 40 },
    crowns: { tieMin: 20, chance: 0.2, maxAge: 15, ageGap: 6, truceDays: 10, relations: 1, relationsCap: 50, wedRelations: 60, breakRelations: -15 },
    historyCap: 20,
};
const NESTED = ['marryAge', 'price', 'weight', 'line', 'ward', 'onBetroth', 'bond', 'wed', 'breakByYou', 'ai', 'houses', 'offers', 'vassalWard', 'issue', 'crowns'];
export const LINES = ['theirs', 'ours'];
export const WARDS = ['none', 'oursThere', 'theirsHere'];

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = (world) => _num(world && world.day);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _seed = (world) => (world && world.generationParams && world.generationParams.seed) || 0;
const _his = (p) => (p && p.gender === 'female' ? 'her' : 'his');

let _memo = { src: undefined, out: null };

/** Coin to a realm's towns (else the nearest town; else booked lost — never vanished). */
function _toRealm(world, k, amount, why) {
    if (!(amount > 0) || !world) return;
    if (k && Economy.payRealm(k, world, amount)) return;
    MoneySupply.leak(world, -amount, why);
}

export const Betrothals = {
    config() {
        const raw = DataLoader._gamedata && DataLoader._gamedata.betrothals;
        if (_memo.out && _memo.src === raw) return _memo.out;
        const d = _obj(raw) || {};
        const out = { ...DEFAULTS, ...d };
        for (const k of NESTED) out[k] = { ...DEFAULTS[k], ...(_obj(d[k]) || {}) };
        _memo = { src: raw, out };
        return out;
    },

    _Y() {
        return Math.max(1, Upbringing._daysPerYear());
    },

    /** A hash roll in [0,1): the same world and key always roll the same. */
    _roll(world, key) {
        const h = (Utils.hashStr(`${_seed(world)}|betrothals|${key}`) >>> 0) % 233279;
        return Utils.seededRandom(h + 1)();
    },

    // ──────────── STATE ────────────

    state(player) {
        if (!player) return null;
        let s = player.betrothals;
        if (!_obj(s)) s = player.betrothals = {};
        if (!Array.isArray(s.offers)) s.offers = [];
        if (!Array.isArray(s.history)) s.history = [];
        if (!Number.isFinite(s.lastOfferDay)) s.lastOfferDay = -1e9;
        if (!_obj(s.stats)) s.stats = {};
        for (const k of ['made', 'kept', 'brokenByYou', 'brokenByThem', 'ended', 'offered']) if (!Number.isFinite(s.stats[k])) s.stats[k] = 0;
        return s;
    },

    _history(player, world, entry) {
        const s = Betrothals.state(player);
        s.history.push({ day: _day(world), ...entry });
        const cap = Betrothals.config().historyCap;
        if (s.history.length > cap) s.history.splice(0, s.history.length - cap);
    },

    _kingdom(world, kid) {
        return world && typeof world.getKingdom === 'function' && kid != null ? world.getKingdom(kid) : null;
    },

    _child(player, childId) {
        return ((player && player.children) || []).find(c => c && c.id === childId) || null;
    },

    /** The promise a child stands under, or null. */
    of(child) {
        const a = child && child.upbringing && child.upbringing.agency;
        return (a && a.betrothal) || null;
    },

    /** One line for a child's row: "💍 Promised to Aldric Vane of House Vane — weds at 16 (line yours)". */
    line(child, world = null) {
        const b = Betrothals.of(child);
        if (!b) return '';
        const kind = b.kind || 'noble';
        const who = kind === 'rival' ? `${b.name} of ${b.houseName || b.kingdomName}`
            : kind === 'royal' ? `${b.name}, ${b.heir ? 'heir' : (b.their && b.their.gender === 'female' ? 'princess' : 'prince')} of ${Names.realm(b.kingdomName)}`
                : kind === 'vassal' ? `${b.name}` : b.name;
        const t = b.terms || {};
        const bits = [];
        if (t.line === 'ours') bits.push('they take your name');
        else if (t.line === 'theirs') bits.push(`${child.firstName} goes to them`);
        if (t.ward === 'oursThere') bits.push(`${child.firstName} raised at their court`);
        if (t.ward === 'theirsHere') bits.push('their child raised at yours');
        if (b.flaw) bits.push(b.flaw === 'maimed' ? 'their child is maimed: you may break it freely' : 'their child is held captive');
        return `💍 Promised to ${who}${bits.length ? ` (${bits.join('; ')})` : ''}`;
    },

    // ──────────── WHO ────────────

    /** Children who may be promised: alive, unwed, not already promised. */
    eligibleChildren(player) {
        return ((player && player.children) || []).filter(c => {
            if (!c || c.isAlive === false) return false;
            const up = Upbringing.ensure(c);
            return !up.spouse && !Betrothals.of(c) && _num(c.age) >= Betrothals.config().minAge;
        });
    },

    _gap(child, age) {
        return Math.abs(_num(child.age) - _num(age)) <= Betrothals.config().maxAgeGap;
    },

    _wants(child) {
        return child && child.gender === 'female' ? 'male' : 'female';
    },

    _eldestRoyal(k) {
        const kids = ((k && k.characterData && k.characterData.children) || []).filter(c => c && c.isAlive !== false);
        return kids.sort((a, b) => _num(b.age) - _num(a.age))[0] || null;
    },

    /** A royal by id among a realm's children, or its ruler (an heir crowned since). */
    _royal(world, kid, royalId) {
        const k = Betrothals._kingdom(world, kid);
        const d = k && k.characterData;
        if (!d) return { k, royal: null, ruler: false };
        const c = (d.children || []).find(x => x && x.id === royalId);
        if (c) return { k, royal: c, ruler: false };
        if (d.ruler && d.ruler.id === royalId) return { k, royal: d.ruler, ruler: true };
        return { k, royal: null, ruler: false };
    },

    _rival(player, kid) {
        const r = player && player.house && player.house.rivals ? player.house.rivals[kid] : null;
        return r && r.head ? r : null;
    },

    _rivalChild(rival, firstName) {
        return ((rival && rival.head && rival.head.children) || []).find(c => c && c.firstName === firstName && c.isAlive !== false) || null;
    },

    _vassal(player, id) {
        const court = player && player.throne && player.throne.ruling ? Kingship.court(player) : null;
        return court ? (court.vassals || []).find(v => v && v.id === id) || null : null;
    },

    /** A deterministic name for a child no one has met (a lord's, a noble's). */
    _invented(world, gender, culture, key) {
        const pools = DataLoader._gamedata && DataLoader._gamedata.characters && DataLoader._gamedata.characters.firstNames;
        const list = (pools && (pools[culture] || pools.Imperial) && (pools[culture] || pools.Imperial)[gender]) || (gender === 'female' ? ['Helena', 'Maud', 'Isolde'] : ['Edmund', 'Osric', 'Aldo']);
        return list[(Utils.hashStr(`${_seed(world)}:${key}`) >>> 0) % list.length];
    },

    /**
     * Everyone a child could be promised to: [{ id, kind, name, age, gender,
     * houseName, kingdomId, kingdomName, heir, ruler, ok, why, regard }].
     */
    suitors(player, world, childId) {
        const C = Betrothals.config();
        const child = Betrothals._child(player, childId);
        if (!child || !world) return [];
        const want = Betrothals._wants(child);
        const out = [];
        const ruled = Throne.ruledKingdom(player, world);
        // Rival Houses' children
        for (const rv of RivalHouses.rivals(player)) {
            if (!rv || !rv.head) continue;
            const L = RivalHouses.config().life;
            const k = Betrothals._kingdom(world, rv.kingdomId);
            const heir = RivalHouses.heirOf(rv, { any: true });
            for (const c of rv.head.children || []) {
                if (!c || c.isAlive === false || c.wed || c.betrothed || c.gender !== want || !Betrothals._gap(child, c.age)) continue;
                if (_num(c.age) >= _num(L.marryFrom, 18) + 6) continue;
                let why = null;
                if (c.captiveOf) why = `${c.firstName} is held captive.`;
                else if (_num(rv.feud) > C.rivalMaxFeud) why = `${RivalHouses.headName(rv)} will not hear of it while the feud runs so hot (${Math.round(rv.feud)}; at most ${C.rivalMaxFeud}).`;
                else if (CourtLetters.atWar(player, world, rv.kingdomId)) why = `You are at war with ${k ? Names.realm(k.name) : 'their realm'}.`;
                out.push({
                    id: `rival:${rv.kingdomId}:${c.firstName}`, kind: 'rival', name: `${c.firstName} ${RivalHouses.surname(rv)}`, first: c.firstName,
                    age: _num(c.age), gender: c.gender, houseName: rv.name, kingdomId: rv.kingdomId, kingdomName: k ? k.name : rv.name,
                    heir: heir === c, ruler: false, ok: !why, why, regard: RivalHouses.regard(rv, world), maimed: MaimMarks.any(c),
                });
            }
        }
        // Foreign crowns' princes and princesses
        for (const k of (world.kingdoms || [])) {
            if (!k || !k.isAlive || (ruled && ruled.id === k.id)) continue;
            const eldest = Betrothals._eldestRoyal(k);
            const rep = _num(player.reputation && player.reputation[k.id]);
            const atWar = CourtLetters.atWar(player, world, k.id);
            for (const c of ((k.characterData && k.characterData.children) || [])) {
                if (!c || c.isAlive === false || c.spouseId || c.betrothedTo || c.gender !== want || !Betrothals._gap(child, c.age) || _num(c.age) >= 24) continue;
                let why = null;
                if (atWar) why = `You are at war with ${Names.realm(k.name)}.`;
                else if (rep < C.minRealmReputation + (eldest === c ? 15 : 0)) why = `${k.name} will not promise its blood to a House it distrusts (standing ${Math.round(rep)}; need ${C.minRealmReputation + (eldest === c ? 15 : 0)}).`;
                out.push({
                    id: `royal:${k.id}:${c.id}`, kind: 'royal', name: `${c.firstName}${c.dynasty ? ' ' + c.dynasty : ''}`, first: c.firstName,
                    age: _num(c.age), gender: c.gender, houseName: `the royal house of ${Names.realm(k.name)}`, kingdomId: k.id, kingdomName: k.name,
                    heir: eldest === c, ruler: false, ok: !why, why, regard: rep, maimed: MaimMarks.any(c), royalId: c.id,
                });
            }
        }
        // The lords of your own realm
        if (ruled) {
            const court = Kingship.court(player);
            for (const v of ((court && court.vassals) || [])) {
                if (!v || v.kin || v.betrothedTo) continue;
                const first = Betrothals._invented(world, want, v.culture || ruled.culture, `vassal:${v.id}:${want}`);
                const why = v.rebel ? `${Kingship.fullName(v)} is in revolt.` : null;
                out.push({
                    id: `vassal:${v.id}`, kind: 'vassal', name: `${first} ${v.dynasty || ''}`.trim(), first, age: _num(child.age), gender: want,
                    houseName: `the house of ${Kingship.fullName(v)}`, kingdomId: ruled.id, kingdomName: ruled.name, vassalId: v.id,
                    heir: false, ruler: false, ok: !why, why, regard: _num(v.opinion),
                });
            }
        }
        // A realm's nobility (the old kind)
        for (const k of Heirs.kingdoms(player, world)) {
            const rep = _num(player.reputation && player.reputation[k.id]);
            const why = CourtLetters.atWar(player, world, k.id) ? `You are at war with ${Names.realm(k.name)}.`
                : rep < C.minRealmReputation ? `${k.name}'s nobles distrust your House (standing ${Math.round(rep)}).` : null;
            const first = Betrothals._invented(world, want, k.culture, `noble:${k.id}:${want}`);
            out.push({
                id: `noble:${k.id}`, kind: 'noble', name: `${first} of ${Names.realm(k.name)}`, first, age: _num(child.age), gender: want,
                houseName: `the nobility of ${Names.realm(k.name)}`, kingdomId: k.id, kingdomName: k.name,
                heir: false, ruler: false, ok: !why, why, regard: rep,
            });
        }
        return out;
    },

    _suitor(player, world, childId, candId) {
        return Betrothals.suitors(player, world, childId).find(s => s.id === candId) || null;
    },

    // ──────────── THE TERMS ────────────

    _weight(player, world, s) {
        const W = Betrothals.config().weight;
        if (s.kind === 'royal') return s.heir ? W.royalHeir : W.royal;
        if (s.kind === 'rival') {
            const rv = Betrothals._rival(player, s.kingdomId);
            return (W.rival + _num(rv && rv.renown) * W.rivalPerRenown) * (s.heir ? W.rivalHeir : 1);
        }
        return s.kind === 'vassal' ? W.vassal : W.noble;
    },

    _base(s) {
        const P = Betrothals.config().price;
        return s.kind === 'royal' ? (s.heir ? P.royalHeir : P.royal) : _num(P[s.kind], P.noble);
    },

    /** Can the ward arrangement be made? → null or why not. */
    _wardWhy(player, world, child, s, ward) {
        if (ward === 'none' || !ward) return null;
        if (ward === 'oursThere') {
            const cfg = HeirAgency.config();
            const up = Upbringing.ensure(child);
            if (up.comeOfAge) return `${child.firstName} is of age.`;
            if (_num(child.age) < cfg.fosterMinAge) return `${child.firstName} is too young to leave home (from age ${cfg.fosterMinAge}).`;
            if (up.fostered) return `${child.firstName} has already been fostered.`;
            if (HeirAgency.isAway(child)) return `${child.firstName} is not at home.`;
            // (a lord of your own realm weighs his opinion of the crown, not the realm's standing)
            if (s.kind === 'vassal') return _num(s.regard) < -20 ? `${s.houseName} wants no child of yours under his roof.` : null;
            const rep = _num(player.reputation && player.reputation[s.kingdomId]);
            if (rep < cfg.fosterMinReputation) return `${s.kingdomName} will not take in the child of a House it distrusts.`;
            return null;
        }
        if (ward === 'theirsHere') {
            const W = Raising.config().wards;
            if (!player.house) return 'You have no House to raise their child.';
            if (_num(s.age) < W.minAge || _num(s.age) > W.maxAge + 2) return `${s.first} is not of an age to be sent (${W.minAge}–${W.maxAge + 2}).`;
            if (Raising.wards(player).length >= Raising.wardSeats(player)) return 'Your household has no room for another ward.';
            return null;
        }
        return 'No such arrangement.';
    },

    /**
     * What their side asks for these terms. terms = { line, ward, land }.
     * → { ok, reason, ask, landValue, coin, now, later, wardWhy, landName }.
     * ask > 0: your House pays; ask < 0: they pay you.
     */
    quote(player, world, childId, candId, terms = {}, opts = {}) {
        const C = Betrothals.config();
        const child = Betrothals._child(player, childId);
        const s = opts.suitor || Betrothals._suitor(player, world, childId, candId);
        if (!child || !s) return { ok: false, reason: 'That match cannot be made.' };
        const line = LINES.includes(terms.line) ? terms.line : 'theirs';
        const ward = WARDS.includes(terms.ward) ? terms.ward : 'none';
        const base = Betrothals._base(s);
        const mine = Math.max(20, House.getPrestige(player));
        const status = _clamp(Math.sqrt(Betrothals._weight(player, world, s) / mine), C.statusClamp[0], C.statusClamp[1]);
        const regard = _clamp(_num(s.regard) * C.regardPerPoint, C.regardClamp[0], C.regardClamp[1]);
        let ask = base * status * (1 - regard) + base * _num(C.line[line]) + base * _num(C.ward[ward]);
        ask = Math.round(Number.isFinite(opts.ask) ? opts.ask : ask);
        let landValue = 0;
        let landName = null;
        let reason = s.ok ? null : s.why;
        if (terms.land) {
            const e = Estates.estate(world, terms.land);
            if (!e || e.holder !== 'player') reason = reason || 'That estate is not yours.';
            else if (ask <= 0) reason = reason || 'They ask no dowry of you: keep your land.';
            else { landValue = Math.round(LandMarket.value(world, e)); landName = e.name; }
        }
        const coin = ask > 0 ? Math.max(0, ask - landValue) : ask;
        const now = Math.round(coin * C.nowShare);
        const later = coin - now;
        const wardWhy = Betrothals._wardWhy(player, world, child, s, ward);
        if (!reason && wardWhy) reason = wardWhy;
        if (!reason && Betrothals.of(child)) reason = `${child.firstName} is already promised.`;
        if (!reason && Upbringing.ensure(child).spouse) reason = `${child.firstName} is wed.`;
        if (!reason && now > 0 && _num(player.gold) < now) reason = `The first half of the dowry is ${Utils.formatGold(now)} gold.`;
        if (!reason && now < 0 && Betrothals._theirPurse(player, world, s) < -now) reason = `${s.houseName} has not the coin to pay a dowry now; ask for less.`;
        const promised = ((player.children) || []).filter(c => c && c.isAlive !== false && Betrothals.of(c)).length;
        if (!reason && promised >= C.maxBetrothed) reason = `Your House has ${promised} children promised already.`;
        return { ok: !reason, reason, ask, landValue, landName, coin, now, later, line, ward, wardWhy, suitor: s, status, base };
    },

    // ──────────── MONEY ────────────

    _theirPurse(player, world, s) {
        if (s.kind === 'rival') return Math.max(0, _num((Betrothals._rival(player, s.kingdomId) || {}).gold));
        const k = Betrothals._kingdom(world, s.kingdomId);
        return Math.max(0, Math.floor(_num(k && k.treasury)));
    },

    /** You pay their side `amount` (rival purse, crown treasury, a lord's realm's towns). */
    _payThem(player, world, b, amount) {
        if (!(amount > 0)) return 0;
        const paid = Math.min(amount, Math.max(0, Math.floor(_num(player.gold))));
        if (!(paid > 0)) return 0;
        player.gold = Utils.cents(_num(player.gold) - paid);
        Ledger.record(player, 'family', -paid);
        const k = Betrothals._kingdom(world, b.kingdomId);
        if (b.kind === 'rival') {
            const rv = Betrothals._rival(player, b.kingdomId);
            if (rv) rv.gold = Utils.cents(_num(rv.gold) + paid);
            else _toRealm(world, k, paid, 'betrothal');
        } else if (b.kind === 'vassal') {
            _toRealm(world, k, paid, 'betrothal');
        } else if (k) {
            k.treasury = _num(k.treasury) + paid;
        } else {
            MoneySupply.leak(world, -paid, 'betrothal');
        }
        return paid;
    },

    /** Their side pays you up to `amount`, as far as their purse goes. */
    _theyPay(player, world, b, amount) {
        if (!(amount > 0)) return 0;
        let paid = 0;
        if (b.kind === 'rival') {
            const rv = Betrothals._rival(player, b.kingdomId);
            paid = Math.min(amount, Math.max(0, Math.floor(_num(rv && rv.gold))));
            if (paid > 0) rv.gold = Utils.cents(_num(rv.gold) - paid);
        } else {
            const k = Betrothals._kingdom(world, b.kingdomId);
            paid = Math.min(amount, Math.max(0, Math.floor(_num(k && k.treasury))));
            if (paid > 0) k.treasury = _num(k.treasury) - paid;
        }
        if (paid > 0) {
            player.gold = Utils.cents(_num(player.gold) + paid);
            Ledger.record(player, 'family', paid);
        }
        return paid;
    },

    _favourAll(player, world, n) {
        if (!n || !Throne.ruledKingdom(player, world)) return;
        const court = Kingship.court(player);
        for (const v of ((court && court.vassals) || [])) if (v && !v.rebel) v.favour = _num(v.favour) + n;
    },

    _rivalMemory(rival, world, kind, w, note) {
        if (!rival || !w) return;
        if (!Array.isArray(rival.memory)) rival.memory = [];
        rival.memory.push({ kind, day: _day(world), w, note: note || null });
        const keep = _num(RivalHouses.config().memory && RivalHouses.config().memory.keep, 14);
        if (rival.memory.length > keep) rival.memory.splice(0, rival.memory.length - keep);
    },

    // ──────────── THE PROMISE ────────────

    /**
     * Promise a child on these terms. opts.ask: the price an offer named.
     * → { success, betrothal, text } or { success: false, reason }.
     */
    propose(player, world, childId, candId, terms = {}, opts = {}) {
        const C = Betrothals.config();
        const q = Betrothals.quote(player, world, childId, candId, terms, opts);
        if (!q.ok) return { success: false, reason: q.reason };
        const child = Betrothals._child(player, childId);
        const s = q.suitor;
        const a = HeirAgency.ensure(child);
        const day = _day(world);
        const k = Betrothals._kingdom(world, s.kingdomId);
        const b = {
            kind: s.kind, kingdomId: s.kingdomId, kingdomName: s.kingdomName, houseName: s.houseName, name: s.name,
            day, dowry: 0, due: 0, received: 0, owed: 0, warSince: null,
            terms: { line: q.line, ward: q.ward, land: q.landValue > 0 ? terms.land : null },
            landValue: q.landValue, landName: q.landName, heir: !!s.heir,
            their: { first: s.first, gender: s.gender, age: s.age, day },
            prestigeAt: House.getPrestige(player), ask: q.ask,
        };
        if (s.kind === 'rival') b.rivalChild = s.first;
        if (s.kind === 'royal') b.royalId = s.royalId;
        if (s.kind === 'vassal') b.vassalId = s.vassalId;
        // Half the coin now, the rest (and the land) at the wedding
        if (q.now > 0) b.dowry = Betrothals._payThem(player, world, b, q.now);
        else if (q.now < 0) b.received = Betrothals._theyPay(player, world, b, -q.now);
        if (q.later > 0) b.due = q.later;
        else if (q.later < 0) b.owed = -q.later;
        a.betrothal = b;
        const O = C.onBetroth;
        const houseName = (player.house && player.house.name) || 'your House';
        // The other side's promise
        if (s.kind === 'rival') {
            const rv = Betrothals._rival(player, s.kingdomId);
            const rc = Betrothals._rivalChild(rv, s.first);
            if (rc) rc.betrothed = { player: true, childId: child.id, name: child.firstName, day };
            House.accrueRivalFeud(player, world, s.kingdomId, O.rivalFeud);
            Betrothals._rivalMemory(rv, world, 'betrothed', O.rivalMemory, child.firstName);
            RivalHouses._note(rv, world, `Promised ${s.first} to your ${child.firstName}.`, 'wedding');
            rv.truceUntil = Math.max(_num(rv.truceUntil), day + C.bond.truceDays);
            if (k && k.lord && k.isAlive !== false) NPCLords.rememberDeed(world, k.lord, 'betrothal_made', { note: child.firstName });
        } else if (s.kind === 'royal') {
            const { royal } = Betrothals._royal(world, s.kingdomId, b.royalId);
            if (royal) royal.betrothedTo = { house: houseName, childId: child.id, name: child.firstName, day };
            HeirAgency._rep(player, s.kingdomId, O.reputation);
            if (k && k.lord) NPCLords.rememberDeed(world, k.lord, 'betrothal_made', { note: child.firstName });
            Betrothals._favourAll(player, world, O.royalFavourAll);
            HeirAgency._prestige(player, O.prestigeRoyal, `${child.firstName} promised to the blood of ${Names.realm(s.kingdomName)}`, world);
        } else if (s.kind === 'vassal') {
            const v = Betrothals._vassal(player, s.vassalId);
            if (v) { v.favour = _num(v.favour) + O.vassalFavour; v.betrothedTo = child.id; }
        } else {
            HeirAgency._rep(player, s.kingdomId, O.reputation);
            if (k && k.lord) NPCLords.rememberDeed(world, k.lord, 'betrothal_made', { note: child.firstName });
        }
        if (s.kind !== 'royal' && O.prestige) HeirAgency._prestige(player, O.prestige, `${child.firstName} promised`, world);
        // The ward arrangement
        let wardText = '';
        if (q.ward === 'oursThere') wardText = Betrothals._sendOurs(player, world, child, b);
        else if (q.ward === 'theirsHere') wardText = Betrothals._takeTheirs(player, world, child, b, s);
        const st = Betrothals.state(player);
        st.stats.made++;
        Betrothals._history(player, world, { kind: 'made', child: child.firstName, to: s.name, house: s.houseName });
        const money = b.dowry ? ` ${Utils.formatGold(b.dowry)}g of the dowry paid now${b.due ? `, ${Utils.formatGold(b.due)}g at the wedding` : ''}.`
            : b.received ? ` ${s.houseName} pays you ${Utils.formatGold(b.received)}g now${b.owed ? ` and ${Utils.formatGold(b.owed)}g at the wedding` : ''}.` : '';
        const land = b.terms.land ? ` ${b.landName} goes to them at the wedding.` : '';
        const text = `${child.firstName}, aged ${child.age}, is promised to ${s.name} of ${s.houseName}.${money}${land}${wardText}`;
        if (player.house) House._chronicle(player.house, world, `${child.firstName} is promised to ${s.name} of ${s.houseName}, binding ${houseName} to them.`, ['marriage', 'heirs']);
        return { success: true, child, betrothal: b, text, cost: b.dowry };
    },

    /** Your child goes to be raised at their court until the wedding. */
    _sendOurs(player, world, child, b) {
        const years = _clamp(Upbringing.config().comeOfAgeAge - _num(child.age), 1, 3);
        if (b.kind === 'vassal') return Betrothals._sendToVassal(player, world, child, b, years);
        const res = HeirAgency.fosterChild(player, world, child.id, b.kingdomId, years);
        if (!res.success) { b.terms.ward = 'none'; return ` (${child.firstName} could not go to them: ${res.reason})`; }
        if (b.kind === 'rival') {
            const rv = Betrothals._rival(player, b.kingdomId);
            const up = child.upbringing;
            if (rv && up.placement) up.placement.lordName = RivalHouses.headName(rv);
            if (rv && up.tutor && up.tutor.kind === 'host') up.tutor.name = `the hall of ${rv.name}`;
        }
        return ` ${child.firstName} goes to be raised at their court until day ${res.placement.until}.`;
    },

    /**
     * Your child raised in a vassal lord's hall (the fosterage of systems/heirAgency.js, at
     * home in your own realm): the lord's hall tutors them, his temper is seeded, and the lord,
     * holding your child, stands by the crown (favour each month: `_vassalWardMonth`).
     */
    _sendToVassal(player, world, child, b, years) {
        const v = Betrothals._vassal(player, b.vassalId);
        if (!v) { b.terms.ward = 'none'; return ''; }
        const cfg = HeirAgency.config();
        const up = Upbringing.ensure(child);
        const day = _day(world);
        const map = Heirs.config().wardLordTraits || {};
        const trait = (v.traits || []).map(t => map[t] || t).find(id => Traits.TRAITS[id]) || null;
        const lordName = Kingship.fullName(v);
        up.fostered = true;
        up.placement = {
            kind: 'ward', kingdomId: b.kingdomId, kingdomName: b.kingdomName, lordName, day,
            until: day + years * Betrothals._Y(), trait, returned: false, minor: true, years, vassalId: v.id,
        };
        up.tutor = {
            kind: 'host', id: 'host_court', name: `the hall of ${lordName}`, icon: '🏰', focus: HeirAgency.hostFocus(world, b.kingdomId),
            quality: cfg.fosterQuality, wage: 0, seeds: trait ? { [trait]: 0.6 } : {}, since: day,
        };
        if (player.house) House._chronicle(player.house, world, `${child.firstName}, aged ${child.age}, goes to be raised in the hall of ${lordName}, to whose house ${child.gender === 'female' ? 'she' : 'he'} is promised.`, ['heirs', 'upbringing']);
        return ` ${child.firstName} goes to be raised in his hall until day ${up.placement.until}.`;
    },

    /** A month of a child held by a vassal for the match (yours there, or theirs at your court): the lord stands by the crown. */
    _vassalWardMonth(player, world, child, b) {
        const v = Betrothals._vassal(player, b.vassalId);
        if (!v) return;
        const W = Betrothals.config().vassalWard;
        const up = child.upbringing;
        const yoursThere = up && up.placement && up.placement.vassalId === v.id && !up.placement.returned;
        const theirsHere = b.wardId && Raising.wards(player).some(w => w && w.id === b.wardId);
        if (!yoursThere && !theirsHere) return;
        if (_num(b.wardFavour) >= W.favourCap) return;
        v.favour = _num(v.favour) + W.favourPerMonth;
        b.wardFavour = _num(b.wardFavour) + W.favourPerMonth;
    },

    /** Their child comes to be raised at yours (a ward of systems/raising.js). */
    _takeTheirs(player, world, child, b, s) {
        const day = _day(world);
        const marry = s.kind === 'rival' ? _num(RivalHouses.config().life.comeOfAge, 16) : _num(Betrothals.config().marryAge[s.kind], 16);
        const until = day + Math.max(1, marry - _num(s.age)) * Betrothals._Y();
        const ward = {
            id: `ward_betrothed_${s.kingdomId}_${day}`, firstName: s.first, dynasty: '', gender: s.gender, age: _num(s.age),
            royalId: null, kingdomId: s.kingdomId, kingdomName: s.kind === 'rival' ? s.houseName : s.kingdomName,
            lordName: s.houseName, since: day, until, held: false, repGiven: 0, feesPaid: 0, fateRolls: 0,
        };
        if (s.kind === 'rival') {
            const rv = Betrothals._rival(player, s.kingdomId);
            const rc = Betrothals._rivalChild(rv, s.first);
            ward.rivalId = s.kingdomId;
            ward.rivalChild = s.first;
            ward.dynasty = RivalHouses.surname(rv);
            ward.lordName = RivalHouses.headName(rv);
            ward.feudGiven = 0;
            if (rc) { rc.wardAt = player.house.name || 'your court'; rc.wardOf = 'player'; rc.sentAway = true; }
        } else if (s.kind === 'vassal') {
            // (a lord's child of your own realm: no fee, no standing — the lord's favour: _vassalWardMonth)
            ward.vassalId = s.vassalId;
            ward.dynasty = (Betrothals._vassal(player, s.vassalId) || {}).dynasty || '';
        } else if (s.kind === 'royal') {
            const { royal } = Betrothals._royal(world, s.kingdomId, b.royalId);
            ward.royalId = b.royalId;
            ward.dynasty = (royal && royal.dynasty) || '';
            if (royal) royal.wardAt = player.house.name || 'a foreign House';
        }
        Raising.wards(player).push(ward);
        b.wardId = ward.id;
        return ` ${s.first} comes to be raised at your court until the wedding.`;
    },

    /** The other side's marker of the promise, cleared. */
    _clearTheirs(player, world, b) {
        if (b.kind === 'rival') {
            const rc = Betrothals._rivalChild(Betrothals._rival(player, b.kingdomId), b.rivalChild);
            if (rc) delete rc.betrothed;
        } else if (b.kind === 'royal') {
            const { royal } = Betrothals._royal(world, b.kingdomId, b.royalId);
            if (royal) delete royal.betrothedTo;
        } else if (b.kind === 'vassal') {
            const v = Betrothals._vassal(player, b.vassalId);
            if (v) delete v.betrothedTo;
        }
    },

    /** Their child, raised at your court for the match, goes home. */
    _wardHome(player, world, b, how) {
        if (!b.wardId || !player.house) return;
        const w = Raising.wards(player).find(x => x && x.id === b.wardId);
        if (w) Raising._wardGone(player, world, w, how, null);
    },

    /**
     * Break a child's promise (called by HeirAgency.breakBetrothal for these
     * kinds, and from the Matches panel). opts.byThem: their side broke it.
     * opts.rival: (heirAgency) the rival House that broke it.
     */
    breakOff(player, world, childId, why = null, opts = {}) {
        const C = Betrothals.config();
        const child = Betrothals._child(player, childId);
        const a = child && HeirAgency.ensure(child);
        const b = a && a.betrothal;
        if (!b) return { success: false, reason: 'No betrothal to break.' };
        a.betrothal = null;
        Betrothals._clearTheirs(player, world, b);
        Betrothals._wardHome(player, world, b, opts.byThem ? 'taken home' : 'sent home');
        const k = Betrothals._kingdom(world, b.kingdomId);
        const rv = b.kind === 'rival' ? Betrothals._rival(player, b.kingdomId) : null;
        let refund = 0;
        let prestige = 0;
        let returned = 0;
        const st = Betrothals.state(player);
        if (opts.ended) {
            st.stats.ended++;
        } else if (opts.byThem) {
            // They send back what you paid, as far as their purse allows; what they paid you, you keep
            refund = Betrothals._theyPay(player, world, b, _num(b.dowry));
            if (rv) {
                rv.brokeWord = _num(rv.brokeWord) + 1;
                rv.brokeBetrothal = { day: _day(world), child: child.firstName, childId: child.id, name: b.name, why: why || null };
                Betrothals._rivalMemory(rv, world, 'declined', -4, child.firstName);
            }
            st.stats.brokenByThem++;
        } else {
            const B = C.breakByYou;
            const free = B.flawFree && !!b.flaw;
            // What they paid you goes back
            if (_num(b.received) > 0) returned = Betrothals._payThem(player, world, b, _num(b.received));
            if (!free) {
                prestige = HeirAgency._prestige(player, -(b.kind === 'royal' ? B.prestigeRoyal : B.prestige), `${child.firstName}'s broken betrothal`, world);
                if (b.kind === 'rival') {
                    House.accrueRivalFeud(player, world, b.kingdomId, B.rivalFeud, `the betrothal you broke`);
                    Betrothals._rivalMemory(rv, world, 'betrothalBroken', B.rivalMemory, child.firstName);
                } else if (b.kind === 'vassal') {
                    const v = Betrothals._vassal(player, b.vassalId);
                    if (v) { v.favour = _num(v.favour) + B.vassalFavour; v.grudge = _num(v.grudge) + B.vassalGrudge; }
                } else {
                    HeirAgency._rep(player, b.kingdomId, B.reputation);
                    if (b.kind === 'royal') Betrothals._favourAll(player, world, B.royalFavourAll);
                }
                // The lord of that realm remembers the broken word (grounds for a suit: RivalHouses.lawGrounds)
                if (b.kind !== 'vassal' && k && k.lord && k.isAlive !== false) NPCLords.rememberDeed(world, k.lord, 'betrothal_broken', { note: child.firstName });
            }
            st.stats.brokenByYou++;
        }
        Betrothals._history(player, world, { kind: opts.ended ? 'ended' : opts.byThem ? 'brokenByThem' : 'brokenByYou', child: child.firstName, to: b.name, house: b.houseName, why: why || null });
        if (player.house && !opts.ended) House._chronicle(player.house, world, `${child.firstName}'s betrothal to ${b.name} is broken${opts.byThem ? ` by ${b.houseName}` : ''}${why ? ` (${why})` : ''}.`, ['marriage', 'heirs']);
        return { success: true, child, betrothal: b, refund, returned, prestige, byThem: !!opts.byThem, free: !opts.byThem && !!b.flaw };
    },

    /** What breaking it yourself would cost: { prestige, returned, text }. */
    breakCost(player, world, child) {
        const b = Betrothals.of(child);
        if (!b) return null;
        const B = Betrothals.config().breakByYou;
        if (B.flawFree && b.flaw) return { prestige: 0, returned: _num(b.received), text: `Their child is ${b.flaw === 'maimed' ? 'maimed' : 'held captive'}: no one will blame you.${b.received ? ` You return the ${Utils.formatGold(b.received)}g they paid.` : ''}` };
        const kind = b.kind || 'noble';
        const parts = [`−${kind === 'royal' ? B.prestigeRoyal : (kind === 'noble' ? _num((HeirAgency._raisingCfg().betrothal || {}).breakPrestige, 5) : B.prestige)} Prestige`];
        if (kind === 'rival') parts.push(`feud +${B.rivalFeud}`);
        else if (kind === 'vassal') parts.push('the lord\'s grudge');
        else parts.push(`${kind === 'noble' ? HeirAgency.config().betrothalBreakReputation : B.reputation} standing in ${b.kingdomName}`);
        if (b.dowry) parts.push(`the ${Utils.formatGold(b.dowry)}g you paid is lost`);
        if (b.received) parts.push(`the ${Utils.formatGold(b.received)}g they paid goes back`);
        return { prestige: kind === 'royal' ? B.prestigeRoyal : B.prestige, returned: _num(b.received), text: parts.join(', ') + '.' };
    },

    // ──────────── THE WEDDING ────────────

    _theirAge(player, world, b) {
        if (b.kind === 'rival') {
            const rc = Betrothals._rivalChild(Betrothals._rival(player, b.kingdomId), b.rivalChild);
            return rc ? _num(rc.age) : null;
        }
        if (b.kind === 'royal') {
            const { royal } = Betrothals._royal(world, b.kingdomId, b.royalId);
            return royal ? _num(royal.age) : null;
        }
        const t = b.their || {};
        return _num(t.age) + Math.floor(Math.max(0, _day(world) - _num(t.day, b.day)) / Betrothals._Y());
    },

    _marryAge(b) {
        if (b.kind === 'rival') return _num(RivalHouses.config().life.comeOfAge, 16);
        return _num(Betrothals.config().marryAge[b.kind || 'noble'], 16);
    },

    /** Kept: the match is made as the marriage code writes it. */
    _wed(player, world, child, b, out) {
        const C = Betrothals.config();
        const W = C.wed;
        const a = HeirAgency.ensure(child);
        const up = child.upbringing;
        const day = _day(world);
        const k = Betrothals._kingdom(world, b.kingdomId);
        a.betrothal = null;
        Betrothals._wardHome(player, world, b, 'wed');
        // The rest of the dowry: theirs to you, or yours to them; a short dowry is a slight
        let short = false;
        if (_num(b.due) > 0) {
            const paid = Betrothals._payThem(player, world, b, _num(b.due));
            if (paid < _num(b.due)) short = true;
        }
        if (_num(b.owed) > 0) Betrothals._theyPay(player, world, b, _num(b.owed));
        // The land
        let landText = '';
        if (b.terms && b.terms.land) {
            const e = Estates.estate(world, b.terms.land);
            if (e && e.holder === 'player') {
                const to = b.kind === 'rival' ? RivalHouses.holderId(Betrothals._rival(player, b.kingdomId) || { kingdomId: b.kingdomId })
                    : b.kind === 'royal' ? `crown:${b.kingdomId}` : `noble:${b.kingdomId}:${(Utils.hashStr(String(e.id)) >>> 0) % 4}`;
                if (b.kind === 'rival') RivalHouses._holder(world, Betrothals._rival(player, b.kingdomId) || { kingdomId: b.kingdomId, name: b.houseName });
                LandMarket._setHolder(world, e, to, day);
                Estates.record(world, { key: `es:dowry:${e.id}:${day}`, kind: 'dowry', day, place: e.town, kingdomId: b.kingdomId, estate: e.name, holder: player.name || 'you', buyer: Estates.holderName(world, to), own: true });
                landText = ` ${e.name} is settled on them.`;
            } else {
                short = true;
            }
        }
        if (short) {
            if (b.kind === 'rival') House.accrueRivalFeud(player, world, b.kingdomId, -W.shortReputation, 'a short dowry');
            else if (b.kind !== 'vassal') HeirAgency._rep(player, b.kingdomId, W.shortReputation);
            out.notices.push({ icon: '💰', title: 'A Short Dowry', text: `The House could not pay all it promised on ${child.firstName}'s dowry. ${b.houseName} notices.`, type: 'warning' });
        }
        const line = (b.terms && b.terms.line) || 'theirs';
        const base = { kingdomId: b.kingdomId, kingdomName: (k && k.name) || b.kingdomName, name: b.name, day, betrothed: b.day };
        let extra = '';
        if (b.kind === 'rival') {
            const rv = Betrothals._rival(player, b.kingdomId);
            const rc = Betrothals._rivalChild(rv, b.rivalChild);
            up.spouse = { kind: 'alliance', ...base, rivalHouse: b.houseName };
            if (rc) { rc.wed = child.firstName; delete rc.betrothed; }
            if (rv) {
                House.accrueRivalFeud(player, world, b.kingdomId, W.rivalFeud);
                rv.keptWord = _num(rv.keptWord) + 1;
                Betrothals._rivalMemory(rv, world, 'match', W.rivalMemory, child.firstName);
                RivalHouses._note(rv, world, `${b.rivalChild} weds your ${child.firstName}, as was promised.`, 'wedding');
            }
        } else if (b.kind === 'royal') {
            const { royal, ruler } = Betrothals._royal(world, b.kingdomId, b.royalId);
            up.spouse = { kind: 'royal', ...base, royalId: b.royalId };
            if (royal) { royal.spouseId = child.id; delete royal.betrothedTo; }
            const amount = Math.round((ruler ? W.claimRuler : b.heir ? W.claimHeir : W.claim) * (line === 'theirs' ? W.claimTheirs : 1));
            const claim = Throne.grantClaim(player, world, b.kingdomId, 'marriage', amount);
            if (claim) extra = ` The House holds a claim on the throne of ${Names.realm(base.kingdomName)} (${claim}).`;
            HeirAgency._rep(player, b.kingdomId, W.reputation);
            if (ruler) extra += ` ${b.name} wears the crown now: ${child.firstName} weds a reigning monarch.`;
        } else if (b.kind === 'vassal') {
            const v = Betrothals._vassal(player, b.vassalId);
            up.spouse = { kind: 'vassal', ...base };
            if (v) { v.kin = true; v.favour = _num(v.favour) + W.vassalFavour; delete v.betrothedTo; }
        } else {
            up.spouse = { kind: 'alliance', ...base };
            HeirAgency._rep(player, b.kingdomId, W.reputation);
        }
        // Whose House the children of the match belong to (read by _issueYear, Betrothals.heirIssue, DynastyTree)
        up.spouse.line = line;
        up.spouse.match = b.kind;
        up.spouse.house = b.houseName;
        up.spouse.their = { first: (b.their && b.their.first) || String(b.name).split(' ')[0], age: Betrothals._theirAge(player, world, b) };
        if (b.rivalChild) up.spouse.rivalChild = b.rivalChild;
        up.spouse.issue = [];
        if (up.tutor && up.tutor.kind === 'host') up.tutor = null;
        up.placement = { kind: up.spouse.kind, kingdomId: b.kingdomId, kingdomName: base.kingdomName, day };
        HeirAgency._prestige(player, W.prestige + (line === 'ours' ? W.prestigeOurs : 0), `${child.firstName} weds ${b.name}`, world);
        Heirs._recordMatch(player, world, child, up.spouse);
        if (k && k.lord && b.kind !== 'vassal') NPCLords.rememberDeed(world, k.lord, 'child_wed', { note: child.firstName });
        const st = Betrothals.state(player);
        st.stats.kept++;
        Betrothals._history(player, world, { kind: 'kept', child: child.firstName, to: b.name, house: b.houseName });
        const where = line === 'ours' ? `${b.name} takes the name of ${(player.house && player.house.name) || 'your House'}` : `${child.firstName} goes to ${b.houseName}`;
        if (player.house) House._chronicle(player.house, world, `Come of age, ${child.firstName} weds ${b.name} of ${b.houseName}, as was promised; ${where}.`, ['marriage', 'heirs']);
        HeirAgency.letter(player, world, child, `${child.firstName} is wed`, `The promise is kept: I am wed to ${b.name}. ${b.houseName} counts our House as kin now.`, b.kind === 'vassal' ? null : b.kingdomId);
        out.notices.push({ icon: '💍', title: 'A Promise Kept', text: `${child.firstName} weds ${b.name} of ${b.houseName}, as was promised; ${where}.${landText}${extra}`, type: 'success' });
    },

    // ──────────── THE DAY ────────────

    /**
     * One day of the House's promises: the bond kept, the other side's
     * fortunes, their breaking it, the wedding; the rival Houses' own
     * promises; offers. Draws no RNG. → { notices }
     */
    processDay(player, world) {
        const out = { notices: [] };
        if (!player || !world) return out;
        const C = Betrothals.config();
        const day = _day(world);
        for (const child of (player.children || [])) {
            const b = Betrothals.of(child);
            if (!b) continue;
            if (child.isAlive === false) {
                Betrothals.breakOff(player, world, child.id, `${child.firstName} died`, { ended: true });
                continue;
            }
            if (!b.kind || b.kind === 'noble') {
                // (the old kind's war, wedding and breaking stay heirAgency's: only the bond runs here)
                if (C.bond.everyDays > 0 && day % C.bond.everyDays === 0) Betrothals._bondWeek(player, world, b);
                continue;
            }
            const up = Upbringing.ensure(child);
            if (up.spouse) continue; // (heirAgency breaks it: 'wed elsewhere')
            // The other side: gone, dead, maimed, captive
            const gone = Betrothals._gone(player, world, b);
            if (gone) {
                Betrothals.breakOff(player, world, child.id, gone, { ended: true });
                out.notices.push({ icon: '🕯️', title: 'A Promise Ended', text: `${child.firstName}'s betrothal to ${b.name} is ended: ${gone}.`, type: 'info' });
                continue;
            }
            Betrothals._flawCheck(player, world, child, b, out);
            if (C.bond.everyDays > 0 && day % C.bond.everyDays === 0) Betrothals._bondWeek(player, world, b);
            if (C.ai.checkDays > 0 && day % C.ai.checkDays === 0 && !player.interregnum && Betrothals._theyBreak(player, world, child, b, out)) continue;
            // The wedding
            if (up.comeOfAge) {
                const age = Betrothals._theirAge(player, world, b);
                if (age != null && age >= Betrothals._marryAge(b)) Betrothals._wed(player, world, child, b, out);
            }
        }
        const Y = Betrothals._Y();
        if (day > 0 && day % Y === 0) {
            Betrothals._housesYear(player, world, out);
            for (const child of (player.children || [])) Betrothals._issueYear(player, world, child, out);
        }
        // A child held by a vassal for a match: the lord's favour, monthly
        if (day % 30 === 0) {
            for (const child of (player.children || [])) {
                const b = Betrothals.of(child);
                if (b && b.kind === 'vassal' && child.isAlive !== false) Betrothals._vassalWardMonth(player, world, child, b);
            }
        }
        Betrothals._offersDay(player, world, out);
        return out;
    },

    /** Why the other side can no longer wed, or null. */
    _gone(player, world, b) {
        const k = Betrothals._kingdom(world, b.kingdomId);
        if (b.kind === 'rival') {
            const rv = Betrothals._rival(player, b.kingdomId);
            if (!rv) return `${b.houseName} is no more`;
            if (!Betrothals._rivalChild(rv, b.rivalChild)) {
                if (rv.head.firstName === b.rivalChild) return `${b.name} now heads ${b.houseName} and looks higher for a match`;
                return `${b.name} is dead`;
            }
            return null;
        }
        if (!k || k.isAlive === false) return `${b.kingdomName} has fallen`;
        if (b.kind === 'royal') {
            const { royal } = Betrothals._royal(world, b.kingdomId, b.royalId);
            if (!royal || royal.isAlive === false) return `${b.name} is dead`;
            if (royal.spouseId && royal.spouseId !== 'player') return `${b.name} has wed another`;
            return null;
        }
        if (b.kind === 'vassal') {
            const v = Betrothals._vassal(player, b.vassalId);
            if (!v) return 'that lord no longer holds of your crown';
            return null;
        }
        return null;
    },

    /** Their child maimed or taken captive: you may break it freely. */
    _flawCheck(player, world, child, b, out) {
        if (b.flaw) return;
        let p = null;
        if (b.kind === 'rival') p = Betrothals._rivalChild(Betrothals._rival(player, b.kingdomId), b.rivalChild);
        else if (b.kind === 'royal') p = Betrothals._royal(world, b.kingdomId, b.royalId).royal;
        if (!p) return;
        const flaw = p.captiveOf ? 'captive' : MaimMarks.any(p) ? 'maimed' : null;
        if (!flaw) return;
        b.flaw = flaw;
        const how = flaw === 'maimed' ? `${b.name} has been maimed` : `${b.name} is held captive`;
        out.notices.push({ icon: '💔', title: 'A Promise in Doubt', text: `${how}. You may break ${child.firstName}'s betrothal without shame, or keep faith (Dynasty → Matches & Betrothals).`, type: 'warning' });
    },

    /** The bond, weekly: truces and warmth while the promise stands. */
    _bondWeek(player, world, b) {
        const B = Betrothals.config().bond;
        const day = _day(world);
        if (b.kind === 'rival') {
            const rv = Betrothals._rival(player, b.kingdomId);
            if (!rv) return;
            rv.truceUntil = Math.max(_num(rv.truceUntil), day + B.truceDays);
            if (_num(rv.feud) > B.rivalFeudFloor) House.accrueRivalFeud(player, world, b.kingdomId, Math.max(B.rivalFeudWeekly, B.rivalFeudFloor - _num(rv.feud)));
            return;
        }
        if (b.kind === 'vassal') return;
        // A realm you rule and the betrothed's realm keep the peace (KingdomAI.hasTruce) and warm to each other
        const mine = Throne.ruledKingdom(player, world);
        const k = Betrothals._kingdom(world, b.kingdomId);
        if (!mine || !k || mine === k || k.isAlive === false) return;
        if ((mine.wars || []).includes(k.id) || (k.wars || []).includes(mine.id)) return;
        if (!mine.truces) mine.truces = {};
        if (!k.truces) k.truces = {};
        mine.truces[k.id] = Math.max(_num(mine.truces[k.id]), day + B.truceDays);
        k.truces[mine.id] = Math.max(_num(k.truces[mine.id]), day + B.truceDays);
        for (const [x, y] of [[mine, k], [k, mine]]) {
            if (!x.relations) x.relations = {};
            const r = _num(x.relations[y.id]);
            if (r < B.realmRelationsCap) x.relations[y.id] = Math.min(B.realmRelationsCap, r + B.realmRelations);
        }
    },

    /** Their side breaks it when it suits them. → true when broken. */
    _theyBreak(player, world, child, b, out) {
        const A = Betrothals.config().ai;
        const day = _day(world);
        const roll = (k) => Betrothals._roll(world, `${child.id}:${k}:${day}`);
        let why = null;
        if (MaimMarks.barsRule(child) || MaimMarks.gelded(child) || MaimMarks.blind(child)) {
            if (roll('maimed') < A.maimedChance) why = `they will not wed their child to one ${MaimMarks.blind(child) ? 'blinded' : MaimMarks.gelded(child) ? 'gelded' : 'so maimed'}`;
        }
        if (!why && _num(b.prestigeAt) > 0 && House.getPrestige(player) < _num(b.prestigeAt) * A.fallShare && roll('fall') < A.fallChance) {
            why = 'a better match, now your House has fallen from its height';
        }
        if (!why && b.kind === 'rival') {
            const rv = Betrothals._rival(player, b.kingdomId);
            const honour = _num(rv && rv.head && rv.head.persona && rv.head.persona.honour, 5);
            if (rv && honour <= 3 && _num(rv.feud) >= A.lowHonourFeud && roll('honour') < A.lowHonourChance) why = `${RivalHouses.headName(rv)} has found a match more to ${_his(rv.head)} liking`;
        }
        if (!why) return false;
        const res = Betrothals.breakOff(player, world, child.id, why, { byThem: true });
        out.notices.push({ icon: '💔', title: 'A Betrothal Broken', text: `${b.houseName} breaks ${child.firstName}'s betrothal to ${b.name}: ${why}.${res.refund ? ` They send back ${Utils.formatGold(res.refund)}g of the dowry.` : ''}${b.kind === 'rival' ? ' You may take them to law for it (Courts & Lawsuits).' : ''}`, type: 'warning' });
        Interrupts.raise(world, { reason: `${b.houseName} breaks ${child.firstName}'s betrothal`, icon: '💔', source: 'betrothals' });
        return true;
    },

    // ──────────── THE CHILDREN OF THE MATCH ────────────

    /** The children born of a promised match: [{ id, first, gender, born, alive, age }]. */
    issue(child, world) {
        const sp = child && child.upbringing && child.upbringing.spouse;
        if (!sp || !Array.isArray(sp.issue)) return [];
        const Y = Betrothals._Y();
        return sp.issue.map(i => ({ ...i, age: Math.floor(Math.max(0, _day(world) - _num(i.born)) / Y) }));
    },

    /**
     * A year of a match the House made: a child may be born. line 'ours': of your House
     * (they come to the seat with their parent: heirIssue; in the family tree); line
     * 'theirs': of the other House — a royal grandchild is of that realm's blood (a claim
     * by blood while one lives, more when one is its heir or crowned), a rival's eases the
     * feud and, once their parent heads that House, is among its heirs.
     */
    _issueYear(player, world, child, out) {
        const I = Betrothals.config().issue;
        const sp = child && child.upbringing && child.upbringing.spouse;
        if (!sp || !Array.isArray(sp.issue) || child.isAlive === false) return;
        const day = _day(world);
        const Y = Betrothals._Y();
        const theirAge = _num(sp.their && sp.their.age, _num(child.age)) + Math.floor(Math.max(0, day - _num(sp.day)) / Y);
        const motherAge = child.gender === 'female' ? _num(child.age) : theirAge;
        const living = sp.issue.filter(i => i.alive !== false);
        if (living.length < I.max && motherAge >= I.motherFrom && motherAge <= I.motherTo && Betrothals._roll(world, `issue:${child.id}:${day}`) < I.chance) {
            const gender = Betrothals._roll(world, `issueSex:${child.id}:${day}`) < 0.5 ? 'male' : 'female';
            const k = Betrothals._kingdom(world, sp.kingdomId);
            const culture = sp.line === 'ours' ? (child.culture || 'Imperial') : ((k && k.culture) || child.culture || 'Imperial');
            const first = Betrothals._invented(world, gender, culture, `issue:${child.id}:${sp.issue.length}:${gender}`);
            sp.issue.push({ id: `is_${child.id}_${sp.issue.length}`, first, gender, born: day, alive: true });
            const houseName = (player.house && player.house.name) || 'your House';
            const of = sp.line === 'ours' ? houseName : (sp.house || sp.kingdomName);
            if (sp.line !== 'ours' && sp.match === 'rival') House.accrueRivalFeud(player, world, sp.kingdomId, I.rivalFeud);
            const what = gender === 'female' ? 'daughter' : 'son';
            if (player.house) House._chronicle(player.house, world, `A ${what}, ${first}, is born to ${child.firstName} and ${sp.name}: a child of ${of}.`, ['heirs', 'birth']);
            out.notices.push({ icon: '👶', title: 'A Grandchild', text: `${child.firstName} and ${sp.name} have a ${what}, ${first}, of ${of}${sp.line !== 'ours' && sp.match === 'royal' ? ': your blood in a royal line' : ''}.`, type: 'success' });
        }
        if (sp.line !== 'ours') Betrothals._bloodSync(player, world, sp);
    },

    /** Your blood in the other House's line: the royal claim by blood; a rival's heirs. */
    _bloodSync(player, world, sp) {
        const I = Betrothals.config().issue;
        const living = (sp.issue || []).filter(i => i.alive !== false);
        if (!living.length) return;
        const houseName = (player.house && player.house.name) || 'your House';
        const Y = Betrothals._Y();
        const day = _day(world);
        const ageOf = (i) => Math.floor(Math.max(0, day - _num(i.born)) / Y);
        if (sp.match === 'royal') {
            const { k, royal, ruler } = Betrothals._royal(world, sp.kingdomId, sp.royalId);
            if (!k || !k.isAlive) return;
            const d = k.characterData;
            // Once their parent wears the crown, the grandchildren are the crown's children: its line of succession
            if (royal && ruler && d) {
                if (!Array.isArray(d.children)) d.children = [];
                for (const i of living) {
                    if (d.children.some(c => c && c.id === i.id)) continue;
                    d.children.push({ id: i.id, firstName: i.first, dynasty: royal.dynasty || '', gender: i.gender, age: ageOf(i), isAlive: true, kingdomId: k.id, maxLifespan: 70, traits: [], childrenIds: [], siblingIds: [], bloodOf: houseName });
                }
            }
            const kids = (d && Array.isArray(d.children) ? d.children : []).filter(c => c && c.isAlive !== false);
            const eldest = kids.slice().sort((a, b) => _num(b.age) - _num(a.age))[0];
            const crowned = !!(d && d.ruler && d.ruler.bloodOf === houseName && d.ruler.isAlive !== false);
            const heir = !!(eldest && eldest.bloodOf === houseName);
            Throne.grantClaim(player, world, k.id, 'blood', crowned ? I.bloodClaimRuler : heir ? I.bloodClaimHeir : I.bloodClaim);
        } else if (sp.match === 'rival') {
            const rv = Betrothals._rival(player, sp.kingdomId);
            // Their parent heads that House now: the grandchildren are its children, and its heirs
            if (rv && rv.head && rv.head.firstName === sp.rivalChild) {
                if (!Array.isArray(rv.head.children)) rv.head.children = [];
                for (const i of living) {
                    if (rv.head.children.some(c => c && c.firstName === i.first)) continue;
                    rv.head.children.push({ firstName: i.first, gender: i.gender, age: ageOf(i), bloodOf: houseName });
                }
            }
        }
    },

    /**
     * A married child inherits (Relationships._heirsOwnChildren): the children of a match
     * the House made come to the seat when the line is yours; when it is theirs they stay
     * with the other House. `make()` makes one child of the House (Relationships.generateChild).
     */
    heirIssue(player, child, sp, world, make) {
        const Y = Betrothals._Y();
        const day = _day(world);
        const living = (sp.issue || []).filter(i => i.alive !== false);
        if (sp.line !== 'ours') {
            if (living.length && player.house) House._chronicle(player.house, world, `${player.firstName}'s children by ${sp.name} (${living.map(i => i.first).join(', ')}) are of ${sp.house || sp.kingdomName}, and stay with them.`, ['heirs']);
            return [];
        }
        const born = [];
        for (const i of living) {
            const kid = make();
            if (!kid) continue;
            kid.firstName = i.first;
            kid.gender = i.gender;
            kid.age = Math.floor(Math.max(0, day - _num(i.born)) / Y);
            kid.birthDay = _num(i.born);
            if (kid.upbringing && kid.age >= _num(Upbringing.config().comeOfAgeAge, 16)) kid.upbringing.comeOfAge = true;
            born.push(kid);
        }
        if (born.length && player.house) House._chronicle(player.house, world, `${player.firstName} comes to the seat with ${born.length === 1 ? 'a child' : `${born.length} children`} of the House by ${sp.name}: ${born.map(k => k.firstName).join(', ')}.`, ['heirs', 'birth']);
        return born;
    },

    // ──────────── THE RIVAL HOUSES AMONG THEMSELVES ────────────

    /** The year among the rival Houses: promises made, broken and kept. Hash rolls only. */
    _housesYear(player, world, out) {
        const H = Betrothals.config().houses;
        const live = RivalHouses.rivals(player).filter(r => r && r.head);
        if (live.length < 2) return;
        const L = RivalHouses.config().life;
        const day = _day(world);
        const find = (rv, name) => (rv.head.children || []).find(c => c && c.firstName === name) || null;
        // Kept or broken
        for (const a of live) {
            for (const c of a.head.children || []) {
                const p = c && c.betrothed;
                if (!p || p.player) continue;
                const b = live.find(r => String(r.kingdomId) === String(p.kingdomId));
                const other = b ? find(b, p.name) : null;
                if (!b || !other || c.isAlive === false || c.wed || other.wed) { delete c.betrothed; continue; }
                if (RivalHouses.tie(a, b) <= H.breakTie) {
                    delete c.betrothed;
                    delete other.betrothed;
                    RivalHouses.bond(a, b, H.breakBond);
                    const text = `${a.name} and ${b.name} fall out: the promise between ${c.firstName} and ${other.firstName} is broken.`;
                    RivalHouses._note(a, world, text);
                    RivalHouses._note(b, world, text);
                    continue;
                }
                if (_num(c.age) >= L.marryFrom && _num(other.age) >= L.marryFrom && String(a.kingdomId) < String(b.kingdomId)) {
                    c.wed = 'another House'; c.wedHouse = b.name; delete c.betrothed;
                    other.wed = 'another House'; other.wedHouse = a.name; delete other.betrothed;
                    RivalHouses.bond(a, b, H.wedBond);
                    const text = `${c.firstName} ${RivalHouses.surname(a)} weds ${other.firstName} ${RivalHouses.surname(b)}, as their Houses promised.`;
                    RivalHouses._note(a, world, text, 'wedding');
                    RivalHouses._note(b, world, text, 'wedding');
                    if (player.house) House._chronicle(player.house, world, text, ['rival', 'marriage']);
                    out.notices.push({ icon: '💍', title: 'Rival Houses Wed', text: `${text} ${a.name} and ${b.name} are bound by blood now.`, type: 'info' });
                }
            }
        }
        // New promises among the young
        const young = (r) => (r.head.children || []).filter(c => c && c.isAlive !== false && !c.wed && !c.betrothed && !c.captiveOf && _num(c.age) < L.marryFrom);
        for (let i = 0; i < live.length; i++) {
            for (let j = i + 1; j < live.length; j++) {
                const a = live[i];
                const b = live[j];
                if (RivalHouses.tie(a, b) < H.tieMin) continue;
                if (Betrothals._roll(world, `houses:${a.kingdomId}:${b.kingdomId}:${day}`) >= H.chance) continue;
                const ca = young(a)[0];
                const cb = ca && young(b).find(c => c.gender !== ca.gender && Math.abs(_num(c.age) - _num(ca.age)) <= 6);
                if (!ca || !cb) continue;
                ca.betrothed = { kingdomId: b.kingdomId, house: b.name, name: cb.firstName, day };
                cb.betrothed = { kingdomId: a.kingdomId, house: a.name, name: ca.firstName, day };
                RivalHouses.bond(a, b, H.bond);
                const text = `${a.name} and ${b.name} promise their children: ${ca.firstName} to ${cb.firstName}.`;
                RivalHouses._note(a, world, text);
                RivalHouses._note(b, world, text);
                if (player.house) House._chronicle(player.house, world, text, ['rival', 'marriage']);
                out.notices.push({ icon: '💍', title: 'Rival Houses Betroth', text: `${text} The two Houses draw together.`, type: 'info' });
            }
        }
    },

    // ──────────── OFFERS ────────────

    /** Now and then a House or crown on good terms proposes a match for one of your children. */
    _offersDay(player, world, out) {
        const O = Betrothals.config().offers;
        const st = Betrothals.state(player);
        const day = _day(world);
        st.offers = st.offers.filter(o => o && day <= _num(o.expires) && Betrothals._child(player, o.childId) && !Betrothals.of(Betrothals._child(player, o.childId)));
        if (player.interregnum || !(O.checkDays > 0) || day % O.checkDays !== 0 || st.offers.length) return;
        if (day - st.lastOfferDay < O.cooldownDays) return;
        if (Betrothals._roll(world, `offer:${day}`) >= O.chance) return;
        let best = null;
        for (const child of Betrothals.eligibleChildren(player)) {
            for (const s of Betrothals.suitors(player, world, child.id)) {
                if (!s.ok || s.kind === 'noble') continue;
                if (s.kind === 'rival') {
                    const rv = Betrothals._rival(player, s.kingdomId);
                    if (!rv || _num(rv.feud) > O.rivalMaxFeud) continue;
                } else if (s.kind === 'royal' && _num(s.regard) < O.minRealmReputation) continue;
                else if (s.kind === 'vassal' && _num(s.regard) < 20) continue;
                const score = Betrothals._weight(player, world, s) + _num(s.regard) + Betrothals._roll(world, `offerPick:${day}:${child.id}:${s.id}`) * 30;
                if (!best || score > best.score) best = { child, s, score };
            }
        }
        if (!best) return;
        const { child, s } = best;
        const terms = { line: 'theirs', ward: 'none', land: null };
        const q = Betrothals.quote(player, world, child.id, s.id, terms, { suitor: s });
        const ask = Math.round(q.ask > 0 ? q.ask * O.discount : q.ask / O.discount);
        const offer = { id: `offer_${day}_${child.id}`, childId: child.id, candId: s.id, kind: s.kind, name: s.name, house: s.houseName, heir: !!s.heir, terms, ask, day, expires: day + O.offerDays };
        st.offers.push(offer);
        st.lastOfferDay = day;
        st.stats.offered++;
        const price = ask > 0 ? `they ask a dowry of ${Utils.formatGold(ask)}g` : ask < 0 ? `they offer a dowry of ${Utils.formatGold(-ask)}g` : 'no dowry asked';
        out.notices.push({ icon: '💌', title: 'A Match Offered', text: `${s.houseName} proposes ${s.name}${s.heir ? ', the heir,' : ''} for your ${child.firstName} (${price}). Answer by day ${offer.expires} (Dynasty → Matches & Betrothals).`, type: 'info' });
    },

    acceptOffer(player, world, offerId) {
        const st = Betrothals.state(player);
        const o = st.offers.find(x => x && x.id === offerId);
        if (!o) return { success: false, reason: 'That offer no longer stands.' };
        const res = Betrothals.propose(player, world, o.childId, o.candId, o.terms, { ask: o.ask });
        if (res.success) st.offers = st.offers.filter(x => x !== o);
        return res;
    },

    declineOffer(player, world, offerId) {
        const st = Betrothals.state(player);
        const o = st.offers.find(x => x && x.id === offerId);
        if (!o) return { success: false, reason: 'That offer no longer stands.' };
        st.offers = st.offers.filter(x => x !== o);
        const kid = o.candId.split(':')[1];
        if (o.kind === 'rival') Betrothals._rivalMemory(Betrothals._rival(player, kid), world, 'declined', _num(RivalHouses.config().memory.kinds.declined, -3), null);
        else if (o.kind === 'royal') HeirAgency._rep(player, kid, -2);
        return { success: true, text: `You decline ${o.house}'s offer of ${o.name}.` };
    },
};

// ============================================
// CROWN MATCHES — the realms promise their royal children to each other
// ============================================
// World-level, with or without a player (it runs in the interregnum too).
// Yearly, two realms at peace and on good terms (allied, or relations at
// crowns.tieMin) may promise an unwed prince to an unwed princess
// (royal.betrothedTo = { kingdomId, royalId, name, day }); weekly the
// promise keeps a truce between them (kingdom.truces, read by
// KingdomAI.hasTruce) and warms their relations; a war breaks it; when both
// are 16 they wed (spouseId each to each) and the realms stand allied
// (kingdom.allies, read by KingdomAI.considerWar). A royal promised so is no
// suitor for the player's children (Betrothals.suitors) nor a royal match
// (Throne.royalMatchCandidates). Hash rolls only.
// (There is no personal union between AI realms in the code — systems/highCrowns.js
// is the player's alone — so a royal wedding binds two crowns by alliance, not union.)

function _royals(k) {
    return ((k && k.characterData && k.characterData.children) || []).filter(c => c && c.isAlive !== false);
}

function _royalById(k, id) {
    const d = k && k.characterData;
    if (!d) return null;
    return (d.children || []).find(c => c && c.id === id) || (d.ruler && d.ruler.id === id ? d.ruler : null);
}

export const CrownMatches = {
    /** One day of the crowns' promises. → { events } */
    processDay(world) {
        const out = { events: [] };
        if (!world || !Array.isArray(world.kingdoms)) return out;
        const C = Betrothals.config().crowns;
        const day = _day(world);
        const live = world.kingdoms.filter(k => k && k.isAlive);
        if (day % 7 === 0) CrownMatches._week(world, live, C, out);
        if (day > 0 && day % Betrothals._Y() === 0) CrownMatches._year(world, live, C, out);
        if (out.events.length && Array.isArray(world.events)) world.events.push(...out.events);
        return out;
    },

    _atWar(a, b) {
        return (a.wars || []).includes(b.id) || (b.wars || []).includes(a.id);
    },

    /** The promises standing between realms: [{ a, b, ca, cb }] (each pair once). */
    pairs(world) {
        const live = ((world && world.kingdoms) || []).filter(k => k && k.isAlive);
        const out = [];
        for (const a of live) {
            for (const ca of _royals(a)) {
                const t = ca.betrothedTo;
                if (!t || t.kingdomId == null || String(a.id) > String(t.kingdomId)) continue;
                const b = live.find(k => String(k.id) === String(t.kingdomId));
                const cb = b ? _royalById(b, t.royalId) : null;
                out.push({ a, b, ca, cb });
            }
        }
        return out;
    },

    _week(world, live, C, out) {
        const day = _day(world);
        for (const { a, b, ca, cb } of CrownMatches.pairs(world)) {
            if (!b || !cb || cb.isAlive === false) { delete ca.betrothedTo; if (cb) delete cb.betrothedTo; continue; }
            if (CrownMatches._atWar(a, b)) {
                delete ca.betrothedTo;
                delete cb.betrothedTo;
                for (const [x, y] of [[a, b], [b, a]]) { if (!x.relations) x.relations = {}; x.relations[y.id] = _clamp(_num(x.relations[y.id]) + C.breakRelations, -100, 100); }
                out.events.push({ text: `💔 War breaks the promise between ${ca.firstName} of ${a.name} and ${cb.firstName} of ${b.name}.`, type: 'diplomatic' });
                continue;
            }
            for (const [x, y] of [[a, b], [b, a]]) {
                if (!x.truces) x.truces = {};
                x.truces[y.id] = Math.max(_num(x.truces[y.id]), day + C.truceDays);
                if (!x.relations) x.relations = {};
                const r = _num(x.relations[y.id]);
                if (r < C.relationsCap) x.relations[y.id] = Math.min(C.relationsCap, r + C.relations);
            }
        }
    },

    _year(world, live, C, out) {
        const day = _day(world);
        // Weddings
        for (const { a, b, ca, cb } of CrownMatches.pairs(world)) {
            if (!b || !cb || _num(ca.age) < 16 || _num(cb.age) < 16) continue;
            delete ca.betrothedTo;
            delete cb.betrothedTo;
            ca.spouseId = cb.id;
            cb.spouseId = ca.id;
            ca.wedTo = b.id;
            cb.wedTo = a.id;
            for (const [x, y] of [[a, b], [b, a]]) {
                if (!Array.isArray(x.allies)) x.allies = [];
                if (!x.allies.includes(y.id)) x.allies.push(y.id);
                if (!x.relations) x.relations = {};
                x.relations[y.id] = Math.max(_num(x.relations[y.id]), C.wedRelations);
            }
            out.events.push({ text: `💍 ${ca.firstName} of ${a.name} weds ${cb.firstName} of ${b.name}: the two crowns stand allied.`, type: 'diplomatic' });
        }
        // New promises
        const free = (k) => _royals(k).filter(c => !c.spouseId && !c.betrothedTo && !c.wardAt && _num(c.age) <= C.maxAge);
        for (let i = 0; i < live.length; i++) {
            for (let j = i + 1; j < live.length; j++) {
                const a = live[i];
                const b = live[j];
                if (CrownMatches._atWar(a, b) || (a.crown && (a.crown.playerRuled || a.crown.union)) || (b.crown && (b.crown.playerRuled || b.crown.union))) continue;
                const allied = (a.allies || []).includes(b.id);
                if (!allied && Math.min(_num(a.relations && a.relations[b.id]), _num(b.relations && b.relations[a.id])) < C.tieMin) continue;
                if (Betrothals._roll(world, `crowns:${a.id}:${b.id}:${day}`) >= C.chance) continue;
                const ca = free(a)[0];
                const cb = ca && free(b).find(c => c.gender && c.gender !== ca.gender && Math.abs(_num(c.age) - _num(ca.age)) <= C.ageGap);
                if (!ca || !cb) continue;
                ca.betrothedTo = { kingdomId: b.id, royalId: cb.id, name: cb.firstName, day };
                cb.betrothedTo = { kingdomId: a.id, royalId: ca.id, name: ca.firstName, day };
                out.events.push({ text: `💍 ${a.name} and ${b.name} promise their children: ${ca.firstName} to ${cb.firstName}.`, type: 'diplomatic' });
            }
        }
    },
};
