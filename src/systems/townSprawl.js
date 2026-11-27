// ============================================
// TOWN SPRAWL — what a town does when its ground runs out
// ============================================
// Each town's ground is counted from its hex, its walls and its neighbours
// (world/townLand.js: settlement.housing.land); its builders lay edge plots
// only while ground remains (world/townHousing.js). Weekly, for every town
// (systems/townPoor.js week calls `week` in place of the bare builders' week):
//
//   CLEARING  short of cleared ground and with wood left on the hex, a crew
//             fells a few plots (TownLand.clear): the timber to its market,
//             the crew's wages out of the town's purse into its woodcutters'
//             and labourers' purses.
//   THE BUILDERS' WEEK (TownHousing.week): its ground gone and its people
//             crowded, they pull down old hovels, cottages and houses for row
//             houses, townhouses and tenements, as its era and size allow (a
//             village: houses) — the old one's people lodging or crowding in
//             meanwhile; the crew's wages to the carpenters, masons and
//             labourers of its roster (data townGrowth hire.wage).
//   A SUBURB  a walled town whose ground inside the walls is all built over,
//             its people crowded, builds outside them: a faubourg on its own
//             hex when the hex has ground beyond the walls' circuit
//             (land.sub — poorer houses, unwalled: more crime, raided first),
//             its streets laid on the town's map beyond the walls; else a new
//             quarter founded on a free neighbouring hex as a village of its
//             own ("<Parent> Without"), settlers moved there from the town.
//   A SATELLITE a town with no ground at all (none to lay, no wood to fell, its
//             suburb full) and its people crowded past satellite.minCrowd sends
//             its overflow to found a village on a free neighbouring hex of its
//             realm: real households of its roster among them, their share of
//             its purse, grain and timber. Once every satellite.everyYears a town.
//
// Notices for the player's own towns and the town they stand in; the founding
// of a quarter or a village goes into the world's events. Deterministic:
// hashes of the town and the day, no shared dice. Data: data/townHousing.json
// land / redev / suburb / satellite.

import { Utils } from '../core/utils.js';
import { TownHousing } from '../world/townHousing.js';
import { TownLand } from '../world/townLand.js';
import { TownGrowth } from '../world/townGrowth.js';
import { LotBook } from '../world/lotBook.js';
import { Economy } from '../world/economy.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Townsfolk } from './townsfolk.js';
import { Migration } from './migration.js';
import { ArrivalCamps } from './arrivalCamps.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _r2 = v => Math.round(v * 100) / 100;
const _key = (q, r) => `${q},${r}`;
const HOUSE = { hovel: 'hovels', cottage: 'cottages', house: 'houses', townhouse: 'townhouses', row: 'row houses', tenement: 'tenements', lodging: 'lodging houses' };

function _h(...parts) { return ((Utils.hashStr(parts.join('|')) >>> 0) % 1000000) / 1000000; }

