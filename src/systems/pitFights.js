// ============================================
// PIT FIGHTS — bouts, bear-baiting and cockfights in the town pits
// ============================================
// Some towns keep a fighting pit (settlement.pit, saved with the tile): a
// fenced ring by the tavern on the street map while the law lets it fight in
// the open (world/pitRing.js lays it), a cellar behind some honest front when
// the law bans it. On fight nights — the town's market night, the feasts and
// the fairs (PitRing.nightOf) — it fights a card of bouts, whether the player
// is there or not:
//
//   MEN     real townsfolk, the pit's fighters (pit.fighters: their records,
//           wins, losses, kills, training, an owner), matched by strength —
//           to first blood, to submission, or to the death. Each bout is
//           fought by the duel engine (Duels.autoResolve) between combatants
//           built from the person (Brawls.fighter → Duels.fromNpc: their trade,
//           traits and practised skills) plus their training and seasoning,
//           less their age and the hurt they still carry (Townsfolk.injury).
//           The loser is hurt (Townsfolk.injure, so he sits out until healed)
//           or killed (Townsfolk.slay: he dies on the roster, his purse to his
//           heir). The CHAMPION defends his title in the night's last bout; a
//           new champion, a death, a fixed fight found out go into the town's
//           annals (the townsfolk tell it) and the champion's own voice
//           (selfLines, read by the dialog's AI prompt).
//   BEAR    a real bear (pit.bear: bought from the trappers, its wounds kept
//           and healed by the day) against the pit's dogs (bought from the
//           town, killed by the bear); a bear pulled down is sold to the
//           furriers and butchers (coin from the town, pelts and meat onto its
//           stalls) and another bought.
//   COCKS   two birds (pit.cocks: bought from the town's yards; the player may
//           buy and enter one); the loser mostly dies.
//
// THE BOOK: the master of the pit is a townsperson whose purse is the house's
// bank (topped up from the town once when the pit opens). The crowd pays the
// gate out of the town's purse into his; he pays the purses (the winner's
// prize: to the fighter's own purse, or split with the player who owns him),
// buys the animals, bribes a favourite to take a dive now and then (fixed),
// pays the crown a fifth of the gate where the law taxes the pits, and spends
// what he holds past his keep in the town. The player's bets go into his purse
// and are paid out of it at odds from the fighters' real strength (simulated
// bouts) and their records (the crowd's belief), less the house's margin.
//
// THE LAW (Laws.bloodSports): open, taxed, or banned by the realm or the
// town's own ordinance. Banned, the pit goes underground: a door fee, a
// smaller crowd paying more, more bouts to the death, and the watch may raid
// a fight night (BackRooms.raidChance): the card broken up, the master fined,
// the fighters jailed, the player on the night fined (and their stakes lost)
// with heat. An AI crown whose pits keep killing bans them, the sooner the
// holier its faith (ai.banDeaths), and may let them open again, taxed, a year on.
//
// FAITH AND MOOD: a fight night lifts the town's happiness for the share who
// love it and lowers it for the pious, by the realm's faith (mood.lovers by
// MaimFaith stance), and a death sobers it. The player who bets, watches,
// fights or keeps a fighter loses standing with the realm's clergy (once a
// night), and a death bout costs karma.
//
// Player state: player.pitFights = { bets, owned, record, log, faithDay }
// (saved). Every roll is a hash of the world seed, the town, the day and the
// bout — never the shared RNG. Explicit params, no globals. Data: data/pitFights.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Economy } from '../world/economy.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { PitRing } from '../world/pitRing.js';
import { Townsfolk } from './townsfolk.js';
import { Duels } from './duels.js';
import { Brawls } from './brawls.js';
import { Laws } from './laws.js';
import { BackRooms } from './backRooms.js';
import { Underworld } from './underworld.js';
import { Devotion } from './devotion.js';
import { MaimFaith } from './maimFaith.js';
import { Ailments } from './ailments.js';
import { Ledger } from './ledger.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _arr = (v) => (Array.isArray(v) ? v : []);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _c = (v) => Utils.cents(v);
const _day = (world) => Math.floor(_num(world && world.day));
const _seed = (world) => (world && world.generationParams && world.generationParams.seed) || 0;
const _cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const DEFAULTS = {
    enabled: true,
    chance: { village: 0.15, town: 0.5, city: 0.85, capital: 1 },
    names: ['the Ring'],
    fighters: { village: 3, town: 5, city: 7, capital: 8 },
    bouts: { village: 2, town: 3, city: 4, capital: 5 },
    minAge: 18, maxAge: 42, womenShare: 0.08, noRoles: ['child', 'priest', 'noble'],
    modes: {
        firstBlood: { label: 'to first blood', duel: 'firstBlood', weight: 5, yieldAt: 0.3, prize: 6, loserPurse: 2, death: 0.01, hurt: [0.55, 0.85] },
        submission: { label: 'to submission', duel: 'tournament', weight: 3.5, yieldAt: 0.2, prize: 10, loserPurse: 2, death: 0.04, hurt: [0.3, 0.6] },
        death: { label: 'to the death', duel: 'toDeath', weight: 1.2, yieldAt: 0, prize: 40, loserPurse: 0, death: 0.7, hurt: [0.05, 0.2] },
    },
    deathWeight: { feast: 2, fair: 1.5, underground: 2.5 },
    townMult: { village: 0.5, town: 1, city: 1.5, capital: 2 },
    training: { max: 5, attack: 0.35, defense: 0.25, power: 0.3, hp: 1, fee: 12, everyDays: 7 },
    veteran: { perWin: 0.05, maxWins: 12, agePast: 34, perYear: 0.1 },
    odds: { sims: 8, simWeight: 0.7, margin: 0.1, minOdds: 1.1, maxOdds: 6, stakes: [5, 10, 25, 50], maxShareOfBook: 0.5 },
    fixed: { share: 0.08, bribe: 15 },
    book: { bank: 120, keep: 400, spendShare: 0.3 },
    crowd: { perPop: 0.01, min: 12, max: 260, fee: 0.5, maxTownShare: 0.03, undergroundFee: 1, undergroundShare: 0.4 },
    tax: { share: 0.2 },
    sponsor: { signBase: 20, perWin: 5, wage: 6, everyDays: 7, ownerCut: 0.6 },
    self: {
        prize: { firstBlood: 15, submission: 25, death: 120 },
        harm: { win: [2, 14], lose: [12, 35], death: [30, 60] },
        renown: { win: 2, champion: 6, death: 4, craven: -6 },
        mercy: { base: 0.35, perRenown: 0.004, max: 0.85 },
    },
    bear: { share: { village: 0, town: 0.25, city: 0.6, capital: 0.8 }, price: 140, hp: [60, 90], heal: 4, dogs: 3, dogPrice: 9, bite: [3, 8], biteChance: 0.55, maul: 0.3, rounds: 12, carcass: 45, pelts: 2, meat: 6, everyDays: 6, names: ['Old Sackerson'] },
    cocks: { keep: 4, price: 3, carcass: 0.5, kill: 0.8, vigour: [0.8, 1.25], perWin: 0.05, names: ['Red Jack'] },
    law: { fine: 30, playerFine: 25, jailDays: 4, heat: 2, raidBase: 0.06, raidPerCrackdown: 0.003, door: 6, front: 'pit' },
    faith: { standing: { sacred: 3, mild: 1, harsh: 0 }, deathKarma: -1 },
    mood: { lovers: { sacred: 0.2, mild: 0.45, harsh: 0.65 }, scale: 1.4, deathSober: 0.6 },
    ai: { everyDays: 7, windowDays: 60, banDeaths: { sacred: 2, mild: 5, harsh: 999 }, relentDays: 360 },
    champion: { minWins: 2 },
    crowdStreet: { share: 0.3, lines: [] },
};

let _cfg = null;
let _cfgSrc;

function _merge(base, over) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) out[k] = _obj(v) && _obj(base[k]) ? _merge(base[k], v) : v;
    return out;
}

