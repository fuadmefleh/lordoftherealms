// ============================================
// CHATTER — what the townsfolk say about the world they live in
// ============================================
// A living world talks about itself. This module reads the state the other
// systems already keep and turns it into a *context* for one place (and
// optionally one NPC):
//
//   the realm's wars and the player's wars with it, an enemy fleet blockading
//   the port, a siege nearby (the player's own, or one of a player holding),
//   the season and the lean weeks, timed world events close by (plague,
//   famine, drought, bandits, a comet…), a revolt, a saga staged in the
//   region, a rival adventurer who passed through, a new ruler, the heralds'
//   proclamations that have reached the place (systems/heralds.js), the
//   player's deeds the gossip has carried here (systems/gossip.js deed
//   rumours), the player's earned traits, court reputation, titles and House,
//   and the NPC's occupation, personality and disposition.
//
// Content is data: data/chatter.json → groups of lines, each group with a
// `when` of conditions on that context. Selection keeps the groups whose
// conditions all hold, weights them by their `weight` and how specific they
// are (more conditions → more likely), and picks one line. The pick is a
// pure function of the context and a roll; with no roll given, the roll is a
// hash of a seed string, so nothing here ever draws from the game RNG.
//
// Used by the NPC dialogue (greetings and "What news?"), ambient remarks on
// arriving in a settlement, the tavern's regional news (player/tavern) and
// the LLM voice's prompt (systems/npcBrain.js) — the same facts everywhere.
// World / player are passed in; no import-time side effects.

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Seasons } from '../world/seasons.js';
import { KingdomNavy } from '../world/kingdomNavy.js';
import { WorldEvents } from '../world/worldEvents.js';
import { Traits } from './traits.js';
import { Heralds } from './heralds.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { TownLabour } from '../world/townLabour.js';

const DEFAULT_CONFIG = {
    localRadius: 8, eventRadius: 10, sagaRadius: 14, siegeRadius: 6, rivalRadius: 6, outlawRadius: 10,
    rivalDays: 12, newRulerDays: 30, courtThreshold: 5,
    greetChance: 0.45, newsChance: 0.8, ambientCooldownDays: 3, tavernRadius: 20, specificityBonus: 1,
};

/** Every condition a group may use, by the kind of value it takes. */
const CONDITIONS = {
    war: 'bool', playerWar: 'bool', blockade: 'bool', siege: 'bool', revolt: 'bool',
    rival: 'bool', newRuler: 'bool', lean: 'bool', outlaws: 'bool', dearth: 'bool', glut: 'bool', strike: 'bool',
    money: 'boolOrList', labour: 'boolOrList',
    event: 'list', season: 'list', trait: 'list', court: 'list', title: 'list',
    occupation: 'list', personality: 'list',
    saga: 'boolOrList', proclamation: 'boolOrList', deed: 'boolOrList',
    houseGen: 'num', prestige: 'num', karmaMin: 'num', karmaMax: 'num', renownMin: 'num',
    dispositionMin: 'num', dispositionMax: 'num',
};

export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
/** What townsfolk say about money (systems/finance.js): the `money` condition's kinds. */
export const MONEY_KINDS = ['debased', 'levy', 'default', 'bank_run', 'bank_failed', 'bank'];
/** What townsfolk say about work and the people (world/townLabour.js): the `labour` condition's kinds. */
export const LABOUR_KINDS = ['idle', 'refugees', 'strike', 'boom', 'hardship', 'mine_strike', 'mine_closed'];
export const OCCUPATIONS = ['merchant', 'guard', 'farmer', 'priest', 'blacksmith_npc', 'villager', 'child', 'noble', 'traveler', 'beggar'];
export const PERSONALITIES = ['kind', 'stern', 'jovial', 'quiet', 'bold', 'cautious', 'witty', 'generous', 'stubborn', 'curious'];
export const COURT_AXES = ['mercy', 'severity', 'justice', 'piety', 'generosity'];
export const TITLES = ['our_king', 'foreign_king', 'pretender', 'exile', 'noble', 'commoner'];

/** Tokens a line may use, and the condition that must be in its `when` to fill it. */
const TOKEN_NEEDS = {
    enemy: 'war', blockader: 'blockade', siegeTown: 'siege', eventPlace: 'event', eventName: 'event',
    saga: 'saga', villain: 'saga', rival: 'rival', rivalNews: 'rival', oldRuler: 'newRuler',
    proclamation: 'proclamation', deedPlace: 'deed', deedVictim: 'deed',
    lair: 'outlaws', leader: 'outlaws', dearthGood: 'dearth', glutGood: 'glut', strikeGuild: 'strike', strikeGood: 'strike',
    bank: 'money',
};
const ALWAYS_TOKENS = ['settlement', 'kingdom', 'ruler', 'player', 'house', 'season', 'title'];

