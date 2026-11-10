// ============================================
// AFTERLIFE — what happens when the player dies
// ============================================
// Three ways on (ui/actionMenu/afterlife.js draws them):
//   - an adult heir takes up the mantle (Relationships.succeedAsHeir);
//   - a new life: the player becomes someone else living in the world, a
//     townsperson of a town they knew or a local of one they didn't. The
//     late ruler's House ends and what it held passes to crowns and towns;
//   - the interregnum: the world turns on without the player — kingdoms,
//     wars, markets, towns, rivals' banks and caravans — while the House is
//     held in trust and its children grow up. The player jumps back in when
//     they like, as an heir who has come of age or as someone new.
//
// While waiting, the dead player object is the House's estate in trust:
// `player.interregnum = { since, cause, name }` (saved with the player).
// Nothing of the player's own runs (no ailments, upkeep, letters or quests);
// the world's systems run as they do in ui/game/endDay.js, with no player.
// Strangers and their stations are tuned in data/afterlife.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Difficulty } from '../core/difficulty.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { Relationships } from '../systems/relationships.js';
import { Upbringing } from '../systems/upbringing.js';
import { HeirAgency } from '../systems/heirAgency.js';
import { Legacy } from '../systems/legacy.js';
import { Annals } from '../systems/annals.js';
import { House } from '../systems/house.js';
import { Quests } from '../systems/quests.js';
import { Achievements } from '../systems/achievements.js';
import { Technology } from '../systems/technology.js';
import { Titles } from '../systems/titles.js';
import { Councils } from '../systems/councils.js';
import { Estates } from '../world/estates.js';
import { Concessions } from '../systems/concessions.js';
import { Fiscal } from '../systems/fiscal.js';
import { Demands } from '../systems/demands.js';
import { Delves } from '../systems/delves.js';
import { Sagas } from '../systems/sagas.js';
import { Whispers } from '../systems/whispers.js';
import { Couriers } from '../systems/couriers.js';
import { CourierRiders } from '../systems/courierRiders.js';
import { Hospitality } from '../systems/hospitality.js';
import { OutlawLairs } from '../systems/outlawLairs.js';
import { Lots } from '../systems/lots.js';
import { Graveyards } from '../systems/graveyards.js';
import { Discovery } from '../systems/discovery.js';
import { Pirates } from '../systems/pirates.js';
import { RealmWars } from '../systems/realmWars.js';
import { HoldingSieges } from '../systems/holdingSieges.js';
import { Throne } from '../systems/throne.js';
import { Kingship } from '../systems/kingship.js';
import { Sieges } from '../systems/sieges.js';
import { MerchantHouses } from '../systems/merchantHouses.js';
import { Patronage } from '../systems/patronage.js';
import { Heralds } from '../systems/heralds.js';
import { MerchantCaravans } from '../systems/merchantCaravans.js';
import { MarketFairs } from '../systems/marketFairs.js';
import { Harvests } from '../world/harvests.js';
import { Engrossing } from '../systems/engrossing.js';
import { LandMarket } from '../systems/landMarket.js';
import { PuttingOut } from '../systems/puttingOut.js';
import { TradePolicy } from '../systems/tradePolicy.js';
import { PublicWorks } from '../systems/publicWorks.js';
import { MarketDynamics } from '../systems/marketDynamics.js';
import { Labour } from '../systems/labour.js';
import { MerchantPrince } from '../systems/merchantPrince.js';
import { Guilds } from '../systems/guilds.js';
import { EconomyChronicle } from '../systems/economyChronicle.js';
import { Finance } from '../systems/finance.js';
import { Underwriting } from '../systems/underwriting.js';
import { Bills } from '../systems/bills.js';
import { Bourse } from '../systems/bourse.js';
import { Mints } from '../systems/mints.js';
import { Player } from './player.js';
import { DawnBirth } from './dawnBirth.js';
import { Dawn } from '../world/dawn.js';
import { Characters } from '../world/characters.js';
import { Cultures } from '../world/cultures.js';
import { Languages } from '../systems/languages.js';

const DEFAULTS = {
    candidates: 4,
    minAge: 17,
    maxAge: 42,
    autoPlayMs: 220,
    roleWeights: { villager: 4, farmer: 3, merchant: 1.4, guard: 1.4, blacksmith_npc: 1, priest: 0.6, noble: 0.35 },
    stations: {
        villager: { title: 'Commoner', gold: [60, 220], stats: { strength: 1 }, skills: {} },
    },
};

/** Station fields a stranger may start with. */
const STAT_KEYS = ['strength', 'charisma', 'intelligence', 'faith', 'luck'];
const SKILL_KEYS = ['commerce', 'combat', 'leadership', 'diplomacy', 'stealth', 'cartography'];

function _obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }
function _num(v, d = 0) { return typeof v === 'number' && isFinite(v) ? v : d; }

