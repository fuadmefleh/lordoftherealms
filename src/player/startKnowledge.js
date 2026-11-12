// ============================================
// START KNOWLEDGE — what an advanced start already knows on the first day
// ============================================
// A monarch knows their kingdom; a great lord their lands; a high priest the
// holy places of the faith; a guildmaster the trade; a general the front; a
// crime lord the streets. grant() runs after the start has been set up
// (player/scenarios.js apply, advanced starts only) and gives the position's
// knowledge through the game's own records:
//
//   - the map: tiles charted (tile.explored) — a realm's land, roads and
//     borders, an estate's country, the holy sites, trade roads, the front,
//     a smuggling line (systems/library.js chartTiles);
//   - the world's history (player.discoveredLore, the History panel): what a
//     court remembers of its realm (living memory), a see of its faith;
//   - the realms (player.learnAboutKingdom): one's own and the neighbours';
//   - prices (systems/priceKnowledge.js: a steward's or factor's report);
//   - tongues (player.languages): the realm's, and some of its neighbours';
//   - people (systems/relationships.js): clergy, merchants, vassals, a fence,
//     met before the game began — they are in their towns to be found;
//   - a library at the seat (systems/library.js): books written from the
//     world (the realm's chronicle, the royal roll, maps, the faith's annals,
//     the guild's rolls), read at its shelves (systems/books.js).
//
// Returns { lines, library } for the welcome's "What you know" note and
// records it on player.scenario.knowledge. Tuned in data/scenarios.json →
// knowledge. Draws from Utils only when it meets people (Relationships).

import { DataLoader } from '../core/dataLoader.js';
import { Cultures } from '../world/cultures.js';
import { Estates } from '../world/estates.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Library } from '../systems/library.js';
import { Languages } from '../systems/languages.js';
import { PriceKnowledge } from '../systems/priceKnowledge.js';
import { Relationships } from '../systems/relationships.js';
import { Religion } from '../systems/religion.js';
import { Kingship } from '../systems/kingship.js';
import { Gangs } from '../systems/gangs.js';
import { Guilds } from '../systems/guilds.js';
import { Names } from '../core/names.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = world => _num(world && world.day);

/** "the Iron Creed" for a name that may already start with "The". */
const _the = (name, cap = false) => { const n = String(name || '').replace(/^the /i, ''); return `${cap ? 'The' : 'the'} ${n}`; };

const ALL_CATS = ['basics', 'ruler', 'peoples', 'religion', 'military', 'diplomacy', 'economy'];

const DEFAULTS = {
    monarch: { ring: 2, livingMemory: 100, minorityFluency: 70, neighbourFluency: 35, neighbours: 3 },
    great_lord: { seatRadius: 6, estateRadius: 2, capitalRadius: 2, livingMemory: 60, vassals: 2, lords: 2, neighbourFluency: 20 },
    high_priest: { siteRadius: 1, capitalRadius: 2, townRadius: 1, livingMemory: 60, clergy: 4, faithFluency: 40 },
    guildmaster: { homeRadius: 3, reach: 18, towns: 5, merchants: 4, fluency: 50, farTowns: 6, farReach: 26 },
    general: { depth: 4, campRadius: 5, enemyFluency: 30, mapAccuracy: 0.85 },
    crime_lord: { cityRadius: 3, fluency: 40 },
    people: { score: 25 },
};

function _cfg(kind) {
    const gd = DataLoader._gamedata;
    const d = (gd && gd.scenarios && _obj(gd.scenarios.knowledge)) || {};
    return { ...(DEFAULTS[kind] || {}), ...(_obj(d[kind]) || {}) };
}

function _kingdom(world, kid) {
    if (kid == null || !world) return null;
    return typeof world.getKingdom === 'function' ? world.getKingdom(kid) : (world.kingdoms || []).find(k => k.id === kid) || null;
}

function _townAt(world, q, r) {
    const t = world.getTile(q, r);
    return t && t.settlement ? { q, r, s: t.settlement } : null;
}

