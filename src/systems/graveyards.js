// ============================================
// GRAVEYARDS — burying the dead, and the trade that grows round it
// ============================================
// Every town buries its own (systems/townsfolk.js deaths) in its churchyard
// (world/graveBook.js; on the map by world/innerMap/graves.js). A grave is
// leased for a term its family can pay for; when the lease runs out and no
// kin renews it, the sexton clears the plot and the bones go to the charnel
// house. The player's side of it:
//
//   consecrate        a building lot of yours made a burial ground (a fee to
//                     the temple); the town's families lease its plots at
//                     your price when it's the better buy or the churchyard
//                     is full (coin out of the town's purse into yours)
//   leases            renewed by kin still in town, or lapsed: clear a lapsed
//                     grave (hire the sexton, or dig it yourself on the map)
//                     and its bones and grave goods are yours
//   bones             to the charnel house (piety), sold to a city's bone-
//                     grinder, bought from the charnel; ground in a bone mill
//                     of yours into bone meal, sold to the farmers (their
//                     soil, and next harvest, the better for it); laid in an
//                     ossuary shrine of yours that the town's people pay to
//                     visit
//   your own dead     children, a spouse, the heads of your House before you:
//                     laid to rest in your ground (a family crypt if you raise
//                     one) or the churchyard
//   the sexton's work a day of grave-digging for pay when you're poor
//   grave robbing     a theft (systems/containers.js) with standing lost on
//                     top if caught
//
// Every coin and good comes from somewhere: lease fees from the dead's family
// (the town's purse), fees you pay into it; coffins take the town's planks,
// markers its wood and stone; bones only from cleared graves, meal only from
// bones. Prices move with supply and demand (GraveBook.scarcity: free plots
// against the town's death rate; gluts at the grinder and the farms).
//
// No RNG drawn from the shared stream except the theft roll (Containers):
// choices are hashes of the town, the grave and the day. State: each
// settlement's `graveyard` (saved with the tile) and `player.graves`
// (systems/saveLoad.js EXTRA_PLAYER_FIELDS). Data: data/graves.json.

import { PlayerInventory } from '../core/inventory.js';
import { GraveBook, graveHash } from '../world/graveBook.js';
import { LotBook } from '../world/lotBook.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Harvests } from '../world/harvests.js';
import { Economy } from '../world/economy.js';
import { Townsfolk } from './townsfolk.js';
import { Ledger } from './ledger.js';
import { Containers } from './containers.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _r2 = (v) => Math.round(v * 100) / 100;
const _day = (world) => _num(world && world.day, 0);

