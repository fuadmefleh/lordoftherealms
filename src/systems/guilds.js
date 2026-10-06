// ============================================
// TOWN GUILDS — craft and merchant guilds in the settlement economy
// ============================================
// Every town keeps one goods store (world/settlementMarket.js) worked by its
// own trades (data/markets.json recipes). The people who work those trades
// band together: a Bakers' Guild where the town bakes, Brewers, Smiths,
// Weavers, Jewellers... and a Merchants' Guild in the great towns
// (data/guilds.json). A guild lives on its settlement
// (settlement.guilds[id], saved with the tile): a guildhall treasury fed by
// its members' dues, a named guildmaster, standing with the crown,
// prosperity, the squeeze it feels, and perhaps a royal charter.
//
// Market powers, read in the trade path (player/playerEconomy/trading.js):
//   - an OUTSIDER TOLL on its goods sold in town by non-members (paid into
//     the guildhall), and a weekly SALE CAP on how much of them an outsider
//     may sell there;
//   - a PRICE FLOOR: its goods never go on the stalls below floor × their
//     base ask, glut or no glut;
//   - QUALITY: a master's goods carry the guild's mark and fetch a premium;
//   - GUILD RATES on its inputs for journeymen and up.
// Precedence on one good in one town (one rule, everywhere):
//   a monopoly (settlement.monopolies — one slot per good: the crown's by
//   edict, a merchant house's, the player's company's, or a guild's
//   charter)  >  the guild's own privileges (toll, cap, floor)  >  the
//   open market. Whoever holds the monopoly sets every guild's privileges
//   on that good aside, save the holding guild's own; a charter already in
//   the slot stands, and a later crown edict fills only empty slots
//   (Kingship.syncCrownMonopolies); a guild lobbies only for an empty one.
// A guild-held monopoly bars outsiders outright (Trading.monopolyBlock) but
// lets its journeymen and masters trade.
//
// The player climbs a ladder in each guild — apprentice → journeyman →
// master (a masterpiece of the guild's goods, a commerce skill, standing
// from trading its goods in its town) → guildmaster (elected) — paying fees
// and weekly dues for the benefits above, guild contracts, guild loans that
// count on the player's credit (systems/finance.js), votes in its elections,
// protection for the player's works of its craft (systems/merchantPrince.js
// reads worksShield) and its guild-only works.
//
// Politics: guilds lobby the crown for charters and monopolies (an NPC crown
// decides by a hash roll; the realm the player rules gets a petition), strike
// when bread, taxes, war levies or competition squeeze them (their trades in
// town halt — settlement.market.idle, read by SettlementMarket — and the
// market runs short), feud with the player's works and company when they
// undercut it, and can be chartered or abolished by the ruler. They form,
// grow and dissolve with their town's industry.
//
// No RNG: every roll is a hash of the day and the guild (Utils.hashStr). The
// thieves' guild is systems/underworld.js — a different kind of guild.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Economy } from '../world/economy.js';
import { Throne } from './throne.js';
import { Finance } from './finance.js';
import { Councils } from './councils.js';
import { Petitions } from './petitions.js';
import { Taxation } from './marketDynamics.js';
import { Trading } from '../player/playerEconomy.js';
import { PriceKnowledge } from './priceKnowledge.js';
import { Ledger } from './ledger.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _round2 = (v) => Math.round(v * 100) / 100;
const _day = (world) => _num(world && world.day);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const LOG_CAP = 40;
const HISTORY_CAP = 40;
const RANK = { apprentice: 0, journeyman: 1, master: 2, guildmaster: 3 };

/** A deterministic draw in [0, 1) for `key` (no RNG stream is touched). */
function _roll(key) {
    return ((Utils.hashStr(String(key)) >>> 0) % 100000) / 100000;
}

function _merge(base, over) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
        if (k.startsWith('_')) continue;
        out[k] = _obj(v) && _obj(base[k]) ? _merge(base[k], v) : v;
    }
    return out;
}

const DEFAULT_CONFIG = {
    tickDays: 7, minType: 'town', membersPerRun: 3, dues: 0.5, treasuryWeeks: 30, declineChecks: 2, startTreasuryWeeks: 4,
    toll: { base: 0.12, chartered: 0.2, chartersEdictMult: 0.5, apprenticeMult: 0.5 },
    outsiderCap: { needDays: 5, min: 8 },
    floor: { base: 0.8, chartered: 0.9 },
    premium: 0.08, inputDiscount: 0.06,
    squeeze: {
        decay: 0.5, strikeAt: 1.2, weeks: 2, strikeChance: 0.5, days: [10, 18], strikeCost: 1, cooldown: 90,
        war: 0.25, crisis: 0.4, heavyTax: 0.35, crownMonopoly: 0.7, rivalMonopoly: 0.5,
        glut: 0.45, glutBelow: 0.75, inputDear: 0.35, inputDearAbove: 1.6, breadDear: 0.3, breadDearAbove: 1.5,
        playerWorks: 0.25, outsiderFlood: 0.3, wages: 0.3, wagesAbove: 1.2,
    },
    lobby: { every: 28, minTreasury: 350, cost: 250, chance: 0.45, perStanding: 0.004, monopolyDays: 120, charterStanding: 20, purse: 200, factionShift: 3 },
    crown: { startMax: 30, strike: -12, lobbyWin: 8, lobbyFail: -3, abolishBelow: -40, abolishChance: 0.25, charterFee: 200, abolishFaction: -8, charterFaction: 4, abolishMood: -5 },
    election: { every: 120, playerBase: 20, perContract: 4, npcBase: 40, npcSpread: 60, backedBonus: 20 },
    feud: { perWorks: 8, perOutsiderFlood: 6, companyMonopoly: 15, strikebreak: 6, sabotageAt: 50, sabotage: [0.08, 0.2], decay: 4 },
    contracts: { maxOpen: 2, days: [14, 28], needDays: 6, maxQty: 40, minQty: 6, valueShare: 0.85, standing: 10, failStanding: 15, failFeud: 10 },
    loans: { rate: 0.06, weeks: 8, maxShare: 0.5, missedStanding: 8, defaultAfter: 3 },
    backing: { master: 15, guildmaster: 30, cap: 45 },
    standing: { perGold: 0.02, maxPerTrade: 4, duesPaid: 1, missedDues: 5, expelAfter: 3, perWorksRun: 0.15 },
    works: { journeymanSeize: 0.5, masterSeize: 0.35, guildmasterSeize: 0.2, graceMult: 2 },
    stipend: { share: 0.01, max: 30 },
};

