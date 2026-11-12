// ============================================
// CADET BRANCHES — younger lines of the House, out in the world
// ============================================
// A grown child of the House who is not the heir can be SENT OFF (the House
// panel) — or, holding a portion of their own (systems/inheritance.js), may
// LEAVE ON THEIR OWN — to found a cadet branch: a real minor House of the
// blood, "House X of <seat town>", in the world.
//
//   The branch    a head (the child, then their heirs), a purse seeded from
//                 the child's portion plus whatever the player grants (coin
//                 moves from purse to purse; none is made), a seat town, an
//                 estate if the player grants one (world/estates.js: held as
//                 `rival:cadet_<id>`, its rents swept into the purse), and a
//                 retinue on the map ('cadet_retinue', saved with world.units).
//   Its life      run by the rival-House AI (systems/rivalHouses.js) with no
//                 player to plot against: it trades, sits at court, buys land,
//                 rests at home; dues from its seat town, a household spending
//                 back into it; the head ages, weds, has children and dies, a
//                 child (or a cousin) takes the branch. Its children wed out,
//                 sometimes into a rival House — which cools that feud.
//   LOYALTY       0–100 to the main line. Gifts, summons answered and wars
//                 shared raise it; neglect, the generations and hard asks
//                 wear it down; falling on its retinue wrecks it. A loyal
//                 branch sends tribute and, in war, a levy of men it pays
//                 itself. Below `loyalty.estrangedBelow` it breaks with you:
//                 it speaks against you at court and may press a claim at
//                 your succession (House._disputeChance / _fragmentHoldings
//                 read estranged branches as claimants). Gifts can win it back.
//   Asks          by letter: gold from their purse, men for a war, or a
//                 summons — the head rides to you and stays a few days.
//   Sub-branches  a branch head's younger grown child may found a branch of
//                 their own, a generation further out (capped: maxBranches
//                 living, maxDepth generations).
//   Succession    when the main line has no heir of the blood, the nearest
//                 branch's head (fewest generations out, oldest founding) can
//                 take up the mantle (succeed): their purse and estates come
//                 with them, their children become the new ruler's, and the
//                 branch folds back into the main line — before any estate
//                 settlement (player/estateSettlement.js counts the House
//                 heirless only when no branch remains).
//
// The dynasty tree (systems/dynastyTree.js) keeps each head as a person of
// the blood with a `branch` line and `cadet` id; heads are listed after the
// siblings in the line of succession.
//
// State on player.house.cadets (saved with the House). The day draws from its
// own seeded stream (world seed + day, Utils.withRng). Content in
// data/cadetBranches.json. No import-time effects; no globals.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { WorldUnit } from '../world/units.js';
import { Seasons } from '../world/seasons.js';
import { Economy } from '../world/economy.js';
import { Estates } from '../world/estates.js';
import { LandMarket } from './landMarket.js';
import { RivalHouses } from './rivalHouses.js';
import { House } from './house.js';
import { Inheritance } from './inheritance.js';
import { Ledger } from './ledger.js';
import { DynastyTree } from './dynastyTree.js';
import { RealmWars } from './realmWars.js';
import { Upbringing } from './upbringing.js';
import { Relationships } from './relationships.js';
import { Holdings } from './holdings.js';

