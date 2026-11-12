// ============================================
// SCAVENGERS — the townsfolk who rob the dead: grave robbers and body looters
// ============================================
// Two kinds of people go through what the dead (and the senseless) leave:
//
//   GRAVE ROBBERS — at night, now and then, someone digs up a grave for what
//   was buried with it: a desperate or crooked townsperson (a beggar, the
//   poor, the bold and stubborn), one of an outlaw lair's men when a lair lies
//   near, or in a town big enough for physicians (data: snatcherTypes) a
//   body-snatcher after a fresh corpse. They go for graves known to hold
//   goods — the gentry's, a burial of the player's laid with grave goods, a
//   cache someone watched buried. The grave they rob is OPEN in the morning
//   (the churchyard's lifecycle, world/burials.js for the player's own): the
//   marker still standing (knocked askew), the goods gone — fenced into the
//   town's market (SettlementMarket.add) and the coin into the robber's purse.
//   Seen by the watch, the robber is taken and the goods stay. In the days
//   after, the sexton fills it in again and the town talks of it (the annals:
//   'graveRobbed', the priest's anger, the kin's).
//   Off the player's map it happens in processDay; on it, the street map
//   plays it out (ui/innerMapScavengers.js), through the same plan and commit.
//
//   LOOTERS — someone lying in the street, senseless, bound or dead (and the
//   player, knocked out): an opportunist nearby (a beggar, the bold and
//   stubborn, an outlaw, a soldier after a fight) kneels by them and goes
//   through their things — coin and valuables first, then gear. Kin and
//   friends of the fallen take their things for safekeeping (no theft); the
//   watch and honest folk raise the alarm instead. What was taken is noted on
//   the victim (they know when they wake) and, if anyone saw it, it is the
//   looter's crime (StreetCrime.recordNpcCrime: the witnesses remember who,
//   the watch takes them).
//
// Explicit params; no globals; every chance a hash of the world seed, the
// place and the day (or who and whom) — never the shared RNG, so a reload
// tells the same story and the goldens are untouched. Data: data/digging.json
// `graveRobbers`, `looters`.

import { DataLoader } from '../core/dataLoader.js';
import { GraveBook } from '../world/graveBook.js';
import { Burials } from '../world/burials.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Economy } from '../world/economy.js';
import { PlayerInventory } from '../core/inventory.js';
import { Townsfolk } from './townsfolk.js';
import { StreetCrime } from './streetCrime.js';
import { OutlawLairs } from './outlawLairs.js';
import { Arms } from './arms.js';

const DEFAULTS = {
    graveRobbers: {
        enabled: true,
        // the chance a night that someone in town robs a grave (none without a grave worth it)
        perNight: { village: 0.006, town: 0.01, city: 0.014, capital: 0.016 },
        lairMult: 2, lairRadius: 4, lairShare: 0.5,
        snatcherTypes: ['city', 'capital'], snatcherShare: 0.2, snatcherFreshDays: 120,
        poorRoles: ['beggar', 'villager', 'farmer'], crookedTraits: ['bold', 'stubborn'], honestTraits: ['kind', 'generous'],
        weights: { goods: 3, playerGoods: 4, seenCache: 6 },
        // the chance the watch catches one at it, off the player's map
        watchChance: { village: 0.05, town: 0.12, city: 0.18, capital: 0.22 },
        nightFrom: 22, nightTo: 4, digSeconds: 14, toolShare: 0.6, fenceShare: 0.5,
    },
    looters: {
        enabled: true,
        scanSeconds: 2, radius: 7, kneelSeconds: 4,
        chance: { opportunist: 0.55, soldier: 0.6, kin: 0.7 },
        opportunistTypes: ['beggar', 'bandit', 'outlaw', 'thief', 'pirate'],
        soldierTypes: ['soldier'],
        crookedTraits: ['bold', 'stubborn'], honestTraits: ['kind', 'generous', 'cautious'],
        valuables: ['jewelry', 'gems', 'grave_goods', 'silver', 'gold_bar', 'pearls'],
        maxItems: 2, playerGoldShare: 0.6,
        barks: {
            loot: ['Nobody\'ll miss this.', 'They won\'t be needing it.', 'Finders keepers.'],
            kin: ['I\'ll keep these safe for you.', 'Let me hold on to these for them.'],
            alarm: ['Help! Someone\'s down!', 'Fetch the watch!'],
            robber: ['Dig, dig…', 'Quiet now…'],
        },
    },
};

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

