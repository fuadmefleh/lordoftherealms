// ============================================
// ABDICATION & RETIREMENT — stepping down while alive, and the old ruler who lives on
// ============================================
// The head of the House may step down in favour of a child: the rightful
// heir (the named heir, else the eldest grown child) with the House's
// blessing, or another child, passing the rightful one over (Prestige, and a
// claim the passed-over nurse: House._pendingClaim, and the Nemesis of a
// sibling denied the seat). A child under age reigns under a regent — and
// the abdicated ruler may be that regent themself (Regency kind 'elder').
// The player goes on as the heir (Relationships.succeedAsHeir, with the
// purse passed whole: nothing is a death's dues). There is no "elder life"
// mode: the old ruler is not played; they live on as an NPC elder:
//
//   - a real NPC in the relationships registry (npc.elder), with the late
//     reign's name, age, traits and skills, and their spouse beside them;
//   - an endowment taken from the purse at the abdication, and a daily
//     pension paid from the House purse into their own (real coin: the
//     Ledger's 'elder' line). Unpaid pension is owed and sours them. They
//     spend their keep in the town they retire to (its purse);
//   - a residence: at court (counsel, a steadying hand — or meddling), on a
//     country estate, or in a monastery (cloistered: ambition gone);
//   - respect (0–100) drifting weekly toward what the House gives them
//     (pension, honours, being consulted) and ambition (traits, how they
//     went). A favourite child gets their gifts — and, if they are not the
//     ruler, their voice at court for a claim;
//   - an ambitious elder who is disrespected plots: whispers first, then
//     the power behind the throne — their people hold the seals for a time,
//     skimming the treasury into the old ruler's purse while the officers'
//     loyalty bleeds, until it runs out or the plot is exposed and the
//     elder cloistered;
//   - they age and die (their own lifespan): their will to the favourite
//     and the House purse, the family tree and the reign's annals closed.
//
// Abdication under pressure: pressure(player, world) reads lost wars, low
// Prestige, overdue debts, a disaffected court and officers, an unsettled
// realm, infamy, and frailty (pure; the Steward's Counsel reads it). High
// pressure for weeks brings the court's demand to step down (30 days to
// answer: step down with grace, or hold the seat for Prestige or gold);
// ignored while the pressure holds, the court deposes the ruler — a forced
// abdication in favour of the rightful heir.
//
// State: player.abdication = { elders: [...], pressureWeeks, demand,
// cooldownUntil, record: [...] } (saved by SaveLoad). The weekly tick draws
// from its own seeded stream (world seed + day), never the shared one.
// Content: data/upbringing.json → abdication. No import-time side effects.

import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { House } from './house.js';
import { Ledger } from './ledger.js';
import { Relationships } from './relationships.js';
import { Inheritance } from './inheritance.js';
import { Regency } from './regency.js';
import { Court } from './court.js';
import { Traits } from './traits.js';
import { DynastyTree } from './dynastyTree.js';
import { Schemes } from './schemes.js';

const DEFAULTS = {
    cadence: 7,
    // The abdication itself
    endowmentShare: 0.1, endowmentMax: 1500,
    blessedDispute: 0.05, counselledDispute: 0.12,
    orderlyPrestige: 6, passOverPrestige: 12, forcedPrestige: 15,
    keepRenown: 0.8, keepReputation: 0.7,
    realmStability: { orderly: 5, passedOver: -8, forced: -12 },
    // The pension
    pension: 4, pensionChoices: [0, 2, 4, 8, 15],
    upkeep: { court: 2, estate: 3, monastery: 1 },
    // Respect and ambition
    baseRespect: { voluntary: 72, counselled: 55, forced: 22 },
    baseAmbition: 35, forcedAmbition: 25, ambitionSpread: 30,
    drift: 3, favourDecay: 1,
    pensionRespect: 3, owedRespectPer: 20,
    monasteryAmbition: -40, monasteryRespect: -20, monasteryWillingRespect: -4, estateRespect: -5,
    // The House's dealings with the elder
    counselCooldown: 30, counselRespect: 4, maxTaught: 5,
    honourPrestige: 6, honourFavour: 10, honourAmbition: -6,
    giftGold: 100, giftFavour: 6,
    // A steadying hand at court
    steadyRespect: 70, steadyRoleLoyalty: 1, steadyPressure: 10,
    // Favourites and meddling
    favouriteGiftChance: 0.25, favouriteGiftShare: 0.1, favouriteGiftMax: 100,
    championChance: 0.1, championRespect: 50, championAmbition: 40,
    // Scheming: the power behind the throne
    plotBelow: 30, plotAmbition: 55, plotRumourAt: 50,
    shadowDays: 90, shadowSkimShare: 0.04, shadowSkimMax: 150, shadowPrestige: 10, shadowRoleLoyalty: -2,
    exposePrestige: 4, accusePrestige: 12, exposeRecovery: 0.5,
    // Old age and the will
    willFavourite: 0.3,
    // Pressure to step down
    pressure: {
        counselAt: 35, demandAt: 65, weeksToDemand: 4, answerDays: 30, coupAt: 55, cooldownDays: 180,
        holdPrestige: 15, holdGold: 600,
        lowPrestige: 10, warBase: 12, warPerHolding: 8, warMax: 35,
        debtBase: 6, debtMax: 20, courtBelow: 40, courtMax: 20,
        stabilityBelow: 35, stabilityMax: 25, infamyBelow: -40, infamyMax: 20,
        frailAge: 60, frailHealth: 0.5, frail: 15, oldAge: 70, old: 10,
    },
};

const RESIDENCE = {
    court: { icon: '🏰', label: 'At court', blurb: 'Close at hand: counsel, a steadying hand — and room to meddle.' },
    estate: { icon: '🌾', label: 'A country estate', blurb: 'Far from the seals: little counsel, little mischief.' },
    monastery: { icon: '⛪', label: 'A monastery', blurb: 'Cloistered: their ambition laid down, their counsel seldom heard.' },
};

const AMBITIOUS = ['greedy', 'cruel', 'cunning', 'deceitful', 'dread_lord', 'kinslayer'];
const CONTENT = ['merciful', 'honest', 'pious', 'generous', 'beloved'];

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _arr = (v) => (Array.isArray(v) ? v : []);
const _day = (world) => _num(world && world.day);
const _seed = (world) => (world && world.generationParams && world.generationParams.seed) || 0;
const _hash01 = (key) => ((Utils.hashStr(String(key)) >>> 0) % 10000) / 10000;
const _dpy = () => _num(Relationships._getHeirSettings().daysPerYear, 120) || 120;