export const Guilds = {

    // ── Data ────────────────────────────────────────────────

    data() {
        return _obj(DataLoader._gamedata && DataLoader._gamedata.guilds) || {};
    },

    config() {
        const src = Guilds.data();
        if (Guilds._cfg && Guilds._cfgSrc === src) return Guilds._cfg;
        Guilds._cfgSrc = src;
        const defs = {};
        for (const [id, d] of Object.entries(_obj(src.guilds) || {})) {
            if (!_obj(d) || id.startsWith('_')) continue;
            defs[id] = {
                id, name: d.name || id, icon: d.icon || '⚒️',
                recipes: Array.isArray(d.recipes) ? d.recipes : [], goods: Array.isArray(d.goods) ? d.goods : [],
                inputs: Array.isArray(d.inputs) ? d.inputs : [], minRuns: _num(d.minRuns, 1),
                minType: d.minType || null, minPop: _num(d.minPop), masterpiece: _obj(d.masterpiece) || {},
            };
        }
        // Which guild guards which good (the first listed wins), and works which recipe
        const goodOf = {}, recipeOf = {};
        for (const d of Object.values(defs)) {
            for (const g of d.goods) if (!goodOf[g]) goodOf[g] = d.id;
            for (const r of d.recipes) if (!recipeOf[r]) recipeOf[r] = d.id;
        }
        Guilds._cfg = {
            ...(_merge(DEFAULT_CONFIG, src.config)),
            ranks: Array.isArray(src.ranks) && src.ranks.length ? src.ranks : [
                { id: 'apprentice', name: 'Apprentice', fee: 40, dues: 2, toll: 0.5 },
                { id: 'journeyman', name: 'Journeyman', fee: 120, dues: 4, minDays: 21, minStanding: 20, skill: 1, toll: 0, inputs: true, protect: true },
                { id: 'master', name: 'Master', fee: 400, dues: 8, minDays: 30, minStanding: 50, skill: 2, masterpiece: true, toll: 0, premium: true, inputs: true, loans: true, votes: true, protect: true },
                { id: 'guildmaster', name: 'Guildmaster', fee: 0, dues: 0, elected: true, toll: 0, premium: true, inputs: true, loans: true, votes: true, protect: true },
            ],
            typeFee: { town: 1, city: 1.5, capital: 2, ...(_obj(src.typeFee) || {}) },
            defs, goodOf, recipeOf,
            names: _obj(src.names) || { first: ['Hugh'], last: ['Webb'] },
        };
        return Guilds._cfg;
    },

    defs() {
        return Guilds.config().defs;
    },

    def(id) {
        return Guilds.defs()[id] || null;
    },

    ranks() {
        return Guilds.config().ranks;
    },

    rankDef(i) {
        return Guilds.ranks()[_clamp(Math.floor(_num(i)), 0, Guilds.ranks().length - 1)];
    },

    rankName(i) {
        return i >= 0 ? (Guilds.rankDef(i) || {}).name || 'Member' : 'Outsider';
    },

    goodName(id) {
        const g = Economy._goods()[String(id || '').toUpperCase()];
        return g ? g.name : String(id || '').replace(/_/g, ' ');
    },

    /** The guild that works a recipe (data/markets.json id), or null. */
    guildOfRecipe(recipeId) {
        return Guilds.config().recipeOf[recipeId] || null;
    },

    // ── A town's guilds ─────────────────────────────────────

    /** The guilds of a settlement ({ id: guild }) or null. */
    townGuilds(s) {
        const g = s && s.guilds;
        return _obj(g) && Object.keys(g).length ? g : null;
    },

    guild(s, gid) {
        const g = s && _obj(s.guilds) ? s.guilds[gid] : null;
        return _obj(g) ? g : null;
    },

    /** The town's guild that guards `goodId` (its own product), or null. */
    guardOf(s, goodId) {
        const gs = s && s.guilds;
        if (!gs) return null;
        const gid = Guilds.config().goodOf[goodId];
        const g = gid ? gs[gid] : null;
        return _obj(g) ? g : null;
    },

    /** The town's guild that buys `goodId` as an input, or null. */
    buyerOf(s, goodId) {
        const gs = s && s.guilds;
        if (!gs) return null;
        for (const gid in gs) {
            const d = Guilds.def(gid);
            if (d && d.inputs.includes(goodId)) return gs[gid];
        }
        return null;
    },

    /** Runs a day the town's own trades of this guild can work (its industry). */
    capacity(s, def) {
        if (!s || !def || !def.recipes.length) return 0;
        // (inline SettlementMarket.tradeCapacity: rank and population read once)
        const M = SettlementMarket.config();
        const rank = SettlementMarket._rank(s.type);
        const pop = _num(s.population) / 1000;
        let c = 0;
        for (const r of def.recipes) {
            const rc = M.recipeById[r];
            if (rc && rank >= rc.rank) c += rc.cap * pop;
        }
        return c;
    },

    /** Could this guild stand in this town (size, industry, not banned)? */
    eligible(s, def) {
        if (!s || !def) return false;
        const C = Guilds.config();
        const minType = def.minType || C.minType;
        if (SettlementMarket._rank(s.type) < SettlementMarket._rank(minType)) return false;
        if (def.recipes.length) return Guilds.capacity(s, def) >= def.minRuns;
        return _num(s.population) >= def.minPop;
    },

    _members(s, def) {
        const C = Guilds.config();
        if (!def.recipes.length) return Math.max(4, Math.round(_num(s.population) / 400));
        return Math.max(3, Math.round(Guilds.capacity(s, def) * C.membersPerRun));
    },

    _name(seed) {
        const N = Guilds.config().names;
        const f = N.first || ['Hugh'], l = N.last || ['Webb'];
        const h = Utils.hashStr(String(seed)) >>> 0;
        return `${f[h % f.length]} ${l[Math.floor(h / f.length) % l.length]}`;
    },

    slot(q, r) {
        const k = Math.max(1, Math.floor(_num(Guilds.config().tickDays, 7)));
        return (Math.abs(Math.floor(q)) * 3 + Math.abs(Math.floor(r)) * 5) % k;
    },

    /** Found a guild in a town (formation, or a royal charter). */
    _form(s, gid, day, opts = {}) {
        const C = Guilds.config();
        const def = Guilds.def(gid);
        if (!def) return null;
        if (!_obj(s.guilds)) s.guilds = {};
        const seed = `${s.q},${s.r}:${gid}`;
        const members = Guilds._members(s, def);
        const g = {
            id: gid, name: `${def.name} of ${s.name || 'the town'}`, founded: day,
            master: { name: Guilds._name(`${seed}:m0`), player: false },
            // (one founded by a ruler's charter starts with an empty hall — no charter/abolish money loop)
            members, treasury: opts.chartered ? 0 : Math.round(members * C.dues * C.startTreasuryWeeks),
            crown: Math.round(_roll(`${seed}:crown`) * _num(C.crown.startMax, 30)),
            prosperity: 1, squeeze: 0, squeezeWeeks: 0, strike: null, lastStrike: null, chartered: !!opts.chartered,
            feud: 0, low: 0, week: { outsider: {}, toll: 0 }, toll: 0,
            nextElection: day + 30 + Math.floor(_roll(`${seed}:elect`) * C.election.every),
            nextLobby: day + 7 + Math.floor(_roll(`${seed}:lobby`) * C.lobby.every),
            candidates: null,
        };
        s.guilds[gid] = g;
        Guilds._refreshToll(null, null, s, g);
        return g;
    },

    _dissolve(world, player, s, gid, why, out = null) {
        const g = Guilds.guild(s, gid);
        if (!g) return;
        Guilds._endStrike(s, g);
        // ...and its monopoly lapses
        const def = Guilds.def(gid);
        if (s.monopolies) {
            for (const good of (def && def.goods) || []) {
                const m = s.monopolies[good];
                if (m && m.holder === 'guild' && (!m.guildId || m.guildId === gid)) delete s.monopolies[good];
            }
            if (!Object.keys(s.monopolies).length) delete s.monopolies;
        }
        delete s.guilds[gid];
        if (!Object.keys(s.guilds).length) delete s.guilds;
        if (player) {
            const st = Guilds.state(player);
            const key = Guilds._key(s, gid);
            if (st.memberships[key]) {
                delete st.memberships[key];
                Guilds._log(st, world, `The ${g.name} is no more (${why}); your membership ends with it.`);
                if (out) out.notices.push({ icon: '🏚️', title: 'Guild Dissolved', text: `The ${g.name} is no more: ${why}.`, type: 'warning' });
            }
            st.contracts = st.contracts.filter(c => c.key !== key);
        }
    },

    /**
     * Form the guilds the town's industry supports and dissolve the ones it
     * no longer does (after declineChecks monthly checks). Returns the town's guilds.
     */
    ensureTown(world, s, day = null, player = null, out = null) {
        if (!s || !Number.isFinite(s.q)) return null;
        const C = Guilds.config();
        const d = day != null ? day : _day(world);
        const bans = _obj(s.guildBans) || {};
        for (const def of Object.values(C.defs)) {
            const g = Guilds.guild(s, def.id);
            const ok = Guilds.eligible(s, def);
            if (!g) {
                if (ok && bans[def.id] == null) Guilds._form(s, def.id, d);
                continue;
            }
            // Rise and decline with the town's industry
            const half = def.recipes.length ? Guilds.capacity(s, def) >= def.minRuns * 0.5 : _num(s.population) >= def.minPop * 0.5;
            if (ok || half) g.low = 0;
            else g.low = _num(g.low) + 1;
            if (g.low >= C.declineChecks || SettlementMarket._rank(s.type) < SettlementMarket._rank(def.minType || C.minType)) {
                Guilds._dissolve(world, player, s, def.id, `${s.name || 'the town'} no longer has the trade to keep it`, out);
            } else g.members = Guilds._members(s, def);
        }
        return Guilds.townGuilds(s);
    },

    // ── Market powers (read by player/playerEconomy/trading.js) ──

    _court(player) {
        return player && player.throne && player.throne.ruling && player.throne.ruling.court;
    },

    /** The toll share an outsider pays, cached on the guild at its weekly turn (and on a charter). */
    _refreshToll(player, world, s, g) {
        const T = Guilds.config().toll;
        let t = g.chartered ? _num(T.chartered) : _num(T.base);
        // The realm the player rules enforces Merchant charters: the guilds may toll less
        const k = player && world && player.throne && player.throne.ruling ? Throne.ruledKingdom(player, world) : null;
        const court = Guilds._court(player);
        if (k && s.kingdom === k.id && court && court.edicts && court.edicts.merchant_charters) t *= _num(T.chartersEdictMult, 0.5);
        g.toll = _round2(_clamp(t, 0, 0.6));
        return g.toll;
    },

    /** The player's membership key for a guild of a town. */
    _key(s, gid) {
        return `${s.q},${s.r}:${gid}`;
    },

    /** The player's membership in a town's guild, or null. */
    membership(player, s, gid) {
        const st = player && _obj(player.guilds);
        if (!st || !_obj(st.memberships) || !s) return null;
        return st.memberships[Guilds._key(s, gid)] || null;
    },

    /** The player's rank in a town's guild: -1 outsider, 0 apprentice … 3 guildmaster. */
    rankOf(player, s, gid) {
        const m = Guilds.membership(player, s, gid);
        return m ? _clamp(Math.floor(_num(m.rank)), 0, 3) : -1;
    },

    /**
     * Does a monopoly on `goodId` here set the guild's privileges aside? Any
     * monopoly but the guild's own does (a crown's, a house's, the player's
     * company's) — the precedence rule.
     */
    _monopolyOver(s, goodId, gid) {
        const m = s && s.monopolies && s.monopolies[goodId];
        if (!m) return false;
        return !(m.holder === 'guild' && (!m.guildId || m.guildId === gid));
    },

    /** Is the player free of a guild-held monopoly on this good here (journeyman and up)? */
    monopolyMember(player, s, goodId) {
        const m = s && s.monopolies && s.monopolies[goodId];
        if (!m || m.holder !== 'guild' || !m.guildId) return false;
        return Guilds.rankOf(player, s, m.guildId) >= RANK.journeyman;
    },

    /**
     * Factor on what the town pays the player for `goodId`: an outsider pays
     * the guild's toll (an apprentice half), a master's goods carry its
     * mark (+premium). 1 where no guild guards the good, or another
     * monopoly sets its privileges aside.
     */
    saleFactor(player, s, goodId) {
        const g = Guilds.guardOf(s, goodId);
        if (!g || Guilds._monopolyOver(s, goodId, g.id)) return 1;
        const rank = Guilds.rankOf(player, s, g.id);
        const rd = rank >= 0 ? Guilds.rankDef(rank) : null;
        if (rd && rd.premium) return 1 + _num(Guilds.config().premium);
        const share = rd ? _num(rd.toll, 0) : 1;
        return 1 - _num(g.toll) * share;
    },

    /** The toll share the player pays on `goodId` here (0 when none). */
    tollRate(player, s, goodId) {
        const f = Guilds.saleFactor(player, s, goodId);
        return f < 1 ? _round2(1 - f) : 0;
    },

    /** The scarcity floor the guild holds on the stalls' ask for `goodId` here (0 = none). */
    askFloor(s, goodId) {
        const g = Guilds.guardOf(s, goodId);
        if (!g || Guilds._monopolyOver(s, goodId, g.id)) return 0;
        const F = Guilds.config().floor;
        return g.chartered ? _num(F.chartered) : _num(F.base);
    },

    /** Discount (fraction) a journeyman or better gets on the guild's inputs here. */
    inputDiscount(player, s, goodId) {
        const gs = s && s.guilds;
        if (!gs || !player) return 0;
        for (const gid in gs) {
            const d = Guilds.def(gid);
            if (!d || !d.inputs.includes(goodId)) continue;
            const rank = Guilds.rankOf(player, s, gid);
            if (rank >= 0 && Guilds.rankDef(rank).inputs) return _num(Guilds.config().inputDiscount);
        }
        return 0;
    },

    /** Units of `goodId` an outsider may still sell here this week (Infinity: no cap). */
    outsiderRoom(player, s, goodId) {
        const g = Guilds.guardOf(s, goodId);
        if (!g || Guilds._monopolyOver(s, goodId, g.id) || Guilds.rankOf(player, s, g.id) >= 0) return Infinity;
        const O = Guilds.config().outsiderCap;
        const cap = Math.max(_num(O.min, 8), Math.floor(SettlementMarket.need(s, goodId) * _num(O.needDays, 5)));
        const used = _num(g.week && g.week.outsider && g.week.outsider[goodId]);
        return Math.max(0, cap - used);
    },

    /** Why the guild won't let the player sell `qty` of `goodId` here, or null. */
    saleCheck(player, s, goodId, qty) {
        const room = Guilds.outsiderRoom(player, s, goodId);
        if (room >= qty) return null;
        const g = Guilds.guardOf(s, goodId);
        return room > 0
            ? `The ${g.name} lets an outsider sell only ${room} more ${Guilds.goodName(goodId).toLowerCase()} here this week. Join the guild, or try again next week.`
            : `The ${g.name} lets no more ${Guilds.goodName(goodId).toLowerCase()} from outsiders onto the stalls this week.`;
    },

    /**
     * A sale went through (Trading.sellGoods): the toll the player paid goes
     * to the guildhall, the outsider's units are counted against the week's
     * cap, a member's standing grows with the trade.
     */
    onSale(player, s, goodId, qty, earned) {
        if (!s || !s.guilds || !(qty > 0)) return;
        const g = Guilds.guardOf(s, goodId);
        if (g && !Guilds._monopolyOver(s, goodId, g.id)) {
            const st = Guilds.state(player);
            const f = Guilds.saleFactor(player, s, goodId);
            if (!g.week || typeof g.week !== 'object') g.week = { outsider: {}, toll: 0 };
            if (Guilds.rankOf(player, s, g.id) < 0) {
                if (!_obj(g.week.outsider)) g.week.outsider = {};
                g.week.outsider[goodId] = _num(g.week.outsider[goodId]) + qty;
            }
            if (f < 1 && earned > 0) {
                const toll = Math.round(earned * (1 - f) / f);
                // Paid inside the sale price: a memo line in the player's ledger
                Ledger.record(player, 'guildTolls', -toll);
                g.treasury = _num(g.treasury) + toll;
                g.week.toll = _num(g.week.toll) + toll;
                st.stats.tolls += toll;
            } else if (f > 1 && earned > 0) {
                st.stats.premium += Math.round(earned * (f - 1) / f);
            }
        }
        Guilds._tradeStanding(player, s, goodId, earned);
    },

    /** A purchase went through (Trading.buyGoods): members' standing grows with trade in the guild's goods. */
    onBuy(player, s, goodId, qty, spent) {
        if (!s || !s.guilds || !(qty > 0)) return;
        Guilds._tradeStanding(player, s, goodId, spent);
    },

    _tradeStanding(player, s, goodId, gold) {
        const st = player && _obj(player.guilds);
        if (!st || !(gold > 0)) return;
        const S = Guilds.config().standing;
        for (const gid in s.guilds) {
            const d = Guilds.def(gid);
            if (!d || !(d.goods.includes(goodId) || d.inputs.includes(goodId))) continue;
            const m = Guilds.membership(player, s, gid);
            if (!m) continue;
            m.standing = _round2(Math.min(100, _num(m.standing) + Math.min(_num(S.maxPerTrade, 4), gold * _num(S.perGold))));
            m.traded = Math.round(_num(m.traded) + gold);
        }
    },

    // ── Works (systems/merchantPrince.js) ─────────────────

    /**
     * How the guild of a works' craft shields the player's works here:
     * { seizeMult, graceMult } — journeymen and up are guild men, and the
     * crown thinks twice before taking a guild man's mill.
     */
    worksShield(player, s, recipeId) {
        const gid = Guilds.guildOfRecipe(recipeId);
        const rank = gid ? Guilds.rankOf(player, s, gid) : -1;
        const W = Guilds.config().works;
        if (rank < 1 || !Guilds.guild(s, gid)) return { seizeMult: 1, graceMult: 1 };
        const m = rank >= 3 ? W.guildmasterSeize : rank >= 2 ? W.masterSeize : W.journeymanSeize;
        return { seizeMult: _num(m, 1), graceMult: _num(W.graceMult, 1) };
    },

    /** Why the player may not fund guild-only works here (kind.guild / kind.guildRank), or null. */
    guildOnlyBlock(player, s, kind) {
        if (!kind || !kind.guild) return null;
        const def = Guilds.def(kind.guild);
        const need = _num(kind.guildRank, RANK.master);
        if (!Guilds.guild(s, kind.guild)) return `Only the ${def ? def.name : 'guild'} may build that, and there is none in ${s.name}.`;
        if (Guilds.rankOf(player, s, kind.guild) < need) return `Only a ${Guilds.rankName(need).toLowerCase()} of the ${def ? def.name : 'guild'} may build that here.`;
        return null;
    },

    // ── The player's record ─────────────────────────────────

    _blank() {
        return {
            memberships: {}, contracts: [], loans: [], history: [], log: [], nextId: 1, backing: 0, lastDay: null,
            stats: { joined: 0, fees: 0, dues: 0, tolls: 0, premium: 0, contractsDone: 0, contractsFailed: 0, contractIncome: 0, loans: 0, loanInterest: 0, stipends: 0, elections: 0, masterpieces: 0, bestRank: -1, expelled: 0, sabotaged: 0 },
        };
    },

    state(player) {
        if (!player) return Guilds._blank();
        let st = player.guilds;
        if (!_obj(st)) st = player.guilds = Guilds._blank();
        const blank = Guilds._blank();
        if (!_obj(st.memberships)) st.memberships = {};
        for (const k of ['contracts', 'loans', 'history', 'log']) if (!Array.isArray(st[k])) st[k] = [];
        if (!(st.nextId > 0)) st.nextId = 1;
        if (!(st.backing >= 0)) st.backing = 0;
        if (st.lastDay === undefined) st.lastDay = null;
        st.stats = { ...blank.stats, ...(_obj(st.stats) || {}) };
        for (const m of Object.values(st.memberships)) {
            if (!(m.standing >= 0)) m.standing = 0;
            if (!(m.unpaid >= 0)) m.unpaid = 0;
            if (!(m.contracts >= 0)) m.contracts = 0;
            if (!(m.traded >= 0)) m.traded = 0;
        }
        return st;
    },

    serialize(player) {
        return player && player.guilds ? JSON.parse(JSON.stringify(player.guilds)) : null;
    },

    /** After a load: backfill (older saves have none — it stays null until the player joins a guild). */
    loadState(player) {
        if (player && player.guilds) Guilds.state(player);
        else if (player) player.guilds = null;
    },

    _log(st, world, text) {
        st.log.push({ day: _day(world), text });
        if (st.log.length > LOG_CAP) st.log.splice(0, st.log.length - LOG_CAP);
    },

    /** A record for the heralds and chatter ({ key, kind, day, ... }; systems/heralds.js reads it). */
    record(player, world, entry) {
        if (!player) return null;
        const st = Guilds.state(player);
        if (st.history.some(h => h.key === entry.key)) return null;
        const h = { day: _day(world), ...entry };
        st.history.push(h);
        if (st.history.length > HISTORY_CAP) st.history.splice(0, st.history.length - HISTORY_CAP);
        return h;
    },

    _here(player, tile) {
        return !!(player && tile && player.q === tile.q && player.r === tile.r);
    },

    _fee(s, rank) {
        const C = Guilds.config();
        const rd = Guilds.rankDef(rank);
        return Math.round(_num(rd.fee) * _num(C.typeFee[s.type], 1));
    },

    _reputation(player, s) {
        return s && s.kingdom ? _num(player && player.reputation && player.reputation[s.kingdom]) : 0;
    },

    /** Join a guild as an apprentice (the player stands in its town). */
    join(player, world, tile, gid) {
        const s = tile && tile.settlement;
        const g = Guilds.guild(s, gid);
        if (!s || !g) return { success: false, reason: 'There is no such guild here.' };
        if (!Guilds._here(player, tile)) return { success: false, reason: 'You must be in the town to join its guild.' };
        if (Guilds.membership(player, s, gid)) return { success: false, reason: 'You are already a member.' };
        if (Guilds._reputation(player, s) < -10) return { success: false, reason: `The ${g.name} will not have you (reputation too low).` };
        if (_num(g.feud) >= Guilds.config().feud.sabotageAt) return { success: false, reason: `The ${g.name} is feuding with you: no guild man will vouch for you.` };
        const fee = Guilds._fee(s, 0);
        if (_num(player.gold) < fee) return { success: false, reason: `The entry fee is ${fee} gold.` };
        const st = Guilds.state(player);
        player.gold -= fee;
        Ledger.record(player, 'guildDues', -fee);
        g.treasury = _num(g.treasury) + fee;
        st.memberships[Guilds._key(s, gid)] = {
            key: Guilds._key(s, gid), q: s.q, r: s.r, town: s.name, guild: gid, rank: 0, standing: 0,
            since: _day(world), rankSince: _day(world), unpaid: 0, contracts: 0, traded: 0, candidate: false, vote: null,
        };
        st.stats.joined++;
        st.stats.fees += fee;
        st.stats.bestRank = Math.max(_num(st.stats.bestRank, -1), 0);
        Guilds._log(st, world, `Joined the ${g.name} as an apprentice (${fee}g).`);
        return { success: true, spent: fee };
    },

    /** Leave a guild (no refund). */
    leave(player, world, s, gid) {
        const st = Guilds.state(player);
        const key = Guilds._key(s, gid);
        const m = st.memberships[key];
        if (!m) return { success: false, reason: 'You are not a member.' };
        if (st.loans.some(l => l.key === key)) return { success: false, reason: 'Repay the guild\'s loan before you leave.' };
        delete st.memberships[key];
        const g = Guilds.guild(s, gid);
        if (g && g.master && g.master.player) g.master = { name: Guilds._name(`${key}:m${_day(world)}`), player: false };
        st.contracts = st.contracts.filter(c => c.key !== key);
        Guilds._log(st, world, `Left the ${g ? g.name : 'guild'}.`);
        return { success: true };
    },

    /**
     * What it takes to rise to the next rank: { ok, reason, rank, fee,
     * goods, needs: [{ label, met }] }. Guildmaster is won by election.
     */
    advanceQuote(player, world, tile, gid) {
        const s = tile && tile.settlement;
        const g = Guilds.guild(s, gid);
        const m = Guilds.membership(player, s, gid);
        const out = { ok: false, reason: '', needs: [], goods: {}, fee: 0, rank: m ? m.rank + 1 : 0 };
        if (!g) return { ...out, reason: 'There is no such guild here.' };
        if (!m) return { ...out, reason: 'Join the guild first.' };
        const next = m.rank + 1;
        const rd = Guilds.ranks()[next];
        if (!rd) return { ...out, reason: 'You stand at the head of the guild.' };
        if (rd.elected) return { ...out, rank: next, reason: 'The guildmaster is elected by the masters: stand at the next election.' };
        const day = _day(world);
        const fee = Guilds._fee(s, next);
        const goods = rd.masterpiece ? { ...(Guilds.def(gid).masterpiece || {}) } : {};
        const needs = [
            { label: `${_num(rd.minDays)} days as ${Guilds.rankName(m.rank).toLowerCase()} (${day - _num(m.rankSince)})`, met: day - _num(m.rankSince) >= _num(rd.minDays) },
            { label: `standing ${_num(rd.minStanding)} (${Math.floor(m.standing)})`, met: m.standing >= _num(rd.minStanding) },
            { label: `commerce ${_num(rd.skill)} (${Math.floor(_num(player.skills && player.skills.commerce))})`, met: _num(player.skills && player.skills.commerce) >= _num(rd.skill) },
            { label: `${fee} gold`, met: _num(player.gold) >= fee },
        ];
        for (const [id, n] of Object.entries(goods)) {
            needs.push({ label: `masterpiece: ${n} ${Guilds.goodName(id).toLowerCase()} (${Math.floor(_num(player.inventory && player.inventory[id]))})`, met: _num(player.inventory && player.inventory[id]) >= n });
        }
        const missing = needs.find(n => !n.met);
        return { ...out, rank: next, fee, goods, needs, ok: !missing, reason: missing ? `You need ${missing.label}.` : '' };
    },

    /** Rise a rank (a master's masterpiece goes to the town's market). */
    advance(player, world, tile, gid) {
        if (!Guilds._here(player, tile)) return { success: false, reason: 'You must be in the guild\'s town.' };
        const q = Guilds.advanceQuote(player, world, tile, gid);
        if (!q.ok) return { success: false, reason: q.reason };
        const s = tile.settlement;
        const g = Guilds.guild(s, gid);
        const m = Guilds.membership(player, s, gid);
        const st = Guilds.state(player);
        player.gold -= q.fee;
        Ledger.record(player, 'guildDues', -q.fee);
        g.treasury = _num(g.treasury) + q.fee;
        for (const [id, n] of Object.entries(q.goods)) {
            player.inventory[id] -= n;
            if (player.inventory[id] <= 0) delete player.inventory[id];
            SettlementMarket.add(s, id, n);
        }
        m.rank = q.rank;
        m.rankSince = _day(world);
        st.stats.fees += q.fee;
        if (Object.keys(q.goods).length) st.stats.masterpieces++;
        st.stats.bestRank = Math.max(_num(st.stats.bestRank, -1), m.rank);
        Guilds._log(st, world, `Made ${Guilds.rankName(m.rank).toLowerCase()} of the ${g.name}${Object.keys(q.goods).length ? ' on your masterpiece' : ''} (${q.fee}g).`);
        return { success: true, spent: q.fee, rank: m.rank };
    },

    /** Stand (or not) at the guild's next election (masters only). */
    stand(player, world, s, gid, on = true) {
        const m = Guilds.membership(player, s, gid);
        if (!m) return { success: false, reason: 'You are not a member.' };
        if (m.rank < RANK.master) return { success: false, reason: 'Only masters may stand for guildmaster.' };
        m.candidate = !!on;
        return { success: true };
    },

    /** Cast a master's vote for the sitting guildmaster ('incumbent') or the challenger. */
    vote(player, world, s, gid, side) {
        const m = Guilds.membership(player, s, gid);
        if (!m) return { success: false, reason: 'You are not a member.' };
        if (!Guilds.rankDef(m.rank).votes) return { success: false, reason: 'Only masters vote in the guild\'s elections.' };
        m.vote = side === 'challenger' ? 'challenger' : side === 'incumbent' ? 'incumbent' : null;
        return { success: true };
    },

    /** The election's two names: the sitting guildmaster and a challenger. */
    candidates(s, g) {
        const key = Guilds._key(s, g.id);
        const challenger = Guilds._name(`${key}:c${_num(g.nextElection)}`);
        return { incumbent: g.master ? g.master.name : '—', challenger };
    },

    // ── Contracts ─────────────────────────────────────────

    /**
     * What the guild will pay for a delivery of one of its inputs (the town
     * is short of them): [{ good, qty, unit, days }]. Priced below what the
     * goods are worth here and below buying them back at guild rates.
     */
    contractOffers(player, world, s, gid) {
        const g = Guilds.guild(s, gid);
        const def = Guilds.def(gid);
        if (!g || !def || !s.market) return [];
        const K = Guilds.config().contracts;
        const at = Economy.settlementTile(world, s);
        const out = [];
        for (const id of def.inputs) {
            if (!SettlementMarket.tracks(id) || SettlementMarket.scarcity(s, id) < 1) continue;
            const good = Economy._goods()[id.toUpperCase()];
            if (!good) continue;
            const need = SettlementMarket.refNeed(s, id);
            const qty = Math.floor(_clamp(need * _num(K.needDays, 6), _num(K.minQty, 6), _num(K.maxQty, 40)));
            const value = SettlementMarket.lotValue(world, s, at, id, good.basePrice, qty) / qty;
            // ...never more than the player would pay for a unit here, after every discount
            const disc = Math.max(0.5, 1 - Trading.buyDiscount(player, s)) * (1 - Guilds.inputDiscount(player, s, id));
            const ask = Math.floor(Economy.marketPrice(good, s, at, world) * disc);
            const unit = Math.floor(Math.min(value * _num(K.valueShare, 0.85), ask - 1));
            if (!(unit >= 1)) continue;
            const span = _num(K.days[1], 28) - _num(K.days[0], 14);
            const days = _num(K.days[0], 14) + Math.floor(_roll(`${Guilds._key(s, gid)}:${id}:${Math.floor(_day(world) / 7)}`) * (span + 1));
            out.push({ good: id, qty, unit, days, total: unit * qty });
        }
        return out;
    },

    /** Take a guild contract (the guildhall sets the money aside). */
    takeContract(player, world, tile, gid, goodId) {
        const s = tile && tile.settlement;
        const g = Guilds.guild(s, gid);
        const m = Guilds.membership(player, s, gid);
        if (!g || !m) return { success: false, reason: 'Guild contracts go to its members.' };
        const st = Guilds.state(player);
        const K = Guilds.config().contracts;
        if (st.contracts.length >= _num(K.maxOpen, 2)) return { success: false, reason: `At most ${K.maxOpen} guild contracts at once.` };
        if (st.contracts.some(c => c.key === m.key && c.good === goodId)) return { success: false, reason: 'You already hold that contract.' };
        const offer = Guilds.contractOffers(player, world, s, gid).find(o => o.good === goodId);
        if (!offer) return { success: false, reason: 'The guild wants none of that now.' };
        if (_num(g.treasury) < offer.total) return { success: false, reason: 'The guildhall cannot pay for it.' };
        g.treasury -= offer.total;
        const c = { id: st.nextId++, key: m.key, q: s.q, r: s.r, town: s.name, guild: gid, good: goodId, qty: offer.qty, delivered: 0, unit: offer.unit, escrow: offer.total, due: _day(world) + offer.days };
        st.contracts.push(c);
        Guilds._log(st, world, `Took the ${g.name}'s contract: ${c.qty} ${Guilds.goodName(goodId).toLowerCase()} by day ${c.due} at ${c.unit}g.`);
        return { success: true, contract: c };
    },

    /** Deliver from the packs (in the guild's town): paid per unit from the escrow, goods to the town's store. */
    deliverContract(player, world, contractId, qty = null) {
        const st = Guilds.state(player);
        const c = st.contracts.find(x => x.id === contractId);
        if (!c) return { success: false, reason: 'No such contract.' };
        if (player.q !== c.q || player.r !== c.r) return { success: false, reason: `Deliver it in ${c.town}.` };
        const tile = world.getTile(c.q, c.r);
        const s = tile && tile.settlement;
        const g = Guilds.guild(s, c.guild);
        const have = Math.floor(_num(player.inventory && player.inventory[c.good]));
        const n = Math.min(have, c.qty - c.delivered, qty == null ? Infinity : Math.max(0, Math.floor(qty)));
        if (!(n > 0)) return { success: false, reason: `You have no ${Guilds.goodName(c.good).toLowerCase()} to deliver.` };
        player.inventory[c.good] -= n;
        if (player.inventory[c.good] <= 0) delete player.inventory[c.good];
        SettlementMarket.add(s, c.good, n);
        const pay = n * c.unit;
        c.escrow -= pay;
        c.delivered += n;
        player.gold += pay;
        PriceKnowledge.recordSale(player, s, c.good, n, pay, 'guildContracts');
        st.stats.contractIncome += pay;
        if (c.delivered >= c.qty) {
            st.contracts = st.contracts.filter(x => x !== c);
            const m = st.memberships[c.key];
            if (m) {
                m.standing = Math.min(100, _num(m.standing) + _num(Guilds.config().contracts.standing, 10));
                m.contracts = _num(m.contracts) + 1;
            }
            if (g && c.escrow > 0) g.treasury += c.escrow;
            st.stats.contractsDone++;
            Guilds._log(st, world, `Filled the ${g ? g.name : 'guild'}'s contract for ${c.qty} ${Guilds.goodName(c.good).toLowerCase()}.`);
        }
        return { success: true, earned: pay, delivered: n };
    },

    // ── Loans ─────────────────────────────────────────────

    /** What the guildhall will lend a master here: { ok, reason, max, rate, weeks }. */
    loanQuote(player, world, s, gid) {
        const g = Guilds.guild(s, gid);
        const L = Guilds.config().loans;
        const rank = Guilds.rankOf(player, s, gid);
        const out = { ok: false, reason: '', max: 0, rate: 0, weeks: _num(L.weeks, 8) };
        if (!g || rank < 0) return { ...out, reason: 'Guild loans go to its members.' };
        if (!Guilds.rankDef(rank).loans) return { ...out, reason: 'The guild lends to its masters.' };
        const st = Guilds.state(player);
        if (st.loans.some(l => l.key === Guilds._key(s, gid))) return { ...out, reason: 'Repay the guild\'s last loan first.' };
        // Priced on the player's credit (systems/finance.js), like a bank's
        const score = Finance.creditReport(player, world).score;
        const rate = _round2(_num(L.rate) * Finance.creditFactor(score));
        const max = Math.floor(_num(g.treasury) * _num(L.maxShare, 0.5) / 50) * 50;
        if (max < 50) return { ...out, rate, reason: 'The guildhall has no coin to spare.' };
        return { ...out, ok: true, max, rate };
    },

    borrow(player, world, s, gid, amount) {
        const q = Guilds.loanQuote(player, world, s, gid);
        if (!q.ok) return { success: false, reason: q.reason };
        const a = Math.floor(_clamp(_num(amount), 0, q.max));
        if (!(a >= 50)) return { success: false, reason: 'Borrow at least 50 gold.' };
        const g = Guilds.guild(s, gid);
        const st = Guilds.state(player);
        const owed = Math.ceil(a * (1 + q.rate));
        const loan = { id: st.nextId++, key: Guilds._key(s, gid), q: s.q, r: s.r, town: s.name, guild: gid, principal: a, owed, weekly: Math.ceil(owed / q.weeks), missed: 0, day: _day(world) };
        st.loans.push(loan);
        g.treasury -= a;
        player.gold += a;
        st.stats.loans += a;
        Guilds._log(st, world, `Borrowed ${a}g from the ${g.name}: ${owed}g back over ${q.weeks} weeks.`);
        return { success: true, gold: a, loan };
    },

    repayLoan(player, world, loanId) {
        const st = Guilds.state(player);
        const loan = st.loans.find(l => l.id === loanId);
        if (!loan) return { success: false, reason: 'No such loan.' };
        if (_num(player.gold) < loan.owed) return { success: false, reason: `You owe ${loan.owed} gold.` };
        Guilds._payLoan(player, world, st, loan, loan.owed);
        return { success: true, spent: loan.owed };
    },

    _payLoan(player, world, st, loan, amount) {
        const s = Guilds._settlement(world, loan.q, loan.r);
        const g = Guilds.guild(s, loan.guild);
        player.gold -= amount;
        loan.owed -= amount;
        if (g) g.treasury = _num(g.treasury) + amount;
        st.stats.loanInterest += Math.max(0, amount - Math.max(0, loan.principal));
        loan.principal -= amount;
        if (loan.owed <= 0) {
            st.loans = st.loans.filter(l => l !== loan);
            Finance.state(player).credit.repaid++;
            Guilds._log(st, world, `Repaid the ${g ? g.name : 'guild'}'s loan.`);
        }
    },

    // ── The ruler (charters and abolitions) ───────────────

    /** May the player charter or abolish guilds in this town (it lies in the realm they rule, or they hold it)? */
    canRule(player, world, s) {
        if (!s) return false;
        const k = Throne.ruledKingdom(player, world);
        if (k && s.kingdom === k.id) return true;
        return Taxation.getPlayerSettlements(player, world).some(h => h.q === s.q && h.r === s.r);
    },

    _faction(player, amt) {
        if (!player || !amt) return;
        const f = Councils._ensureState(player).factions.merchants;
        if (f) f.support = _clamp(_num(f.support) + amt, 0, 100);
    },

    /**
     * Grant a royal charter: the guild tolls and floors harder and owes the
     * crown a fee. Founds the guild if the town has the trade but none (or it
     * was abolished).
     */
    charter(player, world, s, gid) {
        if (!Guilds.canRule(player, world, s)) return { success: false, reason: 'Only the ruler of the town may charter its guilds.' };
        const def = Guilds.def(gid);
        if (!def) return { success: false, reason: 'No such guild.' };
        let g = Guilds.guild(s, gid);
        if (g && g.chartered) return { success: false, reason: `The ${g.name} already holds a charter.` };
        const C = Guilds.config();
        if (!g) {
            const minType = def.minType || C.minType;
            if (SettlementMarket._rank(s.type) < SettlementMarket._rank(minType)) return { success: false, reason: `${s.name} is too small for a ${def.name}.` };
            if (def.recipes.length && !def.recipes.some(r => SettlementMarket.hasTrade(s, r))) return { success: false, reason: `${s.name} has no such trade.` };
            if (s.guildBans) delete s.guildBans[gid];
            g = Guilds._form(s, gid, _day(world), { chartered: true });
        }
        g.chartered = true;
        g.crown = _clamp(_num(g.crown) + 20, -100, 100);
        const fee = Math.min(Math.max(0, Math.floor(_num(g.treasury))), _num(C.crown.charterFee, 200));
        g.treasury -= fee;
        const k = s.kingdom && world.getKingdom ? world.getKingdom(s.kingdom) : null;
        if (k && Throne.ruledKingdom(player, world) === k) k.treasury = _num(k.treasury) + fee;
        else player.gold += fee;
        Guilds._refreshToll(player, world, s, g);
        Guilds._faction(player, _num(C.crown.charterFaction));
        Guilds.record(player, world, { key: `chartered:${Guilds._key(s, gid)}:${_day(world)}`, kind: 'guild_chartered', place: s.name, q: s.q, r: s.r, kingdomId: s.kingdom || null, guild: g.name, master: g.master.name, own: true });
        Guilds._log(Guilds.state(player), world, `Chartered the ${g.name} (${fee}g charter fee).`);
        return { success: true, gold: fee };
    },

    /** Break a guild by edict: its privileges, monopoly and hall go; the town grumbles; merchants sulk. */
    abolish(player, world, s, gid) {
        if (!Guilds.canRule(player, world, s)) return { success: false, reason: 'Only the ruler of the town may abolish its guilds.' };
        const g = Guilds.guild(s, gid);
        if (!g) return { success: false, reason: 'There is no such guild here.' };
        const C = Guilds.config().crown;
        const take = Math.floor(_num(g.treasury) * 0.5);
        const k = s.kingdom && world.getKingdom ? world.getKingdom(s.kingdom) : null;
        if (k && Throne.ruledKingdom(player, world) === k) k.treasury = _num(k.treasury) + take;
        else player.gold += take;
        Guilds._abolish(world, player, s, gid, 'by your edict');
        Guilds._faction(player, _num(C.abolishFaction));
        s.happiness = _clamp(_num(s.happiness, 50) + _num(C.abolishMood), 0, 100);
        return { success: true, gold: take };
    },

    _abolish(world, player, s, gid, by, out = null) {
        const g = Guilds.guild(s, gid);
        if (!g) return;
        if (!_obj(s.guildBans)) s.guildBans = {};
        s.guildBans[gid] = _day(world);
        Guilds.record(player, world, { key: `abolished:${Guilds._key(s, gid)}:${_day(world)}`, kind: 'guild_abolished', place: s.name, q: s.q, r: s.r, kingdomId: s.kingdom || null, guild: g.name, master: g.master.name, own: by === 'by your edict' });
        Guilds._dissolve(world, player, s, gid, `abolished ${by}`, out);
    },

    // ── The guildmaster's hand ────────────────────────────

    /** Call off a strike (the player is its guildmaster). */
    endStrike(player, world, s, gid) {
        const g = Guilds.guild(s, gid);
        if (!g || !g.strike) return { success: false, reason: 'The guild is not on strike.' };
        if (Guilds.rankOf(player, s, gid) < RANK.guildmaster) return { success: false, reason: 'Only the guildmaster can call the strike off.' };
        Guilds._endStrike(s, g);
        g.squeeze = 0;
        g.squeezeWeeks = 0;
        Guilds._log(Guilds.state(player), world, `Called off the ${g.name}'s strike.`);
        return { success: true };
    },

    // ── Strikes ───────────────────────────────────────────

    _startStrike(world, player, s, g, day, reason, out) {
        const C = Guilds.config();
        const S = C.squeeze;
        const span = _num(S.days[1], 18) - _num(S.days[0], 10);
        const until = day + _num(S.days[0], 10) + Math.floor(_roll(`strikeLen:${Guilds._key(s, g.id)}:${day}`) * (span + 1));
        g.strike = { since: day, until, reason, good: Guilds.def(g.id).goods[0] || null };
        g.lastStrike = day;
        g.crown = _clamp(_num(g.crown) + _num(C.crown.strike), -100, 100);
        const m = SettlementMarket.ensure(s);
        if (!_obj(m.idle)) m.idle = {};
        for (const r of Guilds.def(g.id).recipes) m.idle[r] = until;
        const good = (Guilds.def(g.id).goods[0]) || 'goods';
        Guilds.record(player, world, { key: `strike:${Guilds._key(s, g.id)}:${day}`, kind: 'guild_strike', place: s.name, q: s.q, r: s.r, kingdomId: s.kingdom || null, guild: g.name, master: g.master.name, good: Guilds.goodName(good).toLowerCase(), days: until - day, reason });
        if (Guilds.membership(player, s, g.id)) out.notices.push({ icon: '✊', title: 'Guild Strike', text: `The ${g.name} has downed tools over ${reason}, until day ${until}.`, type: 'warning' });
    },

    _endStrike(s, g) {
        if (!g || !g.strike) return;
        g.strike = null;
        const m = s.market;
        if (m && _obj(m.idle)) {
            for (const r of Guilds.def(g.id) ? Guilds.def(g.id).recipes : []) delete m.idle[r];
            if (!Object.keys(m.idle).length) delete m.idle;
        }
    },

    /** Is a guild of this town on strike today? */
    onStrike(s, gid) {
        const g = Guilds.guild(s, gid);
        return !!(g && g.strike);
    },

    /** What squeezes a guild this week: { total, top, parts: [{ id, v }] } (no writes). */
    /** What squeezes every guild of a town alike (the realm's wars, purse and taxes, the price of bread), read once a turn. */
    _townSqueeze(world, s) {
        const S = Guilds.config().squeeze;
        const parts = [];
        const k = s.kingdom && world && world.getKingdom ? world.getKingdom(s.kingdom) : null;
        if (k) {
            if (Array.isArray(k.wars) && k.wars.length) parts.push({ id: 'the war levies', v: _num(S.war) });
            const f = _obj(k.finance);
            if (f) {
                const C = Finance.cfg('crowns');
                if (_num(f.missed) >= _num(C.crisisMissed, 2) || _num(f.unpaid) >= _num(C.crisisUnpaid, 14) || _num(f.debtRatio) > _num(C.crisisRatio, 1.2)) parts.push({ id: 'the crown\'s empty treasury', v: _num(S.crisis) });
            }
            const tax = k.crown && k.crown.policies && k.crown.policies.tax;
            if (tax === 'heavy') parts.push({ id: 'heavy royal taxes', v: _num(S.heavyTax) });
        }
        // Wages: what a journeyman's pay buys — the town's wage index where the
        // labour model keeps one (settlement.wageIndex, 1 = customary), else the price of bread
        if (Number.isFinite(s.wageIndex) && s.wageIndex > 0) {
            if (1 / s.wageIndex > _num(S.wagesAbove, 1.2)) parts.push({ id: 'wages that buy too little', v: _num(S.wages) });
        } else if (SettlementMarket.scarcity(s, 'bread') > _num(S.breadDearAbove, 1.5)) parts.push({ id: 'the price of bread', v: _num(S.breadDear) });
        return parts;
    },

    squeeze(world, player, s, g, town = null) {
        const S = Guilds.config().squeeze;
        const def = Guilds.def(g.id);
        const parts = [];
        const add = (id, v) => { if (v > 0) parts.push({ id, v }); };
        for (const p of town || Guilds._townSqueeze(world, s)) add(p.id, p.v);
        for (const good of def.goods) {
            const mono = s.monopolies && s.monopolies[good];
            if (mono && mono.holder === 'crown') add('the crown\'s monopoly', _num(S.crownMonopoly));
            else if (mono && !(mono.holder === 'guild' && (!mono.guildId || mono.guildId === g.id))) add(`${mono.holderName || 'a rival'}'s monopoly`, _num(S.rivalMonopoly));
            if (SettlementMarket.uses(s, good) && SettlementMarket.scarcity(s, good) < _num(S.glutBelow, 0.75)) add('cheap goods glutting the stalls', _num(S.glut));
        }
        for (const id of def.inputs) {
            if (def.recipes.length && SettlementMarket.scarcity(s, id) > _num(S.inputDearAbove, 1.6)) { add('dear materials', _num(S.inputDear)); break; }
        }
        // Competition: the player's works of the craft, outsiders flooding the stalls
        const works = s.market && s.market.works;
        if (works && Guilds.rankOf(player, s, g.id) < RANK.journeyman) {
            for (const r of def.recipes) if (works[r] && works[r].owner === 'player' && _num(works[r].runs) > 0) { add('an outsider\'s works undercutting them', _num(S.playerWorks)); break; }
        }
        const sold = _obj(g.week && g.week.outsider);
        if (sold && Object.keys(sold).length) {
            for (const good of def.goods) if (Guilds.outsiderRoom(null, s, good) <= 0 && _num(sold[good]) > 0) { add('outsiders flooding the stalls', _num(S.outsiderFlood)); break; }
        }
        let total = 0, top = null;
        for (const p of parts) { total += p.v; if (!top || p.v > top.v) top = p; }
        return { total: _round2(total), top: top ? top.id : null, parts };
    },

    // ── The tick ──────────────────────────────────────────

    _settlement(world, q, r) {
        const t = world && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
        return t && t.settlement ? t.settlement : null;
    },

    /**
     * The daily tick (after the market's day, from endDay): each town's
     * guilds take their weekly turn on its slot (formation and decline,
     * dues, the squeeze and strikes, elections, lobbying, feuds, the
     * player's dues and loans there); the player's contracts fall due.
     * Draws no RNG. → { notices, income, expenses }
     */
    processDay(world, player) {
        const out = { notices: [], income: 0, expenses: 0 };
        if (!world || typeof world.getTile !== 'function') return out;
        const day = _day(world);
        const k = Math.max(1, Math.floor(_num(Guilds.config().tickDays, 7)));
        const turn = ((day % k) + k) % k;
        for (const v of Guilds._towns(world, day)[turn] || []) {
            const s = Guilds._settlement(world, v.q, v.r);
            if (!s) continue;
            if (!Number.isFinite(s.q)) { s.q = v.q; s.r = v.r; }
            Guilds._townWeek(world, player, s, day, out);
        }
        // (a strike's idle trades restart on their own day — SettlementMarket reads market.idle's until-day;
        // the guild marks it over at its next turn) The player's contracts and credit backing:
        if (player && player.guilds) Guilds._playerDay(world, player, day, out);
        return out;
    },

    /**
     * The places that can hold guilds (towns and up), by weekly slot —
     * cached for a month (towns rarely change size or hands).
     */
    _towns(world, day) {
        const c = Guilds._townCache && Guilds._townCache.world === world ? Guilds._townCache : null;
        if (c && day >= c.day && day - c.day < 28) return c.slots;
        const k = Math.max(1, Math.floor(_num(Guilds.config().tickDays, 7)));
        const slots = Array.from({ length: k }, () => []);
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : (world.getAllSettlements ? world.getAllSettlements() : []);
        const minRank = SettlementMarket._rank(Guilds.config().minType);
        for (const v of views) {
            if (!v || !Number.isFinite(v.q)) continue;
            // (a village with guilds left from better days still takes its turn, to see them go)
            if (SettlementMarket._rank(v.type) < minRank && !v.guilds) continue;
            slots[Guilds.slot(v.q, v.r)].push({ q: v.q, r: v.r });
        }
        Guilds._townCache = { world, day, slots };
        return slots;
    },

    _townWeek(world, player, s, day, out) {
        const C = Guilds.config();
        // The town's industry is weighed once a month (guilds form, swell, shrink, dissolve)
        if (Math.floor(day / Math.max(1, C.tickDays)) % 4 === 0) Guilds.ensureTown(world, s, day, player, out);
        const gs = Guilds.townGuilds(s);
        if (!gs) return;
        const town = Guilds._townSqueeze(world, s);
        for (const gid of Object.keys(gs)) {
            const g = gs[gid];
            const def = Guilds.def(gid);
            if (!def) { delete gs[gid]; continue; }
            // Prosperity: inputs on hand and the price its goods fetch
            let cover = 1, price = 1;
            if (def.recipes.length) {
                cover = 0;
                for (const id of def.inputs) cover = Math.max(cover, Math.min(1, SettlementMarket.stock(s, id) / Math.max(0.01, SettlementMarket.target(s, id))));
            }
            let pn = 0, ps = 0;
            for (const id of def.goods) if (SettlementMarket.tracks(id)) { ps += Math.min(1.5, SettlementMarket.scarcity(s, id)); pn++; }
            if (pn) price = ps / pn;
            const live = g.strike ? 0.3 : 1;
            g.prosperity = _round2(_clamp(0.5 * _num(g.prosperity, 1) + 0.5 * (0.5 * cover + 0.5 * price) * live, 0, 1.5));
            // Dues into the hall (capped), the strike fund out of it
            const cap = g.members * C.dues * C.treasuryWeeks;
            g.treasury = Math.round(Math.min(Math.max(_num(g.treasury), cap), _num(g.treasury) + g.members * C.dues * g.prosperity));
            if (g.treasury > cap) g.treasury = Math.round(Math.max(cap, g.treasury * 0.97));
            Guilds._refreshToll(player, world, s, g);
            // Strikes run their course (or the strike fund runs dry)
            if (g.strike) {
                g.treasury = Math.max(0, g.treasury - Math.round(g.members * _num(C.squeeze.strikeCost)));
                if (day >= g.strike.until || g.treasury <= 0) Guilds._endStrike(s, g);
            }
            // The squeeze, and a strike when it bites for weeks
            const sq = Guilds.squeeze(world, player, s, g, town);
            g.squeeze = _round2(_num(g.squeeze) * _num(C.squeeze.decay, 0.5) + sq.total);
            g.squeezeWeeks = g.squeeze >= _num(C.squeeze.strikeAt, 1) ? _num(g.squeezeWeeks) + 1 : 0;
            const cooled = g.lastStrike == null || day - g.lastStrike >= _num(C.squeeze.cooldown, 60);
            if (!g.strike && cooled && def.recipes.length && g.squeezeWeeks >= _num(C.squeeze.weeks, 2)
                && g.treasury >= g.members * _num(C.squeeze.strikeCost) && _roll(`strike:${Guilds._key(s, gid)}:${day}`) < _num(C.squeeze.strikeChance, 0.6)) {
                Guilds._startStrike(world, player, s, g, day, sq.top || 'hard times', out);
            }
            // A crown that has lost patience breaks a striking guild (not in the player's own realm)
            if (g.strike && _num(g.crown) <= _num(C.crown.abolishBelow, -40) && !Guilds.canRule(player, world, s)
                && _roll(`abolish:${Guilds._key(s, gid)}:${day}`) < _num(C.crown.abolishChance, 0.25)) {
                const k = s.kingdom && world.getKingdom ? world.getKingdom(s.kingdom) : null;
                if (k) k.treasury = _num(k.treasury) + Math.floor(_num(g.treasury) * 0.5);
                Guilds._abolish(world, player, s, gid, `by the crown of ${(k && k.name) || 'the realm'}`, out);
                continue;
            }
            Guilds._feudWeek(world, player, s, g, def, day, out);
            if (day >= _num(g.nextElection)) Guilds._election(world, player, s, g, day, out);
            if (day >= _num(g.nextLobby)) Guilds._lobby(world, player, s, g, def, day, out);
            Guilds._memberWeek(world, player, s, g, day, out);
            if (g.week && (g.week.toll || Object.keys(g.week.outsider || {}).length)) g.week = { outsider: {}, toll: 0 };
        }
    },

    /** The guild's quarrel with the player's works and company when they undercut it. */
    _feudWeek(world, player, s, g, def, day, out) {
        const F = Guilds.config().feud;
        const works = s.market && s.market.works;
        // (nothing of the player's here: the quarrel cools)
        if (!works && !s.monopolies && !(g.week && g.week.toll > 0) && !(_obj(g.week && g.week.outsider) && Object.keys(g.week.outsider).length)) {
            if (g.feud > 0) g.feud = _round2(Math.max(0, g.feud - _num(F.decay)));
            return;
        }
        const rank = Guilds.rankOf(player, s, g.id);
        let heat = 0;
        if (works && rank < RANK.journeyman) {
            for (const r of def.recipes) {
                const w = works[r];
                if (w && w.owner === 'player' && _num(w.runs) > 0) heat += _num(F.perWorks) * (g.strike ? 1 + _num(F.strikebreak) / Math.max(1, _num(F.perWorks)) : 1);
            }
        }
        if (rank < 0 && _obj(g.week && g.week.outsider)) {
            for (const good of def.goods) if (_num(g.week.outsider[good]) > 0 && Guilds.outsiderRoom(null, s, good) <= 0) heat += _num(F.perOutsiderFlood);
        }
        for (const good of def.goods) {
            const m = s.monopolies && s.monopolies[good];
            if (m && m.holder === 'player') heat += _num(F.companyMonopoly);
        }
        g.feud = _round2(_clamp(_num(g.feud) + heat - (heat > 0 ? 0 : _num(F.decay)), 0, 100));
        // A feud past the line: the guild's men damage the player's works of its craft
        if (g.feud >= _num(F.sabotageAt) && works && player) {
            for (const r of def.recipes) {
                const w = works[r];
                if (!w || w.owner !== 'player') continue;
                const lo = _num(F.sabotage[0], 0.08), hi = _num(F.sabotage[1], 0.2);
                const cut = lo + (hi - lo) * _roll(`sabotage:${Guilds._key(s, g.id)}:${r}:${day}`);
                w.cond = _round2(_clamp(_num(w.cond, 1) * (1 - cut), 0, 1));
                const st = Guilds.state(player);
                st.stats.sabotaged++;
                Guilds._log(st, world, `Men of the ${g.name} wrecked part of your works at ${s.name}.`);
                out.notices.push({ icon: '🔥', title: 'Guild Sabotage', text: `The ${g.name} resents your works at ${s.name}: its men damaged them (${Math.round(cut * 100)}%). Join the guild or let the feud cool.`, type: 'error' });
                g.feud = _round2(Math.max(0, g.feud - 20));
            }
        }
    },

    _election(world, player, s, g, day, out) {
        const E = Guilds.config().election;
        const key = Guilds._key(s, g.id);
        const cand = Guilds.candidates(s, g);
        const me = Guilds.membership(player, s, g.id);
        let incumbent = _num(E.npcBase) + _roll(`elect:i:${key}:${day}`) * _num(E.npcSpread);
        let challenger = _num(E.npcBase) + _roll(`elect:c:${key}:${day}`) * _num(E.npcSpread);
        if (g.master && g.master.player) incumbent = -1; // the player's seat is contested below
        if (me && Guilds.rankDef(me.rank).votes && me.vote) {
            if (me.vote === 'incumbent' && incumbent >= 0) incumbent += _num(E.backedBonus);
            if (me.vote === 'challenger') challenger += _num(E.backedBonus);
        }
        let winner;
        const playerRuns = me && me.rank >= RANK.master && (me.candidate || (g.master && g.master.player));
        const playerScore = playerRuns ? _num(E.playerBase) + _num(me.standing) + _num(me.contracts) * _num(E.perContract) - _num(g.feud) : -1;
        const best = Math.max(incumbent, challenger);
        if (playerRuns && playerScore > best) winner = 'player';
        else winner = incumbent >= challenger ? 'incumbent' : 'challenger';
        const wasPlayer = !!(g.master && g.master.player);
        if (winner === 'player') {
            g.master = { name: player.name || 'you', player: true };
            if (me.rank < RANK.guildmaster) me.rank = RANK.guildmaster;
            me.rankSince = day;
            const st = Guilds.state(player);
            st.stats.elections++;
            st.stats.bestRank = Math.max(_num(st.stats.bestRank, -1), RANK.guildmaster);
            if (!wasPlayer) out.notices.push({ icon: '👑', title: 'Elected Guildmaster', text: `The masters of the ${g.name} have elected you guildmaster.`, type: 'success' });
        } else {
            if (winner === 'challenger' || wasPlayer) g.master = { name: cand.challenger, player: false };
            if (wasPlayer && me) {
                me.rank = RANK.master;
                me.rankSince = day;
                out.notices.push({ icon: '🗳️', title: 'Guild Election Lost', text: `The masters of the ${g.name} have chosen ${g.master.name} over you.`, type: 'warning' });
            }
            if (me && me.vote && me.vote === winner) me.standing = Math.min(100, _num(me.standing) + 5);
        }
        if (me) me.vote = null;
        g.nextElection = day + _num(E.every, 120);
        if (player) {
            Guilds.record(player, world, { key: `election:${key}:${day}`, kind: 'guild_election', place: s.name, q: s.q, r: s.r, kingdomId: s.kingdom || null, guild: g.name, master: g.master.name, own: winner === 'player' });
        }
    },

    /** Lobby the crown: a charter or a monopoly (an NPC crown by a hash roll; the player's court by petition). */
    _lobby(world, player, s, g, def, day, out) {
        const L = Guilds.config().lobby;
        const C = Guilds.config().crown;
        g.nextLobby = day + _num(L.every, 28);
        if (_num(g.treasury) < _num(L.minTreasury)) return;
        const key = Guilds._key(s, g.id);
        const good = def.goods.find(x => !(s.monopolies && s.monopolies[x]));
        // In the realm the player rules (or a town the player holds), the guild petitions the player
        if (player && Guilds.canRule(player, world, s)) {
            // ...and what squeezes it sours the realm's merchants
            const sq = Guilds.squeeze(world, player, s, g);
            if (sq.total >= _num(Guilds.config().squeeze.strikeAt, 1) * 0.5) Guilds._faction(player, -_num(L.factionShift, 3));
            if (!good) return;
            const defId = `guild_lobby_${key}`;
            // (one guild's petition at a time comes before the ruler)
            if (Petitions.pending(player).some(p => String(p.defId).startsWith('guild_lobby_'))) return;
            const purse = Math.min(_num(L.purse, 200), Math.floor(_num(g.treasury) * 0.5));
            const goodName = Guilds.goodName(good).toLowerCase();
            const k = Throne.ruledKingdom(player, world);
            const kind = k && s.kingdom === k.id ? 'crown' : 'settlement';
            const pdef = {
                title: `The ${def.name} Seeks a Monopoly`, icon: def.icon,
                text: `${g.master.name}, master of the ${g.name}, lays a purse of ${purse} gold before you: the guild asks that none but its members sell ${goodName} in ${s.name}.`,
                requires: { holding: [kind] }, expires: 10,
                ignore: { result: `The ${def.name} takes its purse home, offended.`, effects: {} },
                choices: [
                    { id: 'grant', label: 'Grant the monopoly and take the purse', effects: { gold: purse, faction: { merchants: 2, commons: -3 }, monopoly: { good, holder: 'guild', holderName: g.name, guildId: g.id, days: _num(L.monopolyDays, 120) } }, result: `None but the ${def.name} may sell ${goodName} in ${s.name} now.` },
                    { id: 'refuse', label: 'Refuse: the market stays open', effects: { faction: { merchants: -2, commons: 2 } }, result: `${g.master.name} pockets the purse and leaves, stiffly.` },
                ],
            };
            const p = Utils.withRng(Utils.seededRandom(Utils.hashStr(`${defId}:${day}`) >>> 0), () => Petitions.spawnCustom(player, world, defId, pdef, { kind, q: s.q, r: s.r, settlement: s, kingdomId: s.kingdom || null }));
            if (p) {
                // The purse leaves the hall with the guildmaster; it comes back if refused
                g.treasury -= purse;
                g.lobbying = { petition: p.id, purse, good };
            }
            return;
        }
        // An NPC crown weighs the guild's purse and standing
        g.treasury -= _num(L.cost, 250);
        const p = _num(L.chance) + _num(g.crown) * _num(L.perStanding);
        const k = s.kingdom && world.getKingdom ? world.getKingdom(s.kingdom) : null;
        if (_roll(`lobby:${key}:${day}`) < p && k) {
            if (!g.chartered && _num(g.crown) >= _num(L.charterStanding, 20)) {
                g.chartered = true;
                Guilds._refreshToll(player, world, s, g);
                Guilds.record(player, world, { key: `chartered:${key}:${day}`, kind: 'guild_chartered', place: s.name, q: s.q, r: s.r, kingdomId: s.kingdom || null, guild: g.name, master: g.master.name });
            } else if (good) {
                if (!s.monopolies) s.monopolies = {};
                s.monopolies[good] = { holder: 'guild', holderName: g.name, guildId: g.id, sinceDay: day, untilDay: day + _num(L.monopolyDays, 120) };
            }
            k.treasury = _num(k.treasury) + Math.floor(_num(L.cost, 250) * 0.5);
            g.crown = _clamp(_num(g.crown) + _num(C.lobbyWin), -100, 100);
        } else {
            g.crown = _clamp(_num(g.crown) + _num(C.lobbyFail), -100, 100);
        }
    },

    /** The player's dues, standing from works, the guild's loan, a guildmaster's stipend (at the guild's turn). */
    _memberWeek(world, player, s, g, day, out) {
        if (!g.lobbying && !(player && player.guilds)) return;
        const m = Guilds.membership(player, s, g.id);
        // A lobbying purse settles once the petition is ruled on
        if (g.lobbying && player) {
            const pending = Petitions.pending(player).some(p => p.id === g.lobbying.petition);
            if (!pending) {
                const mono = s.monopolies && s.monopolies[g.lobbying.good];
                if (mono && mono.holder === 'guild') {
                    mono.guildId = g.id;
                    g.crown = _clamp(_num(g.crown) + _num(Guilds.config().crown.lobbyWin), -100, 100);
                } else {
                    g.treasury += _num(g.lobbying.purse);
                    g.crown = _clamp(_num(g.crown) + _num(Guilds.config().crown.lobbyFail) * 2, -100, 100);
                }
                g.lobbying = null;
            }
        }
        if (!m) return;
        const st = Guilds.state(player);
        const S = Guilds.config().standing;
        const rd = Guilds.rankDef(m.rank);
        // Dues
        const dues = Math.round(_num(rd.dues) * _num(Guilds.config().typeFee[s.type], 1));
        if (dues > 0) {
            if (_num(player.gold) >= dues) {
                player.gold -= dues;
                g.treasury += dues;
                st.stats.dues += dues;
                out.expenses += dues;
                m.unpaid = 0;
                m.standing = Math.min(100, _num(m.standing) + _num(S.duesPaid, 1));
            } else {
                m.unpaid = _num(m.unpaid) + 1;
                m.standing = Math.max(0, _num(m.standing) - _num(S.missedDues, 5));
                if (m.unpaid >= _num(S.expelAfter, 3)) {
                    delete st.memberships[m.key];
                    st.stats.expelled++;
                    if (g.master && g.master.player) g.master = { name: Guilds._name(`${m.key}:m${day}`), player: false };
                    Guilds._log(st, world, `The ${g.name} struck you from its rolls for unpaid dues.`);
                    out.notices.push({ icon: '📛', title: 'Expelled', text: `The ${g.name} has struck you from its rolls: ${m.unpaid} weeks of dues unpaid.`, type: 'error' });
                    return;
                }
            }
        }
        // Works of the craft in town build a member's name
        const works = s.market && s.market.works;
        for (const r of Guilds.def(g.id).recipes) {
            const w = works && works[r];
            if (w && w.owner === 'player') m.standing = _round2(Math.min(100, _num(m.standing) + _num(w.runs) * _num(S.perWorksRun)));
        }
        // A guildmaster's stipend
        if (m.rank >= RANK.guildmaster && g.master && g.master.player) {
            const P = Guilds.config().stipend;
            const pay = Math.min(_num(P.max, 30), Math.floor(_num(g.treasury) * _num(P.share, 0.01)));
            if (pay > 0) {
                g.treasury -= pay;
                player.gold += pay;
                st.stats.stipends += pay;
                out.income += pay;
            }
        }
        // The guild's loan
        for (const loan of st.loans.filter(l => l.key === m.key)) {
            const due = Math.min(loan.weekly, loan.owed);
            if (_num(player.gold) >= due) {
                Guilds._payLoan(player, world, st, loan, due);
                Finance.state(player).credit.onTime++;
                out.expenses += due;
            } else {
                loan.missed++;
                Finance.state(player).credit.missed++;
                m.standing = Math.max(0, _num(m.standing) - _num(Guilds.config().loans.missedStanding, 8));
                if (loan.missed >= _num(Guilds.config().loans.defaultAfter, 3)) {
                    const cr = Finance.state(player).credit;
                    cr.defaults++;
                    cr.lastDefaultDay = day;
                    st.loans = st.loans.filter(l => l !== loan);
                    delete st.memberships[m.key];
                    st.stats.expelled++;
                    g.feud = Math.max(_num(g.feud), 60);
                    Guilds._log(st, world, `Defaulted on the ${g.name}'s loan: struck from its rolls.`);
                    out.notices.push({ icon: '📛', title: 'Guild Loan Defaulted', text: `You defaulted on the ${g.name}'s loan: it strikes you from its rolls, and the banks hear of it.`, type: 'error' });
                    return;
                }
            }
        }
    },

    /** The player's contracts fall due; the credit backing of their ranks. */
    _playerDay(world, player, day, out) {
        const st = Guilds.state(player);
        const K = Guilds.config().contracts;
        for (const c of st.contracts.slice()) {
            if (day <= c.due) continue;
            st.contracts = st.contracts.filter(x => x !== c);
            const s = Guilds._settlement(world, c.q, c.r);
            const g = Guilds.guild(s, c.guild);
            if (g) {
                g.treasury += Math.max(0, c.escrow);
                g.feud = _clamp(_num(g.feud) + _num(K.failFeud), 0, 100);
            }
            const m = st.memberships[c.key];
            if (m) m.standing = Math.max(0, _num(m.standing) - _num(K.failStanding, 15));
            st.stats.contractsFailed++;
            Guilds._log(st, world, `Failed the ${g ? g.name : 'guild'}'s contract for ${c.qty} ${Guilds.goodName(c.good).toLowerCase()}.`);
            out.notices.push({ icon: '📜', title: 'Guild Contract Failed', text: `You did not deliver the ${c.qty - c.delivered} ${Guilds.goodName(c.good).toLowerCase()} the ${g ? g.name : 'guild'} wanted by day ${c.due}.`, type: 'warning' });
        }
        // Credit backing (systems/finance.js reads player.guilds.backing in the credit report)
        const B = Guilds.config().backing;
        let backing = 0;
        for (const m of Object.values(st.memberships)) {
            if (m.rank >= RANK.guildmaster) backing += _num(B.guildmaster);
            else if (m.rank >= RANK.master) backing += _num(B.master);
        }
        st.backing = Math.min(_num(B.cap, 45), backing);
        st.lastDay = day;
    },

    // ── Views ─────────────────────────────────────────────

    /** The player's memberships as they stand: [{ m, settlement, guild, def }]. */
    memberships(player, world) {
        const st = player && _obj(player.guilds);
        if (!st) return [];
        return Object.values(st.memberships).map(m => {
            const s = Guilds._settlement(world, m.q, m.r);
            return { m, settlement: s, guild: Guilds.guild(s, m.guild), def: Guilds.def(m.guild) };
        });
    },

    /** Strikes on now within `radius` hexes: [{ town, q, r, guild, goods, until, dist }]. */
    strikesNear(world, q, r, radius = 12) {
        const out = [];
        const views = world && typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        for (const v of views) {
            const s = Guilds._settlement(world, v.q, v.r);
            const gs = s && s.guilds;
            if (!gs) continue;
            const dist = Hex.wrappingDistance(q, r, v.q, v.r, world.width);
            if (dist > radius) continue;
            for (const g of Object.values(gs)) {
                if (g && g.strike) out.push({ town: s.name, q: v.q, r: v.r, guild: g.name, goods: (Guilds.def(g.id) || { goods: [] }).goods, until: g.strike.until, dist });
            }
        }
        return out.sort((a, b) => a.dist - b.dist);
    },
};