/**
 * The world's day without the player: every system of ui/game/endDay.js
 * that keeps the world itself turning, in the same order, given no player.
 * (Keep in step with endDay.js. Left out: the player's own — ailments,
 * ships, housing, construction, letters, schemes, rivals, quests, spies,
 * gossip, taxes, the ledger.)
 */
const WORLD_DAY = [
    (w) => Townsfolk.processDay(w, null),
    (w) => Lots.processDay(w, null),
    (w) => Graveyards.processDay(w, null),
    (w) => Demands.processDay(w, null),
    (w) => Delves.processDay(w, null),
    (w) => Sagas.processDay(w, null),
    (w) => Whispers.processDay(w, null),
    (w) => Couriers.processDay(w, null),
    (w) => CourierRiders.processDay(w, null),
    (w) => Hospitality.processDay(w, null),
    (w) => OutlawLairs.processDay(w, null),
    (w) => Discovery.processDay(w, null),
    (w) => Pirates.processDay(w, null),
    (w) => RealmWars.processDaily(null, w),
    (w) => HoldingSieges.processDay(w, null),
    (w) => Throne.processDaily(null, w, { armyStrength: 0 }),
    (w) => Kingship.processDay(w, null),
    (w) => Sieges.processDay(w, null),
    (w) => MerchantHouses.processDay(null, w),
    (w) => Patronage.processDay(w, null),
    (w) => Heralds.processDay(w, null),
    (w) => MerchantCaravans.processDay(w, null),
    (w) => MarketFairs.processDay(w, null),
    (w) => Harvests.processDay(w, null),
    (w) => Engrossing.processDay(w, null),
    (w) => Concessions.processDay(w, null),
    (w) => LandMarket.processDay(w, null),
    (w) => PuttingOut.processDay(w, null),
    (w) => TradePolicy.processDay(w, null),
    (w) => PublicWorks.processDay(w, null),
    (w) => MarketDynamics.updatePrices(w, null),
    (w) => Labour.processDay(w, null),
    (w) => MerchantPrince.processDay(null, w),
    (w) => Guilds.processDay(w, null),
    (w) => EconomyChronicle.processDay(w, null),
    (w) => Fiscal.processDay(w, null),
    (w) => Finance.processDay(w, null),
    (w) => Underwriting.processDay(w, null),
    (w) => Bills.processDay(w, null),
    (w) => Bourse.processDay(w, null),
    (w) => Mints.processDay(w, null),
];

