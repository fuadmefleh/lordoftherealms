// ============================================
// DAWN — a world begun before any town (the Dawn of Man)
// ============================================
//
// A world whose start year (generationParams.startYear) is earlier than
// data/dawn.json `dawnYear` has terrain, rivers and beasts but no realm,
// town, road or ruin. Wandering clans (WorldUnit 'clan') roam the land,
// drawn to good ground — rivers, lakes, shores, fertile plains — and in time
// make camp for good: a village, joined to its neighbours by a trodden path
// (World.layRoad). Villages grow quickly while the world is young, send out
// new clans, and become towns; a town with villages about it gathers them
// into a chiefdom — a realm like any other from then on (Kingdom AI, lords,
// a royal family, wars). Once the world holds as many realms as its
// generation asked for (kingdomCount) no more chiefdoms form, and once the
// last clan has settled the dawn is over and the world runs as usual.
//
// State lives on world.dawn (saved by Dawn.serialize / Dawn.restore, with the
// paths laid since the world began — regeneration from the seed doesn't
// know them). All randomness through Utils; world passed in, no globals.

import { Utils } from '../core/utils.js';
import { Shipcraft } from './shipcraft.js';
import { Hex } from '../core/hex.js';
import { DataLoader } from '../core/dataLoader.js';
import { Kingdom } from './kingdom.js';
import { NPCLords } from './npcLords.js';
import { Characters } from './characters.js';
import { Economy } from './economy.js';
import { WorldUnit } from './units.js';

const UNSETTLEABLE = new Set(['mountain', 'snow_peak', 'ice', 'snow']);
const WATER = new Set(['deep_ocean', 'ocean', 'coast', 'sea', 'lake']);

const _num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _fill = (s, vars) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));

