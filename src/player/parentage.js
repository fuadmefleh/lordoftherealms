// ============================================
// PARENTAGE — born to a family, and the people every life begins among
// ============================================
//
// Born to a Family (New Game origin 'born', player/scenarios.js): the player
// is the child of a real couple of the world —
//   - townsfolk of a town's roster (systems/townsfolk.js: a farmer and his
//     wife, a smith's, a merchant's, a guardsman's, a priest's household, the
//     master of the town's guild (Guilds: the guild's sitting master becomes
//     the parent), a noble pair of a city (its noble House's estates in the
//     Estates book, world/estates.js, are the family's));
//   - or the ruler and consort of a realm (kingdom.characterData), the
//     player a prince or princess with a 'blood' claim placed by birth order.
// `couples(world)` lists them (one per walk of life, on the world's own hash
// stream: draws nothing from the shared RNG); `bornTo` makes the player their
// child: a teenager at home, the family's name, culture, tongue and faith,
// brothers and sisters (some already on the roster, some born now), living
// grandparents, aunts and uncles in a town nearby — every one a real
// townsperson bridged to a relationship NPC (Relationships.fromTownsperson;
// a child through the same fields) with a family regard.
//
// Until the player comes of age their parents rule their days. The rules are
// data (data/birth.json `rules`, chosen per station), and they bite:
//   - forbidden actions (taverns, gambling, soldiering, crime) are flagged in
//     the action menu (Parentage.gate ← PlayerActions.getAvailableActions);
//     doing one anyway (Parentage.onAction ← ActionMenu.handleAction) may be
//     seen — always at home, less often far off — and a breach costs the
//     parents' regard and their trust and counts a strike;
//   - grounded: travel beyond home (Parentage.travelCheck ← the map click)
//     and the outings in `grounded.actions` are refused outright;
//   - the end of the day (processDay ← ui/game/endDay.js) checks the curfew,
//     the leash (how far from home without leave), the duties (chores in the
//     family trade — real work paid by the town into the household's purse —,
//     lessons, church), a marriage without consent, pays the allowance out of
//     the parents' own purses, and grows trust on an obedient day;
//   - strikes within a month escalate: grounding, the allowance stopped, sent
//     to live with a relative in another town, disowned (disinherited);
//   - trust lifts rules (curfew, taverns...) and lengthens the leash;
//     permissions asked (leave to travel, to soldier, to court, to go out into
//     the world) are granted on trust, regard and the parents' temper;
//   - it ends at coming of age (a parting gift from their savings), with
//     their blessing, by running away (disowned), or when both are dead
//     (their savings, a noble House's estates, or — first in line — the crown).
//
// `seedTies` gives every other origin its first people: living parents and
// siblings as the backstory allows, friends, acquaintances and a rival in the
// start town, and a court of retainers for landed, noble, royal and guild
// origins (systems/court.js Court.join). Its rolls are hashes too, so the
// shared RNG stream is where it was (scenarios.test).
//
// State: player.parentage (saved; systems/saveLoad.js). Content: data/birth.json.

import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Dawn } from '../world/dawn.js';
import { Cultures } from '../world/cultures.js';
import { Estates } from '../world/estates.js';
import { Economy } from '../world/economy.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { Relationships } from '../systems/relationships.js';
import { House } from '../systems/house.js';
import { Throne } from '../systems/throne.js';
import { Guilds } from '../systems/guilds.js';
import { LandMarket } from '../systems/landMarket.js';
import { Languages } from '../systems/languages.js';
import { Religion } from '../systems/religion.js';
import { Devotion } from '../systems/devotion.js';
import { Court } from '../systems/court.js';
import { OddJobs } from './oddJobs.js';
import { Names } from '../core/names.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
// (a filled-in phrase may open a sentence: "{parents} heard of it" → "Your father ...")
const _fill = (s, vars) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m))
    .replace(/(^|[.!?]\s+)([a-z])/g, (m, pre, c) => pre + c.toUpperCase());
const _day = world => _num(world && world.day);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const STAT_KEYS = ['strength', 'charisma', 'intelligence', 'faith', 'luck'];
const PARENT_ROLES = ['father', 'mother'];
const STATION_WEIGHT = { farmer: 5, labourer: 4, smith: 2, merchant: 2, guard: 2, priest: 1, guildmaster: 1, noble: 1, royal: 0.5 };

/** A deterministic stream: the world's seed and a tag (never the shared RNG). */
function _rng(world, tag) {
    const seed = (world && world.generationParams && world.generationParams.seed) || 1;
    let s = (Utils.hashStr(`${seed}|parentage|${tag}`) >>> 0) || 1;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}
const _pick = (arr, rng) => (arr && arr.length ? arr[Math.floor(rng() * arr.length)] : null);
const _rint = (lo, hi, rng) => lo + Math.floor(rng() * (Math.max(lo, hi) - lo + 1));
function _shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}
function _hash01(key) {
    return ((Utils.hashStr(key) >>> 0) % 100000) / 100000;
}

/** Living towns: [{ q, r, s }] */
function _towns(world) {
    if (!world || typeof world.getSettlementViews !== 'function') return [];
    const out = [];
    for (const v of world.getSettlementViews()) {
        const t = world.getTile(v.q, v.r);
        if (t && t.settlement && _num(t.settlement.population) > 0) out.push({ q: v.q, r: v.r, s: t.settlement });
    }
    return out;
}
function _dist(world, a, b) {
    return Hex.wrappingDistance(a.q, a.r, b.q, b.r, world.width);
}
function _kingdom(world, kid) {
    if (kid == null || !world) return null;
    return typeof world.getKingdom === 'function' ? world.getKingdom(kid) : (world.kingdoms || []).find(k => k.id === kid) || null;
}

