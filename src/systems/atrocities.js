// ============================================
// ATROCITIES — the dark deeds of war, and the name they leave you
// ============================================
// Four acts a besieger or a conqueror can stoop to, each with consequences
// that outlast the war (data/atrocities.json):
//
//   SALT       sow the fields of a town you besiege, or took in the last
//              windowDays, with salt (real salt: out of your packs, then the
//              taken town's market). world/harvests.js saltFields: its crops
//              yield nothing for years (the harvest in force and every one
//              reckoned while the salt lies: the market's grain, the granary
//              food its people eat, the rents of its holder, farms there),
//              and the soil is spent when it lifts.
//   HOSTAGES   take townsfolk caught outside the walls into your camp under an
//              ultimatum (they leave the town's people). Held, every term is
//              likelier (Sieges.termsChance reads termsShift) and the
//              defenders lose heart daily; when the deadline passes, hang
//              them (morale breaks, men slip off the walls) — or the threat
//              rings hollow. Released, or the siege over, they go home.
//   PLAGUE     fling corpses over the walls: plague dead when a great plague
//              runs near (the town is struck: systems/crises.js), else your
//              own camp's fever dead. The town sickens (the siege's townSick)
//              and its townsfolk are seeded with the illness (systems/illness.js).
//   MASSACRE   put a town that surrendered to you to the sword: most of its
//              people killed, its purse and stores carried off (out of what it
//              holds: Economy.drawTown, SettlementMarket.loot), ruins.
//
// Every act brands you (_brand): karma, cruelty and dread (traits), the court's
// severity, reputation with the realm wronged (and, for the worst, every realm),
// the lords' memories (world/npcLords.js rememberRealm — read by their opinion
// of you and RealmWars.hostility), a deed rumour that spreads town to town
// (systems/gossip.js), the heralds' cry (player.atrocities.history, read by
// systems/heralds.js), the town's own memory (systems/townMemory.js
// 'atrocity' marks: its mood, its annals, its history), the House chronicle
// (the Annals) — and two numbers that fade only slowly:
//   butcher   the name for cruelty: a dreaded name opens purses (ransom and
//             tribute likelier: termsShift)
//   perfidy   the name for breaking a surrender: at refuseAt and above, towns
//             facing you refuse to surrender and fight to the last (Sieges
//             reads refusesSurrender / lastStand: no surrender terms, no
//             opening the gates when morale breaks, a stiffer storm)
//
// State on player.atrocities (saved), salt on settlement.salted (saved with the
// tile). Pure: explicit params, randomness through Utils' seedable stream.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { Economy } from '../world/economy.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Harvests } from '../world/harvests.js';
import { NPCLords } from '../world/npcLords.js';
import { Traits } from './traits.js';
import { House } from './house.js';
import { Gossip } from './gossip.js';
import { TownMemory } from './townMemory.js';
import { Petitions } from './petitions.js';
import { Illness } from './illness.js';
import { Townsfolk } from './townsfolk.js';
import { Crises } from './crises.js';

const KINDS = ['salt', 'hostages', 'plague', 'massacre'];
const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = (world) => _num(world && world.day);
const _fill = (t, vars) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));

const DEFAULTS = {
    infamy: { butcherDecay: 0.012, perfidyDecay: 0.006, refuseAt: 25, lastStand: 0.2, fearPerPoint: 0.0015, fearMax: 0.12, surrenderPenaltyPerPoint: 0.012, max: 300, labels: [] },
    salt: { apCost: 4, windowDays: 120, salt: { village: 4, town: 8, city: 14, capital: 20 }, years: [6, 10], yield: 0, siegeMorale: 10, happiness: -15 },
    hostages: { apCost: 2, share: 0.01, min: 4, max: 40, deadlineDays: 5, graceDays: 2, termsBonus: 0.15, takeMorale: 5, moraleDaily: 1, hollowMorale: 10, hollowCamp: 5, executeMorale: 25, executeFlee: 0.08, takeButcher: 3, takeKarma: -3, releaseKarma: 2 },
    plague: { apCost: 3, rangeHexes: 14, seedCases: [3, 7], morale: 12, campRisk: 0.3, campDays: [4, 8] },
    massacre: { apCost: 4, windowDays: 30, popKeep: 0.45, plunder: [4, 8], lootShare: 0.85, happiness: -40 },
    marks: {}, chronicle: {}, events: {}, lines: {},
};

