// ============================================
// SAGAS — world-scale storylines that unfold over months
// ============================================
// A saga is a multi-chapter story (The Wyrm Wakes, The Grey Cough, The Lost
// Heir, The Long Winter, Sea Reavers, The Sundering Faith, The Iron Company,
// The Comet) staged on the game's existing systems. Every chapter writes real
// state through their APIs: timed world events (prices, stability, trade,
// pirate and bandit pressure — world/worldEvents.js), plague and famine
// templates, world units (a wyrm, a reaver flagship, a rogue company), delve
// sites (systems/delves.js), heresies (systems/religion.js), succession crises
// and claims (systems/throne.js), court petitions (systems/petitions.js),
// journal quests (systems/quests.js), rival adventurers (systems/rivals.js),
// settlement population and damage, kingdom stability, treasury and relations.
//
// Sagas run whether or not the player engages. Each chapter lasts a rolled
// number of days; its next[] transitions are checked daily, first match wins,
// and a chapter left alone ends in its timeout branch — so an ignored saga
// resolves on its own and leaves the world changed. The player hears of a
// saga from tavern notice boards (Sagas.tavernRumors), from being near when a
// chapter turns, from public chapters (news travels), from petitioners and the
// quest board, and joins through the chapter's actions in the Sagas journal,
// by ruling its petition, taking its quest, or simply killing the wyrm.
// Taking part makes the saga's ending pay out (renown, Prestige, House
// chronicle, trait deeds, items, kingdom reputation) — or scar.
//
// Scheduling: at most config.maxActive (2) at once. The first starts between
// day 60 and 120, chosen by a hash of the world seed — the saga system draws
// no RNG during world generation or before its first saga starts. Templates
// are chosen to fit the world (coasts for Sea Reavers, peaks for the wyrm).
//
// Content lives in data/sagas.json; state on player.sagas (saved with the
// player). World-side traces live where they belong (world.activeEvents,
// tile.improvement, kingdom.religion.heresies, player.throne crises); saga
// world units are re-spawned from the saved record after a load.
// All randomness flows through Utils; world/player are passed in.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { PlayerInventory } from '../core/inventory.js';
import { WorldUnit } from '../world/units.js';
import { WorldEvents } from '../world/worldEvents.js';
import { House } from './house.js';
import { Traits } from './traits.js';
import { Religion } from './religion.js';
import { Throne } from './throne.js';
import { Rivals } from './rivals.js';
import { Petitions } from './petitions.js';
import { Quests } from './quests.js';
import { Ailments } from './ailments.js';
import { Underworld } from './underworld.js';
import { Taxation } from './marketDynamics.js';

const DEFAULT_CONFIG = {
    firstStart: [60, 120],
    gapDays: [45, 90],
    maxActive: 2,
    hearRadius: 10,
    tavernRadius: 28,
    doneCap: 12,
    heardCap: 14,
    repeatAfterDays: 600,
};

const WATER = new Set(['ocean', 'deep_ocean', 'coast', 'sea']);
const LAIR_TERRAIN = ['mountain', 'highlands', 'hills'];
const TOKENS = ['kingdom', 'kingdom2', 'settlement', 'site', 'rival', 'villain', 'faith', 'heresy', 'ruler', 'house', 'target'];

/** world → Map(unit key → live WorldUnit). Not saved: units are re-found or re-spawned. */
const _live = new WeakMap();

function _num(v) {
    return typeof v === 'number' && isFinite(v) ? v : 0;
}

function _roll(v) {
    if (Array.isArray(v)) return Utils.randInt(v[0], v[1]);
    return _num(v);
}

function _day(world) {
    return (world && world.day) || 0;
}

function _list(v) {
    if (v == null) return [];
    return Array.isArray(v) ? v : [v];
}

function _dist(world, q1, r1, q2, r2) {
    return Hex.wrappingDistance(q1, r1, q2, r2, (world && world.width) || 0);
}

function _liveMap(world) {
    let m = _live.get(world);
    if (!m) { m = new Map(); _live.set(world, m); }
    return m;
}

function _liveSettlement(world, q, r) {
    const tile = world && world.getTile ? world.getTile(q, r) : null;
    return tile && tile.settlement ? tile.settlement : null;
}

function _kingdom(world, id) {
    return id && world && world.getKingdom ? world.getKingdom(id) || null : null;
}

// ──────────── EFFECTS ────────────
// apply(c, e): c = { player, world, saga, notify }; e = the effect object.
// Every `do` in data/sagas.json must be a key here (the content test checks).