export const TownSprawl = {
    config() { return TownHousing.config(); },

    /** Days in the year (the housing model's). */
    _year() { return Math.max(1, _num(TownHousing.config().daysPerYear, 120)); },

    /**
     * The town's week: its ground counted, wood felled if it needs it, the
     * builders' week (TownHousing.week), redevelopment's wages, a suburb or a
     * satellite village when the ground is gone. `told(s)`: whether the player
     * hears of it. → the builders' week's result.
     */
    week(world, player, s, day, out = null, told = null) {
        const C = TownSprawl.config();
        const L = TownLand.refresh(world, s, day);
        // (short of cleared ground with wood still standing: a crew fells a few plots)
        if (L && _num(L.wood) > 0 && !TownSprawl._wallsBind(L)) {
            const B = C.build;
            const per = _num(C.edgePlots[s.type], 1);
            const left = TownHousing.landLeft(s);
            if (TownHousing.freePlots(s) < _num(B.denseBelow, 0.12) * Math.max(1, s.housing.plots) && left < per * 2) {
                const c = TownLand.clear(s, per * 2 - Math.max(0, left));
                if (c) TownSprawl._payCrew(world, s, c.days, c.crew, ['woodcutter', 'labourer'], day, 'clearing ground for the town');
            }
        }
        const res = TownHousing.week(s, day);
        if (!L) return res;
        const say = (n) => { if (out && told && told(s)) out.notices.push(n); };
        const crowd = TownHousing.crowd(s);
        // Redevelopment: its crews paid
        if (res.razed.length) {
            const R = C.redev;
            let days = 0;
            for (const [, , d] of res.razed) days += d;
            TownSprawl._payCrew(world, s, Math.round(days / Math.max(1, Math.floor(_num(R.crew, 3)))), Math.floor(_num(R.crew, 3)), ['carpenter', 'mason', 'labourer'], day, 'rebuilding old houses');
            if (!(day - _num(L.toldRd, -1e9) < _num(R.noticeEvery, 120))) {
                L.toldRd = day;
                const [from, to] = res.razed[0];
                say({ icon: '🏗️', title: `Rebuilding in ${s.name}`, text: `Old ${HOUSE[from] || from} in ${s.name} come down for ${HOUSE[to] || to}: there is no more ground to build on, so the town builds upward. Their people lodge with neighbours until the new houses stand.`, type: 'info' });
            }
        }
        // Its ground all built over
        if (TownHousing.landFull(s)) {
            if (L.full == null) L.full = day;
            if (TownSprawl._wallsBind(L) && L.wallFull == null) {
                L.wallFull = day;
                say({ icon: '🧱', title: `${s.name} Has Filled Its Walls`, text: `Every plot inside the walls of ${s.name} is built on. Its people crowd into what houses it has, and old cottages give way to taller houses — or the town must spill out beyond its gates.`, type: 'warning' });
            }
        }
        // A suburb outside the walls
        const S = C.suburb;
        if (S.enabled !== false && Number.isFinite(L.wall) && L.wallFull != null && !_obj(L.sub) && !L.subAt && crowd >= _num(S.minCrowd, 1)) {
            TownSprawl._suburb(world, player, s, day, say);
        }
        // A satellite village for the overflow
        const T = C.satellite;
        if (T.enabled !== false && TownSprawl._noGround(s) && TownSprawl._mayFound(s, day)) {
            const L2 = TownHousing.lodgers(s);
            if (crowd >= _num(T.minCrowd, 1.05) || L2.rough > 0) TownSprawl._satellite(world, player, s, day, say);
        }
        // The suburb's streets on the town's map
        if (_obj(L.sub)) TownSprawl._suburbStreets(world, s, day);
        return res;
    },

    /** No ground at all: nothing to lay, no wood to fell, and (walled) its quarter outside full or none to be had. */
    _noGround(s) {
        const L = TownLand.of(s);
        if (!L || !TownHousing.landFull(s)) return false;
        if (TownSprawl._wallsBind(L)) {
            // (a walled town first builds outside its walls, if it can)
            return !(!L.subAt && L.max - L.wall >= _num(TownHousing.config().suburb.minPlots, 60));
        }
        return !(_num(L.wood) > 0);
    },

    /** Is it the walls that bound the town's ground (walled, no suburb, the cleared ground reaching them)? */
    _wallsBind(L) {
        return !!L && Number.isFinite(L.wall) && !_obj(L.sub) && L.max - _num(L.wood) >= L.wall;
    },

    _mayFound(s, day) {
        const L = TownLand.of(s);
        const T = TownHousing.config().satellite;
        const sats = Array.isArray(L.sats) ? L.sats : [];
        if (sats.length >= Math.max(0, Math.floor(_num(T.maxPerTown, 3)))) return false;
        const last = sats.length ? sats[sats.length - 1].day : _num(L.subDay, -1e9);
        return day - last >= _num(T.everyYears, 10) * TownSprawl._year();
    },

    /** A name from patterns ({p}: the parent town), none already a town's. */
    _name(world, s, patterns, salt) {
        const base = s.foundingName || s.name || 'the town';
        const list = Array.isArray(patterns) && patterns.length ? patterns : ['New {p}'];
        const used = new Set();
        try { for (const v of world.getSettlementViews()) { const t = world.getTile(v.q, v.r); if (t && t.settlement && t.settlement.name) used.add(t.settlement.name); } } catch (e) { /* (no views) */ }
        const start = Math.floor(_h(base, salt) * list.length);
        for (let i = 0; i < list.length; i++) {
            const n = String(list[(start + i) % list.length]).replace('{p}', base);
            if (!used.has(n)) return n;
        }
        for (let k = 2; k < 50; k++) {
            const n = `${String(list[start]).replace('{p}', base)} ${k}`;
            if (!used.has(n)) return n;
        }
        return `${base} ${salt}`;
    },

    /**
     * A walled town builds outside its walls: on its own hex if the hex has
     * ground beyond the walls' circuit, else a quarter founded on a free
     * neighbouring hex. → 'hex' | 'next' | null
     */
    _suburb(world, player, s, day, say) {
        const L = TownLand.of(s);
        const S = TownHousing.config().suburb;
        const name = TownSprawl._name(world, s, S.names, 'sub');
        if (L.max - L.wall >= _num(S.minPlots, 60)) {
            L.sub = { name, day, d: {} };
            L.subDay = day;
            say({ icon: '🏘️', title: `A New Quarter Outside ${s.name}`, text: `A new quarter rises outside the walls of ${s.name}: ${name}. Its lanes run out past the gates, its houses poor and crowded and open to anyone who comes — more thieving there, and the first to burn when raiders come.`, type: 'info' });
            TownSprawl._event(world, `🏘️ A new quarter, ${name}, rises outside the walls of ${s.name}.`);
            return 'hex';
        }
        const at = TownLand.freeHexes(world, s)[0];
        if (!at) { L.subAt = null; return null; }
        const pop = Math.max(0, _num(s.population));
        const n = Math.round(Math.max(_num(S.min, 40), Math.min(_num(S.max, 600), pop * _num(S.settlers, 0.05), Math.max(0, pop - 60))));
        if (n < _num(S.min, 40)) return null;
        const v = TownSprawl._found(world, player, s, at, name, n, day, 'suburb');
        if (!v) return null;
        L.subAt = _key(at.q, at.r);
        L.subDay = day;
        say({ icon: '🏘️', title: `A New Quarter Outside ${s.name}`, text: `There is no room left within the walls of ${s.name}, nor ground outside them on its own hex: ${n} of its people go out past the gates to build ${name} on the next hex — a poor quarter of the town, unwalled.`, type: 'info' });
        TownSprawl._event(world, `🏘️ ${n} of the people of ${s.name}, crowded within its walls, found ${name} outside them.`);
        return 'next';
    },

    /** The overflow founds a village on a free neighbouring hex. → the new settlement, or null. */
    _satellite(world, player, s, day, say) {
        const L = TownLand.of(s);
        const T = TownHousing.config().satellite;
        const at = TownLand.freeHexes(world, s)[0];
        if (!at) { L.noSat = day; return null; }
        const pop = Math.max(0, _num(s.population));
        const over = pop - TownHousing.capacity(s);
        const n = Math.round(Math.max(_num(T.min, 40), Math.min(_num(T.max, 500), Math.max(over, pop * _num(T.share, 0.06)), Math.max(0, pop - 60))));
        if (n < _num(T.min, 40)) return null;
        const name = TownSprawl._name(world, s, T.names, `sat${(L.sats || []).length}`);
        const v = TownSprawl._found(world, player, s, at, name, n, day, 'satellite');
        if (!v) return null;
        if (!Array.isArray(L.sats)) L.sats = [];
        L.sats.push({ q: at.q, r: at.r, name: v.name, day });
        say({ icon: '🧭', title: `Settlers from ${s.name}`, text: `Settlers from ${s.name} found ${v.name}: ${n} people, with no room left to them in the town, take up the next hex and build a village of their own.`, type: 'info' });
        TownSprawl._event(world, `🧭 Settlers from ${s.name} found ${v.name} on the next hex: ${n} people the crowded town had no room for.`);
        return v;
    },

    _event(world, text) {
        if (Array.isArray(world.events)) world.events.push({ text, type: 'colonization', category: 'ECONOMIC' });
    },

    /**
     * Found a village of `n` of the town's people on hex `at` (a quarter of it:
     * kind 'suburb'; its overflow's village: 'satellite'). Its people come from
     * the town (its count; the households of its roster their share), with their
     * share of its purse by heads, grain for grainDays and timber; it is of the
     * town's realm. → the settlement, or null.
     */
    _found(world, player, s, at, name, n, day, kind) {
        const t = at && at.t;
        if (!t || t.settlement || !(n > 0)) return null;
        const T = TownHousing.config().satellite;
        const pop0 = Math.max(1, _num(s.population));
        const v = {
            type: 'village', name, population: n, level: 0, kingdom: s.kingdom != null ? s.kingdom : null,
            founded: Math.floor(_num(world.year, _num(world.baseYear, 853))), q: at.q, r: at.r,
        };
        if (s.culture) v.culture = s.culture;
        v[kind === 'suburb' ? 'suburbOf' : 'satelliteOf'] = { q: s.q, r: s.r, name: s.name, day };
        t.settlement = v;
        if (s.kingdom != null) {
            t.kingdom = s.kingdom;
            const k = typeof world.getKingdom === 'function' ? world.getKingdom(s.kingdom) : (world.kingdoms || []).find(x => x && x.id === s.kingdom);
            if (k && Array.isArray(k.territory) && !k.territory.some(h => h.q === at.q && h.r === at.r)) k.territory.push({ q: at.q, r: at.r });
        }
        if (typeof world.invalidateSettlements === 'function') world.invalidateSettlements();
        s.population = Math.max(0, _num(s.population) - n);
        // (a new village has only what its settlers carry: their share of the town's purse, grain and timber)
        Economy.initSettlement(v, { fresh: true });
        if (typeof SettlementMarket.ensure === 'function') SettlementMarket.ensure(v);
        const have = Economy.townPurse(s);
        if (have > 0) {
            const take = Math.floor(have * n / pop0 * 100) / 100;
            if (take > 0) Economy.payTown(v, Economy.drawTown(s, take));
        }
        if (s.economy && v.economy) {
            const per = Economy.FOOD && Number.isFinite(Economy.FOOD.perCapita) ? Economy.FOOD.perCapita : 0.1;
            const grain = Math.min(Math.max(0, _num(s.economy.food)), Math.round(n * per * _num(T.grainDays, 30)));
            s.economy.food = _num(s.economy.food) - grain;
            v.economy.food = _num(v.economy.food) + grain;
        }
        const wood = Math.ceil(n * _num(T.woodPer, 0.05));
        if (wood > 0 && SettlementMarket.tracks('wood')) {
            const got = SettlementMarket.take(s, 'wood', wood);
            if (got > 0) SettlementMarket.add(v, 'wood', got);
        }
        TownSprawl._moveFolk(world, player, s, v, n, pop0, day);
        return v;
    },

    /**
     * The town's roster households that go with them (their share of its
     * residents, at least two households where it keeps a roster of a dozen or
     * more): marked gone from the town, written into the new village's roster.
     * → people moved
     */
    _moveFolk(world, player, s, v, n, pop0, day) {
        const ff = _obj(s.folk) && Array.isArray(s.folk.people) ? s.folk : null;
        if (!ff) return 0;
        const res = Townsfolk.residents(ff).length;
        let want = Math.round(res * n / pop0);
        if (res >= 12) want = Math.max(want, 2);
        if (!(want > 0)) return 0;
        const hs = Migration.households(ff, day).filter(g => Migration._mayGo(g, day, player))
            .map(g => ({ g, k: _h(s.name, v.name, day, g[0].id) })).sort((a, b) => a.k - b.k).map(x => x.g);
        const moved = [];
        let got = 0, households = 0;
        while (hs.length && (got < want || households < 2) && got < want + 6) {
            const g = hs.shift();
            got += g.length;
            households++;
            moved.push(Migration._leave(world, ff, g, s, v, 'crowding', 'settlers', day));
        }
        if (!moved.length) return 0;
        delete ff._index;
        Townsfolk._create(v, world, [], { q: v.q, r: v.r, target: 0 }, day);
        const placed = Migration._place(world, v, moved, s, day, player);
        if (v.folk) v.folk.target = Math.max(1, placed);
        return placed;
    },

    /**
     * Wages for a crew of the town's own hands (`trades` of its roster, free of
     * other hire): `days` working days each at the builders' wage, out of the
     * town's purse into theirs; taken from their own work meanwhile. A town that
     * keeps no roster pays its own people, so nothing moves. → coin paid
     */
    _payCrew(world, s, days, crewN, trades, day, label) {
        const folk = _obj(s.folk) && Array.isArray(s.folk.people) ? s.folk : null;
        if (!folk || !(days > 0)) return 0;
        const free = folk.people.filter(p => Townsfolk.isHere(p) && p.job && trades.includes(p.job.id) && p.job.employer !== 'player'
            && !(p.job.hired && _num(p.job.hired.until) > day) && !p.camp && Townsfolk.age(p, day) >= 16)
            .sort((a, z) => trades.indexOf(a.job.id) - trades.indexOf(z.job.id) || a.id - z.id);
        const crew = free.slice(0, Math.max(1, crewN));
        if (!crew.length) return 0;
        const H = ArrivalCamps.hireConfig();
        const w = _num(H.wage && (H.wage[s.type] != null ? H.wage[s.type] : H.wage.village), 1.5);
        const paid = Economy.drawTown(s, _r2(w * crew.length * days));
        if (!(paid > 0)) return 0;
        const each = Math.floor(paid / crew.length * 100) / 100;
        let rest = _r2(paid - each * crew.length);
        for (const p of crew) {
            p.purse = _r2(Townsfolk.purse(folk, p, world) + each + rest);
            rest = 0;
            p.job.hired = { until: day + days, label };
        }
        return paid;
    },

    /**
     * The suburb's streets on the town's map, beyond its walls: one for every
     * dwellingsPerStreet of its dwellings, at most maxStreets — surveyed first
     * (ArrivalCamps.survey) so no lot is kept that the map cannot show. Its
     * lots carry the suburb's houses (already counted in the town's housing).
     * → the street laid, or null.
     */
    _suburbStreets(world, s, day) {
        const S = TownHousing.config().suburb;
        const L = TownLand.of(s);
        const mine = TownGrowth.streets(s).filter(st => st.suburb);
        if (mine.length >= Math.max(0, Math.floor(_num(S.maxStreets, 4)))) return null;
        if (TownHousing.suburbDwellings(s) < (mine.length + 1) * Math.max(1, _num(S.dwellingsPerStreet, 14))) return null;
        const g = TownGrowth.of(s, true);
        if (g.subNoRoom != null && day - _num(g.subNoRoom) < Math.max(1, _num(TownGrowth.config().noRoomDays, 90))) return null;
        let st = TownGrowth.addStreet(s, day);
        st.suburb = 1;
        const laid = ArrivalCamps.survey(world, s.q, s.r);
        if (!Array.isArray(laid)) st.unsurveyed = 1;
        st = TownGrowth.fitStreet(s, st, laid);
        if (!st) { g.subNoRoom = day; return null; }
        delete g.subNoRoom;
        const book = LotBook.of(s);
        const who = `${L.sub.name}'s folk`;
        for (const id of st.lots) {
            book.lots[id] = {
                holder: `npc:${who}`, holderName: who, price: 0, day, granted: true,
                built: { type: 'house', dwelling: 'cottage', kind: 'suburb', by: `npc:${who}`, housed: 1, start: day, readyDay: day },
            };
        }
        return st;
    },
};
