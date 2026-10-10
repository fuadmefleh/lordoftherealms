// ============================================
// THE STEWARD'S COUNSEL — what matters right now
// ============================================
// The game has some forty systems; the Steward reads them all and says which
// few things deserve the player's attention today, in three groups:
//
//   THREATS        sieges, revolts, war hosts, sickness, hunger, unpaid men,
//                  expiring petitions, heat, blockades, nemeses, sagas...
//   OPPORTUNITIES  contracts, cheap harvests, delves, bounties, heirs to
//                  place, matches, free edict slots, claims to press...
//   GOALS          the House Ambition, the next trait, the next rank, the
//                  legacy score.
//
// Every item has a severity (critical / warning / notice / info), a short
// line, a priority and an action hook: an ActionMenu panel id
// (ui/actionMenu/counsel.js maps ids to panels) and/or a map hex to focus.
//
// RULES are data (data/counsel.json → rules): { id, group, reader, priority,
// severity, icon, text, panel, params, max, heavy }. A rule names a READER
// (a function below) that returns zero or more FACTS — plain objects whose
// fields fill the text template ("{name} is under siege") and may override
// severity, priority, panel and the hex (q, r). To add a rule, add a JSON
// entry; when no reader fits, add one to READERS.
//
// Read-only: readers never create, backfill or change any state (they read
// raw fields and only call helpers that are pure), draw no randomness and
// tolerate missing systems and old saves — a reader that throws is skipped.
// Results are memoised per player per day; rules marked `heavy` (whole-world
// scans) run at most once a day even when the panel asks for a fresh scan.

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Seasons } from '../world/seasons.js';
import { House } from './house.js';
import { Legacy } from './legacy.js';
import { Ailments } from './ailments.js';
import { Kingship } from './kingship.js';
import { Ships } from './ships.js';
import { Underworld } from './underworld.js';
import { Petitions } from './petitions.js';
import { Rivals } from './rivals.js';
import { Sagas } from './sagas.js';
import { Companions } from './companions.js';
import { Relationships } from './relationships.js';
import { Delves } from './delves.js';
import { Throne } from './throne.js';
import { Traits } from './traits.js';
import { BountyHunting } from './bountyHunting.js';
import { Holdings } from './holdings.js';
import { KingdomNavy } from '../world/kingdomNavy.js';
import { Patronage } from './patronage.js';
import { Finance } from './finance.js';
import { Underwriting } from './underwriting.js';
import { Bills } from './bills.js';
import { Bourse } from './bourse.js';
import { Mints } from './mints.js';
import { MarketFairs } from './marketFairs.js';
import { Guilds } from './guilds.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { TownLabour } from '../world/townLabour.js';
import { Hinterland } from '../world/hinterland.js';
import { Harvests } from '../world/harvests.js';
import { Transport } from '../world/transport.js';
import { PublicWorks } from './publicWorks.js';
import { TradePolicy } from './tradePolicy.js';
import { EconomyIndex } from '../world/economyIndex.js';
import { Fashions } from '../world/fashions.js';

export const GROUPS = ['threat', 'opportunity', 'goal'];
export const SEVERITIES = { critical: 3, warning: 2, notice: 1, info: 0 };

function _num(v, d = 0) {
    return typeof v === 'number' && Number.isFinite(v) ? v : d;
}
function _obj(v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}
function _arr(v) {
    return Array.isArray(v) ? v : [];
}

/** Fill "{key}" placeholders; numbers are rounded, missing keys are blank. */
export function fillTemplate(template, vars) {
    return String(template || '').replace(/\{(\w+)\}/g, (_, k) => {
        const v = vars ? vars[k] : undefined;
        if (v === undefined || v === null) return '';
        if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v)) : '';
        return String(v);
    });
}

// Memo: player → { day, world, items } (full scan) and → { day, world, facts: {ruleId: facts} } (heavy readers)
const _memo = new WeakMap();
const _heavy = new WeakMap();

export const Counsel = {
    READERS: {},

    data() {
        return _obj(DataLoader.counsel) || {};
    },

    config() {
        return { maxPerRule: 3, nearby: 6, briefCount: 3, ...(_obj(Counsel.data().config) || {}) };
    },

    /** The rule list (data/counsel.json → rules), well-formed entries only. */
    rules() {
        return _arr(Counsel.data().rules).filter(r => r && typeof r.id === 'string' && GROUPS.includes(r.group) && typeof r.reader === 'string');
    },

    /** Forget the memo (after an action that changes what the Steward would say). */
    invalidate(player) {
        if (player && typeof player === 'object') _memo.delete(player);
    },

    /** Build the context readers share: distances, the day, a per-scan cache. */
    _ctx(player, world) {
        const width = world && Number.isFinite(world.width) ? world.width : 0;
        const pq = _num(player && player.q, NaN);
        const pr = _num(player && player.r, NaN);
        const cfg = Counsel.config();
        const ctx = {
            player, world, cfg,
            day: world && Number.isFinite(world.day) ? world.day : 0,
            cache: {},
            /** Hex distance from the player (Infinity when either end is unknown). */
            dist(q, r) {
                if (!Number.isFinite(q) || !Number.isFinite(r) || !Number.isFinite(pq) || !Number.isFinite(pr)) return Infinity;
                return width > 0 ? Hex.wrappingDistance(pq, pr, q, r, width) : Hex.distance(pq, pr, q, r);
            },
            near(q, r, within = cfg.nearby) {
                return ctx.dist(q, r) <= within;
            },
            /** The world tile at (q, r), or null. */
            tile(q, r) {
                try {
                    return world && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
                } catch (e) {
                    return null;
                }
            },
            /** Memoise a value for the rest of this scan. */
            once(key, fn) {
                if (!(key in ctx.cache)) ctx.cache[key] = fn();
                return ctx.cache[key];
            },
        };
        return ctx;
    },

    /** Run one rule; returns its items (never throws). */
    _runRule(rule, ctx, heavyFacts) {
        const reader = Counsel.READERS[rule.reader];
        if (typeof reader !== 'function') return [];
        let facts;
        if (rule.heavy && heavyFacts && Object.prototype.hasOwnProperty.call(heavyFacts, rule.id)) {
            facts = heavyFacts[rule.id];
        } else {
            try {
                facts = reader(ctx, _obj(rule.params) || {});
            } catch (e) {
                facts = [];
            }
            if (!Array.isArray(facts)) facts = facts && typeof facts === 'object' ? [facts] : [];
            if (rule.heavy && heavyFacts) heavyFacts[rule.id] = facts;
        }
        const max = Number.isFinite(rule.max) ? rule.max : ctx.cfg.maxPerRule;
        const items = [];
        for (const f of facts) {
            if (!f || typeof f !== 'object') continue;
            const severity = SEVERITIES[f.severity] !== undefined ? f.severity
                : SEVERITIES[rule.severity] !== undefined ? rule.severity : 'notice';
            const q = Number.isFinite(f.q) ? f.q : null;
            const r = Number.isFinite(f.r) ? f.r : null;
            const panel = f.panel !== undefined ? f.panel : (rule.panel || null);
            const text = fillTemplate(f.text || rule.text || rule.id, f);
            if (!text) continue;
            items.push({
                id: f.key !== undefined ? `${rule.id}:${f.key}` : rule.id,
                rule: rule.id,
                group: rule.group,
                severity,
                priority: _num(rule.priority) + _num(f.boost),
                icon: f.icon || rule.icon || '•',
                text,
                action: { panel: typeof panel === 'string' && panel ? panel : null, q, r, arg: f.arg !== undefined ? f.arg : null },
            });
        }
        items.sort(Counsel.compare);
        return items.slice(0, Math.max(0, max));
    },

    /** Most pressing first: severity, then priority, then id (stable). */
    compare(a, b) {
        return (SEVERITIES[b.severity] - SEVERITIES[a.severity])
            || (b.priority - a.priority)
            || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    },

    /**
     * Scan the player's world. Returns
     *   { day, threats:[item], opportunities:[item], goals:[item], items:[item] }
     * where item = { id, rule, group, severity, priority, icon, text, action:{ panel, q, r } }.
     * Memoised per day; { fresh: true } re-reads everything but heavy rules.
     */
    scan(player, world, opts = {}) {
        const empty = { day: world && Number.isFinite(world.day) ? world.day : 0, threats: [], opportunities: [], goals: [], items: [] };
        if (!player || typeof player !== 'object') return empty;
        const day = empty.day;
        const memo = _memo.get(player);
        if (!opts.fresh && memo && memo.day === day && memo.world === world) return memo.result;

        let heavy = _heavy.get(player);
        if (!heavy || heavy.day !== day || heavy.world !== world) {
            heavy = { day, world, facts: {} };
            _heavy.set(player, heavy);
        }
        const ctx = Counsel._ctx(player, world);
        const items = [];
        for (const rule of Counsel.rules()) {
            if (rule.enabled === false) continue;
            items.push(...Counsel._runRule(rule, ctx, heavy.facts));
        }
        items.sort(Counsel.compare);
        const result = {
            day,
            threats: items.filter(i => i.group === 'threat'),
            opportunities: items.filter(i => i.group === 'opportunity'),
            goals: items.filter(i => i.group === 'goal'),
            items,
        };
        _memo.set(player, { day, world, result });
        return result;
    },

    /**
     * The morning brief: the top `n` items worth a notification (severity
     * notice or above; config.briefMinSeverity), threats before opportunities
     * before goals. Empty on a quiet day.
     */
    brief(player, world, n = null) {
        const cfg = Counsel.config();
        const count = Number.isFinite(n) ? n : cfg.briefCount;
        const min = SEVERITIES[cfg.briefMinSeverity] !== undefined ? SEVERITIES[cfg.briefMinSeverity] : SEVERITIES.notice;
        const s = Counsel.scan(player, world);
        return [...s.threats, ...s.opportunities, ...s.goals]
            .filter(i => SEVERITIES[i.severity] >= min)
            .slice(0, Math.max(0, count));
    },

    /** How many threats the Steward sees (the HUD badge). */
    threatCount(player, world) {
        return Counsel.scan(player, world).threats.length;
    },
};