function _rng(world, key) {
    return Utils.seededRandom(((Utils.hashStr(`${_seed(world)}|abdication|${key}|${_day(world)}`) >>> 0) % 233279) + 1);
}

function _parentWord(gender) {
    return gender === 'female' ? 'mother' : gender === 'male' ? 'father' : 'parent';
}

function _settlementAt(world, q, r) {
    const t = world && typeof world.getTile === 'function' && Number.isFinite(q) ? world.getTile(q, r) : null;
    return (t && t.settlement) || null;
}

export const Abdication = {
    RESIDENCE,

    config() {
        const d = _obj(DataLoader.upbringing && DataLoader.upbringing.abdication) || {};
        return {
            ...DEFAULTS, ...d,
            realmStability: { ...DEFAULTS.realmStability, ...(_obj(d.realmStability) || {}) },
            upkeep: { ...DEFAULTS.upkeep, ...(_obj(d.upkeep) || {}) },
            baseRespect: { ...DEFAULTS.baseRespect, ...(_obj(d.baseRespect) || {}) },
            pressure: { ...DEFAULTS.pressure, ...(_obj(d.pressure) || {}) },
        };
    },

    // ──────────── STATE ────────────

    _blank() {
        return { elders: [], pressureWeeks: 0, demand: null, cooldownUntil: 0, record: [] };
    },

    state(player) {
        if (!player) return Abdication._blank();
        if (!_obj(player.abdication)) player.abdication = Abdication._blank();
        const st = player.abdication;
        if (!Array.isArray(st.elders)) st.elders = [];
        if (!Array.isArray(st.record)) st.record = [];
        if (!Number.isFinite(st.pressureWeeks)) st.pressureWeeks = 0;
        if (!Number.isFinite(st.cooldownUntil)) st.cooldownUntil = 0;
        if (st.demand === undefined) st.demand = null;
        return st;
    },

    /** The living elders (abdicated rulers of the House). */
    elders(player) {
        const st = player && _obj(player.abdication);
        return st ? _arr(st.elders).filter(e => e && e.alive) : [];
    },

    elder(player, npcId) {
        const st = player && _obj(player.abdication);
        return st ? _arr(st.elders).find(e => e && e.npcId === npcId) || null : null;
    },

    npcOf(e) {
        return e ? Relationships.getNPC(e.npcId) : null;
    },

    // ──────────── WHO MAY TAKE THE SEAT ────────────

    /** The rightful heir's id: the named heir, else the eldest grown child of the ruler. */
    rightfulHeirId(player) {
        if (!player) return null;
        const kids = _arr(player.children).filter(c => c && c.isAlive !== false && !c.isSibling);
        const named = (player.house && player.house.roles && player.house.roles.heir) || player.heir || null;
        if (named && kids.some(c => c.id === named)) return named;
        const minAge = _num(Relationships._getHeirSettings().minAgeToPlay, 16);
        const grown = kids.filter(c => _num(c.age) >= minAge).sort((a, b) => _num(b.age) - _num(a.age));
        if (grown.length) return grown[0].id;
        const all = kids.slice().sort((a, b) => _num(b.age) - _num(a.age));
        return all.length ? all[0].id : null;
    },

    /** Why stepping down is closed now, or null. */
    blocked(player) {
        if (!player) return 'No one to step down.';
        if (!player.house) return 'You head no House to hand on.';
        if (player.interregnum || player._isDead) return 'The dead do not abdicate.';
        if (Regency.active(player)) return 'A child under a regent cannot step down.';
        if (Regency.endingPending(player)) return 'Settle the regent\'s men first.';
        if (!_arr(player.children).some(c => c && c.isAlive !== false && !c.isSibling)) return 'You have no child to step down for.';
        return null;
    },

    /**
     * The children who could take the seat: [{ child, id, name, age, minor,
     * rightful, passOver, prestige }]. A minor reigns under a regent.
     */
    successors(player) {
        if (!player) return [];
        const minAge = _num(Relationships._getHeirSettings().minAgeToPlay, 16);
        const rightful = Abdication.rightfulHeirId(player);
        const cfg = Abdication.config();
        return _arr(player.children)
            .filter(c => c && c.isAlive !== false && !c.isSibling)
            .sort((a, b) => _num(b.age) - _num(a.age))
            .map(c => ({
                child: c, id: c.id, name: `${c.firstName || 'A child'}${c.dynasty ? ` ${c.dynasty}` : ''}`, age: _num(c.age),
                minor: _num(c.age) < minAge, rightful: c.id === rightful,
                passOver: c.id !== rightful && !!rightful,
                prestige: c.id !== rightful && rightful ? cfg.passOverPrestige : 0,
            }));
    },

    // ──────────── STEPPING DOWN ────────────

    /** The elder's ambition: their traits, how they went, a little of their own. */
    _ambition(player, how, key) {
        const cfg = Abdication.config();
        let a = cfg.baseAmbition + Math.round((_hash01(`elder:${key}`) - 0.5) * cfg.ambitionSpread);
        const earned = Traits.getEarned(player);
        for (const t of earned) {
            if (AMBITIOUS.includes(t)) a += 12;
            if (CONTENT.includes(t)) a -= 10;
        }
        if (how === 'forced') a += cfg.forcedAmbition;
        return Utils.clamp(Math.round(a), 0, 100);
    },

    /**
     * Step down. opts: { childId (default the rightful heir), residence
     * ('court' | 'estate' | 'monastery'), pension (gold a day), regent
     * ('elder' or a Regency candidate id, for a minor), how ('voluntary' |
     * 'counselled' | 'forced'), reason, secure (spend Prestige on a dispute) }.
     * → { success, reason?, elder, npc, succession, text }
     */
    abdicate(player, world, opts = {}) {
        const why = Abdication.blocked(player);
        if (why) return { success: false, reason: why };
        const cfg = Abdication.config();
        const st = Abdication.state(player);
        const day = _day(world);
        const how = ['voluntary', 'counselled', 'forced'].includes(opts.how) ? opts.how : (st.demand ? 'counselled' : 'voluntary');
        const childId = opts.childId || Abdication.rightfulHeirId(player);
        const succ = Abdication.successors(player).find(s => s.id === childId);
        if (!succ) return { success: false, reason: 'That child cannot take the seat.' };
        const residence = RESIDENCE[opts.residence] ? opts.residence : (how === 'forced' ? 'estate' : 'court');
        const house = player.house;
        const passedOver = succ.passOver;
        if (passedOver && how !== 'forced' && _num(house.prestige) < cfg.passOverPrestige) {
            return { success: false, reason: `Passing over the rightful heir costs ${cfg.passOverPrestige} Prestige.` };
        }

        // ── Who the old ruler was (before the succession turns the player into the heir)
        const old = {
            name: player.name, firstName: player.firstName || String(player.name || '').split(' ')[0],
            lastName: player.lastName || '', gender: player.gender, age: _num(player.age, 50),
            maxLifespan: _num(player.maxLifespan, 70), culture: player.culture || null,
            traits: Traits.getEarned(player).slice(),
            skills: { ...(player.skills || {}) },
            stats: { strength: player.strength, charisma: player.charisma, intelligence: player.intelligence, faith: player.faith, luck: player.luck },
            spouseId: player.spouse || null, q: player.q, r: player.r,
            reignStart: house.currentReign ? _num(house.currentReign.startDay, day) : day,
            kingdomId: player.allegiance || null,
        };
        const tree = DynastyTree.ensure(player, world);
        const treeId = tree ? tree.currentId : null;
        const town = Inheritance.liegeOf(player, world).town || _settlementAt(world, player.q, player.r);
        const ruling = player.throne && player.throne.ruling;
        const crown = ruling && world && typeof world.getKingdom === 'function' ? world.getKingdom(ruling.kingdomId) : null;

        // ── The endowment the old ruler takes into retirement (real coin, out of the purse)
        const coin = Inheritance.coin(player);
        const endowment = how === 'forced' ? 0 : Math.min(_num(cfg.endowmentMax), Math.floor(coin * _num(cfg.endowmentShare)));

        // ── The elder, a real person of the world (created before the
        // succession so they can be named regent for a minor heir)
        const npcId = `rnpc_${Relationships._nextId++}`;
        const personalities = Object.keys(Relationships._getPersonalities() || {});
        const npc = {
            id: npcId, firstName: old.firstName, dynasty: old.lastName || (house && house.name) || '',
            gender: old.gender || 'male', age: old.age, culture: old.culture,
            personality: personalities.length ? personalities[(Utils.hashStr(`${npcId}|${old.name}`) >>> 0) % personalities.length] : 'stern',
            settlementName: town ? town.name : null,
            settlementQ: town && Number.isFinite(town.q) ? town.q : (Number.isFinite(old.q) ? old.q : null),
            settlementR: town && Number.isFinite(town.r) ? town.r : (Number.isFinite(old.r) ? old.r : null),
            kingdomId: (town && town.kingdom) || old.kingdomId || null,
            isAlive: true, traits: old.traits.slice(), appearance: player.appearance ? JSON.parse(JSON.stringify(player.appearance)) : null,
            occupation: residence === 'monastery' ? 'retired ruler, cloistered' : 'retired ruler',
            affection: 0, friendship: 40, attraction: 0, loyalty: 50,
            isMarried: !!old.spouseId, marriedTo: old.spouseId, isRomantic: false, metDay: day, lastInteraction: day,
            noble: true, elder: true, atCourt: 'retired', kin: 'parent',
            skills: { ...old.skills }, purse: 0,
        };
        Relationships._npcs.push(npc);
        if (endowment > 0) {
            Inheritance.setCoin(player, coin - endowment);
            npc.purse = endowment;
            Ledger.record(player, 'elder', -endowment);
        }

        const respect = Utils.clamp(_num(cfg.baseRespect[how], 60), 0, 100);
        const ambition = Abdication._ambition(player, how, `${npcId}|${old.name}`);

        // ── Prestige and the dispute chance
        let disputeChance;
        if (how === 'forced') {
            House.spend(house, Math.min(cfg.forcedPrestige, Math.max(0, _num(house.prestige))), 'deposed by the court', day);
        } else if (passedOver) {
            House.spend(house, cfg.passOverPrestige, 'the rightful heir passed over', day);
            house._pendingClaim = true;
        } else {
            disputeChance = how === 'counselled' ? cfg.counselledDispute : cfg.blessedDispute;
        }

        // A minor: the regent (the old ruler themself, or one of the household)
        let regentChoice = null;
        if (succ.minor) {
            regentChoice = opts.regent === 'elder' && how !== 'forced'
                ? { kind: 'elder', id: npcId, name: old.name, loyalty: respect, ambition }
                : (opts.regent || null);
        }

        // ── The succession (the purse passes whole: an abdication owes no death's dues)
        const res = Relationships.succeedAsHeir(player, childId, world, {
            cause: null, regency: succ.minor, regent: regentChoice, secure: !!opts.secure,
            keepShare: 1, disputeChance,
            renownShare: how === 'forced' ? undefined : cfg.keepRenown,
            reputationShare: how === 'forced' ? undefined : cfg.keepReputation,
            abdication: true,
        });
        if (!res.success) {
            // Undo: the elder never left the seat
            Relationships._npcs.splice(Relationships._npcs.indexOf(npc), 1);
            if (endowment > 0) {
                Inheritance.setCoin(player, Inheritance.coin(player) + endowment);
                Ledger.record(player, 'elder', endowment);
            }
            return { success: false, reason: res.reason || 'The seat could not pass.' };
        }

        // The reign is closed, not ended in death; the tree keeps them living
        if (res.reign) {
            res.reign.cause = null;
            res.reign.abdicated = { day, how, reason: opts.reason || null, to: player.name, passedOver: !!passedOver };
        }
        const L = DynastyTree.ensure(player, world);
        const rec = L && treeId ? L.people[treeId] : null;
        if (rec) {
            rec.alive = true;
            rec.died = null;
            rec.cause = null;
            rec.abdicated = day;
        }
        const reignIndex = house.reigns ? house.reigns.indexOf(res.reign) : -1;

        // The new ruler's regard for the old one
        const rel = Relationships.getRelationship(player, npcId);
        rel.score = how === 'forced' ? 5 : passedOver ? 30 : 50;
        rel.affection = Math.max(_num(rel.affection), how === 'forced' ? 10 : 40);
        if (old.spouseId) {
            const sp = Relationships.getNPC(old.spouseId);
            if (sp && sp.isAlive !== false) {
                const r2 = Relationships.getRelationship(player, sp.id);
                r2.score = Math.max(_num(r2.score), 40);
                sp.kin = 'parent';
            }
        }

        // A favourite: the old ruler's best-loved child among those left (the ruler if none)
        const sibs = _arr(player.children).filter(c => c && c.isAlive !== false && c.isSibling);
        const fav = sibs.length && _hash01(`fav:${npcId}`) < 0.6 ? sibs[(Utils.hashStr(`favpick:${npcId}`) >>> 0) % sibs.length] : null;

        const e = {
            npcId, name: old.name, firstName: old.firstName, gender: old.gender,
            abdicatedDay: day, ageAt: old.age, reignYears: Math.round(((day - old.reignStart) / _dpy()) * 10) / 10,
            how, reason: opts.reason || null, heirName: player.name, heirId: childId, passedOver: !!passedOver,
            residence, town: town ? { name: town.name, q: town.q, r: town.r } : null,
            pension: Math.max(0, Math.round(_num(opts.pension, cfg.pension))), owed: 0, paid: 0, endowment,
            respect, ambition, favour: 0,
            favourite: fav ? { id: fav.id, name: fav.firstName } : { id: 'ruler', name: player.firstName },
            championed: null, plot: 0, rumoured: false, shadow: null, skimmed: 0, shadows: 0,
            lastCounsel: -9999, taught: 0, gifts: 0,
            maxLifespan: old.maxLifespan, spouseId: old.spouseId, treeId, reignIndex,
            alive: true, died: null,
        };
        if (residence === 'monastery') e.ambition = Math.max(0, e.ambition + cfg.monasteryAmbition);
        st.elders.push(e);
        st.demand = null;
        st.pressureWeeks = 0;
        st.cooldownUntil = day + _num(cfg.pressure.cooldownDays);
        st.record.push({ day, name: old.name, to: player.name, how, passedOver: !!passedOver, minor: !!succ.minor });

        // The realm's regard for the handover (the crown worn, if any)
        if (crown && Number.isFinite(crown.stability)) {
            const d = how === 'forced' ? cfg.realmStability.forced : passedOver ? cfg.realmStability.passedOver : cfg.realmStability.orderly;
            crown.stability = Utils.clamp(crown.stability + d, 0, 100);
        }
        if (how !== 'forced' && !passedOver && cfg.orderlyPrestige > 0) House.award(house, cfg.orderlyPrestige, 'an orderly abdication', day);

        const parent = _parentWord(old.gender);
        const where = residence === 'court' ? 'stays at court' : residence === 'estate' ? `retires to a country estate${town ? ` near ${town.name}` : ''}` : `takes the cowl in a monastery${town ? ` near ${town.name}` : ''}`;
        const line = how === 'forced'
            ? `${old.name} is made to set down the seat by the lords of the court${opts.reason ? ` (${opts.reason})` : ''}. ${player.name} takes it up; the old ${parent} ${where}.`
            : `${old.name} sets down the seat after ${e.reignYears} years${passedOver ? `, passing over the rightful heir for ${player.name}` : ` in favour of ${player.name}`}, and ${where}.`;
        House._chronicle(house, world, line, ['succession', 'abdication']);
        const text = `${line}${endowment ? ` ${old.firstName} takes ${endowment} gold into retirement;` : ''} a pension of ${e.pension} gold a day.`;
        return { success: true, elder: e, npc, succession: res, text, how };
    },

    // ──────────── PRESSURE TO STEP DOWN ────────────

    /**
     * How hard the realm pushes the ruler to step down, and why. Pure (the
     * Steward's Counsel reads it): { score, reasons: [{ key, text, weight }] }.
     */
    pressure(player, world) {
        const out = { score: 0, reasons: [] };
        if (!player || !player.house || player.interregnum || Regency.active(player)) return out;
        const P = Abdication.config().pressure;
        const add = (key, text, w) => {
            const v = Math.round(Math.max(0, w));
            if (v > 0) out.reasons.push({ key, text, weight: v });
        };
        const prestige = _num(player.house.prestige);
        if (prestige < P.lowPrestige) add('prestige', 'the House\'s standing is low', Math.min(25, (P.lowPrestige - prestige) * 1.5));
        let war = 0;
        let warName = null;
        for (const w of Object.values(_obj(player.realmWars && player.realmWars.wars) || {})) {
            if (!w || !(_num(w.score) < 0 || _num(w.holdingsLost) > 0)) continue;
            war += P.warBase + _num(w.holdingsLost) * P.warPerHolding;
            warName = warName || w.name || null;
        }
        if (war > 0) add('war', `the war with ${warName || 'a realm'} goes badly`, Math.min(P.warMax, war));
        const loans = _arr(player.finance && player.finance.loans);
        const overdue = loans.reduce((s, l) => s + _num(l && l.overdue), 0);
        if (overdue > 0) add('debt', 'debts are overdue', Math.min(P.debtMax, P.debtBase + overdue));
        const court = _arr(player.house.court).filter(c => c && Number.isFinite(c.loyalty));
        const officers = Object.values(player.house.roleLoyalty || {}).filter(Number.isFinite);
        const loy = [...court.map(c => c.loyalty), ...officers];
        if (loy.length >= 2) {
            const avg = loy.reduce((a, b) => a + b, 0) / loy.length;
            if (avg < P.courtBelow) add('court', 'the court and the officers are disaffected', Math.min(P.courtMax, P.courtBelow - avg));
        }
        const ruling = player.throne && player.throne.ruling;
        const k = ruling && world && typeof world.getKingdom === 'function' ? world.getKingdom(ruling.kingdomId) : null;
        if (k && Number.isFinite(k.stability) && k.stability < P.stabilityBelow) add('stability', `${k.name} is unsettled`, Math.min(P.stabilityMax, P.stabilityBelow - k.stability));
        const karma = _num(player.karma);
        if (karma < P.infamyBelow) add('infamy', 'your name is a byword for scandal', Math.min(P.infamyMax, (P.infamyBelow - karma) / 2));
        const age = _num(player.age);
        const hp = _num(player.maxHealth) > 0 ? _num(player.health) / _num(player.maxHealth) : 1;
        if (age >= P.frailAge && hp < P.frailHealth) add('frail', 'you are old and failing', P.frail);
        if (age >= P.oldAge) add('years', 'your years weigh on the seat', P.old);
        let score = out.reasons.reduce((s, r) => s + r.weight, 0);
        // A respected old ruler at court stands behind the seat
        const cfg = Abdication.config();
        if (score > 0 && Abdication.elders(player).some(e => e.residence === 'court' && e.respect >= cfg.steadyRespect && !e.shadow)) score -= cfg.steadyPressure;
        out.score = Utils.clamp(Math.round(score), 0, 100);
        out.reasons.sort((a, b) => b.weight - a.weight);
        return out;
    },

    /** Hold the seat against the court's demand: 'prestige' | 'gold'. */
    holdSeat(player, world, how) {
        const st = Abdication.state(player);
        if (!st.demand) return { success: false, reason: 'No one demands that you step down.' };
        const P = Abdication.config().pressure;
        const day = _day(world);
        if (how === 'prestige') {
            if (!player.house || !House.spend(player.house, P.holdPrestige, 'held the seat against the court', day)) return { success: false, reason: `Holding the seat costs ${P.holdPrestige} Prestige.` };
        } else if (how === 'gold') {
            // Bought loyalty: into the courtiers' and officers' purses — the court's own (real coin)
            if (Inheritance.coin(player) < P.holdGold) return { success: false, reason: `Buying the court's loyalty costs ${P.holdGold} gold.` };
            const takers = Court.members(player).filter(n => n && n.isAlive !== false);
            if (!takers.length) return { success: false, reason: 'There is no court to buy.' };
            Inheritance.setCoin(player, Inheritance.coin(player) - P.holdGold);
            const each = Math.floor(P.holdGold / takers.length);
            takers.forEach((n, i) => { n.purse = _num(n.purse) + (i === takers.length - 1 ? P.holdGold - each * (takers.length - 1) : each); });
            Ledger.record(player, 'courtStipends', -P.holdGold);
            for (const e of player.house.court || []) if (e) e.loyalty = Utils.clamp(_num(e.loyalty) + 10, 0, 100);
        } else return { success: false, reason: 'No such way.' };
        st.demand = null;
        st.pressureWeeks = 0;
        st.cooldownUntil = day + _num(P.cooldownDays);
        House._chronicle(player.house, world, `${player.name} holds the seat against the court's demand to step down.`, ['succession', 'abdication']);
        return { success: true, text: how === 'prestige' ? 'You face the lords down: the seat is yours, for now.' : 'Gold quiets the court: the seat is yours, for now.' };
    },

    // ──────────── THE DAILY TICK ────────────

    /**
     * One day. Daily: the pension paid, the elders' keep spent. Weekly (own
     * stream): respect drifts, favourites, meddling, plots, the shadow
     * behind the throne, the court's pressure. Yearly: the elders age and
     * may die. opts.interregnum: only the years pass (the House in trust).
     * → { notices: [{ icon, title, text, type }], abdicated? }
     */
    processDay(player, world, opts = {}) {
        const out = { notices: [] };
        if (!player || !world) return out;
        const st = _obj(player.abdication);
        const day = _day(world);
        const Y = _dpy();
        if (st && st.elders.length) {
            const live = st.elders.filter(e => e && e.alive);
            for (const e of live) {
                const npc = Abdication.npcOf(e);
                if (!npc || npc.isAlive === false) {
                    Abdication._die(player, world, e, (npc && npc.deathCause) || 'old age', out);
                    continue;
                }
                if (!opts.interregnum) Abdication._payDay(player, world, e, npc);
            }
            if (Y > 0 && day > 0 && day % Y === 0) {
                Utils.withRng(_rng(world, 'years'), () => {
                    for (const e of st.elders.filter(x => x && x.alive)) Abdication._year(player, world, e, out);
                });
            }
        }
        if (opts.interregnum || !player.house) return out;
        const cfg = Abdication.config();
        if (day % Math.max(1, cfg.cadence) !== 0) return out;
        Utils.withRng(_rng(world, 'week'), () => {
            if (st) for (const e of st.elders.filter(x => x && x.alive)) Abdication._week(player, world, e, out);
            Abdication._pressureWeek(player, world, out);
        });
        return out;
    },

    /** The pension (House purse → the elder's), arrears first; the elder's keep (→ their town). */
    _payDay(player, world, e, npc) {
        const cfg = Abdication.config();
        const due = _num(e.pension) + _num(e.owed);
        if (due > 0) {
            const pay = Math.min(due, Math.floor(Inheritance.coin(player)));
            if (pay > 0) {
                Inheritance.setCoin(player, Inheritance.coin(player) - pay);
                npc.purse = _num(npc.purse) + pay;
                e.paid = _num(e.paid) + pay;
                Ledger.record(player, 'elder', -pay);
            }
            e.owed = Math.max(0, due - pay);
        }
        const keep = Math.min(_num(npc.purse), _num(cfg.upkeep[e.residence], 2));
        const town = e.town ? _settlementAt(world, e.town.q, e.town.r) : null;
        if (keep > 0 && town && town.economy && Number.isFinite(town.economy.gold)) {
            npc.purse = _num(npc.purse) - keep;
            town.economy.gold += keep;
        }
    },

    _respectTarget(player, e) {
        const cfg = Abdication.config();
        let t = _num(cfg.baseRespect[e.how], 60);
        t += Utils.clamp((_num(e.pension) - cfg.pension) * cfg.pensionRespect, -20, 15);
        t -= Math.min(30, _num(e.owed) / Math.max(1, cfg.owedRespectPer));
        t += _num(e.favour);
        if (e.residence === 'monastery' && e.cloistered === 'forced') t -= 10;
        return Utils.clamp(t, 0, 100);
    },

    _week(player, world, e, out) {
        const cfg = Abdication.config();
        const day = _day(world);
        const house = player.house;
        const npc = Abdication.npcOf(e);
        // Respect drifts toward what the House gives; favours fade
        const target = Abdication._respectTarget(player, e);
        const diff = target - e.respect;
        e.respect = Utils.clamp(Math.round(e.respect + Math.sign(diff) * Math.min(Math.abs(diff), cfg.drift) + Utils.randInt(-1, 1)), 0, 100);
        if (e.favour > 0) e.favour = Math.max(0, e.favour - cfg.favourDecay);
        const rel = player.relationships && player.relationships[e.npcId];
        if (rel) rel.score = Utils.clamp(Math.round((rel.score * 3 + (e.respect - 20)) / 4), -100, 100);

        // The sitting regent is governed by the regency, not here
        const regent = Regency.active(player) && player.regency.regent && player.regency.regent.id === e.npcId;
        const name = e.firstName || e.name;

        // A steadying hand at court
        if (e.residence === 'court' && e.respect >= cfg.steadyRespect && !e.shadow && house.roleLoyalty) {
            for (const id of Object.keys(house.roleLoyalty)) house.roleLoyalty[id] = Utils.clamp(_num(house.roleLoyalty[id]) + cfg.steadyRoleLoyalty, 0, 100);
        }

        // The favourite's gifts (the elder's purse → the child's own)
        const fav = e.favourite && e.favourite.id !== 'ruler' ? _arr(player.children).find(c => c && c.id === e.favourite.id && c.isAlive !== false) : null;
        if (e.favourite && e.favourite.id !== 'ruler' && !fav) e.favourite = { id: 'ruler', name: player.firstName };
        if (fav && npc && _num(npc.purse) > 50 && Utils.random() < cfg.favouriteGiftChance) {
            const g = Math.min(cfg.favouriteGiftMax, Math.floor(_num(npc.purse) * cfg.favouriteGiftShare));
            if (g > 0) {
                npc.purse -= g;
                fav.purse = _num(fav.purse) + g;
                e.gifts = _num(e.gifts) + g;
            }
        }
        // Meddling: a soured elder speaks for the favourite at court
        if (fav && !e.championed && e.residence !== 'monastery' && e.respect < cfg.championRespect && e.ambition >= cfg.championAmbition && Utils.random() < cfg.championChance) {
            e.championed = day;
            house._pendingClaim = true;
            House._chronicle(house, world, `${e.name} speaks for ${fav.firstName} at court, as though the seat were still theirs to give.`, ['abdication', 'heirs']);
            out.notices.push({ icon: '💺', title: 'The Old Ruler Meddles', text: `${name} speaks for ${fav.firstName} at court. The lords listen: a claim may be pressed when the seat next passes.`, type: 'warning' });
        }

        if (regent) return;

        // The shadow behind the throne
        if (e.shadow) {
            if (day >= _num(e.shadow.until)) {
                e.shadow = null;
                e.plot = 0;
                e.rumoured = false;
                House._chronicle(house, world, `${e.name}'s people give up the seals; ${player.name} rules in their own name again.`, ['abdication']);
                out.notices.push({ icon: '💺', title: 'The Seals Return', text: `${name}'s people give the seals back. The skimming ends.`, type: 'info' });
                return;
            }
            const take = Math.min(cfg.shadowSkimMax, Math.floor(Inheritance.coin(player) * cfg.shadowSkimShare));
            if (take > 0 && npc) {
                Inheritance.setCoin(player, Inheritance.coin(player) - take);
                npc.purse = _num(npc.purse) + take;
                e.skimmed = _num(e.skimmed) + take;
                Ledger.record(player, 'elder', -take);
            }
            for (const id of Object.keys(house.roleLoyalty || {})) house.roleLoyalty[id] = Utils.clamp(_num(house.roleLoyalty[id]) + cfg.shadowRoleLoyalty, 0, 100);
            return;
        }

        // A disrespected, ambitious elder plots
        if (e.residence !== 'monastery' && e.respect < cfg.plotBelow && e.ambition >= cfg.plotAmbition) {
            e.plot = Math.min(100, _num(e.plot) + Math.round(e.ambition / 10) + Utils.randInt(0, 3));
            if (!e.rumoured && e.plot >= cfg.plotRumourAt) {
                e.rumoured = true;
                out.notices.push({ icon: '🕵️', title: 'The Old Ruler Plots', text: `It is whispered that ${name} means to rule again from behind your seat. Win them back, or send them to a monastery while the plot can still be exposed.`, type: 'warning' });
            }
            if (e.plot >= 100) {
                e.shadow = { since: day, until: day + cfg.shadowDays };
                e.shadows = _num(e.shadows) + 1;
                e.plot = 0;
                House.spend(house, Math.min(cfg.shadowPrestige, Math.max(0, _num(house.prestige))), `${e.name} rules from behind the seat`, day);
                House._chronicle(house, world, `${e.name}'s people take the seals: the old ruler rules again, from behind ${player.name}'s seat.`, ['abdication', 'betrayal']);
                out.notices.push({ icon: '🗝️', title: 'The Power Behind the Throne', text: `${name}'s people hold the seals and the treasury's keys. They will skim the coffers until the plot is exposed or it runs its course.`, type: 'error' });
            }
        } else if (e.plot > 0 && e.respect >= cfg.plotBelow + 10) {
            e.plot = Math.max(0, e.plot - 5);
        }
    },

    /** The court's pressure: weeks of it bring a demand; an unanswered demand, a coup. */
    _pressureWeek(player, world, out) {
        const st = Abdication.state(player);
        const P = Abdication.config().pressure;
        const day = _day(world);
        const pr = Abdication.pressure(player, world);
        const heir = Abdication.rightfulHeirId(player);
        if (st.demand) {
            if (day < _num(st.demand.due)) return;
            if (pr.score >= P.coupAt && heir && !Abdication.blocked(player)) {
                const why = (st.demand.reasons || []).slice(0, 2).join('; ') || 'the court has lost faith in you';
                const oldName = player.name;
                const res = Abdication.abdicate(player, world, { how: 'forced', childId: heir, residence: 'estate', reason: why });
                if (res.success) {
                    out.abdicated = res;
                    out.notices.push({ icon: '⚔️', title: 'Deposed', text: `The lords of the court have made ${oldName} set down the seat (${why}). You are now ${player.name}; the old ruler is sent to a country estate.`, type: 'error' });
                    return;
                }
            }
            st.demand = null;
            st.pressureWeeks = 0;
            st.cooldownUntil = day + Math.floor(_num(P.cooldownDays) / 2);
            out.notices.push({ icon: '💺', title: 'The Court Relents', text: 'The lords\' demand that you step down lapses: the crisis has eased.', type: 'info' });
            return;
        }
        if (pr.score >= P.demandAt && heir && day >= _num(st.cooldownUntil)) {
            st.pressureWeeks = _num(st.pressureWeeks) + 1;
            if (st.pressureWeeks >= P.weeksToDemand) {
                st.demand = { day, due: day + P.answerDays, score: pr.score, reasons: pr.reasons.map(r => r.text) };
                House._chronicle(player.house, world, `The lords of the court ask ${player.name} to step down: ${st.demand.reasons.slice(0, 3).join('; ')}.`, ['succession', 'abdication']);
                out.notices.push({ icon: '💺', title: 'The Court Demands You Step Down', text: `The lords ask you to set down the seat for your heir: ${st.demand.reasons.slice(0, 3).join('; ')}. Answer within ${P.answerDays} days (House → Succession & Retirement), or they will act.`, type: 'error' });
            }
        } else if (st.pressureWeeks > 0) {
            st.pressureWeeks = Math.max(0, st.pressureWeeks - 1);
        }
    },

    /** A year for an elder: older, and perhaps their last. */
    _year(player, world, e, out) {
        const npc = Abdication.npcOf(e);
        if (!npc) return;
        npc.age = _num(npc.age) + 1;
        const hs = Relationships._getHeirSettings();
        const over = npc.age - _num(e.maxLifespan, 70);
        const chance = over > 0 ? over * _num(hs.deathChancePerYearOverMax, 0.15) : (npc.age >= 80 ? 0.05 : 0);
        if (Utils.random() < chance) Abdication._die(player, world, e, 'old age', out);
    },

    /** The elder dies: their will, the tree and the annals closed. */
    _die(player, world, e, cause, out) {
        if (!e || !e.alive) return;
        const day = _day(world);
        const cfg = Abdication.config();
        const npc = Abdication.npcOf(e);
        e.alive = false;
        const age = npc ? _num(npc.age) : _num(e.ageAt);
        e.died = { day, age, cause: cause || 'old age' };
        e.shadow = null;
        if (npc) {
            npc.isAlive = false;
            if (npc.deathDay == null) npc.deathDay = day;
            npc.deathCause = npc.deathCause || e.died.cause;
            npc.atCourt = null;
        }
        // The will: a share to the favourite child, the rest to the House purse (real coin)
        let toFav = 0;
        let toHouse = 0;
        let favName = null;
        if (npc && _num(npc.purse) > 0) {
            const fav = e.favourite && e.favourite.id !== 'ruler' ? _arr(player && player.children).find(c => c && c.id === e.favourite.id && c.isAlive !== false) : null;
            if (fav) {
                toFav = Math.floor(_num(npc.purse) * cfg.willFavourite);
                fav.purse = _num(fav.purse) + toFav;
                favName = fav.firstName;
            }
            toHouse = Math.round((_num(npc.purse) - toFav) * 100) / 100;
            npc.purse = 0;
            if (player && toHouse > 0) {
                Inheritance.setCoin(player, Inheritance.coin(player) + toHouse);
                Ledger.record(player, 'inheritance', toHouse);
            }
        }
        // The family tree and the reign's annals
        const house = player && player.house;
        const L = house ? DynastyTree.ensure(player, world) : null;
        const rec = L && e.treeId ? L.people[e.treeId] : null;
        if (rec) {
            rec.alive = false;
            rec.died = day;
            rec.cause = e.died.cause;
        }
        const reign = house && Array.isArray(house.reigns)
            ? (house.reigns[e.reignIndex] && house.reigns[e.reignIndex].abdicated ? house.reigns[e.reignIndex] : house.reigns.find(r => r && r.abdicated && r.name === e.name))
            : null;
        if (reign) reign.elderDeath = { day, age, cause: e.died.cause };
        if (house) {
            House._chronicle(house, world, `${e.name}, who set down the seat in the year of ${e.heirName}'s accession, dies of ${e.died.cause} aged ${age}.`
                + `${toHouse > 0 ? ` ${Math.round(toHouse)} gold comes back to the House${toFav > 0 ? `, ${toFav} to ${favName}` : ''}.` : ''}`, ['abdication', 'death']);
        }
        out.notices.push({ icon: '🕯️', title: 'The Old Ruler Dies', text: `${e.name}, who held the seat before ${e.heirName}, has died of ${e.died.cause}, aged ${age}.${toHouse > 0 ? ` Their purse comes to the House (${Math.round(toHouse)} gold${toFav > 0 ? `; ${toFav} to ${favName}` : ''}).` : ''}`, type: 'warning' });
    },

    // ──────────── DEALINGS WITH THE ELDER ────────────

    _live(player, npcId) {
        const e = Abdication.elder(player, npcId);
        return e && e.alive ? e : null;
    },

    /** Seek their counsel: a plot uncovered, or a skill taught. */
    counsel(player, world, npcId) {
        const cfg = Abdication.config();
        const e = Abdication._live(player, npcId);
        if (!e) return { success: false, reason: 'There is no one to ask.' };
        const day = _day(world);
        if (day - _num(e.lastCounsel, -9999) < cfg.counselCooldown) return { success: false, reason: `You sought their counsel lately; ask again in ${cfg.counselCooldown - (day - e.lastCounsel)} days.` };
        if (e.respect < 25 || e.shadow) return { success: false, reason: `${e.firstName} will not counsel a ruler they hold in contempt.` };
        e.lastCounsel = day;
        e.favour = Math.min(30, _num(e.favour) + cfg.counselRespect);
        const name = e.firstName || e.name;
        // At court, they hear things: a hidden plot against the House
        if (e.residence === 'court' && e.respect >= 50) {
            const hidden = _arr(Schemes.active(player)).find(s => s && !s.revealed);
            if (hidden) {
                hidden.revealed = true;
                return { success: true, text: `${name} has heard things at court: a plot against the House is laid bare (House → Plots Against You).` };
            }
        }
        // Else: the craft of ruling, where they were the better hand
        const npc = Abdication.npcOf(e);
        if (npc && _num(e.taught) < cfg.maxTaught && e.residence !== 'monastery') {
            if (!player.skills) player.skills = {};
            const gaps = ['diplomacy', 'leadership', 'commerce', 'combat', 'stealth']
                .map(k => ({ k, gap: _num(npc.skills && npc.skills[k]) - _num(player.skills[k]) }))
                .filter(g => g.gap >= 2).sort((a, b) => b.gap - a.gap);
            if (gaps.length) {
                player.skills[gaps[0].k] = _num(player.skills[gaps[0].k]) + 1;
                e.taught = _num(e.taught) + 1;
                return { success: true, text: `${name} teaches you what the seat taught them (+1 ${gaps[0].k}).` };
            }
        }
        return { success: true, text: `${name} hears you out, and is glad to be asked.` };
    },

    /** Honour them before the court (Prestige): respect up, ambition down. */
    honour(player, world, npcId) {
        const cfg = Abdication.config();
        const e = Abdication._live(player, npcId);
        if (!e) return { success: false, reason: 'There is no one to honour.' };
        if (!player.house || !House.spend(player.house, cfg.honourPrestige, `honours for ${e.name}`, _day(world))) return { success: false, reason: `Honours cost ${cfg.honourPrestige} Prestige.` };
        e.favour = Math.min(30, _num(e.favour) + cfg.honourFavour);
        e.ambition = Utils.clamp(e.ambition + cfg.honourAmbition, 0, 100);
        e.respect = Utils.clamp(e.respect + 4, 0, 100);
        return { success: true, text: `You seat ${e.firstName} at your right hand before the court.` };
    },

    /** A gift of gold (the House purse → theirs). */
    gift(player, world, npcId) {
        const cfg = Abdication.config();
        const e = Abdication._live(player, npcId);
        const npc = e ? Abdication.npcOf(e) : null;
        if (!e || !npc) return { success: false, reason: 'There is no one to give to.' };
        if (Inheritance.coin(player) < cfg.giftGold) return { success: false, reason: `A fitting gift is ${cfg.giftGold} gold.` };
        Inheritance.setCoin(player, Inheritance.coin(player) - cfg.giftGold);
        npc.purse = _num(npc.purse) + cfg.giftGold;
        Ledger.record(player, 'elder', -cfg.giftGold);
        e.favour = Math.min(30, _num(e.favour) + cfg.giftFavour);
        return { success: true, text: `${e.firstName} accepts ${cfg.giftGold} gold.` };
    },

    /** Set the daily pension. */
    setPension(player, world, npcId, gold) {
        const e = Abdication._live(player, npcId);
        if (!e) return { success: false, reason: 'There is no one to pension.' };
        const g = Math.max(0, Math.min(100, Math.round(_num(gold))));
        const was = e.pension;
        e.pension = g;
        if (g < was && player.house) House._chronicle(player.house, world, `${player.name} cuts ${e.name}'s pension to ${g} gold a day.`, ['abdication']);
        return { success: true, text: `${e.firstName}'s pension is ${g} gold a day${g < was ? ' — they will not forget it' : ''}.` };
    },

    /**
     * Move them: 'court' | 'estate' | 'monastery'. A monastery ends a plot
     * and the shadow: exposed (rumoured or ruling behind the seat), the
     * plot costs little and part of what they took comes back; unexposed,
     * it costs Prestige and their respect.
     */
    setResidence(player, world, npcId, where) {
        const cfg = Abdication.config();
        const e = Abdication._live(player, npcId);
        if (!e) return { success: false, reason: 'There is no one to move.' };
        if (!RESIDENCE[where]) return { success: false, reason: 'No such place.' };
        if (e.residence === where) return { success: false, reason: 'They are already there.' };
        const day = _day(world);
        const house = player.house;
        const npc = Abdication.npcOf(e);
        const name = e.firstName || e.name;
        let text = '';
        if (where === 'monastery') {
            const exposed = e.rumoured || !!e.shadow;
            const willing = e.respect >= 60 && !exposed;
            if (!willing) {
                const cost = exposed ? cfg.exposePrestige : cfg.accusePrestige;
                if (!house || _num(house.prestige) < cost) return { success: false, reason: `Cloistering them against their will costs ${cost} Prestige.` };
                House.spend(house, cost, `${e.name} cloistered`, day);
            }
            let back = 0;
            if (exposed && npc && _num(e.skimmed) > 0) {
                back = Math.min(Math.floor(_num(npc.purse)), Math.floor(_num(e.skimmed) * cfg.exposeRecovery));
                if (back > 0) {
                    npc.purse -= back;
                    e.skimmed -= back;
                    Inheritance.setCoin(player, Inheritance.coin(player) + back);
                    Ledger.record(player, 'elder', back);
                }
            }
            e.ambition = Math.max(0, e.ambition + cfg.monasteryAmbition);
            e.respect = Utils.clamp(e.respect + (willing ? cfg.monasteryWillingRespect : cfg.monasteryRespect), 0, 100);
            e.cloistered = willing ? 'willing' : 'forced';
            e.shadow = null;
            e.plot = 0;
            e.rumoured = false;
            text = willing ? `${name} takes the cowl gladly.` : `${name} is sent to a monastery${exposed ? ', the plot exposed' : ' against their will'}${back ? `; ${back} gold of what they took comes back` : ''}.`;
        } else {
            if (where === 'estate') e.respect = Utils.clamp(e.respect + cfg.estateRespect, 0, 100);
            if (e.residence === 'monastery' && e.cloistered === 'forced') e.favour = Math.min(30, _num(e.favour) + 5);
            e.cloistered = null;
            text = where === 'court' ? `${name} returns to court.` : `${name} retires to a country estate.`;
        }
        e.residence = where;
        if (npc) npc.occupation = where === 'monastery' ? 'retired ruler, cloistered' : 'retired ruler';
        if (house) House._chronicle(house, world, `${e.name}: ${text}`, ['abdication']);
        return { success: true, text };
    },

    // ──────────── THE PANEL ────────────

    view(player, world) {
        const st = Abdication.state(player);
        const cfg = Abdication.config();
        const P = cfg.pressure;
        const pressure = Abdication.pressure(player, world);
        const day = _day(world);
        const elders = st.elders.filter(e => e).map(e => {
            const npc = Abdication.npcOf(e);
            const fav = e.favourite || null;
            return {
                e, npc, age: npc ? _num(npc.age) : e.ageAt, purse: npc ? Math.floor(_num(npc.purse)) : 0,
                residence: RESIDENCE[e.residence] || RESIDENCE.court, regent: Regency.active(player) && player.regency.regent && player.regency.regent.id === e.npcId,
                favourite: fav ? (fav.id === 'ruler' ? 'you' : fav.name) : null,
                counselIn: Math.max(0, cfg.counselCooldown - (day - _num(e.lastCounsel, -9999))),
            };
        });
        return {
            blocked: Abdication.blocked(player), successors: Abdication.successors(player),
            pressure, counselAt: P.counselAt, demandAt: P.demandAt, demand: st.demand,
            demandDays: st.demand ? Math.max(0, _num(st.demand.due) - day) : 0,
            elders, record: st.record.slice(-6).reverse(), cfg,
            regentOptions: Abdication.regentOptions(player, world),
        };
    },

    /** Regents for a minor heir: the old ruler themself, or one of the household. */
    regentOptions(player, world) {
        if (!player) return [];
        const out = [{ id: 'elder', name: 'You, from your retirement', blurb: 'Rule in the child\'s name, as the old ruler' }];
        for (const c of Regency.candidates(player, world, null)) out.push({ id: c.id, name: c.name, blurb: c.blurb });
        return out;
    },

    // ──────────── SAVE ────────────

    serialize(player) {
        return player && _obj(player.abdication) ? JSON.parse(JSON.stringify(player.abdication)) : null;
    },

    /** Backfill for older saves (none) and partial records. */
    loadState(player) {
        if (!player) return;
        if (!_obj(player.abdication)) { player.abdication = null; return; }
        const st = Abdication.state(player);
        for (const e of st.elders) {
            if (!e) continue;
            for (const k of ['pension', 'owed', 'paid', 'respect', 'ambition', 'favour', 'plot', 'skimmed', 'taught', 'gifts']) if (!Number.isFinite(e[k])) e[k] = 0;
            if (!RESIDENCE[e.residence]) e.residence = 'court';
            e.alive = e.alive !== false && !e.died;
            if (e.shadow !== null && !_obj(e.shadow)) e.shadow = null;
        }
    },
};
