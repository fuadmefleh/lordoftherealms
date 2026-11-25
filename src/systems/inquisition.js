// ============================================
// THE INQUISITION — inquisitors riding town to town, hearings, fires, seizures
// ============================================
// The realms' heresies (systems/religion.js kingdom.religion.heresies) waxed and
// waned on their own dice, and only the player could preach one down. Here the
// see of a faith (systems/holyWars.js) commissions INQUISITORS: persistent
// people with a name, an age, a zeal and a greed, sent to a realm of the faith
// whose heresy law (data/laws.json heresy) admits them.
//
//   THE ROUND  an inquisitor rides from town to town of his realm (the great
//              towns first, and those where a strange faith is preached), holds
//              a HEARING of some days in each, rests, and rides on; his keep is
//              paid out of the see's coffers into the town he sits in. He dies,
//              or his commission ends, or the crown bars him (the law turned to
//              tolerance, or the player expels him); his purse goes to the see.
//   HEARINGS   each day of a hearing a townsperson may be tried (systems/
//              townsfolk.js: a real person of the town). Acquitted; or found
//              guilty and given a penance (a share of their purse to the see);
//              or their purse seized whole (and the cells, under the bishops'
//              courts); or, under the Holy Office and a faith that burns, handed
//              to the secular arm: the stake, proclaimed and carried out on the
//              town's scaffold (systems/executions.js handOver — the crowd, the
//              kin's blood feud, a martyr's shrine for the innocent). Every coin
//              seized moves from a purse to the see's coffers. Each conviction
//              beats the realm's strongest heresy down and lifts its piety.
//   THE TOWN   under a hearing a town grows afraid (settlement.inquisition.fear:
//              its happiness, systems/marketDynamics.js Taxation reads its mood),
//              informers multiply (they report on the player too), and people
//              flee — a share of the town moves to the nearest town of another
//              realm, a named townsperson now and then leaves the roll. The fear
//              fades after; the town's annals tell of the burnings.
//   THE PLAYER an inquisitor in the player's town weighs them (suspicion: their
//              creed, standing with his faith, a soul sold, obstruction, a bribe
//              refused, the informers; less for hosting him, Prestige). Suspect
//              enough, they are SUMMONED: stand the hearing (acquitted, a
//              penance, a confiscation, or — an obstinate heretic under the Holy
//              Office — handed to the secular arm: arrested for heresy and tried,
//              player/trials.js), recant (a penance and shame), or flee (the
//              crown's warrant for heresy, systems/wanted.js, and the see's
//              grievance, the road to excommunication). They may HOST him (his
//              favour), BRIBE him (his purse; a zealot refuses and remembers),
//              OBSTRUCT a hearing (shorter, fewer convicted; informers may name
//              them), or EXPEL him from a town or realm they rule (the see's
//              grievance, standing and piety).
//
// Rules: explicit params, no domain globals; every roll a hash of the world
// seed. State on world.inquisition (saved), the towns' on settlement.inquisition
// (saved with the tile), the player's on player.inquisition (saved). Runs with
// player=null. Content: data/inquisition.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { Interrupts } from '../core/interrupts.js';
import { Names } from '../core/names.js';
import { Economy } from '../world/economy.js';
import { Religion } from './religion.js';
import { Devotion } from './devotion.js';
import { Townsfolk } from './townsfolk.js';
import { Laws } from './laws.js';
import { Ledger } from './ledger.js';
import { House } from './house.js';
import { Wanted } from './wanted.js';
import { Underworld } from './underworld.js';
import { Executions } from './executions.js';
import { SoulPact } from './soulPact.js';
import { Throne } from './throne.js';
import { HolyWars } from './holyWars.js';

const YEAR = 120;
const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _arr = (v) => (Array.isArray(v) ? v : []);
const _day = (world) => Math.floor(_num(world && world.day));
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _r2 = (v) => Math.round(v * 100) / 100;
const _alive = (k) => !!(k && k.isAlive !== false);
const _key = (q, r) => `${q},${r}`;
const _logit = (z) => 1 / (1 + Math.exp(-z));

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
    return h >>> 0;
}

function _seed(world) {
    const p = world && world.generationParams;
    return (p && p.seed) || 0;
}

function _u(world, key) {
    return (_hash(`${_seed(world)}|inq|${key}`) % 100000) / 100000;
}

function _range(world, key, span, d) {
    const [lo, hi] = Array.isArray(span) && span.length === 2 ? span : d;
    return lo + (hi - lo) * _u(world, key);
}

