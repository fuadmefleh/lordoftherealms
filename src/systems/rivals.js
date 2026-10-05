// ============================================
// RIVAL ADVENTURERS — the player is not the only one chasing glory
// ============================================
// A small cast (6–9) of named NPC adventurers — treasure hunters, sellsword
// captains, bounty hunters, crusaders, merchant adventurers, would-be
// usurpers, duelists — pursue the same goals as the player, cheaply and
// abstractly: no pathfinding, they simply take days to travel between
// settlements and points of interest (distance / hexesPerDay).
//
// What they do to the world:
//   - delve unexplored sites first (systems/delves.js): a site can be emptied
//     ("already looted by Kael the Bold") or partly looted (thinner hauls)
//   - hunt the criminals on your bounty board / in your active bounties
//     (systems/bountyHunting.js) and bring them in before you
//   - take offers off your quest journal
//   - enter your festivals and tournaments as named contestants
//   - ambitious ones style themselves pretenders and back claimants in
//     succession crises (systems/throne.js)
//
// What they remember: every rival keeps an attitude (-100..100) toward the
// player and a short memory of slights and favours. You meet them in towns —
// talk, duel, team up for a delve (they take a share), hire them, race them to
// a site, or sabotage them. Nemeses ambush you on the road and spread slander
// (systems/gossip.js 'slander' rumours). Rivals can die; newcomers replace
// the dead. The Hall of Heroes ranks the player's renown against theirs.
//
// The cast is created lazily on the first daily tick (never during world
// generation, so the golden RNG snapshots are untouched). Content lives in
// data/rivals.json; state lives on player.rivals (serialized by saveLoad).
// All randomness flows through Utils; world/player are passed in.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { Delves } from './delves.js';
import { Quests } from './quests.js';
import { Gossip } from './gossip.js';
import { PlayerEffects } from '../player/playerEffects.js';
import { Ailments } from './ailments.js';
import { Traits } from './traits.js';

const DEFAULT_CONFIG = {
    minRivals: 6,
    maxRivals: 9,
    hexesPerDay: 6,
    restDays: [3, 8],
    replaceAfterDays: [8, 20],
    delveRadius: 28,
    wanderRadius: 16,
    nearPlayerChance: 0.45,
    noticeRadius: 14,
    maxNews: 40,
    maxMemory: 8,
    attitude: { nemesis: -60, rival: -20, friendly: 20, friend: 60 },
    delve: { fullClearBase: 0.1, fullClearPerProwess: 0.03, shareRange: [0.2, 0.5], lootFactorPerShare: 0.7, deathChance: 0.03, renown: [3, 8], restDays: 4 },
    bounty: { base: 0.35, perProwess: 0.05, perDifficulty: 0.05, deathChance: 0.02, renown: [3, 6] },
    quest: { days: [4, 10], renown: [2, 5] },
    festival: { winBase: 0.2, perProwess: 0.04, renown: [2, 6] },
    duel: { apCost: 4, harm: [8, 20], deathHarm: [18, 35], renownPerTen: 1, minRenown: 2 },
    teamUp: { days: 7, share: 0.25, bonus: 0.08 },
    hire: { days: 10, baseCost: 60, costPerLevel: 35 },
    race: { wager: 75, renown: 6 },
    sabotage: { cost: 50, base: 0.35, perStealth: 0.06, guildBonus: 0.15, delayDays: [3, 6] },
    nemesis: { slanderChance: 0.12, huntWeight: 3, ambushRadius: 3 },
    usurp: { claimRenown: 70, support: [5, 14] },
    // Faith: conviction in a fight, and a lamp in the tombs
    faith: { duelPerPoint: 0.3, piousRestraint: 2, devoutAt: 7, tombRiskPerPoint: 0.06, tombClearPerPoint: 0.02 },
    // What rivals do with their gold between ventures
    spend: { keep: 60, gearBase: 150, gearPerProwess: 60, maxProwess: 10, retainerCost: 120, retainerDays: 40, maxRetainers: 2, retainerPower: 1.5, retainerBounty: 0.04 },
};

const FALLBACK_ARCHETYPE = {
    label: 'Adventurer', icon: '🧭',
    stats: { prowess: [4, 7], cunning: [4, 7], faith: [3, 6], charm: [3, 6] },
    renown: [5, 20],
    goals: { delve: 3, quest: 2, wander: 2, festival: 1 },
    lines: { greet: ['Well met.'], friendly: ['Good to see you.'], hostile: ['You again.'], boast: ['I have seen things.'] },
};

const STAT_KEYS = ['prowess', 'cunning', 'faith', 'charm'];
const GOAL_TYPES = ['delve', 'bounty', 'quest', 'festival', 'wander', 'usurp', 'hunt'];
const CONTEST_NAMES = { jousting: 'jousting lists', archery: 'archery contest' };

/** Per-world caches (not saved): settlement list and POI tiles. */
const _cache = new WeakMap();

function _num(v) {
    return typeof v === 'number' && isFinite(v) ? v : 0;
}

function _roll(v) {
    if (Array.isArray(v)) return Utils.randInt(v[0], v[1]);
    return _num(v);
}

function _rollF(v) {
    if (Array.isArray(v)) return Utils.randFloat(v[0], v[1]);
    return _num(v);
}

function _day(world) {
    return (world && world.day) || 0;
}

function _key(q, r) {
    return `${q},${r}`;
}

function _pick(arr) {
    return Array.isArray(arr) && arr.length ? Utils.randPick(arr) : null;
}

function _fill(text, vars) {
    let s = String(text || '');
    for (const [k, v] of Object.entries(vars || {})) s = s.split(`{${k}}`).join(v);
    return s;
}

