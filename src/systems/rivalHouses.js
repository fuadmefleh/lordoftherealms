// ============================================
// RIVAL HOUSES — the rival Houses' heads, in the flesh
// ============================================
// A rival House (house.rivals, systems/house.js) was a grudge and a name: a
// feud score that hatched plots (systems/schemes.js) and bought agents
// (systems/rivalAgents.js). This layer gives each one a HEAD — a named lord
// of that dynasty with an age, a temper, a purse, a seat, a spouse and
// children — and a RETINUE on the map ('rival_retinue', saved with
// world.units) that rides the roads the way the player does:
//
//   Trade     buys a good where it is cheap and carries it where it is dear,
//             through the same town markets the player trades in
//             (world/settlementMarket.js): the stock it takes raises the
//             price where it buys, the load it sells lowers it where it
//             sells. A rival can beat the player to a bargain.
//   Court     rides to a capital (its own realm's, or the one that thinks
//             best of the player) and stays some days, gaining favour there;
//             a rival with a hot feud speaks against the player while it is
//             there (a little reputation lost with that realm).
//   Shadow    a bitter rival rides to the town nearest the player and, once
//             there, pays for a plot (Schemes.hatch) out of its own purse.
//   Invest    rides to a town where an estate is on the land market
//             (systems/landMarket.js) and buys it — the same listings the
//             player buys from. Its rents fill the purse (holder
//             `rival:<kingdomId>`); a House gone poor puts its cheapest
//             estate up for sale.
//   Home      rests at its seat when the purse runs thin or the road has
//             been long.
//
// The head weighs each errand by what it is worth to them now (`_scores`):
// the best bargain in reach, the best estate's yield, the court where they
// stand best, the heat of the feud — bent by their temper and their
// AMBITION (wealth, land, a crown's favour, or humbling the player's
// House). A fulfilled ambition earns the House renown (more favour won at
// court, a stronger retinue) and a new one is set.
//
// Standing at a court is read: past `standing.favourite` a crown pays its
// favourite a pension from the treasury, and a rival's word there weighs
// more against the player. A retinue the player has fallen on hires guards
// (a stronger retinue, wages each week) and lets them go once it forgets.
//
// The purse is real: an estate income each week, the retinue's upkeep, the
// gains and losses of its trading, gifts at court, and every plot a rival
// hatches (here or in Schemes._plot) costs it `plotCost` — a poor House
// plots less. The head ages on the year's last day, marries, has children
// and dies; the eldest grown child (or a cousin) takes the House, and the
// feud passes on, cooled (`life.inherit`).
//
// The player meets a retinue within a hex (wildernessActions
// 'meet_rival_house' → ActionMenu.showRivalHead): parley, send a gift,
// insult the lord to his face, or — when both Houses have a grown child
// unwed — propose a match that ends most of the feud (Heirs.marryForAlliance
// into the rival's realm).
//
// The day draws from its own seeded stream (world seed + day, Utils.withRng)
// so no other system's dice move. State on house.rivals[k] (saved with the
// player); the retinues ride in world.units. Content in
// data/rivalHouses.json. No import-time effects.

import { Languages } from './languages.js';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { WorldUnit } from '../world/units.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Seasons } from '../world/seasons.js';
import { House } from './house.js';
import { Schemes } from './schemes.js';
import { Heirs } from './heirs.js';
import { MerchantCaravans } from './merchantCaravans.js';
import { Estates } from '../world/estates.js';
import { LandMarket } from './landMarket.js';
import { Duels } from './duels.js';
import { Ledger } from './ledger.js';
import { Arms } from './arms.js';
import { Economy } from '../world/economy.js';
import { PlayerInventory } from '../core/inventory.js';

export const RIVAL_TYPE = 'rival_retinue';
const ERRANDS = ['trade', 'court', 'shadow', 'invest', 'waylay', 'home'];
const AMBITIONS = ['wealth', 'land', 'favour', 'revenge'];

/** The head's mood today, from what has just happened to them (newest first wins by rank). parley: added to the parley chance. */
const MOODS = {
    bereaved: { rank: 9, days: 30, icon: '🖤', label: 'In mourning', parley: 0.05 },
    attacked: { rank: 8, days: 20, icon: '😡', label: 'Furious', parley: -0.15 },
    insulted: { rank: 7, days: 10, icon: '😤', label: 'Smarting', parley: -0.1 },
    shamed: { rank: 7, days: 20, icon: '😠', label: 'Humiliated', parley: -0.1 },
    ousted: { rank: 6, days: 20, icon: '😒', label: 'Sour', parley: -0.05 },
    poor: { rank: 6, days: 20, icon: '😟', label: 'Worried', parley: 0.05 },
    loss: { rank: 5, days: 8, icon: '😒', label: 'Out of sorts', parley: -0.03 },
    gloat: { rank: 5, days: 20, icon: '😏', label: 'Smug', parley: 0.05 },
    triumph: { rank: 4, days: 20, icon: '😄', label: 'Triumphant', parley: 0.08 },
    favour: { rank: 4, days: 20, icon: '😌', label: 'Basking', parley: 0.05 },
    wedding: { rank: 4, days: 20, icon: '🥂', label: 'Merry', parley: 0.1 },
    birth: { rank: 4, days: 20, icon: '🍼', label: 'Doting', parley: 0.1 },
    land: { rank: 3, days: 12, icon: '🙂', label: 'Pleased', parley: 0.04 },
    profit: { rank: 2, days: 8, icon: '🙂', label: 'Pleased', parley: 0.03 },
    calm: { rank: 0, days: 0, icon: '😐', label: 'Even-tempered', parley: 0 },
};

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _day = world => (world && Number.isFinite(world.day) ? world.day : 0);
const _round2 = v => Math.round(v * 100) / 100;

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

function _range(v, d) {
    return Array.isArray(v) && v.length === 2 ? v : d;
}

function _goodDef(id) {
    const gd = DataLoader._gamedata;
    const G = gd && gd.playerEconomy && gd.playerEconomy.GOODS;
    const g = G && G[String(id).toUpperCase()];
    return g || { id, name: String(id).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), icon: '📦', basePrice: 10 };
}

const DEFAULTS = {
    enabled: true,
    icon: '🏰',
    speed: 3,
    startGold: [800, 3000],
    startAge: [26, 50],
    estate: { weekly: 30, perStewardship: 8 },
    upkeep: { weekly: 25, share: 0.01 },
    plotCost: 150,
    weights: { trade: 3, court: 2, shadow: 2, home: 1, invest: 2, waylay: 2 },
    think: { tradeNorm: 100, tradeCap: 2.5, investCap: 3, courtCap: 3, ambition: 1.6 },
    trade: { sources: 6, destinations: 10, range: 18, minMargin: 0.25, maxQty: 60, minQty: 8, spend: 0.5, minGold: 300 },
    court: { stay: [4, 9], favour: 3, whisper: 2, whisperFeud: 40, gift: 60 },
    home: { stay: [6, 14], restAfter: 150, poorBelow: 200 },
    shadow: { feud: 60, stay: [3, 6], plotEvery: 90 },
    invest: { range: 24, reserve: 400, maxShare: 0.7, minYield: 0.03, maxEstates: 6, sellBelow: 150, sellAt: 0.95 },
    standing: { decayDays: 30, decay: 1, max: 60, pension: 0.6, favourite: 25, whisperPer: 10, renownPer: 20 },
    guard: { cost: 60, wage: 6, step: 2, max: 8, per: 8, forgetDays: 240 },
    waylay: { feud: 80, edge: 1.2, every: 150, days: 20, range: 30, robFeud: -15, beatenFeud: 10, beatenGuards: 0.5 },
    memory: {
        halfLife: 240, keep: 14,
        kinds: {
            gift: 6, parleyOk: 4, parleyFail: -3, insult: -10, attacked: -20, repelled: -4, ambushBeaten: -8, robbedYou: 3,
            match: 25, flattered: 3, flatterFail: -2, threatened: -6, declined: -2, helped: 15, spokeForThem: 10, loanGiven: 8,
            loanDemanded: -4, bloodPrice: 10, duelYouWon: 4, duelYouLost: 2, truceBroken: -5, estateSold: 6,
        },
    },
    deals: { loanDays: 60, loanRate: 0.2, graceDays: 30, truceDays: 120, breakChance: 0.01, breakHonour: 3, breakFeud: 60, payHonour: 4, againstDays: 90, againstFeud: -30, matchDowry: 0 },
    ties: { start: [-20, 20], allyAt: 50, enemyAt: -50, spill: 0.5, oust: -15, matchMin: 20, matchChance: 0.3, match: 40, drift: 3, war: -1, allied: 0.5, commonFoe: 0.5, commonFoeFeud: 60 },
    ambitions: {
        renown: 10, giveUpDays: 720,
        wealth: { name: 'Fill the Coffers', icon: '💰', errand: 'trade', grow: 1.8, min: 4000 },
        land: { name: 'Gather Land', icon: '🌾', errand: 'invest', more: 2 },
        favour: { name: 'Win a Crown\'s Ear', icon: '👑', errand: 'court' },
        revenge: { name: 'Humble Your House', icon: '🗡️', errand: 'shadow', plots: 2, feud: 50 },
    },
    life: {
        deathFrom: 55, deathPerYear: 0.03, maxAge: 88, marryFrom: 18, marryChance: 0.35,
        childChance: 0.3, maxChildren: 5, fertileUntil: 45, comeOfAge: 16, childWedChance: 0.25, inherit: 0.7,
    },
    meet: {
        range: 1,
        parley: { base: 0.3, perCharisma: 0.04, perFeud: -0.004, proud: -0.1, feud: -8, failFeud: 3 },
        gift: { base: 50, perFeud: 5, feud: -15 },
        insult: { feud: 10, proudFeud: 15, renown: 3 },
        match: { maxFeud: 70, dowry: 300, feud: -40, prestige: 10 },
    },
    noticeRange: 8,
    attack: { lootShare: 0.2, feud: 30, failFeud: 10, reputation: 10, karma: 3, slayChance: 0.1, slainFeud: 30 },
    traits: {
        grasping: { name: 'Grasping', icon: '💰', weights: { trade: 4 }, ambitions: { wealth: 3 } },
        courtly: { name: 'Courtly', icon: '🎭', weights: { court: 4 }, ambitions: { favour: 3 } },
        scheming: { name: 'Scheming', icon: '🗡️', weights: { shadow: 4, waylay: 1 }, ambitions: { revenge: 3 } },
        proud: { name: 'Proud', icon: '🦚', weights: { waylay: 3 }, ambitions: { favour: 1, revenge: 1 } },
        homebody: { name: 'Homebound', icon: '🏡', weights: { home: 3, invest: 2 }, ambitions: { land: 3 } },
    },
    wealth: [[20000, 'very rich'], [6000, 'rich'], [2000, 'comfortable'], [500, 'getting by'], [0, 'strained']],
};