function _fill(t, vars) {
    return String(t || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

function _kingdom(world, id) {
    if (!world || id == null) return null;
    if (typeof world.getKingdom === 'function') return world.getKingdom(id) || null;
    return (world.kingdoms || []).find(k => k && k.id === id) || null;
}

function _settlementAt(world, q, r) {
    const t = world && typeof world.getTile === 'function' && Number.isFinite(q) ? world.getTile(q, r) : null;
    return (t && t.settlement) || null;
}

function _dist(world, a, b) {
    if (!a || !b || !Number.isFinite(a.q) || !Number.isFinite(b.q)) return Infinity;
    return Hex.wrappingOffsetDistance(a.q, a.r, b.q, b.r, (world && world.width) || 0);
}

function _views(world) {
    return world && typeof world.getSettlementViews === 'function' ? (world.getSettlementViews() || []) : [];
}

function _ruled(player, world) {
    try { return player ? Throne.ruledKingdom(player, world) : null; } catch (err) { return null; }
}

const DEFAULTS = {
    enabled: true, maxInquisitors: 6, perRealm: 1,
    spawn: { base: 0.006, perHeresy: 0.0015, perPiety: 0.0001, playerFaith: 0.02, years: [4, 9], age: [34, 58], lifespan: [60, 78], commission: 150 },
    travel: { hexPerDay: 4, restDays: [3, 8], revisitDays: 360, maxTowns: 14 },
    hearing: { days: [6, 12], tryChance: 0.55, base: 0.25, perHeresy: 0.006, perInformer: 0.02, burnShare: 0.25, fineShare: 0.3, seizeShare: 0.4, heresyHit: 3, pietyPerConviction: 0.3, jailDays: 60, minAge: 16, burnDays: 2 },
    town: { fearPerDay: 4, fearBurn: 12, fearDecay: 0.6, fearMax: 100, moodPerFear: 0.12, informerChance: 0.35, informerMax: 12, fleeAt: 25, fleeShare: 0.002, folkFlee: 0.15 },
    keep: { daily: 2, spendShare: 0.2 },
    suspicion: { noCreed: 20, foreign: 40, own: 55, same: 0, perStanding: -0.35, soulPact: 25, obstructed: 15, bribeRefused: 25, perInformer: 2, hosted: -25, perPrestige: -0.01, banned: 30, summonAt: 50, dueDays: 7 },
    player: { hostCost: 120, hostDays: 360, bribeBase: 200, bribePerZeal: 500, obstructDays: 3, obstructCaught: 0.06, obstructKarma: 2, expelGrievance: 40, expelStanding: -15, expelPiety: -5, penanceShare: 0.08, confiscateShare: 0.3, relapseAt: 80, recantStanding: -12, recantShare: 0.05, recantPrestige: 15, fleeBounty: 300, fleeGrievance: 25, heresyBounty: 500 },
    names: { male: ['Bernard'], female: ['Agnes'], brother: 'Brother', sister: 'Sister' },
    text: {},
};

export const Inquisition = {
    // ──────────── CONFIG & STATE ────────────

    config() {
        const d = _obj(DataLoader._gamedata && DataLoader._gamedata.inquisition) || {};
        const C = { ...DEFAULTS, ...d };
        for (const k of ['spawn', 'travel', 'hearing', 'town', 'keep', 'suspicion', 'player', 'names', 'text']) C[k] = { ...DEFAULTS[k], ...(_obj(d[k]) || {}) };
        return C;
    },

    text(key, vars = {}) {
        return _fill(Inquisition.config().text[key] || '', vars);
    },

    state(world) {
        const blank = () => ({ v: 1, n: 1, list: [], towns: [], log: [], past: [] });
        if (!world) return blank();
        if (!_obj(world.inquisition) || world.inquisition.v !== 1) world.inquisition = blank();
        const st = world.inquisition;
        for (const k of ['list', 'towns', 'log', 'past']) if (!Array.isArray(st[k])) st[k] = [];
        return st;
    },

    serialize(world) {
        return world && _obj(world.inquisition) ? JSON.parse(JSON.stringify(world.inquisition)) : null;
    },

    restore(saved, world) {
        if (!world) return;
        world.inquisition = _obj(saved) && saved.v === 1 ? JSON.parse(JSON.stringify(saved)) : null;
        Inquisition.state(world);
    },

    pstate(player) {
        if (!player) return null;
        if (!_obj(player.inquisition)) player.inquisition = { summons: null, favour: {}, obstructions: 0, lastObstruct: -1e9, bribeRefused: -1e9, record: [], log: [] };
        const p = player.inquisition;
        if (!_obj(p.favour)) p.favour = {};
        if (!Array.isArray(p.record)) p.record = [];
        if (!Array.isArray(p.log)) p.log = [];
        return p;
    },

    _plog(player, world, text) {
        const p = Inquisition.pstate(player);
        p.log.unshift({ d: _day(world), text });
        if (p.log.length > 30) p.log.length = 30;
    },

    _log(world, text, extra = {}) {
        const st = Inquisition.state(world);
        st.log.unshift({ day: _day(world), text, ...extra });
        if (st.log.length > 60) st.log.length = 60;
    },

    get(world, id) {
        return Inquisition.state(world).list.find(i => i.id === id) || null;
    },

    /** Inquisitors in the town at (q, r). */
    at(world, q, r) {
        return Inquisition.state(world).list.filter(i => i.q === q && i.r === r && i.phase !== 'travel');
    },

    /** The realm's heresy law: { id, admit, burn }. */
    law(world, kingdomId) {
        const o = kingdomId != null ? Laws.option(world, kingdomId, 'heresy') : null;
        if (!o) return { id: 'church_courts', admit: true, burn: false };
        return { id: o.id, admit: o.admit !== false, burn: !!o.burn };
    },

    /** settlement.inquisition, made on demand. */
    town(s) {
        if (!s) return null;
        if (!_obj(s.inquisition)) s.inquisition = { fear: 0, informers: 0, mood: 0, hearings: 0, burned: 0, fled: 0, tried: 0, last: null };
        return s.inquisition;
    },

    // ──────────── THE INQUISITORS ────────────

    _name(world, key, female) {
        const N = Inquisition.config().names;
        const pool = _arr(female ? N.female : N.male);
        const first = pool[_hash(`${_seed(world)}|inqname|${key}`) % Math.max(1, pool.length)] || 'Bernard';
        return `${female ? N.sister || 'Sister' : N.brother || 'Brother'} ${first}`;
    },

    /** Commission an inquisitor for a realm (the see's head: the AI weekly, or the player as High Priest). */
    commission(world, see, k, opts = {}) {
        const C = Inquisition.config();
        const st = Inquisition.state(world);
        const day = _day(world);
        if (!see || !_alive(k) || !k.capital) return null;
        const id = st.n++;
        const key = `${see.key}|${k.id}|${id}|${day}`;
        const female = _u(world, `${key}|f`) < 0.15;
        const age = _range(world, `${key}|age`, C.spawn.age, [34, 58]);
        const life = Math.max(age + 3, _range(world, `${key}|life`, C.spawn.lifespan, [60, 78]));
        const s = _settlementAt(world, k.capital.q, k.capital.r);
        const inq = {
            id, name: `${Inquisition._name(world, key, female)} of ${(s && s.name) || Names.realm(k.name)}`, gender: female ? 'female' : 'male', born: Math.round(day - age * YEAR), dies: Math.round(day + (life - age) * YEAR),
            seeKey: see.key, faithId: see.faithId, kingdomId: k.id, q: k.capital.q, r: k.capital.r, town: (s && s.name) || 'the capital',
            phase: 'rest', restUntil: day + 1, arrive: null, dest: null, hearingEnd: null, until: day + Math.round(_range(world, `${key}|yrs`, C.spawn.years, [4, 9]) * YEAR),
            zeal: Math.round((0.35 + 0.65 * _u(world, `${key}|zeal`)) * 100) / 100, greed: Math.round(_u(world, `${key}|greed`) * 100) / 100, purse: 0,
            visited: {}, convictMult: 1, by: opts.by || 'see',
            tally: { tried: 0, acquitted: 0, penanced: 0, seized: 0, burned: 0, towns: 0, coin: 0 },
        };
        st.list.push(inq);
        Inquisition._log(world, `${inq.name} is sent by ${HolyWars.headLabel(see)} to root out heresy in ${Names.realm(k.name)}.`, { kingdomId: k.id });
        return inq;
    },

    /** Weekly: the sees send inquisitors to the realms of their faith that admit them. */
    _spawnWeek(world, player, day) {
        const C = Inquisition.config();
        const st = Inquisition.state(world);
        if (st.list.length >= _num(C.maxInquisitors, 6)) return;
        const week = Math.floor(day / 7);
        for (const see of Object.values(HolyWars.state(world).sees)) {
            if (HolyWars.playerHeads(player, see)) continue; // a High Priest sends his own
            for (const k of HolyWars.flock(world, see.key)) {
                if (st.list.length >= _num(C.maxInquisitors, 6)) return;
                if (see.bans[k.id] || !Inquisition.law(world, k.id).admit) continue;
                if (st.list.filter(i => i.kingdomId === k.id).length >= _num(C.perRealm, 1)) continue;
                const strength = _arr(k.religion.heresies).reduce((s, h) => s + _num(h.strength), 0);
                const preached = player && player.religion && player.religion.presence && Object.keys(player.religion.presence).length && HolyWars._playerFaith(player) !== see.faithId ? 1 : 0;
                const chance = _num(C.spawn.base) + strength * _num(C.spawn.perHeresy) + _num(k.religion.piety, 50) * _num(C.spawn.perPiety) + preached * _num(C.spawn.playerFaith);
                if (_u(world, `spawn|${k.id}|${week}`) >= chance) continue;
                // His commission is paid out of the see's coffers into the capital's purse (the clerks, the horses)
                const fee = HolyWars.withdraw(world, see, _num(C.spawn.commission, 150));
                const cap = _settlementAt(world, k.capital.q, k.capital.r);
                if (fee > 0 && cap) Economy.payTown(cap, fee);
                else if (fee > 0) see.coffers = _r2(_num(see.coffers) + fee);
                Inquisition.commission(world, see, k);
            }
        }
    },

    /** An inquisitor's work ends: his purse to the see. */
    _retire(world, player, inq, why, out) {
        const st = Inquisition.state(world);
        const see = HolyWars.see(world, inq.seeKey);
        if (inq.purse > 0) {
            if (see) HolyWars.deposit(world, player, see, inq.purse, inq.kingdomId);
            else { const s = _settlementAt(world, inq.q, inq.r); if (s) Economy.payTown(s, inq.purse); }
            inq.purse = 0;
        }
        st.list = st.list.filter(i => i !== inq);
        st.past.unshift({ id: inq.id, name: inq.name, kingdomId: inq.kingdomId, faithId: inq.faithId, from: _day(world) - 1, to: _day(world), why, tally: { ...inq.tally } });
        if (st.past.length > 20) st.past.length = 20;
        Inquisition._log(world, `${inq.name}'s work in ${Names.realm((_kingdom(world, inq.kingdomId) || {}).name || 'the realm')} is over: ${why}.`, { kingdomId: inq.kingdomId });
        const p = player && player.inquisition;
        if (p && p.summons && p.summons.inqId === inq.id) p.summons = null;
        if (out && player && _dist(world, player, inq) <= 3) out.notices.push({ icon: '📜', title: 'The Inquisitor Departs', text: `${inq.name}'s work is over: ${why}.`, type: 'info' });
    },

    /** The next town of his round: the great towns and those a strange faith is preached in first. */
    _nextTown(world, player, inq, day) {
        const C = Inquisition.config().travel;
        const k = _kingdom(world, inq.kingdomId);
        if (!k) return null;
        let best = null;
        let bs = -Infinity;
        let n = 0;
        for (const s of _views(world)) {
            if (!s || s.kingdom !== k.id || !Number.isFinite(s.q)) continue;
            const key = _key(s.q, s.r);
            if (day - _num(inq.visited[key], -1e9) < _num(C.revisitDays, 360)) continue;
            if (_num(s.inquisition && s.inquisition.barredUntil) > day) continue;
            const preached = player && player.religion ? Religion.getPresence(player.religion, s.q, s.r) * 60 : 0;
            const score = Math.log10(Math.max(10, _num(s.population, 100))) * 10 + preached - _dist(world, inq, s) / 4 + _u(world, `next|${inq.id}|${key}|${day}`) * 6;
            if (score > bs) { bs = score; best = s; }
            if (++n > 400) break;
        }
        return best;
    },

    _travel(world, player, inq, day) {
        const C = Inquisition.config().travel;
        const s = Inquisition._nextTown(world, player, inq, day);
        if (!s) {
            // Every town seen of late: start the round again
            inq.visited = {};
            inq.restUntil = day + 14;
            inq.phase = 'rest';
            return;
        }
        const days = Math.max(1, Math.ceil(_dist(world, inq, s) / Math.max(1, _num(C.hexPerDay, 4))));
        inq.dest = { q: s.q, r: s.r, town: s.name };
        inq.arrive = day + days;
        inq.phase = 'travel';
    },

    _arrive(world, player, inq, day, out) {
        const H = Inquisition.config().hearing;
        inq.q = inq.dest.q;
        inq.r = inq.dest.r;
        inq.town = inq.dest.town;
        inq.dest = null;
        inq.arrive = null;
        inq.phase = 'hearing';
        inq.convictMult = 1;
        inq.hearingEnd = day + Math.round(_range(world, `days|${inq.id}|${day}`, H.days, [6, 12]));
        inq.visited[_key(inq.q, inq.r)] = day;
        inq.tally.towns++;
        const s = _settlementAt(world, inq.q, inq.r);
        const t = Inquisition.town(s);
        if (t) { t.hearings++; t.last = day; }
        const st = Inquisition.state(world);
        if (s && !st.towns.includes(_key(inq.q, inq.r))) st.towns.push(_key(inq.q, inq.r));
        if (player && (_dist(world, player, inq) <= 2 || Inquisition._rulesTown(player, world, inq.q, inq.r))) {
            const faith = Religion.FAITHS[inq.faithId];
            out.notices.push({ icon: '📜', title: `An Inquisitor in ${inq.town}`, text: Inquisition.text('arrive', { inq: inq.name, faith: faith ? faith.name : 'the faith', town: inq.town }), type: 'warning' });
        }
    },

    /** One day of a hearing: a trial, the town's fear, its informers, those who flee. */
    _hearingDay(world, player, inq, day, out) {
        const C = Inquisition.config();
        const H = C.hearing;
        const T = C.town;
        const s = _settlementAt(world, inq.q, inq.r);
        const k = _kingdom(world, inq.kingdomId);
        if (!s || !k) return;
        const t = Inquisition.town(s);
        const see = HolyWars.see(world, inq.seeKey);
        // His keep, from the see's coffers into the town's purse
        const keep = see ? HolyWars.withdraw(world, see, _num(C.keep.daily, 2)) : 0;
        if (keep > 0) Economy.payTown(s, keep);
        let burned = false;
        if (_u(world, `try|${inq.id}|${day}`) < _num(H.tryChance, 0.55) * _num(inq.convictMult, 1)) {
            burned = Inquisition._try(world, player, inq, s, k, t, see, day, out);
        }
        t.fear = _clamp(_num(t.fear) + _num(T.fearPerDay, 4) * _num(inq.zeal, 0.6) * 1.4 + (burned ? _num(T.fearBurn, 12) : 0), 0, _num(T.fearMax, 100));
        if (_u(world, `inf|${inq.id}|${day}`) < _num(T.informerChance, 0.35)) t.informers = Math.min(_num(T.informerMax, 12), _num(t.informers) + 1);
        t.mood = -Math.round(t.fear * _num(T.moodPerFear, 0.12) * 10) / 10;
        // Those who can, flee to another realm
        if (t.fear >= _num(T.fleeAt, 25) && _num(s.population) > 50) Inquisition._flee(world, s, t, inq, day);
    },

    /** A townsperson tried. → true when one goes to the stake. */
    _try(world, player, inq, s, k, t, see, day, out) {
        const H = Inquisition.config().hearing;
        const heresy = Religion.strongestHeresy(k);
        const preached = player && player.religion ? Religion.getPresence(player.religion, s.q, s.r) : 0;
        const guilt = _clamp(_num(H.base, 0.25) + (heresy ? _num(heresy.strength) : 0) * _num(H.perHeresy, 0.006) + _num(t.informers) * _num(H.perInformer, 0.02) + preached * 0.3, 0.02, 0.9);
        const folk = s.folk;
        const pool = folk ? Townsfolk.residents(folk).filter(p => Townsfolk.age(p, day) >= _num(H.minAge, 16) && !(_num(p.jailedUntil) > day)) : [];
        const p = pool.length ? pool[_hash(`${_seed(world)}|acc|${inq.id}|${day}`) % pool.length] : null;
        inq.tally.tried++;
        t.tried = _num(t.tried) + 1;
        const who = p ? Townsfolk.name(p) : 'a townsman';
        if (_u(world, `guilt|${inq.id}|${day}`) >= guilt) {
            inq.tally.acquitted++;
            return false;
        }
        const law = Inquisition.law(world, k.id);
        const canBurn = law.burn && Executions._faithStance(world, k.id) !== 'sacred';
        const roll = _u(world, `verdict|${inq.id}|${day}`);
        let verdict = 'penance';
        if (canBurn && p && roll < _num(H.burnShare, 0.25) * _num(inq.zeal, 0.6)) verdict = 'burned';
        else if (roll < _num(H.burnShare, 0.25) * _num(inq.zeal, 0.6) + _num(H.seizeShare, 0.4) * _num(inq.greed, 0.5)) verdict = 'seized';
        // The coin: a share of the purse, or all of it, to the see
        let coin = 0;
        if (!p) {
            // (a town whose people the game has not met: the condemned's goods out of the town's purse)
            const want = Math.min(_num(H.abstractMax, 60), Math.max(0, _num(Economy.townPurse(s))) * _num(H.abstractFine, 0.004) * (verdict === 'penance' ? 0.4 : 1));
            coin = Economy.drawTown(s, want);
            if (coin > 0) {
                if (see) HolyWars.deposit(world, player, see, coin, k.id);
                else Economy.payTown(s, coin);
                inq.tally.coin = _r2(_num(inq.tally.coin) + coin);
            }
            if (canBurn && roll < _num(H.burnShare, 0.25) * _num(inq.zeal, 0.6)) {
                verdict = 'burned';
                s.population = Math.max(1, _num(s.population) - 1);
            }
        } else if (p && folk) {
            const purse = Townsfolk.purse(folk, p, world);
            coin = verdict === 'penance' ? Utils.centsDown(purse * _num(H.fineShare, 0.3)) : purse;
            if (coin > 0) {
                p.purse = _r2(purse - coin);
                if (see) HolyWars.deposit(world, player, see, coin, k.id);
                else Economy.payTown(s, coin);
                inq.tally.coin = _r2(_num(inq.tally.coin) + coin);
            }
        }
        if (verdict === 'burned' && p) {
            const e = Executions.handOver(world, { q: s.q, r: s.r, kingdomId: k.id, pid: p.id, crime: 'heresy', method: 'burn', guilty: _u(world, `true|${inq.id}|${day}`) < 0.55, days: _num(H.burnDays, 2), by: inq.name });
            if (!e) verdict = 'seized';
        }
        if (verdict === 'seized' && p) p.jailedUntil = day + _num(H.jailDays, 60);
        inq.tally[verdict === 'burned' ? 'burned' : verdict === 'seized' ? 'seized' : 'penanced']++;
        if (verdict === 'burned') t.burned = _num(t.burned) + 1;
        if (folk && p) {
            const line = verdict === 'burned' ? `${who} was condemned as a heretic by ${inq.name} {when} and handed over to be burned.`
                : verdict === 'seized' ? `${who} was found a heretic by ${inq.name} {when}; everything ${p.gender === 'female' ? 'she' : 'he'} had was seized for the Church.`
                    : `${who} did penance before ${inq.name}'s hearing {when}.`;
            Townsfolk.record(folk, world, day, { k: 'townMemory', x: line });
        }
        // The realm's heresy beaten down; its piety lifted
        if (heresy) {
            heresy.strength = _num(heresy.strength) - _num(H.heresyHit, 3);
            if (heresy.strength <= 0) {
                k.religion.heresies = _arr(k.religion.heresies).filter(h => h !== heresy);
                if (Array.isArray(world.events)) world.events.push({ category: 'religious', text: `${k.name}: the inquisition has stamped out the ${heresy.name}.`, kingdom: k.id, impact: 'positive' });
            }
        }
        if (k.religion) k.religion.piety = _clamp(_num(k.religion.piety, 50) + _num(H.pietyPerConviction, 0.3), 0, 100);
        if (verdict === 'burned') {
            const raw = Inquisition.text('burned', { name: who, town: s.name, inq: inq.name });
            // (the accused may be 'a townsman of …': the line starts with a capital all the same)
            const text = raw.charAt(0).toUpperCase() + raw.slice(1);
            Inquisition._log(world, text, { kingdomId: k.id, town: s.name });
            if (player && _dist(world, player, s) <= 2) out.notices.push({ icon: '🔥', title: `A Burning Proclaimed in ${s.name}`, text: `${text} It will be done on day ${day + _num(H.burnDays, 2)} in the square.`, type: 'warning' });
            return true;
        }
        return false;
    },

    /** A share of the frightened town moves to the nearest town of another realm; a named soul leaves the roll. */
    _flee(world, s, t, inq, day) {
        const T = Inquisition.config().town;
        const n = Math.floor(_num(s.population) * _num(T.fleeShare, 0.002));
        if (n < 1) return;
        let best = null;
        let bd = Infinity;
        for (const o of _views(world)) {
            if (!o || o === s || o.kingdom === s.kingdom || !Number.isFinite(o.q) || !(_num(o.population) > 0)) continue;
            const d = _dist(world, s, o);
            if (d < bd) { bd = d; best = o; }
        }
        if (!best || bd > 30) return;
        s.population = Math.max(1, _num(s.population) - n);
        best.population = _num(best.population) + n;
        t.fled = _num(t.fled) + n;
        if (s.folk && _u(world, `fleeFolk|${inq.id}|${day}`) < _num(T.folkFlee, 0.15)) {
            const pool = Townsfolk.residents(s.folk).filter(p => p.role !== 'noble' && !(_num(p.jailedUntil) > day));
            const p = pool.length ? pool[_hash(`${_seed(world)}|fleer|${inq.id}|${day}`) % pool.length] : null;
            if (p) {
                Townsfolk.exile(s.folk, p, day, best.name, world);
                Townsfolk.record(s.folk, world, day, { k: 'townMemory', x: `${Townsfolk.name(p)} fled to ${best.name} {when}, afraid of the inquisition.` });
            }
        }
    },

    /** The towns' fear fades after the hearing. */
    _townsDay(world, day) {
        const T = Inquisition.config().town;
        const st = Inquisition.state(world);
        const busy = new Set(st.list.filter(i => i.phase === 'hearing').map(i => _key(i.q, i.r)));
        st.towns = st.towns.filter(key => {
            const [q, r] = key.split(',').map(Number);
            const s = _settlementAt(world, q, r);
            const t = s && s.inquisition;
            if (!t) return false;
            if (busy.has(key)) return true;
            t.fear = Math.max(0, Math.round((_num(t.fear) - _num(T.fearDecay, 0.6)) * 10) / 10);
            if (t.fear <= 0 && _num(t.informers) > 0 && _u(world, `infd|${key}|${day}`) < 0.02) t.informers--;
            t.mood = -Math.round(t.fear * _num(T.moodPerFear, 0.12) * 10) / 10;
            return t.fear > 0;
        });
    },

    _inqDay(world, player, inq, day, out) {
        const k = _kingdom(world, inq.kingdomId);
        const see = HolyWars.see(world, inq.seeKey);
        if (day >= _num(inq.dies)) return Inquisition._retire(world, player, inq, `${inq.name} has died`, out);
        if (day >= _num(inq.until)) return Inquisition._retire(world, player, inq, 'the commission has run its years', out);
        if (!_alive(k) || !see || HolyWars.keyOfRealm(k) !== inq.seeKey) return Inquisition._retire(world, player, inq, 'the realm no longer keeps his faith', out);
        if (!Inquisition.law(world, k.id).admit) return Inquisition._retire(world, player, inq, 'the crown has proclaimed tolerance', out);
        // A week's spending of his own purse where he is
        if (day % 7 === 0 && inq.purse > 0) {
            const s = _settlementAt(world, inq.q, inq.r);
            const spend = Utils.centsDown(inq.purse * _num(Inquisition.config().keep.spendShare, 0.2));
            if (s && spend > 0) { Economy.payTown(s, spend); inq.purse = _r2(inq.purse - spend); }
        }
        if (inq.phase === 'travel') {
            if (day >= _num(inq.arrive)) Inquisition._arrive(world, player, inq, day, out);
            return null;
        }
        if (inq.phase === 'rest') {
            if (day >= _num(inq.restUntil)) Inquisition._travel(world, player, inq, day);
            return null;
        }
        // The hearing
        Inquisition._hearingDay(world, player, inq, day, out);
        if (player) Inquisition._weighPlayer(world, player, inq, day, out);
        if (day >= _num(inq.hearingEnd)) {
            const R = Inquisition.config().travel;
            inq.phase = 'rest';
            inq.restUntil = day + Math.round(_range(world, `rest|${inq.id}|${day}`, R.restDays, [3, 8]));
        }
        return null;
    },

    // ──────────── THE PLAYER ────────────

    /** Does the player rule the town at (q, r): the realm, or the town in their own name? */
    _rulesTown(player, world, q, r) {
        if (!player) return false;
        const s = _settlementAt(world, q, r);
        if (!s) return false;
        const k = _ruled(player, world);
        if (k && s.kingdom === k.id) return true;
        return _arr(player.settlements).some(t => t && t.q === q && t.r === r);
    },

    /** How suspect the player is to this inquisitor: { value 0..100, parts }. */
    suspicion(player, world, inq) {
        const S = Inquisition.config().suspicion;
        const parts = [];
        const add = (label, v) => { v = Math.round(v); if (v) parts.push({ label, value: v }); return v; };
        if (!player || !inq) return { value: 0, parts };
        const day = _day(world);
        const p = Inquisition.pstate(player);
        const creed = Devotion.creed(player);
        let t = 0;
        if (!creed) t += add('No faith', _num(S.noCreed, 20));
        else if (creed.id === 'own') t += add(`Your own faith, ${creed.name}`, _num(S.own, 55));
        else if (creed.id !== inq.faithId) t += add(`A stranger's faith, ${creed.name}`, _num(S.foreign, 40));
        t += add('Your standing with the clergy', Devotion.standing(player, inq.faithId) * _num(S.perStanding, -0.35));
        if (SoulPact.isSold(player)) t += add('Whispers of a bargain', _num(S.soulPact, 25));
        if (day - _num(p.lastObstruct, -1e9) < YEAR) t += add('You hindered a hearing', _num(S.obstructed, 15) * Math.min(3, Math.max(1, _num(p.obstructions))));
        if (day - _num(p.bribeRefused, -1e9) < YEAR) t += add('A bribe refused', _num(S.bribeRefused, 25));
        const s = _settlementAt(world, inq.q, inq.r);
        if (s && s.inquisition && _num(s.inquisition.informers)) t += add("The town's informers", _num(s.inquisition.informers) * _num(S.perInformer, 2));
        if (HolyWars.playerBannedFrom(player, world, inq.faithId)) t += add('Cast out of the faith', _num(S.banned, 30));
        if (_num(p.favour[inq.id]) > day) t += add('You hosted him', _num(S.hosted, -25));
        t += add('The name of your House', House.getPrestige(player) * _num(S.perPrestige, -0.01));
        return { value: _clamp(Math.round(t), 0, 100), parts };
    },

    /** An inquisitor in the player's town (or one they rule) weighs them: suspect enough, a summons. */
    _weighPlayer(world, player, inq, day, out) {
        const S = Inquisition.config().suspicion;
        const p = Inquisition.pstate(player);
        if (p.summons || player.jailState) return;
        const here = player.q === inq.q && player.r === inq.r;
        if (!here && !Inquisition._rulesTown(player, world, inq.q, inq.r)) return;
        if (day - _num(p.lastHeard, -1e9) < YEAR / 2) return;
        if (Inquisition.suspicion(player, world, inq).value < _num(S.summonAt, 50)) return;
        p.summons = { inqId: inq.id, name: inq.name, q: inq.q, r: inq.r, town: inq.town, kingdomId: inq.kingdomId, faithId: inq.faithId, day, due: day + _num(S.dueDays, 7) };
        // (he waits for you)
        inq.hearingEnd = Math.max(_num(inq.hearingEnd), p.summons.due);
        const text = Inquisition.text('summons', { inq: inq.name, town: inq.town, due: p.summons.due });
        Inquisition._plog(player, world, text);
        out.notices.push({ icon: '📜', title: 'Summoned by the Inquisition', text, type: 'error' });
        Interrupts.raise(world, { reason: 'The inquisition summons you', icon: '📜', source: 'inquisition' });
    },

    /** The summons not answered by its day: a warrant for heresy, the see's grievance. */
    _summonsDay(world, player, day, out) {
        const p = player && player.inquisition;
        const sm = p && p.summons;
        if (!sm || day <= sm.due) return;
        const P = Inquisition.config().player;
        p.summons = null;
        p.lastHeard = day;
        Wanted.charge(player, world, { kingdomId: sm.kingdomId, label: 'heresy', gold: _num(P.fleeBounty, 300), grave: true });
        const see = HolyWars.see(world, (Inquisition.get(world, sm.inqId) || {}).seeKey) || HolyWars.seeOfRealm(world, _kingdom(world, sm.kingdomId));
        if (see && !HolyWars.playerHeads(player, see)) HolyWars.playerGrievance(player, world, see, _num(P.fleeGrievance, 25));
        p.record.unshift({ day, inq: sm.name, town: sm.town, verdict: 'fled' });
        const k = _kingdom(world, sm.kingdomId);
        const text = Inquisition.text('fled', { inq: sm.name, realm: k ? Names.realm(k.name) : 'the realm' });
        Inquisition._plog(player, world, text);
        out.notices.push({ icon: '📜', title: 'A Warrant for Heresy', text, type: 'error' });
    },

    /** The inquisitor in the player's town (holding a hearing or resting there), or null. */
    here(player, world) {
        if (!player) return null;
        return Inquisition.at(world, player.q, player.r)[0] || null;
    },

    _pay(player, amount, cat = 'inquisition') {
        const a = _r2(Math.max(0, amount));
        if (_num(player.gold) < a) return false;
        player.gold = _r2(_num(player.gold) - a);
        Ledger.record(player, cat, -a);
        return true;
    },

    bribeCost(inq) {
        const P = Inquisition.config().player;
        return Math.round(_num(P.bribeBase, 200) + _num(P.bribePerZeal, 500) * _num(inq.zeal, 0.6));
    },

    /** What the player may do about the inquisitor in their town: [{ act, ok, reason, cost }]. */
    options(player, world, inq) {
        const P = Inquisition.config().player;
        const day = _day(world);
        const p = Inquisition.pstate(player);
        const here = !!inq && player.q === inq.q && player.r === inq.r;
        const rules = !!inq && (Inquisition._rulesTown(player, world, inq.q, inq.r) || (_ruled(player, world) && _ruled(player, world).id === inq.kingdomId));
        const out = [];
        if (!inq) return out;
        out.push({ act: 'host', cost: _num(P.hostCost, 120), ok: here && !(_num(p.favour[inq.id]) > day) && _num(player.gold) >= _num(P.hostCost, 120), reason: !here ? 'He is not in this town.' : _num(p.favour[inq.id]) > day ? 'You have hosted him already.' : `It costs ${Utils.formatGold(_num(P.hostCost, 120))} gold.` });
        const bc = Inquisition.bribeCost(inq);
        out.push({ act: 'bribe', cost: bc, ok: here && _num(player.gold) >= bc, reason: !here ? 'He is not in this town.' : `It would take ${Utils.formatGold(bc)} gold.` });
        out.push({ act: 'obstruct', cost: 0, ok: here && inq.phase === 'hearing', reason: !here ? 'He is not in this town.' : 'No hearing is sitting.' });
        out.push({ act: 'expel', cost: 0, ok: rules, reason: 'Only the lord of the town or the realm may expel him.' });
        return out.map(o => (o.ok ? { ...o, reason: null } : o));
    },

    /** The player acts: host | bribe | obstruct | expel. */
    act(player, world, inqId, act) {
        const P = Inquisition.config().player;
        const inq = Inquisition.get(world, inqId);
        if (!inq) return { success: false, reason: 'There is no such inquisitor.' };
        const opt = Inquisition.options(player, world, inq).find(o => o.act === act);
        if (!opt) return { success: false, reason: 'That cannot be done.' };
        if (!opt.ok) return { success: false, reason: opt.reason };
        const day = _day(world);
        const p = Inquisition.pstate(player);
        const s = _settlementAt(world, inq.q, inq.r);
        const see = HolyWars.see(world, inq.seeKey);
        if (act === 'host') {
            if (!Inquisition._pay(player, opt.cost)) return { success: false, reason: opt.reason };
            if (s) Economy.payTown(s, opt.cost);
            p.favour[inq.id] = day + _num(P.hostDays, 360);
            Devotion._addStanding(player, inq.faithId, 3);
            const text = `You feast ${inq.name} and his clerks. He leaves your name off his roll, and speaks well of your piety.`;
            Inquisition._plog(player, world, text);
            return { success: true, text };
        }
        if (act === 'bribe') {
            const take = _u(world, `bribe|${inq.id}|${day}`) < _num(inq.greed, 0.5) * (1 - _num(inq.zeal, 0.6) * 0.6);
            if (!take) {
                p.bribeRefused = day;
                if (see && !HolyWars.playerHeads(player, see)) HolyWars.playerGrievance(player, world, see, 15);
                const text = `${inq.name} looks at your purse and then at you. "The Church is not for sale." He writes your name in his book.`;
                Inquisition._plog(player, world, text);
                return { success: true, accepted: false, text };
            }
            Inquisition._pay(player, opt.cost, 'bribes');
            inq.purse = _r2(_num(inq.purse) + opt.cost);
            p.favour[inq.id] = day + _num(P.hostDays, 360);
            if (p.summons && p.summons.inqId === inq.id) p.summons = null;
            if (inq.phase === 'hearing') { inq.phase = 'rest'; inq.restUntil = day + 1; }
            const text = `${Utils.formatGold(opt.cost)} gold changes hands. ${inq.name} finds ${inq.town} free of heresy after all, and rides on.`;
            Inquisition._plog(player, world, text);
            return { success: true, accepted: true, text };
        }
        if (act === 'obstruct') {
            inq.hearingEnd = Math.max(day + 1, _num(inq.hearingEnd) - _num(P.obstructDays, 3));
            inq.convictMult = 0.5;
            player.karma = Math.min(100, _num(player.karma) + _num(P.obstructKarma, 2));
            p.obstructions = _num(p.obstructions) + 1;
            p.lastObstruct = day;
            const t = Inquisition.town(s);
            if (t) t.fear = Math.max(0, _num(t.fear) - 8);
            const caught = _u(world, `caught|${inq.id}|${day}`) < _num(P.obstructCaught, 0.06) * Math.max(1, _num(t && t.informers));
            let text = `You warn the accused, hide two of them in a cellar and lose the hearing's papers. The hearing in ${inq.town} will be shorter, and fewer will burn.`;
            if (caught) {
                const out = { notices: [] };
                p.lastHeard = -1e9;
                Inquisition._weighPlayer(world, player, inq, day, out);
                if (see && !HolyWars.playerHeads(player, see)) HolyWars.playerGrievance(player, world, see, 20);
                text += ' But an informer saw you.' + (p.summons ? ` ${inq.name} summons you to answer for it by day ${p.summons.due}.` : '');
            }
            Inquisition._plog(player, world, text);
            return { success: true, caught, text };
        }
        // expel
        const k = _ruled(player, world);
        const realm = !!(k && k.id === inq.kingdomId);
        if (realm) Inquisition._retire(world, player, inq, 'expelled by the crown', null);
        else {
            const t = Inquisition.town(s);
            if (t) t.barredUntil = day + YEAR * 2;
            inq.phase = 'rest';
            inq.restUntil = day + 1;
        }
        if (see && !HolyWars.playerHeads(player, see)) HolyWars.playerGrievance(player, world, see, _num(P.expelGrievance, 40));
        Devotion._addStanding(player, inq.faithId, _num(P.expelStanding, -15));
        const rk = _kingdom(world, inq.kingdomId);
        if (rk && rk.religion) rk.religion.piety = _clamp(_num(rk.religion.piety, 50) + _num(P.expelPiety, -5), 0, 100);
        const t2 = Inquisition.town(s);
        if (t2) t2.fear = Math.max(0, _num(t2.fear) - 20);
        if (p.summons && p.summons.inqId === inq.id) p.summons = null;
        const text = `${Inquisition.text('expelled', { inq: inq.name })}${realm ? ' He leaves the realm.' : ` He may not hold a hearing in ${inq.town} again.`}`;
        Inquisition._plog(player, world, text);
        if (player.house) House._chronicle(player.house, world, `${player.name || 'The head of the House'} expelled the inquisitor ${inq.name}${realm ? ' from the realm' : ` from ${inq.town}`}.`, ['faith']);
        return { success: true, text };
    },

    /** The odds the player is found guilty at their hearing (0..1). */
    guiltOdds(player, world, inq) {
        if (!inq) return 0;
        const sus = Inquisition.suspicion(player, world, inq).value;
        return _clamp(_logit((sus - 50) / 15 + (_num(inq.zeal, 0.6) - 0.5) - Devotion.standing(player, inq.faithId) / 40), 0.03, 0.97);
    },

    /** The player answers the summons in person: 'stand' (the hearing) or 'recant'. */
    answerSummons(player, world, how = 'stand') {
        const P = Inquisition.config().player;
        const p = Inquisition.pstate(player);
        const sm = p.summons;
        if (!sm) return { success: false, reason: 'You are not summoned.' };
        if (player.q !== sm.q || player.r !== sm.r) return { success: false, reason: `Answer the summons in ${sm.town}.` };
        const inq = Inquisition.get(world, sm.inqId);
        const day = _day(world);
        const see = inq ? HolyWars.see(world, inq.seeKey) : null;
        const s = _settlementAt(world, sm.q, sm.r);
        const give = (gold) => {
            const g = Math.min(_num(player.gold), Math.max(0, Math.round(gold)));
            if (g <= 0) return 0;
            player.gold = _r2(_num(player.gold) - g);
            Ledger.record(player, 'inquisition', -g);
            if (see) HolyWars.deposit(world, player, see, g, null);
            else if (s) Economy.payTown(s, g);
            return g;
        };
        p.summons = null;
        p.lastHeard = day;
        let verdict;
        let text;
        if (how === 'recant') {
            const g = give(Math.max(30, _num(player.gold) * _num(P.recantShare, 0.05)));
            Devotion._addStanding(player, sm.faithId, _num(P.recantStanding, -12));
            if (player.house) House.spend(player.house, Math.min(_num(player.house.prestige), _num(P.recantPrestige, 15)), 'recanted before the inquisition', day);
            verdict = 'recanted';
            text = `You abjure your errors on your knees before ${sm.name}, and pay ${Utils.formatGold(g)} gold in penance. The town watches.`;
        } else {
            const odds = Inquisition.guiltOdds(player, world, inq || { zeal: 0.6, faithId: sm.faithId, q: sm.q, r: sm.r });
            const roll = _u(world, `phear|${sm.inqId}|${day}|${Math.round(_num(player.gold))}`);
            const sus = inq ? Inquisition.suspicion(player, world, inq).value : 50;
            const law = Inquisition.law(world, sm.kingdomId);
            if (roll >= odds) {
                verdict = 'acquitted';
                Devotion._addStanding(player, sm.faithId, 3);
                if (inq) p.favour[inq.id] = day + _num(P.hostDays, 360) / 2;
                text = Inquisition.text('acquitted', { inq: sm.name });
            } else if (sus >= _num(P.relapseAt, 80) && law.burn) {
                verdict = 'relapsed';
                const g = give(_num(player.gold) * _num(P.confiscateShare, 0.3));
                Wanted.charge(player, world, { kingdomId: sm.kingdomId, label: 'heresy', gold: _num(P.heresyBounty, 500), grave: true });
                text = `${Inquisition.text('relapsed', { inq: sm.name })} ${Utils.formatGold(g)} gold of your goods are seized for the Church.`;
                if (s && !player.jailState) {
                    const r = Underworld._arrest(player, world, s, 'heresy');
                    text += ` ${r.text} You will be tried for heresy.`;
                }
                if (see && !HolyWars.playerHeads(player, see)) HolyWars.playerGrievance(player, world, see, 40);
            } else if (roll < odds * 0.45) {
                verdict = 'confiscated';
                const g = give(_num(player.gold) * _num(P.confiscateShare, 0.3));
                Devotion._addStanding(player, sm.faithId, -6);
                text = Inquisition.text('confiscated', { inq: sm.name, gold: Utils.formatGold(g) });
            } else {
                verdict = 'penance';
                const g = give(Math.max(20, _num(player.gold) * _num(P.penanceShare, 0.08)));
                Devotion._addStanding(player, sm.faithId, -2);
                text = Inquisition.text('penance', { inq: sm.name, gold: Utils.formatGold(g) });
            }
        }
        p.record.unshift({ day, inq: sm.name, town: sm.town, verdict });
        if (p.record.length > 12) p.record.length = 12;
        Inquisition._plog(player, world, text);
        if (player.house && verdict !== 'acquitted') House._chronicle(player.house, world, `${player.name || 'The head of the House'} stood before the inquisitor ${sm.name} at ${sm.town}: ${verdict}.`, ['faith', 'trial']);
        return { success: true, verdict, text };
    },

    /** A High Priest sends an inquisitor into a realm of his faith. */
    send(player, world, kingdomId) {
        const see = HolyWars.headedSee(player, world);
        const k = _kingdom(world, kingdomId);
        const C = Inquisition.config();
        if (!see) return { success: false, reason: 'Only the head of a faith sends inquisitors.' };
        if (!_alive(k) || HolyWars.keyOfRealm(k) !== see.key) return { success: false, reason: 'That realm is not of your faith.' };
        if (!Inquisition.law(world, k.id).admit) return { success: false, reason: `${Names.realm(k.name, true)} admits no inquisitor.` };
        if (Inquisition.state(world).list.some(i => i.kingdomId === k.id)) return { success: false, reason: 'An inquisitor already rides there.' };
        const cost = _num(C.spawn.commission, 150);
        if (!Inquisition._pay(player, cost, 'faith')) return { success: false, reason: `The commission costs ${Utils.formatGold(cost)} gold.` };
        const cap = _settlementAt(world, k.capital.q, k.capital.r);
        if (cap) Economy.payTown(cap, cost);
        const inq = Inquisition.commission(world, see, k, { by: 'player' });
        return { success: true, text: `You send ${inq.name} to root out heresy in ${Names.realm(k.name)}.` };
    },

    // ──────────── THE DAY ────────────

    processDay(world, player = null) {
        const out = { notices: [] };
        const C = Inquisition.config();
        if (!world || C.enabled === false || !Array.isArray(world.kingdoms)) return out;
        const st = Inquisition.state(world);
        const day = _day(world);
        if (day % 7 === 5) Inquisition._spawnWeek(world, player, day);
        for (const inq of st.list.slice()) Inquisition._inqDay(world, player, inq, day, out);
        Inquisition._townsDay(world, day);
        if (player) Inquisition._summonsDay(world, player, day, out);
        return out;
    },

    /** For the panel. */
    view(world, player) {
        const st = Inquisition.state(world);
        const here = Inquisition.here(player, world);
        return {
            list: st.list.slice(), past: st.past.slice(0, 6), log: st.log.slice(0, 8), here,
            options: here ? Inquisition.options(player, world, here) : [],
            suspicion: here ? Inquisition.suspicion(player, world, here) : null,
            summons: player && player.inquisition ? player.inquisition.summons : null,
            p: Inquisition.pstate(player),
        };
    },
};