/** A well-mixed hash of the parts, in [0, 1). */
function _h(...parts) {
    let h = 2166136261 >>> 0;
    for (const p of parts) {
        const s = String(p);
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
        h ^= 0x9d; h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0; h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

/** A seeded stream from a hash key (mulberry32): the bout's own dice. */
function _stream(...parts) {
    let a = Math.floor(_h(...parts) * 4294967296) >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const _span = (range, u) => { const [a, b] = Array.isArray(range) ? range : [range, range]; return _num(a) + (_num(b, _num(a)) - _num(a)) * u; };
const _pick = (list, u) => (list.length ? list[Math.floor(u * list.length) % list.length] : null);
const _byType = (table, type, d = 0) => _num((table || {})[type], _num((table || {}).town, d));

export const PitFights = {
    DEFAULTS,

    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.pitFights : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            _cfg = _merge(DEFAULTS, _obj(src) || {});
        }
        return _cfg;
    },

    // ──────────── THE PIT ────────────

    /** May this town's pit fight in the open? (Laws.bloodSports) */
    status(world, s) {
        return Laws.bloodSports(world, s);
    },

    /** Does this town keep a pit at all (a hash of the town and its size)? */
    keepsPit(s) {
        if (!s || !s.type) return false;
        return _h(PitRing.key(s), 'keepsPit') < _byType(PitFights.config().chance, s.type);
    },

    /** The town's pit (made the first time it is asked of a town that keeps one with its people on a roster), or null. */
    ensure(world, s) {
        const C = PitFights.config();
        if (!C.enabled || !s || !s.folk || !Array.isArray(s.folk.people)) return null;
        if (!_obj(s.pit)) {
            if (!PitFights.keepsPit(s)) return null;
            const key = PitRing.key(s);
            s.pit = {
                v: 1, id: `pit${s.q},${s.r}`, name: _pick(_arr(C.names), _h(key, 'name')) || 'the Ring', founded: _day(world),
                master: null, fighters: {}, champion: null, bear: null, dogs: 0, cocks: [], card: null,
                bearBaiting: _h(key, 'bear') < _byType(C.bear.share, s.type), lastBear: -999,
                underground: false, front: null, log: [], deaths: [],
                stats: { nights: 0, bouts: 0, deaths: 0, gate: 0, tax: 0, raids: 0, bears: 0, dogs: 0, cocks: 0 },
            };
        }
        const pit = s.pit;
        if (!_obj(pit.fighters)) pit.fighters = {};
        if (!Array.isArray(pit.cocks)) pit.cocks = [];
        if (!Array.isArray(pit.log)) pit.log = [];
        if (!Array.isArray(pit.deaths)) pit.deaths = [];
        if (!_obj(pit.stats)) pit.stats = {};
        // Underground while the law forbids it (a cellar behind some honest front)
        const st = PitFights.status(world, s);
        pit.underground = !st.legal;
        if (pit.underground && !pit.front) pit.front = BackRooms.frontName(s, PitFights.config().law.front || 'pit');
        PitFights._master(world, s, pit);
        return pit;
    },

    /** The pit's master: a townsperson whose purse is the book (topped up from the town when he takes it on). */
    _master(world, s, pit) {
        const folk = s.folk;
        const cur = pit.master != null ? Townsfolk.get(folk, pit.master) : null;
        if (cur && Townsfolk.isHere(cur)) return cur;
        const day = _day(world);
        const C = PitFights.config();
        const fighters = new Set(Object.keys(pit.fighters).map(Number));
        const list = Townsfolk.residents(folk).filter(p => {
            const age = Townsfolk.age(p, day);
            return age >= 25 && age <= 65 && !['child', 'priest', 'guard'].includes(p.role) && !fighters.has(p.id);
        });
        if (!list.length) { pit.master = null; return null; }
        const p = list[Math.floor(_h(_seed(world), PitRing.key(s), 'master', day) * list.length) % list.length];
        pit.master = p.id;
        Townsfolk.purse(folk, p, world);
        const need = _num(C.book.bank, 120) - _num(p.purse);
        if (need > 0) p.purse = _c(_num(p.purse) + Economy.drawTown(s, need));
        return p;
    },

    /** The master's purse holder ({ p } or null). */
    masterOf(world, s) {
        const pit = s && s.pit;
        const p = pit && pit.master != null && s.folk ? Townsfolk.get(s.folk, pit.master) : null;
        return p && Townsfolk.isHere(p) ? p : null;
    },

    _masterPurse(world, s) {
        const m = PitFights.masterOf(world, s);
        if (m) Townsfolk.purse(s.folk, m, world);
        return m ? _num(m.purse) : 0;
    },

    /** Coin out of the master's purse (at most what he holds). → what he paid */
    _masterPays(world, s, amount) {
        const m = PitFights.masterOf(world, s);
        const a = _c(Math.max(0, amount));
        if (!m || !(a > 0)) return 0;
        Townsfolk.purse(s.folk, m, world);
        const paid = Math.min(Utils.centsDown(Math.max(0, _num(m.purse))), a);
        m.purse = _c(_num(m.purse) - paid);
        return paid;
    },

    /** Coin into the master's purse (or the town's, with no master). */
    _masterTakes(world, s, amount) {
        const a = _c(Math.max(0, amount));
        if (!(a > 0)) return 0;
        const m = PitFights.masterOf(world, s);
        if (m) { Townsfolk.purse(s.folk, m, world); m.purse = _c(_num(m.purse) + a); return a; }
        Economy.payTown(s, a);
        return a;
    },

    /** Coin into a townsperson's own purse. */
    _toPurse(world, s, p, amount) {
        const a = _c(Math.max(0, amount));
        if (!p || !(a > 0)) return 0;
        Townsfolk.purse(s.folk, p, world);
        p.purse = _c(_num(p.purse) + a);
        return a;
    },

    _log(pit, day, text, kind = 'note') {
        pit.log.push({ d: day, k: kind, x: text });
        if (pit.log.length > 30) pit.log.splice(0, pit.log.length - 30);
    },

    _annal(world, s, day, text) {
        Townsfolk.record(s.folk, world, day, { k: 'townMemory', x: text });
    },

    // ──────────── THE FIGHTERS ────────────

    /** Can this person fight on a card today? */
    canFight(s, p, day) {
        if (!p || !Townsfolk.isHere(p)) return false;
        if (p.jailedUntil != null && _num(p.jailedUntil) > day) return false;
        const hurt = Townsfolk.injury(p, day);
        return !hurt || hurt.hp / Math.max(1, hurt.max) >= 0.75;
    },

    /** Keep the pit's stable full: the town's strong young men (now and then a woman) who want the coin. */
    _recruit(world, s, pit, day) {
        const C = PitFights.config();
        const folk = s.folk;
        // The dead and the gone leave the stable (their record stays in the town's memory)
        for (const [pid, rec] of Object.entries(pit.fighters)) {
            const p = Townsfolk.get(folk, Number(pid));
            if (!p || p.died != null || p.away || Townsfolk.age(p, day) > _num(C.maxAge, 42) + 6) {
                if (pit.champion === Number(pid)) pit.champion = null;
                delete pit.fighters[pid];
            } else if (rec.owner === undefined) rec.owner = null;
        }
        const want = _byType(C.fighters, s.type, 5);
        if (Object.keys(pit.fighters).length >= want) return;
        const no = new Set(_arr(C.noRoles));
        const cands = Townsfolk.residents(folk).filter(p => {
            if (pit.fighters[p.id] || p.id === pit.master || no.has(p.role)) return false;
            const age = Townsfolk.age(p, day);
            if (age < _num(C.minAge, 18) || age > _num(C.maxAge, 42)) return false;
            return p.gender !== 'female' || _h(_seed(world), PitRing.key(s), p.id, 'woman') < _num(C.womenShare, 0.08);
        });
        const scored = cands.map(p => {
            const f = PitFights._raw(p);
            return { p, s: f.attack + f.defense + f.power / 3 + _h(_seed(world), PitRing.key(s), p.id, 'keen') * 2 };
        }).sort((a, b) => b.s - a.s);
        for (const { p } of scored) {
            if (Object.keys(pit.fighters).length >= want) break;
            pit.fighters[p.id] = { pid: p.id, joined: day, wins: 0, losses: 0, kills: 0, bouts: 0, streak: 0, train: 0, trainedDay: -999, owner: null };
        }
    },

    /** The person's raw fighting stats (Brawls.fighter → Duels.fromNpc: trade, traits, skills). */
    _raw(p) {
        try { return Brawls.fighter(p); } catch (e) { return { attack: 1, defense: 1.5, power: 5, max: 77, temperament: 'balanced', weaponDmg: 0 }; }
    },

    /** A pit fighter as a duel combatant: the person, their training and seasoning, their age and hurt. */
    combatant(world, s, p, rec, mode = 'firstBlood') {
        const C = PitFights.config();
        const day = _day(world);
        const f = PitFights._raw(p);
        const T = C.training, V = C.veteran;
        const tr = _clamp(_num(rec && rec.train), 0, _num(T.max, 5));
        const seasoned = Math.min(_num(rec && rec.wins), _num(V.maxWins, 12)) * _num(V.perWin, 0.05);
        const age = Townsfolk.age(p, day);
        const old = Math.max(0, age - _num(V.agePast, 34)) * _num(V.perYear, 0.1);
        const hp = Math.max(10, Math.round(_num(f.max, 77) / 3.5 + tr * _num(T.hp, 1)));
        const hurt = Townsfolk.injury(p, day);
        const steel = mode === 'death';
        return Duels.fromProfile({
            id: `pit_${p.id}`, kind: 'npc', name: Townsfolk.name(p), icon: '🥊',
            attack: Math.max(0.5, _num(f.attack, 1) + tr * _num(T.attack) + seasoned - old),
            defense: Math.max(0.5, _num(f.defense, 1.5) + tr * _num(T.defense) + seasoned * 0.6 - old * 0.6),
            power: Math.max(2, _num(f.power, 5) + tr * _num(T.power) + (steel ? 2 : 0)),
            hp, hpNow: hurt ? Math.round(hp * hurt.hp / Math.max(1, hurt.max)) : hp,
            stamina: 10 + Math.round(tr * 0.5),
            temperament: f.temperament || 'balanced',
            weapon: steel ? 'a short blade' : 'bare fists', weaponDmg: steel ? 2 : 0,
            skill: 2 + tr,
            ref: p,
        });
    },

    /** The fighters of the pit: [{ p, rec, name, record, hurt, can }], best record first. */
    stable(world, s) {
        const pit = s && s.pit;
        if (!pit) return [];
        const day = _day(world);
        const out = [];
        for (const rec of Object.values(pit.fighters)) {
            const p = Townsfolk.get(s.folk, rec.pid);
            if (!p || !Townsfolk.isHere(p)) continue;
            out.push({ p, rec, name: Townsfolk.name(p), age: Townsfolk.age(p, day), hurt: Townsfolk.injury(p, day), can: PitFights.canFight(s, p, day), champion: pit.champion === rec.pid });
        }
        return out.sort((a, b) => (b.rec.wins - b.rec.losses) - (a.rec.wins - a.rec.losses) || b.rec.wins - a.rec.wins);
    },

    /** "7–2, 1 killed" */
    recordText(rec) {
        if (!rec) return '';
        return `${_num(rec.wins)}–${_num(rec.losses)}${_num(rec.kills) ? `, ${rec.kills} killed` : ''}`;
    },

    // ──────────── THE CARD ────────────

    /** Is today a fight night here? (world/pitRing.js) */
    night(world, s) {
        return PitRing.nightOf(s, _day(world));
    },

    /**
     * Tonight's card ({ day, why, bouts, ran, ... }), drawn up once a fight night
     * (null on other nights or with no pit). Bouts:
     *   { i, kind: 'men', mode, a: pid|'player', b: pid, fixed: 'a'|'b'|null, title }
     *   { i, kind: 'bear', bear, dogs }   { i, kind: 'cocks', a: cockId, b: cockId }
     */
    card(world, s, at = null) {
        const pit = PitFights.ensure(world, s);
        if (!pit) return null;
        const day = at != null ? Math.floor(_num(at)) : _day(world);
        const night = PitRing.nightOf(s, day);
        if (!night.fight) return pit.card && pit.card.day === day ? pit.card : null;
        if (pit.card && pit.card.day === day) return pit.card;
        const C = PitFights.config();
        const key = PitRing.key(s);
        PitFights._recruit(world, s, pit, day);
        const bouts = [];
        // The men: matched by strength, the champion last against the best who will face him
        const avail = PitFights.stable(world, s).filter(f => f.can);
        avail.sort((a, b) => PitFights._rating(world, s, b) - PitFights._rating(world, s, a));
        const nMen = Math.max(0, _byType(C.bouts, s.type, 3) - (pit.bearBaiting ? 1 : 0) - 1);
        const used = new Set();
        const pairs = [];
        const champ = pit.champion != null ? avail.find(f => f.rec.pid === pit.champion) : null;
        if (champ) {
            const challenger = avail.find(f => f !== champ);
            if (challenger) { pairs.push([challenger, champ, true]); used.add(champ.rec.pid); used.add(challenger.rec.pid); }
        }
        const rest = avail.filter(f => !used.has(f.rec.pid));
        for (let i = 0; i + 1 < rest.length && pairs.length < nMen; i += 2) pairs.unshift([rest[i], rest[i + 1], false]);
        // (the modes: to the death more often on a feast night, a fair, and underground)
        const M = C.modes;
        const DW = C.deathWeight || {};
        const dm = (night.why === 'feast' ? _num(DW.feast, 2) : night.why === 'fair' ? _num(DW.fair, 1.5) : 1) * (pit.underground ? _num(DW.underground, 2.5) : 1);
        pairs.forEach(([a, b, title], j) => {
            const w = Object.entries(M).map(([id, m]) => ({ id, w: _num(m.weight, 1) * (id === 'death' ? dm : 1) }));
            const tot = w.reduce((t, e) => t + e.w, 0);
            let u = _h(_seed(world), key, day, j, 'mode') * tot;
            let mode = 'firstBlood';
            for (const e of w) { u -= e.w; if (u <= 0) { mode = e.id; break; } }
            // (a fixed fight: the favourite is paid to go down — never to the death)
            const fixed = mode !== 'death' && _h(_seed(world), key, day, j, 'fix') < _num(C.fixed.share, 0.08);
            bouts.push({ i: bouts.length, kind: 'men', mode, a: a.rec.pid, b: b.rec.pid, title: !!title, fixed: fixed ? 'tbd' : null, result: null });
        });
        // The bear, every few days on the bigger nights
        if (pit.bearBaiting && day - _num(pit.lastBear, -999) >= _num(C.bear.everyDays, 6) && (night.why !== 'market' || _h(key, day, 'bearnight') < 0.5)) {
            bouts.push({ i: bouts.length, kind: 'bear', result: null });
        }
        // A cockfight, every night
        bouts.push({ i: bouts.length, kind: 'cocks', result: null });
        // (the main event last: a title bout, else the last men's bout)
        const t = bouts.findIndex(b => b.title);
        if (t >= 0) { const [tb] = bouts.splice(t, 1); bouts.push(tb); }
        bouts.forEach((b, i) => { b.i = i; });
        pit.card = { day, why: night.why, bouts, ran: false, raid: null, crowd: 0, gate: 0, mood: 0, results: [] };
        return pit.card;
    },

    /** A fighter's rating for the matchmaking (cheap: the combatant's numbers). */
    _rating(world, s, f) {
        const c = PitFights.combatant(world, s, f.p, f.rec);
        return c.attack + c.defense + c.power / 3 + c.hp / 15;
    },

    /** The two sides of a bout as combatants (the player's own bout: Duels.fromPlayer elsewhere). */
    _sides(world, s, bout) {
        const pit = s.pit;
        const side = (pid) => {
            const p = Townsfolk.get(s.folk, pid);
            return p ? PitFights.combatant(world, s, p, pit.fighters[pid], bout.mode) : null;
        };
        return { A: side(bout.a), B: side(bout.b) };
    },

    /** The bout's own seeded dice. */
    _rng(world, s, bout, tag = 'bout') {
        return _stream(_seed(world), PitRing.key(s), s.pit.card ? s.pit.card.day : _day(world), bout.i, tag);
    },

    /**
     * The book on a bout: { pA, odds: [a, b], sim, crowd } — the chance A wins from
     * simulated bouts of the real fighters (sim) blended with what their records
     * make the crowd believe, less the house's margin. Kept on the bout.
     */
    odds(world, s, bout) {
        if (!bout) return null;
        if (bout.book) return bout.book;
        const C = PitFights.config().odds;
        let sim = 0.5;
        let crowd = 0.5;
        if (bout.kind === 'men') {
            const { A, B } = PitFights._sides(world, s, bout);
            if (!A || !B) return null;
            const M = PitFights.config().modes[bout.mode] || {};
            const n = Math.max(2, _num(C.sims, 8));
            let won = 0;
            for (let k = 0; k < n; k++) {
                const r = Duels.autoResolve({ ...A }, { ...B }, { mode: M.duel || 'firstBlood', rng: _stream(_seed(world), PitRing.key(s), 'odds', s.pit.card.day, bout.i, k), playerYieldAt: _num(M.yieldAt) });
                if (r.winner === 'a') won++;
            }
            sim = (won + 0.5) / (n + 1);
            const ra = s.pit.fighters[bout.a] || {}, rb = s.pit.fighters[bout.b] || {};
            const fa = (_num(ra.wins) + 1) / (_num(ra.wins) + _num(ra.losses) + 2);
            const fb = (_num(rb.wins) + 1) / (_num(rb.wins) + _num(rb.losses) + 2);
            crowd = fa / Math.max(1e-6, fa + fb);
        } else if (bout.kind === 'bear') {
            const bear = s.pit.bear;
            const hp = bear ? _num(bear.hp) : _span(PitFights.config().bear.hp, 0.5);
            sim = _clamp(hp / (hp + _num(PitFights.config().bear.dogs, 3) * 22), 0.2, 0.85);
            crowd = bear ? _clamp(0.5 + _num(bear.wins) * 0.05, 0.3, 0.8) : 0.5;
        } else if (bout.kind === 'cocks') {
            const [ca, cb] = PitFights._cockPair(world, s, bout);
            const va = ca ? PitFights._vigour(ca) : 1, vb = cb ? PitFights._vigour(cb) : 1;
            sim = va / (va + vb);
            crowd = ca && cb ? (_num(ca.wins) + 1) / (_num(ca.wins) + _num(cb.wins) + 2) : 0.5;
        }
        const w = _clamp(_num(C.simWeight, 0.7), 0, 1);
        const pA = _clamp(sim * w + crowd * (1 - w), 0.05, 0.95);
        const o = (p) => Math.round(_clamp((1 / p) * (1 - _num(C.margin, 0.1)), _num(C.minOdds, 1.1), _num(C.maxOdds, 6)) * 100) / 100;
        bout.book = { pA: Math.round(pA * 100) / 100, sim: Math.round(sim * 100) / 100, odds: [o(pA), o(1 - pA)] };
        return bout.book;
    },

    // ──────────── THE NIGHT ────────────

    /**
     * Fight tonight's card (once a night): the gate, every bout, the purses, the
     * dead and the hurt, the champion, the animals, the crown's fifth, the mood,
     * the player's bets settled. A pit underground may be raided instead.
     * player: the player (their bets here settle; present: they are in the crowd).
     * → { card, results: [result], raid?, notices: [] }
     */
    runCard(world, s, player = null, opts = {}) {
        const card = PitFights.card(world, s, opts.day != null ? opts.day : null);
        if (!card) return null;
        const out = { card, results: card.results, notices: [] };
        if (card.ran) return out;
        const C = PitFights.config();
        const pit = s.pit;
        const day = card.day;
        const key = PitRing.key(s);
        const present = !!opts.present;
        card.ran = true;
        pit.stats.nights = _num(pit.stats.nights) + 1;
        // The watch comes down the stair (a pit gone underground)
        if (pit.underground) {
            const tile = world && typeof world.getTile === 'function' ? world.getTile(s.q, s.r) : null;
            const L = C.law;
            const st = tile ? BackRooms.raidChance(world, tile, null) : 0.08;
            const chance = _clamp(_num(L.raidBase, 0.06) + (st - 0.04) * 0.5, 0.02, 0.6);
            if (_h(_seed(world), key, day, 'raid') < chance) {
                out.raid = PitFights._raid(world, s, player, present);
                card.raid = out.raid;
                PitFights._settleBets(world, s, player, out);
                return out;
            }
        }
        // The gate: the crowd's coin, from the town's purse to the master's
        const pop = Math.max(0, _num(s.population, 300));
        const Cr = C.crowd;
        let crowd = Math.round(_clamp(pop * _num(Cr.perPop, 0.01), _num(Cr.min, 12), _num(Cr.max, 260)) * (0.75 + _h(key, day, 'crowd') * 0.5) * (pit.underground ? _num(Cr.undergroundShare, 0.4) : 1));
        const fee = pit.underground ? _num(Cr.undergroundFee, 1) : _num(Cr.fee, 0.5);
        const purse = Economy.townPurse(s);
        let gate = _c(crowd * fee);
        if (purse != null) gate = Math.min(gate, Utils.centsDown(purse * _num(Cr.maxTownShare, 0.03)));
        gate = PitFights._masterTakes(world, s, Economy.drawTown(s, gate));
        card.crowd = crowd;
        card.gate = gate;
        pit.stats.gate = _c(_num(pit.stats.gate) + gate);
        // The crown's fifth (the law taxes the pits)
        const law = PitFights.status(world, s);
        if (law.taxed && s.kingdom != null) {
            const k = world && typeof world.getKingdom === 'function' ? world.getKingdom(s.kingdom) : null;
            const tax = k ? PitFights._masterPays(world, s, gate * _num(C.tax.share, 0.2)) : 0;
            if (tax > 0) { k.treasury = _c(_num(k.treasury) + tax); pit.stats.tax = _c(_num(pit.stats.tax) + tax); card.tax = tax; }
        }
        let deaths = 0;
        for (const bout of card.bouts) {
            let r = null;
            if (bout.kind === 'men') r = PitFights._fightMen(world, s, bout, player);
            else if (bout.kind === 'bear') r = PitFights._baitBear(world, s, bout, player);
            else if (bout.kind === 'cocks') r = PitFights._cockfight(world, s, bout, player);
            if (!r) continue;
            bout.result = r;
            card.results.push(r);
            if (r.death) deaths++;
            pit.stats.bouts = _num(pit.stats.bouts) + 1;
        }
        // The town's mood: up for those who love it, down for the pious; a death sobers it
        const stance = MaimFaith.realmStance(world, s.kingdom);
        const lovers = _num((C.mood.lovers || {})[stance], 0.45);
        let mood = (lovers - (1 - lovers)) * _num(C.mood.scale, 1.4) - deaths * _num(C.mood.deathSober, 0.6);
        if (pit.underground) mood *= 0.4;
        mood = Math.round(mood * 100) / 100;
        s.happiness = _clamp(Math.round((_num(s.happiness, 50) + mood) * 100) / 100, 0, 100);
        card.mood = mood;
        // The master spends what he holds past his keep in the town (the coin goes back round)
        const held = PitFights._masterPurse(world, s);
        const keep = _num(C.book.keep, 400);
        if (held > keep) Economy.payTown(s, PitFights._masterPays(world, s, (held - keep) * _num(C.book.spendShare, 0.3)));
        PitFights._settleBets(world, s, player, out);
        return out;
    },

    /** A men's bout, fought by the duel engine. → result */
    _fightMen(world, s, bout, player) {
        const C = PitFights.config();
        const pit = s.pit;
        const day = pit.card.day;
        const pa = Townsfolk.get(s.folk, bout.a), pb = Townsfolk.get(s.folk, bout.b);
        if (!pa || !pb || !Townsfolk.isHere(pa) || !Townsfolk.isHere(pb)) return null;
        const ra = pit.fighters[bout.a], rb = pit.fighters[bout.b];
        if (!ra || !rb) return null;
        const M = C.modes[bout.mode] || C.modes.firstBlood;
        const { A, B } = PitFights._sides(world, s, bout);
        const rng = PitFights._rng(world, s, bout);
        const r = Duels.autoResolve(A, B, { mode: M.duel || 'firstBlood', rng, playerYieldAt: _num(M.yieldAt) });
        let winA = r.winner === 'a';
        // A fixed fight: the favourite was paid to go down
        let fixed = null;
        if (bout.fixed) {
            const book = PitFights.odds(world, s, bout);
            const fav = book.pA >= 0.5 ? 'a' : 'b';
            const bribe = PitFights._masterPays(world, s, _num(C.fixed.bribe, 15) * _byType(C.townMult, s.type, 1));
            PitFights._toPurse(world, s, fav === 'a' ? pa : pb, bribe);
            fixed = fav;
            bout.fixed = fav;
            winA = fav !== 'a';
        }
        const [wp, lp] = winA ? [pa, pb] : [pb, pa];
        const [wr, lr] = winA ? [ra, rb] : [rb, ra];
        const lost = winA ? r.bLost : r.aLost;
        const wLost = winA ? r.aLost : r.bLost;
        // The loser: dead or hurt
        const u = _stream(_seed(world), PitRing.key(s), day, bout.i, 'death')();
        const dies = !fixed && (bout.mode === 'death' ? u < _num(M.death, 0.7) : (lost >= 0.9 && u < _num(M.death, 0.02)));
        const tm = _byType(C.townMult, s.type, 1);
        if (dies) {
            Townsfolk.slay(s.folk, lp, day, `killed in the pit at ${s.name || 'town'} by ${Townsfolk.name(wp)}`, world);
            wr.kills = _num(wr.kills) + 1;
            pit.stats.deaths = _num(pit.stats.deaths) + 1;
            pit.deaths.push({ d: day, pid: lp.id, name: Townsfolk.name(lp), by: Townsfolk.name(wp) });
            if (pit.deaths.length > 20) pit.deaths.splice(0, pit.deaths.length - 20);
            delete pit.fighters[lp.id];
            if (pit.champion === lp.id) pit.champion = null;
            PitFights._annal(world, s, day, `${Townsfolk.name(wp)} killed ${Townsfolk.name(lp)} in the pit {when}, before ${pit.card.crowd || 'a'} roaring folk`);
        } else {
            const hp = Math.round(_span(M.hurt, _stream(_seed(world), PitRing.key(s), day, bout.i, 'hurt')()) * 30);
            Townsfolk.injure(lp, day, Math.max(2, hp), 30);
            lr.losses = _num(lr.losses) + 1;
            lr.streak = 0;
        }
        if (wLost > 0.3) Townsfolk.injure(wp, day, Math.round((1 - wLost * 0.6) * 30), 30);
        wr.wins = _num(wr.wins) + 1;
        wr.streak = _num(wr.streak) + 1;
        wr.bouts = _num(wr.bouts) + 1;
        if (lr) lr.bouts = _num(lr.bouts) + 1;
        // The purses: the winner's prize from the master; the loser's few coppers
        const prize = PitFights._masterPays(world, s, _num(M.prize, 6) * tm);
        let toOwner = 0;
        if (wr.owner === 'player' && player) {
            toOwner = _c(prize * _num(C.sponsor.ownerCut, 0.6));
            player.gold = _c(_num(player.gold) + toOwner);
            Ledger.record(player, 'gambling', toOwner);
        }
        PitFights._toPurse(world, s, wp, prize - toOwner);
        if (!dies && _num(M.loserPurse) > 0) PitFights._toPurse(world, s, lp, PitFights._masterPays(world, s, _num(M.loserPurse) * tm));
        // The title
        let champion = null;
        if (bout.title && wp.id !== pit.champion) {
            pit.champion = wp.id;
            pit.championSince = day;
            champion = wp.id;
            PitFights._annal(world, s, day, `${Townsfolk.name(wp)} took the champion's belt of ${pit.name} from ${Townsfolk.name(lp)} {when}`);
        } else if (bout.title) {
            wr.defences = _num(wr.defences) + 1;
        } else if (pit.champion == null && wr.wins >= _num(C.champion.minWins, 2)) {
            pit.champion = wp.id;
            pit.championSince = day;
            champion = wp.id;
            PitFights._annal(world, s, day, `${Townsfolk.name(wp)} is the champion of ${pit.name} now, ${PitFights.recordText(wr)} {when}`);
        }
        if (fixed && _h(_seed(world), PitRing.key(s), day, bout.i, 'found') < 0.25) {
            PitFights._annal(world, s, day, `Folk say ${Townsfolk.name(fixed === 'a' ? pa : pb)} took a dive in the pit {when}: paid to go down`);
        }
        const line = dies
            ? `${Townsfolk.name(wp)} killed ${Townsfolk.name(lp)} ${M.label === 'to the death' ? 'in a fight to the death' : 'in a bout that went too far'}.`
            : `${Townsfolk.name(wp)} beat ${Townsfolk.name(lp)} ${M.label}${r.yielded ? ' (he yielded)' : ''}${fixed ? ' — a dive, some say' : ''}.`;
        PitFights._log(pit, day, line, dies ? 'death' : 'bout');
        return { i: bout.i, kind: 'men', mode: bout.mode, winner: winA ? 'a' : 'b', winnerPid: wp.id, loserPid: lp.id, death: dies, fixed, prize, toOwner, champion, rounds: r.rounds, line, title: bout.title };
    },

    /** Bear-baiting: the pit's bear against its dogs. → result */
    _baitBear(world, s, bout, player) {
        const C = PitFights.config().bear;
        const pit = s.pit;
        const day = pit.card.day;
        const rng = PitFights._rng(world, s, bout, 'bear');
        // A bear, bought from the trappers if the pit has none (the coin to the town)
        if (!pit.bear) {
            const price = _num(C.price, 140) * (s.type === 'capital' ? 1.2 : 1);
            if (PitFights._masterPurse(world, s) < price) { pit.lastBear = day; return null; }
            Economy.payTown(s, PitFights._masterPays(world, s, price));
            const hp = Math.round(_span(C.hp, rng()));
            pit.bear = { name: _pick(_arr(C.names), rng()) || 'the bear', hp, max: hp, bought: day, wins: 0, scars: 0, healed: day };
            PitFights._log(pit, day, `The master bought a bear from the trappers: ${pit.bear.name}.`, 'animal');
        }
        // Dogs from the town's kennels to make up the pack
        const need = Math.max(0, _num(C.dogs, 3) - _num(pit.dogs));
        for (let k = 0; k < need; k++) {
            const paid = PitFights._masterPays(world, s, _num(C.dogPrice, 9));
            if (paid < _num(C.dogPrice, 9)) { Economy.payTown(s, paid); break; }
            Economy.payTown(s, paid);
            pit.dogs = _num(pit.dogs) + 1;
        }
        if (_num(pit.dogs) <= 0) return null;
        PitFights.odds(world, s, bout);
        const bear = pit.bear;
        PitFights._healBear(pit, day);
        let dogs = _num(pit.dogs);
        let dead = 0;
        for (let round = 0; round < _num(C.rounds, 12) && dogs > 0 && bear.hp > 0; round++) {
            for (let d = 0; d < dogs; d++) if (rng() < _num(C.biteChance, 0.55)) bear.hp -= Math.round(_span(C.bite, rng()));
            if (bear.hp <= 0) break;
            if (rng() < _num(C.maul, 0.3)) { dogs--; dead++; }
        }
        pit.dogs = dogs;
        pit.stats.dogs = _num(pit.stats.dogs) + dead;
        pit.lastBear = day;
        const bearWon = bear.hp > 0;
        let line;
        let death = false;
        if (bearWon) {
            bear.wins = _num(bear.wins) + 1;
            bear.scars = _num(bear.scars) + 1;
            bear.healed = day;
            line = `${bear.name} shook off the dogs${dead ? `, and ${dead} of them lie dead` : ''}.`;
        } else {
            // Pulled down: sold to the furriers and butchers (the town pays; pelts and meat onto its stalls)
            death = true;
            const paid = Economy.drawTown(s, _num(C.carcass, 45));
            PitFights._masterTakes(world, s, paid);
            if (SettlementMarket.uses(s, 'pelts')) SettlementMarket.add(s, 'pelts', _num(C.pelts, 2));
            if (SettlementMarket.uses(s, 'meat')) SettlementMarket.add(s, 'meat', _num(C.meat, 6));
            pit.stats.bears = _num(pit.stats.bears) + 1;
            line = `The dogs pulled ${bear.name} down${dead ? `, though ${dead} died of it` : ''}. The carcass went to the furriers.`;
            PitFights._annal(world, s, day, `The dogs pulled down ${bear.name}, the pit's bear, {when}`);
            pit.bear = null;
        }
        PitFights._log(pit, day, line, 'animal');
        return { i: bout.i, kind: 'bear', winner: bearWon ? 'a' : 'b', bearWon, dogsDead: dead, death: false, bearDied: death, line, bear: bear.name };
    },

    /** The bear's wounds heal by the day. */
    _healBear(pit, day) {
        const b = pit && pit.bear;
        if (!b) return;
        const days = Math.max(0, day - _num(b.healed, day));
        b.hp = Math.min(_num(b.max, 70), _num(b.hp) + days * _num(PitFights.config().bear.heal, 4));
        b.healed = day;
    },

    _vigour(cock) {
        return _num(cock.vigour, 1) * (1 + Math.min(_num(cock.wins), 8) * _num(PitFights.config().cocks.perWin, 0.05));
    },

    /** The two birds of tonight's cockfight (the player's entered bird first). */
    _cockPair(world, s, bout) {
        const pit = s.pit;
        const find = (id) => pit.cocks.find(c => c.id === id) || null;
        if (bout.a != null && bout.b != null) return [find(bout.a), find(bout.b)];
        // (birds bought from the town's yards to make up the pen)
        const C = PitFights.config().cocks;
        const day = pit.card ? pit.card.day : _day(world);
        let n = 0;
        while (pit.cocks.filter(c => !c.owner).length < _num(C.keep, 4) && n++ < 8) {
            const paid = PitFights._masterPays(world, s, _num(C.price, 3));
            if (paid < _num(C.price, 3)) { Economy.payTown(s, paid); break; }
            Economy.payTown(s, paid);
            const r = _stream(_seed(world), PitRing.key(s), day, 'cock', pit.stats.cocks || 0, n);
            // (a name no bird in the pen already answers to: no "Copper against Copper")
            const taken = new Set(pit.cocks.map(c => c.name));
            const free = _arr(C.names).filter(x => !taken.has(x));
            pit.cocks.push({ id: `c${day}_${n}_${pit.cocks.length}`, name: _pick(free.length ? free : _arr(C.names), r()) || 'a bird', vigour: Math.round(_span(C.vigour, r()) * 100) / 100, wins: 0, owner: null, bought: day });
        }
        const mine = pit.cocks.filter(c => c.owner === 'player' && c.entered === day);
        const house = pit.cocks.filter(c => !c.owner);
        const pick = [...mine, ...house].slice(0, 2);
        if (pick.length < 2) return [pick[0] || null, null];
        bout.a = pick[0].id;
        bout.b = pick[1].id;
        return pick;
    },

    /** A cockfight. → result */
    _cockfight(world, s, bout, player) {
        const C = PitFights.config().cocks;
        const pit = s.pit;
        const day = pit.card.day;
        const [ca, cb] = PitFights._cockPair(world, s, bout);
        if (!ca || !cb) return null;
        PitFights.odds(world, s, bout);
        const rng = PitFights._rng(world, s, bout, 'cocks');
        const va = PitFights._vigour(ca), vb = PitFights._vigour(cb);
        const winA = rng() < va / (va + vb);
        const [w, l] = winA ? [ca, cb] : [cb, ca];
        w.wins = _num(w.wins) + 1;
        const dies = rng() < _num(C.kill, 0.8);
        let prize = 0;
        if (dies) {
            pit.cocks = pit.cocks.filter(c => c !== l);
            pit.stats.cocks = _num(pit.stats.cocks) + 1;
            // (the cookshop takes the dead bird)
            PitFights._masterTakes(world, s, Economy.drawTown(s, _num(C.carcass, 0.5)));
        } else l.vigour = Math.round(_num(l.vigour, 1) * 0.75 * 100) / 100;
        // The player's own bird wins a purse
        if (w.owner === 'player' && player) {
            prize = PitFights._masterPays(world, s, 4 * _byType(PitFights.config().townMult, s.type, 1));
            player.gold = _c(_num(player.gold) + prize);
            Ledger.record(player, 'gambling', prize);
        }
        if (l.owner === 'player' && dies && player) PitFights._ownLog(player, day, `Your bird ${l.name} died in the cockpit at ${s.name}.`);
        const line = `${w.name} ${dies ? 'killed' : 'beat'} ${l.name} in the cockpit.`;
        PitFights._log(pit, day, line, 'animal');
        return { i: bout.i, kind: 'cocks', winner: winA ? 'a' : 'b', death: false, birdDied: dies, line, prize, a: ca.name, b: cb.name };
    },

    /** The watch kicks the door in. → { fine, jailed, player? , text } */
    _raid(world, s, player, present) {
        const C = PitFights.config().law;
        const pit = s.pit;
        const day = pit.card.day;
        const pun = Laws.punishment(world, s.kingdom);
        const fine = PitFights._masterPays(world, s, _num(C.fine, 30) * pun.fine);
        Economy.payTown(s, fine);
        let jailed = 0;
        for (const b of pit.card.bouts) {
            if (b.kind !== 'men') continue;
            for (const pid of [b.a, b.b]) {
                const p = Townsfolk.get(s.folk, pid);
                if (p && Townsfolk.isHere(p)) { p.jailedUntil = day + Math.round(_num(C.jailDays, 4) * pun.jail); jailed++; }
            }
        }
        pit.stats.raids = _num(pit.stats.raids) + 1;
        const out = { fine, jailed, text: `The watch came down the stair behind ${pit.front || 'the front'} and broke up the night: ${jailed} fighter${jailed === 1 ? '' : 's'} taken, the master fined.` };
        if (player && present) {
            const pf = Math.min(_num(player.gold), Math.round(_num(C.playerFine, 25) * pun.fine));
            player.gold = _c(_num(player.gold) - pf);
            Economy.payTown(s, pf);
            Ledger.record(player, 'fines', -pf);
            if (s.kingdom != null) Underworld.addHeat(player, s.kingdom, _num(C.heat, 2), world);
            out.player = { fine: pf };
            out.text += ` You were taken with the crowd: a ${Utils.formatGold(pf)}g fine.`;
        }
        PitFights._log(pit, day, out.text, 'raid');
        PitFights._annal(world, s, day, `The watch raided the pit behind ${pit.front || 'a front'} {when}`);
        return out;
    },

    // ──────────── THE PLAYER ────────────

    /** The player's pit book: { bets, owned, record, log, faithDay }. */
    state(player) {
        if (!player) return null;
        if (!_obj(player.pitFights)) player.pitFights = { bets: [], owned: [], record: { bouts: 0, wins: 0, losses: 0, kills: 0, betsWon: 0, betsLost: 0, betsVoid: 0, staked: 0, won: 0 }, log: [], faithDay: -1 };
        const st = player.pitFights;
        if (!Array.isArray(st.bets)) st.bets = [];
        if (!Array.isArray(st.owned)) st.owned = [];
        if (!Array.isArray(st.log)) st.log = [];
        if (!_obj(st.record)) st.record = { bouts: 0, wins: 0, losses: 0, kills: 0, betsWon: 0, betsLost: 0, staked: 0, won: 0 };
        return st;
    },

    _ownLog(player, day, text) {
        const st = PitFights.state(player);
        st.log.unshift({ d: day, x: text });
        if (st.log.length > 20) st.log.length = 20;
    },

    /** The clergy frown on one who takes part (once a night), a death bout costs karma. */
    _sin(player, world, s, opts = {}) {
        const st = PitFights.state(player);
        const day = _day(world);
        const C = PitFights.config().faith;
        let cost = 0;
        if (st.faithDay !== day) {
            st.faithDay = day;
            const stance = MaimFaith.realmStance(world, s.kingdom);
            const f = MaimFaith.realmFaith(world, s.kingdom);
            const n = _num((C.standing || {})[stance], 1);
            if (f && n > 0) { try { cost = -Devotion._addStanding(player, f, -n); } catch (e) { cost = 0; } }
        }
        if (opts.death) player.karma = _num(player.karma) + _num(C.deathKarma, -1);
        return cost;
    },

    /** The door of a pit gone underground: a fee to the master, once a night. → { fee, paid, text } */
    door(player, world, s) {
        const pit = s && s.pit;
        if (!pit || !pit.underground) return { fee: 0, paid: true };
        const st = PitFights.state(player);
        const day = _day(world);
        if (st.doorDay === `${s.q},${s.r}|${day}`) return { fee: 0, paid: true };
        const fee = _num(PitFights.config().law.door, 6);
        return { fee, paid: false, text: `The doorman behind ${pit.front} wants ${Utils.formatGold(fee)}g.` };
    },

    _payDoor(player, world, s) {
        const d = PitFights.door(player, world, s);
        if (d.paid) return { ok: true };
        if (_num(player.gold) < d.fee) return { ok: false, reason: d.text };
        player.gold = _c(_num(player.gold) - d.fee);
        PitFights._masterTakes(world, s, d.fee);
        Ledger.record(player, 'gambling', -d.fee);
        PitFights.state(player).doorDay = `${s.q},${s.r}|${_day(world)}`;
        return { ok: true, fee: d.fee };
    },

    /** The most the master will take on one side of a bout (he must be able to pay it). */
    maxStake(world, s, bout, side) {
        const book = PitFights.odds(world, s, bout);
        if (!book) return 0;
        const odds = book.odds[side === 'a' ? 0 : 1];
        const bank = PitFights._masterPurse(world, s) * _num(PitFights.config().odds.maxShareOfBook, 0.5);
        return Math.max(0, Math.floor(bank / Math.max(0.1, odds - 1)));
    },

    /**
     * Put money on a bout: the stake into the master's purse at the book's odds.
     * → { success, text|reason, bet }
     */
    bet(player, world, s, boutIdx, side, stake) {
        const card = PitFights.card(world, s);
        if (!card) return { success: false, reason: 'There are no bouts here tonight.' };
        if (card.ran) return { success: false, reason: 'Tonight\'s bouts are fought.' };
        const bout = card.bouts[boutIdx];
        if (!bout || !['a', 'b'].includes(side)) return { success: false, reason: 'No such bout.' };
        if (bout.a === 'player' || bout.b === 'player') return { success: false, reason: 'You cannot bet on your own bout.' };
        const amt = _c(Math.max(0, _num(stake)));
        if (!(amt > 0)) return { success: false, reason: 'Name a stake.' };
        if (_num(player.gold) < amt) return { success: false, reason: `You have not ${Utils.formatGold(amt)}g.` };
        const max = PitFights.maxStake(world, s, bout, side);
        if (amt > max) return { success: false, reason: max > 0 ? `The master will take no more than ${Utils.formatGold(max)}g on that side: he could not cover it.` : 'The master\'s book is too thin to take your coin.' };
        const door = PitFights._payDoor(player, world, s);
        if (!door.ok) return { success: false, reason: door.reason };
        const book = PitFights.odds(world, s, bout);
        const odds = book.odds[side === 'a' ? 0 : 1];
        player.gold = _c(_num(player.gold) - amt);
        PitFights._masterTakes(world, s, amt);
        Ledger.record(player, 'gambling', -amt);
        const st = PitFights.state(player);
        const b = { q: s.q, r: s.r, day: card.day, bout: boutIdx, side, stake: amt, odds, town: s.name };
        st.bets.push(b);
        st.record.staked = _c(_num(st.record.staked) + amt);
        PitFights._sin(player, world, s);
        return { success: true, bet: b, text: `${Utils.formatGold(amt)}g with the master on ${PitFights.sideName(world, s, bout, side)} at ${odds} to 1.` };
    },

    /**
     * Does the player hear that a bout is fixed? One with the thieves' guild's
     * ear, or a fighter of their own on the card, hears it (a hash, half the time).
     */
    fixKnown(player, world, s, bout) {
        if (!bout || !bout.fixed || !player) return false;
        const g = player.underworld && player.underworld.guild;
        const ear = !!(g && (g.member || g.contactMet));
        const own = [bout.a, bout.b].some(pid => s.pit.fighters[pid] && s.pit.fighters[pid].owner === 'player');
        return (ear || own) && _h(_seed(world), PitRing.key(s), s.pit.card ? s.pit.card.day : 0, bout.i, 'whisper') < 0.6;
    },

    /** "Brom Ironwood" / "the bear" / "Red Jack" */
    sideName(world, s, bout, side) {
        if (!bout) return 'someone';
        if (bout.kind === 'bear') return side === 'a' ? ((s.pit.bear && s.pit.bear.name) || 'the bear') : 'the dogs';
        if (bout.kind === 'cocks') {
            const [ca, cb] = PitFights._cockPair(world, s, bout);
            const c = side === 'a' ? ca : cb;
            return c ? c.name : 'a bird';
        }
        const pid = side === 'a' ? bout.a : bout.b;
        if (pid === 'player') return 'you';
        const p = Townsfolk.get(s.folk, pid);
        return p ? Townsfolk.name(p) : 'someone';
    },

    /** Settle the player's bets on a card that has been fought (or raided). */
    _settleBets(world, s, player, out) {
        if (!player || !player.pitFights) return;
        const st = PitFights.state(player);
        const card = s.pit.card;
        const keep = [];
        out.bets = [];
        for (const b of st.bets) {
            if (b.q !== s.q || b.r !== s.r || b.day !== card.day) { keep.push(b); continue; }
            const bout = card.bouts[b.bout];
            const res = bout && bout.result;
            if (card.raid) {
                // The watch takes the coin on the table: out of the master's book, into the town's purse
                Economy.payTown(s, PitFights._masterPays(world, s, b.stake));
                st.record.betsLost++;
                out.bets.push({ ...b, lost: true, raided: true, text: `Your ${Utils.formatGold(b.stake)}g went with the watch.` });
                continue;
            }
            if (!res) {
                // (a bout that came to nothing: the stake back)
                const back = PitFights._masterPays(world, s, b.stake);
                player.gold = _c(_num(player.gold) + back);
                Ledger.record(player, 'gambling', back);
                st.record.betsVoid = _num(st.record.betsVoid) + 1;
                out.bets.push({ ...b, void: true, paid: back, text: `No bout: ${Utils.formatGold(back)}g back.` });
                continue;
            }
            if (res.winner === b.side) {
                const due = _c(b.stake * b.odds);
                const paid = PitFights._masterPays(world, s, due);
                player.gold = _c(_num(player.gold) + paid);
                Ledger.record(player, 'gambling', paid);
                st.record.betsWon++;
                st.record.won = _c(_num(st.record.won) + paid - b.stake);
                out.bets.push({ ...b, won: true, paid, short: paid < due, text: `You won ${Utils.formatGold(paid)}g${paid < due ? ` (the master owed ${Utils.formatGold(due)}g and had no more)` : ''}.` });
            } else {
                st.record.betsLost++;
                st.record.won = _c(_num(st.record.won) - b.stake);
                out.bets.push({ ...b, lost: true, text: `You lost ${Utils.formatGold(b.stake)}g.` });
            }
        }
        st.bets = keep;
    },

    /** Watch tonight's card from the crowd: it is fought now. → runCard's result, with the faith's frown */
    watch(player, world, s) {
        const card = PitFights.card(world, s);
        if (!card) return { success: false, reason: 'There are no bouts here tonight.' };
        if (card.ran) return { success: true, ...PitFights.runCard(world, s, player, { present: true }), already: true };
        const door = PitFights._payDoor(player, world, s);
        if (!door.ok) return { success: false, reason: door.reason };
        const out = PitFights.runCard(world, s, player, { present: true });
        PitFights._sin(player, world, s, { death: out.results.some(r => r.death) });
        if (typeof player.modifyNeed === 'function') { try { player.modifyNeed('fun', 12); } catch (e) { /* no needs */ } }
        return { success: true, ...out };
    },

    /** What signing a fighter costs (his signing money, to his own purse). */
    signFee(world, s, rec) {
        const C = PitFights.config().sponsor;
        return Math.round((_num(C.signBase, 20) + _num(rec && rec.wins) * _num(C.perWin, 5)) * _byType(PitFights.config().townMult, s.type, 1));
    },

    /** Take a fighter into your keeping: his signing money now, his wage each week. */
    sign(player, world, s, pid) {
        const pit = PitFights.ensure(world, s);
        const rec = pit && pit.fighters[pid];
        const p = rec ? Townsfolk.get(s.folk, pid) : null;
        if (!rec || !p || !Townsfolk.isHere(p)) return { success: false, reason: 'No such fighter.' };
        if (rec.owner === 'player') return { success: false, reason: 'He is already yours.' };
        const fee = PitFights.signFee(world, s, rec);
        if (_num(player.gold) < fee) return { success: false, reason: `${Townsfolk.name(p)} wants ${Utils.formatGold(fee)}g to sign.` };
        player.gold = _c(_num(player.gold) - fee);
        PitFights._toPurse(world, s, p, fee);
        Ledger.record(player, 'gambling', -fee);
        rec.owner = 'player';
        const st = PitFights.state(player);
        st.owned.push({ q: s.q, r: s.r, pid, name: Townsfolk.name(p), town: s.name, signed: _day(world), paidTo: _day(world) });
        PitFights._sin(player, world, s);
        return { success: true, text: `${Townsfolk.name(p)} fights in your name now: ${Utils.formatGold(fee)}g to sign, ${Utils.formatGold(PitFights.wage(s))}g a week, and you take ${Math.round(_num(PitFights.config().sponsor.ownerCut, 0.6) * 100)}% of his purses.` };
    },

    wage(s) {
        return Math.round(_num(PitFights.config().sponsor.wage, 6) * _byType(PitFights.config().townMult, s && s.type, 1));
    },

    /** Pay for a week of training (the fee to the town's trainers): stronger in the pit. */
    train(player, world, s, pid) {
        const C = PitFights.config().training;
        const pit = s && s.pit;
        const rec = pit && pit.fighters[pid];
        if (!rec || rec.owner !== 'player') return { success: false, reason: 'Only a fighter of yours.' };
        if (_num(rec.train) >= _num(C.max, 5)) return { success: false, reason: 'He is as trained as a man can be.' };
        const day = _day(world);
        if (day - _num(rec.trainedDay, -999) < _num(C.everyDays, 7)) return { success: false, reason: `He trained lately; again on day ${_num(rec.trainedDay) + _num(C.everyDays, 7)}.` };
        const fee = Math.round(_num(C.fee, 12) * (1 + _num(rec.train) * 0.5));
        if (_num(player.gold) < fee) return { success: false, reason: `The trainers want ${Utils.formatGold(fee)}g.` };
        player.gold = _c(_num(player.gold) - fee);
        Economy.payTown(s, fee);
        Ledger.record(player, 'gambling', -fee);
        rec.train = _num(rec.train) + 1;
        rec.trainedDay = day;
        const p = Townsfolk.get(s.folk, pid);
        return { success: true, text: `A week at the posts and the sacks for ${p ? Townsfolk.name(p) : 'your fighter'}: training ${rec.train}/${_num(C.max, 5)}. ${Utils.formatGold(fee)}g to the trainers.` };
    },

    /** Let a fighter go. */
    release(player, world, s, pid) {
        const rec = s && s.pit && s.pit.fighters[pid];
        const st = PitFights.state(player);
        st.owned = st.owned.filter(o => !(o.q === s.q && o.r === s.r && o.pid === pid));
        if (rec && rec.owner === 'player') rec.owner = null;
        return { success: true, text: 'You let him go. He fights for the house again.' };
    },

    /** Buy a fighting cock from the town's yards and enter it tonight. */
    buyCock(player, world, s) {
        const pit = PitFights.ensure(world, s);
        if (!pit) return { success: false, reason: 'There is no pit here.' };
        const C = PitFights.config().cocks;
        const price = _num(C.price, 3) * 2;
        if (_num(player.gold) < price) return { success: false, reason: `A fighting bird costs ${Utils.formatGold(price)}g.` };
        const day = _day(world);
        const card = PitFights.card(world, s);
        if (card && card.ran) return { success: false, reason: 'The cockpit is done for tonight.' };
        const mine = pit.cocks.filter(c => c.owner === 'player');
        if (mine.length >= 2) return { success: false, reason: 'You keep two birds here already.' };
        player.gold = _c(_num(player.gold) - price);
        Economy.payTown(s, price);
        Ledger.record(player, 'gambling', -price);
        const r = _stream(_seed(world), PitRing.key(s), day, 'mycock', mine.length, _num(pit.stats.cocks));
        const taken = new Set(pit.cocks.map(c => c.name));
        const free = _arr(C.names).filter(x => !taken.has(x));
        const cock = { id: `pc${day}_${pit.cocks.length}`, name: _pick(free.length ? free : _arr(C.names), r()) || 'your bird', vigour: Math.round(_span(C.vigour, r()) * 100) / 100, wins: 0, owner: 'player', bought: day, entered: card ? day : null };
        pit.cocks.push(cock);
        if (card) { const b = card.bouts.find(x => x.kind === 'cocks'); if (b && !b.result) { b.a = null; b.b = null; b.book = null; } }
        PitFights._sin(player, world, s);
        return { success: true, cock, text: `You buy ${cock.name}, a ${cock.vigour >= 1.1 ? 'fierce' : cock.vigour >= 0.95 ? 'game' : 'scrawny'} bird, for ${Utils.formatGold(price)}g${card ? ': he fights tonight' : ': he fights the next fight night'}.` };
    },

    /** Enter a bird of yours on tonight's card. */
    enterCock(player, world, s, id) {
        const pit = s && s.pit;
        const cock = pit && pit.cocks.find(c => c.id === id && c.owner === 'player');
        const card = PitFights.card(world, s);
        if (!cock || !card || card.ran) return { success: false, reason: 'There is no cockfight to enter tonight.' };
        cock.entered = card.day;
        const b = card.bouts.find(x => x.kind === 'cocks');
        if (b && !b.result) { b.a = null; b.b = null; b.book = null; }
        return { success: true, text: `${cock.name} fights tonight.` };
    },

    /** Who you would face in the pit: the champion, else the best fighter fit to fight. */
    opponent(world, s) {
        const list = PitFights.stable(world, s).filter(f => f.can);
        if (!list.length) return null;
        return list.find(f => f.champion) || list.sort((a, b) => PitFights._rating(world, s, b) - PitFights._rating(world, s, a))[0];
    },

    /** The purse for your own bout. */
    selfPrize(s, mode) {
        return Math.round(_num((PitFights.config().self.prize || {})[mode], 15) * _byType(PitFights.config().townMult, s && s.type, 1));
    },

    /**
     * Step into the pit yourself: → { success, duel: { a, b, mode, rounds, title, intro }, opp }
     * (the duel panel fights it; selfSettle reckons it).
     */
    selfBout(player, world, s, mode, playerCombatant) {
        const card = PitFights.card(world, s);
        if (!card) return { success: false, reason: 'There are no bouts here tonight.' };
        if (card.ran) return { success: false, reason: 'Tonight\'s bouts are fought.' };
        const M = PitFights.config().modes[mode];
        if (!M) return { success: false, reason: 'No such bout.' };
        const st = PitFights.state(player);
        if (st.foughtDay === _day(world)) return { success: false, reason: 'You have fought once tonight.' };
        const opp = PitFights.opponent(world, s);
        if (!opp) return { success: false, reason: 'No one here is fit to fight you tonight.' };
        const door = PitFights._payDoor(player, world, s);
        if (!door.ok) return { success: false, reason: door.reason };
        const b = PitFights.combatant(world, s, opp.p, opp.rec, mode);
        st.pending = { q: s.q, r: s.r, day: card.day, mode, pid: opp.rec.pid };
        const prize = PitFights.selfPrize(s, mode);
        return {
            success: true, opp,
            duel: {
                a: playerCombatant, b, mode: M.duel || 'firstBlood', rounds: mode === 'death' ? 30 : undefined,
                title: `🥊 ${_cap(s.pit.name)}`,
                intro: `${opp.champion ? 'The champion, ' : ''}${Townsfolk.name(opp.p)} (${PitFights.recordText(opp.rec)}) ${M.label}, before the crowd of ${s.name}. The purse: ${Utils.formatGold(prize)}g.${mode === 'death' ? ' One of you will not walk out.' : ''}`,
            },
        };
    },

    /**
     * Reckon your own bout (outcome: Duels.result). → { success, text, died?, cause?, harm, prize }
     * Lost to the death and not spared: you are dead (the UI calls the death).
     */
    selfSettle(player, world, s, outcome) {
        const st = PitFights.state(player);
        const pend = st.pending;
        st.pending = null;
        if (!pend || !outcome || pend.q !== s.q || pend.r !== s.r) return { success: false, reason: 'There was no bout.' };
        const C = PitFights.config();
        const S = C.self;
        const pit = s.pit;
        const day = _day(world);
        const p = Townsfolk.get(s.folk, pend.pid);
        const rec = pit.fighters[pend.pid] || { wins: 0, losses: 0 };
        const name = p ? Townsfolk.name(p) : 'your foe';
        const won = !!outcome.playerWon;
        st.foughtDay = day;
        st.record.bouts++;
        const parts = [];
        let died = false;
        let cause = null;
        // Your harm, from the share of the bout lost
        const range = won ? S.harm.win : pend.mode === 'death' ? S.harm.death : S.harm.lose;
        const harm = Duels.harm(outcome.aLost, range);
        player.health = Math.max(0, _num(player.health, 100) - harm);
        parts.push(`−${harm} health`);
        if (!won) {
            const w = Ailments.maybeWound(player, world, 'duel', { chanceMult: pend.mode === 'death' ? 3 : 1.5 });
            if (w) parts.push(`${w.icon || ''} ${w.name}`.trim());
        }
        let prize = 0;
        if (won) {
            st.record.wins++;
            prize = PitFights._masterPays(world, s, PitFights.selfPrize(s, pend.mode));
            player.gold = _c(_num(player.gold) + prize);
            Ledger.record(player, 'gambling', prize);
            player.renown = _num(player.renown) + _num(S.renown.win, 2) + (pend.mode === 'death' ? _num(S.renown.death, 4) : 0);
            parts.push(`${Utils.formatGold(prize)}g purse`);
            rec.losses = _num(rec.losses) + 1;
            // Your foe: dead in a death bout (now and then spared by the crowd), else hurt
            if (p && pend.mode === 'death' && outcome.yielded !== 'b' && _h(_seed(world), PitRing.key(s), day, 'selfkill') < _num(C.modes.death.death, 0.7)) {
                Townsfolk.slay(s.folk, p, day, `killed in the pit at ${s.name} by ${player.name || 'a stranger'}`, world);
                delete pit.fighters[p.id];
                st.record.kills++;
                pit.stats.deaths = _num(pit.stats.deaths) + 1;
                pit.deaths.push({ d: day, pid: p.id, name, by: player.name || 'the stranger' });
                parts.push(`${name} lies dead`);
                PitFights._annal(world, s, day, `${player.name || 'A stranger'} killed ${name} in the pit {when}`);
            } else if (p) Townsfolk.injure(p, day, 6, 30);
            if (pit.champion === pend.pid || pit.champion == null) {
                pit.champion = 'player';
                pit.championSince = day;
                st.champion = `${s.q},${s.r}`;
                player.renown = _num(player.renown) + _num(S.renown.champion, 6);
                parts.push(`the champion's belt of ${pit.name}`);
                PitFights._annal(world, s, day, `${player.name || 'A stranger'} beat ${name} and took the champion's belt of ${pit.name} {when}`);
            }
        } else {
            st.record.losses++;
            rec.wins = _num(rec.wins) + 1;
            if (p) PitFights._toPurse(world, s, p, PitFights._masterPays(world, s, PitFights.selfPrize(s, pend.mode) * 0.5));
            if (pit.champion === 'player') { pit.champion = pend.pid; pit.championSince = day; st.champion = null; parts.push('the belt is lost'); }
            if (pend.mode === 'death') {
                // Down in the sand: the crowd's thumbs (your name sways them); yielded, the craven's shame if spared
                const mercy = _clamp(_num(S.mercy.base, 0.35) + _num(player.renown) * _num(S.mercy.perRenown, 0.004) + (outcome.yielded === 'a' ? 0.1 : 0), 0, _num(S.mercy.max, 0.85));
                if (_h(_seed(world), PitRing.key(s), day, 'mercy', _num(player.health)) < mercy) {
                    player.health = Math.max(1, _num(player.health));
                    parts.push('the crowd spared you');
                    if (outcome.yielded === 'a') { player.renown = Math.max(0, _num(player.renown) + _num(S.renown.craven, -6)); parts.push('craven'); }
                } else {
                    died = true;
                    player.health = 0;
                    cause = `killed in the pit at ${s.name} by ${name}`;
                }
            } else player.health = Math.max(1, _num(player.health));
        }
        PitFights._sin(player, world, s, { death: pend.mode === 'death' });
        const text = won ? `You beat ${name} ${C.modes[pend.mode].label}. ${parts.join(' · ')}.` : died ? `${name} kills you in the sand at ${s.name}.` : `${name} beats you ${C.modes[pend.mode].label}. ${parts.join(' · ')}.`;
        PitFights._ownLog(player, day, text);
        PitFights._log(pit, day, won ? `${player.name || 'A stranger'} beat ${name} ${C.modes[pend.mode].label}.` : `${name} beat ${player.name || 'a stranger'} ${C.modes[pend.mode].label}.`, 'bout');
        return { success: true, won, died, cause, harm, prize, text };
    },

    // ──────────── THE DAY ────────────

    /** Your fighters' wages, week by week (to their own purses); unpaid, they walk. */
    _wages(player, world, notices) {
        const st = player && player.pitFights;
        if (!st || !st.owned.length) return;
        const day = _day(world);
        const every = _num(PitFights.config().sponsor.everyDays, 7);
        st.owned = st.owned.filter(o => {
            const tile = world.getTile ? world.getTile(o.q, o.r) : null;
            const s = tile && tile.settlement;
            const rec = s && s.pit && s.pit.fighters[o.pid];
            const p = s && s.folk ? Townsfolk.get(s.folk, o.pid) : null;
            if (!rec || !p || !Townsfolk.isHere(p) || rec.owner !== 'player') {
                notices.push({ icon: '🥊', title: 'Your Fighter', text: p && p.died != null ? `${o.name} is dead: ${p.cause || 'killed'}.` : `${o.name} fights for you no more.`, type: 'warning' });
                return false;
            }
            if (day - _num(o.paidTo) < every) return true;
            const wage = PitFights.wage(s);
            if (_num(player.gold) < wage) {
                rec.owner = null;
                notices.push({ icon: '🥊', title: 'Your Fighter Walks', text: `${o.name} went unpaid and fights for the house again.`, type: 'warning' });
                return false;
            }
            player.gold = _c(_num(player.gold) - wage);
            PitFights._toPurse(world, s, p, wage);
            Ledger.record(player, 'gambling', -wage);
            o.paidTo = day;
            return true;
        });
    },

    /** Bets on a night whose card was never fought (the town's roster gone, days passed unlived): the stake back from the master. */
    _staleBets(player, world) {
        const st = player.pitFights;
        if (!st || !st.bets.length) return;
        const day = _day(world);
        st.bets = st.bets.filter(b => {
            if (b.day >= day - 1) return true;
            const tile = world.getTile ? world.getTile(b.q, b.r) : null;
            const s = tile && tile.settlement;
            const back = s && s.pit ? PitFights._masterPays(world, s, b.stake) : 0;
            if (back > 0) { player.gold = _c(_num(player.gold) + back); Ledger.record(player, 'gambling', back); }
            st.record.betsVoid = _num(st.record.betsVoid) + 1;
            return false;
        });
    },

    /**
     * The day's end (after the world's day has turned), every town with a pit and
     * a roster: the night just past's card fought (unless the player watched it), the dead and the champions, the animals; the player's
     * bets and fighters reckoned; the crowns weigh their pits' dead.
     * → { notices, events }
     */
    processDay(world, player = null) {
        const C = PitFights.config();
        const notices = [];
        const events = [];
        if (!world || !C.enabled) return { notices, events };
        const day = _day(world);
        const prev = day - 1;
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        for (const v of views) {
            const tile = typeof world.getTile === 'function' ? world.getTile(v.q, v.r) : null;
            const s = (tile && tile.settlement) || v;
            if (!s || !s.folk || s.q == null) continue;
            if (!_obj(s.pit) && !PitFights.keepsPit(s)) continue;
            // (the day's end comes after the world's day has turned: the night just past is yesterday's)
            const night = PitRing.nightOf(s, prev);
            if (!night.fight) { if (s.pit) PitFights.ensure(world, s); continue; }
            const card = PitFights.card(world, s, prev);
            if (!card || card.ran) continue;
            const here = player && player.q === s.q && player.r === s.r;
            const out = PitFights.runCard(world, s, player, { present: false, day: prev });
            if (!out) continue;
            events.push({ kind: 'pit', hex: `${s.q},${s.r}`, town: s.name, raid: !!out.raid, deaths: out.results.filter(r => r.death).length });
            if (player) {
                for (const b of out.bets || []) notices.push({ icon: '🎲', title: `The Pit at ${s.name}`, text: `${PitFights.sideName(world, s, card.bouts[b.bout], b.side)}: ${b.text}`, type: b.won ? 'success' : b.lost ? 'warning' : 'info' });
                const mine = out.results.filter(r => r.kind === 'men' && r.toOwner > 0);
                for (const r of mine) notices.push({ icon: '🥊', title: 'Your Fighter Won', text: `${r.line} Your share of the purse: ${Utils.formatGold(r.toOwner)}g.`, type: 'success' });
                if (here && out.raid) notices.push({ icon: '🚨', title: 'The Pit Raided', text: out.raid.text, type: 'warning' });
            }
        }
        if (player) {
            PitFights._wages(player, world, notices);
            PitFights._staleBets(player, world);
        }
        if (day % Math.max(1, _num(C.ai.everyDays, 7)) === 0) PitFights._crowns(world, player, events);
        return { notices, events };
    },

    /**
     * The AI crowns weigh their pits: a realm whose pits have killed more than its
     * faith will stand (ai.banDeaths by stance) in the last windowDays bans them;
     * a ban of the crown's own making relents to taxed after relentDays. The
     * player's own realm is the player's to decide.
     */
    _crowns(world, player, events) {
        const C = PitFights.config().ai;
        const day = _day(world);
        const ruled = player ? Laws.ruled(player, world) : null;
        const deaths = new Map();
        for (const v of typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : []) {
            const s = (world.getTile && world.getTile(v.q, v.r) && world.getTile(v.q, v.r).settlement) || v;
            const pit = s && s.pit;
            if (!pit || s.kingdom == null) continue;
            const n = _arr(pit.deaths).filter(d => day - _num(d.d) <= _num(C.windowDays, 60)).length;
            if (n) deaths.set(s.kingdom, (deaths.get(s.kingdom) || 0) + n);
        }
        for (const k of world.kingdoms || []) {
            if (!k || k.isAlive === false || (ruled && ruled.id === k.id)) continue;
            const law = Laws.value(world, k.id, 'bloodSports');
            const stance = MaimFaith.realmStance(world, k.id);
            const n = deaths.get(k.id) || 0;
            if (law !== 'banned' && n >= _num((C.banDeaths || {})[stance], 5)) {
                if (Laws.proclaim(world, k, 'bloodSports', 'banned', { why: `${n} dead in the pits` })) events.push({ kind: 'pitLaw', kingdom: k.id, to: 'banned', deaths: n });
            } else if (law === 'banned') {
                const last = (_arr(k.laws && k.laws.history).filter(h => h.law === 'bloodSports' && h.by === 'crown').pop()) || null;
                if (last && last.to === 'banned' && day - _num(last.day) >= _num(C.relentDays, 360) && n === 0) {
                    if (Laws.proclaim(world, k, 'bloodSports', 'taxed', { why: 'the pits back, for the crown\'s fifth' })) events.push({ kind: 'pitLaw', kingdom: k.id, to: 'taxed' });
                }
            }
        }
    },

    // ──────────── WHAT THE TOWN SAYS ────────────

    /**
     * What a person knows of their own pit life, for their voice (the AI chat's
     * prompt): their record, the belt, the men they killed, the one who runs it.
     */
    selfLines(world, s, p) {
        const pit = s && s.pit;
        if (!pit || !p) return [];
        const out = [];
        if (pit.master === p.id) out.push(`You run the fighting pit, ${pit.name}${pit.underground ? `, in a cellar behind ${pit.front}, since the law forbids it` : ''}; your purse is the book.`);
        const rec = pit.fighters[p.id];
        if (rec) {
            out.push(`You fight in the town pit, ${pit.name}: ${PitFights.recordText(rec)}${rec.owner === 'player' ? ', in the player\'s pay' : ''}.`);
            if (pit.champion === p.id) out.push(`You are the pit's champion and proud of it${rec.defences ? `: you have kept the belt ${rec.defences} time${rec.defences === 1 ? '' : 's'}` : ''}.`);
        }
        for (const d of _arr(pit.deaths).slice(-6)) if (d.by === Townsfolk.name(p)) out.push(`You killed ${d.name} in the pit (day ${d.d}).`);
        return out;
    },
};
