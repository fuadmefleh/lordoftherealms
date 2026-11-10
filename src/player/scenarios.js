// ============================================
// SCENARIOS — Origins: who the player is on the first day
// ============================================
// New Game picks an Origin, a difficulty and an optional victory goal
// (components/SettingsScreen.jsx → ui/game/gameSetup.js). apply() runs after
// the normal world, player, House, Titles and Councils setup and shapes the
// Player through the systems' own APIs, so every part of an origin is state
// the game already plays with:
//   - The Wanderer: nothing changes (the classic start).
//   - The Disinherited: a 'blood' claim on a throne (Throne.grantClaim), House
//     Prestige (House.award), an elder sibling as a feuding rival
//     (house.rivals, read by RealmWars hostility and the rival schemes), little gold.
//   - Guild Journeyman: moved to a guild town, made a journeyman of its guild
//     (Guilds.join, then the rank), an indenture owed to the guild as a guild
//     loan (paid weekly by Guilds; three missed payments and you are out),
//     the guild's goods in the packs.
//   - The Exiled Monarch: a strong 'blood' claim on a troubled realm, a
//     disputed succession there (Throne.startCrisis — pressing during it
//     brings the crisis bonus), loyal soldiers, gold to raise the banners.
//   - The Pirate's Widow: a crewed sloop at a port (player.ships), infamy at
//     sea (Pirates.addInfamy: hunters come at 25).
//   - Sellsword Captain: a company (player.army, wages every day), a debt to
//     a crown paid daily through Finance, standing as a sellsword.
// Advanced starts (data/scenarios.json group 'advanced') begin high in the
// world, taking over what the world already holds (nothing is minted):
//   - The Monarch: a generated realm's crown (Throne._takeThrone): its
//     treasury, army, court, laws and dynasty are the player's to run; the
//     late AI monarch is dead (no second ruler), the realm's AI stops acting
//     for it (world/kingdomAI.js, world/npcLords.js), a royal guard comes out
//     of the realm's host, the old court's officers keep their council seats
//     (Kingship), a consort and heirs; the late monarch's child is a vassal
//     and pretender, the ambitious lords are restless, a neighbour backs them.
//   - The High Priest: heads a world faith (player.religion with
//     worldFaithId: every faith panel and leader action works on it): the
//     great temple of a holy city, the church's estates there (rents from the
//     town's own coin), tithes from the faithful realms' treasuries
//     (PlayerReligion.collectTithes), clergy standing, a heresy loose in the
//     see's realm and a zealous rival faith's realm as a feuding House.
//   - The Great Lord: head of the realm's greatest noble house (its estates
//     pass to the player, LandMarket), household knights out of the realm's
//     host, a cadet blood claim, a jealous crown (feud).
//   - The Guildmaster: elected master of a great town's guild (Guilds), its
//     hall and stipend, an election soon with a challenger canvassing.
// Challenge numbers scale with the difficulty's hostility knob.
// Then the difficulty's starting-gold knob scales the purse (Normal: none).
// The record lives on player.scenario (core/difficulty.js). Origins are
// data: data/scenarios.json → origins. Randomness through Utils only; the
// Wanderer draws none.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { Difficulty } from '../core/difficulty.js';
import { Characters } from '../world/characters.js';
import { Throne } from '../systems/throne.js';
import { House } from '../systems/house.js';
import { Guilds } from '../systems/guilds.js';
import { Ships } from '../systems/ships.js';
import { Pirates } from '../systems/pirates.js';
import { Finance } from '../systems/finance.js';
import { Victory } from '../systems/victory.js';
import { PlayerMilitary } from './playerMilitary.js';
import { MercContracts } from './mercContracts.js';
import { PlayerReligion } from './playerReligion.js';
import { Kingship } from '../systems/kingship.js';
import { Relationships } from '../systems/relationships.js';
import { Religion } from '../systems/religion.js';
import { Devotion } from '../systems/devotion.js';
import { LandMarket } from '../systems/landMarket.js';
import { Estates } from '../world/estates.js';
import { Kingdom } from '../world/kingdom.js';
import { Generalship } from './generalship.js';

const FALLBACK = {
    wanderer: {
        name: 'The Wanderer', icon: '🧭', guidedStart: true, suggestedVictory: 'none',
        blurb: 'No name, no lands, no debts. A few coins and the open road.',
        gold: 250,
        welcome: 'You are a wanderer in a {mapDesc} world of {kingdoms} kingdoms. Click on the map to move, explore settlements, and forge your destiny.',
    },
};

const STAT_KEYS = ['strength', 'charisma', 'intelligence', 'faith', 'luck'];

const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _day = world => _num(world && world.day);

/** Living settlements: [{ q, r, s }] (the views' live objects). */
function _towns(world) {
    if (!world || typeof world.getSettlementViews !== 'function') return [];
    const out = [];
    for (const v of world.getSettlementViews()) {
        const t = world.getTile(v.q, v.r);
        if (t && t.settlement && t.terrain && t.terrain.passable !== false) out.push({ q: v.q, r: v.r, s: t.settlement });
    }
    return out;
}

function _dist(world, a, b) {
    return Hex.wrappingDistance(a.q, a.r, b.q, b.r, world.width);
}

function _nearest(world, list, from) {
    let best = null;
    let bd = Infinity;
    for (const x of list) {
        const d = _dist(world, x, from);
        if (d < bd) { bd = d; best = x; }
    }
    return best;
}

function _kingdomOf(world, kid) {
    return world && typeof world.getKingdom === 'function' ? world.getKingdom(kid) : (world.kingdoms || []).find(k => k.id === kid);
}

function _alive(world) {
    return (world.kingdoms || []).filter(k => k && k.isAlive !== false && k.capital);
}