const EFFECTS = {
    /** A saga-owned timed event: real modifiers (WorldEvents.EFFECT_KEYS) for N days. */
    event(c, e) {
        const { world, saga } = c;
        if (!Array.isArray(world.activeEvents)) world.activeEvents = [];
        const where = Sagas._scopeKingdom(world, saga, e.scope);
        if (e.scope && e.scope !== 'world' && !where) return;
        const name = Sagas.fill(e.name || saga.name, saga);
        const existing = world.activeEvents.find(ev => ev.sagaUid === saga.uid && ev.name === name);
        const days = Math.max(1, _roll(e.days || [20, 30]));
        if (existing) { existing.daysLeft = Math.max(existing.daysLeft, days); return; }
        const at = where ? Sagas._kingdomPoint(world, saga, where) : null;
        const effects = {};
        for (const [k, v] of Object.entries(e.effects || {})) if (WorldEvents.EFFECT_KEYS[k] && typeof v === 'number') effects[k] = v;
        const ev = {
            id: `saga_${saga.id}`,
            name,
            icon: e.icon || saga.icon,
            severity: 'moderate',
            effects,
            kingdomId: where ? where.id : null,
            partnerKingdomId: null,
            regionName: where ? where.name : 'the realm',
            settlementName: at ? at.name : null,
            q: at ? at.q : null,
            r: at ? at.r : null,
            daysLeft: days,
            text: Sagas.fill(e.text || name, saga),
            sagaUid: saga.uid,
        };
        world.activeEvents.push(ev);
    },

    /** Start a world event template (plague, famine, …) in the saga's kingdom. */
    worldEvent(c, e) {
        const { world, saga } = c;
        const where = Sagas._scopeKingdom(world, saga, e.scope || 'kingdom');
        const ev = WorldEvents.startEvent(world, e.id, where ? { kingdomId: where.id } : {});
        if (!ev) return;
        ev.sagaUid = saga.uid;
        if (e.days) ev.daysLeft = Math.max(1, _roll(e.days));
        if (Array.isArray(world.events)) world.events.push({ text: `${ev.icon} ${ev.text} (${ev.daysLeft} days)`, type: 'timed', timedEvent: ev });
    },

    /** End every event this saga started. */
    endEvents(c) {
        const { world, saga } = c;
        if (!Array.isArray(world.activeEvents)) return;
        world.activeEvents = world.activeEvents.filter(ev => ev.sagaUid !== saga.uid);
    },

    stability(c, e) {
        for (const k of Sagas._scopeKingdoms(c.world, c.saga, e.scope || 'kingdom')) {
            const base = typeof k.stability === 'number' ? k.stability : 60;
            k.stability = Utils.clamp(base + _num(e.amount), 0, 100);
        }
    },

    /** Shift relations between the saga's kingdom and its neighbour, both ways. */
    relations(c, e) {
        const a = _kingdom(c.world, c.saga.anchor.kingdomId);
        const b = _kingdom(c.world, c.saga.anchor.kingdom2Id);
        if (!a || !b) return;
        if (!a.relations) a.relations = {};
        if (!b.relations) b.relations = {};
        a.relations[b.id] = Utils.clamp((a.relations[b.id] || 0) + _num(e.amount), -100, 100);
        b.relations[a.id] = Utils.clamp((b.relations[a.id] || 0) + _num(e.amount), -100, 100);
    },

    treasury(c, e) {
        for (const k of Sagas._scopeKingdoms(c.world, c.saga, e.scope || 'kingdom')) {
            const t = _num(k.treasury);
            k.treasury = Math.max(0, Math.round(t + _num(e.amount) + t * _num(e.pct)));
        }
    },

    piety(c, e) {
        for (const k of Sagas._scopeKingdoms(c.world, c.saga, e.scope || 'kingdom')) {
            if (k.religion && typeof k.religion.piety === 'number') k.religion.piety = Utils.clamp(k.religion.piety + _num(e.amount), 0, 100);
        }
    },

    /** Population loss/gain (fraction) at the saga's settlement or across its kingdom. */
    population(c, e) {
        for (const s of Sagas._scopeSettlements(c.world, c.saga, e.scope || 'settlement')) {
            s.population = Math.max(10, Math.floor(_num(s.population) * (1 + _num(e.pct))));
        }
    },

    /** Damaged buildings cut a settlement's output until repaired. */
    damage(c, e) {
        for (const s of Sagas._scopeSettlements(c.world, c.saga, e.scope || 'settlement')) {
            s.damage = Math.min(0.9, _num(s.damage) + _num(e.amount));
        }
    },

    /** Spawn a saga world unit (tracked; re-spawned after a load). */
    unit(c, e) {
        const { world, saga } = c;
        if (!Array.isArray(world.units)) world.units = [];
        const count = Math.max(1, _num(e.count) || 1);
        for (let i = 0; i < count; i++) {
            const at = Sagas._unitSpot(world, saga, e.at || 'settlement');
            if (!at) return;
            const rec = {
                key: `${saga.uid}:${e.role || 'unit'}:${saga.units.length}`,
                role: e.role || 'unit',
                type: e.type || 'monster',
                name: Sagas.fill(e.name || saga.name, saga),
                icon: e.icon || saga.icon,
                strength: Math.max(1, _roll(e.strength || [40, 60])),
                q: at.q, r: at.r,
                slain: false, gone: false,
                // What the threatened realm pays for its head, and what it carries
                bounty: e.bounty ? JSON.parse(JSON.stringify(e.bounty)) : null,
            };
            saga.units.push(rec);
            Sagas._spawnUnit(world, rec);
        }
    },

    /** Take the saga's units off the map (they flee, sleep or disband). */
    removeUnits(c, e) {
        const { world, saga } = c;
        const map = _liveMap(world);
        for (const rec of saga.units) {
            if (rec.slain || rec.gone) continue;
            if (e && e.role && rec.role !== e.role) continue;
            const unit = map.get(rec.key) || (world.units || []).find(u => u.sagaKey === rec.key);
            if (unit) unit.destroyed = true;
            map.delete(rec.key);
            rec.gone = true;
            rec.removed = true;
        }
    },

    /** Place a delve site (a lair, a hospice, a crater) — systems/delves.js runs it. */
    site(c, e) {
        const { world, saga } = c;
        if (saga.anchor.site) return;
        let spot = null;
        if ((e.at || 'site') === 'site' && saga.anchor.lair) spot = saga.anchor.lair;
        else spot = Sagas._freeTileNear(world, saga.anchor.settlement, 2, 5);
        if (!spot) return;
        const tile = world.getTile(spot.q, spot.r);
        if (!tile || tile.settlement || (tile.improvement && !tile.improvement.sagaUid)) return;
        const name = Sagas.fill(e.name || 'A Hidden Place', saga);
        tile.improvement = {
            type: e.poiType || 'ruins',
            icon: e.icon || '🏚️',
            name,
            explored: false,
            founded: Math.max(1, _num(world.year) - 300),
            sagaUid: saga.uid,
        };
        saga.anchor.site = { q: spot.q, r: spot.r, name };
    },

    /** A rival adventurer empties the saga's site first. */
    lootSite(c) {
        const { world, saga } = c;
        const s = saga.anchor.site;
        const tile = s && world.getTile ? world.getTile(s.q, s.r) : null;
        const poi = tile && tile.improvement;
        if (!poi || poi.explored) return;
        const by = (saga.anchor.rival && saga.anchor.rival.name) || 'another adventurer';
        poi.explored = true;
        poi.lootedBy = by;
        poi.delved = { day: _day(world), depth: 0, of: 0, reason: 'rival', by };
    },

    /** Bring a saga petition to the player's court (only if they hold court). */
    petition(c, e) {
        const { player, world, saga } = c;
        const tmpl = Sagas.template(saga.id);
        const raw = tmpl && tmpl.petitions && tmpl.petitions[e.id];
        if (!raw || !Petitions.hasHoldings(player, world)) return;
        const def = Sagas._fillDeep(raw, saga);
        if (!def.requires) def.requires = { holding: ['settlement', 'office', 'house'] };
        const p = Petitions.spawnCustom(player, world, `saga_${saga.id}_${e.id}`, def);
        if (!p) return;
        saga.petitions.push({ id: p.id, key: e.id, resolved: false });
        Sagas._learn(c, `Petitioners at your court: ${p.title}.`);
    },

    /** Offer a journal quest; succeeding in the saga completes it. */
    quest(c, e) {
        const { player, saga } = c;
        if (!player.quests || saga.questId) return;
        const id = `saga_${saga.uid}`;
        if (Quests.hasQuest(player, id)) return;
        player.quests.available.push({
            id,
            title: Sagas.fill(e.title || saga.name, saga),
            description: Sagas.fill(e.text || '', saga),
            type: 'saga',
            category: 'saga',
            difficulty: 'hard',
            objectives: [{ type: id, target: 1, current: 0, text: Sagas.fill(e.objective || 'See the saga through', saga) }],
            rewards: { ...(e.rewards || {}) },
            status: 'available',
            startedAt: 0,
        });
        saga.questId = id;
        Sagas._learn(c, `A quest is posted: ${Sagas.fill(e.title || saga.name, saga)}.`);
    },

    /** A heresy or cult rises in the saga's kingdom (systems/religion.js). */
    heresy(c, e) {
        const { world, saga } = c;
        const k = _kingdom(world, saga.anchor.kingdomId);
        if (!k || !k.religion) return;
        if (!Array.isArray(k.religion.heresies)) k.religion.heresies = [];
        let h = saga.anchor.heresyId ? k.religion.heresies.find(x => x.id === saga.anchor.heresyId) : null;
        if (!h) {
            const before = new Set(k.religion.heresies);
            if (!Array.isArray(world.events)) world.events = [];
            Religion.spawnHeresy(k, world);
            h = k.religion.heresies.find(x => !before.has(x)) || Religion.strongestHeresy(k);
            if (!h) return;
            saga.anchor.heresyId = h.id;
            saga.anchor.heresy = h.name;
        }
        if (e.strength) h.strength = _num(h.strength) + _num(e.strength);
    },

    /** The saga's heresy is stamped out (or fades away). */
    suppressHeresy(c) {
        const { world, saga } = c;
        const k = _kingdom(world, saga.anchor.kingdomId);
        if (!k || !k.religion || !Array.isArray(k.religion.heresies) || !saga.anchor.heresyId) return;
        const before = k.religion.heresies.length;
        k.religion.heresies = k.religion.heresies.filter(h => h.id !== saga.anchor.heresyId);
        if (k.religion.heresies.length < before && typeof k.religion.piety === 'number') {
            k.religion.piety = Math.min(100, k.religion.piety + 3);
        }
    },

    /** A pretender sparks a succession crisis (systems/throne.js). */
    crisis(c) {
        const { player, world, saga } = c;
        const k = _kingdom(world, saga.anchor.kingdomId);
        if (!k || !k.isAlive || Throne.crisisFor(player, k.id)) return;
        const crisis = Throne.startCrisis(player, world, k, 'disputed', k.ruler || 'the crown');
        if (!crisis) return;
        const pretender = crisis.claimants.find(cl => cl.id === 'rival');
        if (pretender) {
            pretender.support += 5;
            saga.anchor.villain = pretender.name;
            saga.anchor.pretenderId = pretender.character ? pretender.character.id : null;
        }
        saga.anchor.crisisId = crisis.id;
    },

    /** The player's weight behind the pretender in the crisis. */
    backPretender(c, e) {
        const crisis = Sagas._crisis(c.player, c.saga);
        if (!crisis) return;
        const pretender = crisis.claimants.find(cl => cl.id === 'rival');
        if (!pretender) return;
        if (crisis.backing && crisis.backing.claimantId !== 'rival') return;
        if (!crisis.backing) crisis.backing = { claimantId: 'rival', gold: 0, prestige: 0, battles: 0 };
        pretender.support += _num(e.support);
    },

    /** The crisis collapses (the pretender is unmasked). */
    endCrisis(c) {
        const st = Throne.state(c.player);
        st.crises = st.crises.filter(cr => cr.id !== c.saga.anchor.crisisId);
    },

    /** A claim on the saga kingdom's throne (marriage into the pretender's line). */
    claim(c, e) {
        const k = _kingdom(c.world, c.saga.anchor.kingdomId);
        if (!k) return;
        Throne.grantClaim(c.player, c.world, k.id, 'marriage', _num(e.strength), { mode: 'add', cap: 40 });
    },

    /** The player's deed is a crime in the saga's kingdom (systems/underworld.js). */
    crime(c, e) {
        Underworld.recordCrime(c.player, c.world, e.crime || 'theft', { kingdom: c.saga.anchor.kingdomId, scale: _num(e.scale) || 1 });
    },

    /** The player is cured of the saga's plague. */
    cure(c) {
        const st = Ailments.getState(c.player);
        for (const rec of st.list.filter(a => a.id === 'plague')) Ailments._remove(c.player, rec);
    },

    /** Daily: the saga's monster/raiders strike a settlement near them. */
    raid(c, e) {
        const { world, saga, player } = c;
        let center = null;
        if (e.near === 'boss') {
            const boss = saga.units.find(u => u.role === 'boss' && !u.slain && !u.gone);
            if (boss) center = { q: boss.q, r: boss.r };
        } else {
            center = saga.anchor.settlement;
        }
        if (!center) return;
        const radius = _num(e.radius) || 5;
        const coastal = e.near === 'coast';
        const pool = (world.getAllSettlements ? world.getAllSettlements() : []).filter(s =>
            _dist(world, center.q, center.r, s.q, s.r) <= radius
            && (!coastal || Sagas._seaNear(world, s.q, s.r, 1)));
        if (!pool.length) return;
        const pick = Utils.randPick(pool);
        const live = _liveSettlement(world, pick.q, pick.r);
        if (!live) return;
        if (e.population) live.population = Math.max(10, Math.floor(_num(live.population) * (1 + _num(e.population))));
        if (e.damage) live.damage = Math.min(0.9, _num(live.damage) + _num(e.damage));
        const text = Sagas.fill(e.text || 'Raiders struck {target}.', saga, { target: live.name || 'a village' });
        if (Array.isArray(world.events)) world.events.push({ text: `${saga.icon} ${text}`, type: 'military' });
        const owned = Taxation.getPlayerSettlements(player, world).some(s => s.q === pick.q && s.r === pick.r);
        if (owned) c.notify(saga.icon, `${saga.name}: Your Holding Raided`, text, 'error');
        else if (saga.known && player && player.q != null && _dist(world, player.q, player.r, pick.q, pick.r) <= Sagas.config().hearRadius) {
            c.notify(saga.icon, saga.name, text, 'warning');
        }
    },

    /** A rival adventurer's part in the story: renown, an attitude shift, news. */
    rival(c, e) {
        const { player, world, saga } = c;
        const ref = saga.anchor.rival;
        const r = ref ? Rivals.get(player, ref.id) : null;
        if (!r || r.dead) return;
        if (e.renown) r.renown = _num(r.renown) + _num(e.renown);
        if (e.attitude) Rivals.remember(r, world, `crossed them in ${saga.name}`, _num(e.attitude));
        if (e.news) Rivals._news(player, world, r, saga.icon, Sagas.fill(e.news, saga));
    },

    /** Rewards and scars for the player — only when they took part, unless `always`. */
    reward(c, e) {
        const { player, world, saga } = c;
        if (!e.always && !saga.involved) return;
        const day = _day(world);
        const parts = [];
        if (e.gold) {
            player.gold = Math.max(0, _num(player.gold) + _num(e.gold));
            parts.push(`${e.gold > 0 ? '+' : ''}${e.gold} gold`);
        }
        if (e.renown) {
            player.renown = Math.max(0, _num(player.renown) + _num(e.renown));
            parts.push(`${e.renown > 0 ? '+' : ''}${e.renown} renown`);
        }
        if (e.karma) {
            player.karma = _num(player.karma) + _num(e.karma);
            parts.push(`${e.karma > 0 ? '+' : ''}${e.karma} karma`);
        }
        if (e.prestige && player.house) {
            if (e.prestige > 0) House.award(player.house, e.prestige, saga.name, day);
            else {
                const loss = Math.min(_num(player.house.prestige), -e.prestige);
                if (loss > 0) House.spend(player.house, loss, saga.name, day);
            }
            parts.push(`${e.prestige > 0 ? '+' : ''}${e.prestige} Prestige`);
        }
        if (e.reputation && saga.anchor.kingdomId) {
            if (!player.reputation) player.reputation = {};
            const kid = saga.anchor.kingdomId;
            player.reputation[kid] = (player.reputation[kid] || 0) + _num(e.reputation);
            parts.push(`${e.reputation > 0 ? '+' : ''}${e.reputation} reputation in ${saga.anchor.kingdomName}`);
        }
        if (e.items) {
            const res = PlayerInventory.addOrSell(player, e.items);
            for (const [item, n] of Object.entries(e.items)) parts.push(`${n} ${item.replace(/_/g, ' ')}`);
            if (res && res.gold > 0) parts.push(`(${res.gold} gold for what would not fit)`);
        }
        if (e.deeds) Traits.recordDeeds(player, e.deeds);
        if (e.chronicle && player.house) House._chronicle(player.house, world, Sagas.fill(e.chronicle, saga), ['saga', saga.id]);
        if (parts.length) saga.rewards.push(parts.join(', '));
    },

    flag(c, e) {
        for (const f of _list(e.name)) c.saga.flags[f] = true;
    },
};