export const Dawn = {
    /** The year the calendar starts at when no start year is chosen */
    DEFAULT_YEAR: 853,

    data() {
        const g = DataLoader._gamedata;
        return (g && g.dawn) || {};
    },

    /** Start years before this begin at the dawn */
    dawnYear() {
        return _num(Dawn.data().dawnYear, 200);
    },

    /** The calendar year a world with these generation params starts in */
    startYear(params) {
        const y = Math.floor(Number(params && params.startYear));
        return Number.isFinite(y) && y >= 1 ? y : Dawn.DEFAULT_YEAR;
    },

    /** Do these generation params begin before any town? */
    isDawnStart(params) {
        return Dawn.startYear(params) < Dawn.dawnYear();
    },

    /** Is this world still in its dawn (clans abroad or realms yet to form)? */
    isActive(world) {
        return !!(world && world.dawn && !world.dawn.over);
    },

    // ──────────── THE LAND ────────────

    _tile(world, q, r) {
        if (r < 0 || r >= world.height) return null;
        return world.tiles[r][Hex.wrapQ(q, world.width)];
    },

    _near(world, t) {
        const out = [];
        for (const n of Hex.neighbors(t.q, t.r)) {
            const nt = Dawn._tile(world, n.q, n.r);
            if (nt) out.push(nt);
        }
        return out;
    },

    /** How good a place this is to stay: fertile ground, fresh water, the shore */
    siteScore(world, t) {
        if (!t || !t.terrain || !t.terrain.passable || UNSETTLEABLE.has(t.terrain.id)) return 0;
        const S = Dawn.data().siteScore || {};
        const T = S.terrain || {};
        let score = _num(T[t.terrain.id], 1);
        if (t.hasRiver) score += _num(S.river, 3);
        const near = Dawn._near(world, t);
        if (!t.hasRiver && near.some(n => n.hasRiver)) score += _num(S.riverNear, 1.5);
        if (near.some(n => n.terrain && n.terrain.id === 'lake')) score += _num(S.lakeNear, 2);
        else if (near.some(n => n.terrain && WATER.has(n.terrain.id))) score += _num(S.coastNear, 1.5);
        if (t.resource) score += _num(S.resource, 1);
        return score;
    },

    /** Can a clan settle here: open land, no settlement within the spacing */
    canSettle(world, t) {
        if (!t || !t.terrain || !t.terrain.passable || UNSETTLEABLE.has(t.terrain.id)) return false;
        if (t.settlement || t.improvement) return false;
        const spacing = _num((Dawn.data().clans || {}).minSpacing, 4);
        for (const s of Dawn._views(world)) {
            if (Hex.wrappingOffsetDistance(t.q, t.r, s.q, s.r, world.width) < spacing) return false;
        }
        return true;
    },

    /** Every settlement, read-only (q/r stamped) */
    _views(world) {
        return typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : world.getAllSettlements();
    },

    _cultureFor(t) {
        const C = Dawn.data().cultures || {};
        return (C.byTerrain && t && t.terrain && C.byTerrain[t.terrain.id]) || C.default || 'Woodland';
    },

    // ──────────── GENESIS ────────────

    /**
     * Set a freshly generated, empty world going: the dawn's state and its
     * first clans, scattered over good land, and where the player begins
     * (beside a clan on a landmass worth walking). Called by World generation.
     */
    seed(world, params = {}) {
        const C = Dawn.data().clans || {};
        world.dawn = {
            startYear: Dawn.startYear(params),
            realmTarget: Math.max(1, _num(params.kingdomCount, 6)),
            clansFormed: 0, villagesFounded: 0, townsRisen: 0, realmsBorn: 0,
            realmsDone: false, over: false,
            nameSeq: 0,
            paths: {},
        };

        const land = [];
        for (const row of world.tiles) for (const t of row) if (t.terrain.passable && !UNSETTLEABLE.has(t.terrain.id)) land.push(t);
        const count = Utils.clamp(Math.round(land.length / _num(C.perLandHexes, 90)), _num(C.min, 6), _num(C.max, 40));

        const placed = [];
        const good = land.filter(t => Dawn.siteScore(world, t) >= 2);
        const pool = good.length >= count ? good : land;
        for (let i = 0; i < count * 30 && placed.length < count && pool.length; i++) {
            const t = pool[Utils.randInt(0, pool.length - 1)];
            if (placed.some(p => Hex.wrappingOffsetDistance(p.q, p.r, t.q, t.r, world.width) < 5)) continue;
            placed.push(t);
            world.units.push(Dawn.makeClan(world, t.q, t.r, null));
        }

        // The player begins beside a clan on the largest-looking landmass
        let best = null;
        for (const t of placed) {
            const reach = Dawn._landReach(world, t, 40);
            if (!best || reach > best.reach) best = { t, reach };
        }
        if (best) world.playerStart = { q: best.t.q, r: best.t.r };
        return placed.length;
    },

    /** A new wandering clan at (q, r) — of a culture, or the land's own */
    makeClan(world, q, r, culture) {
        const D = Dawn.data();
        const C = D.clans || {};
        const clan = new WorldUnit('clan', q, r);
        const names = D.clanNames && D.clanNames.length ? D.clanNames : ['Wolf'];
        const seq = world.dawn ? world.dawn.nameSeq++ : 0;
        const base = names[seq % names.length];
        const gen = Math.floor(seq / names.length);
        clan.clanName = gen ? `${base} ${['', 'Younger', 'Third', 'Fourth', 'Fifth'][Math.min(gen, 4)] || gen + 1}`.trim() : base;
        clan.name = `${clan.clanName} Clan`;
        clan.culture = culture || Dawn._cultureFor(Dawn._tile(world, q, r));
        clan.maxAge = 1e9; // a clan lasts until it settles
        const W = C.wanderDays || {};
        clan.wanderFor = Utils.randInt(_num(W.min, 25), _num(W.max, 110));
        clan.daysOut = 0;
        clan.targetQ = null;
        clan.targetR = null;
        if (world.dawn) world.dawn.clansFormed++;
        return clan;
    },

    _landReach(world, from, cap) {
        const seen = new Set([`${from.q},${from.r}`]);
        const queue = [from];
        let count = 0;
        while (queue.length && count < cap) {
            const t = queue.shift();
            count++;
            for (const n of Dawn._near(world, t)) {
                const key = `${n.q},${n.r}`;
                if (seen.has(key) || !n.terrain.passable) continue;
                seen.add(key);
                queue.push(n);
            }
        }
        return count;
    },

    // ──────────── THE DAY ────────────

    /**
     * One day of the dawn: clans roam and settle (the player's own clan
     * keeps with them while they are near); every so often villages grow,
     * bud, rise, gather. `player` is passed by the world tick (may be null).
     */
    processDay(world, player = null) {
        if (!Dawn.isActive(world)) return;
        const D = Dawn.data();
        const st = world.dawn;

        for (const clan of world.units) {
            if (clan.type !== 'clan' || clan.destroyed) continue;
            if (clan.kinOfPlayer && player && Dawn._followPlayer(world, clan, player)) continue;
            Dawn._clanDay(world, clan);
        }

        const day = world.day || 0;
        if (day % 30 === 0) Dawn._grow(world);
        if (!st.realmsDone && day % _num((D.budding || {}).everyDays, 30) === 0) Dawn._bud(world);
        if (day % 30 === 15) Dawn._raiseTowns(world);
        if (!st.realmsDone && day % _num((D.chiefdom || {}).everyDays, 60) === 0) Dawn._gatherRealms(world);

        if (st.realmsDone && !world.units.some(u => u.type === 'clan' && !u.destroyed)) {
            st.over = true;
            st.overYear = world.year;
        }
    },

    /** The player's clan, if it still wanders (null once it has settled or is gone) */
    kinClan(world, player) {
        if (!world || !player || !player.dawnClan) return null;
        return world.units.find(u => u.type === 'clan' && !u.destroyed && u.id === player.dawnClan) || null;
    },

    /**
     * The player's clan keeps with them while they are within followRange:
     * it walks up to two hexes a day toward them and doesn't settle without
     * them (they choose where: Dawn.settleWithPlayer). Too far off — gone
     * riding or sailing — and it goes its own way (and may settle). → true when it followed.
     */
    _followPlayer(world, clan, player) {
        const C = Dawn.data().clans || {};
        const range = _num(C.followRange, 6);
        const d = Hex.wrappingOffsetDistance(clan.q, clan.r, player.q, player.r, world.width);
        if (d > range) return false;
        const pt = Dawn._tile(world, player.q, player.r);
        const ct = Dawn._tile(world, clan.q, clan.r);
        if (!pt || !ct || !pt.terrain.passable || pt.regionId !== ct.regionId) return false;
        clan.daysOut = (clan.daysOut || 0) + 1;
        for (let i = 0; i < 2 && (clan.q !== player.q || clan.r !== player.r); i++) {
            const cur = Dawn._tile(world, clan.q, clan.r);
            let step = null;
            let best = Hex.wrappingOffsetDistance(clan.q, clan.r, player.q, player.r, world.width);
            for (const n of Dawn._near(world, cur)) {
                if (!n.terrain.passable) continue;
                const nd = Hex.wrappingOffsetDistance(n.q, n.r, player.q, player.r, world.width);
                if (nd < best) { step = n; best = nd; }
            }
            if (!step) break;
            clan.q = step.q;
            clan.r = step.r;
        }
        clan.targetQ = player.q;
        clan.targetR = player.r;
        return true;
    },

    /**
     * The player's clan makes camp for good where the player stands: a
     * village, their home. → { success, settlement } or { success: false, reason }.
     */
    settleWithPlayer(world, player) {
        const clan = Dawn.kinClan(world, player);
        if (!clan) return { success: false, reason: 'Your clan is not with you.' };
        if (Hex.wrappingOffsetDistance(clan.q, clan.r, player.q, player.r, world.width) > 1) {
            return { success: false, reason: 'Your clan is not here yet — wait for them to catch up.' };
        }
        const tile = Dawn._tile(world, player.q, player.r);
        if (!tile || !tile.terrain.passable || UNSETTLEABLE.has(tile.terrain.id)) return { success: false, reason: 'No one could live here.' };
        if (tile.settlement || tile.improvement) return { success: false, reason: 'This ground is already taken.' };
        if (!Dawn.canSettle(world, tile)) return { success: false, reason: 'Another village stands too near. Find open land farther off.' };
        clan.q = tile.q;
        clan.r = tile.r;
        const settlement = Dawn.foundVillage(world, clan, tile);
        return { success: true, settlement, score: Dawn.siteScore(world, tile) };
    },

    _clanDay(world, clan) {
        const C = Dawn.data().clans || {};
        clan.daysOut = (clan.daysOut || 0) + 1;
        const here = Dawn._tile(world, clan.q, clan.r);
        const score = Dawn.siteScore(world, here);
        const minScore = _num(C.minSiteScore, 4);
        const ready = clan.daysOut >= (clan.wanderFor || 60);
        const desperate = clan.daysOut >= _num(C.giveUpDays, 400);
        if ((ready && score >= minScore) || (desperate && score >= 1)) {
            if (Dawn.canSettle(world, here)) {
                Dawn.foundVillage(world, clan, here);
                return;
            }
        }

        // Where to go: the best ground in sight (a little chance in the choice)
        const atTarget = clan.targetQ == null || (clan.q === clan.targetQ && clan.r === clan.targetR);
        if (atTarget || clan.daysOut % 20 === 0) {
            const radius = _num(C.scanRadius, 4);
            let best = null;
            for (const h of Hex.hexesInRange(clan.q, clan.r, radius)) {
                const t = Dawn._tile(world, h.q, h.r);
                if (!t || t === here || !t.terrain.passable || t.regionId !== here.regionId) continue;
                if (!Dawn.canSettle(world, t)) continue;
                const v = Dawn.siteScore(world, t) + Utils.random() * 2;
                if (!best || v > best.v) best = { t, v };
            }
            if (best) { clan.targetQ = best.t.q; clan.targetR = best.t.r; }
            else {
                // Nowhere good in sight: drift
                const n = Utils.randPick(Dawn._near(world, here).filter(t => t.terrain.passable));
                if (n) { clan.targetQ = n.q; clan.targetR = n.r; }
            }
        }

        for (let i = 0; i < _num(C.stepsPerDay, 1); i++) {
            if (clan.targetQ == null || (clan.q === clan.targetQ && clan.r === clan.targetR)) break;
            const cur = Dawn._tile(world, clan.q, clan.r);
            let step = null;
            let stepD = Hex.wrappingOffsetDistance(clan.q, clan.r, clan.targetQ, clan.targetR, world.width);
            for (const n of Dawn._near(world, cur)) {
                if (!n.terrain.passable) continue;
                const d = Hex.wrappingOffsetDistance(n.q, n.r, clan.targetQ, clan.targetR, world.width);
                if (d < stepD) { step = n; stepD = d; }
            }
            if (!step) { clan.targetQ = null; clan.targetR = null; break; }
            clan.q = step.q;
            clan.r = step.r;
        }
    },

    /** A clan stays: a village, and a path to the nearest neighbour */
    foundVillage(world, clan, tile) {
        const D = Dawn.data();
        const V = D.village || {};
        const L = D.lines || {};
        const P = V.population || {};
        const name = Kingdom.generateCityName(clan.culture || 'Woodland', world);
        tile.settlement = {
            type: 'village',
            name,
            population: Utils.randInt(_num(P.min, 60), _num(P.max, 150)) + Math.round((clan.population || 0) / 2),
            level: 0,
            kingdom: tile.kingdom || null,
            founded: world.year,
            culture: clan.culture || null,
            dawnBorn: true,
            foundedBy: clan.name,
        };
        Economy.initSettlement(tile.settlement);
        if (typeof world.invalidateSettlements === 'function') world.invalidateSettlements();
        clan.destroyed = true;
        world.dawn.villagesFounded++;
        // The player's own people: their home now (player/dawnBirth.js moves the family in)
        if (clan.kinOfPlayer) {
            tile.settlement.playerKin = true;
            world.dawn.kinHome = { q: tile.q, r: tile.r, name, day: world.day, clanId: clan.id };
        }

        const near = Dawn._near(world, tile);
        const where = tile.hasRiver || near.some(n => n.hasRiver) ? L.whereRiver
            : near.some(n => n.terrain.id === 'lake') ? L.whereLake
                : near.some(n => WATER.has(n.terrain.id)) ? L.whereCoast : L.whereLand;
        world.events.push({ text: `🔥 ${_fill(L.settle, { clan: clan.clanName || clan.name, where: where || '', name })}`, type: 'growth' });

        // A trodden path to the nearest village on the same land
        let nearest = null;
        for (const s of world.getAllSettlements()) {
            if (s.q === tile.q && s.r === tile.r) continue;
            const st = Dawn._tile(world, s.q, s.r);
            if (!st || st.regionId !== tile.regionId) continue;
            const d = Hex.wrappingOffsetDistance(tile.q, tile.r, s.q, s.r, world.width);
            if (d <= _num(V.pathRange, 9) && (!nearest || d < nearest.d)) nearest = { s, d };
        }
        if (nearest && typeof world.findRoadPath === 'function') {
            const path = world.findRoadPath(tile.q, tile.r, nearest.s.q, nearest.s.r);
            if (path) {
                world.layRoad(path);
                for (const step of path) {
                    const t = Dawn._tile(world, step.q, step.r);
                    if (t && t.hasRoad) world.dawn.paths[`${t.q},${t.r}`] = t.roadLinks || 0;
                }
                world.events.push({ text: `🥾 ${_fill(L.path, { a: name, b: nearest.s.name })}`, type: 'growth' });
            }
        }
        return tile.settlement;
    },

    /** The young world's villages fill fast: a frontier bonus on top of their food-fed growth */
    _grow(world) {
        // (checked every 30 days — a season: a year is four seasons of 30 days)
        const rate = _num((Dawn.data().village || {}).growthPerSeason, 0.06);
        for (const s of world.getAllSettlements()) {
            const live = Dawn._tile(world, s.q, s.r).settlement;
            if (!live || !live.dawnBorn) continue;
            // ...tapering as the place nears what its kind of settlement can feed
            // (Economy.FOOD.capacity), so the frontier bonus can't compound forever
            const cap = _num((Economy.FOOD && Economy.FOOD.capacity || {})[live.type], 1500);
            const taper = Math.max(0, 1 - live.population / cap);
            if (taper <= 0) continue;
            live.population = Math.round(live.population * (1 + rate * taper * (0.5 + Utils.random())));
        }
    },

    /** Crowded villages send families out as a new clan, while there's land to take */
    _bud(world) {
        const B = Dawn.data().budding || {};
        const L = Dawn.data().lines || {};
        const settlements = world.getAllSettlements();
        let land = 0;
        for (const row of world.tiles) for (const t of row) if (t.terrain.passable) land++;
        const cap = Math.max(4, Math.round(land / _num(B.settlementsPerLandHexes, 40)));
        let total = settlements.length + world.units.filter(u => u.type === 'clan' && !u.destroyed).length;
        for (const s of settlements) {
            if (total >= cap) break;
            const live = Dawn._tile(world, s.q, s.r).settlement;
            if (!live || live.population < _num(B.minPopulation, 220)) continue;
            if (Utils.random() >= _num(B.chance, 0.25)) continue;
            const size = _num(B.clanSize, 40);
            live.population -= size;
            const clan = Dawn.makeClan(world, s.q, s.r, live.culture || null);
            clan.population = size;
            clan.homeName = live.name;
            world.units.push(clan);
            total++;
            world.events.push({ text: `🔥 ${_fill(L.bud, { name: live.name, clan: clan.clanName })}`, type: 'growth' });
        }
    },

    /** Big, old villages become towns */
    _raiseTowns(world) {
        const T = Dawn.data().town || {};
        const L = Dawn.data().lines || {};
        for (const s of world.getAllSettlements()) {
            const live = Dawn._tile(world, s.q, s.r).settlement;
            if (!live || live.type !== 'village' || !live.dawnBorn) continue;
            const age = (world.year || 0) - _num(live.founded, world.year);
            if (live.population < _num(T.population, 600) || age < _num(T.minAgeYears, 4)) continue;
            live.type = 'town';
            live.level = Math.max(1, live.level || 0);
            world.dawn.townsRisen++;
            world.events.push({ text: `🏘️ ${_fill(L.town, { name: live.name })}`, type: 'growth' });
        }
        if (typeof world.invalidateSettlements === 'function') world.invalidateSettlements();
    },

    /** A town with free villages about it gathers them into a chiefdom: a new realm */
    _gatherRealms(world) {
        const K = Dawn.data().chiefdom || {};
        const st = world.dawn;
        const radius = _num(K.radius, 6);
        const settlements = world.getAllSettlements();
        for (const s of settlements) {
            if (st.realmsDone) break;
            const tile = Dawn._tile(world, s.q, s.r);
            const town = tile.settlement;
            if (!town || town.type !== 'town' || town.kingdom || tile.kingdom) continue;
            const age = (world.year || 0) - _num(town.founded, world.year);
            if (age < _num(K.minTownAgeYears, 6)) continue;
            const members = settlements.filter(o => {
                if (o.q === s.q && o.r === s.r) return false;
                const ot = Dawn._tile(world, o.q, o.r);
                return ot && ot.settlement && !ot.settlement.kingdom && !ot.kingdom && ot.regionId === tile.regionId
                    && Hex.wrappingOffsetDistance(s.q, s.r, o.q, o.r, world.width) <= radius;
            });
            // A town standing alone long enough becomes a realm of its own (a
            // city-state): towns spaced apart never gather two free villages, and
            // without this a young world can stall at one realm for good
            const need = age >= _num(K.loneTownAgeYears, Infinity) ? 0 : _num(K.minVillages, 2);
            if (members.length < need) continue;
            Dawn.foundRealm(world, { q: s.q, r: s.r }, members.map(m => ({ q: m.q, r: m.r })));
        }
    },

    /** Raise a realm seated at `seat`, holding the settlements at `members` */
    foundRealm(world, seat, members) {
        const K = Dawn.data().chiefdom || {};
        const L = Dawn.data().lines || {};
        const st = world.dawn;
        const seatTile = Dawn._tile(world, seat.q, seat.r);
        const town = seatTile.settlement;
        const culture = town.culture || Dawn._cultureFor(seatTile);
        const ids = new Set(world.kingdoms.map(k => k.id));
        let n = st.realmsBorn + 1;
        while (ids.has(`dawn_realm_${n}`)) n++;
        const id = `dawn_realm_${n}`;
        const used = new Set(world.kingdoms.map(k => String(k.color || '').toLowerCase()));
        const palette = K.colors && K.colors.length ? K.colors : ['#a0522d'];
        const color = palette.find(c => !used.has(c.toLowerCase())) || `#${Utils.randInt(0x202020, 0xd0d0d0).toString(16).padStart(6, '0')}`;
        const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
        const names = K.names && K.names.length ? K.names : ['Chiefdom of'];
        const traits = K.traits && K.traits.length ? K.traits : [['peaceful', 'orderly']];

        const kingdom = Kingdom.create({
            id,
            name: `${Utils.randPick(names)} ${town.name}`,
            ruler: Kingdom.generateRulerName(culture),
            color,
            colorLight: `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.2)`,
            culture,
            description: 'A realm risen from the first villages of a young world.',
            preferredTerrain: ['plains', 'grassland', 'woodland', 'hills'],
            traits: [...Utils.randPick(traits)],
        });
        kingdom.foundedDay = world.day;
        kingdom.dawnBorn = true;
        kingdom.capital = { q: seat.q, r: seat.r };
        kingdom.colonization = { policy: 'coexistence', colonies: [], pioneersActive: 0 };
        kingdom.truces = {};
        kingdom.warState = {};
        kingdom.stability = 55;
        // Its shipwrights know nothing yet: the years teach them (world/shipcraft.js)
        Shipcraft.beginRealm(kingdom);

        const claim = (t) => {
            if (!t || !t.terrain.passable || t.kingdom) return;
            if (t.settlement && t.settlement.kingdom && t.settlement.kingdom !== id) return;
            t.kingdom = id;
            kingdom.territory.push({ q: t.q, r: t.r });
        };
        for (const m of [seat, ...members]) {
            const t = Dawn._tile(world, m.q, m.r);
            if (!t || !t.settlement) continue;
            t.settlement.kingdom = id;
            claim(t);
            for (const nt of Dawn._near(world, t)) if (!nt.settlement) claim(nt);
        }
        town.type = 'capital';
        town.level = Math.max(2, town.level || 0);

        for (const other of world.kingdoms) {
            if (!other || !other.relations) continue;
            const rel = Utils.randInt(-20, 30);
            other.relations[id] = rel;
            kingdom.relations[other.id] = rel;
        }
        Kingdom.initializeKingdomStats(kingdom, world.tiles, world.width, world.height);
        kingdom.lord = NPCLords.generateLord(kingdom);
        if (Characters && typeof Characters.generateRoyalFamily === 'function') {
            kingdom.characterData = Characters.generateRoyalFamily(kingdom, world);
            kingdom.ruler = Characters.getDisplayName(kingdom.characterData.ruler, kingdom);
        }
        world.kingdoms.push(kingdom);
        if (typeof world.invalidateSettlements === 'function') world.invalidateSettlements();

        st.realmsBorn++;
        if (world.kingdoms.filter(k => k.isAlive).length >= st.realmTarget) st.realmsDone = true;
        world.events.push({ text: `👑 ${_fill(L.chiefdom, { ruler: kingdom.ruler, name: town.name, realm: kingdom.name })}`, type: 'political' });
        return kingdom;
    },

    /** The age the world is in, for the calendar and the chronicle */
    eraName(world) {
        if (!world || !world.dawn) return null;
        if (!world.dawn.over && world.dawn.realmsBorn === 0) return 'the Dawn Age';
        if (!world.dawn.over) return 'the Age of Founding';
        return null;
    },

    // ──────────── SAVE ────────────

    serialize(world) {
        return world && world.dawn ? JSON.parse(JSON.stringify(world.dawn)) : null;
    },

    /** Put the dawn's state back, and the paths it laid (the seed doesn't know them) */
    restore(data, world) {
        if (!data || !world) return;
        world.dawn = data;
        for (const [key, links] of Object.entries(data.paths || {})) {
            const [q, r] = key.split(',').map(Number);
            const t = Dawn._tile(world, q, r);
            if (!t) continue;
            t.hasRoad = true;
            t.roadLinks = (t.roadLinks || 0) | links;
        }
    },
};

