// ============================================
// COALITIONS — the realms band together against an overmighty player
// ============================================
// Directed opposition that grows with the player. Once a week:
//
//   POWER      the player's might, read from real state (power()): towns held
//              in their own name and colonies, properties, a crown and its
//              towns, an office, the army, net worth (EconomyChronicle),
//              House Prestige, renown, and towns taken in the last year (the
//              'conquest' memories of the lords, world/npcLords.js).
//   THREAT     each realm's envy and fear of it (assess()): fear grows with
//              power and nearness (the realm's capital to the player's
//              nearest holding), envy with power and the lord's ambition; both
//              shaded by the realm's personality. A grudge adds what the
//              lord remembers (NPCLords.memoryOpinion), a blood feud sworn
//              down the generations (NPCLords.vendettaOf), bad standing and a
//              rival House's feud; goodwill and an alliance with the player's
//              crown take it off. The difficulty (core/difficulty.js
//              'hostility') scales it.
//   A LEAGUE   when power stays past formAt for brewWeeks weeks and enough
//              realms are hostile, they swear a named league ("The League of
//              X") under the most hostile, mightiest realm, with a casus belli
//              (a vendetta, conquests, a crown, sheer power). It sends its
//              terms (a court letter, systems/courtLetters.js): concede within
//              ultimatumDays or face it.
//   AT WAR     defied (or ignored), every member declares war through the real
//              machinery: RealmWars.declareWar on the player's holdings (war
//              hosts, holding sieges) and KingdomAI.startWar on a realm the
//              player rules; its towns lay a trade levy on the player
//              (TradePolicy.barPlayer, read by TradePolicy.saleCheck) and
//              cancel their licences; a crown the player rules is embargoed;
//              member lords grow cold (NPCLords.coalitionChill → their
//              opinion, audiences); member rival Houses' feuds flare. The
//              league's resolve wears down week by week, with each host
//              broken and each member lost, and grows when the player keeps
//              growing.
//   THE CLOCK  short of formAt, the courts' patience still wears thin: a
//              pressure clock (systems/pressure.js, st.clock) winds weekly,
//              faster the mightier the player (from about the watch mark
//              up), paused while a league stands or its memory is fresh. When
//              it is ripe the envoys ride (st.primed): for primedDays the
//              realms band together at joinShare × joinAt hostility, so a
//              powerful House draws a league every year or two, a middling
//              one now and then, a weak one never.
//   ENDINGS    appeased (concessions), humbled (the player cut down below
//              dissolvePowerShare × formAt), broken (too few members, or
//              resolve spent). Every ending ends the wars the league started
//              (in exhaustion; a member's own older war runs on). A cooldown
//              follows.
//   SPLITTING  the player can buy a member out (gold), seal it with a marriage
//              (Heirs.marryForAlliance) or cede it a holding — each ends that
//              member's war and leaves the league weaker.
//   HEIRS      a league outlives its target: on a succession it carries on
//              against the heir at heirShare of its resolve, and members whose
//              hostility has cooled drop out.
//   VENDETTAS  realms whose lords hold a blood feud against the player (their
//              own wrongs or their fathers') are sworn as rival Houses
//              (house.rivals) with a feud floor — which drives schemes and
//              rival agents (systems/schemes.js, systems/rivalAgents.js).
//
// Only the player is ever its target: with no player (world-only sims, the
// interregnum) nothing runs. No shared RNG is drawn: the few rolls are hashes
// and KingdomAI.startWar runs on its own stream. State on player.coalitions
// (saved). Content: data/coalitions.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { Difficulty } from '../core/difficulty.js';
import { NPCLords } from '../world/npcLords.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { LordInfluence } from '../world/kingdomState.js';
import { House } from './house.js';
import { RealmWars } from './realmWars.js';
import { TradePolicy } from './tradePolicy.js';
import { Heirs } from './heirs.js';
import { Ledger } from './ledger.js';
import { Technology } from './technology.js';
import { Ships } from './ships.js';
import { EconomyChronicle } from './economyChronicle.js';
import { Taxation } from './marketDynamics.js';
import { CourtLetters } from './courtLetters.js';
import { Pressure } from './pressure.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = (world) => _num(world && world.day);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _r1 = (v) => Math.round(v * 10) / 10;

/** A deterministic unit roll for `key` (no RNG stream is touched). */
function _roll(key) {
    // hashStr moves by 1 when the last character does: mix it, so next day's roll is a new one
    let h = Utils.hashStr(String(key)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return (h % 100000) / 100000;
}

function _seed(world) {
    const p = world && world.generationParams;
    return _num(p && p.seed, 1);
}

function _fill(text, vars) {
    return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

function _merge(base, over) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
        if (k.startsWith('_')) continue;
        out[k] = _obj(v) && _obj(base[k]) ? _merge(base[k], v) : v;
    }
    return out;
}

/** Built-in tuning; data/coalitions.json → config is laid over it. */
const DEFAULTS = {
    enabled: true, cadence: 7, offset: 3, difficultyScale: 1,
    power: {
        town: 12, property: 1.5, propertyCap: 30, crown: 40, crownTown: 4, title: 8,
        armyPer: 25, armyCap: 60, worthPer: 1500, worthCap: 50, prestigePer: 8, prestigeCap: 40,
        renownPer: 10, renownCap: 25, conquest: 12, conquestDays: 360, conquestCap: 48,
    },
    proximity: { near: 8, far: 40, floor: 0.25, noHoldings: 0.5 },
    threat: {
        fear: 0.55, envy: 0.35, ambitionEnvy: 0.5, fearShare: 0.6, envyShare: 0.5,
        grudge: 0.8, goodwill: 0.5, vendetta: 0.6, badRep: 0.25, goodRep: 0.3, feud: 0.3, allied: 0.5,
        personality: {},
    },
    concern: 70, alarmFeud: 2, formAt: 140, brewWeeks: 2, joinAt: 40, rejoinMargin: 15, minMembers: 2, maxMembers: 4,
    ultimatumDays: 14,
    resolve: {
        start: 50, perMember: 10, weekly: -3, max: 100, memberLost: -12, memberHumbled: -20,
        hostBroken: -4, holdingTaken: 3, powerGrowth: 0.2, turnedAgent: -4, exposedAgent: -8,
    },
    dissolvePowerShare: 0.6,
    cooldown: { appeased: 600, broken: 480, humbled: 360 },
    heirShare: 0.6,
    chill: { leader: 25, member: 15 },
    relationsFloor: -40,
    embargoLevy: 0.25,
    concession: { goldBase: 400, goldPerPower: 12, goldPerMember: 150, prestigeBase: 25, prestigePerMember: 5, goldShame: 10 },
    buyoff: { goldBase: 250, perMilitary: 0.5, perThreat: 8, reputation: 10, resolve: -10, marriageDowry: 0 },
    cede: { resolve: -15, reputation: 15 },
    vendetta: { rivalAt: 15, maxRivals: 5, feudPerWeight: 1.5 },
    names: ['The League of {place}'],
    casusBelli: {
        vendetta: 'Blood calls for blood: {cause}.',
        conquest: 'To win back the towns {house} tore from its neighbours.',
        crown: 'To cast down the upstart crown of {realm}.',
        power: 'To check the overmighty {house} before it swallows them all.',
    },
};

