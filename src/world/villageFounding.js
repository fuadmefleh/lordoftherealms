// ============================================
// VILLAGE FOUNDING — the player's own villages, founded by real settlers
// ============================================
//
// The world side of a founding expedition (the planning, the purse and the
// stores are systems/founding.js): what makes a site good or forbidden
// (`survey`), the settlers' walk there as one WorldUnit ('settler' with
// `unit.expedition`, moved by `travel` along its surveyed route), the village
// they found under the player (`arrive`: the people, grain, tools, timber and
// coin they carried are all it has — no market stock or purse from nowhere),
// and the village's life after (`processDay`, from Colonization.processTurn):
// it is fed and grows like any village (Economy's food model; a free holding
// outside any realm is fed here, since only realms run their towns'
// economies), grows fast while it is a young frontier (the dawn's village
// rule, data/dawn.json village.growthPerSeason), becomes a town by the dawn's
// rule (data/dawn.json town), and once crowded sends out a daughter party of
// its own people to found the next village (founding.bud). A village in a
// realm the player rules buds by the realm's own rule instead
// (KingdomAI.tryExpand). Three settlements held let the player proclaim a
// realm with one of them as its seat (systems/throne.js foundKingdom).
//
// Data: data/colonization.json `founding` (Colonization.FOUNDING). All
// randomness through Utils; world and player passed in, no globals.

import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { DataLoader } from '../core/dataLoader.js';
import { PlayerInventory } from '../core/inventory.js';
import { Kingdom } from './kingdom.js';
import { Economy } from './economy.js';
import { SettlementMarket } from './settlementMarket.js';
import { WorldUnit } from './units.js';
import { Colonization } from './colonization.js';
import { Names } from '../core/names.js';

const UNSETTLEABLE = new Set(['mountain', 'snow_peak', 'ice', 'snow']);
const WATER = new Set(['deep_ocean', 'ocean', 'coast', 'sea', 'lake']);
const FOREST = new Set(['woodland', 'boreal_forest', 'seasonal_forest', 'temperate_rainforest', 'tropical_rainforest']);
const ROCK = new Set(['hills', 'highlands', 'mountain']);

const _num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _fill = (s, vars) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
const _clamp5 = (v) => Math.max(0, Math.min(5, Math.round(v * 10) / 10));

