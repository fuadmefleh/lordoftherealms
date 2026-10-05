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