let _cfg = null;
let _cfgSrc;

export const Atrocities = {
    KINDS,
    DEFAULTS,

    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.atrocities : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            const out = {};
            for (const k of Object.keys(DEFAULTS)) out[k] = { ...DEFAULTS[k], ...(_obj(d[k]) || {}) };
            _cfg = out;
        }
        return _cfg;
    },

    // ── State ───────────────────────────────────────────────────

    _blank() {
        return { v: 1, butcher: 0, perfidy: 0, hostages: null, taken: [], history: [], stats: { salt: 0, hostages: 0, plague: 0, massacre: 0, hostagesTaken: 0, released: 0 } };
    },

    /** player.atrocities, created on demand. */
    state(player) {
        if (!player) return null;
        if (!_obj(player.atrocities)) player.atrocities = Atrocities._blank();
        const st = player.atrocities;
        const b = Atrocities._blank();
        st.butcher = _num(st.butcher);
        st.perfidy = _num(st.perfidy);
        if (!_obj(st.hostages)) st.hostages = null;
        if (!Array.isArray(st.taken)) st.taken = [];
        if (!Array.isArray(st.history)) st.history = [];
        st.stats = { ...b.stats, ...(_obj(st.stats) || {}) };
        return st;
    },

    serialize(player) {
        return player && _obj(player.atrocities) ? JSON.parse(JSON.stringify(player.atrocities)) : null;
    },

    /** Backfill after a load: older saves keep no record. */
    loadState(player) {
        if (player) Atrocities.state(player);
    },

    // ── The name you carry ──────────────────────────────────────

    butcher(player) { return _num(player && player.atrocities && player.atrocities.butcher); },
    perfidy(player) { return _num(player && player.atrocities && player.atrocities.perfidy); },

    /** Towns facing you refuse to surrender: you broke a surrender, and it is still remembered. */
    refusesSurrender(player) {
        return Atrocities.perfidy(player) >= _num(Atrocities.config().infamy.refuseAt, 25);
    },

    /** The storm-defence bonus of a town that fights to the last (0 when it would yield). */
    lastStand(player) {
        return Atrocities.refusesSurrender(player) ? _num(Atrocities.config().infamy.lastStand, 0.2) : 0;
    },

    /** { butcher, perfidy, refuses, label, icon } for panels. */
    infamy(player) {
        const I = Atrocities.config().infamy;
        const b = Atrocities.butcher(player);
        const labels = Array.isArray(I.labels) ? I.labels.slice().sort((x, y) => _num(y.at) - _num(x.at)) : [];
        const l = labels.find(x => b >= _num(x.at)) || { label: '', icon: '' };
        return { butcher: Math.round(b), perfidy: Math.round(Atrocities.perfidy(player)), refuses: Atrocities.refusesSurrender(player), label: l.label, icon: l.icon };
    },

    /**
     * What your deeds add to the chance a besieged town accepts `term`
     * (Sieges.termsChance): hostages held under a live ultimatum make every term
     * likelier; a dreaded name opens purses (ransom, tribute); a broken
     * surrender closes gates (surrender).
     */
    termsShift(player, s, term) {
        const C = Atrocities.config();
        const I = C.infamy;
        let p = 0;
        const h = player && player.atrocities && player.atrocities.hostages;
        if (h && s && h.q === s.q && h.r === s.r && !h.hollow) p += _num(C.hostages.termsBonus);
        if (term === 'ransom' || term === 'tribute') p += Math.min(_num(I.fearMax), Atrocities.butcher(player) * _num(I.fearPerPoint));
        if (term === 'surrender') p -= Atrocities.perfidy(player) * _num(I.surrenderPenaltyPerPoint);
        return p;
    },

    // ── Records the siege keeps for us ──────────────────────────

    /**
     * A town taken (Sieges._take / _sack): 'storm' | 'surrender' | 'sack'.
     * Opens the salting of its fields for windowDays, and — surrendered — the
     * massacre. → true when a dark deed is now open there.
     */
    noteTaken(player, world, s, how) {
        const st = Atrocities.state(player);
        if (!st || !s) return false;
        st.taken = st.taken.filter(t => !(t.q === s.q && t.r === s.r));
        st.taken.push({ q: s.q, r: s.r, name: s.name, day: _day(world), how, kingdomId: s.kingdomId != null ? s.kingdomId : null });
        if (st.taken.length > 12) st.taken.shift();
        return true;
    },

    _takenAt(player, world, q, r, how = null, windowDays = null) {
        const st = player && player.atrocities;
        if (!st || !Array.isArray(st.taken)) return null;
        const day = _day(world);
        return st.taken.find(t => t.q === q && t.r === r && (!how || t.how === how)
            && (windowDays == null || day - _num(t.day) <= windowDays)) || null;
    },

    _siegeAt(player, q, r) {
        const s = player && player.sieges && player.sieges.active;
        return s && (q == null || (s.q === q && s.r === r)) ? s : null;
    },

    _siegeLog(s, world, text) {
        if (!s) return;
        if (!Array.isArray(s.log)) s.log = [];
        s.log.push({ day: _day(world), text });
        if (s.log.length > 10) s.log.shift();
    },

    _ap(player, cost) {
        return _num(player && player.actionPoints) >= cost;
    },

    _army(player) {
        return Array.isArray(player && player.army) && player.army.length > 0;
    },

    _saltNeed(settlement) {
        const S = Atrocities.config().salt;
        return Math.max(1, Math.round(_num((S.salt || {})[settlement.type || 'village'], _num((S.salt || {}).village, 4))));
    },

    /** Salt at hand for a town: { packs, town, total } (the town's market only once it is no longer besieged). */
    _saltAt(player, settlement, besieged) {
        const packs = Math.max(0, Math.floor(_num(player && player.inventory && player.inventory.salt)));
        const town = besieged ? 0 : SettlementMarket.available(settlement, 'salt');
        return { packs, town, total: packs + town };
    },

    // ── What can be done here ──────────────────────────────────

    /**
     * The dark deeds open at a tile (the siege there, or a town recently taken):
     * [{ id, icon, name, desc, ok, why, ap }]. Empty when nothing is in reach.
     */
    options(player, world, tile) {
        const C = Atrocities.config();
        const settlement = tile && tile.settlement;
        if (!player || !settlement) return [];
        const day = _day(world);
        const st = Atrocities.state(player);
        const siege = Atrocities._siegeAt(player, tile.q, tile.r);
        const taken = Atrocities._takenAt(player, world, tile.q, tile.r, null, _num(C.salt.windowDays, 120));
        const out = [];
        const army = Atrocities._army(player);
        const row = (id, icon, name, desc, ap, why) => out.push({ id, icon, name, desc, ap, ok: !why, why: why || '' });
        const apWhy = (cost) => (Atrocities._ap(player, cost) ? '' : `Needs ${cost} AP (you have ${_num(player.actionPoints)}).`);

        if (siege || taken) {
            const S = C.salt;
            const need = Atrocities._saltNeed(settlement);
            const have = Atrocities._saltAt(player, settlement, !!siege);
            const salted = Harvests.saltedYield(settlement, day) != null;
            row('salt', '🧂', `Sow ${settlement.name}'s fields with salt`,
                `Its crops fail for ${S.years[0]}–${S.years[1]} years and the soil is spent after. Uses ${need} salt (${have.packs} in your packs${siege ? '' : `, ${have.town} in the town's market`}).`,
                S.apCost,
                salted ? 'The fields are already salted.' : !army ? 'You need soldiers to do it.' : have.total < need ? `Needs ${need} salt: you have ${have.total} to hand.` : apWhy(S.apCost));
        }
        if (siege) {
            const H = C.hostages;
            const h = st.hostages;
            const here = h && h.q === siege.q && h.r === siege.r;
            if (!here) {
                row('hostages', '⛓️', 'Take hostages',
                    `Seize ${Atrocities._hostageCount(settlement)} townsfolk caught outside the walls. Ultimatum: open the gates within ${H.deadlineDays} days or they hang. Every term likelier while it stands.`,
                    H.apCost, h ? `You already hold the hostages of ${h.name}.` : !army ? 'You need soldiers to do it.' : apWhy(H.apCost));
            } else {
                const left = _num(h.deadline) - day;
                row('execute', '💀', `Hang the ${h.count} hostages`,
                    'Before the walls, where the town can see. Their morale breaks and men slip from the walls; the realm will not forget.',
                    0, left > 0 ? `The ultimatum runs ${left} more day(s).` : '');
                row('release', '🕊️', `Release the ${h.count} hostages`, 'Let them go home. A little mercy, or a threat abandoned.', 0, '');
            }
            const P = C.plague;
            const src = Atrocities._plagueSource(player, world, siege);
            row('plague', '☠️', 'Fling the dead over the walls',
                src ? `Your engines hurl the ${src.label} dead into ${settlement.name}: sickness inside the walls, among its people.${src.kind === 'plague' ? ' Your own camp may catch it back.' : ''}` : 'Corpses of the sick, sent over the walls by engine.',
                P.apCost, siege.plagueFlung ? 'The town already sickens with what you sent.' : !src ? 'You have no sick dead to throw: no plague near, and your camp is not sick.' : apWhy(P.apCost));
        }
        const surr = Atrocities._takenAt(player, world, tile.q, tile.r, 'surrender', _num(C.massacre.windowDays, 30));
        if (surr && !siege) {
            const M = C.massacre;
            row('massacre', '⚔️', `Put ${settlement.name} to the sword`,
                'It opened its gates to you in good faith. Kill most of its people and carry off all it has. Every realm will hear of it, and no town will ever surrender to you again while it is remembered.',
                M.apCost, !army ? 'You need soldiers to do it.' : apWhy(M.apCost));
        }
        return out;
    },

    /** Is anything dark to be done here? (the action list's 'dark_deeds' entry) */
    hasDeedsAt(player, world, tile) {
        return Atrocities.options(player, world, tile).length > 0;
    },

    _hostageCount(settlement) {
        const H = Atrocities.config().hostages;
        const pop = Math.max(0, _num(settlement.population) - 1);
        return Math.max(0, Math.min(pop, Utils.clamp(Math.round(_num(settlement.population) * _num(H.share)), _num(H.min), _num(H.max))));
    },

    /** Where the dead come from: { kind: 'plague'|'flux', label, crisis } or null. */
    _plagueSource(player, world, s) {
        const P = Atrocities.config().plague;
        const c = Crises.active(world);
        if (c && c.kind === 'plague' && c.data && _obj(c.data.towns)) {
            for (const [key, t] of Object.entries(c.data.towns)) {
                if (!t || _num(t.end) < _day(world)) continue;
                const [q, r] = key.split(',').map(Number);
                if (Hex.wrappingDistance(q, r, s.q, s.r, world.width) <= _num(P.rangeHexes, 14)) return { kind: 'plague', label: 'plague', crisis: c };
            }
        }
        if (_num(s.campSick) > 0) return { kind: 'flux', label: 'camp fever', crisis: null };
        return null;
    },

    /** The town the deeds are done to: the one you besiege (your camp may stand a hex off), else where you stand. */
    tileFor(player, world) {
        if (!world || typeof world.getTile !== 'function' || !player) return null;
        const s = Atrocities._siegeAt(player);
        return s ? world.getTile(s.q, s.r) : world.getTile(player.q, player.r);
    },

    /** Run an option by id → { success, message?, reason? }. */
    act(player, world, id) {
        const tile = Atrocities.tileFor(player, world);
        switch (id) {
        case 'salt': return Atrocities.saltFields(player, world, tile);
        case 'hostages': return Atrocities.takeHostages(player, world);
        case 'execute': return Atrocities.executeHostages(player, world);
        case 'release': return Atrocities.releaseHostages(player, world);
        case 'plague': return Atrocities.flingPlague(player, world);
        case 'massacre': return Atrocities.massacre(player, world, tile);
        default: return { success: false, reason: 'Unknown deed.' };
        }
    },

    _check(player, world, tile, id) {
        const opt = Atrocities.options(player, world, tile).find(o => o.id === id);
        if (!opt) return 'That cannot be done here.';
        return opt.ok ? null : opt.why;
    },

    _spendAP(player, cost) {
        player.actionPoints = _num(player.actionPoints) - _num(cost);
    },

    // ── The acts ────────────────────────────────────────────────

    /** Sow the town's fields with salt (the siege here, or a town taken lately). */
    saltFields(player, world, tile) {
        const why = Atrocities._check(player, world, tile, 'salt');
        if (why) return { success: false, reason: why };
        const C = Atrocities.config();
        const S = C.salt;
        const settlement = tile.settlement;
        const siege = Atrocities._siegeAt(player, tile.q, tile.r);
        const day = _day(world);
        Atrocities._spendAP(player, S.apCost);
        // The salt comes from somewhere: your packs first, then the town's own market
        let need = Atrocities._saltNeed(settlement);
        const fromPacks = Math.min(need, Math.floor(_num(player.inventory && player.inventory.salt)));
        if (fromPacks > 0) {
            player.inventory.salt -= fromPacks;
            if (player.inventory.salt <= 0) delete player.inventory.salt;
            need -= fromPacks;
        }
        if (need > 0 && !siege) need -= SettlementMarket.take(settlement, 'salt', need);
        const years = Utils.randInt(S.years[0], S.years[1]);
        const by = Atrocities._by(player);
        Harvests.saltFields(world, settlement, day + years * Atrocities._yearDays(), { yield: S.yield, by });
        settlement.happiness = Utils.clamp(_num(settlement.happiness, 50) + _num(S.happiness), 0, 100);
        if (siege) {
            siege.morale = Utils.clamp(_num(siege.morale) - _num(S.siegeMorale), 0, 100);
            Atrocities._siegeLog(siege, world, `You sow ${settlement.name}'s fields with salt.`);
        }
        Atrocities._brand(player, world, 'salt', settlement, { kingdomId: siege ? siege.kingdomId : (Atrocities._takenAt(player, world, tile.q, tile.r) || {}).kingdomId, years });
        return { success: true, years, message: _fill(siege ? C.lines.saltSiege : C.lines.salt, { town: settlement.name }) + ` (${years} years)` };
    },

    /** Seize townsfolk outside the walls under an ultimatum. */
    takeHostages(player, world) {
        const s = Atrocities._siegeAt(player);
        const tile = s && world.getTile(s.q, s.r);
        const why = Atrocities._check(player, world, tile, 'hostages');
        if (why) return { success: false, reason: why };
        const C = Atrocities.config();
        const H = C.hostages;
        const st = Atrocities.state(player);
        const settlement = tile.settlement;
        const n = Atrocities._hostageCount(settlement);
        if (n <= 0) return { success: false, reason: 'There is no one left outside the walls to take.' };
        Atrocities._spendAP(player, H.apCost);
        const day = _day(world);
        settlement.population = Math.max(1, _num(settlement.population) - n);
        st.hostages = { q: s.q, r: s.r, name: s.name, count: n, day, deadline: day + _num(H.deadlineDays, 5), kingdomId: s.kingdomId != null ? s.kingdomId : null, hollow: false, warned: false };
        st.stats.hostagesTaken++;
        st.butcher = Math.min(_num(C.infamy.max, 300), st.butcher + _num(H.takeButcher));
        player.karma = _num(player.karma) + _num(H.takeKarma);
        Traits.recordAggression(player, s.kingdomId, { dread: 1 });
        s.morale = Utils.clamp(_num(s.morale) - _num(H.takeMorale), 0, 100);
        const text = _fill(C.lines.hostagesTaken, { town: s.name, n, days: H.deadlineDays });
        Atrocities._siegeLog(s, world, `${n} hostages taken; the ultimatum runs to day ${st.hostages.deadline}.`);
        return { success: true, count: n, deadline: st.hostages.deadline, message: text };
    },

    /** The ultimatum has run out: hang them. */
    executeHostages(player, world) {
        const st = Atrocities.state(player);
        const h = st.hostages;
        const s = h && Atrocities._siegeAt(player, h.q, h.r);
        const tile = s && world.getTile(s.q, s.r);
        const why = Atrocities._check(player, world, tile, 'execute');
        if (why) return { success: false, reason: why };
        const C = Atrocities.config();
        const H = C.hostages;
        s.morale = Utils.clamp(_num(s.morale) - _num(H.executeMorale), 0, 100);
        const fled = Math.floor(_num(s.garrison) * _num(H.executeFlee));
        s.garrison = Math.max(1, _num(s.garrison) - fled);
        st.hostages = null;
        Atrocities._siegeLog(s, world, `${h.count} hostages hanged before the walls.`);
        Atrocities._brand(player, world, 'hostages', tile.settlement, { kingdomId: h.kingdomId, n: h.count });
        return { success: true, count: h.count, fled, message: _fill(C.lines.hostagesHanged, { town: s.name, n: h.count }) };
    },

    /** Let the hostages go home. */
    releaseHostages(player, world) {
        const st = Atrocities.state(player);
        const h = st.hostages;
        if (!h) return { success: false, reason: 'You hold no hostages.' };
        const C = Atrocities.config();
        const H = C.hostages;
        Atrocities._sendHome(world, h);
        st.hostages = null;
        st.stats.released++;
        player.karma = _num(player.karma) + _num(H.releaseKarma);
        Traits.recordDeeds(player, { mercy: 1 });
        const s = Atrocities._siegeAt(player, h.q, h.r);
        if (s) {
            if (_day(world) > _num(h.deadline) && !h.hollow) s.morale = Utils.clamp(_num(s.morale) + _num(H.hollowMorale), 0, 100);
            Atrocities._siegeLog(s, world, `The ${h.count} hostages are released.`);
        }
        return { success: true, count: h.count, message: _fill(C.lines.hostagesReleased, { town: h.name, n: h.count }) };
    },

    _sendHome(world, h) {
        const t = world && world.getTile ? world.getTile(h.q, h.r) : null;
        if (t && t.settlement) t.settlement.population = _num(t.settlement.population) + _num(h.count);
    },

    /** Corpses over the walls: plague dead from a great plague near by, else the camp's own fever dead. */
    flingPlague(player, world) {
        const s = Atrocities._siegeAt(player);
        const tile = s && world.getTile(s.q, s.r);
        const why = Atrocities._check(player, world, tile, 'plague');
        if (why) return { success: false, reason: why };
        const C = Atrocities.config();
        const P = C.plague;
        const src = Atrocities._plagueSource(player, world, s);
        const settlement = tile.settlement;
        const day = _day(world);
        Atrocities._spendAP(player, P.apCost);
        s.townSick = true;
        s.plagueFlung = src.kind;
        s.morale = Utils.clamp(_num(s.morale) - _num(P.morale), 0, 100);
        const illness = src.kind === 'plague' ? 'plague' : 'flux';
        // The great plague takes the town for its own (its course, its dead: systems/crises.js)
        if (src.crisis) {
            try { Crises._strike(world, src.crisis, settlement, day, { name: `the siege lines of ${Atrocities._by(player)}` }, 'over the walls'); } catch (e) { /* the town is seeded below */ }
        }
        const seeded = Atrocities._seed(world, settlement, illness, day);
        let back = false;
        if (src.kind === 'plague' && Utils.random() < _num(P.campRisk)) {
            s.campSick = Math.max(_num(s.campSick), Utils.randInt(P.campDays[0], P.campDays[1]));
            back = true;
        }
        Atrocities._siegeLog(s, world, `The ${src.label} dead are flung over the walls of ${s.name}.`);
        Atrocities._brand(player, world, 'plague', settlement, { kingdomId: s.kingdomId, illness: src.label });
        let message = _fill(C.lines.plague, { town: s.name, illness: src.label });
        if (back) message += ` ${_fill(C.lines.plagueBack, { town: s.name })}`;
        return { success: true, kind: src.kind, seeded, campSick: back, message };
    },

    /** Seed an illness among the town's people (its named townsfolk, else a town-wide sickness record). */
    _seed(world, s, k, day) {
        const P = Atrocities.config().plague;
        if (!Illness.on || !Illness.on() || !Illness.def(k)) return 0;
        if (_obj(s.folk) && Array.isArray(s.folk.people)) {
            Illness.state(world, s, s.folk, day);
            const open = Townsfolk.residents(s.folk).filter(p => !p.ill);
            const n = Math.min(open.length, Utils.randInt(P.seedCases[0], P.seedCases[1]));
            for (let i = 0; i < n; i++) Illness._infect(s.folk, open.splice(Math.floor(Utils.random() * open.length), 1)[0], k, day, Utils.random, 'flung', null);
            return n;
        }
        s.sickness = { k, d: day, until: day + 21, abs: true, from: 'over the walls' };
        return 1;
    },

    /** A town that surrendered to you, put to the sword. */
    massacre(player, world, tile) {
        const why = Atrocities._check(player, world, tile, 'massacre');
        if (why) return { success: false, reason: why };
        const C = Atrocities.config();
        const M = C.massacre;
        const st = Atrocities.state(player);
        const settlement = tile.settlement;
        const rec = Atrocities._takenAt(player, world, tile.q, tile.r, 'surrender');
        Atrocities._spendAP(player, M.apCost);
        const pop0 = _num(settlement.population);
        const keep = Math.max(1, Math.floor(pop0 * _num(M.popKeep, 0.45)));
        const killed = Math.max(0, pop0 - keep);
        // Out of the town's purse, as much as is in it: no coin from nowhere
        if (!settlement.economy && pop0 > 0) Economy.initSettlement(settlement);
        const want = Math.floor(pop0 * Utils.randFloat(M.plunder[0], M.plunder[1]));
        const plunder = Math.floor(Economy.drawTown(settlement, want));
        player.gold = _num(player.gold) + plunder;
        SettlementMarket.loot(settlement, _num(M.lootShare, 0.85));
        settlement.population = keep;
        settlement.happiness = Utils.clamp(_num(settlement.happiness, 50) + _num(M.happiness), 0, 100);
        settlement.lastRaidedDay = _day(world);
        // Ruins, and the named folk killed and fled (systems/townMemory.js), then the massacre's own mark
        TownMemory.mark(settlement, 'sack', { share: Utils.clamp(1 - _num(M.popKeep, 0.45), 0.2, 0.7), by: Atrocities._by(player), byPlayer: true }, world);
        st.taken = st.taken.filter(t => t !== rec);
        Atrocities._brand(player, world, 'massacre', settlement, { kingdomId: rec ? rec.kingdomId : settlement.kingdom, n: killed, everyRealm: true });
        return { success: true, killed, plunder, message: _fill(C.lines.massacre, { town: settlement.name, n: killed, plunder }) };
    },

    // ── The brand ───────────────────────────────────────────────

    _by(player) {
        return (player && player.house && player.house.name) || (player && player.name) || 'a lord';
    },

    _yearDays() {
        const tm = DataLoader._gamedata && DataLoader._gamedata.townMemory;
        return _num(tm && tm.daysPerYear, 120);
    },

    /**
     * The consequences every act shares: karma and traits, the court, the realms'
     * regard and their lords' memories, the rumour, the town's memory, the
     * chronicle, the heralds' record, and the name (butcher, perfidy).
     */
    _brand(player, world, kind, settlement, opts = {}) {
        const C = Atrocities.config();
        const K = C[kind] || {};
        const st = Atrocities.state(player);
        const day = _day(world);
        const kid = opts.kingdomId != null ? opts.kingdomId : (settlement && settlement.kingdom) || null;
        const by = Atrocities._by(player);
        const vars = { town: settlement ? settlement.name : 'the town', by, n: _num(opts.n), illness: opts.illness || 'plague' };
        const max = _num(C.infamy.max, 300);
        st.butcher = Math.min(max, st.butcher + _num(K.butcher));
        st.perfidy = Math.min(max, st.perfidy + _num(K.perfidy));
        st.stats[kind] = _num(st.stats[kind]) + 1;
        player.karma = _num(player.karma) + _num(K.karma);
        Traits.recordAggression(player, kid, K.deeds || {});
        // The court's name for severity (systems/petitions.js)
        const court = player.petitions && player.petitions.court;
        if (court && _num(K.severity)) {
            const cap = _num(Petitions.config().courtCap) || 100;
            court.severity = Utils.clamp(_num(court.severity) + _num(K.severity), -cap, cap);
            court.mercy = Utils.clamp(_num(court.mercy) - _num(K.severity), -cap, cap);
        }
        // The realms' regard, and what their lords remember
        if (!player.reputation) player.reputation = {};
        for (const k of (world && world.kingdoms) || []) {
            if (!k || k.isAlive === false) continue;
            const own = k.id === kid;
            const rep = own ? _num(K.reputation) : _num(K.otherReputation);
            if (rep) player.reputation[k.id] = _num(player.reputation[k.id]) + rep;
            const deed = own ? K.lordDeed : K.othersDeed;
            if (deed) {
                try { NPCLords.rememberRealm(world, k.id, deed, { note: settlement ? settlement.name : undefined }); } catch (e) { /* no lord */ }
            }
        }
        // The talk of the towns
        if (K.gossip && settlement) {
            try { Gossip.spreadDeed(player, world, K.gossip, { q: settlement.q, r: settlement.r, location: settlement.name, kingdom: kid, victim: `the people of ${settlement.name}` }); } catch (e) { /* no gossip */ }
        }
        // The town remembers: its mood, its annals, its history
        if (settlement) {
            TownMemory.mark(settlement, 'atrocity', {
                what: kind, by, byPlayer: true, n: _num(opts.n), grief: _num(K.grief, -8), long: _num(K.griefLong, 3),
                line: _fill(C.marks[kind] || '{town} remembers a cruelty {when}.', { ...vars, when: '{when}' }),
            }, world);
        }
        // The House chronicle (the Annals), the world's news, the heralds' record
        if (player.house) House._chronicle(player.house, world, _fill(C.chronicle[kind] || '', vars), ['war', 'siege', 'betrayal']);
        if (world && Array.isArray(world.events) && C.events[kind]) world.events.push({ text: _fill(C.events[kind], vars), type: 'military' });
        st.history.push({ key: `atro:${day}:${kind}:${vars.town}`, kind, day, name: vars.town, q: settlement ? settlement.q : null, r: settlement ? settlement.r : null, n: _num(opts.n), kingdomId: kid, by, illness: opts.illness || null });
        if (st.history.length > 30) st.history.shift();
    },

    // ── The daily tick ──────────────────────────────────────────

    /**
     * The name fades a little; hostages are watched: sent home when their siege
     * is over, the town's heart sinking while the ultimatum stands, the threat
     * hollow once the deadline is long past. Draws no randomness.
     * → { notices: [{ icon, title, text, type }] }
     */
    processDay(world, player) {
        const out = { notices: [] };
        if (!player || !_obj(player.atrocities)) return out;
        const C = Atrocities.config();
        const st = Atrocities.state(player);
        const day = _day(world);
        st.butcher = Math.max(0, Math.round((st.butcher - _num(C.infamy.butcherDecay)) * 1000) / 1000);
        st.perfidy = Math.max(0, Math.round((st.perfidy - _num(C.infamy.perfidyDecay)) * 1000) / 1000);
        st.taken = st.taken.filter(t => day - _num(t.day) <= Math.max(_num(C.salt.windowDays), _num(C.massacre.windowDays)));
        const h = st.hostages;
        if (h) {
            const H = C.hostages;
            const s = Atrocities._siegeAt(player, h.q, h.r);
            if (!s) {
                Atrocities._sendHome(world, h);
                st.hostages = null;
                out.notices.push({ icon: '🕊️', title: 'Hostages Sent Home', text: _fill(C.lines.hostagesHome, { town: h.name, n: h.count }), type: 'info' });
                return out;
            }
            if (day <= _num(h.deadline)) {
                s.morale = Utils.clamp(_num(s.morale) - _num(H.moraleDaily), 0, 100);
                if (day === _num(h.deadline) && !h.warned) {
                    h.warned = true;
                    out.notices.push({ icon: '⛓️', title: 'The Ultimatum Runs Out', text: _fill(C.lines.deadline, { town: h.name }), type: 'warning' });
                }
            } else if (!h.hollow && day > _num(h.deadline) + _num(H.graceDays)) {
                h.hollow = true;
                s.morale = Utils.clamp(_num(s.morale) + _num(H.hollowMorale), 0, 100);
                s.campMorale = Utils.clamp(_num(s.campMorale) - _num(H.hollowCamp), 0, 100);
                Atrocities._siegeLog(s, world, 'The deadline passed and no one hanged: the threat rang hollow.');
                out.notices.push({ icon: '⛓️', title: 'An Empty Threat', text: _fill(C.lines.hollow, { town: h.name }), type: 'warning' });
            }
        }
        return out;
    },
};
