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
            origins: Object.values(Scenarios.origins()).map(o => ({ id: o.id, name: o.name, icon: o.icon, blurb: o.blurb, suggestedVictory: o.suggestedVictory || 'none', guidedStart: o.guidedStart !== false })),
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
        player.title = `${o.title || 'Exiled Monarch'} of ${k.name}`;
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