let _cfg = null;
let _cfgSrc;

export const Coalitions = {

    DEFAULTS,

    // ──────────── DATA ────────────

    data() {
        const g = DataLoader._gamedata;
        return (g && _obj(g.coalitions)) || {};
    },

    config() {
        const src = Coalitions.data().config;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            _cfg = _merge(DEFAULTS, _obj(src) || {});
        }
        return _cfg;
    },

    /**
     * How hard the world pushes back: data's difficultyScale over the
     * player's difficulty (core/difficulty.js 'hostility'; 1 on Normal).
     * Thresholds are divided by it and hostility multiplied.
     */
    difficulty(player) {
        const C = Coalitions.config();
        let d = 1;
        if (Difficulty && typeof Difficulty.mult === 'function') d = _num(Difficulty.mult(player, 'hostility'), 1);
        return Math.max(0.1, _num(C.difficultyScale, 1) * d);
    },

    // ──────────── STATE ────────────

    _blank() {
        return {
            realms: {},          // { kid: assessment } — last week's envy/fear per realm
            power: null,         // last week's power reckoning
            pressure: 0,         // weeks in a row the player stood past formAt
            active: null,        // the league against the player, or null
            history: [],         // past leagues: { id, name, leader, members, formed, ended, how }
            cooldownUntil: 0,
            primed: null,        // the pressure clock ran out: envoys ride ({ day, might, score }; systems/pressure.js)
            clock: null,         // the pressure clock (systems/pressure.js)
            generation: null,    // the House generation last seen (heirs)
            nextId: 1,
            stats: { formed: 0, appeased: 0, humbled: 0, broken: 0, boughtOff: 0, married: 0, ceded: 0, defied: 0 },
        };
    },

    state(player) {
        if (!player) return null;
        if (!_obj(player.coalitions)) player.coalitions = Coalitions._blank();
        const st = player.coalitions;
        const blank = Coalitions._blank();
        if (!_obj(st.realms)) st.realms = {};
        if (!Array.isArray(st.history)) st.history = [];
        if (!_obj(st.active)) st.active = null;
        if (!_obj(st.primed)) st.primed = null;
        st.pressure = _num(st.pressure);
        st.cooldownUntil = _num(st.cooldownUntil);
        if (!Number.isFinite(st.nextId)) st.nextId = 1;
        st.stats = { ...blank.stats, ...(_obj(st.stats) || {}) };
        return st;
    },

    serialize(player) {
        return player && player.coalitions ? JSON.parse(JSON.stringify(player.coalitions)) : null;
    },

    /** Backfill for older saves (no record yet: the realms take their measure next week). */
    loadState(player) {
        if (!player) return;
        Coalitions.state(player);
    },

    /** The league standing against the player now, or null. */
    active(player) {
        const c = player && player.coalitions && player.coalitions.active;
        return _obj(c) ? c : null;
    },

    /** The members still in the league: [{ kingdomId, name, ... }]. */
    members(player) {
        const c = Coalitions.active(player);
        return c ? Object.values(c.members || {}).filter(m => !m.left) : [];
    },

    isMember(player, kingdomId) {
        const c = Coalitions.active(player);
        const m = c && c.members ? c.members[kingdomId] : null;
        return !!(m && !m.left);
    },

    // ──────────── POWER ────────────

    /** Land army strength, as PlayerMilitary reckons it (without the tech/skill bonuses). */
    _army(player) {
        let s = 0;
        for (const u of (player && player.army) || []) {
            if (!u || Ships.isNavalUnit(u)) continue;
            s += _num(u.strength) * (1 + (_num(u.level, 1) - 1) * 0.2) * (_num(u.woundedDays) > 0 ? 0.5 : 1);
        }
        return s;
    },

    /** Towns taken from the realms in the last `days` days (the lords' 'conquest' memories). */
    conquests(world, day, days) {
        let n = 0;
        for (const k of (world && world.kingdoms) || []) {
            const mem = k && k.lord && Array.isArray(k.lord.memory) ? k.lord.memory : [];
            for (const e of mem) if (e && e.k === 'conquest' && !e.inh && day - _num(e.d) <= days) n++;
        }
        return n;
    },

    /**
     * The player's might: { score, parts: { towns, properties, crown, title,
     * army, wealth, prestige, renown, conquests }, realm (the crown they rule,
     * or null) }. opts.armyStrength overrides the army reckoning (endDay passes
     * PlayerMilitary.getArmyStrength).
     */
    power(player, world, opts = {}) {
        const P = Coalitions.config().power;
        const parts = { towns: 0, properties: 0, crown: 0, title: 0, army: 0, wealth: 0, prestige: 0, renown: 0, conquests: 0 };
        if (!player || !world) return { score: 0, parts, realm: null };
        const day = _day(world);
        parts.towns = Taxation.getPlayerSettlements(player, world).length * _num(P.town);
        parts.properties = Math.min(_num(P.propertyCap), ((player.properties || []).length) * _num(P.property));
        const realm = KingdomAI.playerRealm(world);
        if (realm) {
            const towns = typeof world.getSettlementsOf === 'function' ? world.getSettlementsOf(realm.id).length : 0;
            parts.crown = _num(P.crown) + towns * _num(P.crownTown);
        }
        if (player.currentTitle) parts.title = _num(P.title);
        const army = Number.isFinite(opts.armyStrength) ? opts.armyStrength : Coalitions._army(player);
        parts.army = Math.min(_num(P.armyCap), army / Math.max(1, _num(P.armyPer, 25)));
        const worth = opts.netWorth != null ? _num(opts.netWorth) : EconomyChronicle.netWorth(player, world).total;
        parts.wealth = Math.min(_num(P.worthCap), Math.max(0, worth) / Math.max(1, _num(P.worthPer, 1500)));
        parts.prestige = Math.min(_num(P.prestigeCap), Math.max(0, _num(player.house && player.house.prestige)) / Math.max(1, _num(P.prestigePer, 8)));
        parts.renown = Math.min(_num(P.renownCap), Math.max(0, _num(player.renown)) / Math.max(1, _num(P.renownPer, 10)));
        parts.conquests = Math.min(_num(P.conquestCap), Coalitions.conquests(world, day, _num(P.conquestDays, 360)) * _num(P.conquest));
        for (const k of Object.keys(parts)) parts[k] = _r1(parts[k]);
        const score = _r1(Object.values(parts).reduce((s, v) => s + v, 0));
        return { score, parts, realm };
    },

    /** Where the player's power stands on the map: holdings, colonies, properties, a ruled realm's towns. */
    _points(player, world, realm) {
        const out = [];
        for (const h of RealmWars.holdings(player, world)) out.push({ q: h.q, r: h.r });
        for (const ref of Taxation.getPlayerSettlements(player, world)) out.push({ q: ref.q, r: ref.r });
        if (realm) {
            if (realm.capital) out.push({ q: realm.capital.q, r: realm.capital.r });
            if (typeof world.getSettlementsOf === 'function') for (const s of world.getSettlementsOf(realm.id)) out.push({ q: s.q, r: s.r });
        }
        return out;
    },

    /** The realm's seat for measuring distance: its capital, else its first town. */
    _seat(world, kingdom) {
        if (kingdom.capital && Number.isFinite(kingdom.capital.q)) return kingdom.capital;
        const towns = typeof world.getSettlementsOf === 'function' ? world.getSettlementsOf(kingdom.id) : [];
        return towns[0] || null;
    },

    /** 1 when the player's power sits at the realm's door, down to `floor` far away. */
    proximity(world, kingdom, points, player = null) {
        const X = Coalitions.config().proximity;
        const seat = Coalitions._seat(world, kingdom);
        if (!seat) return _num(X.floor, 0.25);
        let pts = points;
        let scale = 1;
        if (!pts || !pts.length) {
            if (!player || !Number.isFinite(player.q)) return _num(X.floor, 0.25);
            pts = [{ q: player.q, r: player.r }];
            scale = _num(X.noHoldings, 0.5);
        }
        let d = Infinity;
        for (const p of pts) d = Math.min(d, Hex.wrappingDistance(seat.q, seat.r, p.q, p.r, world.width || 0));
        const near = _num(X.near, 8), far = Math.max(near + 1, _num(X.far, 40));
        const t = _clamp((d - near) / (far - near), 0, 1);
        return _r1((1 - t * (1 - _num(X.floor, 0.25))) * scale * 100) / 100;
    },

    // ──────────── THREAT ────────────

    /**
     * One realm's regard for the player: { kingdomId, name, fear, envy,
     * grudge, vendetta, hostility (0–100), prox, reasons[] }. Pure: no state
     * is written and no RNG drawn.
     */
    assess(player, world, kingdom, power, points, realm) {
        const C = Coalitions.config();
        const T = C.threat;
        const day = _day(world);
        const out = { kingdomId: kingdom.id, name: kingdom.name, fear: 0, envy: 0, grudge: 0, vendetta: 0, generations: 0, hostility: 0, prox: 0, reasons: [] };
        if (!kingdom.isAlive || kingdom.id === player.allegiance || (realm && kingdom.id === realm.id)) return out;
        const pers = _obj((T.personality || {})[KingdomAI.personalityId(kingdom)]) || {};
        const P = _num(power && power.score);
        const prox = Coalitions.proximity(world, kingdom, points, player);
        out.prox = prox;
        // Fear: power at the door. Envy: power anywhere, more so for an ambitious lord.
        out.fear = _clamp(P * prox * _num(T.fear) * _num(pers.fear, 1), 0, 100);
        const ambition = Math.max(0, LordInfluence.lean(kingdom, 'ambition'));
        out.envy = _clamp(P * _num(T.envy) * _num(pers.envy, 1) * (1 + ambition * _num(T.ambitionEnvy)) * (0.5 + 0.5 * prox), 0, 100);
        // The grudge: what the lord remembers, the blood owed, standing, a House feud
        const mem = NPCLords.memoryOpinion(kingdom.lord, day);
        const vend = NPCLords.vendettaOf(kingdom.lord, day);
        out.vendetta = vend.weight;
        out.generations = vend.generations;
        const rep = _num(player.reputation && player.reputation[kingdom.id]);
        const rival = player.house && player.house.rivals ? player.house.rivals[kingdom.id] : null;
        out.grudge = Math.max(0, -mem) * _num(T.grudge) - Math.max(0, mem) * _num(T.goodwill)
            + vend.weight * _num(T.vendetta)
            + Math.max(0, -rep) * _num(T.badRep) - Math.max(0, rep) * _num(T.goodRep)
            + _num(rival && rival.feud) * _num(T.feud);
        let h = out.fear * _num(T.fearShare) + out.envy * _num(T.envyShare) + out.grudge;
        if (realm && Array.isArray(kingdom.allies) && kingdom.allies.includes(realm.id)) h *= _num(T.allied, 0.5);
        // Kin by marriage or betrothal (systems/heirs.js, systems/heirAgency.js) are slow to turn on the House
        const kinship = Heirs.kinshipFactor(player, kingdom.id);
        if (kinship.kin) { h *= kinship.factor; out.kin = kinship.kin; }
        h *= Coalitions.difficulty(player);
        out.hostility = Math.round(_clamp(h, 0, 100));
        out.fear = Math.round(out.fear);
        out.envy = Math.round(out.envy);
        out.grudge = Math.round(out.grudge);
        if (out.fear >= 25) out.reasons.push('fears your might at its borders');
        if (out.envy >= 25) out.reasons.push(ambition > 0.3 ? 'its ambitious lord envies your rise' : 'envies your rise');
        if (vend.weight >= 5) out.reasons.push(vend.generations ? `a blood feud sworn ${vend.generations > 1 ? `${vend.generations} generations` : 'a generation'} ago: ${vend.causes[0].label}` : `a blood feud: ${vend.causes[0].label}`);
        else if (mem <= -10) out.reasons.push('its lord remembers your wrongs');
        if (rival && _num(rival.feud) >= 30) out.reasons.push(`${rival.name} feuds with your House`);
        if (rep <= -30) out.reasons.push('your name is hated there');
        if (out.kin) out.reasons.push(out.kin === 'married' ? 'bound to your House by marriage (slow to turn on you)' : 'promised to your House by a betrothal (slow to turn on you)');
        return out;
    },

    /** Every realm's regard, most hostile first. */
    assessAll(player, world, opts = {}) {
        if (!player || !world || !Array.isArray(world.kingdoms)) return [];
        const power = opts.power || Coalitions.power(player, world, opts);
        const points = Coalitions._points(player, world, power.realm);
        return world.kingdoms.filter(k => k && k.isAlive)
            .map(k => Coalitions.assess(player, world, k, power, points, power.realm))
            .filter(a => a.kingdomId !== player.allegiance && !(power.realm && a.kingdomId === power.realm.id))
            .sort((a, b) => b.hostility - a.hostility);
    },

    /** Power past which a league can form (formAt over the difficulty). */
    formThreshold(player) {
        return Math.round(_num(Coalitions.config().formAt, 140) / Coalitions.difficulty(player));
    },

    concernThreshold(player) {
        return Math.round(_num(Coalitions.config().concern, 70) / Coalitions.difficulty(player));
    },

    // ──────────── THE WEEK ────────────

    /**
     * The daily hook (weekly work on cadence). opts: { armyStrength }.
     * Returns { notices: [{ icon, title, text, type }], formed, activated, ended }.
     */
    processDay(world, player, opts = {}) {
        const out = { notices: [], formed: null, activated: null, ended: null };
        const C = Coalitions.config();
        if (!world || !player || C.enabled === false || !Array.isArray(world.kingdoms)) return out;
        if (player.interregnum) return out;
        const st = Coalitions.state(player);
        const day = _day(world);
        const c = st.active;
        // Days the House did not tick (an interregnum: the world turned on without
        // it) do not run down a forming league's ultimatum — an heir who takes up
        // the mantle gets the days the letter promised, not a war on their first morning
        if (c && c.stage === 'forming' && Number.isFinite(st.seenDay) && day - st.seenDay > 1) c.dueDay = _num(c.dueDay) + (day - st.seenDay - 1);
        st.seenDay = day;
        // A league in its forming days acts on its own deadline, not the week's
        if (c && c.stage === 'forming' && day >= _num(c.dueDay)) Coalitions._activate(player, world, out, 'its terms went unanswered');
        const cad = Math.max(1, _num(C.cadence, 7));
        if (day <= 0 || (day + _num(C.offset)) % cad !== 0) return out;
        Coalitions._week(world, player, opts, out);
        return out;
    },

    _week(world, player, opts, out) {
        const C = Coalitions.config();
        const st = Coalitions.state(player);
        const day = _day(world);
        const power = Coalitions.power(player, world, opts);
        const assessed = Coalitions.assessAll(player, world, { ...opts, power });
        st.power = { day, score: power.score, parts: power.parts, realm: power.realm ? power.realm.id : null };
        st.realms = {};
        for (const a of assessed) st.realms[a.kingdomId] = { ...a, day };

        // A new head of the House: the league carries on, weaker
        const gen = _num(player.house && player.house.generation, 1);
        if (st.generation == null) st.generation = gen;
        if (gen !== st.generation) {
            st.generation = gen;
            Coalitions._onSuccession(player, world, assessed, out);
        }

        Coalitions._vendettas(player, world, assessed, out);

        // Past the watch mark, the rival Houses of realms that already mislike you grow alarmed
        if (power.score >= Coalitions.concernThreshold(player) && player.house && player.house.rivals) {
            for (const a of assessed) {
                if (a.hostility >= _num(C.joinAt) / 2 && player.house.rivals[a.kingdomId]) {
                    House.accrueRivalFeud(player, world, a.kingdomId, _num(C.alarmFeud, 2), 'alarm at your rise');
                }
            }
        }

        const form = Coalitions.formThreshold(player);
        if (st.active) {
            Coalitions._tickActive(player, world, power, assessed, out);
            return;
        }
        // The pressure clock: the courts tire of a rising House even short of formAt
        const PC = Pressure.clockConfig('coalition');
        const might = Pressure.mightOf(power.score);
        const clk = Pressure.wind(st, 'coalition', might, day, { days: _num(C.cadence, 7), seed: _seed(world), paused: day < st.cooldownUntil, generation: gen });
        if (st.primed && day - _num(st.primed.day) > _num(PC.primedDays, 28)) st.primed = null; // the talk came to nothing
        if (clk.ripe && !st.primed && day >= st.cooldownUntil) {
            st.primed = { day, might, score: power.score };
            Pressure.spend(st, day);
        }
        const primed = !!st.primed;
        if (power.score >= form || primed) st.pressure++;
        else st.pressure = Math.max(0, st.pressure - 1);
        if (day < st.cooldownUntil) return;
        const joinAt = primed && power.score < form ? _num(C.joinAt) * _num(PC.joinShare, 0.6) : _num(C.joinAt);
        const hostile = assessed.filter(a => a.hostility >= joinAt);
        if (st.pressure === 1 && hostile.length >= _num(C.minMembers, 2)) {
            out.notices.push({ icon: '🕊️', title: 'Envoys on the Roads', text: `Envoys ride between ${hostile.slice(0, 3).map(a => a.name).join(', ')}. Talk in the courts is of a league against ${player.house ? player.house.name : 'you'}. (See Dynasty → Threats.)`, type: 'warning' });
        }
        if (st.pressure >= _num(C.brewWeeks, 2) && hostile.length >= _num(C.minMembers, 2)) {
            Coalitions._form(player, world, power, hostile, out);
        }
    },

    /** Realms whose lords owe the player blood are sworn as rival Houses, their feud kept hot. */
    _vendettas(player, world, assessed, out) {
        const house = player.house;
        if (!house) return;
        const V = Coalitions.config().vendetta;
        if (!_obj(house.rivals)) house.rivals = {};
        for (const a of assessed) {
            if (a.vendetta < _num(V.rivalAt, 15)) continue;
            const floor = Math.min(100, Math.round(a.vendetta * _num(V.feudPerWeight, 1.5)));
            const rival = house.rivals[a.kingdomId];
            if (rival) {
                if (_num(rival.feud) < floor) House.accrueRivalFeud(player, world, a.kingdomId, floor - _num(rival.feud), 'a blood feud');
                rival.vendetta = true;
                continue;
            }
            if (Object.keys(house.rivals).length >= _num(V.maxRivals, 5)) continue;
            const k = world.getKingdom ? world.getKingdom(a.kingdomId) : null;
            if (!k) continue;
            const dyn = k.characterData && k.characterData.dynasty;
            const name = dyn && dyn.name ? `House ${dyn.name}` : k.name;
            house.rivals[k.id] = { kingdomId: k.id, name, feud: floor, lastActedDay: _day(world), vendetta: true };
            const lord = k.lord ? k.lord.name : 'its lord';
            House._chronicle(house, world, `${name} of ${k.name} swears a blood feud against ${house.name}${a.generations ? `, as ${lord}'s fathers swore before him` : ''}.`, ['rival', 'feud', 'vendetta']);
            out.notices.push({ icon: '🔴', title: 'A Blood Feud', text: `${lord} of ${k.name} will not forget ${NPCLords.vendettaOf(k.lord, _day(world)).causes[0]?.label || 'what you did'}. ${name} is now a rival of your House.`, type: 'warning' });
        }
    },

    _place(world, kingdom) {
        const seat = Coalitions._seat(world, kingdom);
        const tile = seat && world.getTile ? world.getTile(seat.q, seat.r) : null;
        return (tile && tile.settlement && tile.settlement.name) || kingdom.name;
    },

    /** Swear a league. */
    _form(player, world, power, hostile, out) {
        const C = Coalitions.config();
        const st = Coalitions.state(player);
        const day = _day(world);
        const might = (k) => _num(k.military) + _num(k.population) * 0.1;
        const pool = hostile.slice(0, Math.max(_num(C.minMembers, 2), _num(C.maxMembers, 4)))
            .map(a => ({ a, k: world.getKingdom(a.kingdomId) })).filter(x => x.k && x.k.isAlive);
        if (pool.length < _num(C.minMembers, 2)) return null;
        const leader = pool.slice().sort((x, y) => (y.a.hostility * might(y.k)) - (x.a.hostility * might(x.k)))[0];
        const names = Array.isArray(C.names) && C.names.length ? C.names : DEFAULTS.names;
        const id = st.nextId++;
        const name = _fill(names[Math.floor(_roll(`coalition:${_seed(world)}:${id}:${leader.k.id}`) * names.length) % names.length], { place: Coalitions._place(world, leader.k) });
        // The casus belli: the strongest grievance among them
        const houseName = player.house ? player.house.name : player.name || 'you';
        const feud = pool.slice().sort((x, y) => y.a.vendetta - x.a.vendetta)[0];
        let cb = 'power';
        let cause = '';
        if (feud.a.vendetta >= 15) {
            cb = 'vendetta';
            const v = NPCLords.vendettaOf(feud.k.lord, day);
            cause = v.causes[0] ? `${v.causes[0].label}${v.causes[0].note ? ` (${v.causes[0].note})` : ''}` : 'old wrongs';
        } else if (power.parts.conquests >= _num(C.power.conquest, 12)) cb = 'conquest';
        else if (power.realm) cb = 'crown';
        const casusBelli = _fill((C.casusBelli || {})[cb] || DEFAULTS.casusBelli[cb], { house: houseName, realm: power.realm ? power.realm.name : '', cause });
        const members = {};
        for (const { a, k } of pool) {
            members[k.id] = {
                kingdomId: k.id, name: k.name, joined: day, hostility: a.hostility,
                leader: k === leader.k, chill: k === leader.k ? _num(C.chill.leader) : _num(C.chill.member),
                war: null, left: false, why: null,
            };
        }
        const R = C.resolve;
        const c = {
            id, name, leaderId: leader.k.id, leaderName: leader.k.name, cb, casusBelli,
            stage: 'forming', formed: day, dueDay: day + _num(C.ultimatumDays, 14),
            target: houseName, generation: _num(player.house && player.house.generation, 1),
            powerAtForm: power.score, lastPower: power.score,
            // Each member's will to fight (threat.personality.*.war): warlike lords stiffen the league
            resolve: Math.min(_num(R.max, 100), _r1(_num(R.start) + pool.reduce((sum, { k }) => sum + _num(R.perMember) * Coalitions.warWill(k), 0))),
            members, bought: [], log: [], tally: {},
            terms: Coalitions.concessionQuote(player, world, { power: power.score, members: pool.length }),
        };
        if (st.primed) c.via = 'pressure';
        st.active = c;
        st.pressure = 0;
        st.primed = null;
        st.stats.formed++;
        Coalitions._log(c, day, `${name} is sworn at the court of ${leader.k.name}: ${pool.map(x => x.k.name).join(', ')}. ${casusBelli}`);
        if (player.house) House._chronicle(player.house, world, `${name} is sworn against ${houseName} — ${pool.map(x => x.k.name).join(', ')}, led by ${leader.k.name}. ${casusBelli}`, ['coalition', 'war']);
        if (Array.isArray(world.events)) world.events.push({ text: `⚜️ ${name} is sworn against ${houseName}: ${pool.map(x => x.k.name).join(', ')}.`, type: 'diplomatic', category: 'POLITICAL' });
        // Rival Houses among them: the feud flares
        for (const { k } of pool) if (player.house && player.house.rivals && player.house.rivals[k.id]) House.accrueRivalFeud(player, world, k.id, 10, `sworn into ${name}`);
        Coalitions._sendTerms(player, world, c, leader.k);
        out.formed = c;
        out.notices.push({ icon: '⚜️', title: `${name} Is Sworn`, text: `${pool.map(x => x.k.name).join(', ')} have sworn a league against you, led by ${leader.k.name}. ${casusBelli} Their terms: ${c.terms.gold} gold (or ${c.terms.prestige} Prestige) within ${_num(C.ultimatumDays, 14)} days — or war. Answer in Letters, or see Dynasty → Threats.`, type: 'error' });
        return c;
    },

    _log(c, day, text) {
        if (!Array.isArray(c.log)) c.log = [];
        c.log.push({ day, text });
        if (c.log.length > 30) c.log.splice(0, c.log.length - 30);
    },

    /** The league's terms come as a court letter from its leader. */
    _sendTerms(player, world, c, leader) {
        if (!CourtLetters || typeof CourtLetters.compose !== 'function' || !CourtLetters.kind('coalition_ultimatum')) return null;
        const letter = CourtLetters.compose(world, player, 'coalition_ultimatum', {
            key: `coalition:${c.id}`,
            from: { type: 'lord', kingdomId: leader.id, name: leader.lord && leader.lord.name ? `${leader.lord.name} of ${leader.name}` : leader.name },
            kingdom: leader,
            coalitionId: c.id, league: c.name, amount: c.terms.gold, prestige: c.terms.prestige,
            members: Coalitions.members(player).map(m => m.name).join(', '), cause: c.casusBelli,
            days: Math.max(1, _num(c.dueDay) - _day(world)),
        });
        letter.expires = _num(c.dueDay);
        CourtLetters.deliver(player, letter);
        c.letterId = letter.id;
        return letter;
    },

    /** What the league asks to stand down: { gold, prestige }. */
    concessionQuote(player, world, o = {}) {
        const K = Coalitions.config().concession;
        const c = Coalitions.active(player);
        const power = o.power != null ? o.power : _num(c && c.lastPower);
        const members = o.members != null ? o.members : Coalitions.members(player).length;
        return {
            gold: Math.round(_num(K.goldBase) + power * _num(K.goldPerPower) + members * _num(K.goldPerMember)),
            prestige: Math.round(_num(K.prestigeBase) + members * _num(K.prestigePerMember)),
        };
    },

    /** The league goes to war: every member declares, the levies and embargoes fall. */
    _activate(player, world, out, why, opts = {}) {
        const st = Coalitions.state(player);
        const c = st.active;
        if (!c || c.stage === 'active') return;
        const day = _day(world);
        c.stage = 'active';
        c.activeDay = day;
        if (!opts.keepLetter) Coalitions._closeLetter(player, c);
        const declared = [];
        for (const m of Coalitions.members(player)) {
            const k = world.getKingdom(m.kingdomId);
            if (!k || !k.isAlive) continue;
            if (Coalitions._declare(player, world, c, m, k)) declared.push(k.name);
        }
        Coalitions._log(c, day, `${c.name} marches (${why}).${declared.length ? ` War from ${declared.join(', ')}.` : ''}`);
        if (player.house) House._chronicle(player.house, world, `${c.name} goes to war against ${player.house.name} (${why}).`, ['coalition', 'war']);
        out.activated = c;
        out.notices.push({ icon: '⚔️', title: `${c.name} Marches`, text: `${declared.length ? `${declared.join(', ')} declare war on you. ` : ''}Their towns levy your goods and cancel your licences; their lords will not receive you. Break the league from Dynasty → Threats.`, type: 'error' });
    },

    _closeLetter(player, c) {
        const L = player.letters;
        if (!L || !Array.isArray(L.inbox) || c.letterId == null) return;
        const letter = L.inbox.find(l => l.id === c.letterId);
        if (letter) CourtLetters._archive(player, letter, 'superseded', `${c.name} no longer waits for an answer.`);
    },

    /** One member goes to war (and the trade levy falls). Returns true when a war was declared. */
    _declare(player, world, c, m, k) {
        const C = Coalitions.config();
        const day = _day(world);
        let declared = false;
        const realm = KingdomAI.playerRealm(world);
        // The player's own holdings (properties, colonies, towns in their name): war hosts
        const truce = player.realmWars && player.realmWars.truces ? _num(player.realmWars.truces[k.id]) : 0;
        if (RealmWars.holdings(player, world).length && truce <= day && !RealmWars.atWarWith(player, k.id)) {
            RealmWars.declareWar(player, world, k, `sworn into ${c.name}`);
            m.war = 'holdings';
            declared = true;
        } else if (RealmWars.atWarWith(player, k.id)) {
            m.war = 'holdings';
            m.priorWar = true; // its own war, older than the league: the league's end does not end it
        }
        // A crown the player rules: a war between the realms and an embargo
        if (realm && realm !== k) {
            if (!(k.wars || []).includes(realm.id) && !KingdomAI.hasTruce(k, realm, world) && (k.wars || []).length < 3) {
                Utils.withRng(Utils.seededRandom((Utils.hashStr(`coalition-war:${_seed(world)}:${k.id}:${day}`) >>> 0) % 233279 + 1),
                    () => KingdomAI.startWar(k, realm, world));
                if (Array.isArray(world.events)) world.events.push({ text: `⚔️ ${k.name} marches on ${realm.name} for ${c.name}!`, type: 'military', kingdom: realm.id });
                m.realmWar = realm.id;
                declared = true;
            } else if ((k.wars || []).includes(realm.id)) { m.realmWar = realm.id; m.priorRealmWar = true; }
            TradePolicy._embargo(world, k, realm, 'coalition');
            m.embargo = realm.id;
        }
        TradePolicy.barPlayer(player, world, k.id, { levy: _num(C.embargoLevy, 0.25), why: c.name });
        m.levied = true;
        m.warDay = day;
        if (declared && player.house && player.house.rivals && player.house.rivals[k.id]) House.accrueRivalFeud(player, world, k.id, 5, `war for ${c.name}`);
        return declared;
    },

    /** A member leaves the league: its levy is lifted; its embargo is left to the crowns' own weekly turn. */
    _leave(player, world, c, m, why, opts = {}) {
        if (!m || m.left) return;
        const day = _day(world);
        m.left = true;
        m.why = why;
        m.leftDay = day;
        m.chill = 0;
        TradePolicy.unbarPlayer(player, m.kingdomId);
        const k = world.getKingdom ? world.getKingdom(m.kingdomId) : null;
        const realm = KingdomAI.playerRealm(world);
        if (k && realm && m.embargo === realm.id) {
            const p = k.tradePolicy;
            const e = p && p.embargo ? p.embargo[realm.id] : null;
            if (e && e.why === 'coalition') TradePolicy._lift(world, k, realm);
        }
        if (opts.endWars && k) {
            // (a disbanding league ends only the wars it started: opts.leagueWarsOnly)
            if (RealmWars.atWarWith(player, k.id) && !(opts.leagueWarsOnly && m.priorWar)) RealmWars.endWar(player, world, k.id, opts.how || 'exhaustion');
            if (realm && (k.wars || []).includes(realm.id) && !(opts.leagueWarsOnly && m.priorRealmWar)) KingdomAI.endWar(k, realm, world, { text: `🕊️ ${k.name} makes peace with ${realm.name} and leaves ${c.name}.` });
        }
        Coalitions._log(c, day, `${m.name} leaves ${c.name}: ${why}.`);
    },

    _tickActive(player, world, power, assessed, out) {
        const C = Coalitions.config();
        const R = C.resolve;
        const st = Coalitions.state(player);
        const c = st.active;
        const day = _day(world);
        const realm = power.realm;
        const byId = {};
        for (const a of assessed) byId[a.kingdomId] = a;
        c.lastPower = power.score;

        for (const m of Coalitions.members(player)) {
            const k = world.getKingdom(m.kingdomId);
            if (!k || !k.isAlive) {
                Coalitions._leave(player, world, c, m, 'its crown has fallen');
                c.resolve += _num(R.memberLost);
                continue;
            }
            m.hostility = byId[k.id] ? byId[k.id].hostility : m.hostility;
            if (c.stage !== 'active') continue;
            // Wars that have ended take the member out of the league
            const tally = c.tally[k.id] || (c.tally[k.id] = { hosts: 0, lost: 0 });
            const war = player.realmWars && player.realmWars.wars ? player.realmWars.wars[k.id] : null;
            if (war) {
                const hosts = _num(war.hostsDefeated) - tally.hosts;
                const lost = _num(war.holdingsLost) - tally.lost;
                if (hosts > 0) c.resolve += hosts * _num(R.hostBroken);
                if (lost > 0) c.resolve += lost * _num(R.holdingTaken);
                tally.hosts = _num(war.hostsDefeated);
                tally.lost = _num(war.holdingsLost);
            }
            const holdingsWarOver = m.war === 'holdings' && !war;
            const realmWarOver = m.realmWar && (!realm || !(k.wars || []).includes(m.realmWar));
            if ((holdingsWarOver && (!m.realmWar || realmWarOver)) || (realmWarOver && !m.war)) {
                const humbled = NPCLords.memoryOf(k.lord, day).some(e => e.key === 'humbled' && !e.inherited && e.day >= _num(m.warDay));
                Coalitions._leave(player, world, c, m, humbled ? 'humbled in the field' : 'its war with you is over');
                c.resolve += humbled ? _num(R.memberHumbled) : _num(R.memberLost);
                if (humbled && player.house) House.recordPlayerDeed(player, world, 'battleWon', { reason: `broke ${k.name} out of ${c.name}` });
                continue;
            }
            // Members keep their quarrel hot: relations with the crown stay sour, the levy stands
            if (realm && k.relations) k.relations[realm.id] = Math.min(_num(k.relations[realm.id]), _num(C.relationsFloor, -40));
            if (m.levied) TradePolicy.barPlayer(player, world, k.id, { levy: _num(C.embargoLevy, 0.25), why: c.name });
        }

        // The league's resolve: it tires week by week; the player's growth hardens it
        if (c.stage === 'active') c.resolve += _num(R.weekly);
        const grew = power.score - _num(c.powerSeen, c.powerAtForm);
        if (grew > 0) c.resolve += grew * _num(R.powerGrowth);
        c.powerSeen = Math.max(_num(c.powerSeen, c.powerAtForm), power.score);
        c.resolve = _r1(_clamp(c.resolve, -100, _num(R.max, 100)));

        // New members: realms grown hostile enough join an active league (one a week)
        if (c.stage === 'active' && Coalitions.members(player).length < _num(C.maxMembers, 4) + 1) {
            const joiner = assessed.find(a => a.hostility >= _num(C.joinAt) + _num(C.rejoinMargin)
                && !(c.members[a.kingdomId] && !c.members[a.kingdomId].left)
                && !(c.bought || []).includes(a.kingdomId));
            const k = joiner && world.getKingdom(joiner.kingdomId);
            if (k && k.isAlive) {
                const m = c.members[k.id] = {
                    kingdomId: k.id, name: k.name, joined: day, hostility: joiner.hostility,
                    leader: false, chill: _num(C.chill.member), war: null, left: false, why: null,
                };
                c.resolve = _r1(Math.min(_num(R.max, 100), c.resolve + _num(R.perMember) / 2));
                const declared = Coalitions._declare(player, world, c, m, k);
                Coalitions._log(c, day, `${k.name} joins ${c.name}.`);
                out.notices.push({ icon: '⚜️', title: `${k.name} Joins ${c.name}`, text: `${k.name} has sworn itself to the league against you${declared ? ' and declares war' : ''}.`, type: 'error' });
            }
        }

        // Endings
        const left = Coalitions.members(player);
        const form = Coalitions.formThreshold(player);
        if (power.score < form * _num(C.dissolvePowerShare, 0.6)) {
            Coalitions._end(player, world, 'humbled', `${player.house ? player.house.name : 'You'} no longer tower over them`, out);
        } else if (left.length < _num(C.minMembers, 2)) {
            Coalitions._end(player, world, 'broken', left.length ? `only ${left[0].name} is left in it` : 'its members are gone', out);
        } else if (c.resolve <= 0) {
            Coalitions._end(player, world, 'broken', 'its members have lost heart', out, { endWars: true });
        }
    },

    /**
     * The league disbands. how: 'appeased' | 'humbled' | 'broken'. The wars
     * it started end with it (in exhaustion, unless opts.how says otherwise):
     * with no league and no resolve left, nothing else would end them. A
     * member's own war, older than the league, runs on. opts.endWars: false
     * keeps every war.
     */
    _end(player, world, how, why, out, opts = {}) {
        const C = Coalitions.config();
        const st = Coalitions.state(player);
        const c = st.active;
        if (!c) return null;
        const day = _day(world);
        for (const m of Coalitions.members(player)) {
            Coalitions._leave(player, world, c, m, how === 'appeased' ? 'the terms were met' : 'the league disbands',
                { endWars: opts.endWars !== false, leagueWarsOnly: true, how: opts.how || 'exhaustion' });
        }
        c.stage = 'ended';
        c.ended = day;
        c.how = how;
        if (!opts.keepLetter) Coalitions._closeLetter(player, c);
        st.history.unshift({
            id: c.id, name: c.name, leaderName: c.leaderName, casusBelli: c.casusBelli, cb: c.cb || null,
            members: Object.values(c.members).map(m => m.name), formed: c.formed, ended: day, how, why,
            activeDay: Number.isFinite(c.activeDay) ? c.activeDay : null,
            // who left before the end, and why (bought out, wed, humbled, fallen...)
            left: Object.values(c.members).filter(m => m.left && m.why && m.why !== 'the league disbands' && m.why !== 'the terms were met')
                .map(m => ({ name: m.name, why: m.why, day: Number.isFinite(m.leftDay) ? m.leftDay : null })),
            via: c.via || null,
            generation: c.generation,
        });
        if (st.history.length > 12) st.history.length = 12;
        st.active = null;
        st.pressure = 0;
        st.cooldownUntil = day + _num((C.cooldown || {})[how], 240);
        st.stats[how] = _num(st.stats[how]) + 1;
        const text = { appeased: `${c.name} stands down: its terms were met.`, humbled: `${c.name} disbands: ${why}.`, broken: `${c.name} breaks apart: ${why}.` }[how] || `${c.name} is no more.`;
        if (player.house) House._chronicle(player.house, world, text, ['coalition', how]);
        if (how === 'broken' && player.house) House.recordPlayerDeed(player, world, 'battleWon', { scale: 2, reason: `outlasted ${c.name}` });
        if (out) {
            out.ended = { coalition: c, how };
            out.notices.push({ icon: how === 'broken' ? '🏆' : '🕊️', title: `${c.name} ${how === 'broken' ? 'Breaks Apart' : 'Disbands'}`, text, type: how === 'broken' ? 'success' : 'info' });
        }
        return c;
    },

    /** A succession: the league carries on against the heir, at reduced strength. */
    _onSuccession(player, world, assessed, out) {
        const C = Coalitions.config();
        const st = Coalitions.state(player);
        const c = st.active;
        st.pressure = 0;
        if (!c) return;
        c.resolve = _r1(c.resolve * _num(C.heirShare, 0.6));
        c.target = player.house ? player.house.name : player.name;
        const byId = {};
        for (const a of assessed) byId[a.kingdomId] = a;
        const dropped = [];
        for (const m of Coalitions.members(player)) {
            const a = byId[m.kingdomId];
            if (!m.leader && (!a || a.hostility < _num(C.joinAt))) {
                Coalitions._leave(player, world, c, m, 'its quarrel died with your predecessor', { endWars: true, how: 'exhaustion' });
                dropped.push(m.name);
            }
        }
        Coalitions._log(c, _day(world), `The league turns on the heir, ${player.name}.`);
        out.notices.push({ icon: '⚜️', title: `${c.name} Endures`, text: `${c.name} carries its quarrel to ${player.name}, though with less heart${dropped.length ? ` — ${dropped.join(', ')} ${dropped.length > 1 ? 'have' : 'has'} left it` : ''}.`, type: 'warning' });
        if (Coalitions.members(player).length < _num(C.minMembers, 2)) Coalitions._end(player, world, 'broken', 'the old quarrel died with your predecessor', out, { endWars: true });
    },

    // ──────────── THE PLAYER'S ANSWERS ────────────

    /** Concede the league's terms ('gold' or 'prestige'): it stands down. */
    concede(player, world, currency = 'gold', opts = {}) {
        const C = Coalitions.config();
        const c = Coalitions.active(player);
        if (!c) return { success: false, reason: 'No league stands against you.' };
        // While the league is forming its letter's terms stand (the price the
        // letter and its button name); once it marches the price follows its power
        const q = c.stage === 'forming' && _obj(c.terms) ? { gold: _num(c.terms.gold), prestige: _num(c.terms.prestige) } : Coalitions.concessionQuote(player, world);
        const day = _day(world);
        if (currency === 'prestige') {
            if (!player.house || !House.spend(player.house, q.prestige, `bowed to ${c.name}`, day)) return { success: false, reason: `You need ${q.prestige} Prestige.` };
        } else {
            if (_num(player.gold) < q.gold) return { success: false, reason: `You need ${q.gold} gold.` };
            player.gold = _num(player.gold) - q.gold;
            Ledger.record(player, 'coalitionTerms', -q.gold);
            // Paying off a league is a humiliation all the same
            if (player.house) House.spend(player.house, Math.min(_num(player.house.prestige), _num(C.concession.goldShame, 10)), `paid off ${c.name}`, day);
            const share = Math.floor(q.gold / Math.max(1, Coalitions.members(player).length));
            for (const m of Coalitions.members(player)) {
                const k = world.getKingdom(m.kingdomId);
                if (k) k.treasury = _num(k.treasury) + share;
            }
        }
        for (const m of Coalitions.members(player)) NPCLords.rememberRealm(world, m.kingdomId, 'tribute_paid', { note: c.name });
        Coalitions._end(player, world, 'appeased', 'its terms were met', null, { endWars: true, how: 'bought', keepLetter: !!opts.fromLetter });
        return { success: true, text: currency === 'prestige'
            ? `You bow before ${c.name} (−${q.prestige} Prestige). Its members stand down.`
            : `You pay ${c.name} ${q.gold} gold. Its members stand down, and the courts talk of how you bent.` };
    },

    /** Throw the terms back: the league marches at once. */
    defy(player, world, opts = {}) {
        const c = Coalitions.active(player);
        if (!c || c.stage !== 'forming') return { success: false, reason: 'There are no terms to defy.' };
        const st = Coalitions.state(player);
        st.stats.defied++;
        for (const m of Coalitions.members(player)) NPCLords.rememberRealm(world, m.kingdomId, 'coalition_defied', { note: c.name });
        const out = { notices: [] };
        Coalitions._activate(player, world, out, 'its terms were thrown back', { keepLetter: !!opts.fromLetter });
        return { success: true, text: `You throw ${c.name}'s terms back at its envoys. Its members march.`, notices: out.notices };
    },

    /** Gold to buy a member out of the league. */
    buyOffPrice(player, world, kingdomId) {
        const B = Coalitions.config().buyoff;
        const k = world.getKingdom ? world.getKingdom(kingdomId) : null;
        const m = Coalitions.active(player) && Coalitions.active(player).members[kingdomId];
        if (!k || !m) return 0;
        const mult = Technology && typeof Technology.getAllianceCostMultiplier === 'function' ? _num(Technology.getAllianceCostMultiplier(player), 1) : 1;
        return Math.round((_num(B.goldBase) + _num(k.military) * _num(B.perMilitary) + _num(m.hostility) * _num(B.perThreat)) * (m.leader ? 1.5 : 1) * mult);
    },

    /** Grown, unwed children who could seal a member's leaving with a marriage. */
    marriageable(player) {
        return CourtLetters._unwedChildren(player);
    },

    /** Holdings the player could cede to a member: colonies and towns held in their own name. */
    cedable(player, world) {
        return RealmWars.holdings(player, world).filter(h => h.kind === 'colony');
    },

    /**
     * Split a member off the league: how = 'gold' | 'marriage' (arg: childId)
     * | 'cede' (arg: "q,r" of a holding). Its war with the player ends; the
     * league is weaker for it. Returns { success, text } or { success:false, reason }.
     */
    splitMember(player, world, kingdomId, how, arg = null) {
        const C = Coalitions.config();
        const c = Coalitions.active(player);
        const m = c && c.members ? c.members[kingdomId] : null;
        if (!c || !m || m.left) return { success: false, reason: 'That realm is not in the league.' };
        const k = world.getKingdom(kingdomId);
        if (!k || !k.isAlive) return { success: false, reason: 'No such realm.' };
        const day = _day(world);
        let text;
        if (how === 'gold') {
            const cost = Coalitions.buyOffPrice(player, world, kingdomId);
            if (_num(player.gold) < cost) return { success: false, reason: `${k.name} wants ${cost} gold.` };
            player.gold = _num(player.gold) - cost;
            Ledger.record(player, 'coalitionTerms', -cost);
            k.treasury = _num(k.treasury) + cost;
            NPCLords.rememberDeed(world, k.lord, 'coalition_bought', { note: c.name });
            Coalitions.state(player).stats.boughtOff++;
            text = `${cost} gold buys ${k.name} out of ${c.name}.`;
        } else if (how === 'marriage') {
            const res = Heirs.marryForAlliance(player, world, arg, kingdomId, { minReputation: -1000, dowry: _num(C.buyoff.marriageDowry) });
            if (!res.success) return res;
            Coalitions.state(player).stats.married++;
            text = `${res.child.firstName} weds ${res.spouse.name}; ${k.name} leaves ${c.name} for the sake of the match.`;
        } else if (how === 'cede') {
            const [q, r] = String(arg || '').split(',').map(Number);
            const t = Coalitions.cedable(player, world).find(h => h.q === q && h.r === r);
            if (!t) return { success: false, reason: 'That holding is not yours to cede.' };
            RealmWars._captureHolding(player, world, k, null, t);
            NPCLords.rememberDeed(world, k.lord, 'holding_ceded', { note: t.name });
            if (!player.reputation) player.reputation = {};
            // (the buy-off's reputation is added for every split below: ceding earns cede.reputation in all)
            player.reputation[k.id] = _num(player.reputation[k.id]) + _num(C.cede.reputation) - _num(C.buyoff.reputation);
            c.resolve += _num(C.cede.resolve) - _num(C.buyoff.resolve); // ceding land costs the league more than gold
            Coalitions.state(player).stats.ceded++;
            if (player.house) House._chronicle(player.house, world, `${player.house.name} cedes ${t.name} to ${k.name} to break ${c.name}.`, ['coalition', 'holdings']);
            text = `You cede ${t.name} to ${k.name}, and it leaves ${c.name}.`;
        } else {
            return { success: false, reason: 'Unknown offer.' };
        }
        if (!player.reputation) player.reputation = {};
        player.reputation[k.id] = _num(player.reputation[k.id]) + _num(C.buyoff.reputation);
        c.bought = Array.isArray(c.bought) ? c.bought : [];
        if (!c.bought.includes(k.id)) c.bought.push(k.id);
        c.resolve = _r1(c.resolve + _num(C.buyoff.resolve));
        Coalitions._leave(player, world, c, m, how === 'gold' ? 'bought out' : how === 'marriage' ? 'bound by a marriage' : 'given a town', { endWars: true, how: 'bought' });
        if (player.realmWars && player.realmWars.truces) player.realmWars.truces[k.id] = Math.max(_num(player.realmWars.truces[k.id]), day + RealmWars.CONFIG.truceDays);
        const out = { notices: [] };
        // The leader gone, the league falls to the next most hostile
        if (m.leader) {
            const next = Coalitions.members(player).sort((a, b) => _num(b.hostility) - _num(a.hostility))[0];
            if (next) {
                next.leader = true;
                next.chill = _num(C.chill.leader);
                c.leaderId = next.kingdomId;
                c.leaderName = next.name;
            }
        }
        if (Coalitions.members(player).length < _num(C.minMembers, 2)) {
            Coalitions._end(player, world, 'broken', 'you split its members apart', out);
        } else if (c.resolve <= 0) {
            Coalitions._end(player, world, 'broken', 'its members have lost heart', out, { endWars: true });
        }
        return { success: true, text, notices: out.notices };
    },

    /** Would this realm's lord refuse to receive the player? Returns the reason, or null. */
    audienceRefused(player, world, kingdomId) {
        const c = Coalitions.active(player);
        const m = c && c.members ? c.members[kingdomId] : null;
        if (!m || m.left) return null;
        if (m.leader) return `${m.name} leads ${c.name} against you; its lord will not receive you.`;
        if (c.stage === 'active') return `${m.name} is sworn to ${c.name} and at war with you; its lord will not receive you.`;
        return null;
    },

    /** Resolve damage from the player's dealings with rival agents (systems/rivalAgents.js). */
    onAgent(player, world, kingdomId, what) {
        const c = Coalitions.active(player);
        if (!c || !Coalitions.isMember(player, kingdomId)) return 0;
        const R = Coalitions.config().resolve;
        const d = what === 'exposed' ? _num(R.exposedAgent) : what === 'turned' ? _num(R.turnedAgent) : what === 'leak' ? Coalitions._leakResolve() : 0;
        c.resolve = _r1(_clamp(c.resolve + d, -100, _num(R.max, 100)));
        return d;
    },

    /** A realm's appetite for war by its lord's personality (data: config.threat.personality.*.war; 1 = average). */
    warWill(kingdom) {
        const T = Coalitions.config().threat || {};
        const pers = _obj((T.personality || {})[KingdomAI.personalityId(kingdom)]) || {};
        return _num(pers.war, 1);
    },

    /** Resolve a league gains from each word an informant sells (data: agents.kinds.informant.leakResolve). */
    _leakResolve() {
        const k = _obj(((Coalitions.data().agents || {}).kinds || {}).informant);
        return k && Number.isFinite(k.leakResolve) ? k.leakResolve : 3;
    },

    // ──────────── THE VIEW ────────────

    /**
     * Everything the Threats panel shows: { power, concern, form, realms[],
     * active, history, pressure, cooldownUntil }.
     */
    view(player, world) {
        const st = Coalitions.state(player);
        const power = st.power || { score: 0, parts: {} };
        const realms = Object.values(st.realms || {}).sort((a, b) => b.hostility - a.hostility);
        return {
            power, realms, active: st.active, history: st.history, pressure: st.pressure,
            cooldownUntil: st.cooldownUntil, stats: st.stats,
            clock: Pressure.progress(st, 'coalition', _seed(world)), primed: st.primed || null,
            concern: Coalitions.concernThreshold(player), form: Coalitions.formThreshold(player),
            joinAt: Coalitions.config().joinAt, quote: st.active ? Coalitions.concessionQuote(player, world) : null,
        };
    },
};