export const VillageFounding = {
    /** data/colonization.json `founding` (installed by DataLoader as Colonization.FOUNDING) */
    cfg() {
        return Colonization.FOUNDING || {};
    },

    _dawn() {
        const g = DataLoader._gamedata;
        return (g && g.dawn) || {};
    },

    _dist(world, a, b) {
        return Hex.wrappingDistance(a.q, a.r, b.q, b.r, world.width);
    },

    _views(world) {
        return typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : world.getAllSettlements();
    },

    _near(world, q, r) {
        const out = [];
        for (const n of Hex.neighbors(q, r)) {
            const t = world.getTile(n.q, n.r);
            if (t) out.push(t);
        }
        return out;
    },

    /** The realm the player rules (kingdom.crown.playerRuled), or null */
    ruledRealm(world) {
        return ((world && world.kingdoms) || []).find(k => k && k.isAlive && k.crown && k.crown.playerRuled) || null;
    },

    /** Whose realm a village the player founds at `tile` falls in: theirs if they rule one, else their liege's land or no one's */
    ownerRealmId(world, player, tile) {
        const ruled = VillageFounding.ruledRealm(world);
        if (ruled) return ruled.id;
        const liege = player && player.allegiance ? world.getKingdom(player.allegiance) : null;
        if (liege && liege.isAlive && (!tile || !tile.kingdom || tile.kingdom === liege.id)) return liege.id;
        return null;
    },

    // ──────────── THE SITE ────────────

    /**
     * Survey a site for a new village. → {
     *   ok, reasons[] (why not), warnings[] (it can be done, but…),
     *   parts: { food, water, timber, stone, trade } (0-5 each), score (0-5),
     *   nearest: { name, d } | null, foreign: kingdom | null
     * }
     * opts: { player, from: {q, r} (the settlers' town: must be on the same land) }
     */
    survey(world, q, r, opts = {}) {
        const C = VillageFounding.cfg();
        const out = { q, r, ok: false, reasons: [], warnings: [], parts: { food: 0, water: 0, timber: 0, stone: 0, trade: 0 }, score: 0, nearest: null, foreign: null };
        const tile = world.getTile(q, r);
        if (!tile || !tile.terrain) { out.reasons.push('Off the map.'); return out; }
        out.q = tile.q; out.r = tile.r;
        out.terrain = tile.terrain.name || tile.terrain.id;
        const tid = tile.terrain.id;
        if (!tile.terrain.passable || WATER.has(tid)) out.reasons.push('No one can live on the water.');
        else if (UNSETTLEABLE.has(tid)) out.reasons.push(`Nothing grows on ${String(tile.terrain.name || tid).toLowerCase()}.`);
        if (tile.settlement) out.reasons.push(`${tile.settlement.name} already stands here.`);
        else if (tile.improvement) out.reasons.push('The ground is taken (ruins, a shrine or a monument).');
        else if (tile.playerProperty) out.reasons.push('Your own works stand here.');

        // Room around it
        const spacing = _num(C.minSpacing, 3);
        let nearest = null;
        for (const s of VillageFounding._views(world)) {
            const d = VillageFounding._dist(world, out, s);
            if (d === 0) continue;
            if (!nearest || d < nearest.d) nearest = { name: s.name, d, q: s.q, r: s.r, kingdom: s.kingdom || null };
        }
        out.nearest = nearest;
        if (nearest && nearest.d < spacing) out.reasons.push(`Too near ${nearest.name} (${nearest.d} hex${nearest.d === 1 ? '' : 'es'}; leave at least ${spacing}).`);
        // ...and room from parties already bound somewhere near
        for (const u of world.units || []) {
            if (!u || u.destroyed || !u.expedition || u === opts.ignoreUnit) continue;
            const d = VillageFounding._dist(world, out, { q: u.targetQ, r: u.targetR });
            if (d < spacing) { out.reasons.push(`Settlers are already bound for ${d === 0 ? 'this very spot' : 'land nearby'}.`); break; }
        }

        // Another realm's heartland is not for the taking
        const player = opts.player || null;
        const own = VillageFounding.ownerRealmId(world, player, null);
        const liege = player && player.allegiance ? player.allegiance : null;
        if (tile.kingdom && tile.kingdom !== own && tile.kingdom !== liege) {
            const k = world.getKingdom(tile.kingdom);
            if (k && k.isAlive) {
                out.foreign = k;
                const core = _num(C.coreRadius, 3);
                const heart = VillageFounding._views(world).some(s => s.kingdom === k.id && VillageFounding._dist(world, out, s) <= core);
                if (heart) out.reasons.push(`This is the heartland of ${Names.realm(k.name)}: their towns are within ${core} hexes.`);
                else out.warnings.push(`${k.name} claims this land; they will take it ill (relations ${_num(C.foreignRelation, -8)}).`);
            }
        }

        // The settlers walk: same land as their town
        if (opts.from) {
            const ft = world.getTile(opts.from.q, opts.from.r);
            if (ft && ft.regionId != null && tile.regionId != null && ft.regionId !== tile.regionId) out.reasons.push('Across the water: the settlers go overland.');
            const range = _num(C.maxRange, 16);
            const d = VillageFounding._dist(world, out, opts.from);
            out.distance = d;
            if (d > range) out.reasons.push(`Too far for a party on foot (${d} hexes; at most ${range}).`);
        }
        if (tile.indigenous && tile.indigenous.population > 0) out.warnings.push(`${tile.indigenous.name} live on this very ground.`);
        else if (Colonization.getNearbyIndigenous(world, tile.q, tile.r, 3).length) out.warnings.push('Native peoples live nearby.');

        Object.assign(out.parts, VillageFounding.siteParts(world, tile, nearest));
        const W = C.scoreWeights || { food: 1.5, water: 1.2, timber: 1, stone: 0.7, trade: 1 };
        let sum = 0, max = 0;
        for (const k of Object.keys(out.parts)) { sum += out.parts[k] * _num(W[k], 1); max += 5 * _num(W[k], 1); }
        out.score = max > 0 ? Math.round((sum / max) * 50) / 10 : 0;
        out.ok = out.reasons.length === 0;
        return out;
    },

    /** What the land around a site offers, 0-5 each: food, water, timber, stone, trade. Reads only. */
    siteParts(world, tile, nearest = null) {
        const S = VillageFounding._dawn().siteScore || {};
        const T = S.terrain || {};
        const near = VillageFounding._near(world, tile.q, tile.r);
        const ring = Hex.hexesInRange(tile.q, tile.r, 2).map(h => world.getTile(h.q, h.r)).filter(Boolean);
        const res = ring.filter(t => t.resource).map(t => t.resource.id || t.resource.type || '');
        const has = (ids) => res.filter(id => ids.includes(id)).length;

        // Food: good ground here and about (the dawn's site table), wheat, cattle, fish
        const land = [tile, ...near].filter(t => t.terrain && t.terrain.passable);
        const fert = land.length ? land.reduce((a, t) => a + _num(T[t.terrain.id], 0.5), 0) / land.length : 0;
        let food = fert * (5 / 3) + has(['wheat', 'cattle', 'fish']) * 1;
        if (tile.hasRiver) food += 0.5;
        // Water: a river through it, one beside it, a lake, the shore
        let water = 0;
        if (tile.hasRiver) water = 5;
        else if (near.some(t => t.hasRiver)) water = 3.5;
        if (near.some(t => t.terrain && t.terrain.id === 'lake')) water = Math.max(water, 4);
        else if (near.some(t => t.terrain && WATER.has(t.terrain.id))) water = Math.max(water, 3);
        // Timber and stone within two hexes
        const timber = ring.filter(t => t.terrain && FOREST.has(t.terrain.id)).length / 3 + has(['timber']) * 2;
        const stone = ring.filter(t => t.terrain && ROCK.has(t.terrain.id)).length / 2.5 + has(['stone', 'iron', 'coal']) * 1.5;
        // Trade: a road near, the shore, a river, a town within a few days, goods others want
        let trade = 0;
        if (ring.some(t => t.hasRoad)) trade += 2;
        if (near.some(t => t.terrain && WATER.has(t.terrain.id))) trade += 1;
        if (tile.hasRiver) trade += 0.75;
        if (nearest) trade += nearest.d <= 6 ? 1.5 : nearest.d <= 10 ? 0.75 : 0;
        trade += has(['spices', 'salt', 'gold_ore', 'gems', 'horses']) * 0.75;
        return { food: _clamp5(food), water: _clamp5(water), timber: _clamp5(timber), stone: _clamp5(stone), trade: _clamp5(trade) };
    },

    /** The best open sites within reach of `from`, best first. → surveys (ok ones only) */
    bestSites(world, from, opts = {}) {
        const C = VillageFounding.cfg();
        const minR = _num(opts.minRange, _num(C.minSpacing, 3));
        const maxR = Math.min(_num(opts.maxRange, 10), _num(C.maxRange, 16));
        const out = [];
        for (const h of Hex.hexesInRange(from.q, from.r, maxR)) {
            const t = world.getTile(h.q, h.r);
            if (!t || !t.terrain || !t.terrain.passable || t.settlement) continue;
            if (VillageFounding._dist(world, t, from) < minR) continue;
            const s = VillageFounding.survey(world, t.q, t.r, { player: opts.player, from });
            if (s.ok) out.push(s);
        }
        out.sort((a, b) => b.score - a.score || a.distance - b.distance);
        // Spread the picks out: no two within the spacing of each other
        const spacing = _num(C.minSpacing, 3);
        const picked = [];
        for (const s of out) {
            if (picked.some(p => VillageFounding._dist(world, p, s) < spacing)) continue;
            picked.push(s);
            if (picked.length >= _num(opts.limit, 5)) break;
        }
        return picked;
    },

    /** The settlers' way there overland: [{q, r}, …] from `from` to the site, or null */
    route(world, from, to) {
        if (typeof world.findRoadPath !== 'function') return null;
        return world.findRoadPath(from.q, from.r, to.q, to.r);
    },

    // ──────────── THE ROAD ────────────

    /**
     * One day of a founding party's walk (WorldUnit.updateSettler hands it
     * here): along its surveyed route, its speed's steps a day. Arrived, it
     * founds the village (`arrive`). A route that has come to nothing (a hex
     * flooded, a long wander) is surveyed again; a party out far longer than
     * its walk should take settles where it stands, or goes home.
     */
    travel(unit, world, player = null) {
        const ex = unit.expedition;
        if (!ex) return;
        ex.daysOut = (ex.daysOut || 0) + 1;
        const steps = typeof unit.stepsToday === 'function' ? unit.stepsToday(world) : Math.max(1, unit.speed || 1);
        for (let i = 0; i < steps; i++) {
            if (unit.q === unit.targetQ && unit.r === unit.targetR) break;
            let route = Array.isArray(ex.route) ? ex.route : null;
            let idx = route ? route.findIndex(p => p.q === unit.q && p.r === unit.r) : -1;
            let next = route && idx >= 0 ? route[idx + 1] : null;
            const nt = next && world.getTile(next.q, next.r);
            if (!nt || !nt.terrain || !nt.terrain.passable) {
                route = VillageFounding.route(world, unit, { q: unit.targetQ, r: unit.targetR });
                ex.route = route;
                next = route && route.length > 1 ? route[1] : null;
            }
            if (!next) { unit.moveTowardsTarget(world); continue; }
            unit.q = next.q;
            unit.r = next.r;
        }
        if (unit.q === unit.targetQ && unit.r === unit.targetR) {
            VillageFounding.arrive(unit, world, player);
            unit.destroyed = true;
            return;
        }
        const limit = _num(ex.days, 10) * 3 + 20;
        if (ex.daysOut > limit) {
            const here = VillageFounding.survey(world, unit.q, unit.r, { player, ignoreUnit: unit });
            if (here.ok) {
                unit.targetQ = unit.q; unit.targetR = unit.r;
                VillageFounding.arrive(unit, world, player);
            } else {
                VillageFounding._goHome(unit, world, player, 'lost their way');
            }
            unit.destroyed = true;
        }
    },

    /**
     * The party reaches its site: the village is founded under the player
     * (their holding; in their realm if they rule one). If the site was
     * taken while they walked they look about for open ground within a couple
     * of hexes, and failing that go home.
     */
    arrive(unit, world, player = null) {
        const ex = unit.expedition || {};
        let site = VillageFounding.survey(world, unit.targetQ, unit.targetR, { player, ignoreUnit: unit });
        if (!site.ok) {
            let best = null;
            for (const h of Hex.hexesInRange(unit.targetQ, unit.targetR, 2)) {
                const s = VillageFounding.survey(world, h.q, h.r, { player, ignoreUnit: unit });
                if (s.ok && (!best || s.score > best.score)) best = s;
            }
            if (!best) return VillageFounding._goHome(unit, world, player, site.reasons[0] || 'the land was taken');
            site = best;
        }
        return VillageFounding.found(world, player, site, unit);
    },

    /** Raise the village: everything it has came with its people. → the settlement */
    found(world, player, site, unit) {
        const C = VillageFounding.cfg();
        const L = C.lines || {};
        const ex = unit.expedition || {};
        const tile = world.getTile(site.q, site.r);
        const ownerId = ex.realmId !== undefined && ex.realmId !== null && world.getKingdom(ex.realmId) && world.getKingdom(ex.realmId).isAlive
            ? ex.realmId : VillageFounding.ownerRealmId(world, player, tile);
        const realm = ownerId ? world.getKingdom(ownerId) : null;
        const culture = ex.culture || (realm && realm.culture) || 'Imperial';
        const name = (ex.name && String(ex.name).trim()) || Kingdom.generateCityName(culture, world);
        const people = Math.max(1, Math.round(_num(unit.population, 0)));

        tile.settlement = {
            type: 'village',
            name,
            population: people,
            level: 0,
            kingdom: ownerId,
            founded: world.year,
            foundedDay: world.day,
            culture,
            playerFounded: true,
            foundedBy: ex.founder || (player && player.name) || null,
            motherTown: ex.sourceName || null,
            // (no coin or grain but what the settlers carried: Economy.initSettlement)
            freshPurse: true,
        };
        if (typeof world.invalidateSettlements === 'function') world.invalidateSettlements();
        const s = tile.settlement;
        Economy.initSettlement(s, { fresh: true });
        // The market holds what the settlers brought, nothing more
        const m = SettlementMarket.ensure(s);
        if (m && m.stock) for (const id of Object.keys(m.stock)) m.stock[id] = 0;
        const inv = { ...(unit.inventory || {}) };
        for (const [id, n] of Object.entries(ex.purseGoods || {})) inv[id] = _num(inv[id], 0) + _num(n, 0);
        const grain = Math.max(0, _num(inv.grain, 0)) + Math.max(0, _num(inv.food, 0));
        // Grain into the granary (a unit feeds as a unit of food); tools and timber to the stores
        s.economy.food = Math.round(grain);
        for (const [id, n] of Object.entries(inv)) {
            if (id === 'grain' || id === 'food' || !(n > 0)) continue;
            SettlementMarket.add(s, id, n);
        }
        s.economy.gold = Math.max(0, Math.round(_num(ex.coin, 0)));

        // The colony's record: the player's own, with its policy and recruitment
        const policyId = Colonization.POLICIES && Colonization.POLICIES[ex.policy] ? ex.policy : 'coexistence';
        s.colony = {
            loyalty: _num(C.startLoyalty, 75),
            foundedDay: world.day,
            motherKingdom: ownerId,
            governor: null,
            garrisonStrength: 0,
            indigenousRelation: 0,
            isPlayerColony: true,
            policy: policyId,
            recruitment: { recruited: 0, enRoute: 0, incentive: 'none', incentiveCost: 0, signboard: false, reputation: 0, lastRecruitDay: 0 },
        };

        // The land: the realm's, and the hexes about it that no one holds
        if (site.foreign && site.foreign.id !== ownerId) {
            const k = site.foreign;
            k.territory = (k.territory || []).filter(t => t.q !== tile.q || t.r !== tile.r);
            if (ownerId && k.relations) {
                const pen = _num(C.foreignRelation, -8);
                k.relations[ownerId] = Utils.clamp(_num(k.relations[ownerId], 0) + pen, -100, 100);
                if (realm && realm.relations) realm.relations[k.id] = Utils.clamp(_num(realm.relations[k.id], 0) + pen, -100, 100);
            }
            if (player && player.reputation) player.reputation[k.id] = _num(player.reputation[k.id], 0) + _num(C.foreignRelation, -8);
            tile.kingdom = null;
        }
        if (realm) {
            tile.kingdom = realm.id;
            if (!(realm.territory || []).some(t => t.q === tile.q && t.r === tile.r)) realm.territory.push({ q: tile.q, r: tile.r });
            for (const nt of VillageFounding._near(world, tile.q, tile.r)) {
                if (!nt.terrain || !nt.terrain.passable || nt.kingdom || nt.settlement) continue;
                nt.kingdom = realm.id;
                realm.territory.push({ q: nt.q, r: nt.r });
            }
            if (!realm.colonization) realm.colonization = { policy: policyId, colonies: [], pioneersActive: 0 };
            realm.colonization.colonies.push({ q: tile.q, r: tile.r, name });
        }

        if (player) {
            if (!player.colonies) player.colonies = [];
            if (!player.colonies.some(c => c.q === tile.q && c.r === tile.r)) {
                player.colonies.push({ q: tile.q, r: tile.r, name, foundedDay: world.day, founded: true });
            }
            const st = VillageFounding.state(player);
            st.founded = (st.founded || 0) + 1;
        }

        // Neighbours meet the newcomers by the policy's lights
        const policy = Colonization.POLICIES[policyId] || {};
        for (const ind of Colonization.getNearbyIndigenous(world, tile.q, tile.r, 4)) {
            ind.relation = Utils.clamp((ind.relation || 0) + _num(policy.indigenousRelation, 0) * 20, -100, 100);
            ind.discovered = true;
        }

        const text = _fill(ex.bud ? L.budFounded : L.founded, { name, people, from: ex.sourceName || 'their town' })
            || `🏘️ ${people} settlers from ${ex.sourceName || 'their town'} have founded ${name}.`;
        world.events.push({ text, type: 'colonization', category: 'ECONOMIC', founding: { q: tile.q, r: tile.r, name } });
        return s;
    },

    /** The party gives up: the people go back to their town with what they carried */
    _goHome(unit, world, player, why) {
        const ex = unit.expedition || {};
        const C = VillageFounding.cfg();
        const L = C.lines || {};
        const home = ex.sourceQ != null ? world.getTile(ex.sourceQ, ex.sourceR) : null;
        const s = home && home.settlement;
        if (s) {
            s.population = Math.round(_num(s.population, 0) + _num(unit.population, 0));
            for (const [id, n] of Object.entries(unit.inventory || {})) {
                if (!(n > 0)) continue;
                if (id === 'grain' || id === 'food') { Economy.initSettlement(s); s.economy.food = _num(s.economy.food, 0) + n; } else SettlementMarket.add(s, id, n);
            }
        }
        // Purses paid in goods go back to the player
        if (player && ex.purseGoods && !ex.bud) {
            for (const [id, n] of Object.entries(ex.purseGoods)) if (n > 0) PlayerInventory.addItem(player, id, n, { force: true });
        }
        // Their purse: the player's coin goes back to the player; a town's daughters' to the town
        const coin = Math.max(0, Math.round(_num(ex.coin, 0)));
        if (coin > 0) {
            if (ex.bud && s) { Economy.initSettlement(s); s.economy.gold = _num(s.economy.gold, 0) + coin; } else if (player) player.gold = _num(player.gold, 0) + coin;
        }
        world.events.push({
            text: _fill(L.wentHome, { from: ex.sourceName || 'their town', why: why || 'the land was taken' }) || `The settlers bound out of ${ex.sourceName || 'their town'} have gone home: ${why}.`,
            type: 'colonization', category: 'ECONOMIC',
        });
        return null;
    },

    // ──────────── THE YEARS ────────────

    /** The player's founding record (player.founding, saved): { founded, budded, bud (let villages send daughters) } */
    state(player) {
        if (!player.founding || typeof player.founding !== 'object') player.founding = { founded: 0, budded: 0, bud: true };
        if (player.founding.bud === undefined) player.founding.bud = true;
        return player.founding;
    },

    /** The live settlements the player holds through player.colonies: [{ q, r, tile, settlement }] */
    _held(world, player) {
        const out = [];
        for (const c of (player && player.colonies) || []) {
            const t = world.getTile(c.q, c.r);
            if (t && t.settlement) out.push({ q: t.q, r: t.r, tile: t, settlement: t.settlement });
        }
        return out;
    },

    /**
     * The player's villages through the year (Colonization.processTurn):
     *  - a holding outside any realm is fed like a realm's towns (Economy's
     *    food model) — and an empty one takes in the settlers recruited for it;
     *  - founded villages grow fast while young, become towns, and bud.
     */
    processDay(world, player = null, playerBonuses = {}) {
        if (!player || !Array.isArray(player.colonies) || !player.colonies.length) return;
        const day = world.day || 0;
        const held = VillageFounding._held(world, player);
        for (const h of held) {
            const s = h.settlement;
            const realm = s.kingdom ? world.getKingdom(s.kingdom) : null;
            if (realm && realm.isAlive) continue;
            // No realm runs this place's year: an empty colony takes in its recruits,
            // a peopled one is fed and grows by the food model
            if (s.colony && s.colony.isPlayerColony && s.population < 10) {
                Colonization._processSettlerArrivals(h.tile, world);
            } else if (s.population > 0) {
                Economy.produceDaily(s, h.tile, world, playerBonuses, {
                    production: Colonization.getProductionBonus(s, null),
                    damage: s.damage || 0,
                });
            }
        }
        if (day % 30 === 0) VillageFounding._frontierGrowth(world, held);
        if (day % 30 === 15) VillageFounding._raiseTowns(world, held);
        const B = VillageFounding.cfg().bud || {};
        if (day > 0 && day % _num(B.everyDays, 120) === 0 && VillageFounding.state(player).bud !== false) VillageFounding._bud(world, player, held);
    },

    /** Young founded villages fill fast: the dawn's frontier rule, tapering as they near what their kind can feed */
    _frontierGrowth(world, held) {
        const C = VillageFounding.cfg();
        const G = C.growth || {};
        const rate = _num(G.perSeason, _num((VillageFounding._dawn().village || {}).growthPerSeason, 0.03));
        const years = _num(G.frontierYears, 30);
        for (const { settlement: s } of held) {
            if (!s.playerFounded || !(s.population > 0)) continue;
            if ((world.year || 0) - _num(s.founded, world.year) >= years) continue;
            const cap = _num((Economy.FOOD && Economy.FOOD.capacity || {})[s.type], 1500);
            const taper = Math.max(0, 1 - s.population / cap);
            if (taper <= 0) continue;
            s.population = Math.round(s.population * (1 + rate * taper * (0.5 + Utils.random())));
        }
    },

    /** Big, old enough founded villages become towns (the dawn's rule: data/dawn.json town) */
    _raiseTowns(world, held) {
        const T = VillageFounding._dawn().town || {};
        const L = VillageFounding.cfg().lines || {};
        let raised = false;
        for (const { settlement: s } of held) {
            if (!s.playerFounded || s.type !== 'village') continue;
            const age = (world.year || 0) - _num(s.founded, world.year);
            if (s.population < _num(T.population, 450) || age < _num(T.minAgeYears, 12)) continue;
            s.type = 'town';
            s.level = Math.max(1, s.level || 0);
            raised = true;
            world.events.push({ text: _fill(L.town, { name: s.name }) || `🏘️ ${s.name} has grown into a town.`, type: 'colonization', category: 'ECONOMIC' });
        }
        if (raised && typeof world.invalidateSettlements === 'function') world.invalidateSettlements();
    },

    /**
     * A crowded founded village sends a party of its own people out to found
     * the next one (the dawn's budding rule), with grain from its granary,
     * tools from its stores and a little of its purse. One party in the field
     * per village. Villages in a realm the player rules bud by the realm's
     * rule (KingdomAI.tryExpand) instead.
     */
    _bud(world, player, held) {
        const C = VillageFounding.cfg();
        const B = C.bud || {};
        const ruled = VillageFounding.ruledRealm(world);
        for (const h of held) {
            const s = h.settlement;
            if (!s.playerFounded || (ruled && s.kingdom === ruled.id)) continue;
            if (s.population < _num(B.minPopulation, 400)) continue;
            if ((world.units || []).some(u => u && !u.destroyed && u.expedition && u.expedition.sourceQ === h.q && u.expedition.sourceR === h.r)) continue;
            if (Utils.random() >= _num(B.chance, 0.25)) continue;
            const sites = VillageFounding.bestSites(world, h, { player, minRange: _num(B.minRange, 3), maxRange: _num(B.maxRange, 7), limit: 1 });
            const site = sites[0];
            if (!site) continue;
            const route = VillageFounding.route(world, h, site);
            if (!route) continue;
            const n = Math.min(_num(B.settlers, 30), Math.max(0, s.population - _num(C.minLeft, 60)));
            if (n < _num(C.minSettlers, 10)) continue;
            const sup = C.supplies || {};
            Economy.initSettlement(s);
            const grain = Math.min(Math.max(0, _num(s.economy.food, 0)), Math.ceil(n * _num(sup.grain, 3)));
            s.economy.food -= grain;
            const inventory = { grain };
            for (const id of ['tools', 'wood']) {
                const want = Math.ceil(n * _num(sup[id], 0));
                const got = want > 0 ? SettlementMarket.take(s, id, want) : 0;
                if (got > 0) inventory[id] = got;
            }
            const coin = Math.min(Math.floor(Math.max(0, _num(s.economy.gold, 0)) * 0.1), n * _num(C.settlerPurse, 8));
            s.economy.gold = _num(s.economy.gold, 0) - coin;
            s.population -= n;
            VillageFounding.spawnParty(world, {
                from: h, site, people: n, inventory, coin, route,
                sourceName: s.name, culture: s.culture || null, policy: (s.colony && s.colony.policy) || 'coexistence',
                realmId: s.kingdom || null, founder: player.name, bud: true,
            });
            VillageFounding.state(player).budded = (VillageFounding.state(player).budded || 0) + 1;
            world.events.push({ text: _fill((C.lines || {}).bud, { name: s.name, people: n }) || `🧭 ${n} of ${s.name}'s people have set out to found a village of their own.`, type: 'colonization', category: 'ECONOMIC' });
        }
    },

    /**
     * Put a founding party on the map. o = { from: {q, r}, site: {q, r},
     * people, inventory, coin, route, sourceName, culture, policy, realmId,
     * name, founder, bud }. → the WorldUnit
     */
    spawnParty(world, o) {
        const unit = new WorldUnit('settler', o.from.q, o.from.r, o.site.q, o.site.r);
        unit.population = Math.max(1, Math.round(o.people));
        unit.inventory = { ...(o.inventory || {}) };
        unit.name = o.name ? `Settlers for ${o.name}` : `Settlers out of ${o.sourceName || 'town'}`;
        unit.isPlayerPioneer = true;
        unit.playerOwned = true;
        const route = Array.isArray(o.route) ? o.route.map(p => ({ q: p.q, r: p.r })) : null;
        const speed = Math.max(1, _num(unit.speed, 2));
        unit.expedition = {
            sourceQ: o.from.q, sourceR: o.from.r, sourceName: o.sourceName || null,
            name: o.name || null, culture: o.culture || null, policy: o.policy || 'coexistence',
            realmId: o.realmId || null, coin: Math.max(0, Math.round(_num(o.coin, 0))),
            // a barter town's settlers are paid in goods, carried as their purse (world/barter.js)
            purseGoods: o.purseGoods && Object.keys(o.purseGoods).length ? { ...o.purseGoods } : null,
            founder: o.founder || null, bud: !!o.bud, route,
            days: Math.max(1, Math.ceil(((route ? route.length : 2) - 1) / speed)),
            setOut: world.day || 0, daysOut: 0,
        };
        world.units.push(unit);
        return unit;
    },

    /** The founding parties of the player's on the road: [{ unit, name, from, to, days }] */
    partiesAfield(world) {
        return (world.units || []).filter(u => u && !u.destroyed && u.expedition).map(u => ({
            unit: u, name: u.expedition.name || null, from: u.expedition.sourceName, people: u.population,
            to: { q: u.targetQ, r: u.targetR }, daysLeft: Math.max(0, _num(u.expedition.days, 0) - _num(u.expedition.daysOut, 0)), bud: !!u.expedition.bud,
        }));
    },
};