export const Parentage = {
    data() {
        return _obj(DataLoader._gamedata && DataLoader._gamedata.birth) || {};
    },

    station(id) {
        return _obj((Parentage.data().stations || {})[id]);
    },

    /** The stations the New Game screen offers: [{ id, name, icon }]. */
    stationChoices() {
        return Object.entries(Parentage.data().stations || {}).filter(([id, s]) => !id.startsWith('_') && _obj(s))
            .map(([id, s]) => ({ id, name: s.name || id, icon: s.icon || '' }));
    },

    state(player) {
        return player && _obj(player.parentage) ? player.parentage : null;
    },

    /** Is the player under their parents' rule now? */
    active(player) {
        const pa = Parentage.state(player);
        return !!(pa && pa.active);
    },

    // ── The couples ─────────────────────────────────────

    /**
     * Couples the player could be born to, one per walk of life (or several
     * of one station: opts.station), across the world's towns and realms.
     * Deterministic for a world, day and `reroll`; draws nothing from the
     * shared RNG. Seeds the roster of each town it looks in (Townsfolk.seed).
     * @returns {object[]} [{ key, station, name, icon, q, r, town, kingdom, father, mother, kids, line?, guild?, estates?, royal?, means, savings, allowance }]
     */
    couples(world, opts = {}) {
        if (!world || Dawn.isActive(world)) return [];
        const B = Parentage.data();
        const age = Parentage._startAge(opts.age);
        const day = _day(world);
        const rng = _rng(world, `couples|${day}|${_num(opts.reroll)}|${opts.station || ''}`);
        const towns = _shuffle(_towns(world), rng);
        const out = [];
        const want = opts.station ? Math.max(1, _num(B.choices, 9)) : 1;
        const used = new Set();
        for (const [sid, st] of Object.entries(B.stations || {})) {
            if (sid.startsWith('_') || !_obj(st)) continue;
            if (opts.station && sid !== opts.station) continue;
            let found = 0;
            if (st.royal) {
                const realms = _shuffle((world.kingdoms || []).filter(k => k && k.isAlive !== false && k.capital), rng);
                for (const k of realms) {
                    if (found >= want) break;
                    const c = Parentage._royalCouple(world, k, age);
                    if (c) { out.push(c); found++; }
                }
                continue;
            }
            for (const t of towns) {
                if (found >= want) break;
                if (Array.isArray(st.towns) && !st.towns.includes(t.s.type)) continue;
                if (!Number.isFinite(t.s.q)) { t.s.q = t.q; t.s.r = t.r; }
                if (st.guild && !Guilds.ensureTown(world, t.s, day)) continue;
                const folk = Townsfolk.seed(t.s, world, { q: t.q, r: t.r });
                if (!folk) continue;
                const pair = Parentage._findPair(folk, st.roles || [], age, day, rng, p => used.has(`${t.q},${t.r}#${p.id}`));
                if (!pair) continue;
                for (const p of pair) used.add(`${t.q},${t.r}#${p.id}`);
                out.push(Parentage._describe(world, sid, st, t, folk, pair, age, rng));
                found++;
            }
        }
        return out;
    },

    /** The weighted pick of "whoever's child": common folk far likelier than lords. */
    randomCouple(world, opts = {}) {
        const list = Parentage.couples(world, opts);
        if (!list.length) return null;
        const rng = _rng(world, `random|${_day(world)}|${_num(opts.reroll)}|${_num(opts.salt)}`);
        const W = Parentage.data().weights || STATION_WEIGHT;
        const w = list.map(c => Math.max(0.01, _num(W[c.station], 1)));
        let roll = rng() * w.reduce((a, b) => a + b, 0);
        for (let i = 0; i < list.length; i++) { roll -= w[i]; if (roll <= 0) return list[i]; }
        return list[list.length - 1];
    },

    _startAge(age) {
        const B = Parentage.data();
        const come = _num(B.comeOfAge, 16);
        const a = Math.floor(_num(age != null && age !== '' ? Number(age) : NaN, _num(B.startAge, 14)));
        return _clamp(a, 8, come - 1);
    },

    /** A man and a woman of a roster to be the player's parents: wed already, else a match of the right ages. */
    _findPair(folk, roles, startAge, day, rng, taken = () => false) {
        const B = Parentage.data();
        const MA = B.motherAgeAtBirth || { min: 18, max: 34 };
        const FA = B.fatherAgeAtBirth || { min: 19, max: 44 };
        const age = p => Townsfolk.age(p, day);
        const okM = p => p.gender === 'female' && age(p) - startAge >= MA.min && age(p) - startAge <= MA.max;
        const okF = p => p.gender === 'male' && age(p) - startAge >= FA.min && age(p) - startAge <= FA.max;
        const res = Townsfolk.residents(folk).filter(p => p.role !== 'child' && p.role !== 'beggar' && p.rnpc == null && !taken(p));
        const fits = (f, m) => roles.includes(f.role) || roles.includes(m.role);
        const wed = [];
        for (const f of res) {
            if (!okF(f) || f.spouse == null) continue;
            const m = Townsfolk.get(folk, f.spouse);
            if (m && Townsfolk.isHere(m) && okM(m) && m.rnpc == null && !taken(m) && fits(f, m)) wed.push([f, m]);
        }
        if (wed.length) return _pick(wed, rng);
        const men = res.filter(p => okF(p) && p.spouse == null);
        const women = res.filter(p => okM(p) && p.spouse == null);
        const pairs = [];
        for (const f of men) for (const m of women) if (fits(f, m)) pairs.push([f, m]);
        // (the father of the trade first: the household takes his trade)
        const lead = pairs.filter(([f]) => roles.includes(f.role));
        return _pick(lead.length ? lead : pairs, rng);
    },

    _describe(world, sid, st, t, folk, [f, m], startAge, rng) {
        const day = _day(world);
        const k = _kingdom(world, t.s.kingdom);
        const kids = (f.kids || []).map(id => Townsfolk.get(folk, id)).filter(c => c && c.died == null && (c.parents || []).includes(m.id));
        const c = {
            key: `${t.q},${t.r}#${f.id}+${m.id}`, station: sid, name: st.name || sid, icon: st.icon || '',
            q: t.q, r: t.r, town: t.s.name, townType: t.s.type, kingdom: k ? k.name : null, kingdomId: k ? k.id : null,
            culture: Cultures.cultureOf(world, t.s),
            father: { id: f.id, first: f.first, last: f.last, age: Townsfolk.age(f, day), title: Townsfolk.roleTitle(f) },
            mother: { id: m.id, first: m.first, last: m.last, age: Townsfolk.age(m, day), title: Townsfolk.roleTitle(m) },
            wed: f.spouse === m.id, kids: kids.length, family: f.last,
            savings: _num(st.savings), allowance: _num(st.allowance), purse: _num(st.purse), means: st.means || '', age: startAge,
        };
        if (st.guild) {
            const gids = Object.keys(t.s.guilds || {}).filter(gid => Guilds.def(gid));
            const withGoods = gids.filter(gid => (Guilds.def(gid).goods || []).length);
            const gid = _pick(withGoods.length ? withGoods : gids, rng);
            const g = gid ? Guilds.guild(t.s, gid) : null;
            if (g) c.guild = { gid, name: g.name || Guilds.def(gid).name };
        }
        if (st.estates && Estates.enabled()) {
            Estates.derive(world, day);
            const holders = [...new Set(Estates.estatesOf(world, t.q, t.r).map(e => e.holder).filter(h => Estates.kindOf(h) === 'noble'))].sort();
            const h = holders.length ? holders[0] : null;
            if (h) {
                const name = Estates.ensureHolder(world, h).name;
                c.estates = { holder: h, name, count: Estates.heldBy(world, h).length };
                c.family = String(name).replace(/^House\s+/i, '');
            }
        }
        return c;
    },

    _royalCouple(world, k, startAge) {
        const data = k.characterData;
        const ruler = data && data.ruler;
        const sp = data && data.spouse;
        if (!ruler || ruler.isAlive === false || ruler.isPlayer || !sp || sp.isAlive === false) return null;
        const father = ruler.gender === 'female' ? sp : ruler;
        const mother = father === ruler ? sp : ruler;
        if (father.gender === mother.gender) return null;
        if (_num(mother.age) - startAge < 16 || _num(mother.age) - startAge > 44 || _num(father.age) - startAge < 17) return null;
        const cap = world.getTile(k.capital.q, k.capital.r);
        if (!cap || !cap.settlement) return null;
        const kids = (data.children || []).filter(c => c && c.isAlive !== false);
        const elder = kids.filter(c => _num(c.age) > startAge).length;
        const st = Parentage.station('royal') || {};
        return {
            key: `royal:${k.id}`, station: 'royal', name: `${st.name || 'The royal family'} of ${Names.realm(k.name)}`, icon: st.icon || '👑',
            q: k.capital.q, r: k.capital.r, town: cap.settlement.name, townType: cap.settlement.type, kingdom: k.name, kingdomId: k.id,
            culture: k.culture || Cultures.cultureOf(world, cap.settlement),
            father: { id: father.id, first: father.firstName, last: father.dynasty, age: _num(father.age), title: father === ruler ? 'the monarch' : 'consort' },
            mother: { id: mother.id, first: mother.firstName, last: mother.dynasty, age: _num(mother.age), title: mother === ruler ? 'the monarch' : 'consort' },
            wed: true, kids: kids.length, line: elder + 1, family: (data.dynasty && data.dynasty.name) || father.dynasty,
            royal: { kid: k.id, fatherId: father.id, motherId: mother.id },
            savings: 0, allowance: _num(st.allowance), purse: _num(st.purse), means: st.means || '', age: startAge,
        };
    },

    // ── Born ────────────────────────────────────────────

    /**
     * The 'born' origin (Scenarios.apply): opts.parents = 'choose' (the
     * picker opens once the world is up: player.parentage.pending), 'random',
     * or a station id; opts.age the starting age. → { line } for the welcome.
     */
    startBorn(player, world, opts = {}) {
        const B = Parentage.data();
        const age = Parentage._startAge(opts.age);
        const mode = opts.parents || 'choose';
        if (mode === 'choose') {
            player.parentage = { v: 1, pending: true, active: true, age };
            return { pending: true, line: (B.lines || {}).welcomePending || 'Choose your parents.' };
        }
        const couple = mode === 'random' || !Parentage.station(mode)
            ? Parentage.randomCouple(world, { age })
            : Parentage.randomCouple(world, { age, station: mode }) || Parentage.randomCouple(world, { age });
        if (!couple) return { line: null };
        const res = Parentage.bornTo(player, world, couple, { age });
        return { line: res.success ? res.line : null, couple };
    },

    /**
     * Become the child of `couple` (from couples()). → { success, line, kin } |
     * { success:false, reason }.
     */
    bornTo(player, world, couple, opts = {}) {
        if (!player || !world || !couple) return { success: false, reason: 'No one to be born to.' };
        const B = Parentage.data();
        const st = Parentage.station(couple.station);
        if (!st) return { success: false, reason: 'No such family.' };
        const age = Parentage._startAge(opts.age != null ? opts.age : couple.age);
        if (st.royal) return Parentage._bornRoyal(player, world, couple, st, age);

        const day = _day(world);
        const Y = Townsfolk.config().daysPerYear;
        const tile = world.getTile(couple.q, couple.r);
        const s = tile && tile.settlement;
        const folk = s ? Townsfolk.seed(s, world, { q: couple.q, r: couple.r }) : null;
        const f = folk ? Townsfolk.get(folk, couple.father.id) : null;
        const m = folk ? Townsfolk.get(folk, couple.mother.id) : null;
        if (!f || !m || !Townsfolk.isHere(f) || !Townsfolk.isHere(m)) return { success: false, reason: 'They are no longer there.' };
        const rng = _rng(world, `born|${couple.key}|${day}`);

        // Wed years ago, if the roster had not yet seen to it
        if (f.spouse !== m.id) Townsfolk._wed(folk, f, m, day - (age + 1 + _rint(0, 4, rng)) * Y, true);
        // A noble House's name (its estates are the family's)
        if (couple.estates && couple.family) {
            m.maiden = m.maiden || m.last;
            f.last = couple.family;
            m.last = couple.family;
            for (const id of f.kids || []) { const kid = Townsfolk.get(folk, id); if (kid && kid.died == null) kid.last = couple.family; }
        }
        // The guild's sitting master is your father (Guilds reads g.master)
        if (couple.guild) {
            const g = Guilds.guild(s, couple.guild.gid);
            if (g) g.master = { name: `${f.first} ${f.last}`, player: false };
        }

        Parentage._makeChild(player, world, { last: f.last, age, q: couple.q, r: couple.r, rng });
        couple = { ...couple, father: { ...couple.father, last: f.last }, mother: { ...couple.mother, last: m.last } };
        const kin = [];
        const regard = B.regard || {};
        const bridge = (p, role) => {
            const npc = Parentage._bridge(player, world, folk, p, s, role, _num(regard[role], 40));
            if (npc) kin.push(npc.id);
            return npc;
        };
        const fN = bridge(f, 'father');
        const mN = bridge(m, 'mother');

        // Brothers and sisters: the couple's children on the roster, and some born now
        const sibs = (f.kids || []).map(id => Townsfolk.get(folk, id)).filter(c => c && c.died == null && (c.parents || []).includes(m.id));
        const S = B.siblings || {};
        const spread = _num(S.spreadYears, 9);
        const more = Math.max(0, _rint(_num(S.min, 1), _num(S.max, 3), rng) - sibs.length);
        const mAge = Townsfolk.age(m, day);
        for (let i = 0; i < more; i++) {
            let a = age + _rint(-spread, spread, rng);
            if (a === age) a += rng() < 0.5 ? -1 : 1;
            a = _clamp(a, 0, mAge - 17);
            if (mAge - a > 44) continue;
            const kid = Townsfolk._born(folk, m, f, day, rng, true);
            kid.born = day - a * Y - Math.floor(rng() * Y);
            if (a >= Townsfolk.config().comeOfAge) kid.role = rng() < 0.6 && f.role !== 'noble' ? f.role : (f.role === 'noble' ? 'noble' : 'villager');
            sibs.push(kid);
        }
        for (const sib of sibs) bridge(sib, sib.gender === 'female' ? 'sister' : 'brother');

        // Grandparents (on the same roster) and aunts and uncles (in a town nearby)
        const G = B.grandparents || {};
        let gps = 0;
        for (const par of [f, m]) {
            if (gps >= _num(G.max, 2) || rng() >= _num(G.chance, 0.6)) continue;
            const pa = Townsfolk.age(par, day);
            const ga = pa + _rint(19, 32, rng);
            if (ga > _num(G.maxAge, 79)) continue;
            const gender = rng() < 0.5 ? 'male' : 'female';
            const gp = Parentage._addPerson(folk, { gender, last: par === m ? (m.maiden || m.last) : f.last, age: ga, day, rng, role: 'villager', retired: par.role === 'child' ? null : par.role });
            gp.kids.push(par.id);
            par.parents = (par.parents || []).concat(gp.id);
            bridge(gp, gender === 'female' ? 'grandmother' : 'grandfather');
            gps++;
        }
        const AU = B.auntsUncles || {};
        const nAU = _rint(_num(AU.min, 0), _num(AU.max, 2), rng);
        const near = _towns(world).filter(t => t.s !== s && _dist(world, t, couple) >= 2 && _dist(world, t, couple) <= 12)
            .sort((a, b) => _dist(world, a, couple) - _dist(world, b, couple));
        for (let i = 0; i < nAU; i++) {
            const at = near.length ? near[Math.min(near.length - 1, Math.floor(rng() * Math.min(3, near.length)))] : { q: couple.q, r: couple.r, s };
            if (!Number.isFinite(at.s.q)) { at.s.q = at.q; at.s.r = at.r; }
            const afolk = at.s === s ? folk : Townsfolk.seed(at.s, world, { q: at.q, r: at.r });
            if (!afolk) continue;
            const par = rng() < 0.5 ? f : m;
            const gender = rng() < 0.5 ? 'male' : 'female';
            const a = _clamp(Townsfolk.age(par, day) + _rint(-8, 8, rng), 18, 75);
            const au = Parentage._addPerson(afolk, { gender, last: par === m ? (m.maiden || m.last) : f.last, age: a, day, rng, role: _pick(['villager', 'farmer', 'merchant'], rng) });
            const npc = Parentage._bridge(player, world, afolk, au, at.s, gender === 'female' ? 'aunt' : 'uncle', _num(regard[gender === 'female' ? 'aunt' : 'uncle'], 25));
            if (npc) kin.push(npc.id);
        }

        // Of their culture, tongue and faith; known to their realm
        const culture = Cultures.cultureOf(world, s);
        Parentage._raisedIn(player, world, culture, s.kingdom);

        // The household's savings: the town's coin they have earned and kept
        const savings = Math.round(Economy.drawTown(s, _num(st.savings)));
        Townsfolk.purse(folk, f, world);
        f.purse = _num(f.purse) + savings;

        // Station: pocket money, training, standing
        Parentage._station(player, world, st, s.kingdom);
        const childWord = Parentage._childWord(player);
        player.title = `${childWord[0].toUpperCase()}${childWord.slice(1)} of ${f.first} ${f.last}`;

        // A noble family's estates and name
        let estates = null;
        if (couple.estates) estates = { holder: couple.estates.holder, name: couple.estates.name };

        player.parentage = Parentage._blank(player, world, {
            station: couple.station, home: { q: couple.q, r: couple.r, name: s.name }, kid: s.kingdom != null ? s.kingdom : null,
            father: fN ? fN.id : null, mother: mN ? mN.id : null, kin, folk: { q: couple.q, r: couple.r, f: f.id, m: m.id },
            temper: Parentage._temper([f, m]), age, guild: couple.guild || null, estates,
        });
        Parentage.seedTies(player, world, 'born');
        if (typeof Relationships.prepareForSave === 'function') Relationships.prepareForSave(player);
        return { success: true, line: Parentage.welcome(player, world, couple), kin };
    },

    /** A prince or princess: the ruler and consort's child, the royal brothers and sisters, a claim by birth order. */
    _bornRoyal(player, world, couple, st, age) {
        const B = Parentage.data();
        const k = _kingdom(world, couple.royal.kid);
        const data = k && k.characterData;
        if (!data) return { success: false, reason: 'That realm is gone.' };
        const find = id => [data.ruler, data.spouse, ...(data.children || [])].find(c => c && c.id === id) || null;
        const fc = find(couple.royal.fatherId);
        const mc = find(couple.royal.motherId);
        if (!fc || !mc || fc.isAlive === false || mc.isAlive === false) return { success: false, reason: 'They are no longer living.' };
        const day = _day(world);
        const rng = _rng(world, `royal|${k.id}|${day}`);
        const last = (data.dynasty && data.dynasty.name) || fc.dynasty || '';
        Parentage._makeChild(player, world, { last, age, q: couple.q, r: couple.r, rng });
        const regard = B.regard || {};
        const kin = [];
        const cap = world.getTile(couple.q, couple.r);
        const fN = Parentage._npcFromChar(player, world, fc, k, cap, 'father', _num(regard.father, 55));
        const mN = Parentage._npcFromChar(player, world, mc, k, cap, 'mother', _num(regard.mother, 62));
        kin.push(fN.id, mN.id);
        const sibs = (data.children || []).filter(c => c && c.isAlive !== false);
        for (const c of sibs) {
            const role = c.gender === 'female' ? 'sister' : 'brother';
            kin.push(Parentage._npcFromChar(player, world, c, k, cap, role, _num(regard[role], 35)).id);
        }
        Parentage._raisedIn(player, world, k.culture || couple.culture, k.id);
        // Pocket money from the royal purse (the treasury)
        const want = _num(st.purse);
        const paid = Math.min(want, Math.max(0, Math.floor(_num(k.treasury))));
        k.treasury = _num(k.treasury) - paid;
        Parentage._station(player, world, st, k.id, paid);
        // In the line of succession, behind the elder children
        const elder = sibs.filter(c => _num(c.age) > age).length;
        const claim = Math.max(_num(st.claimMin, 15), _num(st.claim, 55) - elder * _num(st.claimPerElder, 12));
        Throne.grantClaim(player, world, k.id, 'blood', claim);
        player.title = `${player.gender === 'female' ? 'Princess' : 'Prince'} of ${Names.realm(k.name)}`;
        player.allegiance = k.id;
        player.parentage = Parentage._blank(player, world, {
            station: 'royal', home: { q: couple.q, r: couple.r, name: cap.settlement.name }, kid: k.id,
            father: fN.id, mother: mN.id, kin, temper: 'fair', age,
            royal: { kid: k.id, fatherId: fc.id, motherId: mc.id, rulerId: data.ruler ? data.ruler.id : null, line: elder + 1, claim },
        });
        Parentage.seedTies(player, world, 'born');
        if (typeof Relationships.prepareForSave === 'function') Relationships.prepareForSave(player);
        return { success: true, line: Parentage.welcome(player, world, couple), kin };
    },

    _blank(player, world, o) {
        const B = Parentage.data();
        const day = _day(world);
        return {
            v: 1, active: true, pending: false, startDay: day, gen: player.house ? _num(player.house.generation, 1) : 1,
            station: o.station, home: o.home, kid: o.kid, father: o.father, mother: o.mother, kin: o.kin || [],
            folk: o.folk || null, temper: o.temper || 'fair', age: o.age,
            guild: o.guild || null, estates: o.estates || null, royal: o.royal || null,
            trust: _num((B.trust || {}).start, 30),
            strikes: [], steps: {}, log: [], defied: 0, obeyed: 0,
            duties: { chore: day, lessons: day, church: day },
            lastRoam: -999, grounded: null, cut: null, leave: null, sentTo: null,
            permissions: {}, asked: {}, allowanceDay: day, householdDay: day,
            wedNoted: false, disinherited: false, ended: null,
        };
    },

    /** The new life itself: a child's name, age and place (the House takes the family's name). */
    _makeChild(player, world, o) {
        const Y = Townsfolk.config().daysPerYear;
        const day = _day(world);
        player.age = o.age;
        player.birthDay = day - o.age * Y - Math.floor(o.rng() * Y);
        if (o.last) {
            player.lastName = o.last;
            player.name = `${player.firstName} ${o.last}`.trim();
            if (player.dynasty) player.dynasty.name = o.last;
            if (player.house) {
                const old = player.house.name;
                player.house.name = `House ${o.last}`;
                if (Array.isArray(player.house.history)) for (const h of player.house.history) if (h && typeof h.text === 'string') h.text = h.text.replace(old, player.house.name);
            }
        }
        player.q = o.q; player.r = o.r;
        player.prevQ = o.q; player.prevR = o.r;
        player.path = null;
        player.travelDestination = null;
        if (typeof player.revealArea === 'function') player.revealArea(world, 4);
        if (typeof player.discoverNearbyHolySites === 'function') player.discoverNearbyHolySites(world, 4);
        if (typeof player.updateVisibility === 'function') player.updateVisibility(world, 4);
    },

    _raisedIn(player, world, culture, kid) {
        Languages.initialize(player, world, { native: Cultures.languageOfCulture(culture) || null });
        const k = _kingdom(world, kid);
        if (!k) return;
        if (!player.kingdomsVisited) player.kingdomsVisited = [];
        if (!player.kingdomsVisited.includes(k.id)) player.kingdomsVisited.push(k.id);
        if (typeof player.learnAboutKingdom === 'function') player.learnAboutKingdom(k.id, 'basics');
        // The family's faith: the realm's
        const faith = Religion.getKingdomFaith && k.religion ? Religion.getKingdomFaith(k) : null;
        if (faith && faith.id && Devotion.canAdopt(player, world, faith.id).can) Devotion.adoptFaith(player, world, faith.id);
    },

    _station(player, world, st, kid, purse = null) {
        player.gold = Math.max(0, Math.round(purse != null ? purse : _num(st.purse)));
        player.inventory = { bread: 4 };
        for (const [k, v] of Object.entries(_obj(st.stats) || {})) if (STAT_KEYS.includes(k)) player[k] = _num(player[k], 5) + _num(v);
        if (!player.skills) player.skills = {};
        for (const [k, v] of Object.entries(_obj(st.skills) || {})) player.skills[k] = _num(player.skills[k]) + _num(v);
        if (kid != null && player.reputation && _num(st.reputation)) player.reputation[kid] = _num(player.reputation[kid]) + _num(st.reputation);
        if (player.house && _num(st.prestige) > 0) House.award(player.house, _num(st.prestige), 'born of a great family', _day(world));
    },

    _childWord(player) {
        return player && player.gender === 'female' ? 'daughter' : player && player.gender === 'male' ? 'son' : 'child';
    },

    /** The parents' temper, from their traits (data/birth.json temper). */
    _temper(people) {
        const T = Parentage.data().temper || {};
        const traits = people.flatMap(p => (p && p.traits) || []);
        const score = id => traits.filter(t => (T[id] && T[id].traits || []).includes(t)).length;
        const strict = score('strict');
        const lenient = score('lenient');
        return strict > lenient ? 'strict' : lenient > strict ? 'lenient' : 'fair';
    },

    temperOf(pa) {
        const T = Parentage.data().temper || {};
        return { penalty: 1, trust: 1, grant: 1, label: 'fair', ...(T.fair || {}), ...(T[pa && pa.temper] || {}) };
    },

    /** A roster person who was not there before (a grandparent, an aunt), on the town's own roster. */
    _addPerson(folk, o) {
        const Y = Townsfolk.config().daysPerYear;
        const names = Townsfolk._firstNames(folk, o.gender);
        // (no one living there already answering to the same full name; same draws as ever)
        const rFirst = names.length ? o.rng() : null;
        const last = o.last || _pick(Townsfolk._lastNames(folk), o.rng) || 'Stone';
        const p = {
            id: folk.n++,
            first: (rFirst != null ? Townsfolk.freshFirst(folk, o.gender, last, rFirst) : null) || 'Ash',
            last,
            gender: o.gender,
            born: o.day - o.age * Y - Math.floor(o.rng() * Y),
            died: null, cause: null,
            role: o.role || 'villager',
            traits: Townsfolk._traits(o.rng),
            spouse: null, parents: [], kids: [], away: null, log: [],
        };
        if (o.retired && o.age >= Townsfolk.config().retireAge) p.retired = o.retired;
        folk.people.push(p);
        return p;
    },

    /**
     * The relationship NPC for a person (a child too: the bridge's fields,
     * which Relationships._syncOne keeps in step), with a kin role or tie
     * and a regard.
     */
    _bridge(player, world, folk, p, settlement, role, score, tie = null) {
        let npc = Relationships.npcForPerson(folk, p);
        if (!npc) {
            const can = Relationships.canKnow(folk, p, world);
            if (can.ok) {
                const res = Relationships.fromTownsperson(player, world, folk, p, settlement);
                npc = res && res.success ? res.npc : null;
            } else if (p.died == null) {
                npc = Parentage._childNpc(world, folk, p, settlement);
            }
        }
        if (!npc) return null;
        if (settlement && settlement.culture) npc.culture = settlement.culture;
        const rel = Relationships.getRelationship(player, npc.id);
        rel.score = _clamp(Math.round(score), -100, 100);
        if (tie) rel.tie = tie;
        else if (role) { npc.kin = role; rel.family = role; }
        rel.history = rel.history || [];
        rel.history.push({ day: _day(world), action: role ? 'family' : (tie || 'known'), result: role || tie || '' });
        return npc;
    },

    _childNpc(world, folk, p, settlement) {
        const uid = Relationships.folkUid(folk, p);
        const pick = (arr, salt) => arr[Math.floor(_hash01(`${uid}|${salt}`) * arr.length)];
        const npc = {
            id: `rnpc_${Relationships._nextId++}`,
            folkUid: uid,
            firstName: p.first, dynasty: p.last, gender: p.gender,
            age: Townsfolk.age(p, _day(world)),
            culture: (settlement && settlement.culture) || 'Imperial',
            personality: 'gentle',
            settlementName: settlement ? settlement.name : '', settlementQ: folk.q, settlementR: folk.r,
            kingdomId: settlement ? settlement.kingdom || null : null,
            isAlive: true, traits: [],
            appearance: { hair: pick(['dark', 'blonde', 'red', 'brown', 'black'], 'hair'), eyes: pick(['brown', 'blue', 'green', 'grey', 'hazel'], 'eyes'), build: pick(['slim', 'athletic', 'stocky', 'tall', 'sturdy'], 'build') },
            occupation: 'child',
            affection: 0, friendship: 0, attraction: 0, loyalty: 50,
            isMarried: false, isRomantic: false, metDay: _day(world), lastInteraction: _day(world),
        };
        Relationships._npcs.push(npc);
        p.rnpc = npc.id;
        return npc;
    },

    /** A royal (kingdom.characterData) as a relationship NPC, kept in step by processDay. */
    _npcFromChar(player, world, ch, k, capTile, role, score) {
        let npc = Relationships._npcs.find(n => n.charId === ch.id);
        if (!npc) {
            const key = `char|${ch.id}`;
            const pick = (arr, salt) => arr[Math.floor(_hash01(`${key}|${salt}`) * arr.length)];
            npc = {
                id: `rnpc_${Relationships._nextId++}`,
                charId: ch.id, charKingdom: k.id,
                firstName: ch.firstName, dynasty: ch.dynasty, gender: ch.gender, age: _num(ch.age),
                culture: ch.culture || k.culture || 'Imperial', personality: 'stoic',
                settlementName: capTile && capTile.settlement ? capTile.settlement.name : k.name,
                settlementQ: k.capital.q, settlementR: k.capital.r, kingdomId: k.id,
                isAlive: ch.isAlive !== false, traits: [],
                appearance: { hair: pick(['dark', 'blonde', 'red', 'brown', 'black'], 'hair'), eyes: pick(['brown', 'blue', 'green', 'grey', 'hazel'], 'eyes'), build: pick(['slim', 'athletic', 'tall'], 'build') },
                occupation: 'noble', affection: 0, friendship: 0, attraction: 0, loyalty: 60,
                isMarried: !!ch.spouseId, isRomantic: false, metDay: _day(world), lastInteraction: _day(world),
            };
            Relationships._npcs.push(npc);
        }
        npc.kin = role;
        const rel = Relationships.getRelationship(player, npc.id);
        rel.score = _clamp(Math.round(score), -100, 100);
        rel.family = role;
        return npc;
    },

    /** "brothers Tor and Ulf, and a sister, Una" — the living siblings for a welcome line. */
    welcome(player, world, couple) {
        const B = Parentage.data();
        const pa = Parentage.state(player);
        const sibs = Parentage.kin(player, world).filter(x => x.role === 'brother' || x.role === 'sister').filter(x => x.alive);
        const sibLine = sibs.length
            ? `You have ${sibs.length === 1 ? `a ${sibs[0].role}, ${sibs[0].name}` : `${sibs.length} brothers and sisters (${sibs.map(x => x.first).join(', ')})`}. `
            : 'You are their only child. ';
        const st = Parentage.station(couple.station) || {};
        return _fill((B.lines || {}).welcome, {
            name: player.name, age: player.age, childWord: Parentage._childWord(player),
            father: `${couple.father.first} ${couple.father.last || ''}`.trim(), mother: `${couple.mother.first} ${couple.mother.last || ''}`.trim(),
            station: (st.name || '').replace(/^An? /i, 'of a ').replace(/^The /i, 'of the ').toLowerCase(),
            town: couple.town, realm: couple.kingdom ? `, in ${couple.kingdom}` : '',
            siblingsLine: sibLine, means: couple.means || '', comeOfAge: _num(B.comeOfAge, 16),
        }) + (pa && pa.royal ? ` You are ${Parentage._ordinal(pa.royal.line)} in the line of succession.` : '');
    },

    _ordinal(n) {
        const s = ['th', 'st', 'nd', 'rd'];
        const v = n % 100;
        return n + (s[(v - 20) % 10] || s[v] || s[0]);
    },

    /** The player's kin: [{ id, role, name, first, age, alive, score, town }] */
    kin(player, world) {
        const pa = Parentage.state(player);
        if (!pa) return [];
        const out = [];
        for (const id of [pa.father, pa.mother, ...(pa.kin || [])]) {
            if (!id || out.some(x => x.id === id)) continue;
            const npc = Relationships.getNPC ? Relationships.getNPC(id) : Relationships._npcs.find(n => n.id === id);
            if (!npc) continue;
            const rel = player.relationships && player.relationships[id];
            out.push({
                id, role: npc.kin || 'kin', first: npc.firstName, name: `${npc.firstName} ${npc.dynasty || ''}`.trim(),
                age: _num(npc.age), alive: npc.isAlive !== false, score: rel ? _num(rel.score) : 0, town: npc.settlementName || '',
            });
        }
        return out;
    },

    _parents(player) {
        const pa = Parentage.state(player);
        if (!pa) return [];
        return [pa.father, pa.mother].map(id => id && Relationships._npcs.find(n => n.id === id)).filter(n => n && n.isAlive !== false);
    },

    /** "your father Brom and your mother Ada" (the living ones). */
    parentsLine(player) {
        const ps = Parentage._parents(player);
        if (!ps.length) return 'your family';
        const one = n => `your ${n.kin === 'mother' ? 'mother' : 'father'} ${n.firstName}`;
        return ps.length === 1 ? one(ps[0]) : `${one(ps[0])} and ${one(ps[1])}`;
    },

    /** Their regard for you, the average over the living parents. */
    regard(player) {
        const ps = Parentage._parents(player);
        if (!ps.length) return 0;
        return Math.round(ps.reduce((a, n) => a + _num((player.relationships[n.id] || {}).score), 0) / ps.length);
    },

    _adjustRegard(player, by) {
        for (const n of Parentage._parents(player)) {
            const rel = Relationships.getRelationship(player, n.id);
            rel.score = _clamp(Math.round(_num(rel.score) + by), -100, 100);
        }
    },

    // ── The rules ───────────────────────────────────────

    rules(player) {
        const pa = Parentage.state(player);
        const st = pa && Parentage.station(pa.station);
        const R = Parentage.data().rules || {};
        return ((st && st.rules) || []).filter(id => _obj(R[id])).map(id => ({ id, ...R[id] }));
    },

    /** Is this rule in force now? (trust lifts some, leave given lifts others) */
    ruleActive(player, id) {
        const pa = Parentage.state(player);
        if (!pa || !pa.active || pa.pending) return false;
        const rule = Parentage.rules(player).find(r => r.id === id);
        if (!rule) return false;
        if (rule.permission && pa.permissions[rule.permission] != null) return false;
        if (rule.lift != null && _num(pa.trust) >= _num(rule.lift)) return false;
        return true;
    },

    ruleStatus(player, id) {
        const pa = Parentage.state(player);
        const rule = Parentage.rules(player).find(r => r.id === id);
        if (!pa || !rule) return 'none';
        if (rule.permission && pa.permissions[rule.permission] != null) return 'permitted';
        if (rule.lift != null && _num(pa.trust) >= _num(rule.lift)) return 'lifted';
        return 'active';
    },

    /** How far from home the player may go (leagues): the station's leash, widened by trust or a leave. */
    roamRadius(player, world) {
        const pa = Parentage.state(player);
        if (!pa) return Infinity;
        if (pa.leave && pa.leave.until >= _day(world)) return _num(pa.leave.radius, 12);
        const st = Parentage.station(pa.station) || {};
        const rule = (Parentage.data().rules || {}).roam || {};
        let r = _num(st.roam, 3);
        let bonus = 0;
        for (const [t, b] of rule.widen || []) if (_num(pa.trust) >= t) bonus = Math.max(bonus, b);
        return r + bonus;
    },

    grounded(player, world) {
        const pa = Parentage.state(player);
        return !!(pa && pa.active && pa.grounded && pa.grounded.until >= _day(world));
    },

    _atHome(player, world) {
        const pa = Parentage.state(player);
        return !!(pa && pa.home && player.q === pa.home.q && player.r === pa.home.r);
    },

    /** What a breach of this rule would cost (for the menu's warning). */
    consequence(player, id) {
        const pa = Parentage.state(player);
        const rule = Parentage.rules(player).find(r => r.id === id);
        if (!pa || !rule) return '';
        const T = Parentage.temperOf(pa);
        const b = rule.breach || {};
        const parts = [];
        if (b.regard) parts.push(`their regard ${Math.round(b.regard * T.penalty)}`);
        if (b.trust) parts.push(`trust ${Math.round(b.trust * T.penalty)}`);
        const next = Parentage._nextStep(player, _num(b.strike, 1));
        if (next) parts.push(next);
        return parts.join(', ');
    },

    _recentStrikes(pa, day) {
        const W = _num((Parentage.data().escalation || {}).window, 30);
        return (pa.strikes || []).filter(s => day - s.d <= W).reduce((a, s) => a + _num(s.n, 1), 0);
    },

    _nextStep(player, add) {
        const pa = Parentage.state(player);
        const E = Parentage.data().escalation || {};
        const now = Parentage._recentStrikes(pa, pa._today != null ? pa._today : 0);
        const step = (E.steps || []).filter(s => now + add >= s.strikes && now < s.strikes).pop();
        if (!step) return '';
        if (step.ground) return `grounded ${step.ground} days`;
        if (step.cut) return 'allowance stopped';
        if (step.sendAway) return 'sent away to a relative';
        if (step.disinherit) return 'disowned';
        return '';
    },

    /**
     * What the parents say to an action now: { refused, text } (grounded),
     * { defy, rule, text } (forbidden: doing it anyway is defiance), or null.
     */
    check(player, world, type) {
        const pa = Parentage.state(player);
        if (!pa || !pa.active || pa.pending) return null;
        const B = Parentage.data();
        pa._today = _day(world);
        if (Parentage.grounded(player, world) && ((B.grounded || {}).actions || []).includes(type)) {
            return { refused: true, text: _fill((B.grounded || {}).text, { days: pa.grounded.until - _day(world) + 1 }) };
        }
        for (const rule of Parentage.rules(player)) {
            if (rule.kind !== 'forbid' || !(rule.actions || []).includes(type)) continue;
            if (!Parentage.ruleActive(player, rule.id)) continue;
            if (Parentage.grounded(player, world)) return { refused: true, text: _fill((B.grounded || {}).text, { days: pa.grounded.until - _day(world) + 1 }) + ` (${rule.name.toLowerCase()})` };
            return { defy: true, rule: rule.id, text: _fill((B.lines || {}).defy, { consequence: Parentage.consequence(player, rule.id) || 'their anger' }) };
        }
        return null;
    },

    /**
     * Flag the action menu: forbidden actions carry the warning, refused ones
     * are greyed with the reason; the family's own rows go at the top.
     * (PlayerActions.getAvailableActions)
     */
    gate(player, world, tile, actions) {
        const pa = Parentage.state(player);
        if (!pa || !Array.isArray(actions)) return actions;
        if (pa.active) {
            for (const a of actions) {
                const c = Parentage.check(player, world, a.type);
                if (!c) continue;
                if (c.refused) { a.disabled = true; a.reason = c.text; } else if (c.defy) { a.description = `⚠️ ${c.text}`; a.defies = c.rule; }
            }
        }
        if (pa.pending) {
            actions.unshift({ type: 'your_parents', label: 'Choose Your Parents', icon: '🏡', description: 'You are yet to be born: choose the family you are born to.', notice: 'Choose your parents' });
        } else if (pa.active || (pa.ended && Parentage.kin(player, world).some(x => x.alive))) {
            const due = pa.active ? Parentage.dutiesDue(player, world).filter(d => d.overdue || d.dueIn <= 0) : [];
            actions.unshift({
                type: 'your_parents', label: pa.active ? 'Your Parents' : 'Your Family', icon: '🏡',
                description: pa.active ? `Trust ${Math.round(pa.trust)} · their rules, your duties, asking leave` : 'Your family and how they stand with you',
                notice: due.length ? `${due[0].label} is due` : null,
            });
        }
        return actions;
    },

    /**
     * An action taken (ActionMenu.handleAction, before it runs): refused when
     * grounded; when forbidden it is defiance, and they may hear of it.
     * → null | { refused, text } | { defied, caught, text }
     */
    onAction(player, world, type, opts = {}) {
        const c = Parentage.check(player, world, type);
        if (!c) return null;
        if (c.refused) return { refused: true, text: c.text };
        const C = Parentage.data().caught || {};
        const pa = Parentage.state(player);
        const d = _dist(world, player, pa.home);
        const chance = d === 0 ? _num(C.home, 1) : d <= Parentage.roamRadius(player, world) ? _num(C.near, 0.6) : _num(C.far, 0.3);
        const roll = opts.roll != null ? opts.roll : Utils.random();
        if (roll < chance) {
            const out = { notices: [] };
            Parentage._breach(player, world, c.rule, out);
            return { defied: true, caught: true, text: out.notices.map(n => n.text).join(' ') };
        }
        pa.secrets = _num(pa.secrets) + 1;
        Parentage._log(pa, world, `You defied them (${c.rule}) and no one told them.`);
        return { defied: true, caught: false, text: 'You did it anyway. No one who knows your parents saw you, this time.' };
    },

    /** The map click: grounded keeps you home; beyond the leash is defiance (warned). → null | { refused, text } | { warn, text } */
    travelCheck(player, world, q, r) {
        const pa = Parentage.state(player);
        if (!pa || !pa.active || pa.pending || !pa.home) return null;
        if (Parentage.grounded(player, world) && !(q === pa.home.q && r === pa.home.r)) {
            return { refused: true, text: `You are grounded: ${Parentage.parentsLine(player)} will not let you out for ${pa.grounded.until - _day(world) + 1} more days.` };
        }
        if (Parentage.ruleActive(player, 'roam') && _dist(world, { q, r }, pa.home) > Parentage.roamRadius(player, world)) {
            return { warn: true, text: `That is further than your parents let you go (${Parentage.roamRadius(player, world)} leagues from ${pa.home.name}). Going is defiance: ${Parentage.consequence(player, 'roam')}. Ask leave to travel first.` };
        }
        return null;
    },

    _log(pa, world, text) {
        pa.log = pa.log || [];
        pa.log.unshift({ d: _day(world), text });
        if (pa.log.length > 30) pa.log.length = 30;
    },

    /** A rule broken and found out: regard, trust, a strike, and what follows. */
    _breach(player, world, ruleId, out) {
        const pa = Parentage.state(player);
        const rule = Parentage.rules(player).find(r => r.id === ruleId) || (Parentage.data().rules || {})[ruleId];
        if (!pa || !rule) return;
        const day = _day(world);
        const T = Parentage.temperOf(pa);
        const b = rule.breach || {};
        Parentage._adjustRegard(player, _num(b.regard) * T.penalty);
        pa.trust = _clamp(_num(pa.trust) + _num(b.trust) * T.penalty, 0, _num((Parentage.data().trust || {}).max, 100));
        pa.strikes.push({ d: day, n: _num(b.strike, 1), rule: ruleId });
        pa.defied = _num(pa.defied) + 1;
        pa.lastBreach = day;
        const text = _fill(rule.text, { parents: Parentage.parentsLine(player) });
        Parentage._log(pa, world, text);
        out.notices.push({ icon: '😠', title: 'Your Parents', text, type: 'warning' });
        Parentage._escalate(player, world, out);
    },

    _escalate(player, world, out) {
        const pa = Parentage.state(player);
        const E = Parentage.data().escalation || {};
        const day = _day(world);
        const W = _num(E.window, 30);
        const now = Parentage._recentStrikes(pa, day);
        const steps = E.steps || [];
        // Every step the count has reached and not met within the window, in order
        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            if (now < step.strikes) break;
            if (pa.steps[i] != null && day - pa.steps[i] <= W) continue;
            if (step.trustBelow != null && _num(pa.trust) >= step.trustBelow) continue;
            pa.steps[i] = day;
            const vars = { parents: Parentage.parentsLine(player), days: step.ground || step.cut || 0 };
            if (step.ground) pa.grounded = { until: Math.max(day + step.ground, pa.grounded ? pa.grounded.until : 0), since: day };
            if (step.cut) pa.cut = { until: day + step.cut };
            if (step.disinherit) {
                const text = _fill(step.text, vars);
                Parentage._log(pa, world, text);
                out.notices.push({ icon: '🚪', title: 'Disowned', text, type: 'error' });
                Parentage._disinherit(player, world);
                Parentage.end(player, world, 'disowned', out);
                return;
            }
            if (step.sendAway) {
                const sent = Parentage._sendAway(player, world);
                if (!sent) {
                    pa.grounded = { until: day + 10, since: day };
                    const t = 'There is no one to send you to: you are grounded for 10 days instead.';
                    Parentage._log(pa, world, t);
                    out.notices.push({ icon: '🔒', title: 'Your Parents', text: t, type: 'error' });
                    continue;
                }
                Object.assign(vars, sent);
            }
            const text = _fill(step.text, vars);
            Parentage._log(pa, world, text);
            out.notices.push({ icon: step.sendAway ? '🎒' : '🔒', title: 'Your Parents', text, type: 'error' });
            // Sent away: a fresh start under the relative's roof
            if (step.sendAway) return;
        }
    },

    /** Sent to live with a relative in another town: home is theirs now, the slate wiped clean but trust low. */
    _sendAway(player, world) {
        const pa = Parentage.state(player);
        const rel = (pa.kin || []).map(id => Relationships._npcs.find(n => n.id === id))
            .filter(n => n && n.isAlive !== false && ['aunt', 'uncle', 'grandmother', 'grandfather'].includes(n.kin) && Number.isFinite(n.settlementQ)
                && !(n.settlementQ === pa.home.q && n.settlementR === pa.home.r));
        const who = rel[0] || null;
        if (!who) return null;
        const tile = world.getTile(who.settlementQ, who.settlementR);
        if (!tile || !tile.settlement) return null;
        const day = _day(world);
        pa.sentTo = { from: { ...pa.home }, day, npcId: who.id };
        pa.home = { q: who.settlementQ, r: who.settlementR, name: tile.settlement.name };
        pa.strikes = [];
        pa.trust = Math.min(_num(pa.trust), 20);
        pa.grounded = { until: day + 3, since: day };
        player.q = who.settlementQ; player.r = who.settlementR;
        player.prevQ = player.q; player.prevR = player.r;
        player.path = null;
        player.travelDestination = null;
        if (typeof player.revealArea === 'function') player.revealArea(world, 4);
        return { relative: `your ${who.kin} ${who.firstName}`, town: tile.settlement.name };
    },

    /** Disowned: no claim through them, no inheritance. */
    _disinherit(player, world) {
        const pa = Parentage.state(player);
        pa.disinherited = true;
        if (pa.royal) {
            const st = Throne.state(player);
            const c = st.claims && st.claims[pa.royal.kid];
            if (c && c.sources) { delete c.sources.blood; if (!Object.keys(c.sources).length) delete st.claims[pa.royal.kid]; }
        }
    },

    // ── Duties ──────────────────────────────────────────

    /** The duties the rules ask: [{ duty, label, icon, desc, ap, every, dueIn, overdue }] */
    dutiesDue(player, world) {
        const pa = Parentage.state(player);
        if (!pa || !pa.active || pa.pending) return [];
        const out = [];
        for (const rule of Parentage.rules(player)) {
            if (rule.kind !== 'duty') continue;
            const def = Parentage.dutyDef(player, rule.duty);
            if (!def) continue;
            const last = _num(pa.duties[rule.duty], _day(world));
            const dueIn = last + _num(rule.every, 3) - _day(world);
            out.push({ duty: rule.duty, rule: rule.id, label: def.label, icon: def.icon, desc: def.desc, ap: _num(def.ap, 3), every: _num(rule.every, 3), dueIn, overdue: dueIn < 0, active: Parentage.ruleActive(player, rule.id), doneToday: last === _day(world) && pa.dutyDone && pa.dutyDone[rule.duty] === _day(world) });
        }
        return out;
    },

    dutyDef(player, duty) {
        const pa = Parentage.state(player);
        const st = pa && Parentage.station(pa.station);
        const B = Parentage.data();
        if (!st) return null;
        if (duty === 'chore') return (B.chores || {})[st.chore] || null;
        if (duty === 'lessons') return st.lessons ? (B.lessons || {})[st.lessons] || null : null;
        if (duty === 'church') return B.church || null;
        return null;
    },

    /** Do a duty at home: AP spent, training, trust, and for chores a day's pay into the household's purse. */
    doDuty(player, world, duty) {
        const pa = Parentage.state(player);
        if (!pa || !pa.active || pa.pending) return { success: false, reason: 'Your parents set you no duties now.' };
        const def = Parentage.dutyDef(player, duty);
        if (!def) return { success: false, reason: 'Not a duty of your house.' };
        if (!Parentage._atHome(player, world)) return { success: false, reason: `Your duties are at home, in ${pa.home.name}.` };
        const day = _day(world);
        pa.dutyDone = pa.dutyDone || {};
        if (pa.dutyDone[duty] === day) return { success: false, reason: 'Done today already.' };
        const ap = _num(def.ap, 3);
        if (_num(player.actionPoints) < ap) return { success: false, reason: `It takes ${ap} AP; you have ${_num(player.actionPoints)}.` };
        player.actionPoints = _num(player.actionPoints) - ap;
        const gains = OddJobs.gainXp(player, def.trains || {}, 2);
        const B = Parentage.data();
        const T = Parentage.temperOf(pa);
        const tr = B.trust || {};
        const gain = duty === 'chore' ? _num(tr.perChore, 2) : duty === 'lessons' ? _num(tr.perLessons, 2) : _num(tr.perChurch, 1.5);
        pa.trust = _clamp(_num(pa.trust) + gain * T.trust, 0, _num(tr.max, 100));
        pa.duties[duty] = day;
        pa.dutyDone[duty] = day;
        pa.obeyed = _num(pa.obeyed) + 1;
        Parentage._adjustRegard(player, 1);
        // The family's work is paid for by the town's people, into the household's purse
        let paid = 0;
        if (duty === 'chore' && _num(def.pay) > 0) {
            const hh = Parentage._household(world, pa);
            if (hh && hh.town) {
                paid = Math.floor(Economy.drawTown(hh.town, _num(def.pay)));
                hh.payee.purse = _num(hh.payee.purse) + paid;
            }
        }
        // Grounded: a good day's work takes a day off it
        if (pa.grounded && pa.grounded.until >= day && duty === 'chore') pa.grounded.until -= 1;
        const text = `${def.label}${paid ? `: ${paid} gold earned for the household` : ''}. ${Parentage.parentsLine(player).replace(/^your/, 'Your')} ${Parentage._parents(player).length > 1 ? 'are' : 'is'} pleased.`;
        Parentage._log(pa, world, text);
        return { success: true, text, gains, paid };
    },

    /** The household's purse: { payee (the roster person who keeps it), town, folk } — or for royals the treasury. */
    _household(world, pa) {
        if (!pa || !pa.folk) return null;
        const tile = world.getTile(pa.folk.q, pa.folk.r);
        const s = tile && tile.settlement;
        const folk = s && s.folk;
        if (!folk) return null;
        const f = Townsfolk.get(folk, pa.folk.f);
        const m = Townsfolk.get(folk, pa.folk.m);
        const payee = f && f.died == null ? f : (m && m.died == null ? m : null);
        if (!payee) return null;
        return { payee, other: payee === f ? m : f, town: s, folk };
    },

    /** The household's savings now (gold). */
    savings(world, player) {
        const pa = Parentage.state(player);
        if (pa && pa.royal) { const k = _kingdom(world, pa.royal.kid); return k ? Math.floor(_num(k.treasury)) : 0; }
        const hh = Parentage._household(world, pa);
        if (!hh) return 0;
        return Math.floor(_num(hh.payee.purse) + (hh.other && hh.other.died == null ? _num(hh.other.purse) : 0));
    },

    _takeSavings(world, pa, want) {
        want = Math.max(0, Math.floor(want));
        if (!want) return 0;
        if (pa.royal) {
            const k = _kingdom(world, pa.royal.kid);
            if (!k) return 0;
            const paid = Math.min(want, Math.max(0, Math.floor(_num(k.treasury))));
            k.treasury = _num(k.treasury) - paid;
            return paid;
        }
        const hh = Parentage._household(world, pa);
        if (!hh) return 0;
        let paid = 0;
        for (const p of [hh.payee, hh.other]) {
            if (!p || p.died != null || paid >= want) continue;
            const take = Math.min(want - paid, Math.max(0, Math.floor(_num(p.purse))));
            p.purse = _num(p.purse) - take;
            paid += take;
        }
        return paid;
    },

    // ── Asking leave ────────────────────────────────────

    /** The odds they agree (0..1) and why not, for the panel. */
    askOdds(player, world, what) {
        const pa = Parentage.state(player);
        const P = (Parentage.data().permissions || {})[what];
        if (!pa || !pa.active || pa.pending || !P) return { can: false, reason: 'There is no one to ask.' };
        const day = _day(world);
        if (P.minAge && _num(player.age) < P.minAge) return { can: false, reason: `Not before you are ${P.minAge}.` };
        if (Parentage.grounded(player, world)) return { can: false, reason: 'Not while you are grounded.' };
        if (pa.asked[what] != null && day - pa.asked[what] < _num(P.cooldown, 5)) return { can: false, reason: `You asked ${day - pa.asked[what]} days ago. Give them time.` };
        if ((what === 'army' || what === 'court') && pa.permissions[what] != null) return { can: false, reason: 'They have already given their blessing.' };
        if (what === 'travel' && pa.leave && pa.leave.until >= day) return { can: false, reason: `You are on leave until day ${pa.leave.until}.` };
        const T = Parentage.temperOf(pa);
        const chance = _clamp((0.5 + (_num(pa.trust) - _num(P.need, 50)) / 40 + (Parentage.regard(player) - 50) / 200) * T.grant, 0.05, 0.95);
        return { can: true, chance };
    },

    /** Ask leave: travel, army, court, apprentice. → { success, granted, text } */
    ask(player, world, what, opts = {}) {
        const odds = Parentage.askOdds(player, world, what);
        if (!odds.can) return { success: false, reason: odds.reason };
        const pa = Parentage.state(player);
        const P = (Parentage.data().permissions || {})[what];
        const L = Parentage.data().lines || {};
        const day = _day(world);
        pa.asked[what] = day;
        const roll = opts.roll != null ? opts.roll : Utils.random();
        const parents = Parentage.parentsLine(player).replace(/^your/, 'Your');
        if (roll >= odds.chance) {
            const why = _num(pa.trust) < _num(P.need, 50) ? 'You have not earned enough of their trust.' : 'Not yet, they say.';
            const text = _fill(L.refused, { parents, why });
            Parentage._log(pa, world, text);
            return { success: true, granted: false, text };
        }
        let what2 = '';
        if (what === 'travel') {
            pa.leave = { until: day + _num(P.days, 10), radius: _num(P.radius, 14), since: day };
            what2 = `You have leave to travel for ${_num(P.days, 10)} days, up to ${_num(P.radius, 14)} leagues from home.`;
        } else if (what === 'apprentice') {
            const text = _fill(L.granted, { parents, what: 'You may go out into the world with their blessing.' });
            Parentage._log(pa, world, text);
            const out = { notices: [] };
            Parentage.end(player, world, 'blessed', out);
            return { success: true, granted: true, text: [text, ...out.notices.map(n => n.text)].join(' ') };
        } else {
            pa.permissions[what] = day;
            what2 = what === 'army' ? 'You may take up arms.' : 'You may court whom you like, and wed with their blessing.';
        }
        const text = _fill(L.granted, { parents, what: what2 });
        Parentage._log(pa, world, text);
        return { success: true, granted: true, text };
    },

    /** Run away from home: free, disowned. */
    runAway(player, world) {
        const pa = Parentage.state(player);
        if (!pa || !pa.active || pa.pending) return { success: false, reason: 'You are your own already.' };
        const R = Parentage.data().runAway || {};
        const text = _fill(R.text, { parents: Parentage.parentsLine(player) });
        Parentage._adjustRegard(player, _num(R.regard, -40));
        if (R.disinherit !== false) Parentage._disinherit(player, world);
        Parentage._log(pa, world, text);
        const out = { notices: [] };
        Parentage.end(player, world, 'ran', out);
        return { success: true, text };
    },

    /** Their rule over you ends. how: 'age' | 'blessed' | 'ran' | 'disowned' | 'orphaned' | 'gone' */
    end(player, world, how, out = { notices: [] }) {
        const pa = Parentage.state(player);
        if (!pa || !pa.active) return out;
        const B = Parentage.data();
        const L = B.lines || {};
        pa.active = false;
        pa.grounded = null;
        pa.leave = null;
        pa.ended = { day: _day(world), how };
        if ((how === 'age' || how === 'blessed') && Parentage.regard(player) >= 20) {
            const gift = Parentage._takeSavings(world, pa, Parentage.savings(world, player) * _num(B.partingGift, 0.15));
            if (gift > 0) player.gold = _num(player.gold) + gift;
            const text = _fill(L.comeOfAge, { age: player.age, parents: Parentage.parentsLine(player).replace(/^your/, 'Your'), gift: gift > 0 ? ` and ${gift} gold from their savings` : '' });
            Parentage._log(pa, world, text);
            if (how === 'age') out.notices.push({ icon: '🎂', title: 'Of Age', text, type: 'success' });
            else out.notices.push({ icon: '🎒', title: 'Out Into the World', text, type: 'success' });
        } else if (how === 'orphaned') {
            out.notices.push({ icon: '🕯️', title: 'Your Parents', text: L.orphaned, type: 'warning' });
        } else if (how === 'age') {
            out.notices.push({ icon: '🎂', title: 'Of Age', text: `You are ${player.age}: of age, and your own.`, type: 'info' });
        }
        return out;
    },

    // ── The day ─────────────────────────────────────────

    /** The end of the day (ui/game/endDay.js). → { notices } */
    processDay(player, world) {
        const out = { notices: [] };
        const pa = Parentage.state(player);
        if (!pa || !world) return out;
        Parentage._syncRoyals(player, world);
        if (pa.royal) Parentage._royalWatch(player, world, out);
        if (!pa.active) return out;
        const day = _day(world);
        const B = Parentage.data();
        if (pa.pending) {
            // Never chosen: fate chooses
            const c = Parentage.randomCouple(world, { age: pa.age });
            const res = c ? Parentage.bornTo(player, world, c, { age: pa.age }) : null;
            if (res && res.success) out.notices.push({ icon: '🏡', title: 'Born', text: res.line, type: 'info' });
            else player.parentage = null;
            return out;
        }
        // A new head of the House (an heir played on): no longer their child in this way
        if (player.house && _num(player.house.generation, 1) !== _num(pa.gen, 1)) return Parentage.end(player, world, 'gone', out);
        pa._today = day;
        // Coming of age
        if (_num(player.age) >= _num(B.comeOfAge, 16)) return Parentage.end(player, world, 'age', out);
        // Both gone: their savings, their estates
        if (!Parentage._parents(player).length) {
            Parentage._inherit(player, world, out);
            return Parentage.end(player, world, 'orphaned', out);
        }
        Parentage._newSiblings(player, world);
        if (pa.grounded && pa.grounded.until < day) { pa.grounded = null; Parentage._log(pa, world, 'You are no longer grounded.'); }
        if (pa.leave && pa.leave.until < day) {
            pa.leave = null;
            out.notices.push({ icon: '🎒', title: 'Your Parents', text: 'Your leave is over: you are expected home.', type: 'info' });
        }
        if (pa.cut && pa.cut.until < day) pa.cut = null;
        const before = pa.strikes.length;
        // Where you sleep tonight
        const home = pa.home;
        const d = _dist(world, player, home);
        const onLeave = !!(pa.leave && pa.leave.until >= day);
        if (Parentage.ruleActive(player, 'roam') && d > Parentage.roamRadius(player, world)) {
            const every = _num(((B.rules || {}).roam || {}).every, 3);
            if (day - _num(pa.lastRoam, -999) >= every) { pa.lastRoam = day; Parentage._breach(player, world, 'roam', out); }
        } else if (!onLeave && d > 0 && (Parentage.ruleActive(player, 'curfew') || Parentage.grounded(player, world))) {
            Parentage._breach(player, world, 'curfew', out);
        }
        // Duties left undone
        for (const due of Parentage.dutiesDue(player, world)) {
            if (!due.active || !due.overdue || onLeave) continue;
            pa.duties[due.duty] = day;
            Parentage._breach(player, world, due.rule, out);
            if (!pa.active) return out;
        }
        // Wed without their blessing
        if (player.spouse && !pa.wedNoted) {
            pa.wedNoted = true;
            if (Parentage.ruleActive(player, 'marry')) Parentage._breach(player, world, 'marry', out);
        }
        if (!pa.active) return out;
        // An obedient day
        if (pa.strikes.length === before && d === 0) {
            const T = Parentage.temperOf(pa);
            pa.trust = _clamp(_num(pa.trust) + _num((B.trust || {}).perObedientDay, 0.5) * T.trust, 0, _num((B.trust || {}).max, 100));
        }
        // The household's week: the parents' wages from the town, their spending back into it
        if (day - _num(pa.householdDay) >= 7) {
            pa.householdDay = day;
            const hh = Parentage._household(world, pa);
            const st = Parentage.station(pa.station) || {};
            if (hh && hh.town && _num(st.wage) > 0) {
                const earned = Math.floor(Economy.drawTown(hh.town, _num(st.wage) * 7));
                hh.payee.purse = _num(hh.payee.purse) + earned;
                const spend = Math.min(Math.floor(_num(hh.payee.purse)), Math.floor(earned * _num((B.household || {}).upkeepShare, 0.95)));
                hh.payee.purse -= spend;
                Economy.payTown(hh.town, spend);
            }
        }
        // The allowance
        if (day - _num(pa.allowanceDay) >= _num(B.allowanceEvery, 7)) {
            pa.allowanceDay = day;
            if (!pa.cut) {
                const st = Parentage.station(pa.station) || {};
                const paid = Parentage._takeSavings(world, pa, _num(st.allowance));
                if (paid > 0) {
                    player.gold = _num(player.gold) + paid;
                    out.notices.push({ icon: '💰', title: 'Allowance', text: _fill((B.lines || {}).allowance, { parents: Parentage.parentsLine(player).replace(/^your/, 'Your'), gold: paid }), type: 'info' });
                } else if (_num(st.allowance) > 0) {
                    Parentage._log(pa, world, (B.lines || {}).allowanceShort);
                }
            }
        }
        return out;
    },

    /** A brother or sister born since: a townsperson of the couple's, bridged as kin. */
    _newSiblings(player, world) {
        const pa = Parentage.state(player);
        const hh = pa && pa.folk ? Parentage._household(world, pa) : null;
        if (!hh) return;
        const tile = world.getTile(pa.folk.q, pa.folk.r);
        for (const id of hh.payee.kids || []) {
            const kid = Townsfolk.get(hh.folk, id);
            if (!kid || kid.died != null || kid.rnpc != null) continue;
            const role = kid.gender === 'female' ? 'sister' : 'brother';
            const npc = Parentage._bridge(player, world, hh.folk, kid, tile.settlement, role, _num((Parentage.data().regard || {})[role], 35));
            if (npc && !pa.kin.includes(npc.id)) pa.kin.push(npc.id);
        }
    },

    /** Keep the royal relatives' NPCs in step with their characters. */
    _syncRoyals(player, world) {
        const pa = Parentage.state(player);
        if (!pa || !pa.royal) return;
        const k = _kingdom(world, pa.royal.kid);
        const data = k && k.characterData;
        if (!data) return;
        const chars = [data.ruler, data.spouse, ...(data.children || [])].filter(Boolean);
        for (const id of [pa.father, pa.mother, ...(pa.kin || [])]) {
            const npc = Relationships._npcs.find(n => n.id === id);
            if (!npc || !npc.charId) continue;
            const ch = chars.find(c => c.id === npc.charId);
            if (!ch) continue;
            npc.age = _num(ch.age, npc.age);
            if (ch.isAlive === false && npc.isAlive !== false) { npc.isAlive = false; npc.deathDay = _num(ch.deathDay, _day(world)); }
        }
    },

    /**
     * The royal line: when the parent on the throne is gone, the eldest
     * living child of age reigns. If that is the player, the crown is theirs
     * now (or held for them until they come of age).
     */
    _royalWatch(player, world, out) {
        const pa = Parentage.state(player);
        const R = pa.royal;
        if (!R || R.done) return;
        const k = _kingdom(world, R.kid);
        if (!k || k.isAlive === false) { R.done = 'fallen'; return; }
        const data = k.characterData;
        const L = Parentage.data().lines || {};
        const come = _num(Parentage.data().comeOfAge, 16);
        const parentReigns = data && data.ruler && (data.ruler.id === R.fatherId || data.ruler.id === R.motherId) && data.ruler.isAlive !== false;
        if (pa.disinherited) { R.done = 'disinherited'; return; }
        if (!R.passed && !parentReigns && R.rulerId != null && (!data || !data.ruler || data.ruler.id !== R.rulerId || data.ruler.isAlive === false)) {
            R.passed = _day(world);
            const elder = (data && data.children || []).filter(c => c && c.isAlive !== false && _num(c.age) > _num(player.age) && (c.parentId === R.fatherId || c.parentId === R.motherId || c.parentId2 === R.fatherId || c.parentId2 === R.motherId));
            if (elder.length) {
                R.done = 'passed';
                const text = _fill(L.lineLost, { heir: k.ruler || 'an elder sibling' });
                out.notices.push({ icon: '👑', title: 'The Succession', text, type: 'warning' });
                return;
            }
            R.awaits = true;
            if (_num(player.age) < come) {
                out.notices.push({ icon: '👑', title: 'The Succession', text: _fill(L.crownAwaits, { comeOfAge: come }), type: 'info' });
                return;
            }
        }
        if (R.awaits && _num(player.age) >= come && !Throne.ruledKingdom(player, world)) {
            Throne._takeThrone(player, world, k);
            Throne.state(player).ruling.inherited = true;
            R.done = 'crowned';
            R.awaits = false;
            const text = _fill(L.crowned, { kingdom: k.name });
            Throne._log(player, world, `👑 ${text}`);
            out.notices.push({ icon: '👑', title: 'Crowned', text, type: 'success' });
        }
    },

    /** Both parents dead while the player is their child: savings shared out, a noble House's estates to the eldest. */
    _inherit(player, world, out) {
        const pa = Parentage.state(player);
        const L = Parentage.data().lines || {};
        if (pa.disinherited) return;
        const kids = Parentage.kin(player, world).filter(x => (x.role === 'brother' || x.role === 'sister') && x.alive);
        if (!pa.royal) {
            const share = Math.floor(Parentage.savings(world, player) / (kids.length + 1));
            const got = Parentage._takeSavings(world, pa, share);
            if (got > 0) {
                player.gold = _num(player.gold) + got;
                out.notices.push({ icon: '📜', title: 'Inheritance', text: _fill(L.inherit, { what: `${got} gold, your share of their savings` }), type: 'info' });
            }
        }
        const eldest = !kids.some(x => x.age > _num(player.age));
        if (pa.estates && eldest && Estates.enabled()) {
            let n = 0;
            for (const e of Estates.heldBy(world, pa.estates.holder)) { LandMarket._setHolder(world, e, 'player', _day(world)); n++; }
            if (n) out.notices.push({ icon: '🏰', title: 'Inheritance', text: _fill(L.inherit, { what: `the estates of ${pa.estates.name} (${n})` }), type: 'success' });
            pa.estates.inherited = n;
        }
    },

    // ── Nobody starts alone ─────────────────────────────

    /**
     * Every origin's first people (data/birth.json ties): parents and
     * siblings (at the start town or another), friends, acquaintances and a
     * rival in the start town, and a court of retainers. Townsfolk bridged to
     * relationship NPCs; hash rolls only. → { family, friends, acquaintances, rival, court } (npc ids)
     */
    seedTies(player, world, originId) {
        const out = { family: [], friends: [], acquaintances: [], rival: null, court: [] };
        if (!player || !world || Dawn.isActive(world) || (Array.isArray(player.dawnKin) && player.dawnKin.length)) return out;
        const T = Parentage.data().ties || {};
        const O = T.origins || {};
        const spec = { ...(O._default || {}), ...(O[originId] || {}) };
        const regard = T.regard || {};
        const towns = _towns(world);
        if (!towns.length) return out;
        const day = _day(world);
        const Y = Townsfolk.config().daysPerYear;
        const rng = _rng(world, `ties|${originId}|${player.q},${player.r}|${day}`);
        const here = towns.find(t => t.q === player.q && t.r === player.r)
            || towns.slice().sort((a, b) => _dist(world, a, player) - _dist(world, b, player))[0];
        const seed = t => {
            if (!Number.isFinite(t.s.q)) { t.s.q = t.q; t.s.r = t.r; }
            return Townsfolk.seed(t.s, world, { q: t.q, r: t.r });
        };
        const folk = seed(here);
        if (!folk) return out;
        const age = _num(player.age, 20);
        const known = new Set();

        // Family
        const nParents = _clamp(Math.floor(_num(spec.parents)), 0, 2);
        const sib = Array.isArray(spec.siblings) ? spec.siblings : [0, 0];
        const nSibs = _rint(_num(sib[0]), _num(sib[1]), rng);
        if (nParents + nSibs > 0) {
            let ft = here;
            if (spec.family === 'away') {
                const far = towns.filter(t => t !== here && _dist(world, t, here) >= 4 && _dist(world, t, here) <= 24);
                ft = _pick(far, rng) || here;
            }
            const ffolk = ft === here ? folk : seed(ft);
            if (ffolk) {
                const last = player.lastName || _pick(Townsfolk._lastNames(ffolk), rng) || 'Stone';
                const parents = [];
                const fa = age + _rint(22, 34, rng);
                const ma = age + _rint(19, 30, rng);
                const both = nParents >= 2;
                const firstIsFather = both || rng() < 0.45;
                if (nParents >= 1 && (firstIsFather ? fa : ma) <= 82) {
                    parents.push(Parentage._addPerson(ffolk, { gender: firstIsFather ? 'male' : 'female', last, age: firstIsFather ? fa : ma, day, rng, role: _pick(['farmer', 'villager', 'merchant'], rng) }));
                }
                if (both && ma <= 82) parents.push(Parentage._addPerson(ffolk, { gender: 'female', last, age: ma, day, rng, role: 'villager' }));
                if (parents.length === 2) Townsfolk._wed(ffolk, parents[0], parents[1], day - (age + 2) * Y, true);
                for (const p of parents) {
                    if (Townsfolk.age(p, day) >= Townsfolk.config().retireAge) p.retired = p.role;
                    const role = p.gender === 'female' ? 'mother' : 'father';
                    const npc = Parentage._bridge(player, world, ffolk, p, ft.s, role, _num(regard[role], 45));
                    if (npc) { out.family.push(npc.id); known.add(p); }
                }
                for (let i = 0; i < nSibs; i++) {
                    const gender = rng() < 0.5 ? 'male' : 'female';
                    let a = age + _rint(-8, 8, rng);
                    if (a === age) a += 1;
                    a = Math.max(6, a);
                    const s = Parentage._addPerson(ffolk, { gender, last, age: a, day, rng, role: a < Townsfolk.config().comeOfAge ? 'child' : _pick(['villager', 'farmer', 'merchant', 'guard'], rng) });
                    for (const p of parents) { s.parents.push(p.id); p.kids.push(s.id); }
                    const role = gender === 'female' ? 'sister' : 'brother';
                    const npc = Parentage._bridge(player, world, ffolk, s, ft.s, role, _num(regard[role], 30));
                    if (npc) { out.family.push(npc.id); known.add(s); }
                }
            }
        }

        // Friends, acquaintances and a rival of the start town
        const res = Townsfolk.residents(folk).filter(p => !known.has(p) && p.rnpc == null && p.role !== 'beggar');
        const ageOf = p => Townsfolk.age(p, day);
        let pool;
        if (spec.youth) {
            // Of an age with you first, then the nearest in age
            const young = _shuffle(res.filter(p => Math.abs(ageOf(p) - age) <= 4 && ageOf(p) >= 8), rng);
            const rest = res.filter(p => !young.includes(p) && ageOf(p) >= 8).sort((a, b) => Math.abs(ageOf(a) - age) - Math.abs(ageOf(b) - age) || a.id - b.id);
            pool = young.concat(rest);
        } else {
            pool = _shuffle(res.filter(p => ageOf(p) >= 16 && p.role !== 'child'), rng);
        }
        const take = (n, tie, score) => {
            const ids = [];
            for (let i = 0; i < n && pool.length; i++) {
                const p = pool.shift();
                const npc = Parentage._bridge(player, world, folk, p, here.s, null, score, tie);
                if (npc) ids.push(npc.id);
            }
            return ids;
        };
        out.friends = take(_num(spec.friends), 'friend', _num(regard.friend, 40));
        out.acquaintances = take(_num(spec.acquaintances), 'acquaintance', _num(regard.acquaintance, 12));
        out.rival = take(_num(spec.rival) > 0 ? 1 : 0, 'rival', _num(regard.rival, -35))[0] || null;

        // A court of retainers (systems/court.js)
        // (never past the seats the House has: Court.capacity)
        const nCourt = player.house ? Math.min(Math.floor(_num(spec.court)), Math.max(0, Court.capacity(player) - Court.ensure(player).length)) : 0;
        if (nCourt > 0 && player.house) {
            const C = T.court || {};
            const grown = res.filter(p => !known.has(p) && p.rnpc == null && ageOf(p) >= 20 && ageOf(p) <= 62 && p.role !== 'child');
            _shuffle(grown, rng);
            for (const p of grown.slice(0, nCourt)) {
                const npc = Parentage._bridge(player, world, folk, p, here.s, null, _num(regard.retainer, 30), 'retainer');
                if (!npc) continue;
                const joined = Court.join(player, world, npc.id, { stipend: _num(spec.stipend, _num(C.stipend, 3)), loyalty: _num(spec.loyalty, _num(C.loyalty, 60)), free: true });
                if (joined && joined.success) out.court.push(npc.id);
            }
        }
        player.ties = { origin: originId, day, town: here.s.name, ...out };
        if (typeof Relationships.prepareForSave === 'function') Relationships.prepareForSave(player);
        return out;
    },
};