/** How a passer-by is named in an ambient remark. */
const PASSERBY = {
    merchant: 'a merchant', guard: 'a guard', farmer: 'a farmer', priest: 'a priest',
    blacksmith_npc: 'the smith', villager: 'a townswoman', child: 'a child', noble: 'a noble',
    traveler: 'a traveller', beggar: 'a beggar',
};
const AMBIENT_OCCUPATIONS = ['villager', 'villager', 'merchant', 'guard', 'farmer', 'traveler', 'priest', 'beggar', 'blacksmith_npc', 'noble', 'child'];

const _num = v => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** FNV-1a over a string → [0, 1). */
function _hashUnit(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 1000003) / 1000003;
}

function _dist(world, q1, r1, q2, r2) {
    if (q1 == null || q2 == null) return Infinity;
    return Hex.wrappingDistance(q1, r1, q2, r2, (world && world.width) || 0);
}

function _kingdom(world, id) {
    if (!world || id == null) return null;
    if (world.getKingdom) return world.getKingdom(id);
    return (world.kingdoms || []).find(k => k.id === id) || null;
}

export const Chatter = {

    CONDITIONS,
    TOKEN_NEEDS,

    // ──────────── DATA ────────────

    data() {
        return DataLoader.chatter || {};
    },

    config() {
        return { ...DEFAULT_CONFIG, ...(Chatter.data().config || {}) };
    },

    groups() {
        return Array.isArray(Chatter.data().groups) ? Chatter.data().groups : [];
    },

    hash: _hashUnit,

    // ──────────── CONTEXT ────────────

    /**
     * Everything a townsperson at (q, r) could talk about.
     * @param {Object} world
     * @param {Object} player
     * @param {Object} opts - { q, r, npc, disposition, wide } — `wide` widens every
     *   radius to the tavern's (travellers' talk reaches further than street talk).
     */
    context(world, player, opts = {}) {
        const cfg = Chatter.config();
        const q = opts.q != null ? opts.q : (player ? player.q : null);
        const r = opts.r != null ? opts.r : (player ? player.r : null);
        const wide = !!opts.wide;
        const rad = key => (wide ? Math.max(cfg[key], cfg.tavernRadius) : cfg[key]);
        const day = world && Number.isFinite(world.day) ? world.day : null;
        const tile = world && world.getTile && q != null ? world.getTile(q, r) : null;
        const settlement = (tile && tile.settlement) || null;
        const kid = (settlement && settlement.kingdom) || (tile && tile.kingdom) || null;
        const kingdom = _kingdom(world, kid);
        const npc = opts.npc || null;
        const house = (player && player.house) || null;

        const ctx = {
            day, q, r,
            settlementName: (settlement && settlement.name) || 'these parts',
            kingdomId: kid,
            kingdomName: (kingdom && kingdom.name) || 'the realm',
            ruler: (kingdom && kingdom.ruler) || 'the crown',
            playerName: (player && player.name) || 'stranger',
            houseName: (house && house.name) || 'your House',
            season: day != null ? Seasons.seasonOf(day) : null,
            lean: day != null ? Seasons.isLean(day) : false,
            war: false, enemy: null, playerWar: false,
            blockade: false, blockader: null,
            siege: false, siegeTown: null,
            events: [], revolt: false, sagas: [], rival: null, newRuler: false, oldRuler: null, outlaws: null, money: [], labour: [],
            proclamations: [], deeds: [],
            traits: [], court: [], titles: [], titleLabel: '',
            houseGen: house ? _num(house.generation) || 1 : 0,
            prestige: house ? _num(house.prestige) : 0,
            karma: player ? _num(player.karma) : 0,
            renown: player ? _num(player.renown) : 0,
            occupation: npc ? (npc.type || 'villager') : (opts.occupation || null),
            personality: npc && Array.isArray(npc.personalityTraits) ? npc.personalityTraits.slice() : [],
            disposition: opts.disposition != null ? opts.disposition : null,
        };

        // The realm's wars, and the player's war with it
        if (kingdom && kingdom.isAlive !== false && Array.isArray(kingdom.wars) && kingdom.wars.length) {
            const foe = kingdom.wars.map(id => _kingdom(world, id)).find(k => k && k.isAlive !== false);
            if (foe) { ctx.war = true; ctx.enemy = foe.name; }
        }
        if (kid && player && player.realmWars && player.realmWars.wars && player.realmWars.wars[kid]) ctx.playerWar = true;

        // An enemy fleet off the port
        if (kingdom && settlement && world && KingdomNavy.isBlockaded(kingdom) && KingdomNavy.isPortTile(world, q, r)) {
            const by = _kingdom(world, KingdomNavy.blockaders(kingdom)[0]);
            ctx.blockade = true;
            ctx.blockader = by ? by.name : 'an enemy';
        }

        // A siege nearby: the player's own, or one of the player's holdings
        const own = player && player.sieges && player.sieges.active;
        if (own && _dist(world, q, r, own.q, own.r) <= rad('siegeRadius')) {
            ctx.siege = true; ctx.siegeTown = own.name || 'the town';
        } else if (player && player.realmWars && player.realmWars.besieged && typeof player.realmWars.besieged === 'object') {
            for (const s of Object.values(player.realmWars.besieged)) {
                if (s && _dist(world, q, r, s.q, s.r) <= rad('siegeRadius')) {
                    ctx.siege = true; ctx.siegeTown = s.name || 'the town';
                    break;
                }
            }
        }

        // Timed world events close by, or in this realm, or everywhere
        for (const ev of (world && world.activeEvents) || []) {
            if (!ev || !ev.id) continue;
            const regional = ev.q != null || ev.kingdomId != null;
            const near = !regional
                || (ev.q != null && _dist(world, q, r, ev.q, ev.r) <= rad('eventRadius'))
                || (kid != null && (ev.kingdomId === kid || ev.partnerKingdomId === kid));
            if (!near) continue;
            ctx.events.push({ id: ev.id, name: String(ev.name || ev.id).toLowerCase(), place: ev.settlementName || ev.regionName || ctx.settlementName });
            if (ev.id === 'rebellion') ctx.revolt = true;
        }

        // A revolt against the player's own crown, in this realm
        const ruling = player && player.throne && player.throne.ruling;
        if (ruling && kid && ruling.kingdomId === kid && ruling.court && ruling.court.revolt) ctx.revolt = true;

        // Sagas staged in this realm or close by
        const sagaState = player && player.sagas;
        for (const s of (sagaState && Array.isArray(sagaState.active)) ? sagaState.active : []) {
            if (!s || s.chapter == null) continue;
            const a = s.anchor || {};
            const p = a.settlement || a.site || a.lair || null;
            const close = (kid != null && a.kingdomId === kid) || (p && _dist(world, q, r, p.q, p.r) <= rad('sagaRadius'));
            if (close) ctx.sagas.push({ id: s.id, name: s.name || 'the saga', villain: a.villain || 'a stranger' });
        }

        // An outlaw lair preying on the country nearby (systems/outlawLairs.js)
        const lairs = player && player.outlawLairs && Array.isArray(player.outlawLairs.lairs) ? player.outlawLairs.lairs : [];
        let lairBest = null;
        for (const l of lairs) {
            if (!l || l.status !== 'active' || l.q == null) continue;
            const d = _dist(world, q, r, l.q, l.r);
            if (d <= rad('outlawRadius') && (!lairBest || d < lairBest.d)) lairBest = { d, l };
        }
        if (lairBest) ctx.outlaws = { name: lairBest.l.name, leader: (lairBest.l.leader && lairBest.l.leader.name) || 'their chief' };

        // A dearth or a glut in the town's own market (world/settlementMarket.js)
        // Work and the people: idle hands, refugees, a strike, a boom, hard times (world/townLabour.js)
        const lab = settlement && settlement.labour;
        if (lab && lab.sh) {
            if (TownLabour.idle(settlement) >= 0.1) ctx.labour.push('idle');
            if (_num(lab.refugees) >= 20) ctx.labour.push('refugees');
            if (TownLabour.striking(settlement, day)) ctx.labour.push('strike');
            if (_num(lab.all) >= (_num(TownLabour.config().strikes.boomAt) || 0.9) && lab.moved && _num(lab.moved.in) > _num(lab.moved.out)) ctx.labour.push('boom');
            if (lab.wel && Number.isFinite(lab.wel.peasants) && lab.wel.peasants < 0.7) ctx.labour.push('hardship');
        }
        // The hills around it: a new strike, a mine worked out (world/hinterland.js)
        if (settlement && world && world.hinterland && Array.isArray(world.hinterland.history)) {
            for (const h of world.hinterland.history) {
                if (!h || h.place !== settlement.name || _num(day) - _num(h.day) > 30) continue;
                if (h.kind === 'strike' && !ctx.labour.includes('mine_strike')) ctx.labour.push('mine_strike');
                if (h.kind === 'exhausted' && !ctx.labour.includes('mine_closed')) ctx.labour.push('mine_closed');
            }
        }
        ctx.dearth = null;
        ctx.glut = null;
        if (settlement && settlement.market) {
            const short = SettlementMarket.worstShortage(settlement, _num(cfg.dearthScarcity) || 1.8);
            const glut = SettlementMarket.biggestGlut(settlement, _num(cfg.glutScarcity) || 0.65);
            if (short) ctx.dearth = { id: short.id, label: Chatter._goodLabel(short.id) };
            if (glut) ctx.glut = { id: glut.id, label: Chatter._goodLabel(glut.id) };
        }
        // A town guild on strike (settlement.guilds, systems/guilds.js)
        ctx.strike = null;
        for (const g of Object.values((settlement && settlement.guilds) || {})) {
            if (g && g.strike) { ctx.strike = { guild: g.name, good: Chatter._goodLabel(g.strike.good || 'goods') }; break; }
        }

        // Money talk: debased coin, a war levy, a crown's default, a run on the
        // bank or a broken one, or just the banking house in town (systems/finance.js)
        if (kingdom) {
            const f = kingdom.finance;
            if (f && typeof f.purity === 'number' && f.purity < 1) ctx.money.push({ kind: 'debased' });
            if (f && f.levy && day != null && _num(f.levy.until) >= day) ctx.money.push({ kind: 'levy' });
            if (f && f.lastDefaultDay != null && day != null && day - f.lastDefaultDay <= 60) ctx.money.push({ kind: 'default' });
            const banks = (player && player.finance && Array.isArray(player.finance.banks)) ? player.finance.banks : [];
            for (const b of banks) {
                if (!b || b.kingdomId !== kid) continue;
                if (b.status === 'failed' && day != null && day - _num(b.failedDay) <= 60) ctx.money.push({ kind: 'bank_failed', bank: b.name });
                else if (b.status === 'open' && b.panic && day != null && _num(b.panic.until) >= day) ctx.money.push({ kind: 'bank_run', bank: b.name });
                else if (b.status === 'open' && b.q === q && b.r === r) ctx.money.push({ kind: 'bank', bank: b.name });
            }
        }

        // A rival adventurer who passed through lately
        const rivals = player && player.rivals;
        if (rivals && Array.isArray(rivals.news) && day != null) {
            for (const n of rivals.news) {
                if (!n || n.q == null || n.rivalId == null) continue;
                if (day - _num(n.day) > cfg.rivalDays) continue;
                if (_dist(world, q, r, n.q, n.r) > rad('rivalRadius')) continue;
                const rv = (rivals.list || []).find(x => x.id === n.rivalId);
                if (!rv) continue;
                ctx.rival = { name: rv.name, news: n.text || '' };
                break;
            }
        }

        // A new ruler
        const ls = kingdom && kingdom.lastSuccession;
        if (ls && day != null && day - _num(ls.day) <= cfg.newRulerDays && day >= _num(ls.day)) {
            ctx.newRuler = true;
            ctx.oldRuler = ls.oldRulerName || 'the old ruler';
        }

        // What the heralds cried here, and what the gossip says of the player
        if (player && world && q != null) ctx.proclamations = Heralds.heardAt(player, world, q, r);
        if (player && player.gossip && Array.isArray(player.gossip.rumors) && q != null) {
            const key = `${q},${r}`;
            const types = (DataLoader.gossip && DataLoader.gossip.rumorTypes) || {};
            for (const rumor of player.gossip.rumors) {
                if (!rumor || rumor.expired || !(types[rumor.type] && types[rumor.type].deed)) continue;
                if (!(rumor.spreadTo || []).includes(key)) continue;
                ctx.deeds.push({ type: rumor.type, place: rumor.locationName || 'these parts', victim: (rumor.victim && rumor.victim.name) || 'someone' });
            }
        }

        // Who the player has become
        if (player) {
            ctx.traits = Traits.getEarned(player);
            const court = player.petitions && player.petitions.court;
            if (court) ctx.court = COURT_AXES.filter(a => _num(court[a]) >= cfg.courtThreshold);
            ctx.titles = Chatter._titles(world, player, kid);
            ctx.titleLabel = player.kingdomTitle || (player.title && player.title !== 'Nobody' ? player.title : '') || 'traveller';
        }
        return ctx;
    },

    /** The player's standing, as the townsfolk see it from realm `kid`. */
    _titles(world, player, kid) {
        const out = [];
        const th = player.throne || {};
        const ruling = th.ruling;
        const ruled = ruling ? _kingdom(world, ruling.kingdomId) : null;
        if (ruled && ruled.isAlive !== false) out.push(ruled.id === kid ? 'our_king' : 'foreign_king');
        if (th.civilWar) out.push('pretender');
        const day = _num(world && world.day);
        const exiled = Object.values(th.exile || {}).some(until => _num(until) > day);
        if (player.title === 'Exile' || exiled) out.push('exile');
        if (!out.length) out.push(player.kingdomTitle || (player.title && player.title !== 'Nobody') ? 'noble' : 'commoner');
        return out;
    },

    /** A good's name for townsfolk talk ('grain', 'warm clothes'...). */
    _goodLabel(goodId) {
        const pe = DataLoader._gamedata && DataLoader._gamedata.playerEconomy;
        const g = pe && pe.GOODS && pe.GOODS[String(goodId).toUpperCase()];
        return String((g && g.name) || goodId).replace(/_/g, ' ').toLowerCase();
    },

    // ──────────── MATCHING ────────────

    /** Do all of a group's conditions hold in this context? */
    matches(when, ctx) {
        if (!when) return true;
        for (const [key, v] of Object.entries(when)) {
            if (!Chatter._test(key, v, ctx)) return false;
        }
        return true;
    },

    _anyIn(list, have) {
        return Array.isArray(list) && list.some(x => have.includes(x));
    },

    _test(key, v, ctx) {
        switch (key) {
            case 'war': case 'playerWar': case 'blockade': case 'siege': case 'revolt': case 'newRuler': case 'lean':
                return !!ctx[key] === !!v;
            case 'rival': return !!ctx.rival === !!v;
            case 'outlaws': return !!ctx.outlaws === !!v;
            case 'dearth': return !!ctx.dearth === !!v;
            case 'glut': return !!ctx.glut === !!v;
            case 'labour': { const l = ctx.labour || []; return v === true ? l.length > 0 : v === false ? l.length === 0 : Chatter._anyIn(v, l); }
            case 'strike': return !!ctx.strike === !!v;
            case 'money': { const m = ctx.money || []; return v === true ? m.length > 0 : v === false ? m.length === 0 : Chatter._anyIn(v, m.map(x => x.kind)); }
            case 'event': return Chatter._anyIn(v, ctx.events.map(e => e.id));
            case 'saga': return v === true ? ctx.sagas.length > 0 : v === false ? ctx.sagas.length === 0 : Chatter._anyIn(v, ctx.sagas.map(s => s.id));
            case 'proclamation': return v === true ? ctx.proclamations.length > 0 : v === false ? ctx.proclamations.length === 0 : Chatter._anyIn(v, ctx.proclamations.map(p => p.kind));
            case 'deed': return v === true ? ctx.deeds.length > 0 : v === false ? ctx.deeds.length === 0 : Chatter._anyIn(v, ctx.deeds.map(d => d.type));
            case 'season': return ctx.season != null && Array.isArray(v) && v.includes(ctx.season);
            case 'trait': return Chatter._anyIn(v, ctx.traits);
            case 'court': return Chatter._anyIn(v, ctx.court);
            case 'title': return Chatter._anyIn(v, ctx.titles);
            case 'occupation': return ctx.occupation != null && Array.isArray(v) && v.includes(ctx.occupation);
            case 'personality': return Chatter._anyIn(v, ctx.personality);
            case 'houseGen': return ctx.houseGen >= v;
            case 'prestige': return ctx.prestige >= v;
            case 'karmaMin': return ctx.karma >= v;
            case 'karmaMax': return ctx.karma <= v;
            case 'renownMin': return ctx.renown >= v;
            case 'dispositionMin': return ctx.disposition != null && ctx.disposition >= v;
            case 'dispositionMax': return ctx.disposition != null && ctx.disposition <= v;
            default: return false;
        }
    },

    // ──────────── TEXT ────────────

    _first(list, wanted, field) {
        if (!list.length) return null;
        if (Array.isArray(wanted)) return list.find(x => wanted.includes(x[field])) || list[0];
        return list[0];
    },

    /** Fill a line's {tokens} from the context (and the group's `when`, for which event/saga/deed it means). */
    fill(text, ctx, when = {}) {
        const ev = Chatter._first(ctx.events, when.event, 'id');
        const saga = Chatter._first(ctx.sagas, when.saga, 'id');
        const pr = Chatter._first(ctx.proclamations, when.proclamation, 'kind');
        const deed = Chatter._first(ctx.deeds, when.deed, 'type');
        const money = Chatter._first((ctx.money || []).filter(m => m.bank), when.money, 'kind');
        const map = {
            settlement: ctx.settlementName, kingdom: ctx.kingdomName, ruler: ctx.ruler,
            player: ctx.playerName, house: ctx.houseName, season: (ctx.season || 'the season').toLowerCase(),
            title: ctx.titleLabel || 'traveller',
            enemy: ctx.enemy, blockader: ctx.blockader, siegeTown: ctx.siegeTown,
            eventPlace: ev && ev.place, eventName: ev && ev.name,
            saga: saga && saga.name, villain: saga && saga.villain,
            rival: ctx.rival && ctx.rival.name, rivalNews: ctx.rival && ctx.rival.news,
            oldRuler: ctx.oldRuler,
            proclamation: pr && pr.text,
            deedPlace: deed && deed.place, deedVictim: deed && deed.victim,
            lair: ctx.outlaws && ctx.outlaws.name, leader: ctx.outlaws && ctx.outlaws.leader,
            dearthGood: ctx.dearth && ctx.dearth.label, glutGood: ctx.glut && ctx.glut.label,
            strikeGuild: ctx.strike && ctx.strike.guild, strikeGood: ctx.strike && ctx.strike.good,
            bank: money && money.bank,
        };
        return String(text).replace(/\{(\w+)\}/g, (m, k) => (map[k] != null ? map[k] : m));
    },

    // ──────────── SELECTION ────────────

    /**
     * Every line that fits the context, with its weight:
     * [{ id, groupId, text (raw), when, w }]. A group's weight is shared by its lines.
     */
    candidates(ctx, opts = {}) {
        const cfg = Chatter.config();
        const exclude = opts.exclude || null;
        const filter = opts.filter || null;
        const out = [];
        for (const g of Chatter.groups()) {
            if (!g || !Array.isArray(g.lines) || !g.lines.length) continue;
            if (filter && !filter(g)) continue;
            if (!Chatter.matches(g.when, ctx)) continue;
            const spec = Object.keys(g.when || {}).length;
            const w = (_num(g.weight) || 1) * (1 + cfg.specificityBonus * spec) / g.lines.length;
            g.lines.forEach((text, i) => {
                const id = `${g.id}#${i}`;
                if (exclude && exclude.includes(id)) return;
                out.push({ id, groupId: g.id, text, when: g.when || {}, w });
            });
        }
        return out;
    },

    /**
     * Pick one line for the context. Deterministic: `opts.roll` in [0, 1), or a
     * hash of `opts.seed` (default: the day and the place). Returns
     * { id, groupId, text } or null when nothing fits.
     */
    select(ctx, opts = {}) {
        const list = Chatter.candidates(ctx, opts);
        if (!list.length) return null;
        const roll = opts.roll != null ? opts.roll
            : _hashUnit(`${opts.seed != null ? opts.seed : ''}|${ctx.day}|${ctx.q},${ctx.r}|${ctx.occupation || ''}`);
        const total = list.reduce((s, c) => s + c.w, 0);
        let x = Math.min(0.999999, Math.max(0, roll)) * total;
        let pick = list[list.length - 1];
        for (const c of list) {
            x -= c.w;
            if (x < 0) { pick = c; break; }
        }
        return { id: pick.id, groupId: pick.groupId, text: Chatter.fill(pick.text, ctx, pick.when) };
    },

    /** Convenience: context + select. */
    lineFor(world, player, opts = {}) {
        return Chatter.select(Chatter.context(world, player, opts), opts);
    },

    /** A group says something about what is going on (not only who is speaking, or the weather). */
    _contextual(g) {
        return Object.keys(g.when || {}).some(k => !['occupation', 'personality', 'dispositionMin', 'dispositionMax', 'season'].includes(k));
    },

    /**
     * An overheard remark on arriving in a settlement: a passer-by (chosen by a
     * hash of the seed) says something about what's going on. Null when the
     * place has nothing to talk about. → { occupation, who, text, id }
     */
    ambient(world, player, q, r, opts = {}) {
        const seed = `${opts.seed != null ? opts.seed : 'ambient'}|${world && world.day}|${q},${r}`;
        const occupation = AMBIENT_OCCUPATIONS[Math.floor(_hashUnit(`${seed}|who`) * AMBIENT_OCCUPATIONS.length)];
        const ctx = Chatter.context(world, player, { q, r, occupation });
        const pick = Chatter.select(ctx, { seed, filter: Chatter._contextual });
        if (!pick) return null;
        return { occupation, who: PASSERBY[occupation] || 'a passer-by', text: pick.text, id: pick.id, settlementName: ctx.settlementName };
    },

    // ──────────── TAVERN NEWS ────────────

    /**
     * True facts about the region that a tavern hears of (wider radius):
     * [{ kind, tokens }]. Deterministic, draws nothing.
     */
    regionalFacts(world, player, tile) {
        if (!world || !tile) return [];
        const ctx = Chatter.context(world, player, { q: tile.q, r: tile.r, wide: true });
        const base = { settlement: ctx.settlementName, kingdom: ctx.kingdomName, ruler: ctx.ruler };
        const facts = [];
        if (ctx.war) facts.push({ kind: 'war', tokens: { ...base, enemy: ctx.enemy } });
        if (ctx.blockade) facts.push({ kind: 'blockade', tokens: { ...base, blockader: ctx.blockader } });
        if (ctx.siege) facts.push({ kind: 'siege', tokens: { ...base, siegeTown: ctx.siegeTown } });
        for (const ev of ctx.events) {
            if (ev.id === 'rebellion') continue;
            facts.push({ kind: 'event', tokens: { ...base, eventName: ev.name, eventPlace: ev.place } });
        }
        for (const s of ctx.sagas) facts.push({ kind: 'saga', tokens: { ...base, saga: s.name } });
        if (ctx.rival) facts.push({ kind: 'rival', tokens: { ...base, rival: ctx.rival.name, rivalNews: ctx.rival.news } });
        if (ctx.newRuler) facts.push({ kind: 'newRuler', tokens: { ...base, oldRuler: ctx.oldRuler } });
        if (ctx.revolt) facts.push({ kind: 'revolt', tokens: base });
        if (ctx.proclamations.length) facts.push({ kind: 'proclamation', tokens: { ...base, proclamation: ctx.proclamations[0].text } });
        return facts;
    },

    /**
     * One piece of regional news as the tavern tells it. `accurate` (decided by
     * the caller from the source's reliability) picks the true telling or a
     * distorted one. Null when nothing is happening. → { kind, text, accurate }
     */
    tavernNews(world, player, tile, { accurate = true, roll = 0, pick = 0 } = {}) {
        const facts = Chatter.regionalFacts(world, player, tile);
        if (!facts.length) return null;
        const fact = facts[Math.min(facts.length - 1, Math.floor(Math.max(0, roll) * facts.length))];
        const tmpl = (Chatter.data().tavern || {})[fact.kind] || {};
        const pool = (accurate ? tmpl.true : tmpl.false) || tmpl.true || [];
        if (!pool.length) return null;
        const raw = pool[Math.min(pool.length - 1, Math.floor(Math.max(0, pick) * pool.length))];
        const text = String(raw).replace(/\{(\w+)\}/g, (m, k) => (fact.tokens[k] != null ? fact.tokens[k] : m));
        return { kind: fact.kind, text, accurate };
    },

    // ──────────── LLM VOICE ────────────

    /** The context as short plain sentences, for the LLM voice's prompt. */
    promptFacts(ctx) {
        if (!ctx) return '';
        const f = [];
        f.push(`You live in ${ctx.settlementName}, in ${ctx.kingdomName}.`);
        if (ctx.season) f.push(`It is ${ctx.season}${ctx.lean ? ', the lean weeks when food is scarce' : ''}.`);
        if (ctx.war) f.push(`${ctx.kingdomName} is at war with ${ctx.enemy}.`);
        if (ctx.playerWar) f.push(`${ctx.kingdomName} is at war with the player.`);
        if (ctx.blockade) f.push(`${ctx.blockader}'s fleet blockades the port.`);
        if (ctx.siege) f.push(`${ctx.siegeTown} nearby is under siege.`);
        for (const ev of ctx.events.slice(0, 3)) f.push(`There is ${ev.name} at ${ev.place}.`);
        if (ctx.revolt) f.push('Lords or peasants are in revolt in the realm.');
        for (const s of ctx.sagas) f.push(`Everyone talks of "${s.name}".`);
        if (ctx.dearth) f.push(`The market here is short of ; prices are high.`);
        if (ctx.glut) f.push(`The market here is glutted with ; it sells cheap.`);
        if (ctx.strike) f.push(`The ${ctx.strike.guild} is on strike; ${ctx.strike.good} is short.`);
        if (ctx.outlaws) f.push(`Outlaws led by ${ctx.outlaws.leader} hold ${ctx.outlaws.name} nearby and raid the roads.`);
        const MONEY = { debased: 'The coin of the realm has been debased and prices are rising.', levy: 'The crown has raised an extraordinary war levy.',
            default: 'The crown has refused to pay its debts.', bank_run: 'Depositors are running on the bank.', bank_failed: 'A banking house has failed.' };
        for (const m of ctx.money || []) if (MONEY[m.kind]) f.push(MONEY[m.kind]);
        const WORK = { idle: 'Many here are out of work.', refugees: 'Refugees have crowded into the town.', strike: 'The artisans are on strike over the price of bread.',
            boom: 'Times are good: there is work for all and newcomers keep arriving.', hardship: 'The poor are hard-pressed: wages do not cover bread and fuel.',
            mine_strike: 'A new vein has been struck in the hills nearby; miners are coming in.', mine_closed: 'The mine nearby is worked out and its miners are leaving.' };
        for (const k of ctx.labour || []) if (WORK[k]) f.push(WORK[k]);
        if (ctx.rival) f.push(`The adventurer ${ctx.rival.name} passed through recently.`);
        if (ctx.newRuler) f.push(`${ctx.ruler} has newly taken the throne from ${ctx.oldRuler}.`);
        if (ctx.proclamations.length) f.push(`The heralds proclaimed: ${ctx.proclamations[0].text}`);
        for (const d of ctx.deeds.slice(0, 2)) f.push(`Gossip about the player: ${String(d.type).replace(/_/g, ' ')} at ${d.place}.`);
        if (ctx.traits.length) f.push(`The player is known as: ${ctx.traits.map(t => (Traits.TRAITS[t] && Traits.TRAITS[t].name) || t).join(', ')}.`);
        if (ctx.court.length) f.push(`The player's court is known for ${ctx.court.join(' and ')}.`);
        const t = ctx.titles;
        if (t.includes('our_king')) f.push('The player is your king.');
        else if (t.includes('foreign_king')) f.push('The player is a foreign king.');
        if (t.includes('pretender')) f.push('The player is pressing a claim to a throne.');
        if (t.includes('exile')) f.push('The player is an exile.');
        if (ctx.houseGen > 1) f.push(`The player's ${ctx.houseName} is an old family.`);
        return f.join(' ');
    },

    // ──────────── CONTENT INTEGRITY ────────────

    lineCount() {
        return Chatter.groups().reduce((n, g) => n + ((g && Array.isArray(g.lines)) ? g.lines.length : 0), 0);
    },

    /**
     * Problems in data/chatter.json (empty when valid): unknown conditions,
     * bad values, unknown traits / events / sagas / deeds / proclamation kinds,
     * and tokens a line can't fill under its own conditions. Used by tests.
     */
    validate() {
        const problems = [];
        const traits = Object.keys(Traits.TRAITS || {});
        const eventIds = Object.values(WorldEvents.TEMPLATES || {}).map(t => t.id);
        const sagaIds = Object.keys((DataLoader.sagas && DataLoader.sagas.sagas) || {});
        const deedIds = Object.entries((DataLoader.gossip && DataLoader.gossip.rumorTypes) || {}).filter(([, d]) => d && d.deed).map(([id]) => id);
        const heraldKinds = Object.keys(((Chatter.data().heralds || {}).templates) || {});
        const enums = { season: SEASONS, trait: traits, court: COURT_AXES, title: TITLES, occupation: OCCUPATIONS, personality: PERSONALITIES, event: eventIds, saga: sagaIds, deed: deedIds, proclamation: heraldKinds, money: MONEY_KINDS, labour: LABOUR_KINDS };
        const seen = new Set();
        for (const g of Chatter.groups()) {
            const gid = g && g.id;
            if (!gid) { problems.push('group without id'); continue; }
            if (seen.has(gid)) problems.push(`${gid}: duplicate id`);
            seen.add(gid);
            if (!Array.isArray(g.lines) || !g.lines.length) problems.push(`${gid}: no lines`);
            if (g.weight != null && !(g.weight > 0)) problems.push(`${gid}: bad weight`);
            const when = g.when || {};
            for (const [k, v] of Object.entries(when)) {
                const kind = CONDITIONS[k];
                if (!kind) { problems.push(`${gid}: unknown condition '${k}'`); continue; }
                if (kind === 'bool' && typeof v !== 'boolean') problems.push(`${gid}: '${k}' must be true/false`);
                if (kind === 'num' && !(typeof v === 'number' && Number.isFinite(v))) problems.push(`${gid}: '${k}' must be a number`);
                const isList = Array.isArray(v);
                if (kind === 'list' && (!isList || !v.length)) problems.push(`${gid}: '${k}' must be a non-empty list`);
                if (kind === 'boolOrList' && typeof v !== 'boolean' && (!isList || !v.length)) problems.push(`${gid}: '${k}' must be true/false or a non-empty list`);
                if (isList && enums[k]) {
                    for (const x of v) if (!enums[k].includes(x)) problems.push(`${gid}: unknown ${k} '${x}'`);
                }
            }
            for (const text of g.lines || []) {
                if (typeof text !== 'string' || !text.trim()) { problems.push(`${gid}: empty line`); continue; }
                for (const [, tok] of text.matchAll(/\{(\w+)\}/g)) {
                    if (ALWAYS_TOKENS.includes(tok)) continue;
                    const need = TOKEN_NEEDS[tok];
                    if (!need) problems.push(`${gid}: unknown token {${tok}}`);
                    else if (!when[need]) problems.push(`${gid}: {${tok}} needs the '${need}' condition`);
                }
            }
        }
        // Heralds and tavern templates
        const H = Chatter.data().heralds || {};
        const heraldTokens = ['ruler', 'kingdom', 'other', 'saga', 'title', 'leader', 'place', 'by', 'days', 'bank', 'purity',
            // caravans lost on the road (systems/merchantCaravans.js)
            'good', 'carrier', 'from', 'house',
            // market fairs, dearths and gluts (systems/marketFairs.js)
            'fair', 'pct',
            // refugees, strikes and booms (systems/labour.js)
            'to', 'n', 'why',
            // town guilds' strikes, elections, charters (systems/guilds.js)
            'guild', 'master', 'reason',
            // the hinterland's strikes, veins, worked-out mines (systems/concessions.js)
            'site'];
        for (const [kind, list] of Object.entries(H.templates || {})) {
            if (!Array.isArray(list) || !list.length) problems.push(`heralds.${kind}: no templates`);
            for (const t of list || []) for (const [, tok] of String(t).matchAll(/\{(\w+)\}/g)) {
                if (!heraldTokens.includes(tok)) problems.push(`heralds.${kind}: unknown token {${tok}}`);
            }
            if (!(H.priority && H.priority[kind] != null)) problems.push(`heralds.${kind}: no priority`);
        }
        const tavernTokens = ['settlement', 'kingdom', 'ruler', 'enemy', 'blockader', 'siegeTown', 'eventName', 'eventPlace', 'saga', 'rival', 'rivalNews', 'oldRuler', 'proclamation'];
        for (const kind of ['war', 'blockade', 'siege', 'event', 'saga', 'rival', 'newRuler', 'revolt', 'proclamation']) {
            const t = (Chatter.data().tavern || {})[kind];
            if (!t || !Array.isArray(t.true) || !t.true.length || !Array.isArray(t.false) || !t.false.length) {
                problems.push(`tavern.${kind}: needs true and false tellings`);
                continue;
            }
            for (const s of [...t.true, ...t.false]) for (const [, tok] of String(s).matchAll(/\{(\w+)\}/g)) {
                if (!tavernTokens.includes(tok)) problems.push(`tavern.${kind}: unknown token {${tok}}`);
            }
        }
        return problems;
    },
};