// Transition conditions (`if` keys). Checked in this order; `chance` last so
// no RNG is drawn unless everything else already holds.
const CONDITIONS = ['timeout', 'afterDays', 'flag', 'notFlag', 'involved', 'rival', 'unit', 'site', 'crisis', 'chance'];
const ACTION_REQUIRES = ['near', 'radius', 'flag', 'notFlag', 'army', 'renown', 'prestige', 'holdings'];
const ACTION_COSTS = ['gold', 'prestige', 'items'];
const ANCHORS = ['lair', 'kingdom', 'faith', 'throne', 'coast'];

export const Sagas = {
    EFFECTS,
    CONDITIONS,
    ACTION_REQUIRES,
    ACTION_COSTS,
    ANCHORS,
    TOKENS,

    // ──────────── DATA ────────────

    data() {
        return DataLoader.sagas || (DataLoader.get && DataLoader.get('sagas')) || {};
    },

    config() {
        return { ...DEFAULT_CONFIG, ...(Sagas.data().config || {}) };
    },

    templates() {
        return Sagas.data().sagas || {};
    },

    template(id) {
        return Sagas.templates()[id] || null;
    },

    chapterDef(saga, chapterId = null) {
        const t = Sagas.template(saga.id);
        return (t && t.chapters && t.chapters[chapterId || saga.chapter]) || null;
    },

    // ──────────── STATE ────────────

    _blank() {
        return { nextStartDay: null, nextUid: 1, active: [], done: [], used: {}, lastDay: null, stats: { started: 0, ended: 0, joined: 0, won: 0, beastsSlain: 0, bountyGold: 0 } };
    },

    state(player) {
        if (!player) return Sagas._blank();
        let st = player.sagas;
        if (!st || typeof st !== 'object' || Array.isArray(st)) {
            player.sagas = Sagas._blank();
            return player.sagas;
        }
        const blank = Sagas._blank();
        if (st.nextStartDay === undefined) st.nextStartDay = null;
        if (!(st.nextUid > 0)) st.nextUid = 1;
        if (!Array.isArray(st.active)) st.active = [];
        if (!Array.isArray(st.done)) st.done = [];
        if (!st.used || typeof st.used !== 'object') st.used = {};
        if (st.lastDay === undefined) st.lastDay = null;
        st.stats = { ...blank.stats, ...(st.stats && typeof st.stats === 'object' ? st.stats : {}) };
        for (const s of st.active) Sagas._backfill(s);
        for (const s of st.done) Sagas._backfill(s);
        return st;
    },

    _backfill(s) {
        if (!s.anchor || typeof s.anchor !== 'object') s.anchor = {};
        if (!s.flags || typeof s.flags !== 'object') s.flags = {};
        for (const k of ['history', 'heard', 'units', 'petitions', 'taken', 'rewards']) if (!Array.isArray(s[k])) s[k] = [];
        if (typeof s.known !== 'boolean') s.known = false;
        if (typeof s.involved !== 'boolean') s.involved = false;
        if (s.chapterEnds === undefined) s.chapterEnds = null;
        if (s.ended === undefined) s.ended = null;
        if (s.questId === undefined) s.questId = null;
        return s;
    },

    serialize(player) {
        return player && player.sagas ? JSON.parse(JSON.stringify(player.sagas)) : null;
    },

    /** Backfill after load (older saves have no sagas; the first starts on schedule). */
    loadState(player) {
        Sagas.state(player);
    },

    active(player) {
        return Sagas.state(player).active;
    },

    get(player, uid) {
        const st = Sagas.state(player);
        return st.active.find(s => s.uid === uid) || st.done.find(s => s.uid === uid) || null;
    },

    // ──────────── TEXT ────────────

    _tokens(saga, extra = null) {
        const a = (saga && saga.anchor) || {};
        return {
            kingdom: a.kingdomName || 'the realm',
            kingdom2: a.kingdom2Name || 'its neighbours',
            settlement: (a.settlement && a.settlement.name) || 'the town',
            site: (a.site && a.site.name) || a.siteName || 'the mountain',
            rival: (a.rival && a.rival.name) || 'a wandering adventurer',
            villain: a.villain || 'a stranger',
            faith: a.faith || 'the old faith',
            heresy: a.heresy || 'new sect',
            ruler: a.ruler || 'the crown',
            house: (a.house) || 'your House',
            target: 'a village',
            ...(extra || {}),
        };
    },

    /** Fill {tokens} from a saga's anchor. */
    fill(text, saga, extra = null) {
        const map = Sagas._tokens(saga, extra);
        return String(text == null ? '' : text).replace(/\{(\w+)\}/g, (m, k) => (map[k] != null ? map[k] : m));
    },

    _fillDeep(obj, saga) {
        if (typeof obj === 'string') return Sagas.fill(obj, saga);
        if (Array.isArray(obj)) return obj.map(x => Sagas._fillDeep(x, saga));
        if (obj && typeof obj === 'object') {
            const out = {};
            for (const [k, v] of Object.entries(obj)) out[k] = Sagas._fillDeep(v, saga);
            return out;
        }
        return obj;
    },

    // ──────────── WORLD HELPERS ────────────

    _settlementsOf(world, kid) {
        return (world.getAllSettlements ? world.getAllSettlements() : []).filter(s => s.kingdom === kid);
    },

    _seaNear(world, q, r, radius = 1) {
        for (const h of Hex.hexesInRange(q, r, radius)) {
            const t = world.getTile(Hex.wrapQ(h.q, world.width), h.r);
            if (t && t.terrain && WATER.has(t.terrain.id)) return { q: Hex.wrapQ(h.q, world.width), r: h.r };
        }
        return null;
    },

    _freeTileNear(world, center, minD, maxD, test = null) {
        if (!center) return null;
        const spots = [];
        for (const h of Hex.hexesInRange(center.q, center.r, maxD)) {
            const q = Hex.wrapQ(h.q, world.width);
            const t = world.getTile(q, h.r);
            if (!t || !t.terrain || !t.terrain.passable || t.settlement || t.improvement) continue;
            const d = _dist(world, center.q, center.r, q, h.r);
            if (d < minD || d > maxD) continue;
            if (test && !test(t)) continue;
            spots.push({ q, r: h.r });
        }
        return spots.length ? Utils.randPick(spots) : null;
    },

    _scopeKingdom(world, saga, scope) {
        if (scope === 'world') return null;
        const id = scope === 'kingdom2' ? saga.anchor.kingdom2Id : saga.anchor.kingdomId;
        const k = _kingdom(world, id);
        return k && k.isAlive ? k : null;
    },

    _scopeKingdoms(world, saga, scope) {
        if (scope === 'world') return (world.kingdoms || []).filter(k => k.isAlive);
        const ids = scope === 'both' ? [saga.anchor.kingdomId, saga.anchor.kingdom2Id]
            : [scope === 'kingdom2' ? saga.anchor.kingdom2Id : saga.anchor.kingdomId];
        return ids.map(id => _kingdom(world, id)).filter(k => k && k.isAlive);
    },

    _scopeSettlements(world, saga, scope) {
        if (scope === 'kingdom' || scope === 'kingdom2') {
            const k = Sagas._scopeKingdom(world, saga, scope);
            if (!k) return [];
            return Sagas._settlementsOf(world, k.id).map(s => _liveSettlement(world, s.q, s.r)).filter(Boolean);
        }
        const s = saga.anchor.settlement;
        const live = s ? _liveSettlement(world, s.q, s.r) : null;
        return live ? [live] : [];
    },

    /** Where a kingdom-wide event is pinned (its saga settlement, or the capital). */
    _kingdomPoint(world, saga, kingdom) {
        const s = saga.anchor.settlement;
        if (s && kingdom.id === saga.anchor.kingdomId) return s;
        const cap = kingdom.capital;
        const live = cap ? _liveSettlement(world, cap.q, cap.r) : null;
        return cap ? { q: cap.q, r: cap.r, name: live ? live.name : kingdom.name } : null;
    },

    _unitSpot(world, saga, at) {
        const a = saga.anchor;
        if (at === 'site') return a.site || a.lair || a.settlement || null;
        if (at === 'sea') {
            if (a.sea) return a.sea;
            const s = a.settlement;
            const sea = s ? (Sagas._seaNear(world, s.q, s.r, 1) || Sagas._seaNear(world, s.q, s.r, 3)) : null;
            if (sea) a.sea = sea;
            return sea;
        }
        if (at === 'wild') return Sagas._freeTileNear(world, a.settlement, 2, 5) || a.settlement || null;
        return a.settlement || null;
    },

    _spawnUnit(world, rec) {
        const unit = new WorldUnit(rec.type, rec.q, rec.r);
        unit.name = rec.name;
        unit.icon = rec.icon;
        unit.strength = rec.strength;
        unit.population = Math.max(1, Math.round(rec.strength / 3));
        unit.maxAge = 1e9;
        unit.sagaKey = rec.key;
        world.units.push(unit);
        _liveMap(world).set(rec.key, unit);
        return unit;
    },

    /** Track saga units: who killed them, where they went; re-spawn them after a load. */
    _syncUnits(world, saga, player = null, notify = null) {
        if (!Array.isArray(world.units)) world.units = [];
        const map = _liveMap(world);
        for (const rec of saga.units) {
            if (rec.slain || rec.gone) continue;
            let unit = map.get(rec.key);
            if (!unit) {
                unit = world.units.find(u => u.sagaKey === rec.key) || null;
                if (unit) map.set(rec.key, unit);
            }
            if (unit && unit.destroyed) {
                if (unit.slainByPlayer) {
                    rec.slain = true;
                    if (player) {
                        Sagas._involve(player, saga);
                        Sagas._payBounty(player, world, saga, rec, notify);
                    }
                } else rec.gone = true;
                map.delete(rec.key);
                continue;
            }
            if (!unit || !world.units.includes(unit)) {
                Sagas._spawnUnit(world, rec);
                continue;
            }
            rec.q = unit.q;
            rec.r = unit.r;
        }
    },

    // ──────────── BOUNTIES ────────────
    // A saga beast (the wyrm, the reaver flagship and her galleys, the Iron
    // Company) carries a bounty from the realm it threatens: gold out of that
    // realm's treasury, renown, standing at its court, Prestige, and what can
    // be cut from the carcass or the wreck (data/sagas.json → unit.bounty).
    // Paid when the player's own battle kills it (WorldUnit.slainByPlayer);
    // bosses with `post` are cried on the notice boards nearby while they roam
    // (BountyHunting.generateBoardOffers → Sagas.bountyOffers).

    /** A unit record's bounty block (old saves: looked up from the template). */
    _unitBounty(saga, rec) {
        if (rec && rec.bounty) return rec.bounty;
        const tmpl = Sagas.template(saga.id);
        for (const ch of Object.values((tmpl && tmpl.chapters) || {})) {
            const all = [...(ch.effects || []), ...(ch.daily || []), ...(ch.actions || []).flatMap(a => a.effects || [])];
            const e = all.find(x => x && x.do === 'unit' && (x.role || 'unit') === rec.role && x.bounty);
            if (e) return e.bounty;
        }
        return null;
    },

    /** The posted price on a unit's head (the midpoint of its range; no roll). */
    bountyPrice(saga, rec) {
        const b = rec && Sagas._unitBounty(saga, rec);
        if (!b) return 0;
        const g = Array.isArray(b.gold) ? (b.gold[0] + b.gold[1]) / 2 : _num(b.gold);
        return Math.round(g);
    },

    /**
     * Pay out a slain saga unit's bounty (once). The realm pays from its
     * treasury; a realm that is gone or broke leaves half, passed round the
     * villages. Returns the payout summary or null.
     */
    _payBounty(player, world, saga, rec, notify = null) {
        if (!player || !rec || rec.bountyPaid) return null;
        const b = Sagas._unitBounty(saga, rec);
        if (!b) return null;
        rec.bountyPaid = true;
        const day = _day(world);
        const st = Sagas.state(player);
        const kingdom = _kingdom(world, saga.anchor.kingdomId);
        const realm = (kingdom && kingdom.name) || saga.anchor.kingdomName || 'the countryside';
        const posted = Sagas.bountyPrice(saga, rec);
        let gold = posted;
        if (kingdom) {
            const treasury = _num(kingdom.treasury);
            const paid = Math.min(gold, Math.max(Math.floor(gold / 2), treasury));
            kingdom.treasury = Math.max(0, treasury - paid);
            gold = paid;
        } else {
            gold = Math.floor(gold / 2);
        }
        const parts = [];
        if (gold > 0) {
            player.gold = _num(player.gold) + gold;
            parts.push(`${gold} gold from ${realm}`);
        }
        if (b.renown) {
            player.renown = Math.max(0, _num(player.renown) + _num(b.renown));
            parts.push(`+${b.renown} renown`);
        }
        if (b.reputation && saga.anchor.kingdomId) {
            if (!player.reputation) player.reputation = {};
            const kid = saga.anchor.kingdomId;
            player.reputation[kid] = (player.reputation[kid] || 0) + _num(b.reputation);
            parts.push(`+${b.reputation} reputation in ${realm}`);
        }
        if (b.prestige && player.house) {
            House.award(player.house, _num(b.prestige), `slew ${rec.name}`, day);
            parts.push(`+${b.prestige} Prestige`);
        }
        const items = {};
        for (const [item, n] of Object.entries(b.loot || {})) {
            const q = Math.max(0, _roll(n));
            if (q > 0) items[item] = (items[item] || 0) + q;
        }
        for (const [item, chance] of Object.entries(b.rare || {})) {
            if (Utils.random() < _num(chance)) items[item] = (items[item] || 0) + 1;
        }
        if (Object.keys(items).length) {
            const res = PlayerInventory.addOrSell(player, items);
            parts.push(Object.entries(items).map(([item, n]) => `${n} ${item.replace(/_/g, ' ')}`).join(', '));
            if (res && res.gold > 0) parts.push(`(${res.gold} gold for what would not fit)`);
        }
        Traits.recordDeeds(player, { valor: b.post ? 3 : 1 });
        st.stats.beastsSlain = _num(st.stats.beastsSlain) + 1;
        st.stats.bountyGold = _num(st.stats.bountyGold) + gold;
        rec.bountyGold = gold;
        if (b.post && player.house) House._chronicle(player.house, world, `${player.name || 'The head of the House'} slew ${rec.name} and claimed the bounty of ${realm}.`, ['saga', saga.id]);
        const text = `${rec.icon || '💰'} ${rec.name} is dead. The bounty: ${parts.join(', ')}.`;
        saga.rewards.push(`Bounty on ${rec.name}: ${parts.join(', ')}`);
        if (notify) notify('💰', 'Bounty Claimed', text, 'success');
        return { gold, posted, items, text };
    },

    /** Live saga units by key: { saga, rec } — for bounty tracking. */
    unitRecord(player, key) {
        for (const saga of Sagas.state(player).active) {
            const rec = (saga.units || []).find(u => u.key === key);
            if (rec) return { saga, rec };
        }
        for (const saga of Sagas.state(player).done || []) {
            const rec = (saga.units || []).find(u => u.key === key);
            if (rec) return { saga, rec };
        }
        return null;
    },

    /**
     * Notice-board offers for the posted saga beasts roaming within reach of
     * this settlement. Plain data; no RNG. Accepted offers live in
     * player.activeBounties (type 'saga_beast') and are tracked by
     * BountyHunting.processDaily.
     */
    bountyOffers(player, world, tile) {
        const out = [];
        if (!player || !world || !tile) return out;
        const radius = Sagas.config().tavernRadius;
        for (const saga of Sagas.state(player).active) {
            for (const rec of saga.units || []) {
                if (rec.slain || rec.gone) continue;
                const b = Sagas._unitBounty(saga, rec);
                if (!b || !b.post) continue;
                if (_dist(world, tile.q, tile.r, rec.q, rec.r) > radius) continue;
                const pay = Sagas.bountyPrice(saga, rec);
                const realm = saga.anchor.kingdomName || 'the countryside';
                out.push({
                    id: `saga_${rec.key}`,
                    type: 'saga_beast',
                    icon: rec.icon || '🐉',
                    name: `Bounty: ${rec.name}`,
                    targetName: rec.name,
                    sagaUid: saga.uid,
                    sagaKey: rec.key,
                    notoriety: 'legendary',
                    difficulty: Math.min(10, Math.max(5, Math.round(_num(rec.strength) / 12))),
                    actualPay: pay,
                    daysLimit: 120,
                    daysElapsed: 0,
                    fromSettlement: (tile.settlement && tile.settlement.name) || 'Unknown Settlement',
                    fromQ: tile.q, fromR: tile.r,
                    targetQ: rec.q, targetR: rec.r,
                    lastKnownQ: rec.q, lastKnownR: rec.r,
                    status: 'active',
                    canRecruit: false,
                    targetBackstory: `Part of the saga "${saga.name}". Strength about ${rec.strength}: bring an army.`,
                    description: `${realm} pays ${pay}g for ${rec.name}, last seen near (${rec.q}, ${rec.r}). Defeat it in battle; a hunter who takes the notice earns a quarter more.`,
                });
            }
        }
        return out;
    },

    _crisis(player, saga) {
        const id = saga.anchor.crisisId;
        if (!id) return null;
        return Throne.state(player).crises.find(c => c.id === id) || null;
    },

    /** 'won' | 'lost' | null (still running) for the saga's succession crisis. */
    _crisisOutcome(player, world, saga) {
        if (!saga.anchor.crisisId) return 'lost';
        if (Sagas._crisis(player, saga)) return null;
        const k = _kingdom(world, saga.anchor.kingdomId);
        const ruler = k && k.characterData && k.characterData.ruler;
        return ruler && saga.anchor.pretenderId != null && ruler.id === saga.anchor.pretenderId ? 'won' : 'lost';
    },

    _siteState(world, saga) {
        const s = saga.anchor.site;
        const tile = s && world.getTile ? world.getTile(s.q, s.r) : null;
        const poi = tile && tile.improvement;
        if (!poi) return null;
        if (poi.delved && poi.delved.reason === 'rival') return 'looted';
        if (poi.lootedBy) return 'looted';
        if (poi.delved && (poi.delved.reason === 'cleared' || _num(poi.delved.depth) >= 2)) return 'delved';
        return poi.delved ? 'entered' : 'untouched';
    },

    // ──────────── ANCHORS ────────────

    /** Kingdoms already at the centre of a running saga. */
    _busyKingdoms(player) {
        return new Set(Sagas.state(player).active.map(s => s.anchor.kingdomId).filter(Boolean));
    },

    _neighbour(world, k) {
        let best = null;
        let bestD = Infinity;
        if (!k.capital) return null;
        for (const o of world.kingdoms || []) {
            if (!o.isAlive || o.id === k.id || !o.capital) continue;
            const d = _dist(world, k.capital.q, k.capital.r, o.capital.q, o.capital.r);
            if (d < bestD) { best = o; bestD = d; }
        }
        return best;
    },

    _baseAnchor(world, k, s, player) {
        const k2 = Sagas._neighbour(world, k);
        const faith = k.religion ? ((Religion.getKingdomFaith(k) || {}).name || k.religion.name || null) : null;
        return {
            kingdomId: k.id,
            kingdomName: k.name,
            kingdom2Id: k2 ? k2.id : null,
            kingdom2Name: k2 ? k2.name : null,
            settlement: { q: s.q, r: s.r, name: s.name },
            faith,
            ruler: k.ruler || null,
            house: (player && player.house && player.house.name) || null,
        };
    },

    /** Pick where a saga happens. Draws RNG; returns null when the world has no fit. */
    _findAnchor(player, world, tmpl) {
        const busy = Sagas._busyKingdoms(player);
        const ruled = Throne.ruledKingdom(player, world);
        const kingdoms = (world.kingdoms || []).filter(k => k.isAlive && !busy.has(k.id) && k !== ruled);
        const fit = tmpl.fit || {};
        if (fit.minKingdoms && (world.kingdoms || []).filter(k => k.isAlive).length < fit.minKingdoms) return null;
        if (fit.faith) {
            for (let i = kingdoms.length - 1; i >= 0; i--) if (!kingdoms[i].religion) kingdoms.splice(i, 1);
        }
        const withTowns = kingdoms.map(k => ({ k, towns: Sagas._settlementsOf(world, k.id) })).filter(x => x.towns.length >= 2);
        if (!withTowns.length) return null;
        const kind = tmpl.anchor || 'kingdom';

        if (kind === 'lair') {
            const terrain = (fit.terrain && fit.terrain.length) ? fit.terrain : LAIR_TERRAIN;
            const towns = Utils.shuffle(withTowns.flatMap(x => x.towns.map(t => ({ k: x.k, t }))));
            for (const { k, t } of towns.slice(0, 40)) {
                const spot = Sagas._freeTileNear(world, t, 3, 7, tile => terrain.includes(tile.terrain.id));
                if (!spot) continue;
                const a = Sagas._baseAnchor(world, k, t, player);
                a.lair = spot;
                return a;
            }
            return null;
        }
        if (kind === 'coast') {
            const towns = Utils.shuffle(withTowns.flatMap(x => x.towns.map(t => ({ k: x.k, t }))));
            for (const { k, t } of towns) {
                const sea = Sagas._seaNear(world, t.q, t.r, 1);
                if (!sea) continue;
                const a = Sagas._baseAnchor(world, k, t, player);
                a.sea = sea;
                return a;
            }
            return null;
        }
        let pool = withTowns;
        if (kind === 'throne') {
            pool = pool.filter(x => x.k.characterData && x.k.characterData.ruler && !Throne.crisisFor(player, x.k.id));
        }
        if (!pool.length) return null;
        const pick = Utils.randPick(pool);
        const k = pick.k;
        let s;
        if (kind === 'kingdom' && k.capital) s = pick.towns.find(t => t.q === k.capital.q && t.r === k.capital.r);
        if (!s) {
            const others = pick.towns.filter(t => !k.capital || t.q !== k.capital.q || t.r !== k.capital.r);
            s = Utils.randPick(others.length ? others : pick.towns);
        }
        return Sagas._baseAnchor(world, k, s, player);
    },

    // ──────────── STARTING ────────────

    /** The first start day: firstStart range, picked by a hash of the world seed (no RNG). */
    _firstStartDay(world) {
        const [lo, hi] = Sagas.config().firstStart;
        const seed = (world && world.generationParams && world.generationParams.seed) || 0;
        const h = Math.abs(Utils.hashStr(`sagas:${seed}`)) || 0;
        return lo + (h % Math.max(1, hi - lo + 1));
    },

    /** Templates that could start now, with weights (deterministic). */
    _candidates(player, world) {
        const st = Sagas.state(player);
        const day = _day(world);
        const cfg = Sagas.config();
        const running = new Set(st.active.map(s => s.id));
        return Object.entries(Sagas.templates())
            .filter(([id]) => !running.has(id) && !(st.used[id] != null && day - st.used[id] < cfg.repeatAfterDays))
            .map(([id, t]) => ({ id, t, weight: _num(t.weight) || 1 }));
    },

    /**
     * Start a saga now. `id` forces a template (tests, debug); otherwise a
     * weighted pick of the templates that fit the world. Returns it or null.
     */
    start(player, world, id = null, opts = {}) {
        const st = Sagas.state(player);
        let pool = id ? [{ id, t: Sagas.template(id), weight: 1 }].filter(x => x.t) : Sagas._candidates(player, world);
        while (pool.length) {
            const pick = pool.length === 1 ? pool[0] : Utils.weightedPick(pool.map(x => ({ value: x, weight: x.weight })));
            pool = pool.filter(x => x !== pick);
            const anchor = opts.anchor || Sagas._findAnchor(player, world, pick.t);
            if (!anchor) continue;
            return Sagas._begin(player, world, pick.id, pick.t, anchor);
        }
        return null;
    },

    _begin(player, world, id, tmpl, anchor) {
        const st = Sagas.state(player);
        const day = _day(world);
        const saga = Sagas._backfill({
            uid: `s${st.nextUid++}`,
            id,
            name: tmpl.name,
            icon: tmpl.icon || '📜',
            startDay: day,
            chapter: null,
            chapterDay: day,
            anchor: { ...anchor },
        });
        // Villain names from the data pool; a rival adventurer to race
        const names = (Sagas.data().names || {})[tmpl.villain];
        if (Array.isArray(names) && names.length) saga.anchor.villain = Utils.randPick(names);
        const rivals = Rivals.alive(player);
        if (rivals.length) {
            const r = Utils.randPick(rivals);
            saga.anchor.rival = { id: r.id, name: r.name };
        }
        st.active.push(saga);
        st.used[id] = day;
        st.stats.started++;
        return saga;
    },

    // ──────────── DAILY ────────────

    /**
     * One day of saga life: maybe start one, then tick each running saga
     * (units, petitions, daily effects, transitions). Returns
     * { notices: [{icon,title,text,type}] } for the end-of-day report.
     */
    processDay(world, player) {
        const out = { notices: [] };
        if (!world || !player) return out;
        const st = Sagas.state(player);
        const day = _day(world);
        if (st.lastDay === day) return out;
        st.lastDay = day;
        const notify = (icon, title, text, type = 'info') => out.notices.push({ icon, title, text, type });
        const cfg = Sagas.config();

        // Schedule (no RNG until a saga actually starts)
        if (st.nextStartDay == null) st.nextStartDay = Sagas._firstStartDay(world);
        if (day >= st.nextStartDay && st.active.length < cfg.maxActive) {
            const saga = Sagas.start(player, world);
            st.nextStartDay = day + _roll(cfg.gapDays);
            if (saga) {
                const tmpl = Sagas.template(saga.id);
                Sagas._enter(player, world, saga, tmpl.start, notify);
            }
        }

        for (const saga of st.active.slice()) {
            if (saga.chapter == null) {
                Sagas._enter(player, world, saga, Sagas.template(saga.id).start, notify);
                continue;
            }
            Sagas._tick(player, world, saga, notify);
        }
        return out;
    },

    _ctx(player, world, saga, notify) {
        return { player, world, saga, notify: notify || (() => {}) };
    },

    _tick(player, world, saga, notify) {
        Sagas._syncUnits(world, saga, player, notify);
        Sagas._checkHooks(player, world, saga, notify);
        const def = Sagas.chapterDef(saga);
        if (!def) return;
        const c = Sagas._ctx(player, world, saga, notify);
        for (const e of def.daily || []) {
            if (e.chance != null && !(Utils.random() < e.chance)) continue;
            Sagas._apply(c, e);
        }
        // Word reaches a player who wanders close
        if (!saga.known && Sagas._playerNear(player, world, saga)) {
            Sagas._hear(player, world, saga, 'You hear of it on the road.', notify);
        }
        Sagas._advance(player, world, saga, notify);
    },

    /** Petitions ruled, quests taken: the player's ways into the story. */
    _checkHooks(player, world, saga) {
        const hist = (player.petitions && player.petitions.history) || [];
        for (const p of saga.petitions) {
            if (p.resolved) continue;
            const entry = hist.find(h => h.petitionId === p.id);
            if (!entry) continue;
            p.resolved = true;
            if (entry.outcome === 'ruled' && entry.choiceId) {
                saga.flags[`petition_${entry.choiceId}`] = true;
                Sagas._involve(player, saga);
            } else {
                saga.flags.petition_ignored = true;
            }
        }
        if (saga.questId && player.quests && (player.quests.active || []).some(q => q.id === saga.questId)) {
            Sagas._involve(player, saga);
        }
    },

    _involve(player, saga) {
        if (!saga.involved) Sagas.state(player).stats.joined++;
        saga.involved = true;
        saga.known = true;
    },

    _point(saga) {
        const a = saga.anchor;
        return a.site || a.lair || a.settlement || null;
    },

    _playerNear(player, world, saga, radius = null) {
        if (!player || player.q == null) return false;
        const r = radius == null ? Sagas.config().hearRadius : radius;
        const pts = [saga.anchor.settlement, saga.anchor.site, ...saga.units.filter(u => !u.slain && !u.gone)].filter(Boolean);
        return pts.some(p => _dist(world, player.q, player.r, p.q, p.r) <= r);
    },

    _learn(c, text) {
        const { saga, world } = c;
        saga.known = true;
        Sagas._addHeard(saga, world, text);
    },

    _addHeard(saga, world, text) {
        if (!text) return;
        if (saga.heard.length && saga.heard[saga.heard.length - 1].text === text) return;
        saga.heard.push({ day: _day(world), text });
        const cap = Sagas.config().heardCap;
        if (saga.heard.length > cap) saga.heard = saga.heard.slice(-cap);
    },

    /** The player learns of the saga now: the current chapter becomes seen. */
    _hear(player, world, saga, how, notify) {
        const first = !saga.known;
        saga.known = true;
        const def = Sagas.chapterDef(saga);
        const cur = saga.history[saga.history.length - 1];
        if (cur && !cur.heard) cur.heard = true;
        if (def && def.rumor) Sagas._addHeard(saga, world, Sagas.fill(def.rumor, saga));
        if (first && notify) {
            notify(saga.icon, `A Saga Unfolds: ${saga.name}`,
                `${how} ${def ? Sagas.fill(def.rumor || def.text, saga) : ''} (Journal → Sagas)`.trim(), 'info');
        }
        return first;
    },

    _conditionHolds(player, world, saga, cond) {
        const day = _day(world);
        const c = cond || {};
        if (c.timeout && !(saga.chapterEnds != null && day >= saga.chapterEnds)) return false;
        if (c.afterDays != null && day - saga.chapterDay < c.afterDays) return false;
        for (const f of _list(c.flag)) if (!saga.flags[f]) return false;
        for (const f of _list(c.notFlag)) if (saga.flags[f]) return false;
        if (c.involved != null && !!saga.involved !== !!c.involved) return false;
        if (c.rival) {
            const r = saga.anchor.rival ? Rivals.get(player, saga.anchor.rival.id) : null;
            if (!r || r.dead) return false;
        }
        if (c.unit) {
            const boss = saga.units.filter(u => u.role === (c.role || 'boss'));
            if (!boss.length) return false;
            if (c.unit === 'slain' && !boss.some(u => u.slain)) return false;
            if (c.unit === 'gone' && !boss.some(u => u.gone && !u.removed)) return false;
            if (c.unit === 'alive' && !boss.some(u => !u.slain && !u.gone)) return false;
        }
        if (c.site && Sagas._siteState(world, saga) !== c.site) return false;
        if (c.crisis && Sagas._crisisOutcome(player, world, saga) !== c.crisis) return false;
        if (c.chance != null && !(Utils.random() < c.chance)) return false;
        return true;
    },

    /** Check the chapter's transitions; follow the first that holds. */
    _advance(player, world, saga, notify) {
        for (let guard = 0; guard < 4; guard++) {
            const def = Sagas.chapterDef(saga);
            if (!def || def.end) return;
            const next = (def.next || []).find(n => Sagas._conditionHolds(player, world, saga, n.if));
            if (!next) return;
            Sagas._enter(player, world, saga, next.to, notify);
            if (saga.ended) return;
        }
    },

    _apply(c, e) {
        const fx = EFFECTS[e.do];
        if (!fx) return;
        const cond = e.if;
        if (cond) {
            for (const f of _list(cond.flag)) if (!c.saga.flags[f]) return;
            for (const f of _list(cond.notFlag)) if (c.saga.flags[f]) return;
            if (cond.involved != null && !!c.saga.involved !== !!cond.involved) return;
        }
        fx(c, e);
    },

    /** Begin a chapter: record it, apply its effects, tell the player if they'd know. */
    _enter(player, world, saga, chapterId, notify) {
        const tmpl = Sagas.template(saga.id);
        const def = tmpl && tmpl.chapters && tmpl.chapters[chapterId];
        if (!def) return;
        const day = _day(world);
        saga.chapter = chapterId;
        saga.chapterDay = day;
        saga.chapterEnds = def.days ? day + Math.max(1, _roll(def.days)) : null;
        const c = Sagas._ctx(player, world, saga, notify);
        for (const e of def.effects || []) Sagas._apply(c, e);

        const title = Sagas.fill(def.title, saga);
        const text = Sagas.fill(def.text, saga);
        // News travels: public chapters and endings reach the player wherever they are
        const wasKnown = saga.known;
        const heard = saga.known || !!def.public || !!def.end || Sagas._playerNear(player, world, saga);
        if (heard) saga.known = true;
        saga.history.push({ chapter: chapterId, title, text, day, heard });
        if (heard && def.rumor) Sagas._addHeard(saga, world, Sagas.fill(def.rumor, saga));
        if (def.public && Array.isArray(world.events)) world.events.push({ text: `${saga.icon} ${title}: ${text}`, type: 'saga' });

        if (def.end) {
            Sagas._finish(player, world, saga, chapterId, def, notify);
            return;
        }
        if (heard && notify) {
            notify(saga.icon, `${wasKnown ? '' : 'A Saga Unfolds — '}${saga.name}: ${title}`, `${text} (Journal → Sagas)`, def.public ? 'warning' : 'info');
        }
    },

    _finish(player, world, saga, chapterId, def, notify) {
        const st = Sagas.state(player);
        const day = _day(world);
        const end = def.end || {};
        const c = Sagas._ctx(player, world, saga, notify);
        EFFECTS.removeUnits(c, {});
        // The saga's quest: completed by a successful ending, withdrawn otherwise
        if (saga.questId && player.quests) {
            const active = (player.quests.active || []).some(q => q.id === saga.questId);
            if (end.success && active) {
                Quests.track(player, saga.questId);
            } else {
                player.quests.available = (player.quests.available || []).filter(q => q.id !== saga.questId);
                player.quests.active = (player.quests.active || []).filter(q => q.id !== saga.questId);
            }
        }
        saga.ended = { day, chapter: chapterId, title: Sagas.fill(def.title, saga), outcome: end.outcome || 'mixed', success: !!end.success };
        saga.chapterEnds = null;
        st.active = st.active.filter(s => s !== saga);
        st.done.unshift(saga);
        const cap = Sagas.config().doneCap;
        if (st.done.length > cap) st.done.length = cap;
        st.stats.ended++;
        if (saga.involved && end.success) st.stats.won++;
        if (notify) {
            const rewards = saga.rewards.length ? ` ${saga.rewards[saga.rewards.length - 1]}.` : '';
            const type = saga.involved ? (end.success ? 'success' : 'warning') : 'info';
            notify(saga.icon, `${saga.name} Ends: ${saga.ended.title}`, `${Sagas.fill(def.text, saga)}${rewards}`, type);
        }
    },

    // ──────────── THE PLAYER'S PART ────────────

    /** Where an action's `near` points. */
    _nearPoint(world, saga, which) {
        const a = saga.anchor;
        if (which === 'site') return a.site || a.lair || a.settlement || null;
        if (which === 'boss') {
            const boss = saga.units.find(u => u.role === 'boss' && !u.slain && !u.gone);
            return boss ? { q: boss.q, r: boss.r } : null;
        }
        if (which === 'capital') {
            const k = _kingdom(world, a.kingdomId);
            return k && k.capital ? { q: k.capital.q, r: k.capital.r } : a.settlement || null;
        }
        return a.settlement || null;
    },

    _nearLabel(world, saga, which) {
        const a = saga.anchor;
        if (which === 'site') return (a.site && a.site.name) || `the peaks near ${(a.settlement && a.settlement.name) || 'town'}`;
        if (which === 'boss') {
            const boss = saga.units.find(u => u.role === 'boss' && !u.slain && !u.gone);
            return boss ? boss.name : 'its quarry';
        }
        if (which === 'capital') {
            const k = _kingdom(world, a.kingdomId);
            const cap = k && k.capital ? _liveSettlement(world, k.capital.q, k.capital.r) : null;
            return cap ? cap.name : `the capital of ${a.kingdomName}`;
        }
        return (a.settlement && a.settlement.name) || 'the town';
    },

    /** Can the player take this action now? { ok, reason } */
    canAct(player, world, saga, action) {
        if (!saga || saga.ended || !action) return { ok: false, reason: 'That story is over.' };
        if (saga.taken.includes(action.id)) return { ok: false, reason: 'Already done.' };
        const req = action.requires || {};
        for (const f of _list(req.flag)) if (!saga.flags[f]) return { ok: false, reason: 'You need to learn more first.' };
        for (const f of _list(req.notFlag)) if (saga.flags[f]) return { ok: false, reason: 'You have already chosen another path.' };
        if (req.near) {
            const p = Sagas._nearPoint(world, saga, req.near);
            const radius = _num(req.radius) || 3;
            if (!p || player.q == null || _dist(world, player.q, player.r, p.q, p.r) > radius) {
                return { ok: false, reason: `Must be within ${radius} hexes of ${Sagas._nearLabel(world, saga, req.near)}.` };
            }
        }
        if (req.army && (player.army || []).length < req.army) return { ok: false, reason: `Needs an army of ${req.army}+.` };
        if (req.renown && _num(player.renown) < req.renown) return { ok: false, reason: `Needs ${req.renown} renown.` };
        if (req.prestige && _num(player.house && player.house.prestige) < req.prestige) return { ok: false, reason: `Needs ${req.prestige} Prestige.` };
        if (req.holdings && !Petitions.hasHoldings(player, world)) return { ok: false, reason: 'Needs holdings of your own.' };
        const cost = action.cost || {};
        if (cost.gold && _num(player.gold) < cost.gold) return { ok: false, reason: `Needs ${cost.gold} gold.` };
        if (cost.prestige && _num(player.house && player.house.prestige) < cost.prestige) return { ok: false, reason: `Needs ${cost.prestige} Prestige.` };
        for (const [item, n] of Object.entries(cost.items || {})) {
            if (_num(player.inventory && player.inventory[item]) < n) return { ok: false, reason: `Needs ${n} ${item.replace(/_/g, ' ')}.` };
        }
        return { ok: true };
    },

    /** The current chapter's actions for a known saga, with availability. */
    actions(player, world, saga) {
        if (!saga || saga.ended || !saga.known) return [];
        const def = Sagas.chapterDef(saga);
        return ((def && def.actions) || [])
            .filter(a => !saga.taken.includes(a.id))
            .map(a => ({ id: a.id, label: Sagas.fill(a.label, saga), cost: a.cost || null, ...Sagas.canAct(player, world, saga, a) }));
    },

    /** Take a chapter action. Returns { success, text, notices } or { success:false, reason }. */
    act(player, world, uid, actionId) {
        const saga = Sagas.state(player).active.find(s => s.uid === uid);
        if (!saga) return { success: false, reason: 'That story is over.' };
        const def = Sagas.chapterDef(saga);
        const action = def && (def.actions || []).find(a => a.id === actionId);
        const can = Sagas.canAct(player, world, saga, action);
        if (!can.ok) return { success: false, reason: can.reason };
        const cost = action.cost || {};
        const day = _day(world);
        if (cost.gold) player.gold = _num(player.gold) - cost.gold;
        if (cost.prestige && player.house) House.spend(player.house, cost.prestige, saga.name, day);
        for (const [item, n] of Object.entries(cost.items || {})) {
            player.inventory[item] -= n;
            if (player.inventory[item] <= 0) delete player.inventory[item];
        }
        saga.taken.push(action.id);
        for (const f of _list(action.flags)) saga.flags[f] = true;
        Sagas._involve(player, saga);
        const notices = [];
        const notify = (icon, title, text, type = 'info') => notices.push({ icon, title, text, type });
        const c = Sagas._ctx(player, world, saga, notify);
        for (const e of action.effects || []) Sagas._apply(c, { always: true, ...e });
        const text = Sagas.fill(action.text, saga);
        Sagas._addHeard(saga, world, text);
        Sagas._advance(player, world, saga, notify);
        return { success: true, text, notices };
    },

    // ──────────── HEARING ────────────

    /**
     * Tavern talk (the notice board, player/tavern): what this town has heard
     * of the sagas within earshot. The player learns of them. Returns
     * [{ icon, title, text }].
     */
    tavernRumors(player, world, tile) {
        const out = [];
        if (!player || !world || !tile) return out;
        const cfg = Sagas.config();
        const kid = tile.kingdom || (tile.settlement && tile.settlement.kingdom) || null;
        for (const saga of Sagas.state(player).active) {
            const def = Sagas.chapterDef(saga);
            if (!def || !def.rumor) continue;
            const p = saga.anchor.settlement;
            const close = p && _dist(world, tile.q, tile.r, p.q, p.r) <= cfg.tavernRadius;
            if (!close && !def.public && kid !== saga.anchor.kingdomId) continue;
            Sagas._hear(player, world, saga, 'Talk in the tavern:', null);
            out.push({ icon: saga.icon, title: `${saga.name}: ${Sagas.fill(def.title, saga)}`, text: Sagas.fill(def.rumor, saga) });
        }
        return out;
    },

    /** Known sagas for the journal: running ones first, then concluded. */
    journal(player) {
        const st = Sagas.state(player);
        return {
            active: st.active.filter(s => s.known),
            done: st.done.filter(s => s.known),
            unknownActive: st.active.filter(s => !s.known).length,
        };
    },

    // ──────────── CONTENT INTEGRITY ────────────

    /** Problems in data/sagas.json (empty when valid). Used by tests. */
    validate() {
        const problems = [];
        const tokenOk = (where, s) => {
            for (const m of String(s || '').matchAll(/\{(\w+)\}/g)) if (!TOKENS.includes(m[1])) problems.push(`${where}: unknown token {${m[1]}}`);
        };
        const checkEffect = (where, e) => {
            if (!e || !EFFECTS[e.do]) { problems.push(`${where}: unknown effect "${e && e.do}"`); return; }
            if (e.do === 'event') {
                for (const k of Object.keys(e.effects || {})) if (!WorldEvents.EFFECT_KEYS[k]) problems.push(`${where}: unknown event effect key ${k}`);
            }
            for (const k of Object.keys(e.if || {})) if (!['flag', 'notFlag', 'involved'].includes(k)) problems.push(`${where}: unknown effect condition ${k}`);
            tokenOk(where, e.text); tokenOk(where, e.name); tokenOk(where, e.news); tokenOk(where, e.chronicle); tokenOk(where, e.title);
        };
        for (const [id, t] of Object.entries(Sagas.templates())) {
            if (!t.name || !t.chapters || !t.start) { problems.push(`${id}: needs name, start and chapters`); continue; }
            if (!ANCHORS.includes(t.anchor || 'kingdom')) problems.push(`${id}: unknown anchor ${t.anchor}`);
            if (!t.chapters[t.start]) problems.push(`${id}: start chapter ${t.start} missing`);
            const chapters = Object.entries(t.chapters);
            const ends = chapters.filter(([, ch]) => ch.end);
            if (chapters.length - ends.length < 3) problems.push(`${id}: fewer than 3 story chapters`);
            if (ends.length < 2) problems.push(`${id}: needs at least two endings`);
            for (const [cid, ch] of chapters) {
                const where = `${id}.${cid}`;
                if (!ch.title || !ch.text) problems.push(`${where}: needs title and text`);
                tokenOk(where, ch.title); tokenOk(where, ch.text); tokenOk(where, ch.rumor);
                for (const e of ch.effects || []) checkEffect(where, e);
                for (const e of ch.daily || []) checkEffect(`${where} daily`, e);
                if (ch.end) continue;
                if (!Array.isArray(ch.days)) problems.push(`${where}: a story chapter needs days [min, max]`);
                const next = ch.next || [];
                if (!next.length) problems.push(`${where}: no transitions`);
                const last = next[next.length - 1];
                if (!last || !last.if || !last.if.timeout || Object.keys(last.if).length !== 1) problems.push(`${where}: last transition must be a plain timeout (the ignored path)`);
                for (const n of next) {
                    if (!t.chapters[n.to]) problems.push(`${where}: transition to missing chapter ${n.to}`);
                    for (const k of Object.keys(n.if || {})) if (!CONDITIONS.includes(k)) problems.push(`${where}: unknown condition ${k}`);
                    const f = n.if && n.if.flag;
                    for (const fl of _list(f)) {
                        if (fl.startsWith('petition_')) continue;
                        const set = chapters.some(([, c2]) => (c2.actions || []).some(a => _list(a.flags).includes(fl)));
                        if (!set) problems.push(`${where}: flag ${fl} is never set by an action`);
                    }
                }
                for (const a of ch.actions || []) {
                    if (!a.id || !a.label || !a.text) problems.push(`${where}: action needs id, label, text`);
                    for (const k of Object.keys(a.requires || {})) if (!ACTION_REQUIRES.includes(k)) problems.push(`${where}.${a.id}: unknown requirement ${k}`);
                    for (const k of Object.keys(a.cost || {})) if (!ACTION_COSTS.includes(k)) problems.push(`${where}.${a.id}: unknown cost ${k}`);
                    tokenOk(`${where}.${a.id}`, a.label); tokenOk(`${where}.${a.id}`, a.text);
                    for (const e of a.effects || []) checkEffect(`${where}.${a.id}`, e);
                }
                for (const e of ch.effects || []) {
                    if (e.do === 'petition' && !(t.petitions && t.petitions[e.id])) problems.push(`${where}: petition ${e.id} missing`);
                }
            }
            // Every chapter reachable from the start
            const seen = new Set([t.start]);
            const queue = [t.start];
            while (queue.length) {
                const ch = t.chapters[queue.shift()];
                for (const n of (ch && ch.next) || []) if (!seen.has(n.to)) { seen.add(n.to); queue.push(n.to); }
            }
            for (const [cid] of chapters) if (!seen.has(cid)) problems.push(`${id}.${cid}: unreachable`);
            for (const [pid, p] of Object.entries(t.petitions || {})) {
                if (!p.title || !p.text || !p.ignore || !Array.isArray(p.choices) || p.choices.length < 2) problems.push(`${id} petition ${pid}: malformed`);
                const blocks = [['ignore', (p.ignore && p.ignore.effects) || {}], ...(p.choices || []).map(ch => [ch.id, ch.effects || {}])];
                for (const [w, eff] of blocks) {
                    for (const k of Object.keys(eff)) if (!Petitions.EFFECTS[k]) problems.push(`${id} petition ${pid}.${w}: unknown effect ${k}`);
                }
            }
        }
        return problems;
    },
};