// ──────────────────────────────────────────────────────────────
// READERS — (ctx, params) => facts[]. Read raw state; never mutate.
// ──────────────────────────────────────────────────────────────

const R = Counsel.READERS;

const _kingdomName = (world, id) => {
    const k = id && world && typeof world.getKingdom === 'function' ? world.getKingdom(id) : null;
    return (k && k.name) || 'a rival realm';
};
const _days = (n) => `${Math.max(0, Math.round(n))} day${Math.round(n) === 1 ? '' : 's'}`;

/** The ruled realm's court, only when it is already well-formed (Kingship.court backfills). */
function _court(player) {
    const c = player && player.throne && player.throne.ruling && player.throne.ruling.court;
    if (!_obj(c) || !_obj(c.council) || !_obj(c.edicts) || !_obj(c.mods) || !_obj(c.stats)) return null;
    if (!Array.isArray(c.vassals) || !Array.isArray(c.factions) || !Array.isArray(c.log)) return null;
    return c;
}

/** World units by id (built once per scan). */
function _units(ctx) {
    return ctx.once('unitsById', () => {
        const m = new Map();
        for (const u of _arr(ctx.world && ctx.world.units)) if (u && u.id !== undefined) m.set(u.id, u);
        return m;
    });
}

function _food(player) {
    return typeof player.getFoodCount === 'function' ? _num(player.getFoodCount()) : 0;
}

function _armyStrength(player) {
    return _arr(player.army).reduce((s, u) => s + _num(u && u.strength), 0);
}

// ── THREATS ──────────────────────────────────────────────────

R.holdingSieges = (ctx, p) => Object.values(_obj(ctx.player.realmWars && ctx.player.realmWars.besieged) || {}).filter(Boolean).map(s => ({
    key: s.key || `${s.q},${s.r}`, q: s.q, r: s.r,
    name: s.name || 'Your holding', enemy: s.kingdomName || 'the enemy', stores: _num(s.stores),
    days: ctx.day - _num(s.startDay, ctx.day),
    severity: _num(s.stores) <= _num(p.criticalStores, 7) ? 'critical' : 'warning',
    boost: -_num(s.stores) / 10,
}));

R.revolt = (ctx) => {
    const c = _court(ctx.player);
    const rv = c && c.revolt;
    if (!rv) return [];
    return [{ leader: rv.leaderName || 'a rebel lord', hosts: _arr(rv.hosts).length, days: ctx.day - _num(rv.startDay, ctx.day) }];
};

R.factions = (ctx, p) => {
    const c = _court(ctx.player);
    if (!c || c.revolt || !Throne.ruledKingdom(ctx.player, ctx.world)) return [];
    const cfg = Kingship.config().factions || {};
    const warnAt = _num(cfg.ultimatumThreat, 0.3) * _num(p.warnShare, 0.8);
    const out = [];
    for (const f of c.factions) {
        if (!f || !f.revealed || !Array.isArray(f.members)) continue;
        const threat = Kingship.threat(ctx.player, ctx.world, f);
        const due = f.ultimatum && Number.isFinite(f.ultimatum.dueDay) ? f.ultimatum.dueDay - ctx.day : null;
        if (due === null && threat < warnAt) continue;
        const leader = c.vassals.find(v => v && v.id === f.leaderId);
        const demand = f.demand ? Kingship.demandText(f.demand).label : 'concessions';
        out.push({
            key: f.id, leader: Kingship.fullName(leader), demand,
            threat: Math.round(threat * 100),
            when: due !== null ? `: ultimatum ends in ${_days(due)}` : '',
            severity: due !== null || threat >= _num(cfg.revoltThreat, 0.45) ? 'critical' : 'warning',
            boost: threat * 10,
        });
    }
    return out;
};

R.holdingUnrest = (ctx, p) => {
    const out = [];
    for (const h of Holdings.list(ctx.player, ctx.world)) {
        const hold = h && h.settlement && h.settlement.holding;
        if (!hold) continue;
        const unrest = _num(hold.unrest);
        if (!hold.rebellion && unrest < _num(p.warnAt, 60)) continue;
        out.push({
            key: h.key, q: h.q, r: h.r, name: h.settlement.name || 'A holding', unrest,
            text: hold.rebellion ? '{name} has risen in rebellion' : undefined,
            severity: hold.rebellion || unrest >= _num(p.riskAt, 75) ? 'critical' : 'warning',
            boost: unrest / 10,
        });
    }
    return out;
};

R.warHosts = (ctx, p) => {
    const player = ctx.player;
    const radius = _num(p.radius, 10);
    const units = _units(ctx);
    const out = [];
    const consider = (host, realm, rebel) => {
        if (!host) return;
        const u = units.get(host.id);
        if (u && u.destroyed) return;
        const q = u ? u.q : host.q;
        const r = u ? u.r : host.r;
        const d = ctx.dist(q, r);
        const target = host.target || {};
        const targetsYou = target.kind === 'player' || target.kind === 'holding';
        if (d > radius && !targetsYou) return;
        out.push({
            key: host.id, q, r, host: host.name || 'A war host', realm, dist: d === Infinity ? '?' : d,
            target: target.name ? ` on ${target.name}` : '',
            strength: _num(host.strength),
            severity: d <= _num(p.criticalRadius, 4) ? 'critical' : 'warning',
            boost: -Math.min(d, 50) / 5 + (rebel ? 1 : 0),
        });
    };
    for (const w of Object.values(_obj(player.realmWars && player.realmWars.wars) || {})) {
        for (const h of _arr(w && w.hosts)) consider(h, (w && w.name) || _kingdomName(ctx.world, w && w.kingdomId), false);
    }
    const c = _court(player);
    if (c && c.revolt) for (const h of _arr(c.revolt.hosts)) consider(h, 'the rebels', true);
    return out;
};

R.ultimatums = (ctx) => Object.values(_obj(ctx.player.realmWars && ctx.player.realmWars.ultimatums) || {}).filter(u => u && Number.isFinite(u.dueDay)).map(u => ({
    key: u.kingdomId, realm: _kingdomName(ctx.world, u.kingdomId), tribute: _num(u.tribute),
    left: _days(u.dueDay - ctx.day),
    severity: u.dueDay - ctx.day <= 3 ? 'critical' : 'warning',
}));

R.ailments = (ctx, p) => {
    const out = [];
    for (const a of Ailments.list(ctx.player)) {
        if (!a) continue;
        if (a.kind === 'disease') {
            const def = Ailments.def(a.id) || {};
            const stage = _arr(def.stages)[_num(a.stage)] || {};
            const deadly = _num(stage.deathChance) > 0;
            if (!deadly && !p.allDiseases) continue;
            out.push({
                key: a.key || a.id, icon: stage.icon || def.icon, name: def.name || a.id, stage: stage.name || 'sick',
                text: deadly ? undefined : '{name} ({stage}): rest and medicine will mend it',
                severity: deadly ? (a.treated ? 'warning' : 'critical') : 'notice',
            });
        } else if (a.kind === 'wound' && a.infected) {
            out.push({ key: a.key || a.id, icon: '🩹', name: a.name || 'A wound', stage: 'infected', text: '{name} has festered: have it treated', severity: 'warning' });
        }
    }
    return out;
};

R.hunger = (ctx, p) => {
    const player = ctx.player;
    const starving = _num(player.starvationDays);
    if (starving > 0) return [{ days: starving, text: 'You are starving ({days} days without food): eat or buy food now', severity: 'critical' }];
    if (player.boardedShip) return []; // at sea the captain eats from the ship's hold
    const food = _food(player);
    if (food > _num(p.lowDays, 3)) return [];
    return [{ food, severity: food <= 1 ? 'critical' : 'warning' }];
};

R.shipProvisions = (ctx, p) => {
    const out = [];
    for (const ship of _arr(ctx.player.ships)) {
        if (!ship || ship.sunk) continue;
        const atSea = !!ship.voyage || ctx.player.boardedShip === ship.id;
        if (!atSea) continue;
        const days = Ships.getProvisionDays(ship);
        if (!Number.isFinite(days) || days > _num(p.days, 3)) continue;
        out.push({ key: ship.id, name: ship.name || 'Your ship', days, severity: days <= 1 ? 'critical' : 'warning' });
    }
    return out;
};

R.heat = (ctx) => {
    const heat = _obj(ctx.player.underworld && ctx.player.underworld.heat);
    if (!heat) return [];
    const out = [];
    for (const [kid, h] of Object.entries(heat)) {
        const level = Underworld.heatLevel(_num(h));
        if (level === 'clear') continue;
        out.push({
            key: kid, realm: _kingdomName(ctx.world, kid), heat: _num(h),
            level: level === 'warrant' ? 'a warrant is out' : level === 'poster' ? 'your face is on posters' : 'the watch knows you',
            severity: level === 'warrant' ? 'critical' : level === 'poster' ? 'warning' : 'notice',
            boost: _num(h) / 20,
        });
    }
    return out;
};