/** A deterministic stream for one town, one day, one purpose. */
function _rng(world, s, day, salt = '') {
    const seed = (world && world.generationParams && world.generationParams.seed) || 1;
    let a = graveHash(`${seed}|${s && s.q},${s && s.r}|${day}|graves|${salt}`) || 1;
    return () => {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function _tile(world, q, r) {
    return world && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
}

function _settlementAt(world, q, r) {
    const t = _tile(world, q, r);
    return (t && t.settlement) || null;
}

/** The town's purse: what its families pay from and the temple, the sexton and the farmers are paid into. */
// (world/economy.js: a town pays out only what it holds — every caller checks _purseGold first)
function _purse(s) {
    if (!s) return null;
    if (!_obj(s.economy)) Economy.initSettlement(s);
    return s.economy;
}
function _purseGold(s) { _purse(s); const g = Economy.townPurse(s); return g == null ? 0 : g; }
function _toPurse(s, amount) {
    if (!s) return 0;
    _purse(s);
    return amount >= 0 ? Economy.payTown(s, amount) : -Economy.drawTown(s, -amount);
}

function _years(n) { return n * GraveBook.config().daysPerYear; }

function _residents(s) {
    return s && s.folk && Array.isArray(s.folk.people) ? Townsfolk.residents(s.folk).length : 15;
}

function _pick(arr, rng) { return arr && arr.length ? arr[Math.floor(rng() * arr.length)] : null; }

/** The player's book of death: { sites, kin, seen, lastSpouse, book, digDay, since }. */
function _book(player) {
    if (!player) return null;
    let b = player.graves;
    if (!_obj(b)) b = player.graves = {};
    if (!Array.isArray(b.sites)) b.sites = [];
    if (!Array.isArray(b.kin)) b.kin = [];
    if (!_obj(b.seen)) b.seen = {};
    if (!_obj(b.book)) b.book = { leases: 0, fees: 0, bones: 0, meal: 0, visits: 0, dug: 0 };
    return b;
}

function _site(player, s, lotId) {
    const b = _book(player);
    return b ? b.sites.find(x => x.q === s.q && x.r === s.r && x.lot === lotId) || null : null;
}

/** What one unit of a good costs at the town's market now (its worth × how scarce it is there). */
function _unitPrice(s, goodId) {
    const base = Math.max(1, PlayerInventory.goodValue(goodId) || 1);
    let k = 1;
    try { k = SettlementMarket.scarcity(s, goodId); } catch (e) { k = 1; }
    return Math.max(1, Math.round(base * (Number.isFinite(k) ? k : 1)));
}

/** Can the town's market spare these goods? → { ok, cost, short } */
function _quoteGoods(s, goods) {
    let cost = 0;
    for (const [id, n] of Object.entries(goods || {})) {
        if (!(n > 0)) continue;
        if (SettlementMarket.stock(s, id) + 1e-9 < n) return { ok: false, cost: 0, short: id };
        cost += _unitPrice(s, id) * n;
    }
    return { ok: true, cost: Math.ceil(cost), short: null };
}

/** Buy goods off the town's market: out of its stock, their price into its purse. */
function _buyGoods(s, goods) {
    const q = _quoteGoods(s, goods);
    if (!q.ok) return q;
    for (const [id, n] of Object.entries(goods || {})) if (n > 0) SettlementMarket.take(s, id, n);
    _toPurse(s, q.cost);
    return q;
}

function _invHas(player, id) { return Math.max(0, Math.floor(_num(player && player.inventory && player.inventory[id]))); }
function _invTake(player, id, n) {
    if (!player.inventory) player.inventory = {};
    player.inventory[id] = Math.max(0, _num(player.inventory[id]) - n);
    if (!player.inventory[id]) delete player.inventory[id];
}
function _invGive(player, id, n) {
    if (!(n > 0)) return 0;
    const r = PlayerInventory.addItem(player, id, n);
    return r && r.success ? n : 0;
}

export const Graveyards = {
    config() { return GraveBook.config(); },

    // ──────────── THE BOOK ────────────

    /**
     * The town's graveyard, its churchyard made and — the first time — the
     * graves of the years before laid in (GraveBook seedFill of the plots).
     */
    ensure(world, s) {
        if (!s) return null;
        const g = GraveBook.of(s);
        const town = GraveBook.townGround(s);
        if (!g.seeded) {
            g.seeded = true;
            Graveyards._seed(world, s, town, _day(world));
        }
        return g;
    },

    _seed(world, s, ground, day) {
        const C = GraveBook.config();
        const rng = _rng(world, s, 0, 'seed');
        const folk = s.folk || (s.culture ? { culture: s.culture } : null);
        const T = Townsfolk.config();
        const free = GraveBook.freePlots(ground);
        // a hash-shuffle of the plots
        for (let i = free.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = free[i]; free[i] = free[j]; free[j] = t; }
        const n = Math.round(free.length * _num(C.seedFill, 0.55));
        const recent = Math.round(n * _num(C.seedRecent, 0.5));
        const lastNames = (s.folk && Array.isArray(s.folk.people) && s.folk.people.length)
            ? [...new Set(s.folk.people.map(p => p.last).filter(Boolean))] : Townsfolk._lastNames(folk);
        for (let k = 0; k < n; k++) {
            const gender = rng() < 0.5 ? 'male' : 'female';
            const first = _pick(Townsfolk._firstNames(folk, gender), rng) || 'Someone';
            const last = _pick(lastNames, rng) || '';
            const isRecent = k < recent;
            const ago = isRecent ? 1 + Math.floor(rng() * 23) : 30 + Math.floor(rng() * 120);
            const died = day - Math.floor(_years(ago) + rng() * C.daysPerYear);
            const age = 1 + Math.floor(rng() * 80);
            const roll = rng();
            const cls = isRecent ? (roll < 0.1 ? 'pauper' : roll < 0.8 ? 'common' : 'middling') : (roll < 0.15 ? 'rich' : roll < 0.45 ? 'middling' : 'common');
            const cause = age < 5 ? _pick(T.causes.infant, rng) : age > 60 ? _pick(T.causes.old, rng) : _pick(T.causes.common, rng);
            const term = isRecent ? GraveBook.classDef(cls).term : 'perpetual';
            const until = term === 'perpetual' ? null : GraveBook.leaseUntil(term, died);
            const key = `s${s.q},${s.r}#${k}`;
            const gd = GraveBook.classDef(cls).goods || [0, 0, 0];
            ground.plots[free[k]] = {
                id: key, pid: null, name: `${first} ${last}`.trim(), born: died - _years(age), died, cause: cause || 'a fever',
                cls, marker: GraveBook.pickMarker(cls, key), term, until, plot: free[k],
                goods: rng() < _num(gd[0]) ? _num(gd[1]) + Math.floor(rng() * (_num(gd[2]) - _num(gd[1]) + 1)) : 0,
                by: 'seed', paid: 0, lapsed: null, kin: false,
            };
        }
    },

    /** A ground by id ('town' or a lot id). */
    ground(s, id) {
        const g = s && _obj(s.graveyard);
        return g && g.grounds && g.grounds[id] ? GraveBook.groundShape(g.grounds[id]) : null;
    },

    /** Is a player's ground open for burials (consecrated, the blessing given)? */
    isOpen(ground, day) {
        return !!ground && (ground.owner === 'town' || ground.since == null || day >= ground.since);
    },

    // ──────────── BURIALS ────────────

    /**
     * Lay the town's newly dead in the ground. Called each season the roster
     * is reckoned (and on first sight of a town), for every dead townsperson
     * not yet buried.
     */
    burySeason(world, s, player = null, notices = []) {
        const folk = s && s.folk;
        if (!folk || !Array.isArray(folk.people)) return notices;
        const g = Graveyards.ensure(world, s);
        const day = _day(world);
        const firstLook = g.scanTick == null;
        // Old dead from before the town had a graveyard are already in the ground somewhere (the seed)
        for (const p of folk.people) {
            if (p.died == null || g.buried[p.id]) continue;
            if (p.away && !p.away.withPlayer) { g.buried[p.id] = 'away'; continue; }
            if (firstLook && day - p.died > _years(2)) { g.buried[p.id] = 'old'; continue; }
            Graveyards.bury(world, s, p, player, notices);
        }
        // The sexton clears graves long run out (a year past their lease), the bones to the charnel house
        Graveyards._sextonClears(world, s, day, false);
        Graveyards._newGround(world, s, day, player, notices);
        // Forget the buried who have dropped off the roster
        const ids = new Set(folk.people.map(p => p.id));
        for (const k of Object.keys(g.buried)) if (!ids.has(Number(k))) delete g.buried[k];
        g.scanTick = _num(folk.tick, day);
        // Recent deaths, for the death rate
        g.deaths = g.deaths.filter(d => d > day - _years(5));
        return notices;
    },

    /** One townsperson to the ground: the family chooses where (and for how long) by what it can pay. */
    bury(world, s, p, player = null, notices = []) {
        const g = Graveyards.ensure(world, s);
        const day = Math.max(_day(world), _num(p.died));
        const C = GraveBook.config();
        g.buried[p.id] = true;
        g.deaths.push(_num(p.died, day));
        g.digWork = _num(g.digWork) + 1;
        const cls = GraveBook.classOf(p);
        const res = _residents(s);
        const want = GraveBook.classDef(cls).term;
        const terms = GraveBook.termsDown();
        const startAt = Math.max(0, terms.indexOf(want));
        const purse = _purseGold(s);

        // Where can they lie, and what does each cost at the longest term the family can pay?
        const town = GraveBook.townGround(s);
        if (!GraveBook.freePlots(town).length) Graveyards._sextonClears(world, s, day, true);
        const options = [];
        const offer = (ground) => {
            if (!ground || !Graveyards.isOpen(ground, day) || !GraveBook.freePlots(ground).length) return;
            if (ground.owner === 'player' && !player) return;
            for (let i = startAt; i < terms.length; i++) {
                const price = GraveBook.leasePrice(s, ground, terms[i], day, res);
                if (ground.owner === 'town' || price <= purse) { options.push({ ground, term: terms[i], price, rank: i }); return; }
            }
        };
        offer(town);
        for (const gr of GraveBook.grounds(s)) if (gr.owner === 'player') offer(gr);
        // The longest lease first, then the cheaper; the parish when it's no dearer
        options.sort((a, b) => a.rank - b.rank || a.price - b.price || (a.ground.owner === 'town' ? -1 : 1));
        const choice = options[0] || null;
        if (!GraveBook.freePlots(town).length) { if (g.fullSince == null) g.fullSince = day; } else g.fullSince = null;
        if (!choice) {
            g.pit = _num(g.pit) + 1;
            return null;
        }
        const ground = choice.ground;
        const plot = GraveBook.freePlots(ground)[0];
        const key = `f${s.q},${s.r}#${p.id}`;
        const rng = _rng(world, s, day, key);
        const gd = GraveBook.classDef(cls).goods || [0, 0, 0];
        // The undertaker's coffin (the town's planks) and the marker (its wood or stone)
        const planks = _num(GraveBook.classDef(cls).coffin) * _num(C.coffinPlanks, 1);
        const coffin = planks > 0 ? SettlementMarket.take(s, 'planks', planks) : 0;
        let marker = GraveBook.pickMarker(cls, key);
        marker = Graveyards._raiseMarker(s, marker);
        const grave = {
            id: key, pid: p.id, name: Townsfolk.name(p), born: p.born, died: _num(p.died, day), cause: p.cause || null,
            cls, marker, term: choice.term, until: GraveBook.leaseUntil(choice.term, day), plot, ground: ground.id,
            goods: rng() < _num(gd[0]) ? _num(gd[1]) + Math.floor(rng() * (_num(gd[2]) - _num(gd[1]) + 1)) : 0,
            by: 'family', paid: ground.owner === 'player' ? choice.price : 0, lapsed: null, kin: false,
            coffin: coffin >= planks && planks > 0 ? 'coffin' : 'shroud', interred: day,
        };
        ground.plots[plot] = grave;
        delete ground.open[plot];
        if (ground.owner === 'player' && player) {
            _toPurse(s, -choice.price);
            player.gold = _num(player.gold) + choice.price;
            Ledger.record(player, 'graveLeases', choice.price);
            const b = _book(player);
            b.book.leases = _num(b.book.leases) + choice.price;
            const t = GraveBook.term(choice.term);
            notices.push({ icon: '⚰️', title: `A Burial in ${s.name}`, type: 'success', text: `${grave.name} is laid to rest in your ground — a lease of ${t ? t.name : choice.term}, ${choice.price}g from the family.` });
        }
        return grave;
    },

    /** The marker as the town's stores allow: stone it has, or wood, or a bare mound. */
    _raiseMarker(s, marker) {
        const want = [marker, 'cross_wood', 'grave_mound'];
        for (const m of want) {
            const d = GraveBook.markerDef(m);
            const inputs = (d && d.inputs) || {};
            const ok = Object.entries(inputs).every(([id, n]) => SettlementMarket.stock(s, id) + 1e-9 >= n);
            if (!ok) continue;
            for (const [id, n] of Object.entries(inputs)) SettlementMarket.take(s, id, n);
            return m;
        }
        return 'grave_mound';
    },

    /**
     * The sexton clears the churchyard's run-out graves: a year past their
     * lease, or (when `need`) the oldest run out now. Bones to the charnel house.
     */
    _sextonClears(world, s, day, need) {
        const g = GraveBook.of(s);
        const town = GraveBook.townGround(s);
        const out = [];
        for (let i = 0; i < town.cap; i++) {
            const gr = town.plots[i];
            if (gr && GraveBook.isExpired(gr, day)) out.push({ i, gr });
        }
        out.sort((a, b) => a.gr.until - b.gr.until);
        let cleared = 0;
        for (const { i, gr } of out) {
            if (!need && day < gr.until + _years(1)) continue;
            town.plots[i] = null;
            town.open[i] = day;
            g.charnel = _num(g.charnel) + 1;
            g.digWork = _num(g.digWork) + 1;
            cleared++;
            if (need) break;
        }
        // An open grave stands a season before it's filled or taken
        for (const [k, d] of Object.entries(town.open)) if (day - d > 30) delete town.open[k];
        return cleared;
    },

    /** Full for long enough and able to pay, the town opens a new ground beside the old. */
    _newGround(world, s, day, player, notices) {
        const C = GraveBook.config();
        const g = GraveBook.of(s);
        const town = GraveBook.townGround(s);
        if (GraveBook.freePlots(town).length) { g.fullSince = null; return false; }
        if (g.fullSince == null) { g.fullSince = day; return false; }
        if (day - g.fullSince < _years(_num(C.newGroundAfterYears, 2))) return false;
        const cost = _num(GraveBook.byType(C.newGroundCost, s.type), 200);
        if (_purseGold(s) < cost * 2) return false;
        // The land is bought of the realm (its treasury), else the town's lord
        _toPurse(s, -cost);
        const k = s.kingdom != null && world && typeof world.getKingdom === 'function' ? world.getKingdom(s.kingdom) : null;
        if (k) k.treasury = _num(k.treasury) + cost;
        const more = Math.max(2, Math.ceil(town.cap * _num(C.newGroundShare, 0.5)));
        town.cap += more;
        GraveBook.groundShape(town);
        g.opened = _num(g.opened) + 1;
        g.fullSince = null;
        if (player && _book(player).sites.some(x => x.q === s.q && x.r === s.r && x.kind === 'ground')) {
            notices.push({ icon: '⛪', title: `New Ground in ${s.name}`, type: 'info', text: `The parish of ${s.name} has bought new ground for its dead — ${more} plots. Your plots will fetch less.` });
        }
        return true;
    },

    // ──────────── THE DAY ────────────

    /**
     * The day's dying and its trade: towns whose roster lived a season bury
     * their dead; the player's grounds' leases run out (kin renew, or they
     * lapse), mills grind, ossuaries take visitors; the player's own dead are
     * noted for burial.
     * @returns {{ notices: Array<{icon,title,text,type}> }}
     */
    processDay(world, player = null) {
        const notices = [];
        if (!GraveBook.config().enabled || !world) return { notices };
        const day = _day(world);
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        for (const s of views) {
            if (!s || !s.folk) continue;
            const g = s.graveyard;
            if (g && g.scanTick === _num(s.folk.tick, -1)) continue;
            Graveyards.burySeason(world, s, player, notices);
        }
        if (player) {
            Graveyards._sitesDay(world, player, day, notices);
            Graveyards._kinDay(world, player, day, notices);
        }
        return { notices };
    },

    _sitesDay(world, player, day, notices) {
        const C = GraveBook.config();
        const b = _book(player);
        for (const site of b.sites) {
            const s = _settlementAt(world, site.q, site.r);
            if (!s) continue;
            if (site.kind === 'ground') {
                const ground = Graveyards.ground(s, site.lot);
                if (ground) Graveyards._leaseDay(world, s, ground, player, day, notices);
            } else if (site.kind === 'mill') {
                if (day < _num(site.readyDay)) continue;
                const n = Math.min(_num(site.hopper), _num(C.mill.grindPerDay, 6));
                if (n > 0) {
                    site.hopper = _num(site.hopper) - n;
                    site.meal = _num(site.meal) + n * _num(C.mill.mealPerBone, 2);
                    if (!site.hopper) notices.push({ icon: '🦴', title: 'The Bone Mill', type: 'info', text: `Your bone mill in ${s.name} has ground the last of its bones: ${Math.floor(site.meal)} bone meal waiting.` });
                }
            } else if (site.kind === 'ossuary') {
                if (day < _num(site.readyDay)) continue;
                const O = C.ossuary;
                const max = Math.min(_num(GraveBook.byType(O.maxVisitors, s.type), 3), Math.floor(_num(site.bones) / Math.max(1, _num(O.bonesPerVisitor, 8))));
                if (max <= 0) continue;
                const rng = _rng(world, s, day, `oss${site.lot}`);
                const visitors = Math.floor(rng() * (max + 1));
                const fee = Math.min(_purseGold(s), visitors * _num(GraveBook.byType(O.perVisit, s.type), 1));
                if (fee > 0) {
                    _toPurse(s, -fee);
                    player.gold = _num(player.gold) + fee;
                    Ledger.record(player, 'ossuaryVisits', fee);
                    b.book.visits = _num(b.book.visits) + fee;
                    site.visitors = _num(site.visitors) + visitors;
                }
            }
        }
    },

    /** A ground of the player's: leases run out today — renewed by kin who can pay, else lapsed. */
    _leaseDay(world, s, ground, player, day, notices) {
        const res = _residents(s);
        const folk = s.folk;
        const b = _book(player);
        for (let i = 0; i < ground.cap; i++) {
            const gr = ground.plots[i];
            if (!gr || gr.kin || gr.lapsed != null || !GraveBook.isExpired(gr, day)) continue;
            const p = folk && gr.pid != null ? Townsfolk.get(folk, gr.pid) : null;
            const kin = p ? [p.spouse, ...(p.kids || [])].map(id => Townsfolk.get(folk, id)).filter(Townsfolk.isHere) : [];
            const rng = _rng(world, s, day, `renew${gr.id}`);
            const chance = _num(GraveBook.classDef(gr.cls).renew, 0.2) * (kin.length ? 1 : 0.15);
            let renewed = false;
            if (rng() < chance) {
                const term = gr.term === 'perpetual' ? 't50' : gr.term;
                for (const t of [term, 't10']) {
                    const price = GraveBook.leasePrice(s, ground, t, day, res);
                    if (_purseGold(s) < price) continue;
                    _toPurse(s, -price);
                    player.gold = _num(player.gold) + price;
                    Ledger.record(player, 'graveLeases', price);
                    b.book.leases = _num(b.book.leases) + price;
                    gr.term = t;
                    gr.until = GraveBook.leaseUntil(t, day);
                    gr.paid = _num(gr.paid) + price;
                    renewed = true;
                    const who = kin[0] ? Townsfolk.name(kin[0]) : 'the family';
                    notices.push({ icon: '⚰️', title: 'A Lease Renewed', type: 'success', text: `${who} renews the lease on ${gr.name}'s grave in ${s.name}: ${price}g.` });
                    break;
                }
            }
            if (!renewed) {
                gr.lapsed = day;
                notices.push({ icon: '⚰️', title: 'A Lease Runs Out', type: 'info', text: `The lease on ${gr.name}'s grave in your ground at ${s.name} has run out, and no one has renewed it. Clear it to free the plot.` });
            }
        }
    },

    // ──────────── YOUR GROUND ────────────

    /** A lot of the player's that could be consecrated: { lot: {id,w,h}, rec } or a reason. */
    _ownLot(s, lot) {
        const id = lot && (lot.id || lot);
        const rec = LotBook.lot(s, id);
        if (!rec) return { ok: false, reason: 'Buy the lot first.' };
        if (!LotBook.isPlayer(rec)) return { ok: false, reason: `This lot belongs to ${rec.holderName}.` };
        let dims = lot && lot.w ? lot : null;
        const known = s.lotBook && s.lotBook.known && Array.isArray(s.lotBook.known.lots) ? s.lotBook.known.lots : [];
        if (!dims) dims = known.find(l => l.id === id) || null;
        if (!dims) return { ok: false, reason: 'Walk the lot first: its stakes must be seen.' };
        return { ok: true, id, w: dims.w, h: dims.h, gate: dims.gate || null, rec };
    },

    /** The price of consecrating ground here (the temple's fee). */
    consecrateFee(s) {
        return Math.round(_num(GraveBook.byType(GraveBook.config().consecrate.fee, s && s.type), 60));
    },

    /** Make a lot of yours a burial ground: the priest's blessing (a fee to the temple). */
    consecrate(player, world, s, lot) {
        if (!player || !s) return { success: false, reason: 'There is no town here.' };
        const L = Graveyards._ownLot(s, lot);
        if (!L.ok) return { success: false, reason: L.reason };
        if (L.rec.built) return { success: false, reason: `Your ${L.rec.built.name || 'building'} already stands on it.` };
        const C = GraveBook.config().consecrate;
        const standing = s.kingdom != null && player.reputation ? _num(player.reputation[s.kingdom]) : 0;
        if (standing < _num(C.minStanding, -20)) return { success: false, reason: `The priest of ${s.name} will not bless ground for one so ill thought of in the realm.` };
        const fee = Graveyards.consecrateFee(s);
        if (_num(player.gold) < fee) return { success: false, reason: `The temple asks ${fee}g for the blessing; you have ${Math.floor(_num(player.gold))}g.` };
        const plots = GraveBook.plotCount(L.w, L.h);
        if (plots < 2) return { success: false, reason: 'The lot is too small to lay out graves in.' };
        player.gold -= fee;
        _toPurse(s, fee);
        Ledger.record(player, 'graveFees', -fee);
        const day = _day(world);
        Graveyards.ensure(world, s);
        const readyDay = day + _num(C.days, 1);
        L.rec.built = { kind: 'burial', type: 'burial_ground', name: 'Burial Ground', by: 'player', readyDay };
        s.graveyard.grounds[L.id] = GraveBook.newGround(L.id, 'player', 'Your Burial Ground', plots, { since: readyDay, lot: L.id, w: L.w, h: L.h, front: L.gate || 'south' });
        const b = _book(player);
        b.book.fees = _num(b.book.fees) + fee;
        if (!_site(player, s, L.id)) b.sites.push({ kind: 'ground', q: s.q, r: s.r, lot: L.id, town: s.name });
        return { success: true, fee, plots, text: `The priest of ${s.name} blesses your lot as a burial ground (${fee}g to the temple): ${plots} plots, open to the town's families from tomorrow.` };
    },

    /** Your price: cheap, fair or dear against the going rate. */
    setPolicy(player, world, s, lotId, policy) {
        const ground = Graveyards.ground(s, lotId);
        if (!ground || ground.owner !== 'player') return { success: false, reason: 'That is not your ground.' };
        if (!GraveBook.config().pricing.policies[policy]) return { success: false, reason: 'No such price.' };
        ground.policy = policy;
        return { success: true, text: `Your plots in ${s.name} are now priced ${policy}.` };
    },

    /** What a lease in each ground would cost a family today: [{ ground, term, price }]. */
    priceBoard(world, s) {
        const day = _day(world);
        const res = _residents(s);
        const out = [];
        for (const gr of GraveBook.grounds(s)) {
            for (const t of GraveBook.termsDown()) out.push({ ground: gr.id, owner: gr.owner, term: t, price: GraveBook.leasePrice(s, gr, t, day, res) });
        }
        return out;
    },

    /**
     * Clear a grave in your ground whose lease has run out (or an empty one
     * of your own kin, never): its bones and grave goods are yours, the plot
     * free. how: 'sexton' (his fee to the town) or 'self' (you dug it).
     */
    clearPlot(player, world, s, groundId, plot, how = 'sexton') {
        const ground = Graveyards.ground(s, groundId);
        if (!ground || ground.owner !== 'player') return { success: false, reason: 'That is not your ground.' };
        const gr = ground.plots[plot];
        if (!gr) return { success: false, reason: 'No one lies there.' };
        const day = _day(world);
        if (gr.kin) return { success: false, reason: `${gr.name} is of your own blood: they lie here for ever.` };
        if (!GraveBook.isExpired(gr, day)) return { success: false, reason: `${gr.name}'s lease runs ${Math.max(1, GraveBook.yearsBetween(day, gr.until))} more year(s).` };
        if (gr.lapsed == null) gr.lapsed = day;
        const fee = how === 'sexton' ? Math.round(_num(GraveBook.byType(GraveBook.config().sextonFee, s.type), 4)) : 0;
        if (fee && _num(player.gold) < fee) return { success: false, reason: `The sexton asks ${fee}g.` };
        if (!PlayerInventory.canAdd(player, 'bones')) return { success: false, reason: PlayerInventory.fullMessage ? PlayerInventory.fullMessage(player) : 'Your packs are full.' };
        if (fee) {
            player.gold -= fee;
            _toPurse(s, fee);
            Ledger.record(player, 'graveFees', -fee);
            _book(player).book.fees = _num(_book(player).book.fees) + fee;
        }
        ground.plots[plot] = null;
        ground.open[plot] = day;
        _invGive(player, 'bones', 1);
        const goods = _num(gr.goods) > 0 ? _invGive(player, 'grave_goods', _num(gr.goods)) : 0;
        _book(player).book.bones = _num(_book(player).book.bones) + 1;
        const what = goods ? `the bones and ${goods} grave good${goods === 1 ? '' : 's'}` : 'the bones';
        return { success: true, fee, goods, text: `${how === 'sexton' ? `The sexton (${fee}g) digs` : 'You dig'} up ${gr.name}'s grave: ${what} are yours, the plot free.` };
    },

    // ──────────── BONES ────────────

    /** What the bone-grinder pays a set today (null where there is none). */
    bonePrice(s) {
        const B = GraveBook.config().bones;
        if (!s || !(B.grinderTypes || []).includes(s.type)) return null;
        const glut = Math.max(0, _num(GraveBook.of(s).boneGlut));
        return Math.max(1, Math.round(_num(B.boneBase, 5) * Math.max(0.2, 1 - glut)));
    },

    /** The gluts at the grinder and the farms ease, and the town's sexton digs, for each day since last asked. */
    _easeGluts(s, day) {
        const g = GraveBook.of(s);
        const B = GraveBook.config().bones, M = GraveBook.config().meal;
        const last = _num(g.glutDay, day);
        const n = Math.max(0, day - last);
        if (n > 0) {
            g.boneGlut = _r2(_num(g.boneGlut) * Math.pow(1 - _num(B.glutDecay, 0.05), n));
            g.mealGlut = _r2(_num(g.mealGlut) * Math.pow(1 - _num(M.glutDecay, 0.04), n));
            // The town's own sexton digs what no one else has
            g.digWork = Math.max(0, _num(g.digWork) - n * _num(GraveBook.config().gravedigger.sextonPerDay, 1));
        }
        g.glutDay = day;
    },

    /** Sell sets of bones to the town's bone-grinder (a city's): coin from the town's purse; he grinds them for its farms. */
    sellBones(player, world, s, n) {
        const day = _day(world);
        Graveyards._easeGluts(s, day);
        const have = _invHas(player, 'bones');
        n = Math.min(have, Math.max(1, Math.floor(n)));
        if (!have) return { success: false, reason: 'You have no bones to sell.' };
        if (Graveyards.bonePrice(s) == null) return { success: false, reason: `${s.name} has no bone-grinder: a city's or a capital's buys bones.` };
        const B = GraveBook.config().bones;
        const g = GraveBook.of(s);
        let total = 0, sold = 0;
        for (let i = 0; i < n; i++) {
            const p = Math.max(1, Math.round(_num(B.boneBase, 5) * Math.max(0.2, 1 - _num(g.boneGlut))));
            if (_purseGold(s) < total + p) break;
            total += p; sold++;
            g.boneGlut = _r2(_num(g.boneGlut) + _num(B.glutPer, 0.06));
        }
        if (!sold) return { success: false, reason: `The bone-grinder has no coin to pay with: ${s.name}'s purse is empty.` };
        _invTake(player, 'bones', sold);
        _toPurse(s, -total);
        player.gold = _num(player.gold) + total;
        Ledger.record(player, 'boneTrade', total);
        _book(player).book.bones = _num(_book(player).book.bones);
        // He grinds them for the town's farmers
        Graveyards._spreadMeal(world, s, sold * _num(GraveBook.config().mill.mealPerBone, 2));
        return { success: true, sold, total, text: `The bone-grinder of ${s.name} takes ${sold} set${sold === 1 ? '' : 's'} of bones for ${total}g.` };
    },

    /** Give bones to the charnel house: no coin, a little standing for the pious act. */
    giveBones(player, world, s, n) {
        const have = _invHas(player, 'bones');
        n = Math.min(have, Math.max(1, Math.floor(n)));
        if (!have) return { success: false, reason: 'You have no bones.' };
        const g = Graveyards.ensure(world, s);
        _invTake(player, 'bones', n);
        g.charnel = _num(g.charnel) + n;
        const gain = Math.min(5, n * 0.2 * _num(GraveBook.config().bones.charnelStanding, 1));
        if (s.kingdom != null) {
            if (!player.reputation) player.reputation = {};
            player.reputation[s.kingdom] = _r2(_num(player.reputation[s.kingdom]) + gain);
        }
        return { success: true, text: `The sexton lays ${n} set${n === 1 ? '' : 's'} of bones in ${s.name}'s charnel house. The town thinks the better of you.` };
    },

    /** Buy bones out of the town's charnel house (into its purse). */
    buyCharnelBones(player, world, s, n) {
        const g = Graveyards.ensure(world, s);
        const price = Math.max(1, Math.round(_num(GraveBook.config().bones.charnelPrice, 4)));
        n = Math.min(Math.floor(_num(g.charnel)), Math.max(1, Math.floor(n)));
        if (n <= 0) return { success: false, reason: `${s.name}'s charnel house is empty.` };
        const cost = price * n;
        if (_num(player.gold) < cost) return { success: false, reason: `${n} sets cost ${cost}g.` };
        if (!PlayerInventory.canAdd(player, 'bones')) return { success: false, reason: 'Your packs are full.' };
        player.gold -= cost;
        _toPurse(s, cost);
        Ledger.record(player, 'boneTrade', -cost);
        g.charnel = _num(g.charnel) - n;
        _invGive(player, 'bones', n);
        return { success: true, text: `The sexton sells you ${n} set${n === 1 ? '' : 's'} of bones from the charnel house for ${cost}g.` };
    },

    // ──────────── THE BONE MILL & BONE MEAL ────────────

    _buildOnLot(player, world, s, lot, kind, C, extra = {}) {
        const L = Graveyards._ownLot(s, lot);
        if (!L.ok) return { success: false, reason: L.reason };
        if (L.rec.built) return { success: false, reason: `Your ${L.rec.built.name || 'building'} already stands on it.` };
        const gold = Math.round(_num(GraveBook.byType(C.cost, s.type), 150));
        const q = _quoteGoods(s, C.inputs);
        if (!q.ok) return { success: false, reason: `${s.name}'s market hasn't the ${q.short} to build with.` };
        const total = gold + q.cost;
        if (_num(player.gold) < total) return { success: false, reason: `It costs ${gold}g in wages and ${q.cost}g in ${Object.keys(C.inputs || {}).join(' and ')}: ${total}g; you have ${Math.floor(_num(player.gold))}g.` };
        if (extra.bones && _invHas(player, 'bones') < extra.bones) return { success: false, reason: `Founding it takes ${extra.bones} sets of bones; you have ${_invHas(player, 'bones')}.` };
        _buyGoods(s, C.inputs);
        player.gold -= total;
        _toPurse(s, gold);
        Ledger.record(player, 'graveWorks', -total);
        if (extra.bones) _invTake(player, 'bones', extra.bones);
        const day = _day(world);
        const readyDay = day + _num(C.days, 6);
        const name = kind === 'mill' ? 'Bone Mill' : 'Ossuary Shrine';
        L.rec.built = { kind: kind === 'mill' ? 'bone_mill' : 'ossuary', type: kind === 'mill' ? 'bone_mill' : 'ossuary', name, by: 'player', readyDay, cost: total };
        _book(player).sites.push({ kind, q: s.q, r: s.r, lot: L.id, town: s.name, readyDay, ...(kind === 'mill' ? { hopper: 0, meal: 0 } : { bones: _num(extra.bones), visitors: 0 }) });
        return { success: true, total, text: `Your ${name.toLowerCase()} goes up on your lot in ${s.name}: ${total}g (${gold}g wages, ${q.cost}g of the town's ${Object.keys(C.inputs || {}).join(' and ')}). It stands in ${_num(C.days, 6)} days.` };
    },

    buildMill(player, world, s, lot) {
        return Graveyards._buildOnLot(player, world, s, lot, 'mill', GraveBook.config().mill);
    },

    /** Tip bones into the mill's hopper. */
    loadMill(player, world, s, lotId, n) {
        const site = _site(player, s, lotId);
        if (!site || site.kind !== 'mill') return { success: false, reason: 'You have no bone mill there.' };
        n = Math.min(_invHas(player, 'bones'), Math.max(1, Math.floor(n)));
        if (n <= 0) return { success: false, reason: 'You have no bones to grind.' };
        _invTake(player, 'bones', n);
        site.hopper = _num(site.hopper) + n;
        const days = Math.ceil(site.hopper / Math.max(1, _num(GraveBook.config().mill.grindPerDay, 6)));
        return { success: true, text: `${n} set${n === 1 ? '' : 's'} of bones into the hopper: ground in ${days} day${days === 1 ? '' : 's'}.` };
    },

    /** Take the mill's bone meal. */
    collectMeal(player, world, s, lotId) {
        const site = _site(player, s, lotId);
        if (!site || site.kind !== 'mill') return { success: false, reason: 'You have no bone mill there.' };
        const n = Math.floor(_num(site.meal));
        if (n <= 0) return { success: false, reason: 'No meal ground yet.' };
        if (!_invGive(player, 'bone_meal', n)) return { success: false, reason: 'Your packs are full.' };
        site.meal = _r2(_num(site.meal) - n);
        _book(player).book.meal = _num(_book(player).book.meal) + n;
        return { success: true, text: `You bag ${n} bone meal.` };
    },

    /** What the town's farmers pay for a unit of bone meal today. */
    mealPrice(s) {
        const M = GraveBook.config().meal;
        const g = GraveBook.of(s);
        return Math.max(1, Math.round(_num(M.mealBase, 3) * _num(GraveBook.byType(M.farmFactor, s.type), 1) * Math.max(0.25, 1 - _num(g.mealGlut)) * 100) / 100);
    },

    /** Sell bone meal to the farmers: from the town's purse; their soil the richer for it. */
    sellMeal(player, world, s, n) {
        const day = _day(world);
        Graveyards._easeGluts(s, day);
        const have = _invHas(player, 'bone_meal');
        n = Math.min(have, Math.max(1, Math.floor(n)));
        if (!have) return { success: false, reason: 'You have no bone meal.' };
        const M = GraveBook.config().meal;
        const g = GraveBook.of(s);
        let total = 0, sold = 0;
        for (let i = 0; i < n; i++) {
            const p = Graveyards.mealPrice(s);
            if (_purseGold(s) < total + p) break;
            total += p; sold++;
            g.mealGlut = _r2(_num(g.mealGlut) + _num(M.glutPer, 0.02));
        }
        total = Math.floor(total);
        if (!sold) return { success: false, reason: `The farmers of ${s.name} have no coin: its purse is empty.` };
        _invTake(player, 'bone_meal', sold);
        _toPurse(s, -total);
        player.gold = _num(player.gold) + total;
        Ledger.record(player, 'boneTrade', total);
        const soil = Graveyards._spreadMeal(world, s, sold);
        return { success: true, sold, total, soil, text: `The farmers of ${s.name} buy ${sold} bone meal for ${total}g and spread it on their fields (soil ${soil.toFixed(2)}).` };
    },

    /** Bone meal on a town's fields: its soil (world/harvests.js) rises toward the harvest's max. */
    _spreadMeal(world, s, units) {
        const f = Harvests.ensureFarm(world, s);
        if (!f) return 1;
        const S = Harvests.config().soil || { max: 1.2 };
        const per = _num(GraveBook.config().meal.soilPerUnit, 0.004);
        f.soil = Math.round(Math.min(_num(S.max, 1.2), _num(f.soil, 1) + units * per) * 1000) / 1000;
        return f.soil;
    },

    // ──────────── THE OSSUARY ────────────

    buildOssuary(player, world, s, lot) {
        const O = GraveBook.config().ossuary;
        return Graveyards._buildOnLot(player, world, s, lot, 'ossuary', O, { bones: Math.max(1, _num(O.foundBones, 12)) });
    },

    /** Lay more bones in your ossuary: more of the town's dead, more visitors. */
    layBones(player, world, s, lotId, n) {
        const site = _site(player, s, lotId);
        if (!site || site.kind !== 'ossuary') return { success: false, reason: 'You have no ossuary there.' };
        n = Math.min(_invHas(player, 'bones'), Math.max(1, Math.floor(n)));
        if (n <= 0) return { success: false, reason: 'You have no bones.' };
        _invTake(player, 'bones', n);
        site.bones = _num(site.bones) + n;
        return { success: true, text: `${n} set${n === 1 ? '' : 's'} of bones laid in the ossuary: ${site.bones} now.` };
    },

    // ──────────── THE FAMILY CRYPT ────────────

    /** The plots a crypt would stand on: the back middle of the ground. */
    _cryptPlots(ground) {
        const w = _num(ground.w, 7), h = _num(ground.h, 6);
        const plots = GraveBook.yardPlots(0, 0, w, h, ground.front || 'south');
        const [cw, ch] = [3, 3];
        const back = (ground.front || 'south') === 'south';
        const q0 = Math.floor((w - cw) / 2), q1 = q0 + cw - 1, r0 = back ? 0 : h - ch, r1 = r0 + ch - 1;
        const out = [];
        plots.forEach((p, i) => { if (p.r + 1 >= r0 && p.r <= r1 && p.q >= q0 && p.q <= q1) out.push(i); });
        return out;
    },

    raiseCrypt(player, world, s, lotId) {
        const ground = Graveyards.ground(s, lotId);
        if (!ground || ground.owner !== 'player') return { success: false, reason: 'Consecrate the ground first.' };
        if (ground.crypt) return { success: false, reason: 'Your family crypt already stands there.' };
        const held = Graveyards._cryptPlots(ground);
        if (held.some(i => ground.plots[i])) return { success: false, reason: 'Graves lie where the crypt would stand: clear them first.' };
        const d = GraveBook.markerDef('crypt') || {};
        const q = _quoteGoods(s, d.inputs || {});
        if (!q.ok) return { success: false, reason: `${s.name}'s market hasn't the ${q.short} for it.` };
        const total = q.cost + Math.round(_num(d.mason, 200));
        if (_num(player.gold) < total) return { success: false, reason: `The mason asks ${total}g with the stone; you have ${Math.floor(_num(player.gold))}g.` };
        _buyGoods(s, d.inputs || {});
        player.gold -= total;
        _toPurse(s, total - q.cost);
        Ledger.record(player, 'graveWorks', -total);
        ground.crypt = { graves: [], plots: held, built: _day(world), holds: _num(d.holds, 8) };
        return { success: true, text: `A family crypt of stone rises at the head of your ground in ${s.name} (${total}g): room for ${ground.crypt.holds} of your blood.` };
    },

    // ──────────── YOUR OWN DEAD ────────────

    _kinDay(world, player, day, notices) {
        const b = _book(player);
        const first = b.since == null;
        if (first) b.since = day;
        const note = (key, rec) => {
            if (b.seen[key]) return;
            b.seen[key] = true;
            if (first && day - _num(rec.died, day) > 60) return;
            b.kin.push({ key, ...rec });
            notices.push({ icon: '🕯️', title: 'To Be Laid to Rest', type: 'info', text: `${rec.name} awaits burial. Lay them in a ground of yours or the churchyard (Graveyards & the Dead).` });
        };
        for (const c of player.children || []) {
            if (!c || c.isAlive !== false || c.id == null) continue;
            note(`c:${c.id}`, { name: [c.firstName || c.name || 'your child', (player.house && player.house.name) || ''].join(' ').trim(), born: c.birthDay != null ? c.birthDay : null, died: _num(c.deathDay, day), cause: c.deathCause || null, rel: 'child' });
        }
        // A spouse who has died (Relationships clears player.spouse)
        if (b.lastSpouse != null && b.lastSpouse !== player.spouse) {
            const npc = (player._relationshipNpcs || []).find(n => n && n.id === b.lastSpouse);
            if (npc && npc.isAlive === false) note(`s:${npc.id}`, { name: `${npc.firstName || npc.name || 'your spouse'} ${npc.dynasty || ''}`.trim(), born: null, died: _num(npc.deathDay, day), cause: npc.deathCause || null, rel: 'spouse' });
        }
        b.lastSpouse = player.spouse != null ? player.spouse : null;
        // The heads of the House before you
        for (const r of (player.house && player.house.reigns) || []) {
            if (!r || r.live || r.endDay == null) continue;
            note(`r:${r.generation}:${r.name}`, { name: r.name || 'your forebear', born: r.startDay != null && r.startAge != null ? r.startDay - _years(_num(r.startAge)) : null, died: _num(r.endDay, day), cause: r.cause || null, rel: 'forebear' });
        }
    },

    /** What laying one of your dead to rest costs: { ok, coffin, marker, fee, total, reason } */
    kinQuote(player, world, s, groundId, markerId) {
        const C = GraveBook.config();
        const ground = groundId === 'town' ? GraveBook.townGround(s) : Graveyards.ground(s, groundId);
        if (!ground) return { ok: false, reason: 'No such ground.' };
        if (ground.owner === 'player' && !Graveyards.isOpen(ground, _day(world))) return { ok: false, reason: 'The ground is not yet blessed.' };
        const inCrypt = markerId === 'crypt';
        if (inCrypt && (!ground.crypt || ground.crypt.graves.length >= _num(ground.crypt.holds, 8))) return { ok: false, reason: ground.crypt ? 'The crypt is full.' : 'Raise a family crypt first.' };
        if (!inCrypt && !GraveBook.freePlots(ground).length) return { ok: false, reason: 'No free plot.' };
        const d = inCrypt ? { inputs: {} } : GraveBook.markerDef(markerId);
        if (!d || (!inCrypt && !(C.kinMarkers || []).includes(markerId))) return { ok: false, reason: 'No such marker.' };
        const goods = { planks: 3 * _num(C.coffinPlanks, 1) };
        for (const [id, n] of Object.entries(d.inputs || {})) goods[id] = _num(goods[id]) + n;
        const q = _quoteGoods(s, goods);
        if (!q.ok) return { ok: false, reason: `${s.name}'s market hasn't the ${q.short} for a coffin and marker.` };
        const mason = Math.round(_num(d.mason));
        const fee = ground.owner === 'town' ? GraveBook.leasePrice(s, ground, 'perpetual', _day(world), _residents(s)) : 0;
        return { ok: true, goods, goodsCost: q.cost, mason, fee, total: q.cost + mason + fee, ground };
    },

    /** Lay one of your dead to rest. */
    buryKin(player, world, s, key, groundId, markerId) {
        const b = _book(player);
        const k = b.kin.find(x => x.key === key);
        if (!k) return { success: false, reason: 'No one of yours awaits burial.' };
        const q = Graveyards.kinQuote(player, world, s, groundId, markerId);
        if (!q.ok) return { success: false, reason: q.reason };
        if (_num(player.gold) < q.total) return { success: false, reason: `It comes to ${q.total}g; you have ${Math.floor(_num(player.gold))}g.` };
        Graveyards.ensure(world, s);
        _buyGoods(s, q.goods);
        player.gold -= q.total;
        _toPurse(s, q.total - q.goodsCost);
        Ledger.record(player, 'funerals', -q.total);
        const day = _day(world);
        const grave = {
            id: `k${key}`, pid: null, name: k.name, born: k.born, died: _num(k.died, day), cause: k.cause || null,
            cls: 'rich', marker: markerId === 'crypt' ? 'crypt' : markerId, term: 'perpetual', until: null, ground: q.ground.id,
            goods: 1, by: 'kin', paid: 0, lapsed: null, kin: true, rel: k.rel, coffin: 'coffin', interred: day,
        };
        if (markerId === 'crypt') q.ground.crypt.graves.push(grave);
        else {
            const plot = GraveBook.freePlots(q.ground)[0];
            grave.plot = plot;
            q.ground.plots[plot] = grave;
            delete q.ground.open[plot];
        }
        b.kin = b.kin.filter(x => x.key !== key);
        const where = q.ground.owner === 'town' ? `the churchyard of ${s.name}` : markerId === 'crypt' ? `your family crypt in ${s.name}` : `your ground in ${s.name}`;
        return { success: true, text: `${k.name} is laid to rest in ${where} (${q.total}g: the coffin and ${markerId === 'crypt' ? 'the crypt\'s rites' : (GraveBook.markerDef(markerId) || {}).name || 'marker'}${q.fee ? `, ${q.fee}g to the parish` : ''}).` };
    },

    /** Let one of your dead go unburied by you (the parish sees to them). */
    dismissKin(player, key) {
        const b = _book(player);
        b.kin = b.kin.filter(x => x.key !== key);
        return { success: true, text: 'The parish sees to them.' };
    },

    // ──────────── THE SEXTON'S WORK ────────────

    /** Graves waiting to be dug in town. */
    digWork(world, s) {
        if (!s) return 0;
        Graveyards._easeGluts(s, _day(world));
        return Math.floor(_num(GraveBook.of(s).digWork));
    },

    /** A day digging graves for the sexton: paid per grave from the town's purse. → { success, dug, pay, text } */
    workAsGravedigger(player, world, s) {
        const day = _day(world);
        const b = _book(player);
        if (b.digDay === day) return { success: false, reason: 'You have dug your fill for today.' };
        const G = GraveBook.config().gravedigger;
        const work = Graveyards.digWork(world, s);
        if (work <= 0) return { success: false, reason: `No graves want digging in ${s.name} today.` };
        const per = Math.round(_num(GraveBook.byType(G.payPerGrave, s.type), 4));
        let dug = Math.min(work, Math.max(1, _num(G.maxPerDay, 4)));
        dug = Math.min(dug, Math.floor(_purseGold(s) / Math.max(1, per)));
        if (dug <= 0) return { success: false, reason: `The sexton has nothing to pay you with: ${s.name}'s purse is empty.` };
        const pay = dug * per;
        _toPurse(s, -pay);
        player.gold = _num(player.gold) + pay;
        Ledger.record(player, 'jobs', pay);
        const g = GraveBook.of(s);
        g.digWork = Math.max(0, _num(g.digWork) - dug);
        b.digDay = day;
        b.book.dug = _num(b.book.dug) + dug;
        player.jobsCompleted = _num(player.jobsCompleted) + 1;
        if (typeof player.modifyNeed === 'function') player.modifyNeed('energy', _num(G.energy, -14));
        return { success: true, dug, pay, text: `A day with the spade for the sexton of ${s.name}: ${dug} grave${dug === 1 ? '' : 's'} dug, ${pay}g.` };
    },

    // ──────────── GRAVE ROBBING ────────────

    /** May the player simply dig here (their own ground, the lease run out)? */
    mayExhume(world, s, groundId, plot) {
        const ground = Graveyards.ground(s, groundId);
        const gr = ground && ground.plots[plot];
        return !!(ground && gr && ground.owner === 'player' && !gr.kin && GraveBook.isExpired(gr, _day(world)));
    },

    /**
     * Rob a grave: its goods (or its bones, where none were buried) taken
     * as a theft (Containers.stealGoods: the odds, the fine, the record, hot
     * goods), the grave left open. Caught, the town thinks worse of you still.
     * scene: { witnesses, guards, hour }
     */
    robGrave(player, world, s, groundId, plot, scene = {}) {
        const ground = Graveyards.ground(s, groundId);
        const gr = ground && ground.plots[plot];
        if (!gr) return { success: false, reason: 'No one lies there.' };
        if (Graveyards.mayExhume(world, s, groundId, plot)) return Graveyards.clearPlot(player, world, s, groundId, plot, 'self');
        if (gr.kin) return { success: false, reason: 'Not your own blood.' };
        const goodId = _num(gr.goods) > 0 ? 'grave_goods' : 'bones';
        const n = goodId === 'grave_goods' ? _num(gr.goods) : 1;
        const ctx = { kingdom: s.kingdom != null ? s.kingdom : null, inSettlement: true, settlementName: s.name, worldQ: s.q, worldR: s.r, building: null, furnitureType: 'grave', ownerName: `the family of ${gr.name}` };
        const res = Containers.stealGoods(player, world, ctx, goodId, n, scene);
        if (res.caught) {
            const R = GraveBook.config().robbery;
            if (ctx.kingdom != null && player.reputation) player.reputation[ctx.kingdom] = _num(player.reputation[ctx.kingdom]) - _num(R.reputation, 6);
            return { success: false, caught: true, reason: `${res.text} Robbing the dead: the town will not soon forget it.` };
        }
        if (!res.ok) return { success: false, reason: res.text };
        // The bones come up with the goods (hot as well)
        if (goodId === 'grave_goods' && PlayerInventory.canAdd(player, 'bones')) {
            _invGive(player, 'bones', 1);
        }
        ground.plots[plot] = null;
        ground.open[plot] = _day(world);
        return { success: true, text: `${res.text} ${gr.name}'s grave lies open behind you.` };
    },

    // ──────────── THE PANEL ────────────

    /** The town's graveyard at a glance, for the panel. */
    townView(world, s) {
        const g = Graveyards.ensure(world, s);
        const day = _day(world);
        Graveyards._easeGluts(s, day);
        const town = GraveBook.townGround(s);
        const graves = GraveBook.gravesIn(town);
        const res = _residents(s);
        return {
            name: s.name, type: s.type, cap: town.cap, used: graves.length, free: GraveBook.freePlots(town).length,
            freeInTown: GraveBook.freeInTown(s), deathsPerYear: _r2(GraveBook.deathsPerYear(s, day, res)),
            scarcity: _r2(GraveBook.scarcity(s, day, res)), parish: GraveBook.leasePrice(s, town, 't25', day, res),
            charnel: Math.floor(_num(g.charnel)), pit: _num(g.pit), opened: _num(g.opened), full: g.fullSince != null,
            digWork: Math.floor(_num(g.digWork)), bonePrice: Graveyards.bonePrice(s), mealPrice: Graveyards.mealPrice(s),
            purse: Math.floor(_purseGold(s)), soil: s.farm ? _num(s.farm.soil, 1) : 1,
            expired: graves.filter(x => GraveBook.isExpired(x, day)).length,
        };
    },

    /** Every site of the player's (grounds, mills, ossuaries) with what can be done: for the panel. */
    sitesView(world, player) {
        const b = _book(player);
        const day = _day(world);
        const out = [];
        for (const site of b ? b.sites : []) {
            const s = _settlementAt(world, site.q, site.r);
            if (!s) continue;
            const row = { ...site, town: s.name, ready: day >= _num(site.readyDay, 0) };
            if (site.kind === 'ground') {
                const ground = Graveyards.ground(s, site.lot);
                if (!ground) continue;
                const graves = ground.plots.map((gr, i) => (gr ? { i, name: gr.name, until: gr.until, lapsed: gr.lapsed, kin: gr.kin, expired: GraveBook.isExpired(gr, day), term: gr.term, cls: gr.cls, goods: gr.goods } : null)).filter(Boolean);
                row.ground = { cap: ground.cap, used: graves.length, free: GraveBook.freePlots(ground).length, policy: ground.policy, open: Graveyards.isOpen(ground, day), crypt: ground.crypt ? { used: ground.crypt.graves.length, holds: ground.crypt.holds } : null };
                row.graves = graves;
                row.prices = GraveBook.termsDown().map(t => ({ term: t, price: GraveBook.leasePrice(s, ground, t, day, _residents(s)) }));
                row.parish = GraveBook.leasePrice(s, GraveBook.townGround(s), 't25', day, _residents(s));
            }
            out.push(row);
        }
        return out;
    },

    /** Your dead awaiting burial. */
    kinWaiting(player) {
        const b = _book(player);
        return b ? b.kin.slice() : [];
    },

    /** The grave at a ground's plot, with what the map menu needs. */
    graveAt(world, s, groundId, plot) {
        const ground = Graveyards.ground(s, groundId);
        const gr = ground && ground.plots[plot];
        if (!gr) return null;
        const day = _day(world);
        return { grave: gr, ground, mine: ground.owner === 'player', legible: GraveBook.isLegible(gr, day), expired: GraveBook.isExpired(gr, day), marker: GraveBook.markerNow(gr, day) };
    },
};