export const CADET_TYPE = 'cadet_retinue';
export const LEVY_TYPE = 'cadet_levy';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _day = world => (world && Number.isFinite(world.day) ? world.day : 0);
const _clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const _range = (v, d) => (Array.isArray(v) && v.length === 2 ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function _seed(world) {
    const p = world && world.generationParams;
    return (p && p.seed) || 0;
}

function _dist(world, a, b) {
    return Hex.wrappingDistance(a.q, a.r, b.q, b.r, (world && world.width) || 0);
}

const DEFAULTS = {
    enabled: true,
    icon: '🌿',
    maxBranches: 6,
    maxDepth: 3,
    poorBelow: 400,
    found: { minAge: 18, startLoyalty: 62, grantPer: 400, grantLoyalty: 5, grantLoyaltyMax: 15, ownWayLoyalty: 48, prestige: 3 },
    leave: { enabled: true, minAge: 21, minPurse: 300, chance: 0.12 },
    sub: { minAge: 22, chance: 0.1, minGold: 900, share: 0.25, loyaltyDrop: 8 },
    income: { weekly: 14, perStewardship: 4 },
    upkeep: { weekly: 12, share: 0.008 },
    loyalty: { yearly: -1, neglectDays: 360, neglect: 4, prestigeAt: 100, prestigeBonus: 1, newHead: 0.7, depth: 3, estrangedBelow: 20, reconcileAt: 35, attacked: -40, claimChance: 0.04, claimFeud: 50 },
    gift: { perLoyalty: 25, maxLoyalty: 15, recentDays: 60, recentFactor: 0.5, amounts: [100, 300, 1000] },
    ask: {
        gold: { share: 0.2, min: 50, needLoyalty: 40, loyaltyCost: 8, refuse: -3, cooldown: 120 },
        men: { needLoyalty: 50, loyaltyCost: 6, refuse: -3, cooldown: 120 },
        summon: { needLoyalty: 35, loyalty: 4, prestige: 2, refuse: -3, cooldown: 90, stay: [3, 6] },
    },
    tribute: { loyalty: 70, share: 0.06, min: 30, reserve: 700, every: 120 },
    aid: { loyalty: 60, base: 10, perMartial: 2, men: 6, wage: 4, days: 90, every: 180, minGold: 200 },
    estranged: { whisper: 3 },
    marriage: { rivalChance: 0.35, feud: -5 },
};

export const CadetBranches = {
    CADET_TYPE,
    LEVY_TYPE,

    // ──────────── DATA ────────────

    config() {
        const d = _obj(DataLoader._gamedata && DataLoader._gamedata.cadetBranches) || {};
        const out = { ...DEFAULTS, ...d };
        for (const k of ['found', 'leave', 'sub', 'income', 'upkeep', 'loyalty', 'gift', 'tribute', 'aid', 'estranged', 'marriage']) {
            out[k] = { ...DEFAULTS[k], ...(_obj(d[k]) || {}) };
        }
        const a = _obj(d.ask) || {};
        out.ask = {};
        for (const k of Object.keys(DEFAULTS.ask)) out.ask[k] = { ...DEFAULTS.ask[k], ...(_obj(a[k]) || {}) };
        return out;
    },

    // ──────────── STATE ────────────

    /** The House's branches array (created on first use), or null without a House. */
    state(player) {
        const house = player && player.house;
        if (!house) return null;
        if (!Array.isArray(house.cadets)) house.cadets = [];
        return house.cadets;
    },

    /** The living branches. */
    list(player) {
        const house = player && player.house;
        return ((house && Array.isArray(house.cadets)) ? house.cadets : []).filter(b => b && b.head && !b.ended);
    },

    get(player, id) {
        return this.list(player).find(b => b.id === id) || null;
    },

    /** After load: the array, and every branch's numbers sane. */
    loadState(player) {
        const list = this.state(player);
        if (!list) return;
        player.house.cadets = list.filter(b => b && typeof b === 'object' && b.id && b.head);
        for (const b of player.house.cadets) {
            b.loyalty = _clamp(_num(b.loyalty, 50), 0, 100);
            b.gold = Math.max(0, _num(b.gold));
            if (!_obj(b.asked)) b.asked = {};
            if (!Array.isArray(b.log)) b.log = [];
        }
    },

    /** "Lord Edric Varr of Ashford". */
    headName(b) {
        return RivalHouses.headName(b);
    },

    loyaltyLabel(v) {
        const n = _num(v);
        return n >= 80 ? 'Devoted' : n >= 60 ? 'Loyal' : n >= 40 ? 'Dutiful' : n >= 20 ? 'Cool' : 'Estranged';
    },

    // ──────────── RANDOMNESS ────────────

    _rng(world, key) {
        return Utils.seededRandom((_hash(`${_seed(world)}:cadetBranches:${_day(world)}:${key}`) % 233279) + 1);
    },

    // ──────────── FOUNDING ────────────

    _dynasty(player) {
        const house = player && player.house;
        const n = String((house && house.name) || '');
        return n.startsWith('House ') ? n.slice(6) : (player && (player.lastName || (player.dynasty && player.dynasty.name))) || 'the House';
    },

    /** Towns already a House's seat (rivals' and branches'), as "q,r" keys. */
    _takenSeats(player) {
        const out = new Set();
        for (const r of RivalHouses.rivals(player)) if (r && r.seat) out.add(`${r.seat.q},${r.seat.r}`);
        for (const b of this.list(player)) if (b.seat) out.add(`${b.seat.q},${b.seat.r}`);
        return out;
    },

    /** The realm a new branch sits in: the one given, the player's liege, else where the player stands (or the nearest town's). */
    _realmFor(player, world, kingdomId = null) {
        const alive = id => {
            const k = id != null && world && typeof world.getKingdom === 'function' ? world.getKingdom(id) : null;
            return k && k.isAlive !== false ? k.id : null;
        };
        let kid = alive(kingdomId);
        if (kid == null && player) kid = alive(player.allegiance);
        if (kid == null && player) {
            const t = typeof world.getTile === 'function' ? world.getTile(player.q, player.r) : null;
            kid = alive(t && t.settlement ? t.settlement.kingdom : (t ? t.kingdom : null));
        }
        if (kid == null && player) {
            const town = RivalHouses._nearestTown(world, player);
            kid = alive(town && town.kingdom);
        }
        return kid;
    },

    /** A seat town for a new branch: the most populous untaken town of the realm, not its capital; else any untaken town nearest the player. */
    _pickSeat(player, world, kingdomId) {
        const towns = RivalHouses._towns(world).filter(s => s && Number.isFinite(s.q));
        const taken = this._takenSeats(player);
        const free = towns.filter(s => !taken.has(`${s.q},${s.r}`));
        const k = kingdomId != null && world.getKingdom ? world.getKingdom(kingdomId) : null;
        const cap = k && k.capital;
        const realm = free.filter(s => s.kingdom === kingdomId && !(cap && s.q === cap.q && s.r === cap.r))
            .sort((a, b) => _num(b.population) - _num(a.population));
        let pick = realm[0] || null;
        if (!pick && player) pick = free.slice().sort((a, b) => _dist(world, player, a) - _dist(world, player, b))[0] || null;
        if (!pick) pick = free[0] || towns[0] || null;
        return pick ? { q: pick.q, r: pick.r, name: pick.name, kingdomId: pick.kingdom != null ? pick.kingdom : kingdomId } : null;
    },

    /** Two temper traits for a head (from data/rivalHouses.json traits), drawn from the stream. */
    _traits() {
        const ids = Object.keys(RivalHouses.config().traits || {});
        const out = [];
        while (out.length < 2 && ids.length) out.push(ids.splice(Utils.randInt(0, ids.length - 1), 1)[0]);
        return out;
    },

    /** A rival-shaped head from a child of the House (their skills on the rival scale). */
    _headFromChild(world, child) {
        const sk = child.skills || {};
        const lv = (skill, stat) => _clamp(2 + Math.round(_num(skill) / 2 + (_num(stat, 5) - 5) / 2), 1, 10);
        const snapshot = JSON.parse(JSON.stringify(child));
        delete snapshot.purse;
        const head = {
            firstName: child.firstName || 'Edmund', gender: child.gender || 'male', age: _num(child.age, 18),
            diplomacy: lv(sk.diplomacy, child.charisma), stewardship: lv(sk.commerce, child.intelligence),
            intrigue: lv(sk.stealth, child.intelligence), martial: lv(sk.combat, child.strength),
            traits: this._traits(), spouse: null, children: [], personId: child.id || null, snapshot,
        };
        const sp = child.upbringing && child.upbringing.spouse;
        if (sp && sp.name) head.spouse = { firstName: String(sp.name).split(' ')[0], gender: head.gender === 'female' ? 'male' : 'female', age: head.age };
        return head;
    },

    /** Why a child cannot found a branch now (null when they can). */
    whyNot(player, world, childId) {
        const C = this.config();
        if (C.enabled === false) return 'Cadet branches are not in this world.';
        if (!player || !player.house) return 'You have no House.';
        const child = ((player.children) || []).find(c => c && c.id === childId);
        if (!child || child.isAlive === false) return 'No such child of the House.';
        if (_num(child.age) < _num(C.found.minAge, 18)) return `${child.firstName} must be ${C.found.minAge} to found a branch.`;
        if (player.heir === child.id) return `${child.firstName} is your heir.`;
        const up = child.upbringing || {};
        const a = up.agency || {};
        if (Upbringing.isAway(child) || up.heldBy || a.captive || (a.commission && a.commission.kind === 'envoy')) return `${child.firstName} is away from home.`;
        if (this.list(player).length >= _num(C.maxBranches, 6)) return 'The House has as many branches as it can keep track of.';
        if (!this._pickSeat(player, world, this._realmFor(player, world))) return 'There is no town to seat a branch in.';
        return null;
    },

    /** Adult children who could be sent off to found a branch. */
    candidates(player, world) {
        return ((player && player.children) || []).filter(c => c && c.isAlive !== false && !this.whyNot(player, world, c.id));
    },

    /** The player's estates that could be granted to a branch. */
    grantableEstates(player, world) {
        if (!world || !world.estates || !Estates.enabled()) return [];
        return Estates.heldBy(world, 'player');
    },

    /**
     * Found a branch. opts: { grant (gold from the player's purse on top of the
     * child's portion), estateId (a player estate to grant), why: 'sent'|'own',
     * kingdomId } → { success, branch, text } | { success: false, reason }.
     */
    found(player, world, childId, opts = {}) {
        const why = this.whyNot(player, world, childId);
        if (why) return { success: false, reason: why };
        const C = this.config();
        const F = C.found;
        const house = player.house;
        const child = player.children.find(c => c.id === childId);
        const grant = Math.max(0, Math.floor(_num(opts.grant)));
        if (grant > Inheritance.coin(player)) return { success: false, reason: `You do not have ${grant} gold to grant.` };
        const day = _day(world);
        const kingdomId = this._realmFor(player, world, opts.kingdomId);
        const seat = this._pickSeat(player, world, kingdomId);
        house.cadetSeq = _num(house.cadetSeq) + 1;
        const id = `cb${house.cadetSeq}`;
        const own = opts.why === 'own';
        let branch = null;
        Utils.withRng(this._rng(world, `found:${id}`), () => {
            const head = this._headFromChild(world, child);
            const loyalty = own ? _num(F.ownWayLoyalty, 48)
                : _num(F.startLoyalty, 62) + Math.min(_num(F.grantLoyaltyMax, 15), Math.floor(grant / Math.max(1, _num(F.grantPer, 400))) * _num(F.grantLoyalty, 5));
            branch = this._record(player, world, { id, head, seat, kingdomId: seat.kingdomId != null ? seat.kingdomId : kingdomId, loyalty, parentId: null, depth: 1, founder: child.firstName, why: own ? 'own' : 'sent' });
        });
        // The coin: the child's portion and the grant become the branch's purse
        const portion = Math.max(0, _num(child.purse));
        child.purse = 0;
        if (grant > 0) {
            Inheritance.setCoin(player, Inheritance.coin(player) - grant);
            Ledger.record(player, 'family', -grant);
        }
        branch.gold = Math.round((portion + grant) * 100) / 100;
        branch.stats.seeded = branch.gold;
        // An estate granted with it
        let estate = null;
        if (opts.estateId && world.estates && world.estates.estates) {
            const e = world.estates.estates[opts.estateId];
            if (e && e.holder === 'player') {
                RivalHouses._holder(world, branch);
                LandMarket._setHolder(world, e, branch.landKey, day);
                estate = e;
                branch.stats.estatesGranted = 1;
            }
        }
        // The child leaves the household: no longer an heir, an officer or a ward of it
        // (the tree takes its last look at them as a child of the House first)
        DynastyTree.sync(player, world, { npc: n => Relationships.getNPC(n) });
        player.children = player.children.filter(c => c.id !== childId);
        for (const r of House.ROLE_IDS) if (house.roles && house.roles[r] === childId) house.roles[r] = null;
        // ...nor the governor of a holding: the seat falls vacant
        const leftPosts = this._leaveGovernorships(player, world, childId);
        if (house.regentDesignate && house.regentDesignate.id === childId) house.regentDesignate = null;
        this._treePerson(player, world, branch, null);
        if (!own) House.award(house, _num(F.prestige, 3), 'a cadet branch planted', day);
        const purse = branch.gold > 0 ? ` with ${Math.round(branch.gold)} gold` : ' with little but the name';
        const text = own
            ? `${child.firstName} takes their portion and leaves the household to found ${branch.name} at ${seat.name}${purse}.`
            : `${child.firstName} is sent out to found ${branch.name} at ${seat.name}${purse}${estate ? ` and the estate of ${estate.name}` : ''}.`;
        House._chronicle(house, world, text, ['cadet', 'founding']);
        const vacated = leftPosts.length ? `${child.firstName} gives up the governorship of ${leftPosts.join(' and ')}: the post is vacant.` : null;
        RivalHouses._note(branch, world, own ? 'Left the main household to make a House of our own.' : 'Founded by the main line\'s leave.');
        return { success: true, branch, text: vacated ? `${text} ${vacated}` : text, vacated };
    },

    /** A child leaving the household gives up any holding they govern. → the holdings' names. */
    _leaveGovernorships(player, world, childId) {
        const out = [];
        let refs = [];
        try { refs = Holdings.list(player, world); } catch (e) { refs = []; }
        for (const ref of refs) {
            const g = ref.settlement && ref.settlement.holding && ref.settlement.holding.governor;
            if (!g || g.id !== childId) continue;
            const res = Holdings.dismissGovernor(player, world, ref.q, ref.r);
            if (res && res.success) out.push(ref.settlement.name || 'a holding');
        }
        return out;
    },

    /** A new branch record, rival-shaped so RivalHouses can run it. */
    _record(player, world, o) {
        const day = _day(world);
        const branch = {
            id: o.id, cadet: true, kingdomId: o.kingdomId, name: `House ${this._dynasty(player)} of ${o.seat.name}`,
            houseKey: `cadet:${o.id}`, landKey: `rival:cadet_${o.id}`, parentId: o.parentId || null, depth: o.depth || 1,
            founded: day, foundedBy: player.name || null, founder: o.founder, why: o.why || 'sent',
            head: o.head, gold: 0, seat: { q: o.seat.q, r: o.seat.r, name: o.seat.name }, feud: 0,
            loyalty: _clamp(Math.round(_num(o.loyalty, 50)), 0, 100), estranged: false,
            lastContact: day, lastGiftDay: -1e9, lastTribute: day, lastAid: -1e9, asked: {},
            stats: { trades: 0, tradeProfit: 0, courtVisits: 0, plotsPaid: 0, heads: 1, gifts: 0, tribute: 0, asked: 0, levies: 0 },
            log: [],
        };
        RivalHouses._ensure(world, branch);
        this.state(player).push(branch);
        return branch;
    },

    // ──────────── THE DYNASTY TREE ────────────

    /** Write (or refresh) the branch head as a person of the blood in the House's lineage. */
    _treePerson(player, world, b, parentId) {
        const L = player && player.house ? DynastyTree.ensure(player, world) : null;
        if (!L || !b.head) return null;
        const Y = Seasons.DAYS_PER_YEAR;
        const day = _day(world);
        const h = b.head;
        if (!h.personId) h.personId = `${b.id}_h${_num(b.stats && b.stats.heads, 1)}`;
        let rec = L.people[h.personId];
        if (!rec) {
            const parent = parentId ? L.people[parentId] : null;
            rec = L.people[h.personId] = {
                id: h.personId, name: '', first: '', gender: null, kind: 'blood', generation: parent ? _num(parent.generation, 1) + 1 : (player.house.generation || 1),
                born: day - Math.round(_num(h.age) * Y), died: null, cause: null, alive: true,
                parents: parent ? [parent.id] : [], spouses: [], traits: [], titles: [], epithet: '',
                reign: null, regent: null, npcId: null, origin: null, appearance: null, branch: null, sibling: false, placement: null,
            };
        }
        rec.name = `${h.firstName} ${this._dynasty(player)}`;
        rec.first = h.firstName;
        rec.gender = h.gender || rec.gender;
        rec.alive = true;
        rec.cadet = b.id;
        rec.cadetHead = true;
        rec.branch = `head of ${b.name}${b.estranged ? ' (estranged)' : ''}`;
        const title = `Head of ${b.name}`;
        if (!rec.titles.includes(title)) rec.titles.push(title);
        return rec;
    },

    /** The head is dead (or gone): their person in the lineage, closed. */
    _treeDeath(player, world, head, cause = null) {
        const L = player && player.house && player.house.lineage;
        const rec = L && head && head.personId ? L.people[head.personId] : null;
        if (!rec) return;
        rec.alive = false;
        rec.cadetHead = false;
        if (rec.died == null) rec.died = _day(world);
        if (cause && !rec.cause) rec.cause = cause;
    },

    /**
     * The line after the main line's own: the living branches, nearest first
     * (fewest generations from the main line, then the oldest founding).
     */
    heirLine(player) {
        return this.list(player).slice().sort((a, b) => _num(a.depth, 1) - _num(b.depth, 1) || _num(a.founded) - _num(b.founded) || String(a.id).localeCompare(String(b.id)));
    },

    // ──────────── THE RETINUE ────────────

    retinueOf(world, b) {
        return ((world && world.units) || []).find(u => u && u.type === CADET_TYPE && !u.destroyed && u.cadetId === b.id) || null;
    },

    _spawnRetinue(world, b) {
        const at = b.seat;
        if (!at) return null;
        const unit = Object.assign(Object.create(WorldUnit.prototype), {
            type: CADET_TYPE, id: `cadet_${_hash(`${b.houseKey}:${_day(world)}:${_seed(world)}`).toString(36)}`,
            q: at.q, r: at.r, path: [], route: null, step: 0, destroyed: false, age: 0, maxAge: 1e9, speed: 0,
            inventory: {}, icon: this.config().icon, cadetId: b.id, houseKey: b.houseKey,
            name: `${this.headName(b)}'s Retinue`, houseName: b.name, kingdomId: b.kingdomId,
            strength: RivalHouses.strength(b), population: 10,
        });
        unit.sourceQ = unit.q; unit.sourceR = unit.r;
        if (!Array.isArray(world.units)) world.units = [];
        world.units.push(unit);
        return unit;
    },

    /** Is this a cadet branch's retinue? */
    isRetinue(u) {
        return !!u && u.type === CADET_TYPE && !u.destroyed;
    },

    branchOfUnit(player, unit) {
        return unit && unit.cadetId ? this.get(player, unit.cadetId) : null;
    },

    // ──────────── THE DAY ────────────

    /**
     * One day of the cadet branches: each lives its day (the week's money,
     * the road, the year's births and deaths), loyalty drifts, a loyal
     * branch helps, an estranged one works against you. Once a year a
     * grown child may leave to found one, and a branch may sprout another.
     * opts.interregnum: the House is held in trust (player is the estate):
     * the branches live on, but nobody asks or answers. → { notices }
     */
    processDay(player, world, opts = {}) {
        const out = { notices: [] };
        const C = this.config();
        if (!player || !player.house || !world || C.enabled === false || typeof world.getTile !== 'function') return out;
        const day = _day(world);
        const yearEnd = day > 0 && day % Seasons.DAYS_PER_YEAR === 0;
        const live = this.list(player);
        if (!live.length && !yearEnd && !this._anyCadetUnits(world, player)) return out;
        Utils.withRng(this._rng(world, 'day'), () => {
            for (const b of live) this._branchDay(player, world, b, out, opts);
            if (yearEnd && !opts.interregnum) this._leaveOnOwn(player, world, out);
            if (yearEnd) this._sprout(player, world, out);
        });
        this._levyDay(player, world, out);
        // A retinue whose branch is gone rides off the map
        const ids = new Set(this.list(player).map(b => b.id));
        for (const u of (world.units || [])) if (u && u.type === CADET_TYPE && !u.destroyed && !ids.has(u.cadetId)) u.destroyed = true;
        return out;
    },

    _anyCadetUnits(world, player) {
        return (world.units || []).some(u => u && u.type === CADET_TYPE && !u.destroyed)
            || ((player && player.army) || []).some(u => u && u.type === LEVY_TYPE);
    },

    _branchDay(player, world, b, out, opts) {
        const day = _day(world);
        if (b.lastDay === day) return;
        b.lastDay = day;
        RivalHouses._ensure(world, b);
        let unit = this.retinueOf(world, b);
        if (!unit) unit = this._spawnRetinue(world, b);
        if (!unit) return;
        const scratch = { notices: [] };
        if (day > 0 && day % 7 === 0) this._week(player, world, b, out, opts, scratch);
        unit.strength = RivalHouses.strength(b);
        if (unit.inventory && _num(unit.inventory.gold) > 0) {
            b.gold += Math.round(unit.inventory.gold);
            unit.inventory.gold = 0;
        }
        // The road: errands chosen and done by the rival-House AI, with no player to plot against.
        // A branch too poor to trade stays at its seat and saves its dues (court gifts would bleed it dry)
        if (!b.plan) this._plan(world, b, unit, scratch);
        if (b.plan && b.plan.kind !== 'waylay' && RivalHouses._advance(world, unit)) {
            if (b.plan.summons) this._attend(player, world, b, out, opts);
            else {
                RivalHouses._arrive(null, world, b, unit, scratch);
                this._whisper(player, world, b, out, opts);
            }
        }
        if (b.plan && b.plan.kind === 'waylay') b.plan = null;
        if (!b.plan) this._plan(world, b, unit, scratch);
        const here = RivalHouses._settlementAt(world, unit.q, unit.r);
        if (here && here.market) {
            RivalHouses._buyArms(world, b, here);
            unit.strength = RivalHouses.strength(b);
        }
        unit.name = `${this.headName(b)}'s Retinue`;
        if (day > 0 && day % Seasons.DAYS_PER_YEAR === 0) this._year(player, world, b, out, opts);
    },

    /** The next errand: the rival-House AI's pick, or home while the purse is below `poorBelow`. */
    _plan(world, b, unit, scratch) {
        if (_num(b.gold) < _num(this.config().poorBelow, 400) && b.seat) {
            b.plan = { kind: 'home', to: { ...b.seat }, since: _day(world) };
            RivalHouses._ride(world, unit, b.seat);
            return b.plan;
        }
        return RivalHouses._plan(null, world, b, unit, scratch);
    },

    /** The week's money, land, court, guards, ambition — then what loyalty moves it to do. */
    _week(player, world, b, out, opts, scratch) {
        const C = this.config();
        const seatT = b.seat ? world.getTile(b.seat.q, b.seat.r) : null;
        const seatTown = seatT && seatT.settlement && seatT.settlement.economy ? seatT.settlement : null;
        const dues = _num(C.income.weekly) + _num(C.income.perStewardship) * _num(b.head.stewardship);
        b.gold += seatTown ? Math.floor(Economy.drawTown(seatTown, dues)) : dues;
        const spent = Math.min(Math.max(0, b.gold), _num(C.upkeep.weekly) + Math.round(b.gold * _num(C.upkeep.share)));
        b.gold -= spent;
        if (seatTown && spent > 0) Economy.payTown(seatTown, spent);
        if (b.gold < 0) b.gold = 0;
        RivalHouses._landWeek(world, b);
        RivalHouses._courtWeek(world, b, [b]);
        RivalHouses._guardWeek(world, b, null, null);
        RivalHouses._wearArms(b);
        const before = _num(b.stats.ambitions);
        const aim = b.ambition && b.ambition.id;
        RivalHouses._ambitionWeek(null, world, b, scratch);
        if (_num(b.stats.ambitions) > before && !opts.interregnum) {
            const def = (aim && RivalHouses.config().ambitions[aim]) || null;
            out.notices.push({ icon: C.icon, title: 'A Cadet Line Rises', text: `${this.headName(b)} has achieved an ambition${def ? `: ${def.name}` : ''}. ${b.name} grows in renown.`, type: 'info' });
        }
        this._levyWages(player, world, b, seatTown);
        if (opts.interregnum) return;
        this._standing(player, world, b, out);
        this._tribute(player, world, b, out);
        this._warAid(player, world, b, out);
    },

    /** Estranged or reconciled; an estranged branch may press a claim. */
    _standing(player, world, b, out) {
        const L = this.config().loyalty;
        const house = player.house;
        if (!b.estranged && b.loyalty < _num(L.estrangedBelow, 20)) {
            b.estranged = true;
            const text = `${b.name} breaks with the main line: ${this.headName(b)} no longer answers to ${house.name}.`;
            House._chronicle(house, world, text, ['cadet', 'feud']);
            RivalHouses._note(b, world, 'Broke with the main line.', 'insulted');
            out.notices.push({ icon: '💢', title: 'A Branch Breaks Away', text: `${text} They will speak against you at court, and may contest your succession.`, type: 'warning' });
            this._treePerson(player, world, b, null);
        } else if (b.estranged && b.loyalty >= _num(L.reconcileAt, 35)) {
            b.estranged = false;
            const text = `${b.name} is reconciled with the main line.`;
            House._chronicle(house, world, text, ['cadet']);
            out.notices.push({ icon: '🤝', title: 'A Branch Reconciled', text, type: 'success' });
            this._treePerson(player, world, b, null);
        }
        b.feud = b.estranged ? _clamp(Math.round((50 - b.loyalty) * 2), 0, 100) : 0;
        if (b.estranged && b.feud >= _num(L.claimFeud, 50) && !house._pendingClaim && Utils.random() < _num(L.claimChance, 0.04)) {
            house._pendingClaim = true;
            const text = `${this.headName(b)} of ${b.name} lets it be known that the seat of ${house.name} should be theirs.`;
            House._chronicle(house, world, text, ['cadet', 'threat']);
            out.notices.push({ icon: '👑', title: 'A Claimant of Your Blood', text: `${text} Your next succession may be contested.`, type: 'warning' });
        }
    },

    /** A loyal branch with coin to spare sends the main line a share of it. */
    _tribute(player, world, b, out) {
        const T = this.config().tribute;
        const day = _day(world);
        if (b.estranged || b.loyalty < _num(T.loyalty, 70) || day - _num(b.lastTribute, -1e9) < _num(T.every, 120)) return;
        const spare = b.gold - _num(T.reserve, 700);
        if (!(spare > 0)) return;
        const amount = Math.floor(Math.min(spare, b.gold * _num(T.share, 0.06)));
        if (amount < _num(T.min, 30)) return;
        b.lastTribute = day;
        b.gold -= amount;
        Inheritance.setCoin(player, Inheritance.coin(player) + amount);
        Ledger.record(player, 'family', amount);
        b.stats.tribute = _num(b.stats.tribute) + amount;
        RivalHouses._note(b, world, `Sent ${amount} gold to the main line.`);
        out.notices.push({ icon: '💰', title: 'Tribute from Your Kin', text: `${this.headName(b)} of ${b.name} sends ${amount} gold to the head of the House.`, type: 'success' });
    },

    /** At war: a loyal branch sends men of its own accord (now and then). */
    _warAid(player, world, b, out) {
        const A = this.config().aid;
        const day = _day(world);
        if (b.estranged || b.loyalty < _num(A.loyalty, 60) || day - _num(b.lastAid, -1e9) < _num(A.every, 180)) return;
        if (!RealmWars.wars(player).length || this.levyOf(player, b)) return;
        if (b.gold < _num(A.minGold, 200)) return;
        const unit = this._sendLevy(player, world, b);
        if (unit) out.notices.push({ icon: '🛡️', title: 'Your Kin Ride to War', text: `${this.headName(b)} of ${b.name} sends ${unit.men} men under the branch's colours to your war, paid out of their own purse.`, type: 'success' });
    },

    /** The levy a branch has with the player's army, if any. */
    levyOf(player, b) {
        return ((player && player.army) || []).find(u => u && u.type === LEVY_TYPE && u.cadetId === b.id) || null;
    },

    _sendLevy(player, world, b) {
        const A = this.config().aid;
        const day = _day(world);
        if (!Array.isArray(player.army)) player.army = [];
        const men = _num(A.men, 6) + _num(b.guard);
        const unit = {
            type: LEVY_TYPE, name: `${b.name} Levy`, icon: '🛡️',
            strength: _num(A.base, 10) + _num(A.perMartial, 2) * _num(b.head.martial, 5) + _num(b.guard) * 2,
            upkeep: 0, experience: 20, level: 1, men, cadetId: b.id, until: day + _num(A.days, 90),
            backstory: `Men of ${b.name}, sent by ${this.headName(b)}; they serve until day ${day + _num(A.days, 90)}, paid by the branch.`,
        };
        player.army.push(unit);
        b.lastAid = day;
        b.stats.levies = _num(b.stats.levies) + 1;
        RivalHouses._note(b, world, `Sent ${men} men to the main line's war.`);
        return unit;
    },

    /** The week's pay for a branch's men in the field, out of its purse into its seat town; a branch that cannot pay calls them home. */
    _levyWages(player, world, b, seatTown) {
        const lv = this.levyOf(player, b);
        if (!lv) return;
        const pay = _num(this.config().aid.wage, 4) * _num(lv.men, 6);
        if (b.gold < pay) { lv.until = _day(world); return; }
        b.gold -= pay;
        if (seatTown) Economy.payTown(seatTown, pay);
    },

    /** Levies whose service is up (or whose branch is gone) go home. */
    _levyDay(player, world, out) {
        const army = player && Array.isArray(player.army) ? player.army : null;
        if (!army || !army.some(u => u && u.type === LEVY_TYPE)) return;
        const day = _day(world);
        const ids = new Set(this.list(player).map(b => b.id));
        const keep = [];
        for (const u of army) {
            if (u && u.type === LEVY_TYPE && (!ids.has(u.cadetId) || day >= _num(u.until))) {
                const b = this.get(player, u.cadetId);
                if (b) out.notices.push({ icon: '🛡️', title: 'Your Kin Go Home', text: `The men of ${b.name} have served their time and ride home.`, type: 'info' });
                continue;
            }
            keep.push(u);
        }
        player.army = keep;
    },

    /** An estranged branch at court speaks against you there (a little; never below indifference). */
    _whisper(player, world, b, out, opts) {
        const plan = b.plan;
        if (opts.interregnum || !b.estranged || !plan || plan.kind !== 'court' || plan.until == null || plan.whispered) return;
        plan.whispered = true;
        const rep = player.reputation || (player.reputation = {});
        const before = _num(rep[plan.kingdomId]);
        if (before <= 0) return;
        const cut = Math.min(before, _num(this.config().estranged.whisper, 3));
        rep[plan.kingdomId] = before - cut;
        out.notices.push({ icon: '🎭', title: 'Your Kin Against You', text: `${this.headName(b)} of the estranged ${b.name} is at court in ${plan.to.name} and speaks against you: −${cut} reputation with ${plan.realm}.`, type: 'warning' });
    },

    /** The head arrives at a summons: a few days at your side. */
    _attend(player, world, b, out, opts) {
        const plan = b.plan;
        const day = _day(world);
        const S = this.config().ask.summon;
        if (plan.until == null) {
            const [a, z] = _range(S.stay, [3, 6]);
            plan.until = day + Utils.randInt(a, z);
            if (!opts.interregnum && player.house) {
                b.loyalty = _clamp(b.loyalty + _num(S.loyalty, 4), 0, 100);
                House.award(player.house, _num(S.prestige, 2), 'kin attend the head of the House', day);
                RivalHouses._note(b, world, `Attended the head of the main line at ${plan.to.name}.`);
                out.notices.push({ icon: '🌿', title: 'Your Kin Attend You', text: `${this.headName(b)} of ${b.name} has come to ${plan.to.name} at your summons, and stays a few days.`, type: 'success' });
            }
        }
        if (day >= plan.until) b.plan = null;
    },

    // ──────────── THE YEAR ────────────

    _year(player, world, b, out, opts) {
        const C = this.config();
        const L = C.loyalty;
        const day = _day(world);
        const before = b.head;
        const scratch = { notices: [] };
        const freeBefore = new Set((b.head.children || []).filter(c => !c.wed).map(c => c.firstName));
        RivalHouses._yearOf(world, b, scratch, null);
        if (b.head !== before) this._newHead(player, world, b, before, out, opts);
        else this._treePerson(player, world, b, null);
        // Children who wed out this year: some into a rival House, easing its feud with you
        for (const c of (b.head.children || [])) {
            if (c.wed !== 'another House' || c.wedHouse || !freeBefore.has(c.firstName)) continue;
            if (Utils.random() >= _num(C.marriage.rivalChance, 0.35)) continue;
            const rival = RivalHouses.rivals(player).find(r => r && r.head && (r.head.children || []).some(x => !x.wed && x.age >= 16 && x.gender !== c.gender));
            if (!rival) continue;
            const rc = rival.head.children.find(x => !x.wed && x.age >= 16 && x.gender !== c.gender);
            c.wedHouse = rival.name;
            rc.wed = 'another House';
            rc.wedHouse = b.name;
            rival.feud = _clamp(_num(rival.feud) + _num(C.marriage.feud, -5), 0, 100);
            const text = `${c.firstName} of ${b.name} weds ${rc.firstName} of ${rival.name}.`;
            RivalHouses._note(b, world, text, 'wedding');
            if (!opts.interregnum) {
                House._chronicle(player.house, world, text, ['cadet', 'marriage']);
                out.notices.push({ icon: '💍', title: 'A Cadet Marriage', text: `${text} ${rival.name} thinks a little better of your blood.`, type: 'info' });
            }
        }
        if (opts.interregnum) return;
        // Loyalty's drift: the generations, neglect, the House's standing
        let d = _num(L.yearly, -1);
        if (day - _num(b.lastContact, day) >= _num(L.neglectDays, 360)) d -= _num(L.neglect, 4);
        if (_num(player.house.prestige) >= _num(L.prestigeAt, 100)) d += _num(L.prestigeBonus, 1);
        b.loyalty = _clamp(b.loyalty + d, 0, 100);
    },

    /** The branch head died and another took the branch: the tree, and the new head's own lean. */
    _newHead(player, world, b, old, out, opts) {
        const L = this.config().loyalty;
        this._treeDeath(player, world, old, 'old age');
        const wasChild = (old.children || []).some(c => c.firstName === b.head.firstName);
        b.head.personId = null;
        this._treePerson(player, world, b, wasChild ? old.personId : null);
        b.loyalty = _clamp(Math.round(50 + (b.loyalty - 50) * _num(L.newHead, 0.7) - _num(L.depth, 3) * _num(b.depth, 1)), 0, 100);
        b.feud = b.estranged ? b.feud : 0;
        if (opts.interregnum) return;
        const text = `${old.firstName} of ${b.name} dies at ${old.age}; ${this.headName(b)} now heads the branch.`;
        House._chronicle(player.house, world, text, ['cadet', 'death']);
        out.notices.push({ icon: '⚰️', title: 'A Cadet Head Dies', text: `${text} The new head is ${this.loyaltyLabel(b.loyalty).toLowerCase()} toward you (loyalty ${b.loyalty}).`, type: 'info' });
    },

    /** Once a year: a grown child with a portion of their own may leave to found a branch. */
    _leaveOnOwn(player, world, out) {
        const C = this.config();
        const Lv = C.leave;
        if (Lv.enabled === false || this.list(player).length >= _num(C.maxBranches, 6)) return null;
        const heir = (player.children || []).find(c => c && c.id === player.heir && c.isAlive !== false);
        if (!heir) return null;
        const roles = new Set(Object.values((player.house && player.house.roles) || {}).filter(Boolean));
        const kids = (player.children || []).filter(c => c && c.isAlive !== false && c.id !== player.heir && !roles.has(c.id)
            && _num(c.age) >= _num(Lv.minAge, 21) && _num(c.purse) >= _num(Lv.minPurse, 300) && !this.whyNot(player, world, c.id))
            .sort((a, b) => _num(b.age) - _num(a.age));
        for (const c of kids) {
            if (Utils.random() >= _num(Lv.chance, 0.12)) continue;
            const res = this.found(player, world, c.id, { why: 'own' });
            if (res.success) {
                out.notices.push({ icon: C.icon, title: 'A Branch of Their Own', text: res.text, type: 'info' });
                return res.branch;
            }
        }
        return null;
    },

    /** Once a year: a branch head's younger grown child may found a sub-branch. */
    _sprout(player, world, out) {
        const C = this.config();
        const S = C.sub;
        for (const b of this.list(player)) {
            if (this.list(player).length >= _num(C.maxBranches, 6)) return;
            if (_num(b.depth, 1) >= _num(C.maxDepth, 3) || b.gold < _num(S.minGold, 900)) continue;
            const kids = (b.head.children || []).slice().sort((x, y) => _num(y.age) - _num(x.age));
            const c = kids.slice(1).find(k => _num(k.age) >= _num(S.minAge, 22));
            if (!c || Utils.random() >= _num(S.chance, 0.1)) continue;
            const seat = this._pickSeat(player, world, b.kingdomId);
            if (!seat) continue;
            const house = player.house;
            house.cadetSeq = _num(house.cadetSeq) + 1;
            const id = `cb${house.cadetSeq}`;
            const head = RivalHouses._makeHead(world, b, c.age, c.gender);
            head.firstName = c.firstName;
            head.children = [];
            head.spouse = c.wed ? RivalHouses._person(world, b, c.age, c.gender === 'female' ? 'male' : 'female') : null;
            const sub = this._record(player, world, {
                id, head, seat, kingdomId: seat.kingdomId != null ? seat.kingdomId : b.kingdomId, loyalty: b.loyalty - _num(S.loyaltyDrop, 8),
                parentId: b.id, depth: _num(b.depth, 1) + 1, founder: c.firstName, why: 'sub',
            });
            const share = Math.floor(b.gold * _num(S.share, 0.25));
            b.gold -= share;
            sub.gold = share;
            sub.stats.seeded = share;
            b.head.children = b.head.children.filter(k => k !== c);
            this._treePerson(player, world, sub, b.head.personId);
            const text = `${c.firstName}, of ${b.name}, founds ${sub.name} at ${seat.name}: a branch of a branch.`;
            RivalHouses._note(b, world, text);
            House._chronicle(house, world, text, ['cadet', 'founding']);
            out.notices.push({ icon: C.icon, title: 'A New Cadet Line', text, type: 'info' });
        }
    },

    // ──────────── THE PLAYER'S HAND ────────────

    _asked(b, kind, world) {
        const ask = this.config().ask[kind] || {};
        const last = _num(b.asked && b.asked[kind], -1e9);
        const left = _num(ask.cooldown) - (_day(world) - last);
        return left > 0 ? left : 0;
    },

    _contact(b, world) {
        b.lastContact = _day(world);
    },

    /** Send a gift of gold. → { success, text, loyalty } */
    gift(player, world, id, amount) {
        const b = this.get(player, id);
        const G = this.config().gift;
        const n = Math.floor(_num(amount));
        if (!b) return { success: false, reason: 'No such branch.' };
        if (!(n > 0)) return { success: false, reason: 'A gift of nothing.' };
        if (Inheritance.coin(player) < n) return { success: false, reason: `You do not have ${n} gold.` };
        const day = _day(world);
        Inheritance.setCoin(player, Inheritance.coin(player) - n);
        Ledger.record(player, 'family', -n);
        b.gold += n;
        let gain = Math.min(_num(G.maxLoyalty, 15), n / Math.max(1, _num(G.perLoyalty, 25)));
        if (day - _num(b.lastGiftDay, -1e9) < _num(G.recentDays, 60)) gain *= _num(G.recentFactor, 0.5);
        gain = Math.max(1, Math.round(gain));
        b.loyalty = _clamp(b.loyalty + gain, 0, 100);
        b.lastGiftDay = day;
        b.stats.gifts = _num(b.stats.gifts) + n;
        this._contact(b, world);
        RivalHouses._note(b, world, `Received a gift of ${n} gold from the main line.`, 'gift');
        return { success: true, loyalty: b.loyalty, gain, text: `${this.headName(b)} receives your ${n} gold gratefully (loyalty +${gain}, now ${b.loyalty}).` };
    },

    /** Ask the branch for gold. → { success, amount, text } | { success: false, reason } */
    askGold(player, world, id) {
        const b = this.get(player, id);
        const A = this.config().ask.gold;
        if (!b) return { success: false, reason: 'No such branch.' };
        const wait = this._asked(b, 'gold', world);
        if (wait) return { success: false, reason: `You asked them for gold lately; ask again in ${wait} days.` };
        b.asked.gold = _day(world);
        this._contact(b, world);
        if (b.estranged || b.loyalty < _num(A.needLoyalty, 40)) {
            b.loyalty = _clamp(b.loyalty + _num(A.refuse, -3), 0, 100);
            return { success: false, refused: true, reason: `${this.headName(b)} sends back a cold letter: ${b.name} has nothing to spare for the main line.` };
        }
        const amount = Math.floor(Math.min(b.gold, Math.max(_num(A.min, 50), b.gold * _num(A.share, 0.2))));
        if (amount < _num(A.min, 50)) return { success: false, reason: `${b.name} is too poor to send anything.` };
        b.gold -= amount;
        Inheritance.setCoin(player, Inheritance.coin(player) + amount);
        Ledger.record(player, 'family', amount);
        b.loyalty = _clamp(b.loyalty - _num(A.loyaltyCost, 8), 0, 100);
        b.stats.asked = _num(b.stats.asked) + amount;
        RivalHouses._note(b, world, `Sent ${amount} gold at the main line's asking.`);
        return { success: true, amount, text: `${this.headName(b)} sends ${amount} gold (loyalty now ${b.loyalty}).` };
    },

    /** Ask the branch for men for a war. */
    askMen(player, world, id) {
        const b = this.get(player, id);
        const A = this.config().ask.men;
        if (!b) return { success: false, reason: 'No such branch.' };
        if (this.levyOf(player, b)) return { success: false, reason: `${b.name}'s men already serve with you.` };
        const wait = this._asked(b, 'men', world);
        if (wait) return { success: false, reason: `You asked them for men lately; ask again in ${wait} days.` };
        if (b.gold < _num(this.config().aid.minGold, 200)) return { success: false, reason: `${b.name} cannot afford to keep men in the field.` };
        b.asked.men = _day(world);
        this._contact(b, world);
        if (b.estranged || b.loyalty < _num(A.needLoyalty, 50)) {
            b.loyalty = _clamp(b.loyalty + _num(A.refuse, -3), 0, 100);
            return { success: false, refused: true, reason: `${this.headName(b)} will not send their men to fight your battles.` };
        }
        const unit = this._sendLevy(player, world, b);
        b.loyalty = _clamp(b.loyalty - _num(A.loyaltyCost, 6), 0, 100);
        return { success: true, unit, text: `${this.headName(b)} sends ${unit.men} men (strength ${unit.strength}) to serve with you for ${this.config().aid.days} days, at the branch's cost.` };
    },

    /** Summon the branch head to your side: they ride to the town nearest you. */
    summon(player, world, id) {
        const b = this.get(player, id);
        const A = this.config().ask.summon;
        if (!b) return { success: false, reason: 'No such branch.' };
        const wait = this._asked(b, 'summon', world);
        if (wait) return { success: false, reason: `You summoned them lately; again in ${wait} days.` };
        b.asked.summon = _day(world);
        this._contact(b, world);
        if (b.estranged || b.loyalty < _num(A.needLoyalty, 35)) {
            b.loyalty = _clamp(b.loyalty + _num(A.refuse, -3), 0, 100);
            return { success: false, refused: true, reason: `${this.headName(b)} sends their regrets: they are not at your beck and call.` };
        }
        const town = RivalHouses._nearestTown(world, player);
        let unit = this.retinueOf(world, b);
        if (!unit) unit = this._spawnRetinue(world, b);
        if (!town || !unit) return { success: false, reason: 'They cannot find their way to you.' };
        if (b.plan && b.plan.kind === 'trade' && b.plan.stage === 'selling') {
            // They sell what they carry where they are on the way (the load is not lost)
            const s = RivalHouses._settlementAt(world, unit.q, unit.r);
            if (s) RivalHouses._arrive(null, world, b, unit, { notices: [] });
        }
        b.plan = { kind: 'home', summons: true, to: { q: town.q, r: town.r, name: town.name }, since: _day(world) };
        RivalHouses._ride(world, unit, town);
        return { success: true, text: `${this.headName(b)} answers your summons and rides for ${town.name}.` };
    },

    /** The player fell on a branch's retinue. → a line for the battle log. */
    onAttacked(player, world, unit, won) {
        const b = this.branchOfUnit(player, unit);
        if (!b) return null;
        const L = this.config().loyalty;
        b.loyalty = _clamp(b.loyalty + _num(L.attacked, -40), 0, 100);
        b.lastAttackedDay = _day(world);
        if (won) RivalHouses._loseArms(b, 0.3);
        player.karma = _num(player.karma) - 5;
        const text = `${player.name || 'The head of the House'} fell upon the retinue of ${this.headName(b)}, of the House's own blood.`;
        if (player.house) House._chronicle(player.house, world, text, ['cadet', 'feud']);
        RivalHouses._note(b, world, 'Attacked by the main line on the road.', 'attacked');
        return text;
    },

    // ──────────── SUCCESSION ────────────

    /** The branch's rents still in its holder purse go to its purse. */
    _sweepLand(world, b) {
        const h = world && world.estates ? Estates.holder(world, b.landKey) : null;
        if (h && _num(h.purse) > 0) {
            b.gold += h.purse;
            h.purse = 0;
        }
    },

    /** The branch head as a child of the House, ready to take up the mantle. */
    _heirChild(player, world, b) {
        const h = b.head;
        const day = _day(world);
        const Y = Seasons.DAYS_PER_YEAR;
        const id = h.personId || `${b.id}_h${_num(b.stats && b.stats.heads, 1)}`;
        h.personId = id;
        let child;
        if (h.snapshot && h.snapshot.id === id) {
            child = JSON.parse(JSON.stringify(h.snapshot));
        } else {
            const s = v => _clamp(Math.round(3 + _num(v, 5) / 2), 1, 12);
            child = {
                id, firstName: h.firstName, gender: h.gender, culture: player.culture || 'Imperial', traits: [],
                strength: s(h.martial), charisma: s(h.diplomacy), intelligence: s(h.stewardship), faith: 5, luck: 5,
                skills: { commerce: _num(h.stewardship), combat: _num(h.martial), leadership: Math.round((_num(h.martial) + _num(h.diplomacy)) / 2), diplomacy: _num(h.diplomacy), stealth: _num(h.intrigue), cartography: 0 },
                health: 100, maxHealth: 100,
            };
        }
        Object.assign(child, {
            id, age: _num(h.age, 30), isAlive: true, isSibling: true, purse: 0, dynasty: this._dynasty(player),
            birthDay: day - Math.round(_num(h.age, 30) * Y), cadetOf: b.id,
        });
        const up = Upbringing.ensure(child);
        up.comeOfAge = true;
        // The head's spouse comes with them to the seat (Relationships._seatHeirSpouse), wed today so
        // no children are invented for the marriage: the head's own are brought in below
        up.spouse = h.spouse ? { kind: 'alliance', name: `${h.spouse.firstName}`, kingdomId: b.kingdomId, day } : null;
        return child;
    },

    /**
     * The main line has no heir: the branch's head takes up the mantle. The
     * branch's purse and estates come with them; their children become the new
     * ruler's own; the branch folds back into the main line.
     * opts as Relationships.succeedAsHeir (secure, cause). → its result + { cadet }.
     */
    succeed(player, world, id, opts = {}) {
        const b = this.get(player, id);
        if (!b) return { success: false, reason: 'No such branch.' };
        const day = _day(world);
        this._sweepLand(world, b);
        const child = this._heirChild(player, world, b);
        child.purse = Math.round(_num(b.gold) * 100) / 100;
        const brought = child.purse;
        b.gold = 0;
        if (!Array.isArray(player.children)) player.children = [];
        player.children.push(child);
        const res = Relationships.succeedAsHeir(player, child.id, world, opts);
        if (!res || !res.success) {
            player.children = player.children.filter(c => c !== child);
            b.gold = brought;
            return res || { success: false, reason: 'The succession failed.' };
        }
        // The branch's land is the House's now
        const held = world.estates && Estates.enabled() ? Estates.heldBy(world, b.landKey).slice() : [];
        for (const e of held) LandMarket._setHolder(world, e, 'player', day);
        // The head's children are the new ruler's own
        const Y = Seasons.DAYS_PER_YEAR;
        const kids = [];
        for (const c of (b.head.children || [])) {
            const kid = {
                id: `child_${Relationships._nextId++}`, firstName: c.firstName, dynasty: this._dynasty(player), gender: c.gender || 'male',
                age: _num(c.age), culture: player.culture || 'Imperial', birthDay: day - Math.round(_num(c.age) * Y), isAlive: true, traits: [],
                strength: 5, charisma: 5, intelligence: 5, faith: 5, luck: 5,
                skills: { commerce: 0, combat: 0, leadership: 0, diplomacy: 0, stealth: 0, cartography: 0 }, health: 100, maxHealth: 100,
            };
            const up = Upbringing.ensure(kid);
            if (kid.age >= Relationships._getHeirSettings().minAgeToPlay) up.comeOfAge = true;
            if (c.wed) kid.wedOut = c.wedHouse || 'another House';
            player.children.push(kid);
            kids.push(kid);
        }
        if (!player.heir && kids.length) player.heir = kids.slice().sort((x, y) => y.age - x.age)[0].id;
        player.title = `Head of ${player.house.name}`;
        const unit = this.retinueOf(world, b);
        if (unit) unit.destroyed = true;
        for (const o of this.list(player)) if (o.parentId === b.id) o.parentId = null;
        b.ended = true;
        player.house.cadets = player.house.cadets.filter(x => x !== b);
        const L = player.house.lineage;
        const rec = L && L.people[child.id];
        if (rec) { rec.cadet = null; rec.cadetHead = false; rec.branch = null; }
        if (kids.length) DynastyTree.sync(player, world, { npc: n => Relationships.getNPC(n) });
        const text = `The main line of ${player.house.name} has no heir: ${player.name}, of ${b.name}, takes up the mantle, bringing ${held.length ? `${held.length} estate${held.length > 1 ? 's' : ''} and ` : ''}the branch's purse home.`;
        House._chronicle(player.house, world, text, ['cadet', 'succession']);
        res.cadet = { name: b.name, estates: held.length, gold: brought, children: kids.length, text };
        return res;
    },

    /**
     * The House ends with branches still out in the world (a new life taken):
     * each branch goes on as minor nobility outside your House — its purse to
     * its seat town, its estates to a noble holder of its realm.
     */
    dissolve(player, world) {
        const list = this.list(player);
        if (!list.length) return 0;
        const day = _day(world);
        for (const b of list) {
            this._sweepLand(world, b);
            const t = b.seat && world && typeof world.getTile === 'function' ? world.getTile(b.seat.q, b.seat.r) : null;
            if (t && t.settlement && b.gold > 0) Economy.payTown(t.settlement, b.gold);
            b.gold = 0;
            const held = world && world.estates && Estates.enabled() ? Estates.heldBy(world, b.landKey).slice() : [];
            for (const e of held) LandMarket._setHolder(world, e, `noble:${b.kingdomId != null ? b.kingdomId : 'free'}:cadet_${b.id}`, day);
            const unit = this.retinueOf(world, b);
            if (unit) unit.destroyed = true;
            b.ended = true;
        }
        for (const u of (player.army || [])) if (u && u.type === LEVY_TYPE) u.until = day;
        if (Array.isArray(player.army)) player.army = player.army.filter(u => !(u && u.type === LEVY_TYPE));
        return list.length;
    },

    // ──────────── THE VIEW ────────────

    view(player, world, b) {
        const day = _day(world);
        const parent = b.parentId ? this.get(player, b.parentId) : null;
        const estates = RivalHouses.estates(world, b);
        const ask = this.config().ask;
        return {
            id: b.id, name: b.name, head: this.headName(b), age: b.head.age, gender: b.head.gender,
            seat: b.seat ? b.seat.name : null, founded: b.founded, founder: b.founder, why: b.why, depth: _num(b.depth, 1),
            parent: parent ? parent.name : null, loyalty: Math.round(b.loyalty), label: this.loyaltyLabel(b.loyalty), estranged: !!b.estranged,
            gold: Math.round(_num(b.gold)), wealth: RivalHouses.wealthLabel(_num(b.gold) + RivalHouses.landValue(world, b)),
            estates: estates.map(e => e.name), doing: RivalHouses.doing(world, b), where: (() => {
                const u = this.retinueOf(world, b);
                const town = u ? RivalHouses._nearestTown(world, u) : null;
                return town ? town.name : null;
            })(),
            spouse: b.head.spouse ? b.head.spouse.firstName : null,
            children: (b.head.children || []).map(c => ({ name: c.firstName, age: c.age, wed: c.wed ? (c.wedHouse || 'wed') : null })),
            traits: (b.head.traits || []).map(t => RivalHouses.config().traits[t]).filter(Boolean),
            heads: _num(b.stats && b.stats.heads, 1), tribute: Math.round(_num(b.stats && b.stats.tribute)), gifts: Math.round(_num(b.stats && b.stats.gifts)),
            levy: !!this.levyOf(player, b), quiet: day - _num(b.lastContact, day),
            waits: { gold: this._asked(b, 'gold', world), men: this._asked(b, 'men', world), summon: this._asked(b, 'summon', world) },
            needs: { gold: ask.gold.needLoyalty, men: ask.men.needLoyalty, summon: ask.summon.needLoyalty },
            log: (b.log || []).slice(-4).reverse(),
        };
    },
};