/** A well-mixed hash of a string, in [0, 1). */
function _frac(str) {
    const s = String(str);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

function _merge(base, over) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
        if (k.startsWith('_')) continue;
        out[k] = (_obj(v) && _obj(base[k])) ? _merge(base[k], v) : v;
    }
    return out;
}

const _seed = world => (world && world.generationParams && world.generationParams.seed) || 0;
const _byType = (table, type) => _num((table || {})[type], _num((table || {}).town, 0));

/** Pick from weighted entries [{ w, ... }] by a hash in [0, 1). */
function _weighted(list, f) {
    const total = list.reduce((a, x) => a + x.w, 0);
    if (total <= 0) return null;
    let t = f * total;
    for (const x of list) { t -= x.w; if (t < 0) return x; }
    return list[list.length - 1];
}

export const Scavengers = {
    DEFAULTS,

    config() {
        const d = (DataLoader._gamedata && DataLoader._gamedata.digging) || {};
        return {
            graveRobbers: _merge(DEFAULTS.graveRobbers, d.graveRobbers),
            looters: _merge(DEFAULTS.looters, d.looters),
        };
    },

    // ══════════════════════════════════════════════
    // GRAVE ROBBERS
    // ══════════════════════════════════════════════

    /** Is the hour (0-24) a grave robber's? */
    isNight(hour) {
        const R = Scavengers.config().graveRobbers;
        const h = _num(hour, 12);
        return R.nightFrom > R.nightTo ? (h >= R.nightFrom || h < R.nightTo) : (h >= R.nightFrom && h < R.nightTo);
    },

    /**
     * The graves (and caches) in a town worth robbing tonight, weighted: [{ w, kind:
     * 'plot'|'burial'|'cache', ... }]. snatcher: fresh graves for their bodies.
     */
    targets(world, s, day, snatcher = false) {
        const R = Scavengers.config().graveRobbers;
        const W = R.weights;
        const out = [];
        for (const ground of GraveBook.grounds(s)) {
            for (let i = 0; i < ground.cap; i++) {
                const gr = ground.plots[i];
                if (!gr || gr.kin || gr.open != null || gr.bodyTaken) continue;
                if (snatcher) {
                    const at = gr.interred != null ? gr.interred : gr.died;
                    if (day - _num(at) <= _num(R.snatcherFreshDays, 120)) out.push({ w: 1 + _num(gr.goods), kind: 'plot', ground: ground.id, i, grave: gr });
                } else if (_num(gr.goods) > 0) {
                    out.push({ w: _num(gr.goods) * _num(W.goods, 3), kind: 'plot', ground: ground.id, i, grave: gr });
                }
            }
        }
        const hex = `${s.q},${s.r}`;
        for (const [k, g] of Object.entries(Burials.record(world, hex) || {})) {
            // (one buried alive and still crying under it: a robber who digs there digs them out — ui/innerMapScavengers.js)
            if (!g || g.kind !== 'grave' || g.open != null || Burials.isEmpty(g.goods)) continue;
            if (snatcher && (!g.body || day - _num(g.day) > _num(R.snatcherFreshDays, 120))) continue;
            const [q, r] = k.split(',').map(Number);
            out.push({ w: _num(W.playerGoods, 4), kind: 'burial', hex, q, r, grave: g });
        }
        if (!snatcher) {
            for (const [k, c] of Object.entries(Burials.cacheRecord(world, hex) || {})) {
                if (!c || c.open || c.taken || Burials.isEmpty(c) || !(c.seen || []).length) continue;
                const [q, r] = k.split(',').map(Number);
                out.push({ w: _num(W.seenCache, 6), kind: 'cache', hex, q, r, cache: c });
            }
        }
        return out;
    },

    /** Who robs graves here tonight: { name, kind: 'townsfolk'|'outlaw'|'snatcher', pid? } or null. */
    robberFor(world, s, day, player = null, snatcher = false) {
        const R = Scavengers.config().graveRobbers;
        const key = `${_seed(world)}|robber|${s.q},${s.r}|${day}`;
        if (snatcher) return { name: 'a body-snatcher', kind: 'snatcher' };
        const lair = Scavengers._lairNear(world, s, player);
        if (lair && _frac(`${key}|lair`) < _num(R.lairShare, 0.5)) return { name: `one of ${lair.name || 'the outlaws'}'s men`, kind: 'outlaw', lair: lair.id || null };
        const folk = s.folk;
        const pool = folk ? Townsfolk.residents(folk).filter(p => {
            if (p.role === 'child' || p.role === 'guard' || p.role === 'priest' || p.role === 'noble') return false;
            const t = p.traits || [];
            if (t.some(x => (R.honestTraits || []).includes(x))) return false;
            return (R.poorRoles || []).includes(p.role) && (p.role === 'beggar' || t.some(x => (R.crookedTraits || []).includes(x)));
        }) : [];
        if (pool.length) {
            const p = pool[Math.floor(_frac(`${key}|who`) * pool.length) % pool.length];
            return { name: Townsfolk.name(p), kind: 'townsfolk', pid: p.id };
        }
        return lair ? { name: `one of ${lair.name || 'the outlaws'}'s men`, kind: 'outlaw', lair: lair.id || null } : null;
    },

    _lairNear(world, s, player) {
        if (!player) return null;
        const R = Scavengers.config().graveRobbers;
        let best = null;
        let lairs = [];
        try { lairs = OutlawLairs.active(player) || []; } catch { lairs = []; }
        for (const l of lairs) {
            const d = Math.max(Math.abs(_num(l.q) - s.q), Math.abs(_num(l.r) - s.r));
            if (d <= _num(R.lairRadius, 4) && (!best || d < best.d)) best = { l, d };
        }
        return best ? best.l : null;
    },

    /**
     * Tonight's robbery in a town, if there is one: { robber, target, day } — the
     * same answer every time it is asked (a hash of the seed, the town, the day).
     */
    plan(world, s, day, player = null) {
        const R = Scavengers.config().graveRobbers;
        if (!R.enabled || !s || !GraveBook.config().enabled) return null;
        const g = s.graveyard;
        if (g && g.robbedNight === day) return null;
        const key = `${_seed(world)}|rob|${s.q},${s.r}|${day}`;
        let p = _byType(R.perNight, s.type);
        if (Scavengers._lairNear(world, s, player)) p *= _num(R.lairMult, 2);
        if (_frac(key) >= p) return null;
        const snatcher = (R.snatcherTypes || []).includes(s.type) && _frac(`${key}|snatch`) < _num(R.snatcherShare, 0.2);
        let targets = Scavengers.targets(world, s, day, snatcher);
        let snatch = snatcher;
        if (!targets.length && snatcher) { targets = Scavengers.targets(world, s, day, false); snatch = false; }
        if (!targets.length) return null;
        const target = _weighted(targets, _frac(`${key}|target`));
        const robber = Scavengers.robberFor(world, s, day, player, snatch);
        if (!target || !robber) return null;
        return { robber, target, day, snatch };
    },

    /**
     * How long a robber digs at it, by the digging's own rule (data/digging.json:
     * a set of tools × toolSpeed; a cache's shallow hole by seconds.dig against
     * a grave's seconds.exhume): digSeconds is the work bare-handed. A body-
     * snatcher or an outlaw comes with a spade; a townsperson brings one
     * toolShare of the time (a hash of who and the night). → seconds
     */
    robSeconds(plan) {
        const R = Scavengers.config().graveRobbers;
        const D = (DataLoader._gamedata && DataLoader._gamedata.digging) || {};
        const S = D.seconds || {};
        const base = _num(R.digSeconds, 14);
        const robber = (plan && plan.robber) || {};
        const tooled = robber.kind === 'snatcher' || robber.kind === 'outlaw'
            || _frac(`robtools|${robber.pid != null ? robber.pid : robber.name}|${plan && plan.day}`) < _num(R.toolShare, 0.6);
        const kind = plan && plan.target && plan.target.kind === 'cache' ? _num(S.dig, 5) / Math.max(0.1, _num(S.exhume, 5)) : 1;
        return Math.max(1, base * kind * (tooled ? _num(D.toolSpeed, 0.6) : 1));
    },

    /** Where a robbery's target lies on the town map: the tile to dig at ({ q, r }) — a plot's foot, a burial's mound, a cache. */
    spotOf(target, cellsOf) {
        if (!target) return null;
        if (target.kind === 'plot') {
            const c = typeof cellsOf === 'function' ? cellsOf(target.ground, target.i) : null;
            return c ? { q: c.q, r: c.r + 1 } : null;
        }
        return { q: target.q, r: target.r };
    },

    /**
     * Carry out a robbery: the grave opened (marker kept, askew), its goods gone
     * into the robber's hands (fenced into the town's market, the coin into their
     * purse), the cache emptied. opts: { caught (the watch took them: the goods
     * stay), seenBy: [names], guards, here (the player saw it on the map) }.
     * → { took: { items, gold }, text, caught, crime }
     */
    commit(world, s, plan, day, opts = {}) {
        if (!plan || !s) return null;
        const g = GraveBook.of(s);
        if (g) g.robbedNight = day;
        const t = plan.target;
        const robber = plan.robber;
        const caught = !!opts.caught;
        const seen = Array.isArray(opts.seenBy) ? opts.seenBy.filter(Boolean) : [];
        const by = caught || seen.length ? robber.name : null;
        const took = { items: {}, gold: 0 };
        let what = 'a grave';
        if (t.kind === 'plot') {
            const ground = (s.graveyard && s.graveyard.grounds && s.graveyard.grounds[t.ground]) || null;
            const gr = ground && ground.plots[t.i];
            if (!gr || gr.open != null) return null;
            what = `the grave of ${gr.name}`;
            gr.open = day;
            gr.robbed = day;
            gr.robbedBy = by;
            if (gr.marker) gr.askew = true;
            if (!caught) {
                if (_num(gr.goods) > 0) { took.items.grave_goods = _num(gr.goods); gr.goods = 0; }
                if (plan.snatch) gr.bodyTaken = true;
            }
            Scavengers._noteOpen(s, t.ground, t.i);
        } else if (t.kind === 'burial') {
            const gb = Burials.at(world, t.hex, t.q, t.r);
            if (!gb || gb.open != null) return null;
            what = gb.marker ? `the grave of ${gb.name}` : 'a burial mound';
            const goods = Burials.openGrave(gb, day, true);
            gb.robbedBy = by;
            if (caught) { if (goods) gb.goods = goods; } else {
                if (goods) { took.gold = _num(goods.gold); Object.assign(took.items, goods.items || {}); }
                if (plan.snatch) Burials.takeBody(gb);
            }
        } else if (t.kind === 'cache') {
            const c = Burials.cacheAt(world, t.hex, t.q, t.r);
            if (!c || c.open || c.taken) return null;
            what = 'something buried';
            if (!caught) {
                took.gold = _num(c.gold);
                Object.assign(took.items, c.items || {});
                c.taken = { by: robber.name, day, seen: seen.length > 0 };
                c.items = {};
                c.gold = 0;
            }
        }
        if (!caught) Scavengers.fence(s, robber, took);
        // Seen at it: the robber's crime, on the town's record (the witnesses remember who)
        let crime = null;
        if (seen.length || caught) {
            crime = StreetCrime.recordNpcCrime(world, s, {
                k: 'graveRobbing', by: robber.name, byPid: robber.pid != null ? robber.pid : null, victim: what, d: day,
                seenBy: seen, caught, witnesses: opts.witnesses || [],
            });
        }
        if (caught && robber.pid != null && s.folk) {
            const p = Townsfolk.get(s.folk, robber.pid);
            if (p) Townsfolk.note(p, day, 'jailed', null, 'grave robbing');
        }
        const text = caught
            ? `${robber.name} was caught by the watch digging up ${what}.`
            : `${_cap(robber.name)} dug up ${what}${Burials.isEmpty(took) ? '' : ` and made off with ${Burials.describe(took)}`}.`;
        return { took, text, caught, crime, what, by };
    },

    /** The goods go where stolen goods go: fenced into the town's market; the coin into the robber's purse (robber.pid: a townsperson). */
    fence(s, robber, took) {
        const p = robber && robber.pid != null && s.folk ? Townsfolk.get(s.folk, robber.pid) : null;
        let coin = _num(took.gold);
        for (const [id, n] of Object.entries(took.items || {})) {
            // A good the market keeps goes into its stock (sold on); any other (trinkets, grave goods) to a
            // fence at fenceShare of its worth — his coin is the town's (out of its purse) — when a
            // townsperson robbed it; an outlaw or a snatcher carries it off out of town
            if (SettlementMarket.tracks(id)) { SettlementMarket.add(s, id, _num(n)); continue; }
            if (!p) continue;
            const want = Math.floor(PlayerInventory.goodValue(id) * _num(n) * _num(Scavengers.config().graveRobbers.fenceShare, 0.5));
            if (want > 0 && s.economy) coin += Economy.drawTown(s, want) || 0;
            took.fenced = _num(took.fenced) + _num(n);
        }
        if (p && coin > 0) p.purse = _num(p.purse) + coin;
        took.coin = coin;
    },

    /** An open grave, for the sexton to fill in and the town to find. */
    _noteOpen(s, groundId, i) {
        const g = GraveBook.of(s);
        if (!g) return;
        if (!Array.isArray(g.openGraves)) g.openGraves = [];
        if (!g.openGraves.some(x => x.g === groundId && x.i === i)) g.openGraves.push({ g: groundId, i });
    },

    /**
     * The sexton's round: graves left open refillDays fill in again, their earth
     * disturbed a while; a robbed one is found, and the town talks of it (the
     * annals, the priest, the kin). Not on the map the player is on (here).
     * → notices for graves the player cares for (their own grounds' and kin's).
     */
    mend(world, s, day) {
        const g = GraveBook.of(s);
        const list = g && Array.isArray(g.openGraves) ? g.openGraves : [];
        const wait = _num(Burials.config().refillDays, 3);
        const keep = [];
        const found = [];
        for (const x of list) {
            const ground = s.graveyard.grounds && s.graveyard.grounds[x.g];
            const gr = ground && ground.plots[x.i];
            if (!gr || gr.open == null) continue;
            if (day - _num(gr.open) < wait) { keep.push(x); continue; }
            gr.open = null;
            gr.disturbed = day;
            gr.askew = false;
            if (gr.robbed != null && !gr.found) {
                gr.found = day;
                g.robberies = _num(g.robberies) + 1;
                if (s.folk && Array.isArray(s.folk.annals)) {
                    Townsfolk.record(s.folk, world, day, { k: 'graveRobbed', a: gr.pid != null ? gr.pid : null, x: `${gr.name}|${gr.robbedBy || ''}` });
                }
                found.push(gr);
            }
        }
        if (g) g.openGraves = keep;
        return found;
    },

    /**
     * Each day, every town but the one the player is on: tonight's robbery, if
     * any (the watch may catch them), and the sexton's round. And the player's
     * own burials and caches (Burials.processDay: those who watched a cache
     * buried come back for it; a burial left open in town is filled in).
     * → { notices, events }
     */
    processDay(world, player = null) {
        const notices = [];
        const events = [];
        if (!world) return { notices, events };
        const day = _num(world.day);
        const here = player && player.q != null ? `${player.q},${player.r}` : null;
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        const towns = new Set();
        for (const s of views) {
            if (!s || s.q == null) continue;
            const hex = `${s.q},${s.r}`;
            towns.add(hex);
            if (hex === here) continue;
            const plan = Scavengers.plan(world, s, day, player);
            if (plan) {
                const R = Scavengers.config().graveRobbers;
                const caught = _frac(`${_seed(world)}|robwatch|${hex}|${day}`) < _byType(R.watchChance, s.type);
                const res = Scavengers.commit(world, s, plan, day, { caught, seenBy: caught ? ['the watch'] : [] });
                if (res) events.push({ kind: 'robbery', hex, ...res, target: plan.target.kind });
            }
            if (s.graveyard) Scavengers.mend(world, s, day);
        }
        for (const e of Burials.processDay(world, day, { here, isTown: h => towns.has(h) })) events.push(e);
        // The player's own burials found robbed: word reaches them (their dead, their goods)
        for (const e of events) {
            if (e.kind === 'robbery' && (e.target === 'burial' || e.target === 'cache') && !e.caught) {
                notices.push({ icon: '🌒', title: 'Grave Robbers', type: 'warning', text: `Word comes that ${e.target === 'cache' ? 'something you buried' : e.what} near ${Scavengers._townName(world, e.hex)} has been dug up${e.by ? ` — ${e.by} was seen at it` : ''}.` });
            }
        }
        return { notices, events };
    },

    _townName(world, hex) {
        const [q, r] = String(hex).split(',').map(Number);
        const t = world && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
        return (t && t.settlement && t.settlement.name) || 'town';
    },

    // ══════════════════════════════════════════════
    // LOOTERS
    // ══════════════════════════════════════════════

    /**
     * What someone near a fallen person does about them: 'kin' (takes their things
     * for safekeeping), 'opportunist' / 'soldier' (loots), 'watch' (the guard: the
     * alarm), 'honest' (fetches help). rel: StreetCrime.relationTo(npc, victim).
     */
    looterKind(npc, rel = null) {
        const L = Scavengers.config().looters;
        if (!npc) return 'honest';
        if (rel && (rel.rel === 'kin' || rel.rel === 'friend')) return 'kin';
        if (npc.type === 'guard') return 'watch';
        if ((L.soldierTypes || []).includes(npc.type) || npc._soldier) return 'soldier';
        if ((L.opportunistTypes || []).includes(npc.type)) return 'opportunist';
        const role = npc._person ? npc._person.role : npc.type;
        const traits = npc.personalityTraits || (npc._person && npc._person.traits) || [];
        if (traits.some(t => (L.honestTraits || []).includes(t))) return 'honest';
        if (role === 'beggar' || traits.some(t => (L.crookedTraits || []).includes(t))) return 'opportunist';
        return 'honest';
    },

    /** Will they do it (a hash of who, whom and the day)? */
    willLoot(kind, key) {
        const L = Scavengers.config().looters;
        if (!L.enabled) return false;
        const p = _num((L.chance || {})[kind], 0);
        return p > 0 && _frac(`loot|${key}`) < p;
    },

    /** Is it theft (or the kin's safekeeping)? */
    isTheft(kind) {
        return kind !== 'kin';
    },

    /**
     * What a looter takes from an inventory ({ id: n }) and a purse: coin and
     * valuables first, then gear (up to maxItems kinds; nothing worn). → { gold, items }
     * (taken out of inv; the purse's share is the caller's to move).
     */
    pickLoot(inv, gold, key, opts = {}) {
        const L = Scavengers.config().looters;
        const out = { gold: Math.max(0, Math.floor(_num(gold) * _num(opts.goldShare, 1))), items: {} };
        const ids = Object.keys(inv || {}).filter(id => id !== 'gold' && _num(inv[id]) > 0 && !(opts.worn && opts.worn(id)));
        const val = new Set(L.valuables || []);
        ids.sort((a, b) => (val.has(b) - val.has(a)) || (_frac(`${key}|${a}`) - _frac(`${key}|${b}`)));
        for (const id of ids.slice(0, Math.max(0, _num(L.maxItems, 2)))) {
            out.items[id] = _num(inv[id]);
            delete inv[id];
        }
        return out;
    },

    /**
     * Loot the knocked-out player: a share of their purse and their valuables
     * first, nothing they wear. Noted on the player (player.lootedWhileOut) for
     * when they come round. → { gold, items }
     */
    lootPlayer(player, looter, day, opts = {}) {
        if (!player) return null;
        const L = Scavengers.config().looters;
        const key = `${looter && looter.name}|${day}|player`;
        const worn = id => { try { return Arms.isArms(id) && Arms.isEquipped(player, id) && _num(player.inventory[id]) <= 1; } catch { return false; } };
        const took = Scavengers.pickLoot(player.inventory || {}, player.gold, key, { goldShare: _num(L.playerGoldShare, 0.6), worn });
        player.gold = Math.max(0, _num(player.gold) - took.gold);
        player.lootedWhileOut = {
            by: looter ? looter.name : 'someone', byKey: looter ? StreetCrime.npcKey(looter) : null,
            gold: took.gold, items: { ...took.items }, d: _num(day), seen: Array.isArray(opts.seenBy) ? opts.seenBy.slice(0, 3) : [],
            caught: !!opts.caught, kin: !!opts.kin,
        };
        return took;
    },

    /** What the player is told on coming round: a line, or '' (and the note is let go). */
    wakeLine(player) {
        const w = player && player.lootedWhileOut;
        if (!w) return '';
        delete player.lootedWhileOut;
        const parts = [];
        if (_num(w.gold) > 0) parts.push(`your purse (${w.gold} gold)`);
        for (const [id, n] of Object.entries(w.items || {})) parts.push(`${n} ${id.replace(/_/g, ' ')}`);
        if (w.caught) return `${w.by} went through your things while you lay there — but the watch caught them at it, and you have it all back.`;
        if (w.kin) return '';
        if (!parts.length) return '';
        const gone = `${_cap(parts.join(', '))} ${parts.length === 1 ? 'is' : 'are'} gone.`;
        if (w.seen && w.seen.length) return `${gone} ${w.seen[0]} saw who did it — ask them.`;
        return `${gone} No one seems to have seen who took ${parts.length === 1 ? 'it' : 'them'}.`;
    },
};

function _cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