R.petitions = (ctx, p) => Petitions.pending(ctx.player).filter(pt => pt && Number.isFinite(pt.expiresDay)).map(pt => {
    const left = Petitions.daysLeft(pt, ctx.world);
    return { key: pt.id, icon: pt.icon, title: pt.title || 'A petition', left: _days(left), daysLeft: left };
}).filter(f => f.daysLeft <= _num(p.days, 3)).map(f => ({ ...f, severity: f.daysLeft <= 1 ? 'critical' : 'warning', boost: -f.daysLeft }));

R.unpaid = (ctx, p) => {
    const player = ctx.player;
    const gold = _num(player.gold);
    const out = [];
    for (const m of _arr(player.mercenaryCompanies)) {
        if (!m) continue;
        const wage = _num(m.dailyWage);
        if (gold < wage) out.push({ key: `merc:${m.id}`, name: m.name || 'Your mercenaries', what: `cannot be paid their ${wage} gold a day`, severity: 'critical' });
        else if (_num(m.loyalty, 100) < _num(p.mercLoyalty, 45)) out.push({ key: `merc:${m.id}`, name: m.name || 'Your mercenaries', what: `wavers (loyalty ${Math.round(_num(m.loyalty))}) and may take a better offer`, severity: 'warning' });
    }
    let crewWages = 0;
    for (const ship of _arr(player.ships)) if (ship && !ship.sunk) crewWages += _num(Ships.getDailyWages(ship));
    if (crewWages > 0 && gold < crewWages) out.push({ key: 'crew', name: 'Your crews', what: `are owed ${Math.round(crewWages)} gold a day you do not have`, severity: 'warning', panel: 'fleet' });
    for (const id of _arr(player.travelParty)) {
        const npc = Relationships.getNPC(id);
        const c = npc && npc.companion;
        if (!c || !(_num(c.unpaid) > 0)) continue;
        out.push({ key: `comp:${id}`, name: npc.firstName || npc.name || 'A companion', what: `is owed wages (${_num(c.unpaid)} missed payday${_num(c.unpaid) === 1 ? '' : 's'})`, severity: 'warning' });
    }
    return out;
};

R.companionDesertion = (ctx, p) => {
    const cfg = Companions.config();
    const leave = _num(cfg.leaveApproval, 20);
    const out = [];
    for (const id of _arr(ctx.player.travelParty)) {
        const npc = Relationships.getNPC(id);
        const c = npc && npc.companion;
        if (!c || !Number.isFinite(c.approval)) continue;
        if (c.approval > leave + _num(p.margin, 8)) continue;
        out.push({ key: id, name: npc.firstName || npc.name || 'A companion', approval: c.approval, severity: c.approval <= leave ? 'critical' : 'warning', boost: -c.approval / 10 });
    }
    return out;
};

R.nemesis = (ctx, p) => {
    const out = [];
    for (const r of _arr(ctx.player.rivals && ctx.player.rivals.list)) {
        if (!r || r.dead || !Rivals.isNemesis(r)) continue;
        const d = ctx.dist(r.q, r.r);
        if (d > _num(p.radius, 8)) continue;
        out.push({ key: r.id, q: r.q, r: r.r, name: r.name || 'Your nemesis', dist: d, severity: d <= _num(p.criticalRadius, 3) ? 'critical' : 'warning', boost: -d });
    }
    return out;
};

R.sagas = (ctx, p) => {
    const out = [];
    for (const s of _arr(ctx.player.sagas && ctx.player.sagas.active)) {
        if (!s || !s.known) continue;
        const t = Sagas.template(s.id) || {};
        const ch = Sagas.chapterDef(s) || {};
        const site = (s.anchor && (s.anchor.site || s.anchor.settlement)) || null;
        const d = site ? ctx.dist(site.q, site.r) : Infinity;
        const near = d <= _num(p.radius, 10) || !!s.involved;
        if (Number.isFinite(s.chapterEnds) && s.chapterEnds - ctx.day <= _num(p.days, 5) && near) {
            out.push({
                key: `${s.uid}:ch`, q: site ? site.q : undefined, r: site ? site.r : undefined,
                saga: t.name || t.title || 'A saga', chapter: ch.title ? Sagas.fill(ch.title, s) : (s.chapter || 'its chapter'),
                left: _days(s.chapterEnds - ctx.day), place: (site && site.name) || 'your path',
            });
        }
        for (const u of _arr(s.units)) {
            if (!u || u.slain || u.gone) continue;
            const ud = ctx.dist(u.q, u.r);
            if (ud > _num(p.beastRadius, 5)) continue;
            out.push({
                key: `${s.uid}:${u.key}`, q: u.q, r: u.r, icon: '🐉', saga: t.name || 'A saga',
                text: `${u.name || 'A saga beast'} prowls ${ud} hexes away`, severity: ud <= 2 ? 'critical' : 'warning', boost: -ud,
            });
        }
    }
    return out;
};

R.leanSeason = (ctx, p) => {
    if (!Number.isFinite(ctx.world && ctx.world.day)) return [];
    let until = null;
    for (let ahead = 0; ahead <= _num(p.ahead, 15); ahead++) {
        if (Seasons.isLean(ctx.day + ahead)) { until = ahead; break; }
    }
    if (until === null) return [];
    const food = _food(ctx.player);
    if (food >= _num(p.minFood, 10)) return [];
    return [{ food, when: until === 0 ? 'are upon you' : `begin in ${_days(until)}`, severity: until === 0 ? 'warning' : 'notice' }];
};

R.discoveryContests = (ctx) => _arr(ctx.player.discovery && ctx.player.discovery.sites).filter(s => s && s.contest).map(s => ({
    key: s.id, q: s.q, r: s.r, name: s.name || 'your discovery', realm: s.contest.kingdomName || _kingdomName(ctx.world, s.contest.kingdomId),
    left: Number.isFinite(s.contest.deadline) ? `answer within ${_days(s.contest.deadline - ctx.day)}` : 'answer soon',
    severity: Number.isFinite(s.contest.deadline) && s.contest.deadline - ctx.day <= 3 ? 'critical' : 'warning',
}));

R.blockade = (ctx) => {
    const out = [];
    const ruled = Throne.ruledKingdom(ctx.player, ctx.world);
    if (ruled && KingdomNavy.isBlockaded(ruled)) {
        const by = KingdomNavy.blockaders(ruled).map(id => _kingdomName(ctx.world, id)).join(', ');
        out.push({ key: 'realm', realm: ruled.name, by: by || 'enemy fleets', severity: 'warning' });
    }
    if (Number.isFinite(ctx.player.q) && ctx.world) {
        const here = KingdomNavy.portBlockade(ctx.world, ctx.player.q, ctx.player.r);
        if (here && (!ruled || here.kingdom !== ruled)) {
            out.push({
                key: 'port', realm: here.kingdom.name, by: here.blockaders.map(k => k.name).join(', '),
                text: here.closed ? 'This port is closed by a blockade ({by})' : 'This port is blockaded by {by}: prices suffer',
                severity: here.closed ? 'warning' : 'notice',
            });
        }
    }
    return out;
};

// ── OPPORTUNITIES ────────────────────────────────────────────

R.contracts = (ctx) => {
    const company = ctx.player.merchant && ctx.player.merchant.company;
    const inv = _obj(ctx.player.inventory) || {};
    const out = [];
    for (const c of _arr(company && company.contracts)) {
        if (!c || (c.status && c.status !== 'active')) continue;
        const need = _num(c.qty) - _num(c.delivered);
        if (need <= 0 || _num(inv[c.good]) < need) continue;
        out.push({ key: c.id, q: c.q, r: c.r, qty: need, good: c.good, town: c.town || 'the buyer', pay: _num(c.pay) * need, boost: _num(c.pay) * need / 500 });
    }
    const ac = ctx.player.activeContract;
    if (_obj(ac) && Number.isFinite(ac.daysRemaining) && ac.daysRemaining <= 2) {
        out.push({ key: 'merc', text: `Your service to ${ac.name || 'your employer'} ends soon: its pay is near`, severity: 'info', panel: null });
    }
    return out;
};

R.cheapFood = (ctx, p) => {
    if (!Number.isFinite(ctx.world && ctx.world.day)) return [];
    const good = p.good || 'grain';
    const mod = Seasons.priceModifier(good, ctx.day);
    if (mod > _num(p.threshold, -0.2) || _num(ctx.player.gold) < _num(p.minGold, 50)) return [];
    if (Seasons.priceTrend(good, ctx.day) === 'falling') return [];
    return [{ pct: Math.round(-mod * 100) }];
};

R.delveSites = (ctx, p) => {
    const player = ctx.player;
    if ((player.delves && player.delves.active) || !Number.isFinite(player.q) || !ctx.world) return [];
    let best = null;
    for (const h of Hex.hexesInRange(player.q, player.r, _num(p.radius, 5))) {
        const q = ctx.world.width > 0 ? Hex.wrapQ(h.q, ctx.world.width) : h.q;
        const tile = ctx.tile(q, h.r);
        if (!tile || !Delves.isDelveSite(tile)) continue;
        const d = ctx.dist(q, h.r);
        if (!best || d < best.dist) best = { q, r: h.r, dist: d, tile };
    }
    if (!best) return [];
    const info = Delves.siteInfo(best.tile) || {};
    return [{ key: `${best.q},${best.r}`, q: best.q, r: best.r, icon: info.icon, site: info.name || 'A ruin', dist: best.dist }];
};