export const Rivals = {
    // ──────────── DATA ────────────

    data() {
        return DataLoader.rivals || (DataLoader.get && DataLoader.get('rivals')) || {};
    },

    config() {
        const c = Rivals.data().config || {};
        const out = { ...DEFAULT_CONFIG, ...c };
        for (const k of Object.keys(DEFAULT_CONFIG)) {
            if (DEFAULT_CONFIG[k] && typeof DEFAULT_CONFIG[k] === 'object' && !Array.isArray(DEFAULT_CONFIG[k])) {
                out[k] = { ...DEFAULT_CONFIG[k], ...(c[k] || {}) };
            }
        }
        return out;
    },

    archetypes() {
        const a = Rivals.data().archetypes;
        return a && Object.keys(a).length ? a : { adventurer: FALLBACK_ARCHETYPE };
    },

    archetype(id) {
        return Rivals.archetypes()[id] || FALLBACK_ARCHETYPE;
    },

    // ──────────── STATE ────────────

    _blank() {
        return {
            initialized: false,
            list: [],
            nextId: 1,
            news: [],
            partner: null,
            race: null,
            nextArrivalDay: null,
            lastDay: null,
            stats: { duelsWon: 0, duelsLost: 0, racesWon: 0, racesLost: 0, sabotaged: 0, slain: 0, teamUps: 0, hires: 0 },
        };
    },

    /** The player's rival record, created/backfilled on first use (old saves). */
    state(player) {
        if (!player) return Rivals._blank();
        let st = player.rivals;
        if (!st || typeof st !== 'object' || Array.isArray(st)) {
            player.rivals = Rivals._blank();
            return player.rivals;
        }
        const blank = Rivals._blank();
        if (typeof st.initialized !== 'boolean') st.initialized = Array.isArray(st.list) && st.list.length > 0;
        if (!Array.isArray(st.list)) st.list = [];
        if (!(st.nextId > 0)) st.nextId = st.list.length + 1;
        if (!Array.isArray(st.news)) st.news = [];
        if (st.partner === undefined) st.partner = null;
        if (st.race === undefined) st.race = null;
        if (st.nextArrivalDay === undefined) st.nextArrivalDay = null;
        if (st.lastDay === undefined) st.lastDay = null;
        st.stats = { ...blank.stats, ...(st.stats && typeof st.stats === 'object' ? st.stats : {}) };
        for (const r of st.list) Rivals._backfillRival(r);
        return st;
    },

    _backfillRival(r) {
        if (!r.stats || typeof r.stats !== 'object') r.stats = {};
        for (const k of STAT_KEYS) if (typeof r.stats[k] !== 'number') r.stats[k] = 5;
        if (typeof r.renown !== 'number') r.renown = 0;
        if (typeof r.attitude !== 'number') r.attitude = 0;
        if (typeof r.gold !== 'number') r.gold = 0;
        if (typeof r.gear !== 'number') r.gear = 0;
        if (typeof r.retainers !== 'number') r.retainers = 0;
        if (typeof r.retainersUntil !== 'number') r.retainersUntil = 0;
        if (!Array.isArray(r.memory)) r.memory = [];
        if (!r.deeds || typeof r.deeds !== 'object') r.deeds = {};
        for (const k of ['delves', 'bounties', 'quests', 'tournaments', 'duelsWon', 'duelsLost']) {
            if (typeof r.deeds[k] !== 'number') r.deeds[k] = 0;
        }
        if (r.task === undefined) r.task = null;
        if (r.dead === undefined) r.dead = null;
        if (r.claim === undefined) r.claim = null;
        if (r.with === undefined) r.with = null;
        if (typeof r.met !== 'boolean') r.met = false;
        if (typeof r.restUntil !== 'number') r.restUntil = 0;
        return r;
    },

    serialize(player) {
        return player && player.rivals ? JSON.parse(JSON.stringify(player.rivals)) : null;
    },

    /** Backfill after load (older saves have no rivals; the cast arrives on the next day). */
    loadState(player) {
        Rivals.state(player);
    },

    alive(player) {
        return Rivals.state(player).list.filter(r => !r.dead);
    },

    get(player, id) {
        return Rivals.state(player).list.find(r => r.id === id) || null;
    },

    // ──────────── WORLD HELPERS ────────────

    _worldCache(world) {
        let c = _cache.get(world);
        if (!c) {
            c = { settlements: null, settlementsDay: -999, sites: null, sitesDay: -999 };
            _cache.set(world, c);
        }
        return c;
    },

    /** Settlements (refreshed every 10 days — cheap enough for a daily tick). */
    _settlements(world) {
        if (!world || typeof world.getAllSettlements !== 'function') return [];
        const c = Rivals._worldCache(world);
        const day = _day(world);
        if (!c.settlements || day - c.settlementsDay >= 10 || day < c.settlementsDay) {
            c.settlements = world.getAllSettlements().filter(s => s && typeof s.q === 'number');
            c.settlementsDay = day;
        }
        return c.settlements;
    },

    /** Tiles with a point of interest (refreshed every 30 days). */
    _sites(world) {
        if (!world || !Array.isArray(world.tiles)) return [];
        const c = Rivals._worldCache(world);
        const day = _day(world);
        if (!c.sites || day - c.sitesDay >= 30 || day < c.sitesDay) {
            const out = [];
            for (let r = 0; r < world.tiles.length; r++) {
                const row = world.tiles[r];
                if (!row) continue;
                for (let q = 0; q < row.length; q++) {
                    const t = row[q];
                    if (t && t.improvement) out.push({ q, r });
                }
            }
            c.sites = out;
            c.sitesDay = day;
        }
        return c.sites;
    },

    _dist(world, q1, r1, q2, r2) {
        const w = (world && world.width) || 0;
        return w > 0 ? Hex.wrappingDistance(q1, r1, q2, r2, w) : Hex.distance(q1, r1, q2, r2);
    },

    _travelDays(world, from, to) {
        const d = Rivals._dist(world, from.q, from.r, to.q, to.r);
        return Math.max(1, Math.ceil(d / Math.max(1, Rivals.config().hexesPerDay)));
    },

    _settlementAt(world, q, r) {
        const t = world && world.getTile ? world.getTile(q, r) : null;
        return t && t.settlement ? t.settlement : null;
    },

    _placeName(world, q, r) {
        const t = world && world.getTile ? world.getTile(q, r) : null;
        if (t && t.settlement) return t.settlement.name || 'a town';
        if (t && t.improvement) return t.improvement.name || 'a ruin';
        return 'the wilds';
    },

    _nearestSettlement(world, q, r) {
        let best = null;
        let bestD = Infinity;
        for (const s of Rivals._settlements(world)) {
            const d = Rivals._dist(world, q, r, s.q, s.r);
            if (d < bestD) { bestD = d; best = s; }
        }
        return best;
    },

    // ──────────── THE CAST ────────────

    _usedNames(st) {
        return new Set(st.list.map(r => r.name));
    },

    _makeName(st) {
        const d = Rivals.data();
        const firsts = d.firstNames && d.firstNames.length ? d.firstNames : ['Kael', 'Mira', 'Doran'];
        const surs = d.surnames && d.surnames.length ? d.surnames : ['Ashveil', 'Grey'];
        const eps = d.epithets && d.epithets.length ? d.epithets : ['the Bold'];
        const used = Rivals._usedNames(st);
        const usedFirst = new Set(st.list.filter(r => !r.dead).map(r => r.firstName));
        for (let i = 0; i < 20; i++) {
            const first = Utils.randPick(firsts);
            if (usedFirst.has(first) && i < 15) continue;
            const name = Utils.random() < 0.5 ? `${first} ${Utils.randPick(eps)}` : `${first} ${Utils.randPick(surs)}`;
            if (!used.has(name)) return { first, name };
        }
        const first = Utils.randPick(firsts);
        return { first, name: `${first} ${st.nextId}` };
    },

    /** Create one rival (archetype id optional) at a home settlement. */
    _makeRival(player, world, archetypeId = null, opts = {}) {
        const st = Rivals.state(player);
        const types = Object.keys(Rivals.archetypes());
        const aliveTypes = st.list.filter(r => !r.dead).map(r => r.archetype);
        let typeId = archetypeId && Rivals.archetypes()[archetypeId] ? archetypeId : null;
        if (!typeId) {
            const fresh = types.filter(t => !aliveTypes.includes(t));
            typeId = Utils.randPick(fresh.length ? fresh : types);
        }
        const arch = Rivals.archetype(typeId);
        const stats = {};
        for (const k of STAT_KEYS) stats[k] = _roll((arch.stats && arch.stats[k]) || [3, 7]);
        const settlements = Rivals._settlements(world);
        let home = null;
        if (opts.home) home = opts.home;
        else if (settlements.length) home = Utils.randPick(settlements);
        const { first, name } = Rivals._makeName(st);
        const day = _day(world);
        const r = Rivals._backfillRival({
            id: `rival_${st.nextId++}`,
            name,
            firstName: first,
            archetype: typeId,
            icon: arch.icon || '🧭',
            stats,
            level: Math.max(1, Math.round((stats.prowess + stats.cunning) / 4)),
            renown: _roll(arch.renown || [5, 20]),
            gold: Utils.randInt(40, 160),
            home: home ? { q: home.q, r: home.r, name: home.name || 'a town' } : null,
            q: home ? home.q : 0,
            r: home ? home.r : 0,
            attitude: 0,
            joinedDay: day,
            restUntil: day + Utils.randInt(0, 3),
        });
        st.list.push(r);
        return r;
    },

    /**
     * Create the cast on the first daily tick (lazy — never during world
     * generation). Returns the newly created rivals.
     */
    ensureCast(player, world) {
        const st = Rivals.state(player);
        if (st.initialized) return [];
        if (!Rivals._settlements(world).length) return [];
        const cfg = Rivals.config();
        const n = Utils.randInt(cfg.minRivals, cfg.maxRivals);
        const out = [];
        for (let i = 0; i < n; i++) out.push(Rivals._makeRival(player, world));
        st.initialized = true;
        return out;
    },

    // ──────────── ATTITUDE & MEMORY ────────────

    attitudeOf(rival) {
        const labels = Rivals.data().attitudeLabels;
        const a = _num(rival && rival.attitude);
        if (Array.isArray(labels) && labels.length) {
            return labels.find(l => a >= l.min) || labels[labels.length - 1];
        }
        const t = Rivals.config().attitude;
        if (a >= t.friend) return { id: 'friend', label: 'Friend', icon: '💛', color: '#7fd07f' };
        if (a >= t.friendly) return { id: 'friendly', label: 'Friendly', icon: '🙂', color: '#b5d77f' };
        if (a > t.rival) return { id: 'neutral', label: 'Neutral', icon: '😐', color: '#c8c8c8' };
        if (a > t.nemesis) return { id: 'rival', label: 'Rival', icon: '😠', color: '#e08a50' };
        return { id: 'nemesis', label: 'Nemesis', icon: '💀', color: '#e06060' };
    },

    isNemesis(rival) {
        return _num(rival && rival.attitude) <= Rivals.config().attitude.nemesis;
    },

    /**
     * Rivals hear what kind of person you have become: each earned trait the
     * archetype cares about (archetypes.*.traitAttitude in data/rivals.json)
     * moves their attitude once when earned, and back if the trait is lost.
     * No RNG.
     */
    _tickTraits(player, world) {
        const earned = Traits.getEarned(player);
        for (const rival of Rivals.state(player).list) {
            if (!rival || rival.dead) continue;
            const table = Rivals.archetype(rival.archetype).traitAttitude || {};
            if (!rival.traitsHeard || typeof rival.traitsHeard !== 'object') rival.traitsHeard = {};
            const heard = rival.traitsHeard;
            for (const id of earned) {
                if (heard[id] != null || !table[id]) continue;
                heard[id] = _num(table[id]);
                const name = (Traits.TRAITS[id] && Traits.TRAITS[id].name) || id;
                Rivals.remember(rival, world, `heard you are ${name.toLowerCase()}`, heard[id]);
            }
            for (const id of Object.keys(heard)) {
                if (earned.includes(id)) continue;
                const name = (Traits.TRAITS[id] && Traits.TRAITS[id].name) || id;
                Rivals.remember(rival, world, `heard you are ${name.toLowerCase()} no longer`, -heard[id]);
                delete heard[id];
            }
        }
    },

    /** Change a rival's attitude and remember why. */
    remember(rival, world, text, delta) {
        if (!rival) return;
        rival.attitude = Utils.clamp(Math.round(_num(rival.attitude) + _num(delta)), -100, 100);
        rival.memory.unshift({ day: _day(world), text, delta: _num(delta) });
        const max = Rivals.config().maxMemory;
        if (rival.memory.length > max) rival.memory.length = max;
    },

    // ──────────── NEWS ────────────

    _news(player, world, rival, icon, text, q = null, r = null) {
        const st = Rivals.state(player);
        const entry = { day: _day(world), icon, text, rivalId: rival ? rival.id : null };
        if (q != null) { entry.q = q; entry.r = r; }
        st.news.unshift(entry);
        const max = Rivals.config().maxNews;
        if (st.news.length > max) st.news.length = max;
        return entry;
    },

    news(player, limit = 20) {
        return Rivals.state(player).news.slice(0, limit);
    },

    _nearPlayer(player, world, q, r) {
        if (q == null || player == null || player.q == null) return false;
        return Rivals._dist(world, player.q, player.r, q, r) <= Rivals.config().noticeRadius;
    },

    // ──────────── DAILY ────────────

    /**
     * One day of rival life. Returns { notices: [{icon,title,text,type}] }:
     * notable deeds near the player, or ones that touch the player.
     */
    processDay(world, player) {
        const out = { notices: [] };
        if (!world || !player) return out;
        const st = Rivals.state(player);
        const day = _day(world);
        if (st.lastDay === day) return out;
        st.lastDay = day;

        const created = Rivals.ensureCast(player, world);
        if (created.length) return out; // a quiet first day: the cast just arrived

        const notify = (icon, title, text, type = 'info') => out.notices.push({ icon, title, text, type });
        const cfg = Rivals.config();

        Rivals._tickTraits(player, world);
        Rivals._tickPartner(player, world, notify);
        Rivals._tickHires(player, world, notify);
        Rivals._tickRace(player, world, notify);

        for (const rival of st.list) {
            if (rival.dead || rival.with) continue;
            if (rival.task) {
                if (day >= rival.task.arriveDay) Rivals._resolveTask(player, world, rival, notify);
            } else if (day >= rival.restUntil) {
                Rivals._spend(player, world, rival, notify);
                Rivals._chooseTask(player, world, rival);
            }
            // A nemesis spreads tales about you
            if (!rival.dead && Rivals.isNemesis(rival) && Utils.random() < cfg.nemesis.slanderChance) {
                const rumor = Rivals._slander(player, world, rival);
                if (rumor) notify('🗣️', 'Slander', `${rival.name} is spreading tales about you in ${rumor.locationName}.`, 'warning');
            }
        }

        // Newcomers replace the dead
        const alive = st.list.filter(r => !r.dead).length;
        if (alive < cfg.minRivals) {
            if (st.nextArrivalDay == null) st.nextArrivalDay = day + _roll(cfg.replaceAfterDays);
            else if (day >= st.nextArrivalDay) {
                const r = Rivals._makeRival(player, world);
                st.nextArrivalDay = null;
                const where = r.home ? r.home.name : 'the realm';
                Rivals._news(player, world, r, r.icon, `${r.name}, a ${Rivals.archetype(r.archetype).label.toLowerCase()}, arrives in ${where} seeking fortune.`, r.q, r.r);
                if (Rivals._nearPlayer(player, world, r.q, r.r)) notify(r.icon, 'A New Adventurer', `${r.name} has arrived in ${where}, hungry for renown.`, 'info');
            }
        } else {
            st.nextArrivalDay = null;
        }
        return out;
    },

    /**
     * Between ventures a rival spends what they have won: better arms
     * (+1 prowess, dearer each time) or a few hired blades for a season
     * (retainers: more fighting power, surer manhunts). Retainers whose term
     * runs out go home. No RNG.
     */
    _spend(player, world, rival, notify = () => {}) {
        const cfg = Rivals.config().spend;
        const day = _day(world);
        if (rival.retainers > 0 && day >= _num(rival.retainersUntil)) {
            rival.retainers = 0;
        }
        const purse = _num(rival.gold) - cfg.keep;
        const gearCost = cfg.gearBase + rival.stats.prowess * cfg.gearPerProwess;
        if (rival.stats.prowess < cfg.maxProwess && purse >= gearCost) {
            rival.gold -= gearCost;
            rival.stats.prowess += 1;
            rival.gear = _num(rival.gear) + 1;
            rival.level = Math.max(1, Math.round((rival.stats.prowess + rival.stats.cunning) / 4));
            Rivals._news(player, world, rival, '🛡️', `${rival.name} spent ${gearCost} gold on finer arms in ${Rivals._whereName(world, rival)}.`, rival.q, rival.r);
            return 'gear';
        }
        if (rival.retainers < cfg.maxRetainers && purse >= cfg.retainerCost) {
            rival.gold -= cfg.retainerCost;
            rival.retainers += 1;
            rival.retainersUntil = day + cfg.retainerDays;
            Rivals._news(player, world, rival, '⚔️', `${rival.name} hired ${rival.retainers === 1 ? 'a sword' : 'more swords'} in ${Rivals._whereName(world, rival)}.`, rival.q, rival.r);
            if (Rivals.isNemesis(rival) && Rivals._nearPlayer(player, world, rival.q, rival.r)) {
                notify('⚔️', 'A Rival Arms', `${rival.name} is hiring swords nearby. They mean you no good.`, 'warning');
            }
            return 'retainer';
        }
        return null;
    },

    _whereName(world, rival) {
        const tile = world && world.getTile ? world.getTile(rival.q, rival.r) : null;
        return (tile && tile.settlement && tile.settlement.name) || (rival.home && rival.home.name) || 'town';
    },

    _rest(rival, world) {
        rival.restUntil = _day(world) + _roll(Rivals.config().restDays);
    },

    _goalWeights(player, world, rival) {
        const arch = Rivals.archetype(rival.archetype);
        const w = { ...(arch.goals || FALLBACK_ARCHETYPE.goals) };
        const cfg = Rivals.config();
        if (Rivals.isNemesis(rival) && _day(world) >= _num(rival.lastHuntDay) + 20) w.hunt = (w.hunt || 0) + cfg.nemesis.huntWeight;
        const crises = player.throne && Array.isArray(player.throne.crises) ? player.throne.crises.length : 0;
        if (w.usurp && !crises && (rival.claim || rival.renown < cfg.usurp.claimRenown)) w.usurp = 0;
        for (const k of Object.keys(w)) if (!GOAL_TYPES.includes(k)) delete w[k];
        return w;
    },

    _chooseTask(player, world, rival) {
        const weights = Rivals._goalWeights(player, world, rival);
        const items = Object.entries(weights).filter(([, v]) => v > 0);
        const total = items.reduce((s, [, v]) => s + v, 0);
        let goal = 'wander';
        if (total > 0) {
            let roll = Utils.random() * total;
            for (const [k, v] of items) {
                roll -= v;
                if (roll <= 0) { goal = k; break; }
            }
        }
        const task = Rivals._planTask(player, world, rival, goal) || Rivals._planTask(player, world, rival, 'wander');
        if (task) rival.task = task;
        else Rivals._rest(rival, world);
        return rival.task;
    },

    /** Plan a task for a goal, or null when nothing fits. */
    _planTask(player, world, rival, goal) {
        const day = _day(world);
        const cfg = Rivals.config();
        const from = { q: rival.q, r: rival.r };
        const mk = (type, to, extra = {}) => ({
            type, q: to.q, r: to.r,
            name: extra.name || Rivals._placeName(world, to.q, to.r),
            arriveDay: day + Rivals._travelDays(world, from, to) + _num(extra.extraDays),
            ...extra,
        });

        if (goal === 'delve') {
            const site = Rivals._findDelveSite(player, world, rival);
            return site ? mk('delve', site, { key: _key(site.q, site.r) }) : null;
        }
        if (goal === 'bounty') {
            const b = Rivals._findBounty(player, world, rival);
            if (b) {
                const task = mk('bounty', { q: b.targetQ, r: b.targetR }, { bountyId: b.id, target: b.targetName, name: b.fromSettlement || Rivals._placeName(world, b.targetQ, b.targetR) });
                b.rivalHunter = { id: rival.id, name: rival.name, arriveDay: task.arriveDay };
                return task;
            }
            // No posted bounties: they hunt an outlaw of their own
            const s = Rivals._pickSettlement(player, world, rival);
            return s ? mk('bounty', s, { name: s.name, target: null, extraDays: Utils.randInt(1, 3) }) : null;
        }
        if (goal === 'quest') {
            const s = Rivals._pickSettlement(player, world, rival);
            if (!s) return null;
            const offer = Rivals._takeQuestOffer(player, world, rival, s);
            const title = offer ? offer.title : null;
            return mk('quest', s, { name: s.name, questTitle: title, questId: offer ? offer.id : null, extraDays: _roll(cfg.quest.days) });
        }
        if (goal === 'festival') {
            const towns = Rivals._settlements(world).filter(s => ['town', 'capital', 'city'].includes(s.type)
                && Rivals._dist(world, from.q, from.r, s.q, s.r) <= cfg.wanderRadius * 1.5);
            const s = _pick(towns);
            return s ? mk('festival', s, { name: s.name, contest: Utils.random() < 0.5 ? 'jousting' : 'archery' }) : null;
        }
        if (goal === 'hunt') {
            if (player.q == null) return null;
            rival.lastHuntDay = day;
            return mk('hunt', { q: player.q, r: player.r }, { name: Rivals._placeName(world, player.q, player.r) });
        }
        if (goal === 'usurp') {
            const s = Rivals._settlements(world).filter(x => x.type === 'capital');
            const target = _pick(s) || Rivals._pickSettlement(player, world, rival);
            return target ? mk('usurp', target, { name: target.name }) : null;
        }
        // wander
        const s = Rivals._pickSettlement(player, world, rival);
        return s ? mk('wander', s, { name: s.name }) : null;
    },

    /** A settlement to travel to: often near the player (so you meet), else near the rival. */
    _pickSettlement(player, world, rival) {
        const cfg = Rivals.config();
        const all = Rivals._settlements(world);
        if (!all.length) return null;
        if (player.q != null && Utils.random() < cfg.nearPlayerChance) {
            const near = all.filter(s => Rivals._dist(world, player.q, player.r, s.q, s.r) <= 8);
            if (near.length) return Utils.randPick(near);
        }
        const local = all.filter(s => Rivals._dist(world, rival.q, rival.r, s.q, s.r) <= cfg.wanderRadius
            && !(s.q === rival.q && s.r === rival.r));
        return Utils.randPick(local.length ? local : all);
    },

    _targetedKeys(player) {
        const keys = new Set();
        for (const r of Rivals.state(player).list) {
            if (!r.dead && r.task && r.task.type === 'delve') keys.add(r.task.key);
        }
        const race = Rivals.state(player).race;
        if (race) keys.add(race.key);
        return keys;
    },

    _findDelveSite(player, world, rival) {
        const cfg = Rivals.config();
        const taken = Rivals._targetedKeys(player);
        const active = Delves.active(player);
        let best = null;
        let bestD = Infinity;
        for (const s of Rivals._sites(world)) {
            const key = _key(s.q, s.r);
            if (taken.has(key) || (active && active.key === key)) continue;
            const d = Rivals._dist(world, rival.q, rival.r, s.q, s.r);
            if (d > cfg.delveRadius || d >= bestD) continue;
            const tile = world.getTile(s.q, s.r);
            if (!Delves.isDelveSite(tile)) continue;
            best = s; bestD = d;
        }
        return best;
    },

    _playerBounties(player) {
        const list = [];
        for (const b of player.activeBounties || []) {
            if (b && b.type === 'criminal_hunt' && b.status === 'active') list.push({ b, accepted: true });
        }
        const offers = player.bountyHunter && Array.isArray(player.bountyHunter.boardOffers) ? player.bountyHunter.boardOffers : [];
        for (const b of offers) {
            if (b && b.type === 'criminal_hunt' && (b.status || 'active') === 'active') list.push({ b, accepted: false });
        }
        return list;
    },

    _findBounty(player, world, rival) {
        let best = null;
        let bestD = Infinity;
        for (const { b } of Rivals._playerBounties(player)) {
            if (typeof b.targetQ !== 'number') continue;
            if (b.rivalHunter) {
                // Still on the trail? (a hunter who died or changed course lets go of it)
                const h = Rivals.get(player, b.rivalHunter.id);
                if (h && !h.dead && h.task && h.task.bountyId === b.id) continue;
                delete b.rivalHunter;
            }
            const d = Rivals._dist(world, rival.q, rival.r, b.targetQ, b.targetR);
            if (d < bestD && d <= Rivals.config().delveRadius) { best = b; bestD = d; }
        }
        return best;
    },

    /** A rival near you takes an offer off your quest journal. */
    _takeQuestOffer(player, world, rival, s) {
        const q = player.quests;
        if (!q || !Array.isArray(q.available) || !q.available.length || player.q == null) return null;
        if (Rivals._dist(world, player.q, player.r, s.q, s.r) > Rivals.config().noticeRadius) return null;
        const idx = q.available.findIndex(o => o && !Quests._artifactOf(o) && !o.starter);
        if (idx < 0) return null;
        const [offer] = q.available.splice(idx, 1);
        return { id: offer.id, title: offer.title || offer.name || 'a commission' };
    },

    // ──────────── TASK RESOLUTION ────────────

    _resolveTask(player, world, rival, notify) {
        const task = rival.task;
        rival.task = null;
        rival.q = task.q;
        rival.r = task.r;
        const fn = {
            delve: Rivals._doDelve,
            bounty: Rivals._doBounty,
            quest: Rivals._doQuest,
            festival: Rivals._doFestival,
            hunt: Rivals._doHunt,
            usurp: Rivals._doUsurp,
        }[task.type];
        if (fn) fn(player, world, rival, task, notify);
        if (!rival.dead) {
            // After a delve or a hunt in the wilds, they fall back to the nearest town
            if (!Rivals._settlementAt(world, rival.q, rival.r)) {
                const s = Rivals._nearestSettlement(world, rival.q, rival.r);
                if (s) { rival.q = s.q; rival.r = s.r; }
            }
            Rivals._rest(rival, world);
            // A delve leaves them spent for a while
            if (task.type === 'delve') rival.restUntil += _num(Rivals.config().delve.restDays);
        }
    },

    _kill(player, world, rival, cause, notify, q = null, r = null) {
        rival.dead = { day: _day(world), cause };
        rival.task = null;
        rival.with = null;
        const st = Rivals.state(player);
        if (st.partner && st.partner.id === rival.id) st.partner = null;
        if (st.race && st.race.rivalId === rival.id) {
            // The race is off: your stake comes back
            player.gold = _num(player.gold) + _num(st.race.wager);
            st.race = null;
        }
        Rivals._news(player, world, rival, '⚰️', `${rival.name} ${cause}.`, q, r);
        if (rival.met || Rivals._nearPlayer(player, world, q, r)) {
            notify('⚰️', 'An Adventurer Falls', `${rival.name} ${cause}.`, 'info');
        }
    },

    _doDelve(player, world, rival, task, notify) {
        const cfg = Rivals.config().delve;
        const tile = world.getTile ? world.getTile(task.q, task.r) : null;
        const poi = tile && tile.improvement;
        const race = Rivals.state(player).race;
        const racing = race && race.rivalId === rival.id && race.key === task.key;
        const active = Delves.active(player);
        if (!poi || poi.explored || !Delves.isDelveSite(tile) || (active && active.key === task.key)) {
            if (racing) Rivals._settleRace(player, world, notify);
            return;
        }
        const name = poi.name || 'a ruin';
        // The depths can kill. In a tomb, faith is a lamp against the restless dead
        const fcfg = Rivals.config().faith;
        const tomb = Delves.kindFor(tile) === 'tomb';
        const faithEdge = tomb ? rival.stats.faith - 5 : 0;
        const risk = cfg.deathChance * Math.max(0.3, 1.6 - rival.stats.prowess / 10) * Math.max(0.4, 1 - faithEdge * fcfg.tombRiskPerPoint);
        if (Utils.random() < risk) {
            Rivals._kill(player, world, rival, `never came back up from ${name}`, notify, task.q, task.r);
            return;
        }
        const full = Utils.random() < cfg.fullClearBase + rival.stats.prowess * cfg.fullClearPerProwess + Math.max(0, faithEdge) * fcfg.tombClearPerPoint
            || (poi.rivalLooted && _num(poi.rivalLooted.share) >= 0.5);
        const gain = _roll(cfg.renown) + (full ? 3 : 0);
        rival.renown += gain;
        rival.gold += Utils.randInt(30, 120);
        rival.deeds.delves++;
        if (full) {
            poi.explored = true;
            poi.delved = { day: _day(world), depth: 0, of: 0, reason: 'rival', by: rival.name };
            poi.lootedBy = rival.name;
            delete poi.rivalLooted;
            Rivals._news(player, world, rival, '🏛️', `${rival.name} cleared ${name}.`, task.q, task.r);
        } else {
            const share = Math.min(0.9, _num(poi.rivalLooted && poi.rivalLooted.share) + _rollF(cfg.shareRange));
            poi.rivalLooted = {
                by: rival.name,
                share: Math.round(share * 100) / 100,
                lootFactor: Math.round(Math.max(0.2, 1 - share * cfg.lootFactorPerShare) * 100) / 100,
                day: _day(world),
            };
            Rivals._news(player, world, rival, '🕯️', `${rival.name} plundered part of ${name}.`, task.q, task.r);
        }
        if (racing) {
            Rivals._settleRace(player, world, notify);
        } else if (Rivals._nearPlayer(player, world, task.q, task.r)) {
            notify(rival.icon, full ? 'Site Looted' : 'Site Picked Over',
                full ? `${rival.name} has cleared ${name} — nothing is left for you there.` : `${rival.name} has plundered part of ${name}. What remains is thinner pickings.`, 'info');
        }
    },

    _doBounty(player, world, rival, task, notify) {
        const cfg = Rivals.config().bounty;
        if (!task.bountyId) {
            // An outlaw of their own
            if (Utils.random() < 0.6) {
                rival.renown += _roll(cfg.renown);
                rival.gold += Utils.randInt(60, 180);
                rival.deeds.bounties++;
                Rivals._news(player, world, rival, '🎯', `${rival.name} brought in an outlaw at ${task.name}.`, task.q, task.r);
            }
            return;
        }
        const entries = Rivals._playerBounties(player);
        const hit = entries.find(e => e.b.id === task.bountyId);
        if (!hit) return; // you got there first
        const b = hit.b;
        delete b.rivalHunter;
        const chance = Utils.clamp(cfg.base + rival.stats.prowess * cfg.perProwess - _num(b.difficulty) * cfg.perDifficulty
            + _num(rival.retainers) * Rivals.config().spend.retainerBounty, 0.1, 0.9);
        if (Utils.random() < chance) {
            if (hit.accepted) player.activeBounties = player.activeBounties.filter(x => x !== b);
            else player.bountyHunter.boardOffers = player.bountyHunter.boardOffers.filter(x => x !== b);
            rival.renown += _roll(cfg.renown) + Math.floor(_num(b.difficulty) / 3);
            rival.gold += _num(b.actualPay);
            rival.deeds.bounties++;
            Rivals._news(player, world, rival, '🎯', `${rival.name} brought in ${b.targetName}${b.fromSettlement ? ` for the magistrate of ${b.fromSettlement}` : ''}.`, task.q, task.r);
            if (hit.accepted) {
                notify('🎯', 'Bounty Claimed', `${rival.name} brought in ${b.targetName} before you — the ${_num(b.actualPay)}g bounty is theirs.`, 'warning');
            } else if (Rivals._nearPlayer(player, world, task.q, task.r)) {
                notify('🎯', 'Bounty Taken', `${rival.name} has claimed the bounty on ${b.targetName}.`, 'info');
            }
        } else {
            b.escapes = _num(b.escapes) + 1;
            if (Utils.random() < cfg.deathChance * 3) {
                Rivals._kill(player, world, rival, `was killed hunting ${b.targetName}`, notify, task.q, task.r);
            }
        }
    },

    _doQuest(player, world, rival, task) {
        const cfg = Rivals.config().quest;
        rival.renown += _roll(cfg.renown);
        rival.gold += Utils.randInt(40, 140);
        rival.deeds.quests++;
        const what = task.questTitle ? `'${task.questTitle}'` : 'a commission';
        Rivals._news(player, world, rival, '📜', `${rival.name} completed ${what} at ${task.name}.`, task.q, task.r);
    },

    _doFestival(player, world, rival, task, notify) {
        const cfg = Rivals.config().festival;
        rival.deeds.tournaments++;
        const contest = CONTEST_NAMES[task.contest] || 'tournament';
        if (Utils.random() < cfg.winBase + rival.stats.prowess * cfg.perProwess) {
            const gain = _roll(cfg.renown);
            rival.renown += gain;
            rival.gold += Utils.randInt(50, 150);
            Rivals._news(player, world, rival, '🏆', `${rival.name} won the ${contest} at ${task.name}.`, task.q, task.r);
            if (Rivals._nearPlayer(player, world, task.q, task.r)) notify('🏆', 'Champion Crowned', `${rival.name} won the ${contest} at ${task.name}.`, 'info');
        } else {
            rival.renown += 1;
        }
    },

    _doHunt(player, world, rival, task, notify) {
        if (player.q == null || !Rivals.isNemesis(rival)) return;
        const cfg = Rivals.config().nemesis;
        if (Rivals._dist(world, player.q, player.r, task.q, task.r) > cfg.ambushRadius) return; // you moved on
        const res = Rivals._fight(player, world, rival, { ambush: true });
        const line = _pick((Rivals.data().lines || {}).ambush) || 'Thought you had seen the last of me?';
        if (res.playerWon) {
            const fled = !res.rivalDied;
            notify('🗡️', 'Ambushed!', `${rival.name} sprang on you — "${line}" — but you beat them off${fled ? '; they fled wounded' : ' and they fell'}. (-${res.harm} health, +${res.renown} renown)`, 'warning');
        } else {
            notify('🗡️', 'Ambushed!', `${rival.name} sprang on you — "${line}" You were beaten and robbed: -${res.harm} health, -${res.goldLost} gold.${res.wound ? ` ${res.wound.icon || '🩸'} ${res.wound.name}.` : ''}`, 'error');
        }
    },

    _doUsurp(player, world, rival, task, notify) {
        const cfg = Rivals.config().usurp;
        const crises = player.throne && Array.isArray(player.throne.crises) ? player.throne.crises : [];
        if (crises.length) {
            const crisis = crises.find(c => rival.claim && c.kingdomId === rival.claim) || Utils.randPick(crises);
            const claimants = crisis.claimants || [];
            if (!claimants.length) return;
            let claimant = null;
            const backedId = crisis.backing && crisis.backing.claimantId;
            const att = Rivals.attitudeOf(rival).id;
            if (backedId && (att === 'friend' || att === 'friendly')) claimant = claimants.find(c => c.id === backedId);
            else if (backedId && (att === 'rival' || att === 'nemesis')) claimant = claimants.find(c => c.id !== backedId);
            if (!claimant) claimant = claimants.find(c => !c.isIncumbent) || claimants[0];
            const gain = _roll(cfg.support) * (rival.claim === crisis.kingdomId ? 2 : 1);
            claimant.support = _num(claimant.support) + gain;
            if (!Array.isArray(claimant.rivalBackers)) claimant.rivalBackers = [];
            if (!claimant.rivalBackers.includes(rival.name)) claimant.rivalBackers.push(rival.name);
            rival.renown += 3;
            Rivals._news(player, world, rival, '👑', `${rival.name} throws in with ${claimant.name} in the ${crisis.kingdomName} crisis.`, task.q, task.r);
            if (backedId) {
                const same = claimant.id === backedId;
                notify('👑', same ? 'An Unexpected Ally' : 'A Rival Kingmaker',
                    `${rival.name} backs ${claimant.name} in ${crisis.kingdomName} (+${gain} support)${same ? ' — on your side.' : ' — against your claimant.'}`, same ? 'info' : 'warning');
            }
            return;
        }
        if (!rival.claim && rival.renown >= cfg.claimRenown) {
            const ks = (world.kingdoms || []).filter(k => k && k.isAlive !== false);
            const k = _pick(ks);
            if (!k) return;
            rival.claim = k.id;
            rival.claimName = k.name;
            Rivals._news(player, world, rival, '👑', `${rival.name} now styles themself pretender to the throne of ${k.name}.`, task.q, task.r);
            if (Rivals._nearPlayer(player, world, task.q, task.r) || rival.met) notify('👑', 'A Pretender', `${rival.name} now claims the throne of ${k.name}.`, 'info');
        }
    },

    // ──────────── SLANDER ────────────

    /** A nemesis spreads a 'slander' rumour about the player where they are. */
    _slander(player, world, rival) {
        const s = Rivals._settlementAt(world, rival.q, rival.r) ? { q: rival.q, r: rival.r, ...Rivals._settlementAt(world, rival.q, rival.r) } : Rivals._nearestSettlement(world, rival.q, rival.r);
        if (!s) return null;
        const data = Gossip._getData();
        const def = data && data.rumorTypes && data.rumorTypes.slander;
        if (!def) return null;
        Gossip.initializePlayer(player);
        const g = player.gossip;
        const day = _day(world);
        if (g.rumors.some(x => !x.expired && x.type === 'slander' && x.victim && x.victim.name === rival.name && day - x.dayCreated < 10)) return null;
        const credibility = Utils.clamp(0.4 + rival.stats.charm * 0.05, 0.3, 0.95);
        const rumor = {
            id: g.nextRumorId++,
            type: 'slander',
            perpetrator: player.name || 'you',
            victim: { name: rival.name, type: 'adventurer', icon: rival.icon },
            locationQ: s.q,
            locationR: s.r,
            locationName: s.name || 'a town',
            kingdom: s.kingdom || null,
            dayCreated: day,
            credibility,
            severity: def.baseSeverity * credibility,
            witnessCount: 0,
            witnessNames: [],
            spreadTo: [_key(s.q, s.r)],
            consequencesApplied: {},
            expired: false,
            byRival: rival.id,
        };
        g.rumors.push(rumor);
        player.renown = Math.max(0, _num(player.renown) - 1);
        return rumor;
    },

    // ──────────── PARTNERS, HIRES, RACES ────────────

    _tickPartner(player, world, notify) {
        const st = Rivals.state(player);
        const p = st.partner;
        if (!p) return;
        const rival = Rivals.get(player, p.id);
        const credit = _num(p.earned) - _num(p.credited);
        if (rival && credit > 0) {
            rival.gold += credit;
            rival.renown += 2;
            rival.deeds.delves++;
            Rivals.remember(rival, world, `shared a fair cut of ${p.lastSite || 'a delve'}`, 6);
            Rivals._news(player, world, rival, '🤝', `${rival.name} delved ${p.lastSite || 'the depths'} at your side.`);
            p.credited = _num(p.earned);
        }
        if (!rival || rival.dead || _day(world) >= p.until) {
            st.partner = null;
            if (rival && !rival.dead) {
                rival.with = null;
                rival.q = player.q != null ? player.q : rival.q;
                rival.r = player.r != null ? player.r : rival.r;
                Rivals._rest(rival, world);
                notify(rival.icon, 'Partnership Ends', `${rival.name} parts ways with you${_num(p.earned) ? ` (${_num(p.earned)}g richer)` : ''}.`, 'info');
            }
        }
    },

    _tickHires(player, world, notify) {
        const day = _day(world);
        for (const rival of Rivals.state(player).list) {
            if (rival.dead || !rival.with || rival.with.kind !== 'hire') continue;
            const army = Array.isArray(player.army) ? player.army : [];
            const unit = army.find(u => u && u.rivalId === rival.id);
            if (!unit) {
                // Lost from your ranks (a battle, desertion, surgery tents): dead, or out of the fight
                if (Utils.random() < 0.5) {
                    Rivals._kill(player, world, rival, 'fell fighting under your banner', notify, player.q, player.r);
                } else {
                    rival.with = null;
                    rival.q = player.q != null ? player.q : rival.q;
                    rival.r = player.r != null ? player.r : rival.r;
                    rival.restUntil = day + 10;
                    notify(rival.icon, 'Hireling Wounded', `${rival.name} was carried from your ranks badly hurt and leaves your service to recover.`, 'warning');
                }
                continue;
            }
            if (day >= rival.with.until) {
                player.army = army.filter(u => u !== unit);
                rival.with = null;
                rival.q = player.q != null ? player.q : rival.q;
                rival.r = player.r != null ? player.r : rival.r;
                Rivals.remember(rival, world, 'served out a contract with you', 5);
                Rivals._rest(rival, world);
                notify(rival.icon, 'Contract Ends', `${rival.name}'s contract is up; they leave your company on good terms.`, 'info');
            }
        }
    },

    _tickRace(player, world, notify) {
        const race = Rivals.state(player).race;
        if (!race) return;
        const tile = world.getTile ? world.getTile(race.q, race.r) : null;
        const poi = tile && tile.improvement;
        // You delved it first
        if (poi && poi.delved && poi.delved.reason !== 'rival') Rivals._settleRace(player, world, notify);
    },

    /** Settle the race: whoever delved the site first wins the wager. */
    _settleRace(player, world, notify) {
        const st = Rivals.state(player);
        const race = st.race;
        if (!race) return null;
        st.race = null;
        const rival = Rivals.get(player, race.rivalId);
        const tile = world.getTile ? world.getTile(race.q, race.r) : null;
        const poi = tile && tile.improvement;
        const cfg = Rivals.config().race;
        const lines = Rivals.data().lines || {};
        const playerWon = !!(poi && poi.delved && poi.delved.reason !== 'rival');
        if (playerWon) {
            const purse = race.wager * 2;
            player.gold = _num(player.gold) + purse;
            player.renown = _num(player.renown) + cfg.renown;
            st.stats.racesWon++;
            if (rival) {
                rival.renown = Math.max(0, rival.renown - 2);
                Rivals.remember(rival, world, `lost a race to ${race.siteName}`, -6);
                if (rival.task && rival.task.key === race.key) rival.task = null;
                Rivals._news(player, world, rival, '🏁', `You beat ${rival.name} to ${race.siteName}.`, race.q, race.r);
            }
            notify('🏁', 'Race Won!', `You reached ${race.siteName} before ${rival ? rival.name : 'your rival'}: +${purse} gold, +${cfg.renown} renown. "${_pick(lines.raceWon) || 'Curse you.'}"`, 'success');
        } else {
            st.stats.racesLost++;
            if (rival) {
                rival.gold += race.wager * 2;
                rival.renown += 2;
                Rivals.remember(rival, world, `won a race to ${race.siteName}`, 3);
                Rivals._news(player, world, rival, '🏁', `${rival.name} beat you to ${race.siteName}.`, race.q, race.r);
            }
            notify('🏁', 'Race Lost', `${rival ? rival.name : 'Your rival'} got to ${race.siteName} first; your ${race.wager}g wager is gone. "${_pick(lines.raceLost) || 'Too slow!'}"`, 'warning');
        }
        return { playerWon };
    },

    // ──────────── ENCOUNTERS (player actions) ────────────

    /** Rivals idle at this tile (in town, not travelling, not at your side). */
    rivalsAt(player, world, q, r) {
        return Rivals.alive(player).filter(x => !x.task && !x.with && x.q === q && x.r === r);
    },

    /** Rivals at your side (partner / hired). */
    companionsOf(player) {
        return Rivals.alive(player).filter(x => x.with);
    },

    /** A line the rival says, by mood and situation. */
    line(rival, kind = 'greet') {
        const arch = Rivals.archetype(rival.archetype);
        const lines = arch.lines || {};
        const generic = Rivals.data().lines || {};
        if (kind === 'greet') {
            const att = Rivals.attitudeOf(rival).id;
            const pool = att === 'friend' || att === 'friendly' ? lines.friendly
                : att === 'rival' || att === 'nemesis' ? lines.hostile : lines.greet;
            return _pick(pool) || _pick(lines.greet) || 'Well met.';
        }
        return _pick(lines[kind]) || _pick(generic[kind]) || '...';
    },

    /**
     * The player arrives somewhere: rivals here are met. Returns
     * [{ rival, line, first }] for the arrival notices.
     */
    onPlayerArrived(player, world, tile) {
        if (!tile) return [];
        const out = [];
        for (const rival of Rivals.rivalsAt(player, world, tile.q, tile.r)) {
            const first = !rival.met;
            rival.met = true;
            out.push({ rival, line: Rivals.line(rival, first ? 'boast' : 'greet'), first });
        }
        return out;
    },

    /** Small talk: a line, and maybe a tip about their next plans. */
    talk(player, world, id) {
        const rival = Rivals.get(player, id);
        if (!rival || rival.dead) return { success: false, reason: 'They are not here.' };
        rival.met = true;
        let text = Rivals.line(rival, 'greet');
        if (rival.claimName) text += ` (They call themself the rightful heir of ${rival.claimName}.)`;
        return { success: true, text, attitude: Rivals.attitudeOf(rival) };
    },

    /** Personal fighting power of the player (stats, gear, traits, mood). */
    playerPower(player) {
        const combat = _num(player.skills && player.skills.combat) || 1;
        const base = combat * 2 + _num(player.strength || 5) * 0.6 + _num(player.luck || 5) * 0.2;
        const mult = PlayerEffects.traitBattleMultiplier(player) * PlayerEffects.moodCombatMultiplier(player)
            * (1 + _num(PlayerEffects.treasureBonus(player, 'battlePower')));
        return base * mult;
    },

    rivalPower(rival) {
        return rival.stats.prowess * 2 + rival.level + rival.stats.cunning * 0.3
            + _num(rival.retainers) * Rivals.config().spend.retainerPower;
    },

    /**
     * Faith in a fight: each side's conviction ((faith − 5) × 0.3), and a
     * devout rival (faith 7+) holds back against a Pious player — they will
     * not strike a fellow believer in earnest (except a nemesis).
     * Returns { player, rival } roll adjustments.
     */
    faithEdge(player, rival) {
        const cfg = Rivals.config().faith;
        const p = (_num(player.faith || 5) - 5) * cfg.duelPerPoint;
        let r = (_num(rival.stats.faith) - 5) * cfg.duelPerPoint;
        if (rival.stats.faith >= cfg.devoutAt && Traits.has(player, 'pious') && !Rivals.isNemesis(rival)) r -= cfg.piousRestraint;
        return { player: p, rival: r };
    },

    /** A fight between the player and a rival (duel or ambush). */
    _fight(player, world, rival, { toDeath = false, ambush = false } = {}) {
        const cfg = Rivals.config().duel;
        const faith = Rivals.faithEdge(player, rival);
        const pRoll = Rivals.playerPower(player) + faith.player + Utils.randInt(1, 8) - (ambush ? 2 : 0);
        const rRoll = Rivals.rivalPower(rival) + faith.rival + Utils.randInt(1, 8);
        const playerWon = pRoll >= rRoll;
        const res = { playerWon, harm: 0, renown: 0, rivalDied: false, goldLost: 0, wound: null };
        const st = Rivals.state(player);
        const day = _day(world);
        if (playerWon) {
            res.harm = PlayerEffects.scaleDamage(player, Math.round(_roll(cfg.harm) / 2));
            res.renown = Math.max(cfg.minRenown, Math.floor(rival.renown / 10) * cfg.renownPerTen);
            player.renown = _num(player.renown) + res.renown;
            rival.renown = Math.max(0, rival.renown - Math.ceil(res.renown / 2));
            rival.deeds.duelsLost++;
            st.stats.duelsWon++;
            if (toDeath || (ambush && Utils.random() < 0.3)) {
                res.rivalDied = true;
                st.stats.slain++;
                Rivals._kill(player, world, rival, `was slain by ${player.name || 'you'} ${ambush ? 'in a failed ambush' : 'in a duel to the death'}`, () => {}, player.q, player.r);
            } else {
                Rivals.remember(rival, world, ambush ? 'beat off my ambush' : 'beat me in a duel', ambush ? -5 : -8);
            }
        } else {
            res.harm = PlayerEffects.scaleDamage(player, _roll(toDeath ? cfg.deathHarm : cfg.harm));
            rival.renown += Math.max(1, Math.floor(_num(player.renown) / 20));
            rival.deeds.duelsWon++;
            st.stats.duelsLost++;
            if (ambush) {
                res.goldLost = Math.min(_num(player.gold), Math.round(_num(player.gold) * 0.1));
                player.gold = _num(player.gold) - res.goldLost;
                rival.gold += res.goldLost;
            }
            Rivals.remember(rival, world, ambush ? 'fell to my ambush' : 'lost a duel to me', ambush ? 0 : 4);
            // The loser may carry a wound away (the 'duel' / 'ambush' sources in data/ailments.json)
            res.wound = Ailments.maybeWound(player, world, ambush ? 'ambush' : 'duel', { chanceMult: toDeath ? 2 : 1 });
        }
        player.health = Math.max(1, _num(player.health) - res.harm);
        if (!res.rivalDied) {
            Rivals._news(player, world, rival, '⚔️', playerWon ? `${player.name || 'You'} bested ${rival.name}${ambush ? ' in an ambush' : ' in a duel'}.` : `${rival.name} bested ${player.name || 'you'}${ambush ? ' in an ambush' : ' in a duel'}.`, player.q, player.r);
        }
        rival.lastFightDay = day;
        return res;
    },

    /** Will this rival accept a duel? */
    willDuel(rival, toDeath = false) {
        const att = _num(rival.attitude);
        if (toDeath) return att <= Rivals.config().attitude.rival;
        const arch = Rivals.archetype(rival.archetype);
        return att < Rivals.config().attitude.friend || !!arch.duelist;
    },

    /** Challenge a rival here to a duel (first blood, or to the death). */
    duel(player, world, id, { toDeath = false } = {}) {
        const rival = Rivals.get(player, id);
        if (!rival || rival.dead) return { success: false, reason: 'They are not here.' };
        if (rival.lastFightDay === _day(world)) return { success: false, reason: `${rival.name} has had enough fighting for one day.` };
        if (!Rivals.willDuel(rival, toDeath)) {
            return { success: false, refused: true, reason: `${rival.name}: "${Rivals.line(rival, 'duelRefuse')}"` };
        }
        rival.met = true;
        const accept = Rivals.line(rival, 'duelAccept');
        const res = Rivals._fight(player, world, rival, { toDeath });
        const after = res.rivalDied ? '' : Rivals.line(rival, res.playerWon ? 'duelLose' : 'duelWin');
        return { success: true, ...res, accept, after, rival };
    },

    canTeamUp(player, rival) {
        if (!rival || rival.dead || rival.with) return { ok: false, reason: 'They are not free.' };
        if (Rivals.state(player).partner) return { ok: false, reason: 'You already have a delving partner.' };
        if (!Rivals.archetype(rival.archetype).teamUp) return { ok: false, reason: `${rival.name}: "${Rivals.line(rival, 'teamUpNo')}"` };
        if (rival.attitude < Rivals.config().attitude.rival) return { ok: false, reason: `${rival.name}: "${Rivals.line(rival, 'teamUpNo')}"` };
        return { ok: true };
    },

    /** Team up for delving: they travel with you for a few days and take a share of the gold. */
    teamUp(player, world, id) {
        const rival = Rivals.get(player, id);
        const gate = Rivals.canTeamUp(player, rival);
        if (!gate.ok) return { success: false, reason: gate.reason };
        const cfg = Rivals.config().teamUp;
        const st = Rivals.state(player);
        const bonus = Math.round((cfg.bonus + rival.stats.prowess * 0.005 + rival.stats.cunning * 0.005) * 100) / 100;
        st.partner = { id: rival.id, name: rival.name, until: _day(world) + cfg.days, share: cfg.share, bonus, earned: 0, credited: 0, delves: 0 };
        rival.with = { kind: 'partner', until: _day(world) + cfg.days };
        rival.task = null;
        rival.met = true;
        st.stats.teamUps++;
        Rivals.remember(rival, world, 'asked me to delve as partners', 3);
        return { success: true, text: Rivals.line(rival, 'teamUpYes'), partner: st.partner };
    },

    hireCost(rival) {
        const cfg = Rivals.config().hire;
        return cfg.baseCost + cfg.costPerLevel * rival.level;
    },

    canHire(player, rival) {
        if (!rival || rival.dead || rival.with) return { ok: false, reason: 'They are not free.' };
        const arch = Rivals.archetype(rival.archetype);
        if (!arch.hireable || rival.attitude <= Rivals.config().attitude.rival) return { ok: false, reason: `${rival.name}: "${Rivals.line(rival, 'hireNo')}"` };
        const cost = Rivals.hireCost(rival);
        if (_num(player.gold) < cost) return { ok: false, reason: `${rival.name} wants ${cost} gold.` };
        return { ok: true, cost };
    },

    /** Hire a rival's sword: they join your army for a contract, paid up front. */
    hire(player, world, id) {
        const rival = Rivals.get(player, id);
        const gate = Rivals.canHire(player, rival);
        if (!gate.ok) return { success: false, reason: gate.reason };
        const cfg = Rivals.config().hire;
        player.gold = _num(player.gold) - gate.cost;
        rival.gold += gate.cost;
        rival.with = { kind: 'hire', until: _day(world) + cfg.days };
        rival.task = null;
        rival.met = true;
        if (!Array.isArray(player.army)) player.army = [];
        player.army.push({
            type: `rival_${rival.id}`,
            name: rival.name,
            icon: rival.icon,
            strength: 8 + rival.stats.prowess * 2,
            upkeep: 0,
            experience: 20 + rival.level * 5,
            level: rival.level,
            rivalId: rival.id,
            backstory: `${Rivals.archetype(rival.archetype).label}, hired until day ${rival.with.until}.`,
        });
        Rivals.state(player).stats.hires++;
        Rivals.remember(rival, world, 'hired my sword', 2);
        return { success: true, cost: gate.cost, text: Rivals.line(rival, 'hireYes') };
    },

    /**
     * Race a rival to the nearest unexplored delve site: you each stake a
     * wager; whoever delves it first takes the pot.
     */
    race(player, world, id) {
        const rival = Rivals.get(player, id);
        const st = Rivals.state(player);
        if (!rival || rival.dead || rival.with) return { success: false, reason: 'They are not free.' };
        if (st.race) return { success: false, reason: 'You are already racing someone.' };
        const cfg = Rivals.config().race;
        if (_num(player.gold) < cfg.wager) return { success: false, reason: `The wager is ${cfg.wager} gold.` };
        const site = Rivals._findDelveSite(player, world, rival);
        if (!site) return { success: false, reason: 'There is no unexplored ruin or cave near enough to race for.' };
        const tile = world.getTile(site.q, site.r);
        const siteName = (tile.improvement && tile.improvement.name) || 'the ruin';
        player.gold -= cfg.wager;
        rival.task = {
            type: 'delve', q: site.q, r: site.r, name: siteName, key: _key(site.q, site.r),
            // they need a day to provision, then travel like you
            arriveDay: _day(world) + 1 + Rivals._travelDays(world, { q: rival.q, r: rival.r }, site),
        };
        st.race = { rivalId: rival.id, key: _key(site.q, site.r), q: site.q, r: site.r, siteName, wager: cfg.wager, deadline: rival.task.arriveDay };
        rival.met = true;
        return { success: true, text: Rivals.line(rival, 'raceAccept'), race: st.race };
    },

    sabotageChance(player) {
        const cfg = Rivals.config().sabotage;
        const stealth = _num(player.skills && player.skills.stealth);
        const guild = player.underworld && player.underworld.guild && player.underworld.guild.member ? cfg.guildBonus : 0;
        return Utils.clamp(cfg.base + stealth * cfg.perStealth + guild, 0.05, 0.9);
    },

    /**
     * Pay cutthroats (or your guild friends) to waylay a rival: success delays
     * their current venture and dents their renown; failure is traced to you.
     */
    sabotage(player, world, id) {
        const rival = Rivals.get(player, id);
        const st = Rivals.state(player);
        if (!rival || rival.dead || rival.with) return { success: false, reason: 'You cannot reach them.' };
        const cfg = Rivals.config().sabotage;
        if (_num(player.gold) < cfg.cost) return { success: false, reason: `It costs ${cfg.cost} gold to arrange.` };
        player.gold -= cfg.cost;
        st.stats.sabotaged++;
        const ok = Utils.random() < Rivals.sabotageChance(player);
        if (ok) {
            const delay = _roll(cfg.delayDays);
            if (rival.task) {
                rival.task.arriveDay += delay;
                if (st.race && st.race.rivalId === rival.id) st.race.deadline = rival.task.arriveDay;
            } else {
                rival.restUntil = Math.max(rival.restUntil, _day(world)) + delay;
            }
            rival.renown = Math.max(0, rival.renown - 3);
            return { success: true, caught: false, delay, text: `${rival.name} is waylaid — robbed, lamed horse, a week of trouble. They lose ${delay} days.` };
        }
        Rivals.remember(rival, world, 'sent cutthroats after me', -25);
        player.karma = _num(player.karma) - 2;
        return { success: true, caught: true, text: `The cutthroats botched it and talked. ${rival.name} knows it was you.` };
    },

    // ──────────── CONTESTS ────────────

    /** Rivals near a settlement who would enter its contests (closest first). */
    entrantsNear(player, world, tile, limit = 2, radius = 10) {
        if (!tile) return [];
        return Rivals.alive(player)
            .filter(r => !r.with && (!r.task || r.task.type === 'festival' || r.task.type === 'wander'))
            .map(r => ({ r, d: Rivals._dist(world, tile.q, tile.r, r.task ? r.task.q : r.q, r.task ? r.task.r : r.r) }))
            .filter(x => x.d <= radius)
            .sort((a, b) => a.d - b.d || b.r.renown - a.r.renown)
            .slice(0, limit)
            .map(x => x.r);
    },

    /** Named opponents for a tournament here: [{ id, name, power }] (power on the tournament's scale). */
    tournamentEntrants(player, world, tile, limit = 2) {
        return Rivals.entrantsNear(player, world, tile, limit).map(r => ({
            id: r.id, name: `${r.icon} ${r.name}`, power: 3 + r.stats.prowess * 1.1 + r.level * 0.5,
        }));
    },

    /** Record a tournament bout against a rival. */
    recordBout(player, world, id, playerWon) {
        const rival = Rivals.get(player, id);
        if (!rival) return;
        rival.met = true;
        rival.deeds.tournaments++;
        if (playerWon) {
            rival.renown = Math.max(0, rival.renown - 1);
            Rivals.remember(rival, world, 'unhorsed me in the lists', -3);
        } else {
            rival.renown += 2;
            Rivals.remember(rival, world, 'fell to me in the lists', 1);
        }
    },

    /**
     * Rival contestants at a festival you host. Each scores against your
     * finish (champion > strong > rough); those who beat you gain renown and
     * swagger, those you beat resent it a little. Returns standings.
     */
    festivalContest(player, world, tile, playerTier, contestId) {
        const entrants = Rivals.entrantsNear(player, world, tile, 3);
        const tierScore = { champion: 16, strong: 12, rough: 8 }[playerTier] || 10;
        const out = [];
        for (const rival of entrants) {
            const score = rival.stats.prowess * 1.2 + rival.level * 0.6 + Utils.randFloat(0.5, 6);
            const beat = score > tierScore;
            rival.met = true;
            rival.deeds.tournaments++;
            if (beat) {
                rival.renown += 3;
                Rivals.remember(rival, world, 'was outshone by me at their own festival', 1);
            } else {
                player.renown = _num(player.renown) + 1;
                Rivals.remember(rival, world, 'beat me at their festival', -2);
            }
            out.push({ id: rival.id, name: rival.name, icon: rival.icon, beatPlayer: beat, contest: CONTEST_NAMES[contestId] || 'contest' });
        }
        if (out.some(x => x.beatPlayer)) {
            const w = out.find(x => x.beatPlayer);
            const r = Rivals.get(player, w.id);
            Rivals._news(player, world, r, '🏆', `${w.name} outshone ${player.name || 'you'} at ${tile.settlement ? tile.settlement.name : 'a festival'}.`, tile.q, tile.r);
        }
        return out;
    },

    // ──────────── HALL OF HEROES ────────────

    statusText(player, world, rival) {
        if (rival.dead) return `Died on day ${rival.dead.day}`;
        if (rival.with) return rival.with.kind === 'hire' ? 'Riding in your company' : 'Delving at your side';
        const t = rival.task;
        if (t) {
            const days = Math.max(0, t.arriveDay - _day(world));
            const verb = { delve: 'Bound for', bounty: t.target ? `Hunting ${t.target} near` : 'Hunting outlaws near', quest: 'On a commission at', festival: 'Off to the contests at', hunt: 'On the road near', usurp: 'Scheming at', wander: 'Travelling to' }[t.type] || 'Travelling to';
            return `${verb} ${t.name}${days ? ` (~${days}d)` : ''}`;
        }
        return `Resting in ${Rivals._placeName(world, rival.q, rival.r)}`;
    },

    /** The leaderboard: the player and the living rivals, by renown. */
    leaderboard(player, world) {
        const rows = [{ isPlayer: true, name: player.name || 'You', icon: '🛡️', renown: _num(player.renown), label: 'You' }];
        for (const r of Rivals.alive(player)) {
            rows.push({
                isPlayer: false, id: r.id, name: r.name, icon: r.icon, renown: r.renown,
                label: Rivals.archetype(r.archetype).label,
                attitude: Rivals.attitudeOf(r),
                status: Rivals.statusText(player, world, r),
                met: r.met,
                claim: r.claimName || null,
            });
        }
        rows.sort((a, b) => b.renown - a.renown || (a.isPlayer ? -1 : 1));
        rows.forEach((row, i) => { row.rank = i + 1; });
        return rows;
    },

    fallen(player) {
        return Rivals.state(player).list.filter(r => r.dead);
    },
};