export const Scenarios = {
    data() {
        return _obj(DataLoader._gamedata && DataLoader._gamedata.scenarios) || {};
    },

    /** { id: { id, name, icon, blurb, guidedStart, suggestedVictory, ... } } — the Wanderer always first. */
    origins() {
        const src = _obj(Scenarios.data().origins) || {};
        const out = { wanderer: { ...FALLBACK.wanderer, ...(_obj(src.wanderer) || {}), id: 'wanderer' } };
        for (const [id, o] of Object.entries(src)) {
            if (id === 'wanderer' || id.startsWith('_') || !_obj(o)) continue;
            out[id] = { ...o, id };
        }
        return out;
    },

    origin(id) {
        return Scenarios.origins()[id] || null;
    },

    /** The choices the New Game screen offers: { origins, difficulties, victories } as arrays. */
    choices() {
        return {
            origins: Object.values(Scenarios.origins()).map(o => ({ id: o.id, name: o.name, icon: o.icon, blurb: o.blurb, group: o.group || 'origin', suggestedVictory: o.suggestedVictory || 'none', guidedStart: o.guidedStart !== false })),
            difficulties: Object.values(Difficulty.levels()).map(d => ({ id: d.key, name: d.name, blurb: d.blurb || '' })),
            victories: Object.values(Victory.defs()).map(v => ({ id: v.id, name: v.name, icon: v.icon, blurb: v.blurb })),
        };
    },

    /** Move the player to a hex (as placeInWorld does): seen around, holy sites found. */
    _moveTo(player, world, q, r) {
        player.q = q; player.r = r;
        player.prevQ = q; player.prevR = r;
        player.path = null;
        player.travelDestination = null;
        if (typeof player.revealArea === 'function') player.revealArea(world, 4);
        if (typeof player.discoverNearbyHolySites === 'function') player.discoverNearbyHolySites(world, 4);
    },

    _train(player, o) {
        for (const [k, v] of Object.entries(_obj(o.stats) || {})) if (STAT_KEYS.includes(k)) player[k] = _num(player[k], 5) + _num(v);
        if (!player.skills) player.skills = {};
        for (const [k, v] of Object.entries(_obj(o.skills) || {})) player.skills[k] = _num(player.skills[k]) + _num(v);
    },

    _army(player, o) {
        let men = 0;
        if (!Array.isArray(player.army)) player.army = [];
        for (const [type, n] of Object.entries(_obj(o.army) || {})) {
            const def = PlayerMilitary.getUnitDef(type);
            if (!def) continue;
            for (let i = 0; i < Math.max(0, Math.floor(_num(n))); i++) {
                player.army.push(PlayerMilitary.makeArmyUnit(def));
                men++;
            }
        }
        return men;
    },

    /** A rival of the House tied to a realm (house.rivals — RealmWars hostility reads its feud). */
    _rival(player, world, kingdom, name, feud) {
        const house = player.house;
        if (!house || !kingdom) return null;
        house.rivals = house.rivals || {};
        const prev = house.rivals[kingdom.id];
        house.rivals[kingdom.id] = {
            ...(prev || {}),
            kingdomId: kingdom.id,
            name: name || (prev && prev.name) || kingdom.name,
            feud: Math.max(_num(prev && prev.feud), _num(feud)),
            lastActedDay: _day(world),
        };
        return house.rivals[kingdom.id];
    },

    // ── The origins ─────────────────────────────────────

    _disinherited(player, world, o, vars) {
        const realms = _alive(world).filter(k => _towns(world).some(t => t.s.kingdom === k.id));
        const k = realms.length ? Utils.randPick(realms) : null;
        if (!k) return;
        const towns = _towns(world).filter(t => t.s.kingdom === k.id);
        const seat = towns.filter(t => t.s.type !== 'capital');
        const home = (seat.length ? Utils.randPick(seat) : towns[0]) || null;
        if (home) Scenarios._moveTo(player, world, home.q, home.r);
        Scenarios._train(player, o);
        if (o.gold != null) player.gold = _num(o.gold);
        player.title = o.title || player.title;
        player.reputation[k.id] = _num(player.reputation[k.id]) + _num(o.reputation);
        if (player.house) House.award(player.house, _num(o.prestige), 'born of royal blood', _day(world));
        const claim = Throne.grantClaim(player, world, k.id, 'blood', _num(o.claim, 18));
        // The elder sibling: kin at the court of the realm, the House's bitterest rival
        const sibGender = Utils.random() < 0.5 ? 'brother' : 'sister';
        const pool = (Characters.FIRST_NAMES && (Characters.FIRST_NAMES[k.culture] || Characters.FIRST_NAMES.Imperial)) || null;
        const names = pool ? (pool[sibGender === 'sister' ? 'female' : 'male'] || pool.male) : null;
        const sib = (names && names.length ? Utils.randPick(names) : 'Aldric') + (player.lastName ? ` ${player.lastName}` : '');
        const rivalName = `${sib}, your elder ${sibGender}`;
        Scenarios._rival(player, world, k, rivalName, o.rivalFeud);
        Object.assign(vars, { kingdom: k.name, rival: rivalName, claim, town: home ? home.s.name : k.name });
        player.scenario.realm = k.id;
    },

    _apprentice(player, world, o, vars) {
        const day = _day(world);
        const cands = [];
        for (const t of _towns(world)) {
            if (!['town', 'city', 'capital'].includes(t.s.type)) continue;
            if (!Number.isFinite(t.s.q)) { t.s.q = t.q; t.s.r = t.r; }
            if (Guilds.ensureTown(world, t.s, day)) cands.push(t);
        }
        if (!cands.length) return;
        // A guild town near where the road began
        const sorted = cands.slice().sort((a, b) => _dist(world, a, player) - _dist(world, b, player));
        const home = Utils.randPick(sorted.slice(0, 4));
        Scenarios._moveTo(player, world, home.q, home.r);
        const gids = Object.keys(home.s.guilds || {}).filter(gid => Guilds.def(gid));
        const withGoods = gids.filter(gid => Guilds.def(gid).goods.length);
        const gid = Utils.randPick(withGoods.length ? withGoods : gids);
        if (!gid) return;
        const tile = world.getTile(home.q, home.r);
        const joined = Guilds.join(player, world, tile, gid);
        if (!joined.success) return;
        const m = Guilds.membership(player, home.s, gid);
        const st = Guilds.state(player);
        m.rank = Math.max(0, Math.min(2, Math.floor(_num(o.guildRank, 1))));
        m.rankSince = day;
        m.standing = _num(o.standing, 20);
        st.stats.bestRank = Math.max(_num(st.stats.bestRank, -1), m.rank);
        const g = Guilds.guild(home.s, gid);
        // The indenture: owed to the guild, paid weekly like any guild loan
        const debt = Math.max(0, Math.round(_num(o.debt)));
        if (debt > 0) {
            const weeks = Math.max(1, Math.floor(_num(o.debtWeeks, 12)));
            st.loans.push({
                id: st.nextId++, key: m.key, q: home.q, r: home.r, town: home.s.name, guild: gid,
                principal: debt, owed: debt, weekly: Math.ceil(debt / weeks), missed: 0, day, indenture: true,
            });
        }
        // A little of the guild's own goods to sell
        const good = Guilds.def(gid).goods[0];
        if (good && _num(o.stock) > 0) player.inventory[good] = _num(player.inventory[good]) + Math.floor(_num(o.stock));
        Scenarios._train(player, o);
        if (o.gold != null) player.gold = _num(o.gold);
        player.title = o.title || player.title;
        Object.assign(vars, { guild: g ? g.name : Guilds.def(gid).name, town: home.s.name, debt });
    },

    _exiledMonarch(player, world, o, vars) {
        const realms = _alive(world).filter(k => _towns(world).filter(t => t.s.kingdom === k.id).length >= 2);
        if (!realms.length) return;
        // The realm in the worst turmoil (lowest stability), the weakest on a tie
        const k = realms.slice().sort((a, b) => _num(a.stability, 60) - _num(b.stability, 60) || _num(a.military) - _num(b.military))[0];
        // In exile: the nearest town outside the realm to its capital
        const abroad = _towns(world).filter(t => t.s.kingdom !== k.id);
        const home = _nearest(world, abroad, k.capital);
        if (home) Scenarios._moveTo(player, world, home.q, home.r);
        Scenarios._train(player, o);
        if (o.gold != null) player.gold = _num(o.gold);
        player.title = `${o.title || 'Exiled Monarch'} of ${Kingdom.rulerStyle(k, player.gender).realm}`;
        player.reputation[k.id] = _num(player.reputation[k.id]) + _num(o.reputation);
        if (player.house) House.award(player.house, _num(o.prestige), 'a crown, lost', _day(world));
        const men = Scenarios._army(player, o);
        const claim = Throne.grantClaim(player, world, k.id, 'blood', _num(o.claim, 45));
        const dyn = k.characterData && k.characterData.dynasty;
        Scenarios._rival(player, world, k, dyn && dyn.name ? `House ${dyn.name}, the usurpers` : `the usurpers of ${k.name}`, o.rivalFeud);
        if (o.crisis) Throne.startCrisis(player, world, k, 'disputed', k.ruler || 'the usurper');
        Object.assign(vars, { kingdom: k.name, ruler: k.ruler || 'A usurper', claim, men, town: home ? home.s.name : '' });
        player.scenario.realm = k.id;
    },

    _pirateWidow(player, world, o, vars) {
        const ports = _towns(world).filter(t => Ships.isPortTile(world, t.q, t.r));
        if (!ports.length) return;
        const sorted = ports.slice().sort((a, b) => _dist(world, a, player) - _dist(world, b, player));
        const home = Utils.randPick(sorted.slice(0, 4));
        Scenarios._moveTo(player, world, home.q, home.r);
        const typeId = Ships.getShipType(o.ship) ? o.ship : 'sloop';
        const ship = {
            id: 'ship_' + (Ships._nextId++),
            typeId,
            name: Ships._generateShipName(),
            q: home.q, r: home.r,
            status: 'docked',
            condition: 80,
            customizations: [],
            cargo: {},
            crew: 0,
            morale: Ships._getCrewSettings().startingMorale,
            dockedAt: home.s.name,
            purchaseDay: _day(world),
            inherited: true,
        };
        ship.crew = Ships.getShipEffectiveStats(ship).crewRequired;
        if (!Array.isArray(player.ships)) player.ships = [];
        player.ships.push(ship);
        const infamy = Pirates.addInfamy(player, _num(o.infamy));
        Scenarios._train(player, o);
        if (o.gold != null) player.gold = _num(o.gold);
        player.title = (player.gender === 'male' && o.titleMale) ? o.titleMale : (o.title || player.title);
        Object.assign(vars, { ship: ship.name, town: home.s.name, infamy });
    },

    _sellsword(player, world, o, vars) {
        const towns = _towns(world).filter(t => t.s.kingdom != null && ['town', 'city'].includes(t.s.type));
        if (!towns.length) return;
        const sorted = towns.slice().sort((a, b) => _dist(world, a, player) - _dist(world, b, player));
        const home = Utils.randPick(sorted.slice(0, 4));
        Scenarios._moveTo(player, world, home.q, home.r);
        const k = _kingdomOf(world, home.s.kingdom);
        const men = Scenarios._army(player, o);
        Scenarios._train(player, o);
        if (o.gold != null) player.gold = _num(o.gold);
        player.title = o.title || player.title;
        if (k) MercContracts._addRep(player, k.id, _num(o.mercRep));
        // The company's gear, bought on the crown's credit: paid daily through Finance
        let lender = 'your creditors';
        const debt = Math.max(0, Math.round(_num(o.debt)));
        if (k && debt > 0) {
            const days = Math.max(1, Math.floor(_num(o.debtDays, 90)));
            player.loans = { ...(_obj(player.loans) || {}), [k.id]: [{ type: 'company_debt', principal: debt, totalOwed: debt, interestRate: 0, remainingDays: days, daysTaken: 0 }] };
            Finance.migrateLegacyLoans(player, world);
            const loan = Finance.state(player).loans.slice(-1)[0];
            if (loan) lender = loan.lender;
        }
        Object.assign(vars, { town: home.s.name, men: `${men} sellswords`, debt, lender });
    },

    // ── Advanced starts ─────────────────────────────────

    /** How hard the start's challenge bites: the difficulty's hostility knob (Normal 1). */
    _bite(player) {
        return Difficulty.mult(player, 'hostility');
    },

    /** Renown, Prestige, karma, stats, skills: the common part of an advanced start. */
    _standing(player, world, o, why) {
        Scenarios._train(player, o);
        if (_num(o.renown)) player.renown = _num(player.renown) + _num(o.renown);
        if (_num(o.karma)) player.karma = _num(player.karma) + _num(o.karma);
        if (player.house && _num(o.prestige) > 0) House.award(player.house, _num(o.prestige), why, _day(world));
    },

    /**
     * Men drawn out of a realm's own host into the player's army: each unit's
     * strength leaves kingdom.military (never more than it has), so nothing
     * is raised from nowhere. Returns the units' count.
     */
    _armyFromRealm(player, kingdom, spec) {
        if (!Array.isArray(player.army)) player.army = [];
        let pool = Math.max(0, Math.floor(_num(kingdom && kingdom.military)));
        let men = 0;
        for (const [type, n] of Object.entries(_obj(spec) || {})) {
            const def = PlayerMilitary.getUnitDef(type);
            if (!def) continue;
            for (let i = 0; i < Math.max(0, Math.floor(_num(n))); i++) {
                const str = _num(def.strength, 10);
                if (pool < str) break;
                pool -= str;
                player.army.push(PlayerMilitary.makeArmyUnit(def));
                men++;
            }
        }
        if (kingdom) kingdom.military = pool;
        return men;
    },

    /** The realm nearest the player with at least `min` settlements (fewer if none has so many), or null. */
    _nearestRealm(world, player, min, filter = null) {
        const towns = _towns(world);
        for (let need = min; need >= 1; need--) {
            let best = null;
            let bd = Infinity;
            for (const k of _alive(world)) {
                if (filter && !filter(k)) continue;
                if (towns.filter(t => t.s.kingdom === k.id).length < need) continue;
                const d = _dist(world, k.capital, player);
                if (d < bd) { bd = d; best = k; }
            }
            if (best) return best;
        }
        return null;
    },

    /** A neutral steward's temperament for a realm the player now runs (kingdom.lord). */
    _stewardLord(player, kingdom) {
        const ruler = Throne._playerRuler(player, kingdom);
        const ten = v => Utils.clamp(Math.round(_num(v, 8) / 2), 1, 10);
        const old = _obj(kingdom.lord) || {};
        kingdom.lord = {
            ...old,
            name: kingdom.ruler,
            kingdomId: kingdom.id,
            age: _num(player.age, 30),
            traits: [], goals: [],
            ambition: 5, honor: 6, intelligence: Utils.clamp(Math.round(_num(player.intelligence, 5)), 1, 10),
            martial: ten(ruler.skills.martial), diplomacy: ten(ruler.skills.diplomacy), stewardship: ten(ruler.skills.stewardship),
        };
        kingdom.lordModifiers = {};
    },

    /**
     * A consort and heirs for a crowned player old enough to have them (the
     * heir system's own spouse and children: Relationships). Returns
     * { spouse, children }.
     */
    _royalFamily(player, world, kingdom, o) {
        const out = { spouse: null, children: [] };
        const age = _num(player.age, 20);
        const from = _num(o.spouseFromAge, 22);
        if (age < from || player.spouse) return out;
        const Y = (Relationships._getHeirSettings().daysPerYear) || 120;
        const yearsWed = Utils.clamp(age - from + 1, 1, 15);
        const pool = (Characters.FIRST_NAMES && (Characters.FIRST_NAMES[kingdom.culture] || Characters.FIRST_NAMES.Imperial)) || null;
        const names = pool ? pool[player.gender === 'female' ? 'male' : 'female'] : null;
        const first = names && names.length ? Utils.randPick(names) : 'Rowan';
        const wed = { gender: player.gender, age, upbringing: { spouse: { kind: 'alliance', kingdomId: kingdom.id, kingdomName: kingdom.name, name: first, day: _day(world) - yearsWed * Y } } };
        const spouse = Relationships._seatHeirSpouse(player, wed, world);
        out.spouse = spouse;
        if (!spouse) return out;
        out.children = Relationships._heirsOwnChildren(player, wed, spouse, world);
        // A crown wants an heir: at least one child of the marriage
        if (!out.children.length) {
            const kid = Relationships.generateChild(player, spouse, world, { quiet: true });
            kid.age = Math.max(1, Math.min(yearsWed, 12));
            kid.birthDay = _day(world) - kid.age * Y;
            out.children.push(kid);
        }
        return out;
    },

    _monarch(player, world, o, vars) {
        const day = _day(world);
        const k = Scenarios._nearestRealm(world, player, 3);
        if (!k) return;
        const data = k.characterData;
        const old = data && data.ruler && !data.ruler.isPlayer ? data.ruler : null;
        const oldRuler = k.ruler || 'The old monarch';
        // The late monarch's eldest child (14 or more) will say the throne is theirs
        const kids = data && Array.isArray(data.children) ? data.children.filter(c => c && c.isAlive !== false) : [];
        const heirApparent = kids.filter(c => _num(c.age) >= 14).sort((a, b) => _num(b.age) - _num(a.age))[0] || null;
        // The late monarch dies: one ruler only, and it is the player
        if (old) {
            old.isAlive = false;
            old.isRuler = false;
            old.deathDay = day;
        }
        const cap = world.getTile(k.capital.q, k.capital.r);
        Scenarios._moveTo(player, world, k.capital.q, k.capital.r);
        Throne._takeThrone(player, world, k);
        Throne.state(player).ruling.inherited = true;
        Scenarios._stewardLord(player, k);
        Scenarios._standing(player, world, o, `crowned in ${k.name}`);
        Throne._log(player, world, `👑 ${oldRuler} is dead. ${k.ruler} is crowned in ${k.name}.`);
        // A royal guard out of the realm's own host
        const men = Scenarios._armyFromRealm(player, k, o.guard);
        // A consort and heirs
        const fam = Scenarios._royalFamily(player, world, k, o);
        // The court: the realm's lords swear fealty, the old officers keep their seats
        const court = Kingship.court(player);
        Kingship._generateVassals(player, world, k, court);
        court.initialized = true;
        court.lastNewVassalDay = day;
        for (const office of Kingship.OFFICES) {
            const pick = Kingship.candidates(player, world, office).find(c => c.kind === 'courtier' && !c.office);
            if (pick) Kingship.appoint(player, world, office, 'courtier', pick.id);
        }
        // The challenge: the old line's pretender and the restless great lords
        const bite = Scenarios._bite(player);
        const pv = court.vassals.find(v => v.seat) || court.vassals[0] || null;
        let pretender = null;
        if (pv) {
            if (heirApparent) {
                Object.assign(pv, { firstName: heirApparent.firstName, dynasty: heirApparent.dynasty || pv.dynasty, gender: heirApparent.gender || pv.gender, age: _num(heirApparent.age, pv.age) });
                // (the prince is a lord of the court now, no longer a royal child)
                if (data) data.children = data.children.filter(c => c !== heirApparent);
            } else if (old && old.dynasty) {
                pv.dynasty = old.dynasty; // a cousin of the old line
            }
            pv.pretender = true;
            pv.ambition = 10;
            pv.honor = Math.min(_num(pv.honor, 5), 3);
            pv.grudge = Math.round(_num(o.pretenderGrudge, -45) * bite);
            pretender = Kingship.fullName(pv);
        }
        let restless = 0;
        for (const v of court.vassals) {
            if (v === pv || _num(v.ambition) < _num(o.restlessAmbition, 6)) continue;
            v.grudge = Math.round(_num(v.grudge) + _num(o.restlessGrudge, -22) * bite);
            restless++;
        }
        for (const v of court.vassals) v.opinion = Math.round(Kingship.opinion(player, world, v).target);
        Kingship.refresh(player, world);
        // Your own realm is no rival House of yours; a neighbour backs the pretender
        if (player.house && player.house.rivals) delete player.house.rivals[k.id];
        const nb = _alive(world).filter(x => x.id !== k.id).sort((a, b) => _dist(world, a.capital, k.capital) - _dist(world, b.capital, k.capital))[0] || null;
        if (nb) {
            const dyn = nb.characterData && nb.characterData.dynasty;
            Scenarios._rival(player, world, nb, dyn && dyn.name ? `House ${dyn.name}` : nb.name, Math.round(_num(o.neighbourFeud, 35) * bite));
            if (k.relations) k.relations[nb.id] = Math.min(_num(k.relations[nb.id]), -20);
            if (nb.relations) nb.relations[k.id] = Math.min(_num(nb.relations[k.id]), -20);
        }
        player.scenario.realm = k.id;
        player.scenario.start = { kind: 'monarch', kingdomId: k.id, oldRuler, pretender, restless, guard: men, family: fam.children.length + (fam.spouse ? 1 : 0) };
        Object.assign(vars, {
            kingdom: k.name, title: player.title, oldRuler, treasury: Math.floor(_num(k.treasury)).toLocaleString('en-US'),
            army: Math.floor(_num(k.military)).toLocaleString('en-US'), lords: court.vassals.length,
            pretender: pretender || 'a cousin of the old line', neighbour: nb ? nb.name : 'no foreign power',
            town: cap && cap.settlement ? cap.settlement.name : k.name,
        });
    },

    /** The player's tenets for a world faith they lead (its virtues, as a founder's tenets). */
    _faithTenets(faith) {
        const v = (faith && faith.virtues) || {};
        const picks = [];
        if (_num(v.militancy) >= 2) picks.push('Valor');
        if (_num(v.scholarship) >= 2) picks.push('Wisdom');
        if (_num(v.unity) >= 2) picks.push('Justice');
        if (_num(v.militancy) === 0) picks.push('Peace');
        picks.push('Charity', 'Humility');
        const known = Religion.PLAYER_TENETS && Object.keys(Religion.PLAYER_TENETS).length ? Religion.PLAYER_TENETS : null;
        return [...new Set(picks)].filter(t => !known || known[t]).slice(0, 3);
    },

    _highPriest(player, world, o, vars) {
        const day = _day(world);
        const k = Scenarios._nearestRealm(world, player, 2, x => x.religion && Religion.FAITHS[x.religion.faithId]);
        if (!k) return;
        const faith = Religion.FAITHS[k.religion.faithId];
        const cap = world.getTile(k.capital.q, k.capital.r);
        if (!cap || !cap.settlement) return;
        const s = cap.settlement;
        const q = k.capital.q;
        const r = k.capital.r;
        Scenarios._moveTo(player, world, q, r);
        Scenarios._standing(player, world, o, `raised to head ${faith.name}`);
        const title = (player.gender === 'male' && o.titleMale) ? o.titleMale : (o.title || 'High Priest');
        player.title = `${title} of ${faith.name}`;
        // The see: the faith, led. Every faith panel and leader action reads player.religion
        player.religion = {
            name: faith.name,
            worldFaithId: faith.id,
            tenets: Scenarios._faithTenets(faith),
            followers: 0, buildings: [], influence: 0, founded: false, presence: {},
            see: { kingdomId: k.id, q, r, town: s.name, since: day },
            titheShare: _num(o.titheShare, 0.15), titheRevenueShare: _num(o.titheRevenueShare, 0.03), titheTotal: 0,
        };
        const rel = player.religion;
        // The great temple: the realm's own cathedral passes to the see, if it raised one
        const temples = Array.isArray(k.temples) ? k.temples : [];
        const ti = temples.findIndex(t => t && t.type === 'cathedral');
        if (ti >= 0) temples.splice(ti, 1);
        const def = PlayerReligion.BUILDING_TYPES.TEMPLE;
        cap.religiousBuilding = {
            type: def.id, name: `Great Temple of ${s.name}`, icon: def.icon, religion: rel.name,
            faithGain: def.faithGain, influenceRadius: def.influenceRadius, karmaBonus: 0, scholarshipBonus: 0,
            incomeBonus: 0, renownPerDay: 0, followers: 0, level: 1,
            underConstruction: false, constructionDaysLeft: 0, constructionDaysTotal: 0, see: true,
        };
        rel.buildings.push({ q, r, type: def.id, see: true });
        // The flock: the holy city devoted, the realm's other towns a share by its piety
        const piety = Utils.clamp(_num(k.religion.piety, 50) / 100, 0, 1);
        let followers = 0;
        for (const t of _towns(world)) {
            if (t.s.kingdom !== k.id) continue;
            const seat = t.q === q && t.r === r;
            const share = seat ? _num(o.seatShare, 0.45) : _num(o.realmShare, 0.15) * (0.5 + piety);
            rel.presence[`${t.q},${t.r}`] = Math.round(Math.min(0.9, share) * 1000) / 1000;
            // (the faithful who come to the see's own altar: its followers, who give alms)
            if (seat) followers += Math.floor(_num(t.s.population) * share * _num(o.followerShare, 0.1));
        }
        rel.followers = followers;
        cap.religiousBuilding.followers = followers;
        rel.influence = Math.floor(followers / 100);
        // The clergy know their head (Devotion standing with the faith)
        const dv = Devotion.state(player);
        dv.faithId = faith.id;
        dv.faithSince = day;
        dv.standing[faith.id] = Math.max(_num(dv.standing[faith.id]), _num(o.faithStanding, 60));
        // The ear of kings: every realm of the faith
        for (const x of _alive(world)) {
            if (x.religion && x.religion.faithId === faith.id) player.reputation[x.id] = _num(player.reputation[x.id]) + _num(o.reputation);
        }
        // The church's estates nearest the see are the see's: their rents are the faith's coffers
        let estates = 0;
        if (Estates.enabled()) {
            Estates.derive(world, day);
            const church = [];
            for (const t of _towns(world)) {
                if (t.s.kingdom !== k.id) continue;
                for (const e of Estates.estatesOf(world, t.q, t.r)) {
                    if (e.holder === `church:${k.id}`) church.push({ e, d: _dist(world, t, { q, r }) });
                }
            }
            church.sort((a, b) => a.d - b.d || String(a.e.id).localeCompare(String(b.e.id)));
            for (const { e } of church.slice(0, Math.max(0, Math.floor(_num(o.churchEstates, 3))))) {
                LandMarket._setHolder(world, e, 'player', day);
                e.church = true;
                estates++;
            }
        }
        // The challenge: a heresy loose in the see's realm, and a zealous rival faith
        const bite = Scenarios._bite(player);
        Religion.spawnHeresy(k, world);
        const heresy = Religion.strongestHeresy(k);
        if (heresy) heresy.strength = Math.max(_num(heresy.strength), Math.round(_num(o.heresyStrength, 28) * bite));
        const militancy = x => _num(Religion.FAITHS[x.religion.faithId].virtues && Religion.FAITHS[x.religion.faithId].virtues.militancy);
        const zealots = _alive(world).filter(x => x.id !== k.id && x.religion && x.religion.faithId !== faith.id && Religion.FAITHS[x.religion.faithId])
            .sort((a, b) => militancy(b) - militancy(a) || _dist(world, a.capital, k.capital) - _dist(world, b.capital, k.capital))[0] || null;
        let rival = null;
        if (player.house && player.house.rivals) delete player.house.rivals[k.id];
        if (zealots) {
            const zf = Religion.FAITHS[zealots.religion.faithId];
            rival = `${zf.name} of ${zealots.name}`;
            const dyn = zealots.characterData && zealots.characterData.dynasty;
            Scenarios._rival(player, world, zealots, dyn && dyn.name ? `House ${dyn.name}, zealots of ${zf.name}` : `the zealots of ${zealots.name}`, Math.round(_num(o.rivalFeud, 35) * bite));
            player.reputation[zealots.id] = Math.min(_num(player.reputation[zealots.id]), -15);
        }
        player.scenario.realm = k.id;
        player.scenario.start = { kind: 'high_priest', kingdomId: k.id, faithId: faith.id, seat: { q, r, town: s.name }, estates, heresy: heresy ? heresy.name : null };
        Object.assign(vars, {
            title, faith: faith.name, temple: cap.religiousBuilding.name,
            town: s.name, kingdom: k.name, heresy: heresy ? heresy.name : 'heresy', rival: rival || 'the unbelievers', estates,
            estatesLine: estates > 0 ? `, and ${estates === 1 ? 'a church estate pays its rents' : `${estates} church estates pay their rents`} into its coffers` : '',
        });
    },

    _greatLord(player, world, o, vars) {
        const day = _day(world);
        const k = Scenarios._nearestRealm(world, player, 2);
        if (!k) return;
        const isCap = t => t.q === k.capital.q && t.r === k.capital.r;
        const mine = _towns(world).filter(t => t.s.kingdom === k.id);
        const seat = mine.filter(t => !isCap(t)).sort((a, b) => _num(b.s.population) - _num(a.s.population))[0] || mine[0] || null;
        if (!seat) return;
        Scenarios._moveTo(player, world, seat.q, seat.r);
        Scenarios._standing(player, world, o, `head of a great house of ${k.name}`);
        const title = (player.gender === 'male' && o.titleMale) ? o.titleMale : (o.title || 'Lord');
        player.title = `${title} of ${seat.s.name}`;
        player.allegiance = k.id;
        player.reputation[k.id] = _num(player.reputation[k.id]) + _num(o.reputation);
        // The realm's greatest noble house's estates are the player's
        let estates = 0;
        if (Estates.enabled()) {
            Estates.derive(world, day);
            const st = Estates.state(world);
            const counts = {};
            for (const e of Object.values(st.estates)) {
                if (!e || Estates.kindOf(e.holder) !== 'noble') continue;
                const h = Estates.ensureHolder(world, e.holder);
                if (String(h.kid) !== String(k.id)) continue;
                counts[e.holder] = (counts[e.holder] || 0) + 1;
            }
            // (the seat's own noble house first on a tie)
            const atSeat = new Set(Estates.estatesOf(world, seat.q, seat.r).map(e => e.holder));
            const house = Object.keys(counts).sort((a, b) => counts[b] - counts[a]
                || (atSeat.has(b) ? 1 : 0) - (atSeat.has(a) ? 1 : 0) || a.localeCompare(b))[0];
            if (house) {
                for (const e of Estates.heldBy(world, house)) {
                    LandMarket._setHolder(world, e, 'player', day);
                    estates++;
                }
            }
        }
        // Household knights who rode in the realm's host
        const men = Scenarios._armyFromRealm(player, k, o.retinue);
        // A cadet line of the blood
        const claim = Throne.grantClaim(player, world, k.id, 'blood', _num(o.claim, 20));
        // The crown fears an overmighty subject
        const dyn = k.characterData && k.characterData.dynasty;
        Scenarios._rival(player, world, k, dyn && dyn.name ? `House ${dyn.name}, the crown` : `the crown of ${k.name}`, Math.round(_num(o.crownFeud, 30) * Scenarios._bite(player)));
        player.scenario.realm = k.id;
        player.scenario.start = { kind: 'great_lord', kingdomId: k.id, seat: { q: seat.q, r: seat.r, town: seat.s.name }, estates, retinue: men };
        Object.assign(vars, { title, town: seat.s.name, kingdom: k.name, estates, claim, ruler: k.ruler || 'The crown' });
    },

    _guildmaster(player, world, o, vars) {
        const day = _day(world);
        const cands = [];
        for (const t of _towns(world)) {
            if (!['city', 'capital', 'town'].includes(t.s.type)) continue;
            if (!Number.isFinite(t.s.q)) { t.s.q = t.q; t.s.r = t.r; }
            if (Guilds.ensureTown(world, t.s, day)) cands.push(t);
        }
        if (!cands.length) return;
        // The greatest guild towns, then the nearest of them to where the road began
        const rank = { capital: 0, city: 1, town: 2 };
        const home = cands.slice().sort((a, b) => (rank[a.s.type] - rank[b.s.type]) || (_dist(world, a, player) - _dist(world, b, player)))
            .slice(0, 6).sort((a, b) => _dist(world, a, player) - _dist(world, b, player))[0];
        Scenarios._moveTo(player, world, home.q, home.r);
        const gids = Object.keys(home.s.guilds || {}).filter(gid => Guilds.def(gid));
        const gid = gids.slice().sort((a, b) => _num(Guilds.guild(home.s, b).treasury) - _num(Guilds.guild(home.s, a).treasury) || a.localeCompare(b))[0];
        if (!gid) return;
        const tile = world.getTile(home.q, home.r);
        // The entry fee goes into the hall, as anyone's does
        const joined = Guilds.join(player, world, tile, gid);
        if (!joined.success) return;
        const g = Guilds.guild(home.s, gid);
        const m = Guilds.membership(player, home.s, gid);
        const st = Guilds.state(player);
        m.rank = 3;
        m.rankSince = day;
        m.standing = _num(o.standing, 45);
        st.stats.bestRank = Math.max(_num(st.stats.bestRank, -1), 3);
        const before = g.master ? g.master.name : null;
        g.master = { name: player.name || 'you', player: true };
        g.nextElection = day + Math.max(7, Math.floor(_num(o.electionDays, 45)));
        Guilds._log(st, world, `Elected guildmaster of the ${g.name}${before ? `, after ${before}` : ''}.`);
        const goods = Guilds.def(gid).goods || [];
        if (goods[0] && _num(o.stock) > 0) player.inventory[goods[0]] = _num(player.inventory[goods[0]]) + Math.floor(_num(o.stock));
        Scenarios._standing(player, world, o, `elected master of the ${g.name}`);
        player.title = `${o.title || 'Guildmaster'} of the ${g.name}`;
        const cand = Guilds.candidates(home.s, g);
        player.scenario.start = { kind: 'guildmaster', town: home.s.name, q: home.q, r: home.r, guild: gid };
        Object.assign(vars, { guild: g.name, town: home.s.name, treasury: Math.floor(_num(g.treasury)).toLocaleString('en-US'), election: g.nextElection, challenger: cand.challenger });
    },

    /**
     * The General: a commission (player/generalship.js) as General in a realm
     * at war (or, if none is, one at daggers drawn with a neighbour), its host
     * a share of the realm's own army, camped at the border town facing the
     * enemy with grain drawn from its granary (the crown paying), lieutenants,
     * a rival at court and the crown's first orders.
     */
    _general(player, world, o, vars) {
        if (!Generalship.enabled()) return;
        const G = Generalship.config().start || {};
        const towns = _towns(world);
        const big = k => towns.filter(t => t.s.kingdom === k.id).length >= 2;
        const foesOf = k => (k.wars || []).map(id => _kingdomOf(world, id)).filter(e => e && e.isAlive !== false && e.capital);
        let k = Scenarios._nearestRealm(world, player, 2, x => big(x) && foesOf(x).length > 0);
        let enemy = k && foesOf(k).length ? foesOf(k).sort((a, b) => _dist(world, a.capital, k.capital) - _dist(world, b.capital, k.capital))[0] : null;
        if (!k || !enemy) {
            // No war yet: a realm and the neighbour it hates most, near enough to war
            k = Scenarios._nearestRealm(world, player, 2, big);
            if (!k) return;
            enemy = _alive(world).filter(e => e.id !== k.id)
                .sort((a, b) => _num(k.relations && k.relations[a.id]) - _num(k.relations && k.relations[b.id]) || _dist(world, a.capital, k.capital) - _dist(world, b.capital, k.capital))[0] || null;
            if (enemy) {
                const rel = _num(G.relations, -45);
                k.relations = k.relations || {};
                enemy.relations = enemy.relations || {};
                k.relations[enemy.id] = Math.min(_num(k.relations[enemy.id]), rel);
                enemy.relations[k.id] = Math.min(_num(enemy.relations[k.id]), rel);
            }
        }
        const atWar = !!(enemy && (k.wars || []).includes(enemy.id));
        // Camp at the realm's town nearest the enemy
        const mine = towns.filter(t => t.s.kingdom === k.id);
        const camp = enemy
            ? mine.slice().sort((a, b) => Generalship.distanceTo(world, a, enemy) - Generalship.distanceTo(world, b, enemy))[0]
            : mine[0];
        if (!camp) return;
        Scenarios._moveTo(player, world, camp.q, camp.r);
        Scenarios._standing(player, world, o, `commissioned General of ${k.name}`);
        player.reputation[k.id] = _num(player.reputation[k.id]) + _num(o.reputation);
        const bite = Scenarios._bite(player);
        const c = Generalship._grant(player, world, k, {
            rank: _num(G.rank, 2), merit: _num(G.merit, 90), favour: Math.round(_num(G.favour, 55) / Math.max(0.5, bite)),
            morale: _num(G.morale, 65), veterancy: _num(G.veterancy, 0.15), lieutenants: 3,
            rivalInfluence: Math.round(_num(G.rivalInfluence, 40) * bite),
        });
        Generalship._supplyFrom(player, world, c, camp.s, { days: _num(G.supplyDays, 12) });
        // The enemy knows the general's name
        if (enemy) Scenarios._rival(player, world, enemy, `the crown of ${enemy.name}`, Math.round(_num(o.enemyFeud, 25) * bite));
        // The crown's first orders
        c.nextOrderDay = _day(world);
        Generalship._issueOrder(player, world, c, { notices: [] });
        player.scenario.realm = k.id;
        player.scenario.start = { kind: 'general', kingdomId: k.id, enemyId: enemy ? enemy.id : null, town: camp.s.name, q: camp.q, r: camp.r, men: c.men, atWar };
        Object.assign(vars, {
            rank: Generalship.rankDef(c).name, kingdom: k.name, ruler: k.ruler || 'The crown', men: c.men, town: camp.s.name,
            enemy: enemy ? enemy.name : 'its enemies', rival: c.rival ? c.rival.name : 'a rival',
            warLine: atWar ? `${k.name} is at war with ${enemy.name}.` : `${k.name} and ${enemy ? enemy.name : 'its neighbours'} are at daggers drawn: war is coming.`,
            order: c.order ? c.order.text : 'Hold the marches.',
        });
    },

    /**
     * Shape the new player by their Origin and record the scenario.
     * opts: { origin, difficulty, victory, guidedStart }. Unknown ids fall
     * back to the Wanderer / Normal / no goal. Returns { origin, welcome }.
     * Call once, after House / Titles / Councils setup, before any onboarding.
     */
    apply(player, world, opts = {}) {
        const origin = Scenarios.origin(opts.origin) || Scenarios.origin('wanderer');
        const difficulty = Difficulty.levels()[opts.difficulty] ? opts.difficulty : Difficulty.DEFAULT_KEY;
        const victory = Victory.def(opts.victory) ? opts.victory : 'none';
        player.scenario = {
            id: origin.id,
            difficulty,
            victory,
            guidedStart: typeof opts.guidedStart === 'boolean' ? opts.guidedStart : origin.guidedStart !== false,
            victoryAchieved: null,
            startDay: _day(world),
        };
        const totalTiles = world ? _num(world.width) * _num(world.height) : 0;
        const vars = {
            mapDesc: totalTiles > 40000 ? 'vast' : totalTiles > 15000 ? 'large' : 'ready',
            kingdoms: world && world.kingdoms ? world.kingdoms.length : 0,
            name: player.name,
        };
        const shape = {
            disinherited: Scenarios._disinherited,
            apprentice: Scenarios._apprentice,
            exiled_monarch: Scenarios._exiledMonarch,
            pirate_widow: Scenarios._pirateWidow,
            sellsword: Scenarios._sellsword,
            monarch: Scenarios._monarch,
            high_priest: Scenarios._highPriest,
            great_lord: Scenarios._greatLord,
            guildmaster: Scenarios._guildmaster,
            general: Scenarios._general,
        }[origin.id];
        // The origin's purse (data/scenarios.json `gold`); the shapes below may set their own
        if (origin.gold != null) player.gold = _num(origin.gold);
        if (shape && world) {
            shape(player, world, origin, vars);
            if (typeof player.updateVisibility === 'function') player.updateVisibility(world, 4);
        }
        // The difficulty's purse (Normal: untouched)
        const gm = Difficulty.mult(player, 'startGold');
        if (gm !== 1) player.gold = Math.max(0, Math.round(_num(player.gold) * gm));
        const welcome = String(origin.welcome || FALLBACK.wanderer.welcome)
            .replace(/\{(\w+)\}/g, (m, key) => (vars[key] != null ? String(vars[key]) : m));
        return { origin: origin.id, name: origin.name, icon: origin.icon, welcome };
    },
};