/**
 * A merchant caravan or trading ship near the player that would hire an
 * escort (systems/merchantCaravans.js — raw reads of world.units): the
 * nearest one not already guarded, while the player guards none.
 */
R.escortJobs = (ctx, p) => {
    const units = _arr(ctx.world && ctx.world.units)
        .filter(u => u && !u.destroyed && (u.type === 'trade_caravan' || u.type === 'trade_ship'));
    if (units.some(u => u.escort && u.escort.by === 'player')) return [];
    const radius = _num(p.radius, 4);
    let best = null;
    for (const u of units) {
        if (u.escort || (u.type === 'trade_ship' && !(ctx.player && ctx.player.boardedShip))) continue;
        const d = ctx.dist(u.q, u.r);
        if (d <= radius && (!best || d < best.d)) best = { u, d };
    }
    if (!best) return [];
    const u = best.u;
    return [{
        key: `escort:${u.id}`, q: u.q, r: u.r, dist: best.d,
        house: (u.house && u.house.name) || 'A merchant house', pay: _num(u.escortPay),
        cargo: String(u.mainGood || 'goods').replace(/_/g, ' '), carrier: u.carrier || 'caravan',
        from: u.fromName || 'a town', to: u.toName || 'a town',
        danger: u.danger ? ' (the road runs near outlaws)' : '',
        boost: u.danger ? 2 : 0,
    }];
};

// Outlaw lairs (systems/outlawLairs.js) — raw reads of player.outlawLairs
function _lairsKnown(ctx) {
    const st = ctx.player.outlawLairs;
    return _arr(st && st.lairs).filter(l => l && l.status === 'active' && l.known);
}

function _lairSpares(l, day) {
    return !!(l.allied || (l.tribute && _num(l.tribute.until) >= day));
}

/** Known lairs within reach of the player's holdings (or the player) whose riders are out. */
R.outlawThreats = (ctx, p) => {
    const out = [];
    const radius = _num(p.radius, 9);
    const holds = Holdings.list(ctx.player, ctx.world) || [];
    const width = ctx.world && ctx.world.width;
    for (const l of _lairsKnown(ctx)) {
        if (_lairSpares(l, ctx.day)) continue;
        let place = null;
        let d = Infinity;
        for (const h of holds) {
            if (!h || !Number.isFinite(h.q)) continue;
            const hd = width > 0 ? Hex.wrappingDistance(h.q, h.r, l.q, l.r, width) : Hex.distance(h.q, h.r, l.q, l.r);
            if (hd <= radius && hd < d) { d = hd; place = (h.settlement && h.settlement.name) || 'your holding'; }
        }
        const pd = ctx.dist(l.q, l.r);
        if (!place && pd <= _num(p.nearRadius, 4)) { place = 'you'; d = pd; }
        if (!place) continue;
        const riding = _arr(l.parties).length;
        out.push({
            key: `lair:${l.id}`, q: l.q, r: l.r, lair: l.name, leader: (l.leader && l.leader.name) || 'its chief', place, dist: d,
            riding: riding ? `, ${riding} band${riding === 1 ? '' : 's'} riding` : '',
            severity: riding && place !== 'you' ? 'warning' : 'notice', boost: _num(l.notoriety) / 20,
        });
    }
    return out;
};

/** Known lairs the player could take on: a chief with a price, a hoard, a leaderless band. */
R.outlawTargets = (ctx, p) => {
    const out = [];
    const radius = _num(p.radius, 12);
    for (const l of _lairsKnown(ctx)) {
        if (l.allied) continue;
        const d = ctx.dist(l.q, l.r);
        if (d > radius) continue;
        const leaderless = !!(l.leader && l.leader.slain);
        out.push({
            key: `lairT:${l.id}`, q: l.q, r: l.r, lair: l.name, dist: d,
            what: leaderless ? 'leaderless and quarrelling' : `held by ${(l.leader && l.leader.name) || 'a chief'}`,
            boost: (leaderless ? 2 : 0) - d / 6,
        });
    }
    return out;
};

R.bounties = (ctx) => {
    const out = [];
    const active = _arr(ctx.player.activeBounties);
    const taken = new Set(active.map(b => b && b.id));
    const here = ctx.tile(ctx.player.q, ctx.player.r);
    const offers = _arr(ctx.player.bountyHunter && ctx.player.bountyHunter.boardOffers).filter(o => o && !taken.has(o.id));
    if (here && here.settlement && offers.length) {
        out.push({ key: 'board', n: offers.length, town: here.settlement.name || 'this town' });
    }
    for (const s of _arr(ctx.player.sagas && ctx.player.sagas.active)) {
        if (!s || !s.known) continue;
        for (const u of _arr(s.units)) {
            if (!u || u.slain || u.gone || !(_num(u.bounty) > 0)) continue;
            if (active.some(b => b && b.type === 'saga_beast' && (b.unitKey === u.key || b.targetQ === u.q && b.targetR === u.r))) continue;
            out.push({ key: `saga:${s.uid}:${u.key}`, q: u.q, r: u.r, text: `${u.name || 'A saga beast'} carries a ${Math.round(u.bounty)} gold bounty`, boost: _num(u.bounty) / 200 });
        }
    }
    return out;
};

function _grownUnplaced(player) {
    return _arr(player.children).filter(c => c && c.isAlive !== false && c.upbringing && c.upbringing.comeOfAge
        && !c.spouseId && !c.upbringing.spouse
        && !(c.upbringing.placement && c.upbringing.placement.kind === 'ward' && !c.upbringing.placement.returned));
}

R.heirs = (ctx) => _grownUnplaced(ctx.player).map(c => ({ key: c.id, arg: c.id, name: c.firstName || 'Your child', age: _num(c.age) }));

R.royalMatch = (ctx) => {
    const player = ctx.player;
    const kids = _grownUnplaced(player);
    if (!kids.length || !ctx.world) return [];
    const tcfg = Throne.config();
    if (_num(player.gold) < _num(tcfg.royalMatchGold, 500)) return [];
    if (_num(player.house && player.house.prestige) < _num(tcfg.royalMatchPrestige, 20)) return [];
    const rep = _obj(player.reputation) || {};
    for (const k of _arr(ctx.world.kingdoms)) {
        if (!k || !k.isAlive || _num(rep[k.id]) < _num(tcfg.royalMatchMinReputation, 20)) continue;
        const royal = Throne.royalMatchCandidates(ctx.world, k.id)[0];
        if (!royal) continue;
        return [{ key: `${kids[0].id}:${k.id}`, arg: kids[0].id, name: kids[0].firstName || 'your heir', realm: k.name, royal: royal.firstName || 'a royal' }];
    }
    return [];
};

R.edictSlots = (ctx) => {
    const c = _court(ctx.player);
    if (!c || !Throne.ruledKingdom(ctx.player, ctx.world)) return [];
    const free = Kingship.edictSlots(ctx.player, ctx.world) - Object.keys(c.edicts).length;
    return free > 0 ? [{ free, s: free === 1 ? '' : 's', stand: free === 1 ? 'stands' : 'stand' }] : [];
};

R.claims = (ctx) => {
    const player = ctx.player;
    const claims = _obj(player.throne && player.throne.claims);
    if (!claims || !ctx.world || typeof ctx.world.getKingdom !== 'function') return [];
    const cfg = Throne.config();
    const ruled = player.throne.ruling && player.throne.ruling.kingdomId;
    const out = [];
    for (const [kid, c] of Object.entries(claims)) {
        if (!c || kid === ruled) continue;
        const k = ctx.world.getKingdom(kid);
        if (!k || !k.isAlive) continue;
        const total = Object.values(_obj(c.sources) || {}).reduce((s, v) => s + _num(v), 0);
        const strength = Math.min(_num(cfg.maxClaimStrength, 100), Math.round(total));
        if (strength < _num(cfg.pressMinStrength, 25)) continue;
        const ready = _num(player.gold) >= _num(cfg.pressGold, 300) && _armyStrength(player) >= _num(cfg.pressMinArmy, 40);
        out.push({
            key: kid, realm: k.name, strength,
            text: ready ? undefined : 'Your claim on {realm} ({strength}) is strong, but you need gold and an army to press it',
            severity: ready ? 'notice' : 'info', boost: strength / 20,
        });
    }
    return out;
};

R.tournament = (ctx, p) => {
    const player = ctx.player;
    const tile = ctx.tile(player.q, player.r);
    const s = tile && tile.settlement;
    if (!s || (s.type !== 'town' && s.type !== 'capital')) return [];
    const fee = s.type === 'capital' ? 300 : 200;
    if (_num(player.gold) < Math.max(fee, _num(p.minGold, 300))) return [];
    if (_num(player.skills && player.skills.combat) < 2 && !_arr(player.army).length) return [];
    if (typeof player.lastTournamentDay === 'number' && ctx.day - player.lastTournamentDay < _num(p.cooldown, 10)) return [];
    return [{ town: s.name || 'this town', fee }];
};

R.quests = (ctx, p) => {
    const out = [];
    for (const q of _arr(ctx.player.quests && ctx.player.quests.active)) {
        const objs = _arr(q && q.objectives).filter(o => o && _num(o.target) > 0);
        if (!objs.length) continue;
        const ratio = objs.reduce((s, o) => s + (o.completed ? 1 : Math.min(1, _num(o.current) / _num(o.target))), 0) / objs.length;
        if (ratio >= 1 || ratio < _num(p.minProgress, 0.75)) continue;
        out.push({ key: q.id || q.title, title: q.title || 'A quest', pct: Math.round(ratio * 100), boost: ratio * 2 });
    }
    return out;
};

