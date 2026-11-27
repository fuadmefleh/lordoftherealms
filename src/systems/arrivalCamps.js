// ============================================
// ARRIVAL CAMPS — newcomers camp outside a town until houses go up for them
// ============================================
// Arrivals are noted on the town as they come in (world/townGrowth.js
// noteArrival: a migrant column arriving, the week's settlers placed by
// systems/migration.js, the player's paid colonists by world/colonization.js).
// Each day, for every town with a growth record:
//
//   A CAMP OPENS when the last windowDays brought more people than the town's
//     empty houses hold (migr.vac of its people) by at least its threshold
//     (TownGrowth.threshold: share of its people, minPeople..maxPeople). The
//     newcomers are real townsfolk: the households of the roster who came in
//     those days (p.mig), marked p.camp; a town whose newcomers came without
//     households (colonists, a town that keeps no roster) has newcomer
//     families written into its roster for them (Migration._newFamily). While
//     the camp stands, everyone who arrives joins it.
//   EACH WEEK up to lotsPerWeek lots are taken for them (twice as many while
//     the player pays for their homes): the town's free lots first
//     (world/lotBook.js), and when none are left a new street is laid out at
//     the town's edge on its side with most room, or plots inside the town
//     (TownGrowth.addStreet; drawn by layStreets) — surveyed on the town's map
//     first (setSurveyor: InnerMap.surveyGrowth), so the lot book never holds
//     a lot the map cannot show, and no room at all means no lot. Each lot
//     houses perLot of the campers; the roster's households take the last
//     lots, so the faces in the tents are there until the camp is struck.
//   A HOUSE GOES UP on each: its materials (TownGrowth house[type]) out of
//     what was given to the camp, then the town's market stock — none in
//     store, the work waits on them — paid for at the market price out of the
//     household's purses (then the player's fund) into the town's, the town
//     giving what they cannot pay. A household with coin to spare hires the
//     town's builders (hire: carpenters, masons, labourers of the roster,
//     their wages into their purses — a town with no roster, into its purse;
//     away from their own trade while they build) and the house stands in
//     speed x buildDays; else they build it with their own hands over
//     buildDays. The house done, its household moves in (p.lotHome).
//   NO ROOM: the last of them crowd into the town's houses after crowdDays.
//   WHILE IT STANDS: its people fall sick more (crowding, the water; less
//     when fed: systems/illness.js reads TownGrowth.campRisk), thieving is up
//     in the town (systems/npcTheft.js, world/townLabour.js crime: campCrime),
//     and a big camp left standing long sours the town's mood (given back when
//     it is struck). The player may give food, coin or timber (give) or pay
//     the builders for every house still to come (buildHomes): the camp eats
//     and builds the better, and the town and the campers remember it.
//   THE CAMP IS STRUCK when everyone has a roof (growth.cleared: its trodden
//     ground grows back over fadeDays on the street map).
//
// Notices only for the player's own towns and the town they stand in.
// Deterministic: draws no shared RNG (a hash stream of the world seed and the
// town). State on settlement.growth and settlement.lotBook (saved with the tile).

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { TownGrowth } from '../world/townGrowth.js';
import { TownHousing } from '../world/townHousing.js';
import { LotBook } from '../world/lotBook.js';
import { Economy } from '../world/economy.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Townsfolk } from './townsfolk.js';
import { Migration } from './migration.js';
import { Taxation } from './marketDynamics.js';
import { Ledger } from './ledger.js';
import { NpcMemory } from './npcMemory.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _r2 = v => Math.round(v * 100) / 100;
const _key = (q, r) => `${q},${r}`;
const _clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** A hash stream in [0, 1) of the world seed and its parts. */
function _rng(world, ...parts) {
    const seed = (world && world.generationParams && world.generationParams.seed) || 1;
    let s = (Utils.hashStr(`${seed}|camp|${parts.join('|')}`) >>> 0) || 1;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

function _basePrice(goodId) {
    const gd = DataLoader._gamedata;
    const G = gd && gd.playerEconomy && gd.playerEconomy.GOODS;
    const g = G && G[String(goodId).toUpperCase()];
    return g && g.basePrice > 0 ? g.basePrice : 5;
}

const _folk = s => (s && s.folk && Array.isArray(s.folk.people) ? s.folk : null);

// (the town's street map, for what room it has: injected by the composition root and the harness)
let _surveyor = null;

export const ArrivalCamps = {
    config() { return TownGrowth.config(); },

    /**
     * How a new street is surveyed on the town's map before it is kept:
     * fn(world, q, r) → the lots laid ([{ id, street, infill? }]) or null
     * (components/GameView.jsx and the harness pass InnerMap.surveyGrowth).
     * Without one a street is kept whole.
     */
    setSurveyor(fn) { _surveyor = typeof fn === 'function' ? fn : null; },

    /** The town's map surveyed for its growth streets (the lots laid), or null with no surveyor or no map. */
    survey(world, q, r) {
        if (!_surveyor) return null;
        try { return _surveyor(world, q, r); } catch (e) { return null; }
    },

    /**
     * The day's reckoning for every town that has had arrivals or keeps a camp.
     * Run daily after the migration day (systems/labour.js). Adds to out.notices.
     */
    processDay(world, player = null, out = { notices: [] }) {
        if (!world || !TownGrowth.on() || typeof world.getSettlementViews !== 'function' || typeof world.getTile !== 'function') return out;
        const day = Math.floor(_num(world.day));
        const fade = Math.max(1, _num(TownGrowth.config().fadeDays, 40));
        const keys = [];
        let ruled = null;
        const ctx = {
            world, player, out, day,
            told: (s) => {
                if (!player) return false;
                if (player.q === s.q && player.r === s.r) return true;
                if (!ruled) {
                    ruled = new Set();
                    try { for (const ref of Taxation.getPlayerSettlements(player, world)) ruled.add(_key(ref.q, ref.r)); } catch (e) { /* none */ }
                }
                return ruled.has(_key(s.q, s.r));
            },
        };
        for (const v of world.getSettlementViews() || []) {
            const tile = world.getTile(v.q, v.r);
            const s = tile && tile.settlement;
            const g = s && s.growth;
            if (!g || typeof g !== 'object') continue;
            if (s.q == null) { s.q = v.q; s.r = v.r; }
            if (Array.isArray(g.arr) && g.arr.some(a => !a[4])) ArrivalCamps._arrivals(s, g, ctx);
            if (g.camp) ArrivalCamps._campDay(s, g, ctx);
            if (g.camp) keys.push(_key(v.q, v.r));
            if (g.cleared && day - _num(g.cleared.d) > fade) delete g.cleared;
        }
        // (the towns with a camp standing, for the world map's marker: ui/renderer/arrivalCamps.js)
        world._arrivalCampKeys = keys;
        return out;
    },

    /** The room a town's empty houses still hold (its people gone, migr.vac). */
    room(s) {
        return Math.max(0, Math.round(_num(s.migr && s.migr.vac) * Math.max(0, _num(s.population))));
    },

    /** New arrivals: into the standing camp, or — enough of them at once — a camp of their own. */
    _arrivals(s, g, ctx) {
        const { day } = ctx;
        const fresh = g.arr.filter(a => !a[4]);
        if (g.camp) {
            for (const a of fresh) { g.camp.n += Math.max(0, _num(a[1])); if (a[2]) g.camp.from = a[2]; a[4] = 1; }
            ArrivalCamps._gather(s, g.camp, ctx);
            return;
        }
        // (a place still a camp of tents itself: they pitch theirs among the rest)
        if (TownGrowth.tentVillage(s)) { for (const a of fresh) a[4] = 1; return; }
        const w = Math.max(1, _num(TownGrowth.config().windowDays, 7));
        const recent = fresh.filter(a => a[0] > day - w);
        const sum = recent.reduce((t, a) => t + Math.max(0, _num(a[1])), 0);
        const n = sum - ArrivalCamps.room(s);
        if (n < TownGrowth.threshold(s)) return;
        for (const a of fresh) a[4] = 1;
        g.seq = _num(g.seq) + 1;
        const from = (recent.slice().sort((a, b) => _num(b[1]) - _num(a[1]))[0] || [])[2] || 'afar';
        const camp = { id: `c${g.seq}`, since: day, n, housed: 0, from, hh: [], lots: [], next: day + 7 };
        g.camp = camp;
        delete g.cleared;
        ArrivalCamps._gather(s, camp, ctx);
        if (ctx.told(s)) {
            ctx.out.notices.push({ icon: '⛺', title: `Newcomers Camp Outside ${s.name}`, text: `${n} newcomers from ${from} have pitched their tents on the outskirts of ${s.name}: there is no room for them in the town yet. Building lots will be found for them, a few households a week.`, type: 'info' });
        }
    },

    /**
     * The camp's households: the roster's newcomers of these days (p.mig), each
     * household marked p.camp; newcomer families written in for those who came
     * without any (as many as the camp's share of the roster wants).
     */
    _gather(s, camp, ctx) {
        const { world, day } = ctx;
        let folk = _folk(s);
        if (!folk && Townsfolk.config().enabled) {
            try { folk = Townsfolk.seed(s, world, { q: s.q, r: s.r }); } catch (e) { folk = null; }
        }
        if (!folk) return;
        const w = Math.max(1, _num(TownGrowth.config().windowDays, 7));
        const isNew = p => p && p.mig && _num(p.mig.d, -1e9) >= camp.since - w && !p.lotHome;
        const has = new Set(camp.hh.flatMap(h => h.ids));
        const add = () => {
            for (const grp of Migration.households(folk, day)) {
                if (!grp.length || !grp.every(isNew) || grp.some(p => has.has(p.id) || p.camp)) continue;
                const head = grp.slice().sort((a, b) => Townsfolk.age(b, day) - Townsfolk.age(a, day))[0];
                camp.hh.push({ head: head.id, ids: grp.map(p => p.id), lot: null });
                for (const p of grp) { p.camp = camp.id; has.add(p.id); }
            }
        };
        add();
        // As many of the campers in the roster as the town's people are in it
        const res = Townsfolk.residents(folk).length;
        // (and enough of them to people the camp: a few households at the least)
        const want = Math.max(Math.round(camp.n * res / Math.max(1, _num(s.population))), Math.min(10, Math.ceil(camp.n / 5)));
        const named = camp.hh.reduce((t, h) => t + h.ids.length, 0);
        if (named * 2 < want && camp.n > 0) {
            const rng = _rng(world, s.q, s.r, day, camp.id, named);
            for (let i = 0, got = named; i < 5 && got < want; i++) {
                const fam = Migration._newFamily(world, folk, { name: camp.from || 'afar' }, day, rng);
                got += fam.length;
            }
            add();
        }
    },

    /** A day of the camp: it eats, its houses finished, lots taken (weekly), its weight on the town, struck when all have a roof. */
    _campDay(s, g, ctx) {
        const { day } = ctx;
        const camp = g.camp;
        const folk = _folk(s);
        ArrivalCamps._eat(s, camp);
        for (let i = camp.lots.length - 1; i >= 0; i--) {
            const L = camp.lots[i];
            if (L.ready) continue;
            if (L.crowd) {
                if (day >= _num(L.readyDay)) ArrivalCamps._housed(camp, L, folk);
                continue;
            }
            const rec = LotBook.lot(s, L.id);
            const b = rec && rec.built;
            // (the lot gone from under them — sold, seized: back into the camp)
            if (!b || b.kind !== 'settler' || b.camp !== camp.id) {
                const h = camp.hh.find(x => x.lot === L.id);
                if (h) h.lot = null;
                camp.lots.splice(i, 1);
                continue;
            }
            if (b.wait) ArrivalCamps._materials(s, b, camp, ctx);
            // (paid for by the player since: the builders take over a house going up by hand)
            else if (!b.hired && _num(camp.fund) > 0 && b.readyDay != null && b.readyDay > day) ArrivalCamps._hire(s, b, camp, ctx, 'fund');
            if (!b.wait && b.readyDay != null && day >= b.readyDay) ArrivalCamps._housed(camp, L, folk);
        }
        if (day >= _num(camp.next)) {
            camp.next = day + 7;
            ArrivalCamps._takeLots(s, g, camp, ctx);
        }
        ArrivalCamps._mood(s, camp, day);
        if (camp.housed >= camp.n) ArrivalCamps._strike(s, g, ctx);
    },

    /** The campers eat from what was given them (food in person-days: aid.eat of a day's food a head). */
    _eat(s, camp) {
        if (!(_num(camp.food) > 0)) return;
        const A = ArrivalCamps.aidConfig();
        const under = Math.max(0, camp.n - camp.housed);
        camp.food = _r2(Math.max(0, _num(camp.food) - under * _num(A.eat, 0.5)));
        if (camp.food <= 0) delete camp.food;
    },

    /**
     * The town's mood under a big camp left standing long (effects.mood): it sours
     * toward −min(max, share × perShare) a step a day; given back as the camp shrinks.
     */
    _mood(s, camp, day) {
        const M = (TownGrowth.config().effects || {}).mood || {};
        const share = TownGrowth.campShare(s);
        const big = share >= _num(M.bigShare, 0.06) && day - _num(camp.since) >= _num(M.afterDays, 30);
        const target = big ? -Math.min(_num(M.max, 4), share * _num(M.perShare, 25)) : 0;
        const cur = _num(camp.moodHit);
        const step = _num(M.step, 0.1);
        const next = cur > target ? Math.max(target, cur - step) : Math.min(target, cur + step);
        const delta = _r2(next - cur);
        if (!delta) return;
        camp.moodHit = _r2(next);
        if (!camp.moodHit) delete camp.moodHit;
        s.happiness = _clamp(_num(s.happiness, 50) + delta, 0, 100);
    },

    /** A lot's house stands: its people are housed, its household moves in (all the households of a crowding). */
    _housed(camp, L, folk) {
        L.ready = true;
        camp.housed = Math.min(camp.n, camp.housed + _num(L.n));
        const hs = L.crowd ? camp.hh.filter(x => x.lot === 'crowd' && !x.housed) : (L.hh != null ? camp.hh.filter(x => x.head === L.hh) : []);
        for (const h of hs) {
            if (folk) {
                for (const id of h.ids) {
                    const p = Townsfolk.get(folk, id);
                    if (!p) continue;
                    delete p.camp;
                    if (!L.crowd) p.lotHome = L.id;
                }
            }
            h.housed = true;
        }
    },

    /** The week's lots for the camp: free lots first, then a new street (or plots inside); else they crowd in. */
    _takeLots(s, g, camp, ctx) {
        const { day } = ctx;
        const C = TownGrowth.config();
        const per = Math.max(1, _num(TownGrowth.byType('perLot', s.type), 8));
        const assigned = () => camp.lots.reduce((t, L) => t + _num(L.n), 0);
        // (paid for by the player: twice the lots a week)
        const weekly = Math.max(1, Math.floor(_num(TownGrowth.byType('lotsPerWeek', s.type), 2))) * (_num(camp.fund) > 0 ? 2 : 1);
        for (let i = 0; i < weekly; i++) {
            const left = camp.n - assigned();
            if (left <= 0) break;
            const taken = new Set(Object.keys(LotBook.of(s).lots));
            let lot = LotBook.freeLots(s).find(l => !taken.has(l.id)) || null;
            if (!lot) lot = ArrivalCamps._newStreet(s, g, ctx);
            if (!lot) {
                // (no more room to build: the rest crowd in with the townsfolk in time)
                const rest = camp.hh.filter(h => !h.lot && !h.housed);
                camp.lots.push({ id: `crowd${camp.lots.length}`, n: left, crowd: true, readyDay: day + Math.max(1, _num(C.crowdDays, 45)), hh: rest.length ? rest[0].head : null });
                for (const h of rest) h.lot = 'crowd';
                break;
            }
            // The roster's households take the last lots: the faces in the tents stay till the end
            const hhLeft = camp.hh.filter(x => !x.lot && !x.housed);
            const h = hhLeft.length && hhLeft.length >= Math.ceil(left / per) ? hhLeft[0] : null;
            ArrivalCamps._build(s, camp, lot, h, Math.min(per, left), ctx);
        }
    },

    /**
     * A new street for the camp, surveyed on the town's map: only the lots that show
     * are kept; none — no street (and none tried again for noRoomDays). → its first free lot, or null.
     */
    _newStreet(s, g, ctx) {
        const { day, world } = ctx;
        if (!TownGrowth.canLayStreet(s)) return null;
        // (no ground left to the town — its hex, its walls, its neighbours: world/townLand.js)
        if (!(TownHousing.landLeft(s) >= 1)) return null;
        if (g.noRoom != null && day - _num(g.noRoom) < Math.max(1, _num(TownGrowth.config().noRoomDays, 90))) return null;
        let st = TownGrowth.addStreet(s, day);
        let laid = null;
        if (_surveyor) { try { laid = _surveyor(world, s.q, s.r); } catch (e) { laid = null; } }
        // (no map to survey yet — the designs not loaded: kept whole, fitted the first time its map is laid)
        if (!Array.isArray(laid)) st.unsurveyed = 1;
        st = TownGrowth.fitStreet(s, st, laid);
        if (!st) { g.noRoom = day; return null; }
        delete g.noRoom;
        // The street's lots are building plots the town's housing counts (world/townHousing.js)
        TownHousing.addPlots(s, Math.min(st.lots.length, Math.max(0, TownHousing.landLeft(s))));
        if (ctx.told(s)) {
            const n = st.lots.length;
            ctx.out.notices.push(st.kind === 'infill'
                ? { icon: '🏘️', title: `Building Plots in ${s.name}`, text: `There is no more open ground at the edge of ${s.name}: ${n} building plot${n === 1 ? ' is' : 's are'} found for the newcomers among the town's yards and gardens instead.`, type: 'info' }
                : { icon: '🛣️', title: `A New Street in ${s.name}`, text: `A new street is laid out at the edge of ${s.name} for the newcomers camping there — ${st.name}, with ${n} building lot${n === 1 ? '' : 's'} along it.`, type: 'info' });
        }
        return LotBook.freeLots(s).find(l => st.lots.includes(l.id)) || null;
    },

    /** The town grants a lot to the camp's household: their house is begun once its materials are in. */
    _build(s, camp, lot, h, n, ctx) {
        const folk = _folk(s);
        const head = h && folk ? Townsfolk.get(folk, h.head) : null;
        const holderName = head ? Townsfolk.name(head) : `newcomers from ${camp.from || 'afar'}`;
        const holder = `npc:${holderName}`;
        // What goes up is the town's next kind of dwelling (world/townHousing.js) — one household
        // a lot, so no denser than row houses (a tenement is the town's or a landlord's to raise)
        let dw = TownHousing.nextDwellingType(s);
        if (TownHousing.designOf(dw) === 'tenement') dw = 'row';
        const dwDesign = TownHousing.designOf(dw);
        LotBook.of(s).lots[lot.id] = {
            holder, holderName, price: 0, day: ctx.day, granted: true,
            built: { type: dwDesign, dwelling: dw, kind: 'settler', by: holder, camp: camp.id, folk: h ? h.ids.slice() : [], start: null, readyDay: null, wait: true, cost: 0, paid: 0 },
        };
        camp.lots.push({ id: lot.id, n, hh: h ? h.head : null });
        if (h) h.lot = lot.id;
        ArrivalCamps._materials(s, LotBook.lot(s, lot.id).built, camp, ctx);
    },

    /** The household's people with a purse, eldest first (none for a camp of no roster: its common purse stands for them). */
    _payers(s, b, day) {
        const folk = _folk(s);
        return folk ? (b.folk || []).map(id => Townsfolk.get(folk, id)).filter(p => p && _num(p.purse) > 0)
            .sort((a, z) => Townsfolk.age(z, day) - Townsfolk.age(a, day)) : [];
    },

    /** Take up to `amount` from the household's purses (or, for a camp with no roster, its common purse). → what was taken. */
    _fromHousehold(s, b, camp, amount, day) {
        let paid = 0;
        const people = ArrivalCamps._payers(s, b, day);
        for (const p of people) {
            if (paid >= amount) break;
            const give = _r2(Math.min(_num(p.purse), amount - paid));
            p.purse = _r2(_num(p.purse) - give);
            paid = _r2(paid + give);
        }
        if (!people.length && _num(camp.purse) > 0 && paid < amount) {
            const give = _r2(Math.min(_num(camp.purse), amount - paid));
            camp.purse = _r2(_num(camp.purse) - give);
            paid = _r2(paid + give);
        }
        return paid;
    },

    /**
     * The house's timber and stone: what was given to the camp first, the rest out of
     * the town's stock (all of it, or none yet: the work waits), paid for at the market
     * price out of the household's purses (then the player's fund) into the town's; the
     * town gives the rest. The work begins: by hired builders when someone can pay
     * them, else by the household's own hands.
     */
    _materials(s, b, camp, ctx) {
        const { day } = ctx;
        const need = TownGrowth.byType('house', s.type) || {};
        const stores = camp.stores || {};
        const goods = Object.entries(need).filter(([g, q]) => _num(q) > 0);
        const fromMarket = goods.map(([g, q]) => [g, Math.max(0, _num(q) - _num(stores[g]))]).filter(([g, q]) => q > 0 && SettlementMarket.tracks(g));
        for (const [g, q] of fromMarket) if (SettlementMarket.stock(s, g) < q) { b.wait = true; b.waitOn = g; return false; }
        // (the camp's own stores: given, nothing to pay)
        let given = 0;
        for (const [g, q] of goods) {
            const use = Math.min(_num(stores[g]), _num(q));
            if (use > 0) { stores[g] = _r2(_num(stores[g]) - use); given += use; if (!(stores[g] > 0)) delete stores[g]; }
        }
        if (camp.stores && !Object.keys(camp.stores).length) delete camp.stores;
        let cost = 0;
        for (const [g, q] of fromMarket) {
            const got = SettlementMarket.take(s, g, q);
            cost += got * _basePrice(g) * SettlementMarket.scarcity(s, g);
        }
        cost = _r2(cost);
        // Out of the household's purses (eldest first), then the player's fund, into the town's
        let paid = ArrivalCamps._fromHousehold(s, b, camp, cost, day);
        let funded = 0;
        if (paid < cost && _num(camp.fund) > 0) {
            funded = _r2(Math.min(_num(camp.fund), cost - paid));
            camp.fund = _r2(_num(camp.fund) - funded);
        }
        if (paid + funded > 0) Economy.payTown(s, _r2(paid + funded));
        b.cost = cost;
        b.paid = paid;
        if (funded) b.funded = funded;
        if (given) b.given = given;
        b.granted = _r2(Math.max(0, cost - paid - funded));
        b.wait = false;
        delete b.waitOn;
        b.start = day;
        b.readyDay = day + ArrivalCamps.selfDays(s);
        b.hands = 'own';
        ArrivalCamps._hire(s, b, camp, ctx);
        return true;
    },

    /** The builders' terms (data hire): { trades, crew, wage (a day each), speed, keepPerHead }. */
    hireConfig() {
        return { trades: ['carpenter', 'mason', 'labourer'], crew: 2, wage: { village: 1.2, town: 1.6, city: 2, capital: 2.4 }, speed: 0.5, keepPerHead: 3, ...(TownGrowth.config().hire || {}) };
    },

    /** The settlers' own hands: buildDays. */
    selfDays(s) { return Math.max(1, Math.round(_num(TownGrowth.byType('buildDays', s.type), 28))); },

    /** Hired builders: speed × buildDays. */
    hiredDays(s) { return Math.max(1, Math.round(ArrivalCamps.selfDays(s) * _num(ArrivalCamps.hireConfig().speed, 0.5))); },

    /** The wages of a crew for `days`. */
    crewCost(s, days) {
        const H = ArrivalCamps.hireConfig();
        const w = _num(H.wage && (H.wage[s.type] != null ? H.wage[s.type] : H.wage.village), 1.5);
        return _r2(w * Math.max(1, _num(H.crew, 2)) * Math.max(0, days));
    },

    /**
     * Hire the town's builders for the house (the rest of its days, at speed):
     * paid by the household when its purses hold the wages beyond keepPerHead a
     * head (payer 'hh'), or by the player's fund ('fund'). The wages go to the
     * builders themselves (the roster's free carpenters, masons and labourers,
     * taken from their own work until the house stands), or to the town's
     * purse where it keeps no roster of them. → true when hired.
     */
    _hire(s, b, camp, ctx, only = null) {
        const { day } = ctx;
        if (b.hired || b.wait || b.readyDay == null) return false;
        const H = ArrivalCamps.hireConfig();
        const left = Math.max(0, b.readyDay - day);
        if (left <= 1) return false;
        const days = Math.max(1, Math.ceil(left * _num(H.speed, 0.5)));
        const cost = ArrivalCamps.crewCost(s, days);
        let payer = null;
        if (only !== 'fund') {
            const keep = _num(H.keepPerHead, 3) * Math.max(1, (b.folk || []).length);
            const people = ArrivalCamps._payers(s, b, day);
            const purse = people.length ? people.reduce((t, p) => t + _num(p.purse), 0) : _num(camp.purse);
            if (purse - keep >= cost) payer = 'hh';
        }
        if (!payer && _num(camp.fund) >= cost) payer = 'fund';
        if (!payer) return false;
        if (payer === 'hh') ArrivalCamps._fromHousehold(s, b, camp, cost, day);
        else camp.fund = _r2(_num(camp.fund) - cost);
        // The builders: the town's own hands, free of other hire
        const folk = _folk(s);
        const crewN = Math.max(1, Math.floor(_num(H.crew, 2)));
        const crew = [];
        if (folk) {
            const trades = Array.isArray(H.trades) ? H.trades : [];
            const free = folk.people.filter(p => Townsfolk.isHere(p) && p.job && trades.includes(p.job.id) && p.job.employer !== 'player'
                && !(p.job.hired && _num(p.job.hired.until) > day) && !p.camp && Townsfolk.age(p, day) >= 16)
                .sort((a, z) => trades.indexOf(a.job.id) - trades.indexOf(z.job.id) || a.id - z.id);
            for (const p of free) { if (crew.length >= crewN) break; crew.push(p); }
        }
        const until = day + days;
        if (crew.length) {
            const each = _r2(cost / crew.length);
            for (const p of crew) {
                p.purse = _r2(Townsfolk.purse(folk, p, ctx.world) + each);
                p.job.hired = { until, label: 'building for the newcomers' };
            }
        } else {
            Economy.payTown(s, cost);
        }
        b.hired = { by: payer, wage: cost, days, crew: crew.map(p => p.id), names: crew.map(p => Townsfolk.name(p)).slice(0, 3) };
        b.hands = 'hired';
        b.readyDay = until;
        return true;
    },

    /** Everyone has a roof: the camp is struck (the town's mood given back, what is left of the gifts passed on). */
    _strike(s, g, ctx) {
        const camp = g.camp;
        const folk = _folk(s);
        if (folk) for (const h of camp.hh) for (const id of h.ids) { const p = Townsfolk.get(folk, id); if (p) delete p.camp; }
        if (_num(camp.moodHit)) s.happiness = _clamp(_num(s.happiness, 50) - _num(camp.moodHit), 0, 100);
        // (the player's fund unspent goes back to them; what the campers had in common, into the town as they settle)
        const fund = _r2(_num(camp.fund));
        if (fund > 0) {
            if (ctx.player && camp.fundBy === 'player') {
                ctx.player.gold = _r2(_num(ctx.player.gold) + fund);
                Ledger.record(ctx.player, 'charity', fund);
                if (ctx.told(s)) ctx.out.notices.push({ icon: '🪙', title: 'The Builders\' Fund', text: `The camp at ${s.name} is housed: ${Utils.formatGold(fund)}g of what you gave the builders was not needed, and comes back to you.`, type: 'info' });
            } else Economy.payTown(s, fund);
        }
        if (_num(camp.purse) > 0) Economy.payTown(s, _r2(camp.purse));
        // (food and timber left over go to the town's market)
        if (camp.stores) for (const [gd, q] of Object.entries(camp.stores)) if (q > 0 && SettlementMarket.tracks(gd)) SettlementMarket.add(s, gd, q);
        g.cleared = { id: camp.id, d: ctx.day };
        if (camp.site) g.cleared.site = camp.site;
        if (Array.isArray(camp.tentAt)) g.cleared.tents = camp.tentAt;
        g.camp = null;
        if (ctx.told(s)) {
            ctx.out.notices.push({ icon: '🏡', title: 'The Camp Is Gone', text: `The last of the camp at ${s.name} has found homes. The tents are struck, and the trodden ground will grow back.`, type: 'success' });
        }
    },

    // ──────────── THE PLAYER'S HELP ────────────

    /** The aid terms (data aid): { eat, foods, timber, per, moodMax, memory }. */
    aidConfig() {
        return { eat: 0.5, timber: ['planks', 'wood', 'stone'], per: 40, moodMax: 3, memory: 'camp_aid', ...(TownGrowth.config().aid || {}) };
    },

    /** The camp at the town the player stands in (and its settlement), or null. */
    here(player, world) {
        const t = player && world && typeof world.getTile === 'function' ? world.getTile(player.q, player.r) : null;
        const s = t && t.settlement;
        const camp = s ? TownGrowth.camp(s) : null;
        if (!camp) return null;
        if (s.q == null) { s.q = player.q; s.r = player.r; }
        return { s, camp };
    },

    /** The worth of a gift in coin, for the goodwill it buys (goods at the town's price). */
    _worth(s, kind, items) {
        if (kind === 'coin') return _num(items);
        let w = 0;
        for (const [g, q] of Object.entries(items || {})) w += _num(q) * _basePrice(g) * (SettlementMarket.tracks(g) ? SettlementMarket.scarcity(s, g) : 1);
        return w;
    },

    /** The goodwill a gift to the camp buys: the town's mood a little (to moodMax a camp), the town and the campers remember it. */
    _goodwill(world, player, s, camp, worth) {
        const A = ArrivalCamps.aidConfig();
        camp.aid = camp.aid || { worth: 0, mood: 0 };
        camp.aid.worth = _r2(_num(camp.aid.worth) + worth);
        const lift = Math.min(Math.max(0, _num(A.moodMax, 3) - _num(camp.aid.mood)), worth / Math.max(1, _num(A.per, 40)));
        if (lift > 0) {
            camp.aid.mood = _r2(_num(camp.aid.mood) + lift);
            s.happiness = _clamp(_num(s.happiness, 50) + _r2(lift), 0, 100);
        }
        const day = Math.floor(_num(world && world.day));
        if (camp.aid.told !== day) {
            camp.aid.told = day;
            try { NpcMemory.rememberTown(world, s, { kind: A.memory || 'camp_aid', player }); } catch (e) { /* no memory */ }
            const folk = _folk(s);
            if (folk) {
                for (const h of camp.hh.filter(x => !x.housed).slice(0, 8)) {
                    const p = Townsfolk.get(folk, h.head);
                    if (p) try { NpcMemory.remember(world, { folk, person: p }, { kind: 'alms', player }); } catch (e) { /* no memory */ }
                }
            }
        }
        return lift;
    },

    /**
     * Give to the camp: kind 'coin' (amount gold, into the households' purses — or the
     * camp's common purse — for timber and builders), 'food' (amount units from the
     * player's pack, `foods` the kinds to give in order: the camp eats it, and falls
     * sick less while it lasts), 'timber' (amount units of planks, wood or stone: built
     * with, nothing to pay). → { success, text } | { success: false, reason }.
     */
    give(player, world, kind, amount, foods = []) {
        const at = ArrivalCamps.here(player, world);
        if (!at) return { success: false, reason: 'There is no camp here.' };
        const { s, camp } = at;
        const n = Math.max(0, Math.floor(_num(amount)));
        if (!n) return { success: false, reason: 'Nothing to give.' };
        const inv = player.inventory || (player.inventory = {});
        const take = (ids, want) => {
            const got = {};
            let left = want;
            for (const id of ids) {
                if (left <= 0) break;
                const have = Math.floor(_num(inv[id]));
                if (have <= 0) continue;
                const t = Math.min(have, left);
                inv[id] = have - t;
                if (inv[id] <= 0) delete inv[id];
                got[id] = t;
                left -= t;
            }
            return got;
        };
        const sum = o => Object.values(o).reduce((t, v) => t + v, 0);
        if (kind === 'coin') {
            if (_num(player.gold) < n) return { success: false, reason: `You have ${Utils.formatGold(_num(player.gold))}g.` };
            player.gold = _r2(_num(player.gold) - n);
            Ledger.record(player, 'charity', -n);
            const folk = _folk(s);
            const heads = folk ? camp.hh.filter(h => !h.housed).map(h => Townsfolk.get(folk, h.head)).filter(Boolean) : [];
            if (heads.length) {
                const each = _r2(n / heads.length);
                let given = 0;
                heads.forEach((p, i) => {
                    const g = i === heads.length - 1 ? _r2(n - given) : each;
                    p.purse = _r2(Townsfolk.purse(folk, p, world) + g);
                    given = _r2(given + g);
                });
            } else camp.purse = _r2(_num(camp.purse) + n);
            ArrivalCamps._goodwill(world, player, s, camp, n);
            return { success: true, text: `You give ${Utils.formatGold(n)}g to the camp at ${s.name}${heads.length ? `, shared among its ${heads.length} households` : ''}: timber and builders' wages for their houses.` };
        }
        if (kind === 'food') {
            const got = take(foods, n);
            const k = sum(got);
            if (!k) return { success: false, reason: 'You carry no food to give.' };
            camp.food = _r2(_num(camp.food) + k);
            ArrivalCamps._goodwill(world, player, s, camp, ArrivalCamps._worth(s, 'food', got));
            const days = Math.max(1, Math.round(camp.food / Math.max(0.1, Math.max(1, camp.n - camp.housed) * _num(ArrivalCamps.aidConfig().eat, 0.5))));
            return { success: true, text: `You give ${k} food to the camp at ${s.name}. It eases them for about ${days} day${days === 1 ? '' : 's'}: fed, they fall sick less and steal less.` };
        }
        if (kind === 'timber') {
            const got = take(ArrivalCamps.aidConfig().timber || [], n);
            const k = sum(got);
            if (!k) return { success: false, reason: 'You carry no planks, wood or stone to give.' };
            camp.stores = camp.stores || {};
            for (const [g, q] of Object.entries(got)) camp.stores[g] = _num(camp.stores[g]) + q;
            ArrivalCamps._goodwill(world, player, s, camp, ArrivalCamps._worth(s, 'timber', got));
            return { success: true, text: `You give ${Object.entries(got).map(([g, q]) => `${q} ${g}`).join(', ')} to the camp at ${s.name}: their next houses are built with it, and they need buy none of it.` };
        }
        return { success: false, reason: 'They cannot use that.' };
    },

    /**
     * What it would cost to pay for every house still to come at the camp: the
     * builders' wages for each (hired days), and the timber and stone the
     * households cannot pay for, at the town's price. → { cost, houses, wages, materials } or null.
     */
    buildHomesCost(s) {
        const camp = TownGrowth.camp(s);
        if (!camp) return null;
        const per = Math.max(1, _num(TownGrowth.byType('perLot', s.type), 8));
        let houses = 0, wages = 0;
        for (const L of camp.lots) {
            if (L.ready || L.crowd) continue;
            const b = (LotBook.lot(s, L.id) || {}).built;
            if (!b || b.hired) continue;
            houses++;
            wages += ArrivalCamps.crewCost(s, ArrivalCamps.hiredDays(s));
        }
        const unlotted = Math.max(0, camp.n - camp.lots.reduce((t, L) => t + _num(L.n), 0));
        const fresh = Math.ceil(unlotted / per);
        houses += fresh;
        wages += fresh * ArrivalCamps.crewCost(s, ArrivalCamps.hiredDays(s));
        const need = TownGrowth.byType('house', s.type) || {};
        let mat = 0;
        for (const [g, q] of Object.entries(need)) mat += _num(q) * _basePrice(g) * (SettlementMarket.tracks(g) ? SettlementMarket.scarcity(s, g) : 1);
        const waiting = camp.lots.filter(L => !L.ready && !L.crowd && ((LotBook.lot(s, L.id) || {}).built || {}).wait).length;
        const materials = _r2(mat * (fresh + waiting));
        const cost = _r2(Math.max(0, wages + materials - _num(camp.fund)));
        return { cost, houses, wages: _r2(wages), materials };
    },

    /**
     * Build them homes: the player pays the builders for every house still to come
     * (buildHomesCost), into the camp's fund. Every house going up by hand is taken
     * over by hired builders, the timber is paid for, and twice the lots a week are
     * taken until all are housed; what is not spent comes back when the camp is struck.
     */
    buildHomes(player, world) {
        const at = ArrivalCamps.here(player, world);
        if (!at) return { success: false, reason: 'There is no camp here.' };
        const { s, camp } = at;
        const est = ArrivalCamps.buildHomesCost(s);
        if (!est || !(est.cost > 0)) return { success: false, reason: 'Their homes are paid for already.' };
        if (_num(player.gold) < est.cost) return { success: false, reason: `Builders and timber for ${est.houses} house${est.houses === 1 ? '' : 's'} come to ${Utils.formatGold(est.cost)}g; you have ${Utils.formatGold(_num(player.gold))}g.` };
        player.gold = _r2(_num(player.gold) - est.cost);
        Ledger.record(player, 'charity', -est.cost);
        camp.fund = _r2(_num(camp.fund) + est.cost);
        camp.fundBy = 'player';
        // (the builders take over the houses going up by hand at once, and start the next lots this very week)
        const day = Math.floor(_num(world.day));
        const ctx = { world, player, day, out: { notices: [] }, told: () => false };
        for (const L of camp.lots) {
            if (L.ready || L.crowd) continue;
            const b = (LotBook.lot(s, L.id) || {}).built;
            if (b && b.wait) ArrivalCamps._materials(s, b, camp, ctx);
            else if (b && !b.hired) ArrivalCamps._hire(s, b, camp, ctx, 'fund');
        }
        camp.next = Math.min(_num(camp.next), day);
        ArrivalCamps._goodwill(world, player, s, camp, est.cost);
        return { success: true, cost: est.cost, text: `You pay ${Utils.formatGold(est.cost)}g for the newcomers' homes at ${s.name}: the town's carpenters and masons are hired for every house still to come (${est.houses}), and the timber bought. What is not spent comes back to you.` };
    },

    // ──────────── READERS ────────────

    /** People still under canvas at a town (0 with no camp). */
    unhoused(s) {
        const camp = TownGrowth.camp(s);
        return camp ? Math.max(0, camp.n - camp.housed) : 0;
    },

    /** A line on the town's camp for the panels, or null. */
    summary(s) {
        const camp = TownGrowth.camp(s);
        if (!camp) return null;
        let building = 0, waiting = 0, hired = 0, own = 0;
        for (const L of camp.lots) {
            if (L.ready || L.crowd) continue;
            const b = (LotBook.lot(s, L.id) || {}).built;
            if (b && b.wait) waiting++;
            else { building++; if (b && b.hired) hired++; else own++; }
        }
        const st = TownGrowth.streets(s);
        const risk = TownGrowth.campRisk(s);
        return {
            n: camp.n, housed: camp.housed, under: camp.n - camp.housed, building, waiting, hired, own,
            street: st.length ? st[st.length - 1].name : null, since: camp.since, from: camp.from,
            households: TownGrowth.tentHouseholds(s), food: _num(camp.food), stores: { ...(camp.stores || {}) }, fund: _num(camp.fund),
            sick: risk ? risk.camper : 1, crime: TownGrowth.campCrime(s), mood: _num(camp.moodHit), aid: camp.aid ? _num(camp.aid.worth) : 0,
        };
    },
};