export const RivalHouses = {
    RIVAL_TYPE,

    // ──────────── DATA ────────────

    config() {
        const g = DataLoader._gamedata;
        const d = (g && g.rivalHouses) || {};
        const out = { ...DEFAULTS, ...d };
        for (const k of ['estate', 'upkeep', 'weights', 'think', 'trade', 'court', 'home', 'shadow', 'invest', 'standing', 'guard', 'waylay', 'ties', 'deals', 'life', 'traits', 'attack']) {
            out[k] = { ...DEFAULTS[k], ...(d[k] || {}) };
        }
        out.memory = { ...DEFAULTS.memory, ...(d.memory || {}) };
        out.memory.kinds = { ...DEFAULTS.memory.kinds, ...((d.memory && d.memory.kinds) || {}) };
        const a = d.ambitions || {};
        out.ambitions = { ...DEFAULTS.ambitions, ...a };
        for (const k of AMBITIONS) out.ambitions[k] = { ...DEFAULTS.ambitions[k], ...(a[k] || {}) };
        const m = d.meet || {};
        out.meet = { ...DEFAULTS.meet, ...m };
        for (const k of ['parley', 'gift', 'insult', 'match']) out.meet[k] = { ...DEFAULTS.meet[k], ...(m[k] || {}) };
        return out;
    },

    // ──────────── STATE ────────────

    /** The House's rival records: [{ kingdomId, name, feud, head?, gold?, ... }]. */
    rivals(player) {
        const house = player && player.house;
        return Object.values((house && house.rivals) || {}).filter(Boolean);
    },

    rival(player, kingdomId) {
        const house = player && player.house;
        return (house && house.rivals && house.rivals[kingdomId]) || null;
    },

    isRetinue(u) {
        return !!u && u.type === RIVAL_TYPE && !u.destroyed;
    },

    retinues(world) {
        return ((world && world.units) || []).filter(u => this.isRetinue(u));
    },

    retinueOf(world, rival) {
        if (!rival) return null;
        return this.retinues(world).find(u => u.rivalId === rival.kingdomId && u.houseKey === rival.houseKey) || null;
    },

    /** The surname of a rival House ("House Varr" → "Varr"). */
    surname(rival) {
        const n = String((rival && rival.name) || '');
        return n.startsWith('House ') ? n.slice(6) : n;
    },

    /** "Lord Aldric Varr". */
    headName(rival) {
        const h = rival && rival.head;
        if (!h) return rival ? rival.name : '';
        return `${h.gender === 'female' ? 'Lady' : 'Lord'} ${h.firstName} ${this.surname(rival)}`;
    },

    wealthLabel(gold) {
        for (const [min, label] of this.config().wealth) if (_num(gold) >= min) return label;
        return 'strained';
    },

    // ──────────── PEOPLE ────────────

    _culture(world, rival) {
        const k = world && world.getKingdom ? world.getKingdom(rival.kingdomId) : null;
        return (k && k.culture) || 'Imperial';
    },

    _firstName(world, rival, gender) {
        const gd = DataLoader._gamedata;
        const pools = gd && gd.characters && gd.characters.firstNames;
        const pool = pools && (pools[this._culture(world, rival)] || pools.Imperial);
        const list = pool && pool[gender];
        if (Array.isArray(list) && list.length) return Utils.randPick(list);
        return gender === 'female' ? 'Helena' : 'Edmund';
    },

    _person(world, rival, age, gender = null, taken = null) {
        const g = gender || (Utils.random() < 0.5 ? 'female' : 'male');
        let firstName = this._firstName(world, rival, g);
        // No two children of one head share a name (a few draws, then let it be)
        for (let i = 0; taken && i < 6 && taken.includes(firstName); i++) firstName = this._firstName(world, rival, g);
        return { firstName, gender: g, age };
    },

    _names(head) {
        return [head.firstName, ...(head.children || []).map(c => c.firstName)];
    },

    _skill() {
        return Utils.randInt(2, 9);
    },

    /** A new head for the House: a lord of the dynasty in middle life, with a family to match. */
    _makeHead(world, rival, age = null, gender = null) {
        const C = this.config();
        const [a0, a1] = _range(C.startAge, [26, 50]);
        const head = this._person(world, rival, age == null ? Utils.randInt(a0, a1) : age, gender || (Utils.random() < 0.8 ? 'male' : 'female'));
        head.diplomacy = this._skill();
        head.stewardship = this._skill();
        head.intrigue = this._skill();
        head.martial = this._skill();
        const ids = Object.keys(C.traits);
        head.traits = [];
        while (head.traits.length < 2 && ids.length) {
            const t = ids.splice(Utils.randInt(0, ids.length - 1), 1)[0];
            head.traits.push(t);
        }
        head.spouse = null;
        head.children = [];
        if (head.age >= C.life.marryFrom + 4 && Utils.random() < 0.75) {
            head.spouse = this._person(world, rival, Math.max(C.life.marryFrom, head.age + Utils.randInt(-6, 3)), head.gender === 'female' ? 'male' : 'female');
            const years = Math.max(0, Math.min(head.age, C.life.fertileUntil) - C.life.marryFrom - 2);
            for (let y = years; y >= 0 && head.children.length < C.life.maxChildren; y--) {
                if (Utils.random() < C.life.childChance) head.children.push(this._person(world, rival, y, null, this._names(head)));
            }
        }
        return head;
    },

    has(head, trait) {
        return !!head && Array.isArray(head.traits) && head.traits.includes(trait);
    },

    /** Give a rival record its head, purse and seat (once). */
    _ensure(world, rival) {
        if (rival.head && rival.seat && rival.houseKey && rival.ambition && rival.head.persona && rival.memory) return rival;
        const C = this.config();
        if (!rival.houseKey) rival.houseKey = `${rival.kingdomId}:${_day(world)}`;
        if (!rival.head) rival.head = this._makeHead(world, rival);
        if (!Number.isFinite(rival.gold)) {
            const [g0, g1] = _range(C.startGold, [800, 3000]);
            rival.gold = Utils.randInt(g0, g1);
        }
        if (!rival.seat) rival.seat = this._pickSeat(world, rival);
        if (!rival.stats) rival.stats = { trades: 0, tradeProfit: 0, courtVisits: 0, plotsPaid: 0, heads: 1 };
        for (const k of ['estatesBought', 'estatesSold', 'rents', 'pensions', 'ambitions']) if (!Number.isFinite(rival.stats[k])) rival.stats[k] = 0;
        if (!rival.standing) rival.standing = {};
        if (!Number.isFinite(rival.renown)) rival.renown = 0;
        if (!Number.isFinite(rival.guard)) rival.guard = 0;
        if (!rival.log) rival.log = [];
        if (!rival.ambition) this._setAmbition(null, world, rival);
        if (!Number.isFinite(rival.head.martial)) rival.head.martial = 2 + (_hash(`${rival.houseKey}:${rival.head.firstName}:martial`) % 8);
        if (!rival.head.persona) rival.head.persona = this._persona(rival, rival.head);
        if (!Array.isArray(rival.memory)) rival.memory = [];
        if (!Array.isArray(rival.events)) rival.events = [];
        if (!Array.isArray(rival.loans)) rival.loans = [];
        return rival;
    },

    /**
     * The retinue's fighting strength: the head's cunning, hired guards, the
     * House's renown — as its men are armed (armsFactor).
     */
    strength(rival) {
        const G = this.config().guard;
        const raw = 20 + _num(rival.head && rival.head.intrigue) * 2 + _num(rival.guard) * _num(G.per, 8) + Math.floor(_num(rival.renown) / 5);
        return Math.max(1, Math.round(raw * this.armsFactor(rival)));
    },

    // ──────────── ARMS ────────────
    // The retinue in harness (data/arms.json rivals): its household men and
    // hired guards each want a soldier's kit, bought out of the towns' market
    // stock with the House's purse; worn, lost in a beaten fight, left on the
    // road for the player who scatters them.

    armsConfig() {
        const gd = DataLoader._gamedata;
        const d = (gd && gd.arms && gd.arms.rivals) || {};
        return {
            baseMen: 4, spendShare: 0.3, wear: 0.01, lostShare: 0.3,
            slots: { main: ['weapons', 'spear'], off: ['shield'], head: ['helmet'], body: ['gambeson', 'leather_armor', 'chainmail'] },
            ...d,
        };
    },

    /** The men of the retinue who want arms: the household and the hired guards. */
    men(rival) {
        return Math.max(1, Math.round(_num(this.armsConfig().baseMen, 4) + _num(rival && rival.guard)));
    },

    /** rival.arms (a household armed of old when missing: a kit for each of its own men). */
    arms(rival) {
        if (!rival) return { stock: {} };
        if (rival.arms && rival.arms.stock) return rival.arms;
        const A = this.armsConfig();
        const stock = {};
        const n = Math.max(0, Math.round(_num(A.baseMen, 4)));
        for (const ids of Object.values(A.slots || {})) if (ids && ids[0] && n > 0) stock[ids[0]] = n;
        rival.arms = { stock, spent: 0 };
        return rival.arms;
    },

    /** Pieces held for a slot: { n, tier, best } (best: the finest piece's id). */
    _armsSlot(rival, slot) {
        const A = this.armsConfig();
        const st = this.arms(rival).stock;
        let n = 0, t = 0, best = null, bt = -1;
        for (const id of A.slots[slot] || []) {
            const v = Math.max(0, Math.floor(_num(st[id]) + 1e-9));
            if (!v) continue;
            const def = Arms.item(id);
            const tier = _num(def && def.tier, 1);
            n += v; t += v * tier;
            if (tier > bt) { bt = tier; best = id; }
        }
        return { n, tier: n ? t / n : 1, best };
    },

    /** What the retinue's arms make of it (a soldier's kit for every man: bare to the arms' max). */
    armsFactor(rival) {
        const spec = Arms.kitSpec('soldier');
        if (!spec || !rival) return 1;
        const men = this.men(rival);
        const bare = Math.max(0.1, Math.min(1, _num(spec.bare, 0.55)));
        let sum = 0;
        for (const [slot, sp] of Object.entries(spec.slots || {})) {
            const h = this._armsSlot(rival, slot);
            sum += _num(sp.w) * Math.min(1, h.n / men) * h.tier;
        }
        return _round2(Math.max(bare, Math.min(_num(Arms.config().maxFactor, 1.45), bare + (1 - bare) * sum)));
    },

    /** The finest piece of each slot (for the renderers: Arms.lookLayers takes it) — { main, off, head, body }. */
    kitView(rival) {
        const out = {};
        for (const slot of Arms.SLOTS) out[slot] = this._armsSlot(rival, slot).best;
        return out;
    },

    /** '6 men: 6 Munition Sword, 4 Round Shield…' */
    armsLabel(rival) {
        const st = this.arms(rival).stock;
        const parts = Object.entries(st).filter(([, n]) => Math.floor(n) > 0).map(([id, n]) => `${Math.floor(n)} ${Arms.nameOf(id)}`);
        return `${this.men(rival)} men${parts.length ? ': ' + parts.join(', ') : ', unarmed'}`;
    },

    /**
     * The retinue stands in a town with a market: the House buys what its
     * men lack (cheapest of each slot), paying the town's price from its
     * purse into the town's, never below its reserve. → gold spent
     */
    _buyArms(world, rival, settlement) {
        if (!settlement || !settlement.market) return 0;
        const A = this.armsConfig();
        const C = this.config();
        const a = this.arms(rival);
        const men = this.men(rival);
        let budget = Math.min(_num(rival.gold) * _num(A.spendShare, 0.3), _num(rival.gold) - _num(C.invest && C.invest.reserve, 400));
        if (!(budget >= 1)) return 0;
        const tile = world && typeof world.getTile === 'function' ? world.getTile(settlement.q, settlement.r) : null;
        let spent = 0;
        for (const slot of ['main', 'body', 'off', 'head']) {
            const want = men - this._armsSlot(rival, slot).n;
            if (!(want > 0)) continue;
            let best = null;
            for (const id of A.slots[slot] || []) {
                if (!SettlementMarket.tracks(id) || SettlementMarket.available(settlement, id) < 1) continue;
                const good = _goodDef(id);
                if (!good || !(good.basePrice > 0)) continue;
                const price = Math.max(1, Economy.marketPrice(good, settlement, tile, world));
                if (!best || price < best.price) best = { id, price };
            }
            if (!best) continue;
            const n = Math.min(want, SettlementMarket.available(settlement, best.id), Math.floor(budget / best.price));
            if (!(n >= 1)) continue;
            const got = Math.floor(SettlementMarket.take(settlement, best.id, n) + 1e-9);
            if (!(got >= 1)) continue;
            const cost = got * best.price;
            rival.gold -= cost;
            Economy.payTown(settlement, cost);
            a.stock[best.id] = _num(a.stock[best.id]) + got;
            budget -= cost;
            spent += cost;
        }
        if (spent > 0) {
            a.spent = _num(a.spent) + spent;
            this._note(rival, world, `Bought arms in ${settlement.name} for ${spent} gold.`);
        }
        return spent;
    },

    /** The week's wear on the retinue's arms: a share of the pieces worn out. */
    _wearArms(rival) {
        const share = Math.max(0, Math.min(0.5, _num(this.armsConfig().wear, 0.01)));
        const st = this.arms(rival).stock;
        for (const id of Object.keys(st)) st[id] = _round2(_num(st[id]) * (1 - share));
    },

    /** Arms lost: `share` of every piece (whole pieces only). → { id: n } */
    _loseArms(rival, share) {
        const st = this.arms(rival).stock;
        const out = {};
        const k = Math.max(0, Math.min(1, _num(share)));
        for (const id of Object.keys(st)) {
            const n = Math.floor(_num(st[id]) * k + 1e-9);
            if (n > 0) { st[id] = _round2(_num(st[id]) - n); out[id] = n; }
        }
        return out;
    },

    /** Arms a beaten retinue left on the field, into the player's packs (as far as they hold). → { id: n } taken */
    _armsToPlayer(player, dropped) {
        const got = {};
        if (!player) return got;
        for (const [id, n] of Object.entries(dropped || {})) {
            if (!(n > 0)) continue;
            const r = PlayerInventory.addItem(player, id, n);
            if (r && r.success) got[id] = n;
        }
        return got;
    },

    // ──────────── LAND ────────────

    /** The rival's id as a landholder (world/estates.js). */
    holderId(rival) {
        // (a cadet branch run by this AI holds land under its own key: systems/cadetBranches.js)
        return rival.landKey || `rival:${rival.kingdomId}`;
    },

    _landOn(world) {
        return !!world && Estates.enabled() && !!world.estates && typeof world.estates === 'object';
    },

    /** The rival's holder record, named for the House (rents land in its purse). */
    _holder(world, rival) {
        const h = Estates.ensureHolder(world, this.holderId(rival));
        h.name = rival.name;
        h.kid = rival.kingdomId;
        if (h.purse == null) h.purse = 0;
        return h;
    },

    /** Estates the rival holds. */
    estates(world, rival) {
        return this._landOn(world) ? Estates.heldBy(world, this.holderId(rival)) : [];
    },

    landValue(world, rival) {
        return this.estates(world, rival).reduce((s, e) => s + (_num(e.value) || LandMarket.value(world, e)), 0);
    },

    /** The best estate on the market in reach that the purse can spare: { id, price, duty, yield, q, r, name } or null. */
    _findEstate(world, unit, rival) {
        if (!this._landOn(world)) return null;
        const I = this.config().invest;
        const id = this.holderId(rival);
        if (Estates.heldBy(world, id).length >= _num(I.maxEstates, 6)) return null;
        const spare = Math.min(_num(rival.gold) - _num(I.reserve), _num(rival.gold) * _num(I.maxShare, 0.7));
        if (!(spare > 0)) return null;
        let best = null;
        for (const { x, e, live, dist } of LandMarket.listingsNear(world, unit.q, unit.r, _num(I.range, 24))) {
            if (x.seller === id) continue;
            const duty = live.kingdom != null ? Math.round(x.price * _num(Estates.config().value.duty, 0.03)) : 0;
            if (x.price + duty > spare) continue;
            const y = LandMarket.annualRent(world, e, live) / Math.max(1, x.price + duty);
            if (y < _num(I.minYield, 0.03)) continue;
            const score = y / (1 + dist / 30);
            if (!best || score > best.score) best = { id: e.id, price: x.price, duty, yield: y, score, q: live.q, r: live.r, name: live.name };
        }
        return best;
    },

    /** Buy the estate at journey's end (if it is still for sale and the purse still holds). → true when bought. */
    _buyEstate(player, world, rival, plan, out) {
        const st = world.estates;
        const e = st && st.estates && st.estates[plan.estate];
        const x = e && LandMarket.listing(world, e.id);
        const live = e && Estates._liveOfKey(world, e.town);
        if (!e || !x || !live || e.holder === this.holderId(rival)) return false;
        const duty = live.kingdom != null ? Math.round(x.price * _num(Estates.config().value.duty, 0.03)) : 0;
        if (x.price + duty > _num(rival.gold) - _num(this.config().invest.reserve)) return false;
        const seller = e.holder;
        const from = Estates.holderName(world, seller);
        const day = _day(world);
        rival.gold -= x.price + duty;
        if (duty > 0) {
            const k = Estates.kingdom(world, live.kingdom);
            if (k) k.treasury = _num(k.treasury) + duty;
        }
        LandMarket._paySeller(world, player, seller, x.price, e, out);
        this._holder(world, rival);
        LandMarket._setHolder(world, e, this.holderId(rival), day);
        Estates.record(world, {
            key: `es:sold:${e.id}:${day}`, kind: 'sold', why: x.reason, day, place: live.name, q: live.q, r: live.r,
            kingdomId: live.kingdom != null ? live.kingdom : null, estate: e.name, holder: from, buyer: rival.name, price: x.price, own: seller === 'player',
        });
        rival.stats.estatesBought++;
        this._note(rival, world, `Bought ${e.name} near ${live.name} for ${x.price}g.`, 'land');
        if (player && (seller === 'player' || _dist(world, player, live) <= this.config().noticeRange)) {
            out.notices.push({ icon: '🌾', title: 'A Rival Buys Land', text: `${this.headName(rival)} buys ${e.name} near ${live.name} for ${x.price}g${seller === 'player' ? '' : ` from ${from}`}.`, type: 'info' });
        }
        return true;
    },

    /** The week's land: rents into the purse; a House gone poor lists its cheapest estate. */
    _landWeek(world, rival) {
        if (!this._landOn(world)) return;
        const id = this.holderId(rival);
        const h = Estates.holder(world, id);
        if (h && _num(h.purse) > 0) {
            const got = Math.round(h.purse);
            rival.gold += got;
            rival.stats.rents += got;
            h.purse = 0;
        }
        const I = this.config().invest;
        const held = Estates.heldBy(world, id);
        if (!held.length || rival.gold >= _num(I.sellBelow, 150) || world.estates.sales.some(x => x.seller === id)) return;
        const e = held.slice().sort((a, b) => _num(a.value) - _num(b.value))[0];
        const price = Math.round((_num(e.value) || LandMarket.value(world, e)) * _num(I.sellAt, 0.95));
        if (LandMarket._list(world, e, price, id, 'debts', _day(world))) {
            rival.stats.estatesSold++;
            this._note(rival, world, `Put ${e.name} up for sale (${price}g) to pay the household.`, 'poor');
        }
    },

    // ──────────── COURT ────────────

    /** The realm where the rival stands best: { kingdomId, standing } or null. */
    bestStanding(rival) {
        let best = null;
        for (const [kid, v] of Object.entries(rival.standing || {})) {
            if (_num(v) > 0 && (!best || v > best.standing)) best = { kingdomId: kid, standing: _num(v) };
        }
        return best;
    },

    /** The week's court: favour fades unless renewed; a crown's favourite draws a pension from its treasury. */
    _courtWeek(world, rival, live = [rival]) {
        const S = this.config().standing;
        const day = _day(world);
        const decayTicks = Math.max(1, Math.round(_num(S.decayDays, 30) / 7));
        const decay = Math.floor(day / 7) % decayTicks === 0;
        for (const [kid, v] of Object.entries(rival.standing)) {
            let s = Math.min(_num(S.max, 60), _num(v));
            if (decay) s -= _num(S.decay, 1);
            if (s <= 0) { delete rival.standing[kid]; continue; }
            rival.standing[kid] = s;
            // Only the court's favourite (the rival standing best there) draws a pension
            if (s < _num(S.favourite, 25) || this.favouriteAt(live, kid) !== rival) continue;
            const k = Estates.kingdom(world, kid);
            const pay = Math.round(s * _num(S.pension, 0.6));
            if (!k || k.isAlive === false || _num(k.treasury) < pay * 10) continue;
            k.treasury -= pay;
            rival.gold += pay;
            rival.stats.pensions += pay;
        }
    },

    // ──────────── AMBITION ────────────

    /** Set the head's next ambition (weighted by temper; revenge only against a hated House). */
    _setAmbition(player, world, rival) {
        const C = this.config();
        const A = C.ambitions;
        const w = { wealth: 2, land: this._landOn(world) ? 2 : 0, favour: 2, revenge: _num(rival.feud) >= _num(A.revenge.feud, 50) ? 2 : 0 };
        for (const t of (rival.head && rival.head.traits) || []) {
            for (const [k, v] of Object.entries((C.traits[t] && C.traits[t].ambitions) || {})) if (w[k] > 0) w[k] += v;
        }
        const prev = rival.ambition && rival.ambition.id;
        if (prev && w[prev] > 0 && Object.values(w).filter(v => v > 0).length > 1) w[prev] /= 3;
        const total = Object.values(w).reduce((a, b) => a + b, 0);
        let roll = Utils.random() * total;
        let id = 'wealth';
        for (const k of AMBITIONS) { roll -= w[k]; if (roll < 0) { id = k; break; } }
        const day = _day(world);
        const amb = { id, since: day };
        if (id === 'wealth') {
            const have = _num(rival.gold) + this.landValue(world, rival);
            const more = Math.min(have * (_num(A.wealth.grow, 1.8) - 1), _num(A.wealth.maxMore, 15000));
            amb.target = Math.round(Math.max(_num(A.wealth.min, 4000), have + more) / 100) * 100;
        }
        else if (id === 'land') amb.target = Math.min(_num(C.invest.maxEstates, 6), this.estates(world, rival).length + _num(A.land.more, 2));
        else if (id === 'favour') amb.target = _num(C.standing.favourite, 25);
        else amb.target = _num(rival.stats && rival.stats.plotsPaid) + _num(A.revenge.plots, 2);
        rival.ambition = amb;
        return amb;
    },

    /** How far along the ambition is: { have, target }. */
    ambitionProgress(world, rival) {
        const a = rival.ambition;
        if (!a) return null;
        let have = 0;
        if (a.id === 'wealth') have = Math.round(_num(rival.gold) + this.landValue(world, rival));
        else if (a.id === 'land') have = this.estates(world, rival).length;
        else if (a.id === 'favour') have = Math.round(_num((this.bestStanding(rival) || {}).standing));
        else have = _num(rival.stats && rival.stats.plotsPaid);
        return { have, target: _num(a.target) };
    },

    /** The week's ambition: fulfilled → renown and a new one; too long in vain → given up. */
    _ambitionWeek(player, world, rival, out) {
        const A = this.config().ambitions;
        const a = rival.ambition;
        if (!a) { this._setAmbition(player, world, rival); return; }
        const p = this.ambitionProgress(world, rival);
        const def = A[a.id] || {};
        if (p.have >= p.target) {
            rival.renown = _num(rival.renown) + _num(A.renown, 10);
            rival.stats.ambitions++;
            const text = `${this.headName(rival)} has achieved an ambition: ${def.name || a.id}. ${rival.name} grows in renown.`;
            this._note(rival, world, `Achieved "${def.name || a.id}".`, 'triumph');
            if (player && player.house) House._chronicle(player.house, world, text, ['rival', 'ambition']);
            out.notices.push({ icon: def.icon || '🏰', title: 'A Rival Rises', text, type: 'info' });
            this._setAmbition(player, world, rival);
        } else if (_day(world) - _num(a.since) >= _num(A.giveUpDays, 720)) {
            this._note(rival, world, `Gave up on "${def.name || a.id}".`);
            this._setAmbition(player, world, rival);
        }
    },

    // ──────────── GUARDS ────────────

    /** Hire guards after an attack (as many as the purse allows, up to `step`). → men hired. */
    _hireGuards(world, rival) {
        const G = this.config().guard;
        rival.lastAttackedDay = _day(world);
        const want = Math.min(_num(G.step, 2), _num(G.max, 8) - _num(rival.guard));
        const can = Math.min(want, Math.floor(_num(rival.gold) / Math.max(1, _num(G.cost, 60))));
        if (can <= 0) return 0;
        rival.guard = _num(rival.guard) + can;
        rival.gold -= can * _num(G.cost, 60);
        return can;
    },

    /** The week's guards: wages paid; once the attack is forgotten one is let go each week. */
    _guardWeek(world, rival, player = null, out = null) {
        const G = this.config().guard;
        const day = _day(world);
        this._armWeek(world, rival, player, out);
        if (!(rival.guard > 0)) return;
        rival.gold = Math.max(0, rival.gold - rival.guard * _num(G.wage, 6));
        const since = Math.max(_num(rival.lastAttackedDay, -1e9), _num(rival.armedDay, -1e9));
        if (day - since > _num(G.forgetDays, 240) || rival.gold <= 0) rival.guard--;
    },

    /**
     * A bitter House too weak to waylay the player hires swords, one a week,
     * while the purse allows and enough of them would do. → men hired (0/1).
     */
    _armWeek(world, rival, player, out) {
        const C = this.config();
        const G = C.guard;
        const Wy = C.waylay;
        if (!player || _num(rival.feud) < _num(Wy.feud, 80) || _num(rival.guard) >= _num(G.max, 8)) return 0;
        const need = this._playerStrength(player) * _num(Wy.edge, 1.2);
        const have = this.strength(rival);
        if (have >= need) return 0;
        if (have + (_num(G.max, 8) - _num(rival.guard)) * _num(G.per, 8) < need) return 0; // no hope of matching them
        if (_num(rival.gold) < _num(C.invest.reserve, 400) + _num(G.cost, 60) * 3) return 0;
        rival.guard = _num(rival.guard) + 1;
        rival.gold -= _num(G.cost, 60);
        rival.armedDay = _day(world);
        if (rival.guard === 1 || rival.guard % 3 === 0) {
            this._note(rival, world, `Hires swords: ${rival.guard} guards now ride with the retinue.`);
            if (out) out.notices.push({ icon: '🛡️', title: 'A Rival Arms', text: `${this.headName(rival)} is hiring swords (${rival.guard} guards, retinue strength ${this.strength(rival)}). A House that hates you this much means to use them.`, type: 'warning' });
        }
        return 1;
    },

    /** The House's seat: the realm's second town (the crown keeps the capital), else the capital. */
    _pickSeat(world, rival) {
        const towns = this._towns(world).filter(s => s.kingdom === rival.kingdomId);
        const k = world.getKingdom ? world.getKingdom(rival.kingdomId) : null;
        const cap = k && k.capital;
        const pick = towns.filter(s => !(cap && s.q === cap.q && s.r === cap.r))
            .sort((a, b) => _num(b.population) - _num(a.population))[0] || towns[0];
        if (pick) return { q: pick.q, r: pick.r, name: pick.name };
        if (cap) return { q: cap.q, r: cap.r, name: cap.name || 'the capital' };
        return null;
    },

    _towns(world) {
        if (!world) return [];
        if (typeof world.getSettlementViews === 'function') return world.getSettlementViews();
        if (typeof world.getAllSettlements === 'function') return world.getAllSettlements();
        return [];
    },

    _settlementAt(world, q, r) {
        const t = world.getTile(q, r);
        return (t && t.settlement) || null;
    },

    _note(rival, world, text, event = null) {
        if (!Array.isArray(rival.log)) rival.log = [];
        rival.log.push({ day: _day(world), text });
        if (rival.log.length > 12) rival.log.splice(0, rival.log.length - 12);
        if (event) this.event(rival, world, event);
    },

    // ──────────── THE RETINUE ────────────

    _route(world, a, b) {
        let route = null;
        try { route = MerchantCaravans.route(world, { q: a.q, r: a.r }, { q: b.q, r: b.r }, false); } catch (e) { route = null; }
        if (route && route.length >= 4) return route;
        const W = (world && world.width) || 0;
        let dq = b.q - a.q;
        if (W && Math.abs(dq) > W / 2) dq -= Math.sign(dq) * W;
        const out = [];
        for (const p of Hex.lineDraw(a.q, a.r, a.q + dq, b.r)) out.push(W ? Hex.wrapQ(p.q, W) : p.q, p.r);
        return out;
    },

    _spawnRetinue(world, rival) {
        const at = rival.seat;
        if (!at) return null;
        const C = this.config();
        const unit = Object.assign(Object.create(WorldUnit.prototype), {
            type: RIVAL_TYPE, id: `rival_${_hash(`${rival.houseKey}:${_day(world)}`).toString(36)}`,
            q: at.q, r: at.r, path: [], route: null, step: 0, destroyed: false, age: 0, maxAge: 1e9, speed: 0,
            inventory: {}, icon: C.icon, rivalId: rival.kingdomId, houseKey: rival.houseKey,
            name: `${this.headName(rival)}'s Retinue`, houseName: rival.name, kingdomId: rival.kingdomId,
            strength: this.strength(rival), population: 12,
        });
        unit.sourceQ = unit.q; unit.sourceR = unit.r;
        if (!Array.isArray(world.units)) world.units = [];
        world.units.push(unit);
        return unit;
    },

    /** Set the retinue riding toward a place. */
    _ride(world, unit, to) {
        unit.route = this._route(world, unit, to);
        unit.step = 0;
        unit.targetQ = to.q;
        unit.targetR = to.r;
    },

    /** Ride today's stretch: `speed` hexes along the route. → true once arrived. */
    _advance(world, unit) {
        const route = Array.isArray(unit.route) ? unit.route : [];
        const last = route.length / 2 - 1;
        if (last < 1) return true;
        const speed = Math.max(1, _num(this.config().speed, 3));
        for (let i = 0; i < speed && unit.step < last; i++) {
            unit.step++;
            unit.q = route[unit.step * 2];
            unit.r = route[unit.step * 2 + 1];
        }
        return unit.step >= last;
    },

    // ──────────── AGENDA ────────────

    /**
     * What each errand is worth to the head now: the best bargain's gain, the
     * best estate's yield, favour (and a pension) at court, the heat of the
     * feud, the need to rest — plus temper, times the ambition's errand.
     * An errand with nothing to do scores 0. → { scores, trade, estate }.
     */
    _scores(player, world, rival, unit) {
        const C = this.config();
        const T = C.think;
        const W = C.weights;
        const day = _day(world);
        const s = { trade: 0, court: 0, shadow: 0, invest: 0, waylay: 0, home: _num(W.home, 1) };
        const trade = rival.gold >= C.trade.minGold ? this._findTrade(world, unit, rival) : null;
        if (trade) s.trade = _num(W.trade) * Math.min(_num(T.tradeCap, 2.5), trade.gain / Math.max(1, _num(T.tradeNorm, 100)));
        const estate = this._findEstate(world, unit, rival);
        if (estate) s.invest = _num(W.invest) * Math.min(_num(T.investCap, 3), estate.yield / Math.max(0.001, _num(C.invest.minYield, 0.03)));
        // Court: worth more the nearer the favourite's pension, and to a bitter rival where the player is liked
        if (rival.gold >= C.court.gift) {
            const best = this.bestStanding(rival);
            const fav = _num(C.standing.favourite, 25);
            s.court = _num(W.court) * (1 + Math.min(_num(T.courtCap, 3) - 1, best ? best.standing / fav : 0));
            const liked = player && Object.values(player.reputation || {}).some(v => _num(v) > 0);
            if (liked && _num(rival.feud) >= C.court.whisperFeud) s.court += _num(W.court) * 0.5;
        }
        if (player && !this.inTruce(rival, world) && _num(rival.feud) >= C.shadow.feud && day - _num(rival.lastPlotDay, -1e9) >= C.shadow.plotEvery && rival.gold >= C.plotCost) {
            s.shadow = _num(W.shadow) * (1 + (_num(rival.feud) - C.shadow.feud) / 20);
        }
        if (this.canWaylay(player, world, rival)) s.waylay = _num(W.waylay, 2) * (1 + (_num(rival.feud) - _num(C.waylay.feud, 80)) / 10);
        for (const t of rival.head.traits || []) {
            for (const [k, v] of Object.entries((C.traits[t] && C.traits[t].weights) || {})) if (s[k] > 0) s[k] += v;
        }
        const amb = rival.ambition && C.ambitions[rival.ambition.id];
        if (amb && s[amb.errand] > 0) s[amb.errand] *= _num(T.ambition, 1.6);
        const away = day - _num(rival.homeDay, day);
        if (rival.gold < C.home.poorBelow || away >= C.home.restAfter) s.home += 20;
        return { scores: s, trade, estate };
    },

    /**
     * Pick the next errand. The menu is only the errands worth something
     * today (so only what the engine can carry out); the House brain seam
     * (House._brain.chooseErrand) picks from it — by default a weighted draw by
     * worth, or a local model's proposal (systems/npcBrain.js) — and an
     * off-menu answer falls back to 'home'. → { kind, trade, estate }.
     */
    _choose(player, world, rival, unit) {
        const got = this._scores(player, world, rival, unit || this.retinueOf(world, rival) || rival.seat || { q: 0, r: 0 });
        const options = ERRANDS.filter(k => _num(got.scores[k]) > 0)
            .map(k => ({ id: k, worth: _num(got.scores[k]), about: this._errandAbout(k, got, rival) }));
        const roll = Utils.random();
        const self = this;
        const choice = House._brain.chooseErrand({
            rival, options, roll, house: player && player.house, world,
            head: rival.head && rival.head.firstName,
            mood: this.mood(rival, world).id,
            self: `You are ${this.headName(rival)}, ${this.manner(rival)}, with ${Math.round(_num(rival.gold))} gold in your purse${rival.ambition && this.config().ambitions[rival.ambition.id] ? ` and the ambition to ${this.config().ambitions[rival.ambition.id].name.toLowerCase()}` : ''}.`,
            memories: () => self.memoryOf(rival, world).slice(0, 5).map(m => self.memoryLabel(m)),
        });
        const kind = options.some(o => o.id === choice) ? choice : 'home';
        return { kind, trade: got.trade, estate: got.estate };
    },

    /** One line on what an errand would mean today, for a model choosing among them. */
    _errandAbout(kind, got, rival) {
        if (kind === 'trade' && got.trade) return `buy ${this.goodName(got.trade.good)} in ${got.trade.from.name} and sell it in ${got.trade.to.name}, about ${Math.round(got.trade.gain)} gold to be made`;
        if (kind === 'invest' && got.estate) return `buy the estate of ${got.estate.name} for ${Math.round(got.estate.price)} gold`;
        if (kind === 'court') return 'ride to a royal court to win favour (and speak against your rival there)';
        if (kind === 'shadow') return `ride near your rival and pay ${this.config().plotCost} gold for a plot against them`;
        if (kind === 'waylay') return 'hunt your rival\'s party on the road and fall on it';
        if (kind === 'home') return `rest at your seat${rival.seat && rival.seat.name ? ` in ${rival.seat.name}` : ''}`;
        return '';
    },

    /** The best bargain near the retinue: { from, to, good, qty, buy, sell } or null. */
    _findTrade(world, unit, rival) {
        const C = this.config().trade;
        const towns = this._towns(world).filter(s => s.market && s.market.stock);
        if (towns.length < 2) return null;
        const near = (p, n) => towns.map(s => ({ s, d: _dist(world, p, s) }))
            .filter(x => x.d <= C.range).sort((a, b) => a.d - b.d).slice(0, n).map(x => x.s);
        const sources = near(unit, C.sources);
        const goods = Object.keys((SettlementMarket.config() && SettlementMarket.config().goods) || {});
        const budget = Math.max(0, rival.gold * C.spend);
        let best = null;
        // (a town's price for a lot of a good is the same whichever source it came from: asked once)
        const sales = new Map();
        for (const from of sources) {
            const tf = world.getTile(from.q, from.r);
            // What each good costs here doesn't depend on where it goes: priced once a source
            // (null where it can't be had), the destinations below only price the sale
            const offers = goods.map(id => {
                const have = SettlementMarket.available(from, id);
                if (have < C.minQty) return null;
                const base = _goodDef(id).basePrice;
                const buy = SettlementMarket.value(world, from, tf, id, base);
                if (!(buy > 0)) return null;
                const qty = Math.min(C.maxQty, Math.floor(have / 2), Math.floor(budget / buy));
                if (qty < C.minQty) return null;
                return { base, qty, buyAt: SettlementMarket.value(world, from, tf, id, base, have - qty / 2) };
            });
            for (const to of near(from, C.destinations)) {
                if (to === from) continue;
                const tt = world.getTile(to.q, to.r);
                for (let gi = 0; gi < goods.length; gi++) {
                    const o = offers[gi];
                    if (!o) continue;
                    const id = goods[gi];
                    const { base, qty, buyAt } = o;
                    let byTo = sales.get(to);
                    if (!byTo) sales.set(to, byTo = new Map());
                    const sk = gi * 100000 + qty;
                    let sellAt = byTo.get(sk);
                    if (sellAt === undefined) byTo.set(sk, sellAt = SettlementMarket.value(world, to, tt, id, base, SettlementMarket.stock(to, id) + qty / 2));
                    if (!(buyAt > 0) || sellAt / buyAt - 1 < C.minMargin) continue;
                    const gain = (sellAt - buyAt) * qty / (1 + _dist(world, from, to) / 10);
                    if (!best || gain > best.gain) best = { from, to, good: id, qty, buy: buyAt, sell: sellAt, gain };
                }
            }
        }
        return best;
    },

    _capitalFor(player, world, rival) {
        const kingdoms = ((world && world.kingdoms) || []).filter(k => k && k.isAlive && k.capital);
        const own = kingdoms.find(k => k.id === rival.kingdomId);
        // A head after a crown's favour builds where they already stand best
        const best = this.bestStanding(rival);
        if (best && rival.ambition && rival.ambition.id === 'favour') {
            const k = kingdoms.find(x => String(x.id) === String(best.kingdomId));
            if (k) return k;
        }
        // A bitter rival goes where the player stands best, to undo it
        if (player && _num(rival.feud) >= this.config().court.whisperFeud && Utils.random() < 0.5) {
            const rep = player.reputation || {};
            const fav = kingdoms.slice().sort((a, b) => _num(rep[b.id]) - _num(rep[a.id]))[0];
            if (fav) return fav;
        }
        return own || Utils.randPick(kingdoms) || null;
    },

    _nearestTown(world, p) {
        let best = null;
        let bd = Infinity;
        for (const s of this._towns(world)) {
            const d = _dist(world, p, s);
            if (d < bd) { bd = d; best = s; }
        }
        return best;
    },

    /** Set off on a new errand. */
    _plan(player, world, rival, unit, out = { notices: [] }) {
        const pick = this._choose(player, world, rival, unit);
        const kind = pick.kind;
        const day = _day(world);
        if (kind === 'waylay' && player) return this._startWaylay(player, world, rival, unit, out);
        if (kind === 'invest' && pick.estate) {
            const e = pick.estate;
            rival.plan = { kind: 'invest', estate: e.id, price: e.price, to: { q: e.q, r: e.r, name: e.name }, since: day };
            this._ride(world, unit, e);
            return rival.plan;
        }
        if (kind === 'trade') {
            const t = pick.trade;
            if (t) {
                rival.plan = { kind: 'trade', stage: 'buying', good: t.good, qty: t.qty, from: { q: t.from.q, r: t.from.r, name: t.from.name }, to: { q: t.to.q, r: t.to.r, name: t.to.name }, since: day };
                this._ride(world, unit, t.from);
                return rival.plan;
            }
        }
        if (kind === 'court') {
            const k = this._capitalFor(player, world, rival);
            if (k) {
                const seat = this._settlementAt(world, k.capital.q, k.capital.r);
                rival.plan = { kind: 'court', kingdomId: k.id, to: { q: k.capital.q, r: k.capital.r, name: (seat && seat.name) || k.capital.name || k.name }, realm: k.name, since: day };
                this._ride(world, unit, k.capital);
                return rival.plan;
            }
        }
        if (kind === 'shadow' && player) {
            const town = this._nearestTown(world, player);
            if (town) {
                rival.plan = { kind: 'shadow', to: { q: town.q, r: town.r, name: town.name }, since: day };
                this._ride(world, unit, town);
                return rival.plan;
            }
        }
        if (rival.seat) {
            rival.plan = { kind: 'home', to: { ...rival.seat }, since: day };
            this._ride(world, unit, rival.seat);
            return rival.plan;
        }
        rival.plan = null;
        return null;
    },

    /** Arrived where the errand leads: do the business, and maybe stay a while. */
    _arrive(player, world, rival, unit, out) {
        const C = this.config();
        const plan = rival.plan;
        const day = _day(world);
        if (!plan) return;
        if (plan.kind === 'invest') {
            if (!this._buyEstate(player, world, rival, plan, out)) this._note(rival, world, `Rode to ${plan.to.name} for land, and found it gone.`);
            rival.plan = null;
            return;
        }
        if (plan.kind === 'trade' && plan.stage === 'buying') {
            const s = this._settlementAt(world, plan.from.q, plan.from.r);
            const base = _goodDef(plan.good).basePrice;
            const have = s ? SettlementMarket.available(s, plan.good) : 0;
            const price = s ? SettlementMarket.value(world, s, world.getTile(s.q, s.r), plan.good, base, have - plan.qty / 2) : 0;
            const qty = price > 0 ? Math.min(plan.qty, Math.floor(have / 2), Math.floor(rival.gold * C.trade.spend / price)) : 0;
            if (qty < C.trade.minQty) { rival.plan = null; return; }
            SettlementMarket.take(s, plan.good, qty);
            // A town of another tongue: an interpreter's fee, or a worse deal (systems/languages.js)
            const tongue = Languages.rivalVisit(world, rival, s, this._culture(world, rival));
            const cost = Math.round(price * qty / Math.max(0.5, tongue.dealFactor));
            rival.gold -= cost;
            plan.qty = qty;
            plan.cost = cost;
            plan.stage = 'selling';
            this._ride(world, unit, plan.to);
            unit.inventory = { [plan.good]: qty };
            if (player && _dist(world, player, s) <= C.noticeRange) {
                out.notices.push({ icon: '🛒', title: 'A Rival Buys Up', text: `${this.headName(rival)} buys up ${qty} ${_goodDef(plan.good).name.toLowerCase()} in ${s.name}, bound for ${plan.to.name}.`, type: 'info' });
            }
            return;
        }
        if (plan.kind === 'trade') {
            const s = this._settlementAt(world, plan.to.q, plan.to.r);
            const base = _goodDef(plan.good).basePrice;
            const price = s ? SettlementMarket.value(world, s, world.getTile(s.q, s.r), plan.good, base, SettlementMarket.stock(s, plan.good) + plan.qty / 2) : 0;
            const tongue = s ? Languages.rivalVisit(world, rival, s, this._culture(world, rival)) : { dealFactor: 1 };
            const got = Math.round(price * plan.qty * tongue.dealFactor);
            if (s) SettlementMarket.add(s, plan.good, plan.qty);
            rival.gold += got;
            unit.inventory = {};
            rival.stats.trades++;
            rival.stats.tradeProfit += got - _num(plan.cost);
            this._note(rival, world, `Sold ${plan.qty} ${_goodDef(plan.good).name.toLowerCase()} in ${plan.to.name} (${got - _num(plan.cost) >= 0 ? '+' : ''}${got - _num(plan.cost)}g).`, got >= _num(plan.cost) ? 'profit' : 'loss');
            if (player && _dist(world, player, plan.to) <= C.noticeRange) {
                out.notices.push({ icon: '📦', title: 'A Rival Sells', text: `${this.headName(rival)} unloads ${plan.qty} ${_goodDef(plan.good).name.toLowerCase()} in ${plan.to.name}: the price there falls.`, type: 'info' });
            }
            rival.plan = null;
            return;
        }
        if (plan.kind === 'court') {
            if (plan.until == null) {
                const [a, b] = _range(C.court.stay, [4, 9]);
                plan.until = day + Utils.randInt(a, b);
                rival.gold -= Math.min(rival.gold, C.court.gift);
                const S = C.standing;
                // A court of another tongue hears them less well without an interpreter (systems/languages.js)
                const courtTown = this._settlementAt(world, plan.to.q, plan.to.r);
                const tongue = courtTown ? Languages.rivalVisit(world, rival, courtTown, this._culture(world, rival)) : { favourFactor: 1 };
                const gain = Math.round((C.court.favour + Math.floor(_num(rival.renown) / Math.max(1, _num(S.renownPer, 20)))) * tongue.favourFactor);
                const before = _num(rival.standing[plan.kingdomId]);
                const now = Math.min(_num(S.max, 60), before + gain);
                rival.standing[plan.kingdomId] = now;
                rival.stats.courtVisits++;
                if (before < _num(S.favourite, 25) && now >= _num(S.favourite, 25)) {
                    this._note(rival, world, `Became a favourite at the court of ${plan.realm}.`, 'favour');
                    if (player) out.notices.push({ icon: '👑', title: 'A Rival in Favour', text: `${this.headName(rival)} has become a favourite at the court of ${plan.realm}: the crown pays them a pension, and their word there weighs more.`, type: 'warning' });
                }
                let whispered = false;
                // A rival can cool a court's regard for you, never turn it to hatred; a favourite's word cuts deeper
                const rep0 = player ? _num((player.reputation || {})[plan.kingdomId]) : 0;
                const cut = C.court.whisper + Math.floor(now / Math.max(1, _num(S.whisperPer, 10)));
                if (player && _num(rival.feud) >= C.court.whisperFeud && rep0 > 0) {
                    if (!player.reputation) player.reputation = {};
                    player.reputation[plan.kingdomId] = Math.max(0, rep0 - cut);
                    whispered = true;
                }
                this._note(rival, world, `At court in ${plan.to.name}${whispered ? ', speaking against you' : ''}.`);
                if (player && (whispered || _dist(world, player, plan.to) <= C.noticeRange)) {
                    out.notices.push({ icon: '🎭', title: 'A Rival at Court', text: `${this.headName(rival)} is at court in ${plan.to.name}${whispered ? ` and speaks against you: −${Math.min(rep0, cut)} reputation with ${plan.realm}` : ''}.`, type: whispered ? 'warning' : 'info' });
                }
            }
            if (day >= plan.until) rival.plan = null;
            return;
        }
        if (plan.kind === 'shadow') {
            if (plan.until == null) {
                const [a, b] = _range(C.shadow.stay, [3, 6]);
                plan.until = day + Utils.randInt(a, b);
                const hatched = player ? this._payPlot(player, world, rival) : null;
                this._note(rival, world, hatched ? `In ${plan.to.name}, paying for a plot against you.` : `In ${plan.to.name}, watching you.`);
            }
            if (day >= plan.until) rival.plan = null;
            return;
        }
        if (plan.kind === 'home') {
            if (plan.until == null) {
                const [a, b] = _range(C.home.stay, [6, 14]);
                plan.until = day + Utils.randInt(a, b);
                rival.homeDay = day;
            }
            if (day >= plan.until) rival.plan = null;
        }
    },

    /** A plot the rival pays for in person (feud permitting, a slot free, the purse full enough). */
    _payPlot(player, world, rival) {
        const C = this.config();
        const house = player.house;
        if (!house || rival.gold < C.plotCost || this.inTruce(rival, world)) return null;
        if (_day(world) - _num(rival.lastPlotDay, -1e9) < C.shadow.plotEvery) return null;
        if ((house.schemes || []).some(s => s.rivalId === rival.kingdomId)) return null;
        if ((house.schemes || []).length >= 2) return null;
        const options = Schemes.eligibleTypes(player, world, _num(rival.feud));
        if (!options.length) return null;
        const choice = House._brain.chooseScheme({
            rival, options, roll: Utils.random(), house, world, head: rival.head && rival.head.firstName,
            memories: () => this.memoryOf(rival, world).slice(0, 5).map(m => this.memoryLabel(m)),
        });
        const scheme = Schemes.hatch(player, world, rival, options.includes(choice) ? choice : options[0]);
        if (scheme) {
            rival.lastPlotDay = _day(world);
            rival.gold -= C.plotCost;
            rival.stats.plotsPaid++;
        }
        return scheme;
    },

    // ──────────── LIFE ────────────

    _yearOf(world, rival, out, player) {
        const C = this.config().life;
        const head = rival.head;
        head.age++;
        if (head.spouse) head.spouse.age++;
        for (const c of head.children) c.age++;
        // Marriage and children
        if (!head.spouse && head.age >= C.marryFrom && head.age < 60 && Utils.random() < C.marryChance) {
            head.spouse = this._person(world, rival, Math.max(C.marryFrom, head.age + Utils.randInt(-8, 2)), head.gender === 'female' ? 'male' : 'female');
            this._note(rival, world, `${head.firstName} weds ${head.spouse.firstName}.`);
        }
        const mother = head.gender === 'female' ? head : head.spouse;
        if (mother && mother.age <= C.fertileUntil && head.children.length < C.maxChildren && Utils.random() < C.childChance) {
            const child = this._person(world, rival, 0, null, this._names(head));
            head.children.push(child);
            this._note(rival, world, `A child, ${child.firstName}, is born to ${head.firstName}.`, 'birth');
        }
        for (const c of head.children) {
            if (!c.wed && c.age >= C.marryFrom && Utils.random() < C.childWedChance) c.wed = 'another House';
        }
        // Death
        const risk = head.age >= C.maxAge ? 1 : Math.max(0, head.age - C.deathFrom) * C.deathPerYear;
        if (Utils.random() < risk) this._succeed(world, rival, out, player);
    },

    /** The head dies: the eldest grown child (else the eldest, else a cousin) takes the House. */
    _succeed(world, rival, out, player) {
        const C = this.config().life;
        const old = rival.head;
        const oldName = this.headName(rival);
        const kids = old.children.slice().sort((a, b) => b.age - a.age);
        const heir = kids.find(c => c.age >= C.comeOfAge && !(c.wed && c.wed !== 'another House')) || kids.find(c => c.age >= C.comeOfAge) || null;
        let head;
        if (heir) {
            head = this._makeHead(world, rival, heir.age, heir.gender);
            head.firstName = heir.firstName;
            head.children = [];
            head.spouse = null;
            if (heir.age >= C.marryFrom + 4 && Utils.random() < 0.6) head.spouse = this._person(world, rival, heir.age, heir.gender === 'female' ? 'male' : 'female');
        } else {
            head = this._makeHead(world, rival);
        }
        head.martial = Number.isFinite(head.martial) ? head.martial : this._skill();
        head.persona = this._persona(rival, head);
        rival.head = head;
        rival.feud = Math.round(_num(rival.feud) * C.inherit);
        // The House remembers what you did to the old head, more dimly
        for (const m of rival.memory || []) { m.w = _num(m.w) * C.inherit; m.inherited = true; }
        rival.loans = (rival.loans || []).filter(l => !l.defaulted);
        rival.truceUntil = null;
        rival.ask = null;
        // A new head keeps half the court's favour and sets their own ambition
        for (const kid of Object.keys(rival.standing || {})) rival.standing[kid] = Math.floor(_num(rival.standing[kid]) / 2);
        this._setAmbition(player, world, rival);
        rival.stats.heads = _num(rival.stats.heads, 1) + 1;
        const newName = this.headName(rival);
        const text = `${oldName} dies at ${old.age}. ${heir ? `${old.gender === 'female' ? 'Her' : 'His'} ${heir.gender === 'female' ? 'daughter' : 'son'}` : 'A cousin,'} ${newName}${heir ? '' : ','} now heads ${rival.name}.`;
        this._note(rival, world, text, 'bereaved');
        const unit = this.retinueOf(world, rival);
        if (unit) unit.name = `${newName}'s Retinue`;
        if (player && player.house) House._chronicle(player.house, world, text, ['rival', 'death']);
        out.notices.push({ icon: '⚰️', title: 'A Rival Dies', text: `${text} The feud cools a little with the new head.`, type: 'info' });
    },

    // ──────────── THE DAY ────────────

    _dayRng(world) {
        return Utils.seededRandom((_hash(`${_seed(world)}:rivalHouses:${_day(world)}`) % 233279) + 1);
    },

    /**
     * One day of the rival Houses: give each its head, purse and retinue;
     * collect and pay the week's money; ride; do the business at journey's
     * end; on the year's last day, age, wed, bear and bury. Draws only its
     * own seeded stream. → { notices }
     */
    processDay(player, world) {
        const out = { notices: [] };
        const C = this.config();
        // No player (the interregnum): the rivals live on the House's record, so the retinues wait where they are
        if (!player || !world || C.enabled === false || typeof world.getTile !== 'function') return out;
        const day = _day(world);
        const live = this.rivals(player);
        const keys = new Set(live.map(r => r.houseKey).filter(Boolean));
        Utils.withRng(this._dayRng(world), () => {
            // The year's matches between Houses on good terms come before their children wed elsewhere
            if (day > 0 && day % Seasons.DAYS_PER_YEAR === 0 && live.every(r => r.head)) this._yearOfHouses(player, world, live, out);
            for (const rival of live) {
                if (rival.lastDay === day) continue;
                rival.lastDay = day;
                this._ensure(world, rival);
                this._ensureTies(rival, live);
                keys.add(rival.houseKey);
                // A waylaying retinue cut down in a fight on foot (no battle report reaches us): the hunt is over
                if (rival.plan && rival.plan.kind === 'waylay') {
                    const hunted = (world.units || []).find(u => u.id === rival.plan.unitId);
                    if (!hunted || hunted.destroyed) {
                        this._endWaylay(player, world, rival, hunted || null, 'beaten', out);
                        delete rival.armsDropped; // (left where they fell)
                    }
                }
                let unit = this.retinueOf(world, rival);
                if (!unit) unit = this._spawnRetinue(world, rival);
                if (!unit) continue;
                if (day > 0 && day % 7 === 0) {
                    // (real coin: the estate's dues come out of its seat town's purse, and
                    // what the household spends goes back into it)
                    const seatT = rival.seat && typeof world.getTile === 'function' ? world.getTile(rival.seat.q, rival.seat.r) : null;
                    const seatTown = seatT && seatT.settlement && seatT.settlement.economy ? seatT.settlement : null;
                    const dues = C.estate.weekly + C.estate.perStewardship * _num(rival.head.stewardship);
                    rival.gold += seatTown ? Math.floor(Economy.drawTown(seatTown, dues)) : dues;
                    // ...and a great House lives grandly: the household spends a share of the purse
                    const spent = Math.min(Math.max(0, rival.gold), C.upkeep.weekly + Math.round(rival.gold * _num(C.upkeep.share)));
                    rival.gold -= spent;
                    if (seatTown && spent > 0) Economy.payTown(seatTown, spent);
                    if (rival.gold < 0) rival.gold = 0;
                    this._landWeek(world, rival);
                    this._courtWeek(world, rival, live);
                    this._guardWeek(world, rival, player, out);
                    this._wearArms(rival);
                    this._ambitionWeek(player, world, rival, out);
                }
                unit.strength = this.strength(rival);
                this._dealsDay(player, world, rival, out);
                if (rival.plan && rival.plan.kind === 'waylay') this._hunt(player, world, rival, unit, out);
                // Coin the retinue took on the road (a toll, a robbery) goes to the House's purse
                if (unit.inventory && _num(unit.inventory.gold) > 0) {
                    rival.gold += Math.round(unit.inventory.gold);
                    unit.inventory.gold = 0;
                }
                if (!rival.plan) this._plan(player, world, rival, unit, out);
                if (rival.plan && rival.plan.kind !== 'waylay' && this._advance(world, unit)) this._arrive(player, world, rival, unit, out);
                // Business done or the stay over: settle the next errand now, to ride tomorrow
                if (!rival.plan) this._plan(player, world, rival, unit, out);
                // In a town: arms for the men who lack them, out of its armourers' stock
                const here = this._settlementAt(world, unit.q, unit.r);
                if (here && here.market) {
                    this._buyArms(world, rival, here);
                    unit.strength = this.strength(rival);
                }
                if (player && unit.q === player.q && unit.r === player.r && rival.metNoticeDay !== day && _day(world) - _num(rival.metNoticeDay, -99) > 5) {
                    rival.metNoticeDay = day;
                    out.notices.push({ icon: '🏰', title: 'A Rival in Town', text: `${this.headName(rival)} of ${rival.name} is here, with a retinue in ${rival.name.replace(/^House /, '')} colours.`, type: 'info' });
                }
                if (day > 0 && day % Seasons.DAYS_PER_YEAR === 0) this._yearOf(world, rival, out, player);
            }
            // Among themselves: one favourite to a court; regard won and lost between the Houses
            if (day > 0 && day % 7 === 0) this._courts(player, world, live, out);
            // A retinue whose House is no longer the player's rival rides off the map
            for (const u of this.retinues(world)) {
                if (!keys.has(u.houseKey)) u.destroyed = true;
            }
        });
        return out;
    },

    // ──────────── WAYLAYING ────────────

    /** The player's fighting strength on land, as the rivals reckon it (the army's men). */
    _playerStrength(player) {
        return ((player && player.army) || []).filter(u => u && !u.naval && !u.isNaval)
            .reduce((s, u) => s + _num(u.strength, _num(u.count, 1)), 0);
    },

    /** May this rival set out to waylay the player? A hot feud, no hunt lately, the player in reach and weaker. */
    canWaylay(player, world, rival) {
        const Wy = this.config().waylay;
        if (!player || !rival || !rival.head || player.indenturedServitude || player.prison) return false;
        if (this.inTruce(rival, world)) return false;
        if (_num(rival.feud) < _num(Wy.feud, 80)) return false;
        if (_day(world) - _num(rival.lastWaylayDay, -1e9) < _num(Wy.every, 150)) return false;
        const unit = this.retinueOf(world, rival);
        if (!unit || _dist(world, unit, player) > _num(Wy.range, 30)) return false;
        return this.strength(rival) >= this._playerStrength(player) * _num(Wy.edge, 1.2);
    },

    /** Ride out to fall on the player: the retinue turns hostile (a red token) and the player is warned. */
    _startWaylay(player, world, rival, unit, out) {
        const day = _day(world);
        rival.plan = { kind: 'waylay', since: day, until: day + _num(this.config().waylay.days, 20), unitId: unit.id };
        unit.hostile = true;
        unit.sparedUntilDay = null;
        if (!unit.inventory) unit.inventory = {};
        unit.inventory.gold = 0;
        this._ride(world, unit, player);
        this._note(rival, world, 'Rode out to waylay you.');
        if (out) out.notices.push({ icon: '⚔️', title: 'A Rival Hunts You', text: `Word comes that ${this.headName(rival)} has ridden out with armed men to waylay you on the road (strength ${this.strength(rival)}). Keep to the towns, gather men, or be ready to pay.`, type: 'warning' });
        return rival.plan;
    },

    /** A day of the hunt: an encounter's outcome ends it; else ride for where the player is now. */
    _hunt(player, world, rival, unit, out) {
        const plan = rival.plan;
        const day = _day(world);
        if (_num(unit.inventory && unit.inventory.gold) > 0) return this._endWaylay(player, world, rival, unit, 'robbed', out);
        if (unit.sparedUntilDay != null && day < unit.sparedUntilDay) return this._endWaylay(player, world, rival, unit, 'spared', out);
        // At your side since an earlier day: the day's encounter has been fought (an empty purse robbed is still a beating)
        if (player && plan.closed != null && plan.closed < day && _dist(world, unit, player) <= 1) return this._endWaylay(player, world, rival, unit, 'robbed', out);
        if (!player || day >= plan.until || player.indenturedServitude || player.prison) return this._endWaylay(player, world, rival, unit, 'gaveup', out);
        if (unit.targetQ !== player.q || unit.targetR !== player.r) this._ride(world, unit, player);
        this._advance(world, unit);
        if (_dist(world, unit, player) <= 1) { if (plan.closed == null) plan.closed = day; } else plan.closed = null;
        return null;
    },

    /**
     * The hunt is over. robbed / won: they took coin or beat your army
     * (vengeance tasted, the feud cools a little); spared: paid off, talked
     * down or given the slip; beaten: cut down (half the guards lost, the
     * shame inflames the feud); gaveup: no sight of you.
     */
    _endWaylay(player, world, rival, unit, how, out) {
        const Wy = this.config().waylay;
        const name = this.headName(rival);
        if (unit) unit.hostile = false;
        rival.plan = null;
        rival.lastWaylayDay = _day(world);
        rival.stats.waylays = _num(rival.stats.waylays) + 1;
        const feud = (amt, why) => { if (player) House.accrueRivalFeud(player, world, rival.kingdomId, amt, why); };
        let text = null;
        if (how === 'robbed' || how === 'won') {
            feud(_num(Wy.robFeud, -15));
            text = `${name}'s men fell on you on the road. Their vengeance tasted, the feud cools a little.`;
            this._note(rival, world, 'Waylaid you on the road, and had the better of it.', 'gloat');
            this.remember(rival, world, 'robbedYou');
        } else if (how === 'spared') {
            this._note(rival, world, 'Waylaid you on the road, and let you go.');
        } else if (how === 'beaten') {
            const menBefore = this.men(rival);
            rival.guard = Math.floor(_num(rival.guard) * _num(Wy.beatenGuards, 0.5));
            // The fallen guards' arms, and some of the rest, are left on the field
            const kept = (this.men(rival) / Math.max(1, menBefore)) * (1 - _num(this.armsConfig().lostShare, 0.3));
            rival.armsDropped = this._loseArms(rival, 1 - kept);
            feud(_num(Wy.beatenFeud, 10), 'an ambush beaten off');
            text = `${name}'s ambush failed: you beat off their men. They will not forget the shame.`;
            this._note(rival, world, 'Waylaid you, and was beaten off.', 'shamed');
            this.remember(rival, world, 'ambushBeaten');
        } else {
            this._note(rival, world, 'Hunted you on the roads, and rode home empty-handed.');
            if (out && player) out.notices.push({ icon: '🏰', title: 'The Hunt Is Off', text: `${name}'s men have given up the hunt for you.`, type: 'info' });
        }
        if (text && player && player.house) House._chronicle(player.house, world, text, ['rival', 'waylay']);
        return how;
    },

    // ──────────── AMONG THEMSELVES ────────────

    /** Give a rival its regard for each other rival House (once each; the same both ways). */
    _ensureTies(rival, live) {
        if (!rival.ties) rival.ties = {};
        const [a, b] = _range(this.config().ties.start, [-20, 20]);
        for (const o of live) {
            if (o === rival || rival.ties[o.kingdomId] != null) continue;
            if (!o.ties) o.ties = {};
            const v = o.ties[rival.kingdomId] != null ? o.ties[rival.kingdomId] : Utils.randInt(a, b);
            rival.ties[o.kingdomId] = v;
            o.ties[rival.kingdomId] = v;
        }
    },

    /** Change two Houses' regard for each other (both ways, −100..100). */
    bond(a, b, delta) {
        if (!a || !b || a === b) return;
        for (const [x, y] of [[a, b], [b, a]]) {
            if (!x.ties) x.ties = {};
            x.ties[y.kingdomId] = Math.max(-100, Math.min(100, _num(x.ties[y.kingdomId]) + delta));
        }
    },

    tie(a, b) {
        return _num(a && b && a.ties && a.ties[b.kingdomId]);
    },

    /** The court's favourite among the rivals: the one standing best there, at the favourite's mark or above. */
    favouriteAt(live, kid) {
        const fav = _num(this.config().standing.favourite, 25);
        let best = null;
        for (const r of live) {
            const s = _num(r.standing && r.standing[kid]);
            if (s < fav) continue;
            const b = best ? _num(best.standing[kid]) : -1;
            if (s > b || (s === b && String(r.kingdomId) < String(best.kingdomId))) best = r;
        }
        return best;
    },

    /**
     * The week among the Houses: realms at war set their Houses against each
     * other, allied realms draw theirs together, and a shared hatred of the
     * player's House makes friends.
     */
    _tiesWeek(world, live) {
        const T = this.config().ties;
        const realm = (r) => Estates.kingdom(world, r.kingdomId);
        const foe = _num(T.commonFoeFeud, 60);
        for (let i = 0; i < live.length; i++) {
            for (let j = i + 1; j < live.length; j++) {
                const a = live[i];
                const b = live[j];
                const ka = realm(a);
                const kb = realm(b);
                let d = 0;
                if (ka && kb && (ka.wars || []).some(id => String(id) === String(kb.id))) d += _num(T.war, -1);
                if (ka && kb && (ka.allies || []).some(id => String(id) === String(kb.id))) d += _num(T.allied, 0.5);
                if (_num(a.feud) >= foe && _num(b.feud) >= foe) d += _num(T.commonFoe, 0.5);
                if (d) this.bond(a, b, d);
            }
        }
    },

    /** The week at court among the Houses: each court's favourite; a House ousted holds it against the other. */
    _courts(player, world, live, out) {
        const T = this.config().ties;
        this._tiesWeek(world, live);
        const kids = new Set();
        for (const r of live) for (const kid of Object.keys(r.standing || {})) kids.add(kid);
        const now = new Map(live.map(r => [r, []]));
        for (const kid of kids) {
            const fav = this.favouriteAt(live, kid);
            if (fav) now.get(fav).push(kid);
        }
        for (const r of live) {
            for (const kid of r.favouriteOf || []) {
                const fav = this.favouriteAt(live, kid);
                if (!fav || fav === r) continue;
                this.bond(r, fav, _num(T.oust, -15));
                const k = Estates.kingdom(world, kid);
                const realm = k ? k.name : 'a court';
                this._note(r, world, `Ousted as favourite at the court of ${realm} by ${fav.name}.`, 'ousted');
                this._note(fav, world, `Ousted ${r.name} as favourite at the court of ${realm}.`);
                out.notices.push({ icon: '👑', title: 'A New Favourite', text: `${this.headName(fav)} has ousted ${this.headName(r)} as favourite at the court of ${realm}. There is no love lost between ${fav.name} and ${r.name} now.`, type: 'info' });
            }
            r.favouriteOf = now.get(r);
        }
    },

    /** The Houses' year together: old regard fades toward indifference; Houses on good terms wed their children. */
    _yearOfHouses(player, world, live, out) {
        const T = this.config().ties;
        const L = this.config().life;
        const free = (r) => (r.head.children || []).filter(c => c.age >= L.marryFrom && !c.wed);
        for (let i = 0; i < live.length; i++) {
            for (let j = i + 1; j < live.length; j++) {
                const a = live[i];
                const b = live[j];
                const t = this.tie(a, b);
                const drift = Math.min(Math.abs(t), _num(T.drift, 5)) * -Math.sign(t);
                if (drift) this.bond(a, b, drift);
                if (!a.head || !b.head || this.tie(a, b) < _num(T.matchMin, 20) || Utils.random() >= _num(T.matchChance, 0.3)) continue;
                const ca = free(a)[0];
                const cb = ca && free(b).find(c => c.gender !== ca.gender);
                if (!ca || !cb) continue;
                ca.wed = 'another House';
                ca.wedHouse = b.name;
                cb.wed = 'another House';
                cb.wedHouse = a.name;
                this.bond(a, b, _num(T.match, 40));
                const text = `${ca.firstName} ${this.surname(a)} weds ${cb.firstName} ${this.surname(b)}: ${a.name} and ${b.name} are bound by marriage.`;
                this._note(a, world, text, 'wedding');
                this._note(b, world, text, 'wedding');
                if (player && player.house) House._chronicle(player.house, world, text, ['rival', 'marriage']);
                out.notices.push({ icon: '💍', title: 'Rival Houses Wed', text: `${text}${this.tie(a, b) >= _num(T.allyAt, 50) ? ' They stand together now: a wrong to one is a wrong to both.' : ''}`, type: 'info' });
            }
        }
    },

    // ──────────── THE PERSON ────────────

    /** The voice data (data/rivalVoice.json): persona lists and lines. */
    voiceData() {
        const g = DataLoader._gamedata;
        return (g && g.rivalVoice) || {};
    },

    /** How the head talks, from their first trait: haughty, silken, soft, brisk or plain. */
    manner(rival) {
        const map = { proud: 'haughty', courtly: 'silken', scheming: 'soft', grasping: 'brisk', homebody: 'plain' };
        const t = ((rival && rival.head && rival.head.traits) || [])[0];
        return map[t] || 'plain';
    },

    /**
     * A head's looks, passion and honour, fixed by hash (no dice: a face
     * does not change between loads). honour 1–9: a scheming head breaks
     * their word more easily, a proud one keeps it.
     */
    _persona(rival, head) {
        const P = this.voiceData().persona || {};
        const h = (k) => _hash(`${rival.houseKey}:${head.firstName}:${head.age}:${k}`);
        const pick = (list, k, d) => (Array.isArray(list) && list.length ? list[h(k) % list.length] : d);
        const age = _num(head.age, 40);
        const hairList = age >= 60 ? P.hairOld : age >= 40 ? P.hairMid : P.hairYoung;
        let honour = 3 + (h('honour') % 5);
        if (this.has(head, 'scheming')) honour -= 2;
        if (this.has(head, 'proud')) honour += 2;
        return {
            build: pick(P.builds, 'build', 'lean'),
            hair: pick(hairList, 'hair', 'dark hair'),
            feature: pick(P.features, 'feature', 'a watchful eye'),
            passion: pick(P.passions, 'passion', { id: 'hunting', name: 'hunting', line: 'I would rather be hunting.' }),
            honour: Math.max(1, Math.min(9, honour)),
        };
    },

    /** "a lean man of 52, grey-bearded, with a scar through one eyebrow" */
    describe(rival) {
        const h = rival.head;
        const p = h.persona || this._persona(rival, h);
        const who = h.gender === 'female' ? 'woman' : 'man';
        return `a ${p.build} ${who} of ${h.age}, ${p.hair}, with ${p.feature}`;
    },

    /** Word of their honour, as far as the player has seen it. */
    honourWord(rival) {
        const n = _num(rival.head && rival.head.persona && rival.head.persona.honour, 5);
        if (_num(rival.brokeWord) > 0) return 'has broken their word to you';
        if (_num(rival.keptWord) > 0 && n >= 5) return 'has kept faith with you';
        return n >= 7 ? 'said to be a man of their word' : n <= 3 ? 'said to be slippery' : 'of middling repute';
    },

    // ──────────── WHAT THEY REMEMBER ────────────

    /** Something happened to the head (for their mood): kept for a month. */
    event(rival, world, kind) {
        if (!Array.isArray(rival.events)) rival.events = [];
        rival.events.push({ kind, day: _day(world) });
        if (rival.events.length > 10) rival.events.splice(0, rival.events.length - 10);
    },

    /** Remember a deed of the player's. Weight from config memory.kinds. */
    remember(rival, world, kind, note = null) {
        const M = this.config().memory;
        if (!Array.isArray(rival.memory)) rival.memory = [];
        rival.memory.push({ kind, day: _day(world), w: _num(M.kinds[kind]), note });
        if (rival.memory.length > _num(M.keep, 14)) rival.memory.splice(0, rival.memory.length - _num(M.keep, 14));
    },

    /** A memory's weight now (halving every halfLife days). */
    _weight(m, world) {
        const age = Math.max(0, _day(world) - _num(m.day));
        return _num(m.w) * Math.pow(0.5, age / Math.max(1, _num(this.config().memory.halfLife, 240)));
    },

    /** The sum of what they remember of you, faded. */
    memoryScore(rival, world) {
        if (!world) return 0;
        return (rival.memory || []).reduce((s, m) => s + this._weight(m, world), 0);
    },

    /** Did the player do `kind` within `days`? */
    recalls(rival, world, kind, days) {
        return (rival.memory || []).some(m => m.kind === kind && _day(world) - _num(m.day) <= days);
    },

    /** A memory in a few words ("the gift of 120g", "your insult before the crowd"). */
    memoryLabel(m) {
        const L = this.voiceData().memoryLabels || {};
        const base = L[m.kind] || m.kind;
        return `${m.inherited ? 'their parent spoke of ' : ''}${base}${m.note ? ` (${m.note})` : ''}`;
    },

    goodName(id) {
        return _goodDef(id).name.toLowerCase();
    },

    /** Their memories of you, the weightiest (faded) first. */
    memoryOf(rival, world) {
        return (rival.memory || []).map(m => ({ ...m, now: this._weight(m, world) }))
            .filter(m => Math.abs(m.now) >= 1).sort((a, b) => Math.abs(b.now) - Math.abs(a.now) || b.day - a.day);
    },

    /** How the head regards the player, about −100…100: the feud against what they remember. */
    regard(rival, world) {
        return Math.max(-100, Math.min(100, Math.round(20 - _num(rival.feud) + this.memoryScore(rival, world))));
    },

    /** The head's mood today: { id, icon, label, parley }. */
    mood(rival, world) {
        const day = _day(world);
        let best = null;
        for (const e of (rival && rival.events) || []) {
            const m = MOODS[e.kind];
            if (!m || day - _num(e.day) > m.days) continue;
            if (!best || m.rank > best.m.rank || (m.rank === best.m.rank && e.day > best.day)) best = { m, id: e.kind, day: e.day };
        }
        if (!best && rival && rival.plan && rival.plan.kind === 'waylay') return { id: 'hunting', icon: '🗡️', label: 'Cold', parley: -0.1 };
        return best ? { id: best.id, ...best.m } : { id: 'calm', ...MOODS.calm };
    },

    // ──────────── DEALS ────────────

    inTruce(rival, world) {
        return _num(rival && rival.truceUntil, -1) > _day(world);
    },

    /** A rival's open request that the player act against another House: { kind:'against', target, until }. */
    _fulfilAsks(player, world, targetKid, how) {
        const D = this.config().deals;
        for (const r of this.rivals(player)) {
            const a = r.ask;
            if (!a || a.kind !== 'against' || String(a.target) !== String(targetKid) || _day(world) > _num(a.until)) continue;
            r.ask = null;
            House.accrueRivalFeud(player, world, r.kingdomId, _num(D.againstFeud, -30));
            this.remember(r, world, 'helped', how);
            r.keptWord = _num(r.keptWord);
            const target = this.rival(player, targetKid);
            this._note(r, world, `Heard how you ${how === 'insult' ? 'shamed' : 'fell upon'} ${target ? this.headName(target) : 'their enemy'}, and was glad.`, 'triumph');
            r.pendingNotices = (r.pendingNotices || []).concat([{ icon: '🤝', title: 'A Favour Done', text: `${this.headName(r)} hears that you ${how === 'insult' ? 'shamed' : 'fell upon'} ${target ? this.headName(target) : 'their enemy'}, as they asked. The quarrel between your Houses cools: feud ${_num(D.againstFeud, -30)}.`, type: 'success' }]);
        }
    },

    /**
     * The day's dealings with the player: loans fall due (an honest or
     * friendly House pays, an honest poor one asks for time, a slippery one
     * refuses); a slippery, bitter House may break a truce; favours done
     * reach the player as notices.
     */
    _dealsDay(player, world, rival, out) {
        const D = this.config().deals;
        const day = _day(world);
        const honour = _num(rival.head && rival.head.persona && rival.head.persona.honour, 5);
        for (const n of rival.pendingNotices || []) out.notices.push(n);
        rival.pendingNotices = [];
        if (!player) return;
        for (const loan of rival.loans || []) {
            if (loan.repaid || loan.defaulted || day < _num(loan.due)) continue;
            const willing = honour >= _num(D.payHonour, 4) || _num(rival.feud) < 30;
            if (willing && rival.gold >= loan.owed) {
                rival.gold -= loan.owed;
                player.gold = _num(player.gold) + loan.owed;
                Ledger.record(player, 'rivalDeals', loan.owed);
                loan.repaid = day;
                rival.keptWord = _num(rival.keptWord) + 1;
                this._note(rival, world, `Repaid your loan: ${loan.owed}g.`);
                out.notices.push({ icon: '💰', title: 'A Debt Repaid', text: `${this.headName(rival)} repays the ${loan.amount} gold you lent, with interest: +${loan.owed} gold. ${rival.name} keeps its word.`, type: 'success' });
            } else if (willing && !loan.extended) {
                loan.extended = true;
                loan.due = day + _num(D.graceDays, 30);
                this._note(rival, world, 'Asked for more time to repay your loan.');
                out.notices.push({ icon: '⏳', title: 'More Time', text: `${this.headName(rival)} cannot yet repay your ${loan.owed} gold, and asks for ${_num(D.graceDays, 30)} days more.`, type: 'info' });
            } else {
                loan.defaulted = day;
                rival.brokeWord = _num(rival.brokeWord) + 1;
                this._note(rival, world, `Refused to repay your loan of ${loan.amount}g.`, 'gloat');
                out.notices.push({ icon: '🧾', title: 'A Debt Refused', text: `${this.headName(rival)} will not repay the ${loan.owed} gold they owe you. Press them for it when you meet.`, type: 'warning' });
            }
        }
        // A slippery House sick with hatred may break a truce
        if (this.inTruce(rival, world) && honour <= _num(D.breakHonour, 3) && _num(rival.feud) >= _num(D.breakFeud, 60) && Utils.random() < _num(D.breakChance, 0.01)) {
            rival.truceUntil = null;
            rival.brokeWord = _num(rival.brokeWord) + 1;
            this._note(rival, world, 'Broke the truce with your House.', 'gloat');
            out.notices.push({ icon: '💔', title: 'A Truce Broken', text: `${this.headName(rival)} has broken the truce between your Houses. Their word, it seems, is worth little.`, type: 'warning' });
        }
    },

    /** Their head as a duellist (systems/duels.js): martial skill, age, guards' training. */
    duelist(rival) {
        const h = rival.head;
        const m = _num(h.martial, 5);
        const age = _num(h.age, 40);
        const ageMult = age > 55 ? 0.8 : age < 22 ? 0.9 : 1;
        const temperament = this.has(h, 'proud') ? 'aggressive' : this.has(h, 'scheming') ? 'tricky' : m >= 7 ? 'aggressive' : 'balanced';
        // The House's best blade and harness (rival.arms; a longsword and light harness when it holds none)
        const kit = this.kitView(rival);
        const w = kit.main ? Arms.stats(kit.main) : null;
        const prot = (id) => { const s = id ? Arms.stats(id) : null; return s ? s.prot : 0; };
        const worn = 1 - (1 - prot(kit.body)) * (1 - prot(kit.head));
        const sh = kit.off ? Arms.stats(kit.off) : null;
        return Duels.fromProfile({
            id: `rivalHead:${rival.kingdomId}`, kind: 'rival', name: this.headName(rival), icon: '🏰',
            title: `Head of ${rival.name}`,
            attack: (m * 0.9 + 1) * ageMult, defense: (m * 0.6 + (sh ? sh.block * 0.5 : 0)) * ageMult, power: (5 + m * 0.6) * ageMult,
            armour: worn > 0 ? _round2(Math.max(0.05, worn * 0.6)) : 0.15,
            weapon: w && w.melee ? `a ${w.name.toLowerCase()}` : 'a longsword',
            weaponDmg: w && w.melee ? _round2(Math.max(1, w.dmg * 0.65)) : 2,
            ...(w && w.melee ? { dtype: w.dtype, reach: w.reach, pen: w.pen } : {}),
            shield: sh ? sh.name.toLowerCase() : null, riposte: sh ? sh.riposte : 0,
            temperament,
            hp: Math.round((22 + m * 1.6) * ageMult), stamina: Math.round(8 + m * 0.5), skill: m, ref: rival,
        });
    },

    /**
     * A duel with the head is over (outcome: Duels.result). Honour is
     * satisfied either way: the feud falls more if you won; renown and a
     * memory; harm to you from the bout. → { success, playerWon, harm, text }.
     */
    settleDuel(player, world, kingdomId, outcome) {
        const rival = this.rival(player, kingdomId);
        if (!rival || !rival.head || !outcome) return { success: false, reason: 'No such duel.' };
        const won = !!outcome.playerWon;
        const harm = Duels.harm(outcome.aLost, [2, 18]);
        player.health = Math.max(1, _num(player.health, 100) - harm);
        House.accrueRivalFeud(player, world, kingdomId, won ? -20 : -12);
        if (won) player.renown = _num(player.renown) + 5;
        this.remember(rival, world, won ? 'duelYouWon' : 'duelYouLost');
        this._note(rival, world, won ? 'Lost a duel to you, first blood.' : 'Bested you in a duel, first blood.', won ? 'shamed' : 'gloat');
        rival.lastDuelDay = _day(world);
        const name = this.headName(rival);
        return {
            success: true, playerWon: won, harm,
            text: won
                ? `First blood is yours. ${name} lowers the blade: honour is satisfied. Feud −20, +5 renown, −${harm} health.`
                : `${name} draws first blood. They sheathe the sword, satisfied. Feud −12, −${harm} health.`,
        };
    },

    // ──────────── THE PLAYER ────────────

    /** Retinues within a hex of the player. */
    meetable(player, world) {
        if (!player || !world) return [];
        const range = this.config().meet.range;
        const keys = new Set(this.rivals(player).map(r => r.houseKey));
        return this.retinues(world).filter(u => keys.has(u.houseKey) && _dist(world, player, u) <= range);
    },

    rivalOfUnit(player, unit) {
        if (!unit) return null;
        return this.rivals(player).find(r => r.kingdomId === unit.rivalId && r.houseKey === unit.houseKey) || null;
    },

    /** What the House's head is about, in words. */
    doing(world, rival) {
        const p = rival && rival.plan;
        if (!p) return 'deciding what next';
        const good = p.good ? _goodDef(p.good).name.toLowerCase() : '';
        if (p.kind === 'trade') return p.stage === 'buying' ? `riding to ${p.from.name} to buy ${good}` : `carrying ${p.qty} ${good} to ${p.to.name}`;
        if (p.kind === 'court') return p.until != null ? `at court in ${p.to.name}` : `bound for court in ${p.to.name}`;
        if (p.kind === 'shadow') return p.until != null ? `lodged in ${p.to.name}` : `riding for ${p.to.name}`;
        if (p.kind === 'home') return p.until != null ? `at home in ${p.to.name}` : `riding home to ${p.to.name}`;
        if (p.kind === 'invest') return `riding to ${p.to.name} to buy land`;
        if (p.kind === 'waylay') return 'hunting you on the roads';
        return 'on the road';
    },

    /** Where the retinue is, near enough to name: the nearest town. */
    whereabouts(world, rival) {
        const u = this.retinueOf(world, rival);
        if (!u) return null;
        const town = this._nearestTown(world, u);
        const d = town ? _dist(world, u, town) : 0;
        return { q: u.q, r: u.r, near: town ? town.name : null, atTown: !!town && d === 0 };
    },

    /** Grown, unwed children of a rival head who could be matched with the player's. */
    matchableChildren(rival) {
        const C = this.config().life;
        return ((rival && rival.head && rival.head.children) || []).map((c, i) => ({ ...c, idx: i }))
            .filter(c => c.age >= C.comeOfAge && !c.wed);
    },

    _metToday(rival, world) {
        if (rival.metDay === _day(world)) return true;
        rival.metDay = _day(world);
        return false;
    },

    _check(player, world, kingdomId) {
        const rival = this.rival(player, kingdomId);
        if (!rival || !rival.head) return { error: 'No such rival House.' };
        const u = this.retinueOf(world, rival);
        if (!u || !this.meetable(player, world).includes(u)) return { error: `${this.headName(rival)} is not here.` };
        return { rival, unit: u };
    },

    parleyChance(player, rival, world = null) {
        const P = this.config().meet.parley;
        let c = P.base + P.perCharisma * _num(player.charisma, 5) + P.perFeud * _num(rival.feud) + (this.has(rival.head, 'proud') ? P.proud : 0);
        // What they remember of you, the head's own good sense, and the day they are having
        c += this.memoryScore(rival, world) / 250 + (_num(rival.head && rival.head.diplomacy, 5) - 5) * 0.01;
        c += _num((MOODS[this.mood(rival, world).id] || {}).parley);
        return Math.max(0.05, Math.min(0.9, c));
    },

    giftCost(rival) {
        const G = this.config().meet.gift;
        return Math.round(G.base + G.perFeud * _num(rival.feud));
    },

    /** Talk the feud down — or, failing, make it a little worse. Once a day. */
    parley(player, world, kingdomId) {
        const got = this._check(player, world, kingdomId);
        if (got.error) return { success: false, reason: got.error };
        const { rival } = got;
        if (this._metToday(rival, world)) return { success: false, reason: `${this.headName(rival)} has said all they will today.` };
        const P = this.config().meet.parley;
        const ok = Utils.random() < this.parleyChance(player, rival, world);
        House.accrueRivalFeud(player, world, kingdomId, ok ? P.feud : P.failFeud, ok ? null : 'a parley gone sour');
        this._note(rival, world, ok ? 'Parleyed with you, and was mollified.' : 'Parleyed with you, and left angrier.');
        this.remember(rival, world, ok ? 'parleyOk' : 'parleyFail');
        return { success: true, ok, feud: rival.feud, text: ok
            ? `${this.headName(rival)} hears you out and unbends a little: feud ${P.feud}.`
            : `${this.headName(rival)} takes your words as an insult: feud +${P.failFeud}.` };
    },

    /** A gift to the rival's purse: the feud cools. */
    gift(player, world, kingdomId) {
        const got = this._check(player, world, kingdomId);
        if (got.error) return { success: false, reason: got.error };
        const { rival } = got;
        const cost = this.giftCost(rival);
        if (_num(player.gold) < cost) return { success: false, reason: `A fitting gift costs ${cost} gold.` };
        player.gold -= cost;
        rival.gold += cost;
        const G = this.config().meet.gift;
        // A second gift within the month buys less: they begin to wonder what you want
        const again = this.recalls(rival, world, 'gift', 30);
        const cool = again ? Math.round(G.feud / 2) : G.feud;
        House.accrueRivalFeud(player, world, kingdomId, cool);
        this._note(rival, world, `Took a gift of ${cost} gold from you.`);
        this.remember(rival, world, 'gift', `${cost}g`);
        return { success: true, cost, again, feud: rival.feud, cooled: cool, text: `${this.headName(rival)} accepts ${cost} gold${again ? ', warily' : ' with a stiff bow'}: feud ${cool}.` };
    },

    /** An insult to the lord's face: renown with the crowd, and a hotter feud. */
    insult(player, world, kingdomId) {
        const got = this._check(player, world, kingdomId);
        if (got.error) return { success: false, reason: got.error };
        const { rival } = got;
        if (this._metToday(rival, world)) return { success: false, reason: `${this.headName(rival)} has turned their back on you for today.` };
        const I = this.config().meet.insult;
        const add = this.has(rival.head, 'proud') ? I.proudFeud : I.feud;
        const before = this.recalls(rival, world, 'insult', 120);
        House.accrueRivalFeud(player, world, kingdomId, add, 'an insult to their face');
        player.renown = _num(player.renown) + I.renown;
        this._note(rival, world, 'Was insulted by you in public.', 'insulted');
        this.remember(rival, world, 'insult');
        this._fulfilAsks(player, world, kingdomId, 'insult');
        if (before) rival.lastInsultRepeat = _day(world);
        return { success: true, feud: rival.feud, text: `You mock ${this.headName(rival)} before the crowd: +${I.renown} renown, feud +${add}.` };
    },

    /**
     * Wed one of the player's grown children to one of the rival head's: a
     * dowry, a marriage into the rival's realm (Heirs.marryForAlliance), and
     * most of the feud forgotten.
     */
    proposeMatch(player, world, kingdomId, childId, rivalChildIdx, opts = {}) {
        const got = this._check(player, world, kingdomId);
        if (got.error) return { success: false, reason: got.error };
        const { rival } = got;
        const M = this.config().meet.match;
        if (_num(rival.feud) > M.maxFeud) return { success: false, reason: `${this.headName(rival)} will not hear of it while the feud runs so hot (${Math.round(rival.feud)}; at most ${M.maxFeud}).` };
        const rc = this.matchableChildren(rival).find(c => c.idx === rivalChildIdx);
        if (!rc) return { success: false, reason: 'They have no grown child unwed by that name.' };
        const res = Heirs.marryForAlliance(player, world, childId, kingdomId, { dowry: opts.dowry != null ? opts.dowry : M.dowry, minReputation: -1000, deed: 'child_wed' });
        if (!res.success) return res;
        const up = res.child.upbringing;
        up.spouse.name = `${rc.firstName} ${this.surname(rival)}`;
        up.spouse.rivalHouse = rival.name;
        rival.head.children[rivalChildIdx].wed = res.child.firstName;
        House.accrueRivalFeud(player, world, kingdomId, M.feud);
        if (player.house) House.award(player.house, M.prestige, `${res.child.firstName} weds into ${rival.name}`, _day(world));
        this._note(rival, world, `${rc.firstName} wed your ${res.child.firstName}.`, 'wedding');
        this.remember(rival, world, 'match', res.child.firstName);
        return { ...res, text: `${res.child.firstName} will wed ${rc.firstName} ${this.surname(rival)}. The two Houses are bound: feud ${M.feud}.` };
    },

    /**
     * The player fell on a rival's retinue (PlayerMilitary.attackUnit). Won:
     * a share of the purse is taken, the head may fall in the fight, the
     * feud flares and the rival's realm is outraged; the retinue regathers at
     * the seat next day. Lost: the feud flares a little. → text or null.
     */
    onAttacked(player, world, unit, won) {
        const rival = this.rivalOfUnit(player, unit);
        if (!rival) return null;
        const A = this.config().attack;
        const name = this.headName(rival);
        // They came for you (waylaying): a fight in your own defence costs no honour
        if (unit.hostile && rival.plan && rival.plan.kind === 'waylay') {
            if (!won) {
                this._endWaylay(player, world, rival, unit, 'won', { notices: [] });
                return null;
            }
            const spoils = Math.round(_num(rival.gold) * A.lootShare);
            rival.gold -= spoils;
            player.gold = _num(player.gold) + spoils;
            this._endWaylay(player, world, rival, unit, 'beaten', { notices: [] });
            let text = `You beat off ${name}'s ambush and take ${spoils} gold from their coffers. They struck first: no honour lost.`;
            // What their fallen and fleeing left on the field
            const took = this._armsToPlayer(player, rival.armsDropped);
            delete rival.armsDropped;
            if (Object.keys(took).length) text += ` Their men left ${PlayerInventory.describe(took)} on the field: yours now.`;
            if (Utils.random() < A.slayChance) {
                this._succeed(world, rival, { notices: [] }, player);
                text += ` ${name} falls in the fight; the new head swears vengeance.`;
            }
            return text;
        }
        this._fulfilAsks(player, world, rival.kingdomId, 'attack');
        if (!won) {
            this.remember(rival, world, 'repelled');
            House.accrueRivalFeud(player, world, rival.kingdomId, A.failFeud, 'an attack on their retinue');
            this._note(rival, world, 'Beat off your attack on the road.');
            return `${name}'s men beat you off. Feud +${A.failFeud}.`;
        }
        const loot = Math.round(_num(rival.gold) * A.lootShare);
        rival.gold -= loot;
        player.gold = _num(player.gold) + loot;
        House.accrueRivalFeud(player, world, rival.kingdomId, A.feud, 'an attack on their retinue');
        if (!player.reputation) player.reputation = {};
        player.reputation[rival.kingdomId] = _num(player.reputation[rival.kingdomId]) - A.reputation;
        player.karma = _num(player.karma) - A.karma;
        rival.plan = null;
        this._note(rival, world, 'Was set upon by you on the road.', 'attacked');
        this.remember(rival, world, 'attacked');
        let text = `You scatter ${name}'s retinue and take ${loot} gold from their coffers. Feud +${A.feud}, −${A.reputation} reputation with their realm.`;
        // ...and some of the arms they dropped as they ran (data/arms.json rivals.lostShare)
        const took = this._armsToPlayer(player, this._loseArms(rival, _num(this.armsConfig().lostShare, 0.3)));
        if (Object.keys(took).length) text += ` They leave ${PlayerInventory.describe(took)} on the road.`;
        const hired = this._hireGuards(world, rival);
        if (hired) {
            unit.strength = this.strength(rival);
            text += ` They will ride with ${hired} more guards from now on.`;
        }
        if (Utils.random() < A.slayChance) {
            const out = { notices: [] };
            this._succeed(world, rival, out, player);
            rival.feud = Math.min(100, _num(rival.feud) + A.slainFeud);
            text += ` ${name} falls in the fight; the new head swears vengeance.`;
        }
        return text;
    },

    /** Everything the panels show about one rival. */
    view(player, world, rival) {
        if (!rival || !rival.head) return null;
        const C = this.config();
        const h = rival.head;
        const S = C.standing;
        const amb = rival.ambition ? C.ambitions[rival.ambition.id] : null;
        const prog = this.ambitionProgress(world, rival);
        const favour = (rival.favouriteOf || []).map(kid => { const k = Estates.kingdom(world, kid); return k ? k.name : null; }).filter(Boolean);
        const ties = this.rivals(player).filter(r => r !== rival).map(r => ({ name: r.name, tie: Math.round(this.tie(rival, r)) }));
        const lands = this.estates(world, rival);
        return {
            ambition: amb ? { name: amb.name, icon: amb.icon, have: prog.have, target: prog.target, id: rival.ambition.id } : null,
            renown: Math.round(_num(rival.renown)), favourite: favour, hunting: !!(rival.plan && rival.plan.kind === 'waylay'),
            allies: ties.filter(t => t.tie >= _num(C.ties.allyAt, 50)).map(t => t.name), enemies: ties.filter(t => t.tie <= _num(C.ties.enemyAt, -50)).map(t => t.name), guards: _num(rival.guard), strength: this.strength(rival),
            arms: this.armsLabel(rival), armed: this.armsFactor(rival), kit: this.kitView(rival),
            estates: lands.map(e => e.name), landValue: Math.round(this.landValue(world, rival)),
            kingdomId: rival.kingdomId, house: rival.name, name: this.headName(rival), age: h.age, gender: h.gender,
            traits: (h.traits || []).map(t => C.traits[t]).filter(Boolean),
            skills: { diplomacy: h.diplomacy, stewardship: h.stewardship, intrigue: h.intrigue, martial: _num(h.martial, 5) },
            spouse: h.spouse ? h.spouse.firstName : null,
            children: h.children.map(c => ({ name: c.firstName, age: c.age, gender: c.gender, wed: c.wed || null })),
            wealth: this.wealthLabel(_num(rival.gold) + this.landValue(world, rival)), feud: Math.round(_num(rival.feud)), doing: this.doing(world, rival),
            where: this.whereabouts(world, rival), seat: rival.seat ? rival.seat.name : null,
            heads: _num(rival.stats && rival.stats.heads, 1), log: (rival.log || []).slice(-5).reverse(),
            parleyChance: Math.round(this.parleyChance(player, rival) * 100), giftCost: this.giftCost(rival),
        };
    },
};