R.discoveryRumours = (ctx) => _arr(ctx.player.discovery && ctx.player.discovery.sites).filter(s => s && !s.known && s.hint).map(s => {
    const charted = s.hint === 'charted';
    const q = charted ? s.q : s.hintQ;
    const r = charted ? s.r : s.hintR;
    const d = ctx.dist(q, r);
    return { key: s.id, q, r, how: charted ? 'A chart marks' : 'Sailors whisper of', boost: -Math.min(d, 60) / 20 };
});

// ── PATRONAGE & GREAT WORKS (systems/patronage.js) ───────────

/** The player's patronage record, only when it is well-formed (Patronage.state backfills). */
function _patronage(player) {
    const st = player && player.patronage;
    if (!_obj(st) || !Array.isArray(st.clients) || !Array.isArray(st.projects) || !Array.isArray(st.offers)) return null;
    return st;
}

R.patronageOffers = (ctx) => {
    const st = _patronage(ctx.player);
    if (!st) return [];
    return st.offers.map(o => {
        const c = st.clients.find(x => x && x.id === o.clientId);
        if (!c) return null;
        const left = _num(o.dueDay) - ctx.day;
        return { key: c.id, name: c.name, rival: o.rivalName || 'A rival House', counter: _num(o.counter), left: _days(left),
            severity: left <= 2 ? 'warning' : 'notice', boost: -left / 10 };
    }).filter(Boolean);
};

R.greatWorkStalled = (ctx) => {
    const st = _patronage(ctx.player);
    if (!st) return [];
    return st.projects.filter(p => p && p.status === 'building' && p.stall && p.stall !== 'winter').map(p => {
        const def = Patronage.greatWork(p.workId) || {};
        return { key: p.id, q: p.q, r: p.r, work: def.name || 'Great Work', place: p.name, why: Patronage.STALL_TEXT[p.stall] || p.stall,
            severity: p.stall === 'lost' || p.stall === 'siege' ? 'warning' : 'notice' };
    });
};

R.wonderRace = (ctx) => {
    const st = _patronage(ctx.player);
    const ws = ctx.world && ctx.world.greatWorks;
    if (!st || !_obj(ws) || !Array.isArray(ws.npc)) return [];
    const out = [];
    for (const p of st.projects) {
        const def = p && Patronage.greatWork(p.workId);
        if (!def || !def.unique) continue;
        for (const n of ws.npc) {
            if (!n || n.workId !== p.workId) continue;
            const pct = Math.round(100 * _num(n.progress) / Math.max(1, _num(n.days, 1)));
            out.push({ key: `${p.id}:${n.uid}`, q: n.q, r: n.r, work: def.name, realm: _kingdomName(ctx.world, n.kingdomId), pct,
                severity: pct >= 75 ? 'warning' : 'notice', boost: pct / 20 });
        }
    }
    return out;
};

R.greatWorkSupply = (ctx) => {
    const st = _patronage(ctx.player);
    if (!st) return [];
    return st.projects.filter(p => p && p.status === 'supplying').map(p => {
        const def = Patronage.greatWork(p.workId) || {};
        const stage = (def.stages || [])[_num(p.stage)] || {};
        return { key: p.id, q: p.q, r: p.r, work: def.name || 'Great Work', place: p.name, stage: (stage.name || 'next stage').toLowerCase() };
    });
};

R.idleClients = (ctx, p) => {
    const st = _patronage(ctx.player);
    if (!st) return [];
    const profs = Patronage.professions();
    return st.clients.filter(c => c && !c.task && !c.assignedTo && _num(c.idleDays) >= _num(p.minIdle, 3)).map(c => ({
        key: c.id, name: c.name, prof: ((profs[c.profession] || {}).name || 'client').toLowerCase(),
        idle: _days(_num(c.idleDays)), boost: _num(c.idleDays) / 20,
    }));
};

// ── GOALS ────────────────────────────────────────────────────

R.ambition = (ctx) => {
    const house = ctx.player.house;
    if (!_obj(house)) return [];
    const amb = house.ambition;
    if (!amb) return [{ text: 'Your House has no Ambition: choose one to earn Prestige', severity: 'info' }];
    const def = House._getAmbitionDef(amb.id);
    if (!def || amb.capstoneDone) return [];
    const marks = _arr(amb.milestones);
    const done = marks.filter(m => m && m.done).length;
    const next = def.milestones.find(m => !marks.some(x => x && x.id === m.id && x.done));
    return [{ ambition: def.name, next: next ? next.label : def.capstone.label, done, total: def.milestones.length }];
};

R.nextTrait = (ctx, p) => {
    const st = ctx.player.traits;
    if (!_obj(st) || !_obj(st.progress)) return [];
    const earned = _obj(st.earned) || {};
    let best = null;
    for (const [id, def] of Object.entries(Traits.TRAITS || {})) {
        if (!def || earned[id] || (def.opposite && earned[def.opposite])) continue;
        const s = _num(st.progress[id]) / Math.max(1, _num(def.threshold, 1));
        if (s >= 1 || s < _num(p.min, 0.5)) continue;
        if (!best || s > best.s) best = { id, def, s };
    }
    if (!best) return [];
    return [{ key: best.id, icon: best.def.icon, name: best.def.name || best.id, pct: Math.round(best.s * 100) }];
};

R.hunterRank = (ctx) => {
    const b = ctx.player.bountyHunter;
    if (!_obj(b)) return [];
    const total = _num(b.capturesTurnedIn) + _num(b.capturesRecruited) + _num(b.beastsSlain);
    const rank = Math.max(1, _num(b.rank, 1));
    const next = _arr(BountyHunting.RANKS)[rank];
    if (!total || !next) return [];
    return [{ n: Math.max(1, rank * 3 - total), title: next.title, icon: next.icon }];
};

R.guildRank = (ctx) => {
    const g = ctx.player.underworld && ctx.player.underworld.guild;
    if (!_obj(g) || !g.member) return [];
    const standing = _num(g.standing);
    const next = Underworld.ranks().find(r => r && _num(r.standing) > standing);
    if (!next) return [];
    return [{ n: Math.ceil(_num(next.standing) - standing), title: next.name }];
};

R.legacy = (ctx) => {
    const house = ctx.player.house;
    if (!_obj(house) || house.ended) return [];
    // Legacy.score backfills the House's reign chronicle (Legacy.ensure), so
    // score a shadow: the player's fields over a shallow copy of the House
    const shadowHouse = { ...house, reigns: _arr(house.reigns).slice() };
    const shadow = Object.assign(Object.create(Object.getPrototypeOf(ctx.player)), ctx.player, { house: shadowHouse });
    const score = Legacy.score(shadow, ctx.world);
    const rank = Legacy.rank(score) || {};
    const next = _arr(Legacy.config().ranks).slice().sort((a, b) => a.min - b.min).find(r => r.min > score);
    return [{
        score, rank: rank.label || '', icon: rank.icon,
        next: next ? `; ${Math.ceil(next.min - score)} more for ${next.label}` : '',
    }];
};

// ── BANKS, CREDIT & COIN (systems/finance.js) ─────────────────

/** Loans overdue: what comes next (bailiffs, seizure, default) and when. */
R.loanDefault = (ctx) => {
    const NEXT = { bailiffs: 'bailiffs take your goods', seizure: 'your collateral is seized', default: 'you are declared a defaulter' };
    return Finance.atRisk(ctx.player, ctx.world).map(r => ({
        key: `loan:${r.loan.id}`, lender: r.lender, overdue: r.overdue, owed: Math.ceil(_num(r.loan.totalOwed)),
        next: NEXT[r.next] || r.next, when: r.inDays <= 0 ? 'any day now' : `in ${r.inDays} day${r.inDays === 1 ? '' : 's'}`,
        severity: (r.next === 'default' || r.inDays <= 3) ? 'critical' : 'warning', boost: r.overdue,
    }));
};

/** Gold running short of the loans' daily payments (not yet missed). */
R.loanDue = (ctx, p) => {
    const st = _obj(ctx.player.finance);
    const loans = _arr(st && st.loans);
    if (!loans.length || loans.some(l => _num(l.overdue) > 0)) return [];
    const due = loans.reduce((s, l) => s + _num(l.dailyPayment), 0);
    const days = due > 0 ? Math.floor(_num(ctx.player.gold) / due) : Infinity;
    if (days > _num(p.warnDays, 5)) return [];
    return [{ key: 'loanDue', due, gold: Math.floor(_num(ctx.player.gold)), days, severity: days <= 1 ? 'warning' : 'notice' }];
};

/** Your deposits in a house that is being run on or running dry. */
R.bankRisk = (ctx, p) => {
    const st = _obj(ctx.player.finance);
    if (!st) return [];
    const out = [];
    for (const [id, a] of Object.entries(_obj(st.accounts) || {})) {
        const b = _arr(st.banks).find(x => x && x.id === id);
        const amount = Math.floor(_num(a && a.balance));
        if (!b || b.status !== 'open' || amount <= 0) continue;
        const run = Finance.inPanic(b, ctx.day);
        const low = Finance.reserveRatio(b) < _num(p.lowReserve, 0.45);
        if (!run && !low) continue;
        out.push({ key: `bank:${id}`, q: b.q, r: b.r, bank: b.name, amount, why: run ? 'depositors are running on it' : 'its vaults are running low', severity: run ? 'warning' : 'notice' });
    }
    return out;
};