export const Afterlife = {
    config() {
        const src = _obj(DataLoader._gamedata && DataLoader._gamedata.afterlife) || {};
        return {
            ...DEFAULTS, ...src,
            roleWeights: { ...DEFAULTS.roleWeights, ...(_obj(src.roleWeights) || {}) },
            stations: { ...DEFAULTS.stations, ...(_obj(src.stations) || {}) },
        };
    },

    /** Is the player waiting out an interregnum? */
    active(player) {
        return !!(player && player.interregnum);
    },

    // ── The interregnum ─────────────────────────────────

    /**
     * The player chose to let time pass. The late ruler's reign is filed now
     * (so the chronicle dates it to the death, not the return); their
     * soldiers, sellswords and companions go their own ways; travel stops.
     * @returns {{ disbanded: number, companions: number }}
     */
    begin(player, world, cause = null) {
        if (!player || player.interregnum) return { disbanded: 0, companions: 0 };
        const day = _num(world && world.day);
        if (player.house && player.house.currentReign) Legacy.closeReign(player, world, { cause });
        const disbanded = (player.army || []).length;
        player.army = [];
        player.mercenaryCompanies = [];
        player.activeContract = null;
        const companions = (player.travelParty || []).length;
        player.travelParty = [];
        player.path = null;
        player.queuedPath = null;
        player.autoChart = null;
        player.travelDestination = null;
        player.isMoving = false;
        player.boardedShip = null;
        player.interregnum = { since: day, cause: cause || 'old age', name: player.name };
        return { disbanded, companions };
    },

    /**
     * One day of the world without the player. The House in trust: its
     * children grow up (Upbringing settles their childhood days by default).
     * @returns {{ day, events: object[], cameOfAge: object[] }}
     */
    passDay(world, estate) {
        const out = { day: 0, events: [], cameOfAge: [] };
        if (!world) return out;
        const held = typeof world.holdSettlementScan === 'function';
        if (held) world.holdSettlementScan();
        try {
            const result = world.advanceDay(null, {});
            if (result && Array.isArray(result.events)) out.events.push(...result.events);
            for (const step of WORLD_DAY) step(world);
            if (estate) {
                const Y = Relationships._getHeirSettings().daysPerYear;
                if (Y > 0 && world.day % Y === 0) Relationships.ageChildren(estate, world);
                const up = Upbringing.processDay(estate, world);
                // Children abroad come home, betrothals are kept, embassies end (systems/heirAgency.js)
                HeirAgency.processDay(estate, world);
                out.cameOfAge.push(...(up.comeOfAge || []));
            }
        } finally {
            if (held && world._scanHolds > 0) world.releaseSettlementScan();
        }
        out.day = world.day;
        return out;
    },

    /** Children of the House who could take up the mantle now. */
    heirsReady(estate) {
        return estate ? Relationships.getEligibleHeirs(estate) : [];
    },

    /** Living children still too young: [{ child, years }] — years until they may play. */
    futureHeirs(estate) {
        if (!estate || !Array.isArray(estate.children)) return [];
        const min = Relationships._getHeirSettings().minAgeToPlay;
        return estate.children
            .filter(c => c.isAlive && _num(c.age) < min)
            .map(child => ({ child, years: min - _num(child.age) }))
            .sort((a, b) => a.years - b.years);
    },

    /** Years (in the game's reckoning) since the interregnum began. */
    yearsWaited(player, world) {
        const it = player && player.interregnum;
        if (!it || !world) return 0;
        const Y = Relationships._getHeirSettings().daysPerYear || 120;
        return Math.floor((_num(world.day) - _num(it.since)) / Y);
    },

    /** Take up the mantle as an heir after the wait (succession as on the death screen). */
    returnAsHeir(estate, world, childId, opts = {}) {
        const cause = estate && estate.interregnum ? estate.interregnum.cause : null;
        const res = Relationships.succeedAsHeir(estate, childId, world, { cause, ...opts });
        if (res.success) {
            delete estate.interregnum;
            estate._isDead = false;
        }
        return res;
    },

    // ── A new life ──────────────────────────────────────

    /**
     * People the player could become: grown townsfolk of the towns with a
     * roster, and locals of the towns without one. Deterministic for a world,
     * day and `reroll` count; draws nothing from the shared RNG.
     * @returns {object[]} [{ key, first, last, gender, age, role, station, title, q, r, town, kingdom, folkId, gold }]
     */
    candidates(world, reroll = 0) {
        const C = Afterlife.config();
        const T = Townsfolk.config();
        if (!world || typeof world.getSettlementViews !== 'function') return [];
        const seed = (world.generationParams && world.generationParams.seed) || 1;
        let s = (Utils.hashStr(`${seed}|afterlife|${_num(world.day)}|${reroll}`) >>> 0) || 1;
        const rng = () => {
            s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
            return s / 4294967296;
        };
        const pick = arr => (arr && arr.length ? arr[Math.floor(rng() * arr.length)] : null);
        // At the Dawn of Man nobody comes from nowhere: a new life is born into a clan
        if (Dawn.isActive(world)) {
            const born = Afterlife._dawnCandidates(world, C, rng, pick);
            if (born.length) return born;
        }
        const towns = world.getSettlementViews()
            .map(v => ({ v, live: world.getTile(v.q, v.r) && world.getTile(v.q, v.r).settlement }))
            .filter(t => t.live && _num(t.live.population) > 0);
        if (!towns.length) return [];
        const weighted = towns.map(t => Math.sqrt(_num(t.live.population, 100)));
        const total = weighted.reduce((a, b) => a + b, 0);
        const pickTown = () => {
            let roll = rng() * total;
            for (let i = 0; i < towns.length; i++) { roll -= weighted[i]; if (roll <= 0) return towns[i]; }
            return towns[towns.length - 1];
        };
        const roleOf = (role) => (C.stations[role] ? role : 'villager');
        const day = _num(world.day);
        const out = [];
        const used = new Set();
        for (let tries = 0; out.length < C.candidates && tries < C.candidates * 12; tries++) {
            const { v, live } = pickTown();
            const kingdom = live.kingdom != null && typeof world.getKingdom === 'function' ? world.getKingdom(live.kingdom) : null;
            const base = { q: v.q, r: v.r, town: live.name, townType: live.type, kingdom: kingdom ? kingdom.name : null };
            let person = null;
            const folk = _obj(live.folk) && Array.isArray(live.folk.people) ? live.folk : null;
            if (folk) {
                const grown = Townsfolk.residents(folk).filter(p => {
                    const a = Townsfolk.age(p, day);
                    return a >= C.minAge && a <= C.maxAge && p.role !== 'child' && !used.has(`${v.q},${v.r}#${p.id}`);
                });
                const p = pick(grown);
                if (p) {
                    used.add(`${v.q},${v.r}#${p.id}`);
                    person = { first: p.first, last: p.last, gender: p.gender, age: Townsfolk.age(p, day), role: roleOf(p.retired || p.role), folkId: p.id };
                }
            }
            if (!person) {
                const gender = rng() < 0.5 ? 'male' : 'female';
                const roles = Object.entries(C.roleWeights).filter(([r, w]) => w > 0 && C.stations[r]);
                const wsum = roles.reduce((a, [, w]) => a + w, 0);
                let roll = rng() * wsum;
                let role = 'villager';
                for (const [r, w] of roles) { roll -= w; if (roll <= 0) { role = r; break; } }
                person = {
                    first: pick(T.names[gender]) || 'Wren',
                    last: pick(T.lastNames) || 'Hayward',
                    gender,
                    age: C.minAge + Math.floor(rng() * (C.maxAge - C.minAge + 1)),
                    role,
                    folkId: null,
                };
            }
            const st = C.stations[person.role] || C.stations.villager;
            const g = Array.isArray(st.gold) ? st.gold : [100, 200];
            out.push({
                key: `${v.q},${v.r}#${person.folkId != null ? person.folkId : `n${out.length}`}`,
                ...person, ...base,
                station: person.role,
                title: st.title || Townsfolk.title(person.role, person.gender),
                gold: Math.round(_num(g[0], 100) + rng() * (_num(g[1], 200) - _num(g[0], 100))),
            });
        }
        return out;
    },

    // ── A new life in a place of one's choosing ─────────

    /**
     * Every place a new life may begin, for the "Choose a settlement" list:
     * the living towns and villages (at the Dawn of Man, the villages clans
     * founded and the clans still wandering). Sorted by realm (the free lands
     * last), then largest first.
     * @returns {object[]} [{ id, q, r, name, type, population, kingdom, kingdomId, capital, culture, language, languageName, folk, clanId? }]
     */
    townChoices(world) {
        if (!world || typeof world.getSettlementViews !== 'function') return [];
        const day = _num(world.day);
        const minAge = Afterlife.config().minAge;
        const dawn = Dawn.isActive(world);
        const out = [];
        for (const v of world.getSettlementViews()) {
            const tile = world.getTile(v.q, v.r);
            const live = tile && tile.settlement;
            if (!live || _num(live.population) <= 0) continue;
            if (dawn && !live.dawnBorn) continue;
            const k = live.kingdom != null && typeof world.getKingdom === 'function' ? world.getKingdom(live.kingdom) : null;
            const culture = Cultures.cultureOf(world, live);
            const lang = Cultures.languageOfCulture(culture);
            const folk = _obj(live.folk) && Array.isArray(live.folk.people) ? live.folk : null;
            out.push({
                id: `${v.q},${v.r}`, q: v.q, r: v.r, name: live.name, type: live.type || 'village',
                population: Math.round(_num(live.population)),
                kingdom: k ? k.name : null, kingdomId: k ? k.id : null,
                capital: !!(k && k.capital && k.capital.q === v.q && k.capital.r === v.r),
                culture, language: lang, languageName: lang ? Cultures.languageName(lang) : null,
                folk: folk ? Townsfolk.residents(folk).filter(p => Townsfolk.age(p, day) >= minAge).length : null,
            });
        }
        if (dawn) {
            for (const u of world.units || []) {
                if (u.type !== 'clan' || u.destroyed) continue;
                const lang = Cultures.languageOfCulture(u.culture);
                out.push({
                    id: `clan:${u.id}`, clanId: u.id, q: u.q, r: u.r, name: u.name, type: 'clan',
                    population: Math.round(_num(u.population)), kingdom: null, kingdomId: null, capital: false,
                    culture: u.culture || null, language: lang, languageName: lang ? Cultures.languageName(lang) : null, folk: null,
                });
            }
        }
        out.sort((a, b) => {
            if (!a.kingdom !== !b.kingdom) return a.kingdom ? -1 : 1;
            if (a.kingdom !== b.kingdom) return String(a.kingdom).localeCompare(String(b.kingdom));
            return b.population - a.population || String(a.name).localeCompare(String(b.name));
        });
        return out;
    },

    /** The townChoices entry at hex (q, r): a settlement, else (at the dawn) a clan camped there. */
    townChoiceAt(world, q, r) {
        const all = Afterlife.townChoices(world);
        return all.find(t => t.clanId == null && t.q === q && t.r === r) || all.find(t => t.q === q && t.r === r) || null;
    },

    /**
     * People the player could become in one chosen place (`at`: a
     * townChoices entry, or { q, r } / { clanId }): grown townsfolk of its
     * own roster first (a roster is seeded for a town never walked through),
     * then locals with its culture's names, and one newcomer arriving from
     * elsewhere with a mother tongue of their own. Same ages, stations and
     * purses as `candidates`; at the Dawn of Man, children born into that
     * clan or village. Deterministic for a world, place, day and `reroll`;
     * draws nothing from the shared RNG.
     * @returns {object[]} as `candidates`, each with `chosen: true`, `culture`,
     *   `native` (mother tongue), `kin` (family in town) and, for the arrival,
     *   `newcomer: { from, culture }`
     */
    candidatesAt(world, at, reroll = 0) {
        if (!world || !at || typeof world.getSettlementViews !== 'function') return [];
        const C = Afterlife.config();
        const seed = (world.generationParams && world.generationParams.seed) || 1;
        const where = at.clanId != null ? `clan:${at.clanId}` : `${at.q},${at.r}`;
        let s = (Utils.hashStr(`${seed}|afterlife-at|${where}|${_num(world.day)}|${reroll}`) >>> 0) || 1;
        const rng = () => {
            s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
            return s / 4294967296;
        };
        const pick = arr => (arr && arr.length ? arr[Math.floor(rng() * arr.length)] : null);

        // At the Dawn of Man: born into the clan or village chosen
        if (Dawn.isActive(world)) {
            const home = Afterlife._dawnHomes(world).find(h => (at.clanId != null
                ? h.clan && h.clan.id === at.clanId
                : !h.clan && h.q === at.q && h.r === at.r));
            if (!home) return [];
            return Afterlife._dawnCandidates(world, C, rng, pick, [home]).map(c => ({
                ...c, chosen: true, culture: home.culture || null, native: Cultures.languageOfCulture(home.culture),
            }));
        }

        // A town that is still there
        const tile = typeof world.getTile === 'function' ? world.getTile(at.q, at.r) : null;
        const live = tile && tile.settlement;
        if (!live || _num(live.population) <= 0) return [];
        const day = _num(world.day);
        const kingdom = live.kingdom != null && typeof world.getKingdom === 'function' ? world.getKingdom(live.kingdom) : null;
        const culture = Cultures.cultureOf(world, live);
        const native = Cultures.languageOfCulture(culture);
        const base = { q: at.q, r: at.r, town: live.name, townType: live.type, kingdom: kingdom ? kingdom.name : null, chosen: true };
        const roleOf = (role) => (C.stations[role] ? role : 'villager');
        const station = (person) => {
            const st = C.stations[person.role] || C.stations.villager;
            const g = Array.isArray(st.gold) ? st.gold : [100, 200];
            return {
                station: person.role,
                title: st.title || Townsfolk.title(person.role, person.gender),
                gold: Math.round(_num(g[0], 100) + rng() * (_num(g[1], 200) - _num(g[0], 100))),
            };
        };
        // Someone not on the roster, named as their people name their own
        const stranger = (folkLike) => {
            const gender = rng() < 0.5 ? 'male' : 'female';
            const roles = Object.entries(C.roleWeights).filter(([r, w]) => w > 0 && C.stations[r]);
            const wsum = roles.reduce((a, [, w]) => a + w, 0);
            let roll = rng() * wsum;
            let role = 'villager';
            for (const [r, w] of roles) { roll -= w; if (roll <= 0) { role = r; break; } }
            return {
                first: pick(Townsfolk._firstNames(folkLike, gender)) || 'Wren',
                last: pick(Townsfolk._lastNames(folkLike)) || 'Hayward',
                gender,
                age: C.minAge + Math.floor(rng() * (C.maxAge - C.minAge + 1)),
                role,
                folkId: null,
            };
        };
        const out = [];
        const names = new Set();
        const push = (person, extra = {}) => {
            names.add(`${person.first} ${person.last}`);
            out.push({
                key: `${at.q},${at.r}#${extra.newcomer ? 'newcomer' : person.folkId != null ? person.folkId : `n${out.length}`}`,
                ...person, ...base, culture, native, kin: null, ...station(person), ...extra,
            });
        };

        // Its own people first: a town never walked through gets its roster now (systems/townsfolk.js)
        let folk = _obj(live.folk) && Array.isArray(live.folk.people) ? live.folk : null;
        if (!folk) folk = Townsfolk.seed(live, world, { q: at.q, r: at.r });
        const grown = folk ? Townsfolk.residents(folk).filter(p => {
            const a = Townsfolk.age(p, day);
            return a >= C.minAge && a <= C.maxAge && p.role !== 'child';
        }) : [];
        for (let i = grown.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [grown[i], grown[j]] = [grown[j], grown[i]];
        }
        for (const p of grown.slice(0, C.candidates)) {
            push({ first: p.first, last: p.last, gender: p.gender, age: Townsfolk.age(p, day), role: roleOf(p.retired || p.role), folkId: p.id },
                { kin: Afterlife._kinLine(folk, p) });
        }
        // ...then locals of its culture, when its roster runs short
        const local = folk || { culture };
        for (let tries = 0; out.length < C.candidates && tries < C.candidates * 6; tries++) {
            const person = stranger(local);
            if (names.has(`${person.first} ${person.last}`)) continue;
            push(person);
        }
        // ...and someone just arriving, from another town (most likely of another tongue)
        if (C.newcomer !== false) {
            const others = world.getSettlementViews()
                .map(v => ({ v, live: world.getTile(v.q, v.r) && world.getTile(v.q, v.r).settlement }))
                .filter(t => t.live && t.live !== live && _num(t.live.population) > 0);
            const foreign = others.filter(t => Cultures.cultureOf(world, t.live) !== culture);
            const from = pick(foreign.length && rng() < 0.75 ? foreign : others);
            const fromCulture = from ? Cultures.cultureOf(world, from.live) : culture;
            push(stranger({ culture: fromCulture }), {
                culture: fromCulture,
                native: Cultures.languageOfCulture(fromCulture) || native,
                newcomer: { from: from ? from.live.name : null, culture: fromCulture },
            });
        }
        return out;
    },

    /** "wed to Mara · 2 children": a townsperson's living family on the roster, or null. */
    _kinLine(folk, p) {
        if (!folk || !p) return null;
        const alive = id => {
            const o = Townsfolk.get(folk, id);
            return o && o.died == null ? o : null;
        };
        const parts = [];
        const sp = p.spouse != null ? alive(p.spouse) : null;
        if (sp) parts.push(`wed to ${sp.first}`);
        const kids = (p.kids || []).map(alive).filter(Boolean);
        if (kids.length) parts.push(kids.length === 1 ? `a ${kids[0].gender === 'female' ? 'daughter' : 'son'}, ${kids[0].first}` : `${kids.length} children`);
        const parents = (p.parents || []).map(alive).filter(Boolean);
        if (parents.length) parts.push(parents.length === 2 ? 'both parents living' : `${Townsfolk.kinWord(parents[0], 'parent')} living`);
        return parts.length ? parts.join(' · ') : null;
    },

    /** Where one may be born at the dawn: the wandering clans, and the villages clans founded. */
    _dawnHomes(world) {
        const homes = [];
        for (const u of world.units || []) {
            if (u.type === 'clan' && !u.destroyed) homes.push({ clan: u, q: u.q, r: u.r, name: u.name, clanName: u.clanName, culture: u.culture });
        }
        for (const v of world.getSettlementViews ? world.getSettlementViews() : []) {
            const live = world.getTile(v.q, v.r) && world.getTile(v.q, v.r).settlement;
            if (!live || !live.dawnBorn || _num(live.population) <= 0) continue;
            homes.push({ village: live, q: v.q, r: v.r, name: live.name, clanName: DawnBirth.villageClanName(live), culture: live.culture,
                kingdom: live.kingdom != null && typeof world.getKingdom === 'function' && world.getKingdom(live.kingdom) ? world.getKingdom(live.kingdom).name : null });
        }
        return homes;
    },

    /**
     * New lives at the dawn: children of the wandering clans, or of the
     * villages clans have founded (dawnBorn), each with the clan's name and a
     * family to come (DawnBirth.apply in becomeStranger). → candidates, as
     * `candidates` returns, with `dawn: { clanId }` or `dawn: { q, r }`.
     * `homes` (from _dawnHomes) narrows where they are born.
     */
    _dawnCandidates(world, C, rng, pick, homes = null) {
        homes = homes ? homes.slice() : Afterlife._dawnHomes(world);
        if (!homes.length) return [];
        for (let i = homes.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [homes[i], homes[j]] = [homes[j], homes[i]];
        }
        const B = DawnBirth.data();
        const jobs = B.occupations && B.occupations.length ? B.occupations : ['Hunter'];
        const st = C.stations.villager || {};
        const g = Array.isArray(st.gold) ? st.gold : [10, 40];
        const out = [];
        for (let i = 0; out.length < C.candidates && i < C.candidates * 4; i++) {
            const h = homes[i < homes.length ? i : Math.floor(rng() * homes.length)];
            const gender = rng() < 0.5 ? 'male' : 'female';
            const names = (Characters.FIRST_NAMES && (Characters.FIRST_NAMES[h.culture || 'Woodland'] || Characters.FIRST_NAMES.Imperial)) || {};
            const first = pick(names[gender]) || pick(Townsfolk.config().names[gender]) || 'Wren';
            if (out.some(c => c.first === first && c.q === h.q && c.r === h.r)) continue;
            out.push({
                key: `${h.q},${h.r}#dawn${out.length}`,
                first, last: `of the ${h.clanName}`, gender,
                age: C.minAge + Math.floor(rng() * (C.maxAge - C.minAge + 1)),
                role: 'villager', station: 'villager', folkId: null,
                title: pick(jobs) || 'Hunter',
                q: h.q, r: h.r, town: h.name, townType: h.clan ? 'clan' : 'village', kingdom: h.kingdom || null,
                gold: Math.round(_num(g[0], 10) + rng() * (_num(g[1], 40) - _num(g[0], 10))),
                dawn: h.clan ? { clanId: h.clan.id } : { q: h.q, r: h.r },
            });
        }
        return out;
    },

    /**
     * Hand the late player's holdings in the world to crowns and towns: their
     * estates escheat to the crown, leases go back, tax farms end, town works
     * and toll works, inns, courier houses and theatres pass to their towns
     * and realms, colonies stand alone, buildings on the map are lost.
     * Anything else still marked as the player's is swept the same way.
     * @returns {{ estates, leases, farms, works, properties, colonies, swept }}
     */
    escheat(old, world) {
        const out = { estates: 0, leases: 0, farms: 0, works: 0, properties: 0, colonies: 0, swept: 0, crown: null };
        if (!world) return out;
        const day = _num(world.day);

        // A crown the House wore goes back to the realm (its old line, else a kinsman)
        if (old && old.throne && old.throne.ruling) out.crown = Throne.passCrown(old, world, 'the line ended');

        // Estates go to the crown of the town's realm (Estates keeps its holders' index true)
        const est = _obj(world.estates);
        if (est && _obj(est.estates)) {
            for (const e of Object.values(est.estates)) {
                if (!e || e.holder !== 'player') continue;
                const town = est.towns && est.towns[e.town];
                const kid = town && town.kid != null ? town.kid : null;
                Estates.setHolder(world, e, kid != null ? `crown:${kid}` : 'crown:free');
                out.estates++;
            }
            if (Array.isArray(est.sales)) est.sales = est.sales.filter(x => x && x.seller !== 'player');
        }
        // Mining and land leases go back to the crown
        const hin = _obj(world.hinterland);
        for (const c of (hin && Array.isArray(hin.concessions) ? hin.concessions : [])) {
            if (c && c.holder === 'player' && c.status === 'active') {
                Concessions.surrender(old, world, c.id);
                out.leases++;
            }
        }
        // Tax farms end today; the crown collects again
        try {
            for (const f of Fiscal.state(world).farms || []) {
                if (f && f.holder === 'player') { f.until = Math.min(_num(f.until, day), day); out.farms++; }
            }
        } catch (e) { /* no fiscal state yet */ }

        // The map: buildings, works and colonies
        for (const row of world.tiles || []) {
            for (const tile of row || []) {
                if (!tile) continue;
                if (tile.playerProperty || (Array.isArray(tile.playerProperties) && tile.playerProperties.length)) {
                    out.properties += Array.isArray(tile.playerProperties) ? tile.playerProperties.length : 1;
                    tile.playerProperty = null;
                    tile.playerProperties = null;
                }
                const s = tile.settlement;
                if (!s) continue;
                const works = s.market && _obj(s.market.works);
                for (const w of works ? Object.values(works) : []) {
                    if (w && w.owner === 'player') { w.owner = 'town'; out.works++; }
                }
                if (s.colony && s.colony.isPlayerColony) { s.colony.isPlayerColony = false; out.colonies++; }
                if (s.taxFarm && s.taxFarm.holder === 'player') s.taxFarm = null;
            }
        }
        // Toll roads, canals and harbours: the realm's now
        const tr = _obj(world.transport);
        for (const w of (tr && Array.isArray(tr.works) ? tr.works : [])) {
            if (!w) continue;
            if (w.owner === 'player') { w.owner = w.kid != null ? w.kid : null; out.works++; }
            if (w.payer === 'player') w.payer = 'crown';
        }
        out.swept = Afterlife._sweep(world);
        return out;
    },

    /**
     * Anything left in the world marked as the player's (an inn, a courier
     * house, a bank, a theatre, a Great Work…): owner → 'npc', holder →
     * 'crown', payer → 'crown'. Records of past deeds (`by`, `winner`, logs)
     * are history and stay.
     */
    _sweep(world) {
        let n = 0;
        const seen = new WeakSet();
        const MAP = { owner: 'npc', holder: 'crown', payer: 'crown' };
        const walk = (o, depth) => {
            if (!o || typeof o !== 'object' || seen.has(o) || depth > 10) return;
            seen.add(o);
            if (Array.isArray(o)) { for (const v of o) walk(v, depth + 1); return; }
            for (const k of Object.keys(o)) {
                const v = o[k];
                if (v === 'player' && MAP[k]) { o[k] = MAP[k]; n++; } else if (v && typeof v === 'object') walk(v, depth + 1);
            }
        };
        // The tiles' terrain is shared and large: only what stands on them
        for (const row of world.tiles || []) {
            for (const tile of row || []) {
                if (!tile) continue;
                for (const k of ['settlement', 'improvement', 'culturalBuilding', 'religiousBuilding', 'infrastructure']) walk(tile[k], 0);
            }
        }
        for (const k of Object.keys(world)) {
            if (k === 'tiles') continue;
            walk(world[k], 0);
        }
        return n;
    },

    /**
     * Become `cand` (from candidates()). The late ruler's House ends (its
     * epitaph is returned), what it held in the world is handed on, and a
     * fresh character starts at the candidate's town with their station's
     * purse and skills. The people of the world carry over (the NPC registry
     * lives on the player), but the new character knows none of them.
     * @returns {{ success, player?, epitaph?, escheat?, reason? }}
     */
    becomeStranger(old, world, cand) {
        if (!world || !cand) return { success: false, reason: 'No one to become.' };
        const C = Afterlife.config();
        const cause = old && old.interregnum ? old.interregnum.cause : null;
        // A town chosen a while ago may have been razed or emptied since (not a wandering clan's camp)
        if (!cand.dawn || cand.dawn.clanId == null) {
            const at = typeof world.getTile === 'function' ? world.getTile(cand.q, cand.r) : null;
            if (!at || !at.settlement || _num(at.settlement.population) <= 0) return { success: false, reason: `${cand.town || 'That town'} is no more.` };
        }

        // The old House: its last reign filed, its epitaph written
        let epitaph = null;
        let annalsPast = [];
        if (old) {
            Relationships.prepareForSave(old);
            epitaph = old.house ? Legacy.endDynasty(old, world, cause) : null;
            // Its Annals close too, and go with the new life as "Before" (systems/annals.js)
            annalsPast = Annals.archive(old, world);
        }
        const escheat = Afterlife.escheat(old, world);

        // The townsperson leaves their town's roster for the road
        const tile = world.getTile(cand.q, cand.r);
        const live = tile && tile.settlement;
        if (cand.folkId != null && live && live.folk) {
            const p = Townsfolk.get(live.folk, cand.folkId);
            if (p) Townsfolk.exile(live.folk, p, _num(world.day), 'the road');
        }

        // Born at the dawn: no surname yet — DawnBirth.apply gives the clan's (and the House its name)
        const dawnBorn = !!(cand.dawn && Dawn.isActive(world));
        const player = new Player({ firstName: cand.first, lastName: dawnBorn ? '' : cand.last, gender: cand.gender, age: cand.age });
        player.q = cand.q; player.r = cand.r;
        player.prevQ = cand.q; player.prevR = cand.r;
        for (const kingdom of world.kingdoms || []) player.reputation[kingdom.id] = 0;
        player.revealArea(world, 4);
        player.discoverNearbyHolySites(world, 4);

        const st = C.stations[cand.station] || C.stations.villager || {};
        player.gold = Math.max(0, Math.round(_num(cand.gold, 100)));
        player.title = st.title || player.title;
        for (const k of STAT_KEYS) player[k] = _num(player[k], 5) + _num(st.stats && st.stats[k]);
        for (const k of SKILL_KEYS) player.skills[k] = _num(player.skills[k]) + _num(st.skills && st.skills[k]);
        player.inventory = { bread: 10 };
        player.birthDay = _num(world.day) - cand.age * (Relationships._getHeirSettings().daysPerYear || 120);
        player.origin = { station: cand.station, town: cand.town, q: cand.q, r: cand.r, day: _num(world.day), from: old ? old.name : null };
        if (cand.chosen) player.origin.chosen = true;
        if (cand.newcomer) player.origin.cameFrom = cand.newcomer.from || null;
        if (annalsPast.length) player.annalsPast = annalsPast;
        // The game's difficulty and victory goal go on into the new life (core/difficulty.js)
        player.scenario = Difficulty.carry(old, world);

        // The world's people carry over; this character knows none of them yet
        if (old) {
            player._relationshipNpcs = old._relationshipNpcs || [];
            player._relationshipNextId = old._relationshipNextId || 1;
        }

        // Set up as a new game does (ui/game/gameSetup.js), the world kept as it is
        Quests.initialize(player);
        Achievements.initialize(player);
        Technology.initPlayer(player);
        Relationships.initialize(player);
        // A child of a clan (or of a village a clan founded): a father, a mother,
        // brothers and sisters — before the House, which takes the clan's name
        // (the same order as a dawn start, ui/game/gameSetup.js)
        let birth = null;
        if (dawnBorn) {
            const clan = cand.dawn.clanId != null
                ? (world.units || []).find(u => u.type === 'clan' && !u.destroyed && u.id === cand.dawn.clanId) : null;
            birth = DawnBirth.apply(player, world, clan ? { clan } : { village: { q: cand.dawn.q != null ? cand.dawn.q : cand.q, r: cand.dawn.r != null ? cand.dawn.r : cand.r } });
            if (birth) {
                player.prevQ = player.q;
                player.prevR = player.r;
            } else {
                player.lastName = cand.last;
                player.name = `${player.firstName} ${player.lastName}`.trim();
            }
        }
        // A mother tongue: the clan's or the town's, or a newcomer's own (systems/languages.js)
        Languages.initialize(player, world, { native: cand.native || null });
        // Someone of the town knows their own realm; a newcomer has yet to learn it
        if (!cand.newcomer && live && live.kingdom != null && typeof world.getKingdom === 'function' && world.getKingdom(live.kingdom)) {
            if (!player.kingdomsVisited) player.kingdomsVisited = [];
            if (!player.kingdomsVisited.includes(live.kingdom)) player.kingdomsVisited.push(live.kingdom);
            if (typeof player.learnAboutKingdom === 'function') player.learnAboutKingdom(live.kingdom, 'basics');
        }
        House.initialize(player, world);
        House.seedRivals(player, world);
        player.taxRate = 'moderate';
        Titles.initialize(player);
        Councils.initializePlayer(player);
        player.updateVisibility(world, 4);
        return { success: true, player, epitaph, escheat, kin: birth ? DawnBirth.kinLine(player) : null };
    },
};