const _plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const _list = arr => (arr.length <= 1 ? arr.join('') : `${arr.slice(0, -1).join(', ')} and ${arr[arr.length - 1]}`);

export const StartKnowledge = {
    config: _cfg,

    // ── The pieces ─────────────────────────────────────────

    /** Raise the player's fluency in the tongues to at least `level`. → the names of tongues raised. */
    tongues(player, world, langs, level) {
        if (!player) return [];
        if (!_obj(player.languages)) Languages.ensure(player, world);
        if (!_obj(player.languages)) return [];
        const out = [];
        for (const lang of new Set(langs.filter(Boolean))) {
            if (_num(player.languages[lang]) >= level) continue;
            player.languages[lang] = level;
            out.push(Cultures.languageName(lang));
        }
        return out;
    },

    realmTongue(k) {
        return k ? Cultures.languageOfCulture(k.culture) : null;
    },

    townTongue(world, t) {
        return t ? Languages.settlementLanguage(world, t.s) : null;
    },

    /** A steward's (or factor's) report of the towns' markets. → how many towns. */
    prices(player, world, towns, src = 'h') {
        let n = 0;
        for (const t of towns) {
            if (!t || !t.s) continue;
            if (!Number.isFinite(t.s.q)) { t.s.q = t.q; t.s.r = t.r; }
            SettlementMarket.ensure(t.s);
            if (PriceKnowledge.observe(player, world, t.s, src) > 0) n++;
        }
        return n;
    },

    /** Lore of the world's history: entries about the realm within `years` of now. → how many. */
    realmMemory(player, world, k, years) {
        const now = _num(world.year, Infinity);
        const ids = Library.realmLore(world, k).filter(e => !Number.isFinite(e.year) || now - e.year <= years).map(e => e.id);
        return Library.learnLore(player, ids);
    },

    /**
     * People known from before: relationship NPCs in a town with an
     * occupation, already acquainted. → their names.
     */
    acquaint(player, world, t, occupation, n, note) {
        if (!player || !t || n <= 0) return [];
        if (!_obj(player.relationships)) player.relationships = {};
        const P = _cfg('people');
        const out = [];
        for (let i = 0; i < n; i++) {
            const npc = Relationships.generateNPC({ ...t.s, q: t.q, r: t.r }, world);
            npc.settlementQ = t.q;
            npc.settlementR = t.r;
            npc.occupation = occupation;
            npc.metDay = _day(world);
            npc.lastInteraction = _day(world);
            npc.knownFrom = note;
            const rel = Relationships.getRelationship(player, npc.id);
            rel.score = Math.max(_num(rel.score), _num(P.score, 25));
            rel.history.push({ day: _day(world), action: 'known_of_old', result: note });
            out.push(`${npc.firstName} ${npc.dynasty}`);
        }
        return out;
    },

    // ── The starts ─────────────────────────────────────────

    monarch(player, world, start) {
        const C = _cfg('monarch');
        const k = _kingdom(world, start.kingdomId);
        if (!k) return null;
        const lines = [];
        const charted = Library.chart(world, [{ kind: 'realm', kid: k.id, ring: C.ring }]);
        lines.push(`${k.name} charted, its land, roads and borders (${charted} hexes)`);
        const towns = Library.realmTowns(world, k.id);
        Library.learnRealm(player, k.id, ALL_CATS);
        const nbs = Library.neighbours(world, k, C.neighbours);
        for (const n of nbs) Library.learnRealm(player, n.id, ['basics', 'ruler', 'military', 'diplomacy']);
        if (nbs.length) lines.push(`the strength and temper of ${_list(nbs.map(n => n.name))}`);
        const lore = StartKnowledge.realmMemory(player, world, k, C.livingMemory);
        if (lore) lines.push(`${_plural(lore, 'page')} of the realm's history the court remembers`);
        const priced = StartKnowledge.prices(player, world, towns, 'h');
        if (priced) lines.push(`this season's prices in ${_plural(priced, 'town')} of the realm`);
        const spoken = [
            ...StartKnowledge.tongues(player, world, [StartKnowledge.realmTongue(k)], 100),
            ...StartKnowledge.tongues(player, world, towns.map(t => StartKnowledge.townTongue(world, t)), C.minorityFluency),
            ...StartKnowledge.tongues(player, world, nbs.map(n => StartKnowledge.realmTongue(n)), C.neighbourFluency),
        ];
        if (spoken.length) lines.push(`the tongues of your court (${_list(spoken)})`);
        const court = Kingship.court(player);
        if (court) {
            const seats = Object.values(court.council || {}).filter(Boolean).length;
            lines.push(`your court by name: ${_plural((court.vassals || []).length, 'lord')} and ${_plural(seats, 'councillor')}`);
        }
        const cap = k.capital ? _townAt(world, k.capital.q, k.capital.r) : null;
        let library = null;
        if (cap) {
            library = Library.found(player, world, {
                kind: 'royal', q: cap.q, r: cap.r, town: cap.s.name,
                books: [
                    Library.realmChronicle(world, k),
                    Library.royalRoll(world, k, { late: start.oldRuler, lateDay: _day(world), pretender: start.pretender }),
                    Library.chanceryLetters(world, k, nbs),
                    ...nbs.map(n => Library.realmMap(world, n, 1)),
                ],
            });
        }
        return { lines, library, charted };
    },

    great_lord(player, world, start) {
        const C = _cfg('great_lord');
        const k = _kingdom(world, start.kingdomId);
        const seat = start.seat ? _townAt(world, start.seat.q, start.seat.r) : null;
        if (!k || !seat) return null;
        const lines = [];
        const held = Estates.enabled() ? Estates.heldBy(world, 'player') : [];
        const estateTowns = [];
        for (const e of held) {
            const [q, r] = String(e.town || '').split(',').map(Number);
            const t = Number.isFinite(q) ? _townAt(world, q, r) : null;
            if (t && t.s.kingdom === k.id && !estateTowns.some(x => x.q === t.q && x.r === t.r)) estateTowns.push(t);
        }
        const specs = [
            { kind: 'around', points: [{ q: seat.q, r: seat.r }], radius: C.seatRadius },
            { kind: 'around', points: estateTowns.map(t => ({ q: t.q, r: t.r })), radius: C.estateRadius },
            { kind: 'roads', kid: k.id },
        ];
        if (k.capital) specs.push({ kind: 'around', points: [k.capital], radius: C.capitalRadius });
        const charted = Library.chart(world, specs);
        lines.push(`your lands about ${seat.s.name} and the realm's main roads charted (${charted} hexes)`);
        Library.learnRealm(player, k.id, ['basics', 'ruler', 'peoples', 'religion', 'diplomacy', 'military']);
        const nbs = Library.neighbours(world, k, 2);
        for (const n of nbs) Library.learnRealm(player, n.id, ['basics', 'ruler']);
        const lore = StartKnowledge.realmMemory(player, world, k, C.livingMemory);
        if (lore) lines.push(`${_plural(lore, 'page')} of the realm's recent history`);
        const priceTowns = [seat, ...estateTowns.filter(t => t !== seat)];
        const cap = k.capital ? _townAt(world, k.capital.q, k.capital.r) : null;
        if (cap) priceTowns.push(cap);
        const priced = StartKnowledge.prices(player, world, priceTowns.slice(0, 6), 'h');
        if (priced) lines.push(`your stewards' prices from ${_plural(priced, 'town')}`);
        const spoken = [
            ...StartKnowledge.tongues(player, world, [StartKnowledge.realmTongue(k), StartKnowledge.townTongue(world, seat)], 100),
            ...StartKnowledge.tongues(player, world, nbs.map(n => StartKnowledge.realmTongue(n)), C.neighbourFluency),
        ];
        if (spoken.length) lines.push(`the tongues of the realm (${_list(spoken)})`);
        // Vassals at the seat, and the lords of the towns nearest it
        const people = StartKnowledge.acquaint(player, world, seat, 'knight', Math.floor(_num(C.vassals)), `your vassal at ${seat.s.name}`);
        const near = Library.realmTowns(world, k.id).filter(t => t.q !== seat.q || t.r !== seat.r)
            .sort((a, b) => Library.dist(world, a, seat) - Library.dist(world, b, seat)).slice(0, Math.floor(_num(C.lords)));
        for (const t of near) people.push(...StartKnowledge.acquaint(player, world, t, 'noble', 1, `a neighbouring lord at ${t.s.name}`));
        if (people.length) lines.push(`your vassals and neighbours: ${_list(people)}`);
        const nearest = Library.neighbours(world, k, 1)[0] || null;
        const library = Library.found(player, world, {
            kind: 'lordly', q: seat.q, r: seat.r, town: seat.s.name, holdsSeat: true,
            books: [
                Library.estateRoll(world, k, held, start.house || null),
                Library.realmChronicle(world, k),
                Library.royalRoll(world, k, {}),
                Library.realmMap(world, k, 0),
                nearest ? Library.realmMap(world, nearest, 1) : null,
            ],
        });
        return { lines, library, charted };
    },

    high_priest(player, world, start) {
        const C = _cfg('high_priest');
        const k = _kingdom(world, start.kingdomId);
        const faith = start.faithId && Religion.FAITHS[start.faithId];
        const see = start.seat ? _townAt(world, start.seat.q, start.seat.r) : null;
        if (!k || !faith || !see) return null;
        const lines = [];
        const realms = (world.kingdoms || []).filter(x => x && x.isAlive !== false && x.capital && x.religion && x.religion.faithId === faith.id);
        const charted = Library.chart(world, [
            { kind: 'holy', faithId: faith.id, radius: C.siteRadius },
            { kind: 'around', points: realms.map(x => x.capital), radius: C.capitalRadius },
            { kind: 'around', points: Library.realmTowns(world, k.id).map(t => ({ q: t.q, r: t.r })), radius: C.townRadius },
        ]);
        const sites = Library.knowHolySites(player, world, faith.id);
        lines.push(`the faith's holy places and temples charted (${charted} hexes${sites ? `, ${_plural(sites, 'holy site')}` : ''})`);
        const faithLore = Library.learnLore(player, Library.faithLore(world, faith).map(e => e.id));
        const realmLore = StartKnowledge.realmMemory(player, world, k, C.livingMemory);
        if (faithLore + realmLore) lines.push(`the history of ${_the(faith.name)} (${_plural(faithLore + realmLore, 'page')})`);
        for (const x of world.kingdoms || []) if (x && x.isAlive !== false) Library.learnRealm(player, x.id, ['religion']);
        for (const x of realms) Library.learnRealm(player, x.id, ['basics', 'ruler', 'religion']);
        if (realms.length) lines.push(`the realms of the faith: ${_list(realms.map(x => x.name))}`);
        StartKnowledge.prices(player, world, [see], 'h');
        const spoken = [
            ...StartKnowledge.tongues(player, world, [StartKnowledge.townTongue(world, see), StartKnowledge.realmTongue(k)], 100),
            ...StartKnowledge.tongues(player, world, realms.map(x => StartKnowledge.realmTongue(x)), C.faithFluency),
        ];
        if (spoken.length) lines.push(`the tongues of the faithful (${_list(spoken)})`);
        // The clergy: at the see, and the priests of the realm's nearest towns
        const n = Math.max(1, Math.floor(_num(C.clergy)));
        const clergy = StartKnowledge.acquaint(player, world, see, 'priest', Math.min(2, n), `a priest of the see at ${see.s.name}`);
        const others = Library.realmTowns(world, k.id).filter(t => t.q !== see.q || t.r !== see.r)
            .sort((a, b) => Library.dist(world, a, see) - Library.dist(world, b, see)).slice(0, Math.max(0, n - clergy.length));
        for (const t of others) clergy.push(...StartKnowledge.acquaint(player, world, t, 'priest', 1, `the priest of ${t.s.name}`));
        if (clergy.length) lines.push(`your clergy: ${_list(clergy)}`);
        const temple = (world.getTile(see.q, see.r).religiousBuilding || {}).name || `Great Temple of ${see.s.name}`;
        const library = Library.found(player, world, {
            kind: 'temple', q: see.q, r: see.r, town: see.s.name, vars: { temple },
            books: [Library.faithAnnals(world, faith, k), Library.holyPlaces(world), Library.realmChronicle(world, k)],
        });
        return { lines, library, charted };
    },

    guildmaster(player, world, start) {
        const C = _cfg('guildmaster');
        const home = _townAt(world, start.q, start.r);
        const gid = start.guild;
        const homeGuild = home ? Guilds.guild(home.s, gid) : null;
        if (!home || !homeGuild) return null;
        const lines = [];
        const all = Library.towns(world).filter(t => t.q !== home.q || t.r !== home.r);
        const byDist = all.map(t => ({ t, d: Library.dist(world, t, home) })).sort((a, b) => a.d - b.d);
        const guildTowns = byDist.filter(x => x.d <= C.reach && Guilds.guild(x.t.s, gid)).slice(0, Math.floor(_num(C.towns))).map(x => x.t);
        // (no other hall of the trade near: the trade towns nearest, where its goods go)
        const tradeTowns = guildTowns.length ? guildTowns : byDist.filter(x => x.d <= C.reach && ['town', 'city', 'capital'].includes(x.t.s.type)).slice(0, 3).map(x => x.t);
        const charted = Library.chart(world, [
            { kind: 'around', points: [{ q: home.q, r: home.r }], radius: C.homeRadius },
            { kind: 'routes', from: { q: home.q, r: home.r }, to: tradeTowns.map(t => ({ q: t.q, r: t.r })) },
            { kind: 'around', points: tradeTowns.map(t => ({ q: t.q, r: t.r })), radius: 1 },
        ]);
        lines.push(`the trade roads from ${home.s.name} to ${_plural(tradeTowns.length, 'town')} charted (${charted} hexes)`);
        const priced = StartKnowledge.prices(player, world, [home, ...tradeTowns], 'f');
        if (priced) lines.push(`the guild's factors' prices from ${_plural(priced, 'town')}`);
        const realms = [...new Set([home, ...tradeTowns].map(t => t.s.kingdom).filter(x => x != null))];
        for (const kid of realms) Library.learnRealm(player, kid, ['basics', 'economy']);
        const spoken = [
            ...StartKnowledge.tongues(player, world, [StartKnowledge.townTongue(world, home)], 100),
            ...StartKnowledge.tongues(player, world, tradeTowns.map(t => StartKnowledge.townTongue(world, t)), C.fluency),
        ];
        if (spoken.length) lines.push(`the merchants' tongues (${_list(spoken)})`);
        const merchants = [];
        for (const t of tradeTowns.slice(0, Math.floor(_num(C.merchants)))) merchants.push(...StartKnowledge.acquaint(player, world, t, 'merchant', 1, `a merchant of ${t.s.name} who deals with the guild`));
        if (merchants.length) lines.push(`merchants who deal with you: ${_list(merchants)}`);
        const charted2 = new Set([home, ...tradeTowns].map(t => `${t.q},${t.r}`));
        const far = byDist.filter(x => x.d <= C.farReach && !charted2.has(`${x.t.q},${x.t.r}`) && ['town', 'city', 'capital'].includes(x.t.s.type))
            .slice(0, Math.floor(_num(C.farTowns))).map(x => x.t);
        const realm = home.s.kingdom != null ? _kingdom(world, home.s.kingdom) : null;
        const library = Library.found(player, world, {
            kind: 'guild', q: home.q, r: home.r, town: home.s.name, vars: { guild: homeGuild.name },
            books: [Library.guildRolls(world, gid, [home, ...guildTowns], homeGuild), Library.itinerary(world, home, far), realm ? Library.realmChronicle(world, realm) : null],
        });
        return { lines, library, charted };
    },

    general(player, world, start) {
        const C = _cfg('general');
        const k = _kingdom(world, start.kingdomId);
        const enemy = _kingdom(world, start.enemyId);
        if (!k) return null;
        const lines = [];
        const specs = [{ kind: 'around', points: [{ q: start.q, r: start.r }], radius: C.campRadius }];
        if (k.capital) specs.push({ kind: 'routes', from: { q: start.q, r: start.r }, to: [k.capital] });
        if (enemy) {
            specs.push({ kind: 'front', kid: k.id, enemy: enemy.id, depth: C.depth });
            if (enemy.capital) specs.push({ kind: 'around', points: [enemy.capital], radius: 1 });
        }
        // Where the enemy's companies are in the field today
        const hosts = enemy ? (world.units || []).filter(u => u && !u.destroyed && u.kingdomId === enemy.id) : [];
        if (hosts.length) specs.push({ kind: 'around', points: hosts.map(u => ({ q: u.q, r: u.r })), radius: 1 });
        const charted = Library.chart(world, specs);
        lines.push(`the front${enemy ? ` with ${enemy.name}` : ''} and the road back to the capital charted (${charted} hexes)`);
        Library.learnRealm(player, k.id, ['basics', 'ruler', 'military', 'diplomacy']);
        if (enemy) {
            Library.learnRealm(player, enemy.id, ['basics', 'ruler', 'military', 'diplomacy']);
            if (hosts.length) {
                const camp = { q: start.q, r: start.r };
                const nearest = hosts.slice().sort((a, b) => Library.dist(world, a, camp) - Library.dist(world, b, camp))[0];
                const by = Library.nearestTown(world, nearest);
                lines.push(`the scouts' report: ${_plural(hosts.length, 'enemy company', 'enemy companies')} in the field, the nearest ${Library.dist(world, nearest, camp)} leagues off${by ? ` by ${by.s.name}` : ''}`);
            } else {
                lines.push(`the scouts' report: no company of ${enemy.name} is in the field yet`);
            }
            // The crown's map of the enemy realm, in the baggage
            const map = StartKnowledge.warMap(world, k, enemy, C.mapAccuracy);
            if (map) {
                if (!Array.isArray(player.maps)) player.maps = [];
                player.maps.push(map);
                lines.push(`${map.name} in your baggage (read it from your maps)`);
            }
        }
        const c = player.commission;
        if (c && Array.isArray(c.lieutenants) && c.lieutenants.length) lines.push(`your officers: ${_list(c.lieutenants.map(l => l.name).filter(Boolean))}`);
        const spoken = [
            ...StartKnowledge.tongues(player, world, [StartKnowledge.realmTongue(k)], 100),
            ...(enemy ? StartKnowledge.tongues(player, world, [StartKnowledge.realmTongue(enemy)], C.enemyFluency) : []),
        ];
        if (spoken.length) lines.push(`the tongues of the march (${_list(spoken)})`);
        return { lines, library: null, charted };
    },

    /** The crown's map of an enemy realm: its land as the map-room has it (no RNG: every hex). */
    warMap(world, k, enemy, accuracy) {
        const land = Library.realmTiles(world, enemy.id);
        if (!land.length || !enemy.capital) return null;
        const tiles = land.map(t => {
            const tile = world.getTile(t.q, t.r);
            return { q: t.q, r: t.r, terrain: tile.terrain && tile.terrain.id, hasSettlement: !!tile.settlement, settlementName: tile.settlement ? tile.settlement.name : null, kingdom: enemy.id, hasResource: false, resource: null };
        });
        const radius = land.reduce((m, t) => Math.max(m, Library.dist(world, t, enemy.capital)), 0);
        return {
            id: `map_war_${k.id}_${enemy.id}`, type: 'kingdom', name: `Map of ${enemy.name}`, icon: '👑', quality: 'detailed',
            accuracy, centerQ: enemy.capital.q, centerR: enemy.capital.r, radius,
            createdDay: _day(world), createdBy: `the map-room of ${Names.realm(k.name)}`, value: 120,
            tiles, kingdomId: enemy.id, charted: false, deliberateErrors: [], isPropaganda: false, isStolen: false, isAncient: false,
            notes: `The crown's own map of ${enemy.name}, given to its general.`,
        };
    },

    crime_lord(player, world, start) {
        const C = _cfg('crime_lord');
        const home = _townAt(world, start.q, start.r);
        if (!home) return null;
        const lines = [];
        const tile = world.getTile(home.q, home.r);
        const specs = [{ kind: 'around', points: [{ q: home.q, r: home.r }], radius: C.cityRadius }];
        // The smuggling line: the town over the border the contraband comes from
        let source = null;
        const good = Gangs._smuggleChoice(world, tile);
        if (good) source = Gangs._source(world, tile, good);
        if (source) {
            specs.push({ kind: 'routes', from: { q: home.q, r: home.r }, to: [{ q: source.tile.q, r: source.tile.r }] });
            specs.push({ kind: 'around', points: [{ q: source.tile.q, r: source.tile.r }], radius: 1 });
        }
        const charted = Library.chart(world, specs);
        lines.push(`the streets and lanes about ${home.s.name}${source ? ` and the smuggling line to ${source.s.name}` : ''} charted (${charted} hexes)`);
        const st = Gangs.town(world, tile);
        if (st) {
            const gangs = (st.gangs || []).map(g => g.name).filter(Boolean);
            if (gangs.length) lines.push(`the gangs of the city: ${_list(gangs)}`);
            if (st.watch) lines.push(`the watch: Captain ${st.watch.captain.name} (yours), Magistrate ${st.watch.magistrate.name} (not)`);
        }
        const towns = [home];
        if (source) towns.push({ q: source.tile.q, r: source.tile.r, s: source.s });
        StartKnowledge.prices(player, world, towns, 'h');
        if (home.s.kingdom != null) Library.learnRealm(player, home.s.kingdom, ['basics', 'ruler', 'economy']);
        const people = StartKnowledge.acquaint(player, world, home, 'fence', 1, `a fence in ${home.s.name}`);
        if (source) people.push(...StartKnowledge.acquaint(player, world, towns[1], 'smuggler', 1, `the gang's smuggler in ${source.s.name}`));
        if (people.length) lines.push(`your fence and smuggler: ${_list(people)}`);
        const spoken = [
            ...StartKnowledge.tongues(player, world, [StartKnowledge.townTongue(world, home)], 100),
            ...(source ? StartKnowledge.tongues(player, world, [StartKnowledge.townTongue(world, towns[1])], C.fluency) : []),
        ];
        if (spoken.length) lines.push(`the cant and tongues of the trade (${_list(spoken)})`);
        return { lines, library: null, charted };
    },

    // ── All together ───────────────────────────────────────

    /**
     * Give an advanced start what its position knows. Call after the start
     * is set up (player.scenario.start). → { lines, library } or null.
     */
    grant(player, world, originId) {
        const start = player && player.scenario && player.scenario.start;
        const fn = StartKnowledge[originId];
        if (!start || !world || typeof fn !== 'function' || start.kind !== originId) return null;
        const res = fn(player, world, start);
        if (!res) return null;
        player.scenario.knowledge = { lines: res.lines.slice(), library: res.library ? res.library.name : null, books: res.library ? res.library.books.length : 0 };
        return res;
    },

    /** The welcome's note (HTML: the notification renders it). */
    note(res) {
        if (!res || !res.lines.length) return '';
        const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
        let out = `<br><br>📜 <b>What you know:</b> ${res.lines.map(cap).join('. ')}.`;
        const lib = res.library;
        if (lib && lib.books.length) {
            out += `<br>📚 <b>${lib.name}</b> in ${lib.seat.town} holds ${_plural(lib.books.length, 'book')} of your own: ${_list(lib.books.map(b => b.title))}. Read them at its shelves to learn more.`;
        }
        return out;
    },
};