/** Royal bonds with a crown in trouble. */
R.bondRisk = (ctx, p) => {
    const st = _obj(ctx.player.finance);
    const out = [];
    for (const b of _arr(st && st.bonds)) {
        const k = ctx.world && ctx.world.getKingdom ? ctx.world.getKingdom(b.kingdomId) : null;
        const f = k && _obj(k.finance);
        if (!f) continue;
        const ratio = _num(f.debtRatio);
        if (ratio < _num(p.ratio, 0.8) && !_num(b.missed)) continue;
        out.push({ key: `bond:${b.id}`, realm: k.name, amount: Math.floor(_num(b.principal)), why: _num(b.missed) ? 'has missed payments to you' : `owes ${Math.round(ratio * 100)}% of what it can carry`, severity: 'notice' });
    }
    return out;
};

/** A ship at sea in dangerous waters with nothing insured (systems/underwriting.js). */
R.uninsuredVoyage = (ctx, p) => {
    if (!_arr(ctx.player.ships).some(s => s && ['at_sea', 'moving', 'anchored'].includes(s.status))) return [];
    const out = [];
    for (const it of Underwriting.uninsuredAtSea(ctx.player, ctx.world)) {
        if (_num(it.loss) < _num(p.minLoss, 3) || _num(it.value) <= 0) continue;
        out.push({ key: `uninsured:${it.ref}`, ship: it.label, value: it.value, loss: Math.round(_num(it.loss) * 10) / 10, severity: _num(it.loss) >= _num(p.warnLoss, 15) ? 'warning' : 'notice' });
    }
    return out.slice(0, 2);
};

/** Bills of exchange to present before they lapse, or stolen ones to stop (systems/bills.js). */
R.billDue = (ctx, p) => {
    const out = [];
    for (const b of Bills.dueSoon(ctx.player, ctx.world, _num(p.days, 10))) {
        const payer = Bills.payer(ctx.player, b);
        if (b.status === 'stolen') {
            out.push({ key: `bill:${b.id}`, amount: b.amount, bank: payer ? payer.name : b.payName, place: payer ? payer.seat : b.payAt,
                what: `was stolen: stop it at {place} before a forger cashes it, about day ${b.cashDay}`, severity: 'warning' });
        } else {
            const left = b.validUntil - ctx.day;
            out.push({ key: `bill:${b.id}`, amount: b.amount, bank: payer ? payer.name : b.payName, place: payer ? payer.seat : b.payAt,
                what: left >= 0 ? `must be presented at {place} within ${left} day(s)` : 'is overdue: present it at {place} (less a protest fee)', severity: 'notice' });
        }
    }
    return out.map(x => ({ ...x, what: x.what.replace('{place}', x.place) })).slice(0, 2);
};

/** Shares the player holds riding a mania (systems/bourse.js): the bubble may burst any week. */
R.bourseMania = (ctx) => {
    const out = [];
    for (const pf of Bourse.portfolio(ctx.player)) {
        const m = pf.listing.mania;
        if (!m || m.burst) continue;
        out.push({ key: `mania:${pf.listing.id}`, listing: pf.listing.name, shares: pf.shares, value: Math.round(pf.value) });
    }
    return out.slice(0, 1);
};

/** Bullion in the packs that a mint nearby would pay well for (systems/mints.js). */
R.mintBullion = (ctx) => {
    const t = Mints.bullionTip(ctx.player, ctx.world);
    if (!t) return [];
    return [{ key: `mint:${t.good}:${t.kingdom}`, q: t.q, r: t.r, qty: t.qty, good: t.good.replace(/_/g, ' '), kingdom: t.kingdom, unit: t.unit.toFixed(1), dist: t.dist }];
};

/** The ruled realm's coin: clipped, short or flooding (systems/mints.js, world/moneySupply.js). */
R.ruledCoin = (ctx) => {
    const w = Mints.ruledCoinWarning(ctx.player, ctx.world);
    if (!w) return [];
    const what = w.kind === 'debased'
        ? `strikes clipped coin (${Math.round(w.purity * 100)}% silver)${w.recoin && w.recoin.ok ? `: a recoinage would cost the treasury ${w.recoin.cost}g and bring prices down` : ''}`
        : w.kind === 'short'
            ? `is short of coin (prices ${Math.round((1 - w.level) * 100)}% under the world's, the tax yield with them): a low seigniorage draws bullion to the mint`
            : `is awash with coin (prices ${Math.round((w.level - 1) * 100)}% over the world's)`;
    return [{ key: `coin:${w.kind}`, realm: w.kingdom, what, severity: w.kind === 'debased' ? 'warning' : 'notice' }];
};

/** A defaulter is wanted for the debtors' prison in a realm. */
R.debtWarrant = (ctx) => {
    const st = _obj(ctx.player.finance);
    const out = [];
    for (const [kid, w] of Object.entries(_obj(st && st.wanted) || {})) {
        const k = ctx.world && ctx.world.getKingdom ? ctx.world.getKingdom(kid) : null;
        out.push({ key: `wanted:${kid}`, realm: k ? k.name : kid, amount: Math.ceil(_num(w && w.amount)) });
    }
    return out;
};

// ── MERCHANT PRINCE (systems/merchantPrince.js, systems/marketFairs.js) ──

/** A forward contract falling due with goods still owed. */
R.forwardDue = (ctx, p) => {
    const st = _obj(ctx.player.merchantPrince);
    const out = [];
    for (const f of _arr(st && st.forwards)) {
        const left = _num(f.qty) - _num(f.delivered);
        const days = _num(f.dueDay) - ctx.day;
        if (left <= 0 || days > _num(p.days, 5)) continue;
        out.push({
            key: `fwd:${f.id}`, q: f.q, r: f.r, qty: left, good: String(f.good || '').replace(/_/g, ' '), town: f.town, due: f.dueDay,
            left: days <= 0 ? 'today' : `${days} day${days === 1 ? '' : 's'}`, severity: days <= 1 ? 'critical' : 'warning', boost: 5 - days,
        });
    }
    return out;
};

/** Goods spoiling in a store-room (fish, meat, bread lose several percent a week). */
R.spoilingStock = (ctx, p) => {
    const st = _obj(ctx.player.merchantPrince);
    const mult = _num(p.spoilMult, 0.5);
    const out = [];
    for (const w of _arr(st && st.warehouses)) {
        for (const [id, qty] of Object.entries(_obj(w.goods) || {})) {
            const g = SettlementMarket.good(id);
            const weekly = g ? (1 - Math.pow(1 - g.spoil * mult, 7)) : 0;
            if (weekly < _num(p.weekly, 0.05) || _num(qty) < _num(p.minQty, 10)) continue;
            out.push({ key: `spoil:${w.id}:${id}`, q: w.q, r: w.r, good: id.replace(/_/g, ' '), town: w.town, qty: Math.floor(qty), pct: Math.round(weekly * 100) });
        }
    }
    return out;
};

/** Rent owed on a store-room (the landlord sells the stock after two weeks). */
R.warehouseRent = (ctx) => {
    const st = _obj(ctx.player.merchantPrince);
    return _arr(st && st.warehouses).filter(w => _num(w.arrears) > 0)
        .map(w => ({ key: `rent:${w.id}`, q: w.q, r: w.r, town: w.town, owed: _num(w.arrears), severity: _num(w.unpaid) >= 1 ? 'warning' : 'notice' }));
};

/** Works in poor repair, or in a realm where the player's name is sinking toward expropriation. */
R.worksAtRisk = (ctx, p) => {
    const st = _obj(ctx.player.merchantPrince);
    const out = [];
    for (const inv of _arr(st && st.investments)) {
        const t = ctx.tile(inv.q, inv.r);
        const s = t && t.settlement;
        const w = s && s.market && s.market.works && s.market.works[inv.recipe];
        if (!w) continue;
        const rep = s.kingdom ? _num(ctx.player.reputation && ctx.player.reputation[s.kingdom]) : 0;
        if (s.kingdom && rep < _num(p.repBelow, -20)) {
            out.push({ key: `exprop:${inv.id}`, q: inv.q, r: inv.r, town: inv.town, why: `your name there is ${Math.round(rep)}: the guilds talk of taking your works`, severity: 'warning', boost: 2 });
        } else if (_num(w.cond, 1) < _num(p.condBelow, 0.6)) {
            out.push({ key: `repair:${inv.id}`, q: inv.q, r: inv.r, town: inv.town, why: `the works stand at ${Math.round(_num(w.cond) * 100)}% repair`, severity: 'notice' });
        }
    }
    return out;
};

/** A guild contract falling due (systems/guilds.js). */
R.guildContractDue = (ctx, p) => {
    const st = _obj(ctx.player.guilds);
    const out = [];
    for (const c of _arr(st && st.contracts)) {
        const left = _num(c.qty) - _num(c.delivered);
        const days = _num(c.due) - ctx.day;
        if (left <= 0 || days > _num(p.days, 5)) continue;
        out.push({ key: `gc:${c.id}`, q: c.q, r: c.r, qty: left, good: String(c.good || '').replace(/_/g, ' '), town: c.town, due: c.due, severity: days <= 1 ? 'warning' : 'notice', boost: 5 - days });
    }
    return out;
};

/** Guild dues in arrears: three weeks and the guild strikes the player from its rolls. */
R.guildDues = (ctx) => {
    const st = _obj(ctx.player.guilds);
    return Object.values(_obj(st && st.memberships) || {}).filter(m => _num(m.unpaid) > 0)
        .map(m => ({ key: `gd:${m.key}`, q: m.q, r: m.r, town: m.town, guild: (Guilds.def(m.guild) || {}).name || 'guild', weeks: _num(m.unpaid), severity: _num(m.unpaid) >= 2 ? 'warning' : 'notice' }));
};

/** A rank within reach in one of the player's guilds (everything but the fee and the masterpiece goods in hand). */
R.craftGuildRank = (ctx) => {
    const out = [];
    const st = _obj(ctx.player.guilds);
    for (const m of Object.values(_obj(st && st.memberships) || {})) {
        const t = ctx.tile(m.q, m.r);
        if (!t || !t.settlement) continue;
        const q = Guilds.advanceQuote(ctx.player, ctx.world, t, m.guild);
        if (!q.needs.length) continue;
        const blocking = q.needs.filter(n => !n.met && !/gold|masterpiece/.test(n.label));
        if (blocking.length) continue;
        const still = q.needs.filter(n => !n.met).map(n => n.label);
        out.push({ key: `gr:${m.key}`, q: m.q, r: m.r, town: m.town, guild: (Guilds.def(m.guild) || {}).name || 'guild', rank: Guilds.rankName(q.rank), still: still.length ? `: bring ${still.join(', ')}` : ': go and take it' });
    }
    return out;
};

/** Goods in the player's packs from a realm under embargo where they stand (systems/tradePolicy.js). */
R.tradeEmbargoed = (ctx) => {
    const t = ctx.tile(ctx.player.q, ctx.player.r);
    const s = t && t.settlement;
    if (!s || s.kingdom == null) return [];
    const out = [];
    for (const [good, qty] of Object.entries(ctx.player.inventory || {})) {
        if (!(qty > 0)) continue;
        const n = TradePolicy.goodNotice(ctx.player, ctx.world, s, good);
        if (n && n.embargoed > 0) out.push({ key: `tpe:${good}`, q: s.q, r: s.r, n: n.embargoed, good: good.replace(/_/g, ' '), realm: _kingdomName(ctx.world, s.kingdom) });
    }
    return out.slice(0, 2);
};

/** A crown's trading licence about to run out. */
R.tradeLicence = (ctx, p) => {
    const st = _obj(ctx.player.tradePolicy);
    const out = [];
    for (const [kid, until] of Object.entries((st && st.licences) || {})) {
        const left = _num(until) - ctx.day;
        if (left > 0 && left <= _num(p.days, 10)) out.push({ key: `tpl:${kid}`, realm: _kingdomName(ctx.world, kid), until, left });
    }
    return out;
};

/** The realm the player rules: neighbours' embargoes and trade wars against it. */
R.tradeAgainstRealm = (ctx) => {
    const k = Throne.ruledKingdom(ctx.player, ctx.world);
    if (!k) return [];
    const out = [];
    for (const o of (ctx.world.kingdoms || [])) {
        if (!o || o === k || o.isAlive === false) continue;
        const po = o.tradePolicy;
        if (!po) continue;
        if (po.embargo && po.embargo[k.id] && po.embargo[k.id].why !== 'war') out.push({ key: `tpk:e:${o.id}`, realm: o.name, what: "has laid an embargo on your realm's goods", severity: 'warning' });
        else if (po.retal && po.retal[k.id] > 0) out.push({ key: `tpk:w:${o.id}`, realm: o.name, what: `taxes your realm's goods ${Math.round(TradePolicy.avgImport(o, k.id) * 100)}% in a trade war — lower your own duties on its goods, or sign a treaty` });
    }
    return out.slice(0, 2);
};

/** A guild on strike near the player: its goods are short there. */
R.guildStrikes = (ctx, p) => {
    if (!ctx.world || typeof ctx.world.getSettlementViews !== 'function') return [];
    return Guilds.strikesNear(ctx.world, ctx.player.q, ctx.player.r, _num(p.radius, 12)).slice(0, 1)
        .map(x => ({ key: `gs:${x.town}:${x.guild}`, q: x.q, r: x.r, guild: x.guild, town: x.town, goods: x.goods.map(g => g.replace(/_/g, ' ')).join(' and '), until: x.until, dist: x.dist }));
};

/** The player's works that can't find hands (the town's artisans are few, or on strike). */
R.worksShortHands = (ctx, p) => {
    const st = _obj(ctx.player.merchantPrince);
    const out = [];
    for (const inv of _arr(st && st.investments)) {
        const t = ctx.tile(inv.q, inv.r);
        const s = t && t.settlement;
        if (!s || !s.labour) continue;
        const strike = TownLabour.striking(s, ctx.day);
        const fill = TownLabour.factors(s, ctx.day).craft;
        if (!strike && fill >= _num(p.below, 0.85)) continue;
        out.push({
            key: `hands:${inv.id}`, q: inv.q, r: inv.r, town: inv.town,
            why: strike ? 'the artisans are on strike and the works stand idle' : `the works can't find hands: only ${Math.round(fill * 100)}% of the places are filled, and wages are rising`,
            severity: strike ? 'warning' : 'notice', boost: (1 - fill) * 3,
        });
    }
    return out;
};

/** The player's properties short of hands in the town they hire from. */
R.propertyHands = (ctx, p) => {
    const out = [];
    for (const ref of _arr(ctx.player.properties)) {
        const t = ctx.tile(ref.q, ref.r);
        const prop = t && _arr(t.playerProperties).find(x => x && x.type === ref.type);
        const hire = prop && _obj(prop.hire);
        if (!hire || prop.underConstruction) continue;
        const fill = _num(hire.fill, 1);
        const ratio = _num(hire.ratio, 1);
        if (fill >= _num(p.below, 0.85) && ratio < _num(p.wageAbove, 1.4)) continue;
        out.push({
            key: `prop:${ref.q},${ref.r}:${ref.type}`, q: ref.q, r: ref.r, name: prop.name || ref.name || 'property', town: hire.town || 'the town',
            why: fill < _num(p.below, 0.85) ? `only ${Math.round(fill * 100)}% staffed` : `wages there run ${Math.round(ratio * 100)}% of the usual`,
            boost: (1 - fill) * 2,
        });
    }
    return out;
};

/** The player's mining leases whose vein runs out (world/hinterland.js), or that owe wages and royalties. */
R.veinRunningOut = (ctx, p) => {
    const st = _obj(ctx.world.hinterland);
    const out = [];
    for (const c of _arr(st && st.concessions)) {
        if (!c || c.holder !== 'player' || c.status !== 'active') continue;
        const site = _arr(st.sites).find(s => s && s.id === c.site);
        if (!site) continue;
        const k = Hinterland.kind(site.kind);
        const name = k ? k.name.toLowerCase() : 'mine';
        if (_num(c.owed) > 0) {
            out.push({ key: `owed:${c.id}`, q: site.q, r: site.r, site: name, why: `owes ${Math.ceil(_num(c.owed))}g in wages and royalties: pay it or ${c.realm || 'the crown'} forfeits the lease`, severity: 'warning', boost: 3 });
            continue;
        }
        const res = Hinterland.reserveFrac(site), y = Hinterland.yieldOf(site);
        if (res >= _num(p.reserveBelow, 0.3) && y >= _num(p.yieldBelow, 0.7)) continue;
        out.push({ key: `vein:${c.id}`, q: site.q, r: site.r, site: name, why: `is running out: ${Math.round(res * 100)}% of the vein left, the yield at ${Math.round(y * 100)}%. Prospect for a new vein or ease the pace`, boost: 1 - res });
    }
    return out;
};

/**
 * A failing harvest the player has heard of (world/harvests.js crop reports
 * and local talk) within reach, in the weeks before grain turns dear there.
 */
R.harvestFailing = (ctx, p) => {
    const H = Harvests.config().counsel;
    const ps = _obj(ctx.player.harvests);
    const doy = Seasons.dayOfYear(ctx.day);
    if (!ps || !_obj(ps.known) || doy < _num(p.from, H.failingFrom) || doy > _num(p.until, H.failingUntil)) return [];
    const out = [];
    const Y = Harvests.yearOf(ctx.day);
    for (const [id, k] of Object.entries(ps.known)) {
        if (!k || _num(k.year, -1) !== Y || !(_num(k.est, 1) < _num(p.below, H.failingBelow))) continue;
        out.push({
            key: `harvest:${Y}:${id}`, place: k.name || 'a realm', pct: Math.round(_num(k.est) * 100),
            src: k.src === 'local' ? 'seen with your own eyes' : `the crop report of day ${_num(k.day)}`,
            why: k.settled ? 'grain will be dear there until next autumn: carry it in' : 'buy grain now, before the price there climbs',
            boost: (1 - _num(k.est)) * 10,
        });
    }
    return out;
};

/** The player's farms whose soil runs thin (world/harvests.js rotations). */
R.farmSoil = (ctx, p) => {
    const H = Harvests.config();
    const out = [];
    for (const ref of _arr(ctx.player.properties)) {
        if (!ref || !H.propertyCrops[ref.type] || H.propertyCrops[ref.type] === 'stock') continue;
        const tile = ctx.world.getTile(ref.q, ref.r);
        const prop = tile && _arr(tile.playerProperties).find(x => x && x.type === ref.type);
        if (!prop || !(_num(prop.soil, 1) < _num(p.below, H.counsel.soilBelow))) continue;
        const rot = Harvests.rotation(prop);
        out.push({
            key: `soil:${ref.q},${ref.r}:${ref.type}`, q: ref.q, r: ref.r, name: prop.name || ref.type,
            why: `the soil is down to ${Math.round(_num(prop.soil, 1) * 100)}% under ${rot.label.toLowerCase()}: rest it (long fallow) or its yield keeps falling`,
            boost: 1 - _num(prop.soil, 1),
        });
    }
    return out;
};

/** The player's public works stalled for funds or materials (systems/publicWorks.js). */
R.publicWorksStalled = (ctx) => {
    const st = _obj(ctx.world.transport);
    const out = [];
    for (const w of _arr(st && st.works)) {
        if (!w || w.owner !== 'player' || (w.status !== 'stalled' && w.stall !== 'materials')) continue;
        const why = w.stall === 'funds' ? `has stopped: its budget is spent (${Math.round(PublicWorks.progress(w) * 100)}% built). Add funds or abandon it`
            : 'waits for stone and timber: the market there is bare, and the hands idle on half pay';
        out.push({ key: `pw:${w.id}`, q: w.q, r: w.r, name: w.name, why, severity: w.stall === 'funds' ? 'warning' : 'notice', boost: w.stall === 'funds' ? 2 : 0 });
    }
    return out;
};

/** A road near the player closed by snow or flood, or with its bridge down (world/transport.js). */
R.roadClosed = (ctx, p) => {
    if (!_obj(ctx.world.transport)) return [];
    const out = [];
    for (const seg of Transport.segmentsNear(ctx.world, ctx.player.q, ctx.player.r, _num(p.radius, 8))) {
        const s = ctx.world.transport.segs[seg.key];
        if (!s || (!s.cl && !s.wash)) continue;
        if (!s.cl && s.x === 'bridge') continue;
        const why = s.cl === 'snow' ? 'is snowed shut at the pass: no trade crosses until it opens'
            : s.cl === 'flood' ? 'is cut by the ford in flood'
                : `has lost its bridge: ${s.x === 'ferry' ? 'a ferry plies' : 'travellers ford'}, and trade crawls. A toll bridge would pay`;
        out.push({ key: `rc:${seg.key}:${s.cl || 'wash'}`, q: seg.a.q, r: seg.a.r, place: (seg.a.s && seg.a.s.name) || 'a town', other: (seg.b.s && seg.b.s.name) || 'a town', why });
    }
    return out;
};

/** A toll bridge or toll highway near the player that would repay itself soon (systems/publicWorks.js). */
R.tollWorks = (ctx, p) => {
    const st = _obj(ctx.world.transport);
    if (!st || !_obj(st.traffic)) return [];
    const out = [];
    for (const seg of Transport.segmentsNear(ctx.world, ctx.player.q, ctx.player.r, _num(p.radius, 10))) {
        const s = st.segs[seg.key];
        if (!s || s.toll) continue;
        const kind = seg.rivers.length && s.x !== 'bridge' ? 'bridge' : s.t === 'road' ? 'upgrade_highway' : null;
        if (!kind) continue;
        const est = PublicWorks.tollEstimate(ctx.world, ctx.player, kind, seg.key);
        if (!est || !est.payback || est.payback > _num(p.maxPayback, 120)) continue;
        out.push({
            key: `tw:${seg.key}:${kind}`, q: seg.a.q, r: seg.a.r, what: kind === 'bridge' ? 'A toll bridge' : 'A paved toll highway',
            place: (seg.a.s && seg.a.s.name) || 'a town', other: (seg.b.s && seg.b.s.name) || 'a town',
            cost: est.cost, perDay: est.perDay, payback: est.payback, boost: 100 / est.payback,
        });
    }
    out.sort((a, b) => a.payback - b.payback);
    return out.slice(0, 1);
};

/** Mining leases on auction near the player (systems/concessions.js). */
R.concessionAuctions = (ctx, p) => {
    const st = _obj(ctx.world.hinterland);
    const out = [];
    const radius = _num(p.radius, 10);
    for (const a of _arr(st && st.auctions)) {
        if (!a || a.status !== 'open') continue;
        const site = _arr(st.sites).find(s => s && s.id === a.site);
        if (!site || Math.abs(site.r - ctx.player.r) > radius) continue;
        const dist = Hex.wrappingDistance(site.q, site.r, ctx.player.q, ctx.player.r, ctx.world.width);
        if (dist > radius) continue;
        const k = Hinterland.kind(site.kind);
        out.push({
            key: `auc:${a.id}`, q: site.q, r: site.r, site: k ? k.name.toLowerCase() : 'mine', realm: a.realm || 'the crown', reserve: _num(a.reserve), closes: _num(a.closes), dist,
            how: a.finder === 'player' ? 'is yours to lease first (your strike)' : a.bid > 0 ? `is up for auction: your bid stands at ${a.bid}g` : 'is up for auction',
            severity: a.finder === 'player' ? 'notice' : 'info', boost: (a.finder === 'player' ? 3 : 0) - dist / 10,
        });
    }
    return out;
};

/** A town the player rules with idle hands, refugees crowding in or a strike. */
R.holdingIdle = (ctx, p) => {
    const out = [];
    for (const h of Holdings.list(ctx.player, ctx.world)) {
        const s = h && h.settlement;
        const lab = s && s.labour;
        if (!lab) continue;
        const idle = TownLabour.idle(s);
        const strike = TownLabour.striking(s, ctx.day);
        if (idle < _num(p.idleAt, 0.1) && !strike) continue;
        out.push({
            key: h.key, q: h.q, r: h.r, name: s.name || 'A holding',
            why: strike ? 'its artisans are on strike' : `${Math.round(idle * 100)}% of its hands have no work${_num(lab.refugees) >= 20 ? ` (${Math.round(_num(lab.refugees))} refugees came in)` : ''}: crime and unrest rise`,
            severity: strike || idle >= _num(p.criticalAt, 0.2) ? 'warning' : 'notice', boost: idle * 10,
        });
    }
    return out;
};

/**
 * Dear bread in a realm, as the gazettes the player read have it
 * (systems/economyChronicle.js → player.econ; world/economyIndex.js): the
 * realm they stand in and the realms of their holdings first.
 */
R.dearBread = (ctx, p) => {
    const econ = _obj(ctx.player.econ);
    const known = econ && _obj(econ.realms);
    if (!known || !ctx.world) return [];
    const here = ctx.tile(ctx.player.q, ctx.player.r);
    const hereK = here && (here.settlement ? here.settlement.kingdom : here.kingdom);
    const out = [];
    for (const k of _arr(ctx.world.kingdoms)) {
        if (!k || k.isAlive === false || known[k.id] == null) continue;
        const asOf = known[k.id];
        const now = EconomyIndex.latest(ctx.world, k.id, asOf);
        const then = EconomyIndex.ago(ctx.world, k.id, EconomyIndex.config().changeWeeks, asOf);
        if (!now || !then || !(then.food > 0) || now.food < _num(p.dearAt, 1.25)) continue;
        const up = now.food / then.food - 1;
        if (up < _num(p.minUp, 0.05)) continue;
        const mine = k.id === hereK;
        out.push({
            key: `bread:${k.id}`, realm: k.name, pct: Math.round(up * 100), since: String(Seasons.seasonOf(then.day) || 'the last season').toLowerCase(),
            day: now.day, severity: mine ? 'warning' : 'notice', boost: (mine ? 3 : 0) + up * 5,
            q: k.capital && Number.isFinite(k.capital.q) ? k.capital.q : null, r: k.capital && Number.isFinite(k.capital.r) ? k.capital.r : null,
        });
    }
    return out.sort((a, b) => b.boost - a.boost);
};

/** A fashion the player has heard of, and the goods it makes dear (more so when they hold some). */
R.fashionGoods = (ctx) => {
    const econ = _obj(ctx.player.econ);
    const heard = econ && _obj(econ.fashions);
    const fs = ctx.world && _obj(ctx.world.fashions);
    if (!heard || !fs) return [];
    const held = {};
    for (const [id, n] of Object.entries(_obj(ctx.player.inventory) || {})) held[id] = _num(held[id]) + _num(n);
    for (const sh of _arr(ctx.player.ships)) for (const [id, n] of Object.entries(_obj(sh && sh.cargo) || {})) held[id] = _num(held[id]) + _num(n);
    const out = [];
    for (const f of _arr(fs.active)) {
        if (!f || heard[f.uid] == null) continue;
        const stage = Fashions.stage(f, ctx.day);
        if (stage === 'over') continue;
        const goods = Fashions.goods(f).filter(g => g.mult > 1);
        if (!goods.length) continue;
        const have = goods.filter(g => _num(held[g.id]) >= 1);
        const list = (have.length ? have : goods).map(g => g.name.toLowerCase());
        const def = Fashions.def(f.id) || {};
        out.push({
            key: `fashion:${f.uid}`, fashion: def.name || f.id, stage, place: f.place || 'the capital',
            goods: have.length ? `your ${list.join(', ')}` : list.join(', '),
            severity: have.length ? 'notice' : 'info', boost: have.length ? 3 : 0, q: f.q, r: f.r,
        });
    }
    return out;
};

/** A fair on, or opening soon, near the player. */
R.fairs = (ctx, p) => {
    if (!ctx.world || typeof ctx.world.getSettlementViews !== 'function') return [];
    return MarketFairs.fairsNear(ctx.world, ctx.player.q, ctx.player.r, _num(p.radius, 12), _num(p.ahead, 6)).slice(0, 1)
        .map(f => ({ key: `fair:${f.town}:${f.name}`, q: f.q, r: f.r, name: f.name, town: f.town, when: f.on ? `is on until day ${f.until}` : `opens in ${f.inDays} days`, dist: f.dist }));
};
