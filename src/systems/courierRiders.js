// ============================================
// COURIER RIDERS — the post's riders, on the map
// ============================================
// The post is reckoned in aggregate (systems/couriers.js: each house's week;
// systems/mail.js: each of the player's letters rides for its computed days
// and meets its fate on the day it is due). This layer EMBODIES a part of it
// as world units ('courier_rider', saved with world.units) that ride the
// roads where the player can see and hail them:
//
//   The player's letters  each letter sent from the Letters panel gets a
//              rider (`dispatchLetter`): it leaves the town it was written in
//              on the day it was sent and rides the road (the caravans' route
//              search, systems/merchantCaravans.js) so that it reaches the
//              recipient's town exactly on the letter's arrival day — Mail
//              resolves the letter there as before. A letter held up on the
//              road waits a hex short of the gates.
//   The road   robbery and interception happen to the rider where it is: a
//              raider band or lair beast within `hostileRange` (once each,
//              its strength against the rider's guards), an active outlaw
//              lair within `lairRange` (once each, guards help), and the land
//              of a realm at war with the recipient's realm (its agents read
//              a lord's, a rival's or a child's letter: Mail uses that
//              interception in place of its own). A robbed letter's
//              enclosure goes to the robbers (a band's packs, a lair's hoard);
//              half the time the letter is lost with it (Mail.robLetter).
//              Mail no longer rolls the road's robbery for a letter that has
//              a rider.
//   Traffic    a capped sample of the houses' own mail rides too: every
//              `everyDays` days a house may send one rider between two of its
//              stations when either end is within `nearRange` of the player
//              (at most `npcMax` such riders on the map), and the player's own
//              house sends up to `ownHouseMax` of its riders anywhere — the
//              renderer shows those even in the fog. Their bags hold letters,
//              coin and sometimes a lord's sealed letter; waylaid, the house's
//              name suffers. Their economics stay in the weekly reckoning.
//   The player hails a rider within a hex (wildernessActions 'meet_courier'
//              → ActionMenu.showRider): who carries what to where; or robs
//              it (PlayerMilitary.attackUnit → onRobbed): the coin is loot, a
//              sealed letter comes to the inbox ('stolen_mailbag': burn it,
//              read it, sell it to the lord's enemy), heat with the realm
//              (Underworld crime 'mail_robbery', witnessed → Gossip bounty)
//              and the realm's displeasure.
//
// Only the game's own day (ui/game/endDay.js) calls processDay and only the
// Letters panel dispatches riders: the headless harness and bots never do,
// so their letters stay abstract and their trajectory is unchanged. The day
// draws from its own stream (world seed + day, Utils.withRng). State on
// world.post.riders (saved with the post). Content in data/couriers.json
// `riders`. No import-time effects.

import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { WorldUnit } from '../world/units.js';
import { Couriers } from './couriers.js';
import { Mail } from './mail.js';
import { MerchantCaravans } from './merchantCaravans.js';
import { CourtLetters } from './courtLetters.js';
import { Underworld } from './underworld.js';
import { Names } from '../core/names.js';

export const RIDER_TYPE = 'courier_rider';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _day = world => (world && Number.isFinite(world.day) ? world.day : 0);

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function _seed(world) {
    const p = world && world.generationParams;
    return (p && p.seed) || 0;
}

function _dist(world, a, b) {
    return Hex.wrappingDistance(a.q, a.r, b.q, b.r, (world && world.width) || 0);
}

function _fill(text, vars) {
    return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

const DEFAULTS = {
    enabled: true, icon: '🏇', ownIcon: '🐴', everyDays: 2,
    npcMax: 6, npcPerHouse: 1, npcChance: 0.5, nearRange: 16, ownHouseMax: 3, ownHouseChance: 0.6,
    hostileRange: 1, lairRange: 2, lairChance: 0.35, robShare: 0.7, warIntercept: 0.3, warSeize: 0.2,
    guardBase: 2, guardPer: 6, bagLetters: [2, 9], bagGold: [4, 30], sealedChance: 0.3, noticeRange: 6, meetRange: 1,
    robbery: { crime: 'mail_robbery', reputation: 8, houseRep: 3, sealedPrice: [40, 120], failScale: 0.5 },
};

export const CourierRiders = {

    // ──────────── DATA ────────────

    config() {
        const d = Couriers.data().riders || {};
        return { ...DEFAULTS, ...d, robbery: { ...DEFAULTS.robbery, ...(d.robbery || {}) } };
    },

    // ──────────── STATE ────────────

    _blank() {
        return { seq: 0, lastDay: null, lastSpawnDay: null, stats: { spawned: 0, letters: 0, arrived: 0, robbed: 0, intercepted: 0, seized: 0, robbedByPlayer: 0 } };
    },

    /** world.post.riders, created/backfilled on use (it is saved with the post). */
    state(world) {
        const post = Couriers.state(world);
        let st = post.riders;
        if (!st || typeof st !== 'object') st = post.riders = this._blank();
        const blank = this._blank();
        if (!(st.seq >= 0)) st.seq = 0;
        if (st.lastDay === undefined) st.lastDay = null;
        if (st.lastSpawnDay === undefined) st.lastSpawnDay = null;
        st.stats = { ...blank.stats, ...(st.stats || {}) };
        return st;
    },

    isRider(u) {
        return !!(u && u.type === RIDER_TYPE);
    },

    /** Riders on the map today. */
    riders(world) {
        return ((world && world.units) || []).filter(u => u && !u.destroyed && u.type === RIDER_TYPE);
    },

    find(world, id) {
        return this.riders(world).find(u => u.id === id) || null;
    },

    /** Is this rider still among the world's units at all (ridden, or ended today)? */
    _onMap(world, id) {
        return ((world && world.units) || []).some(u => u && u.id === id);
    },

    /** The rider carrying one of the player's letters, or null. */
    riderFor(world, letterId) {
        return this.riders(world).find(u => u.letterId === letterId) || null;
    },

    /** The messenger carrying a reply to one of the player's letters, or null. */
    riderForReply(world, replyId) {
        return this.riders(world).find(u => u.replyId === replyId) || null;
    },

    /** The player's own house's riders on the road. */
    ownRiders(world) {
        return this.riders(world).filter(u => u.own);
    },

    // ──────────── ROUTES ────────────

    /** The way between two places as a flat [q0, r0, ...] list: the roads, or a straight line. */
    _route(world, a, b) {
        let route = null;
        try { route = MerchantCaravans.route(world, { q: a.q, r: a.r }, { q: b.q, r: b.r }, false); } catch (e) { route = null; }
        if (route && route.length >= 4) return route;
        const W = (world && world.width) || 0;
        let dq = b.q - a.q;
        if (W && Math.abs(dq) > W / 2) dq -= Math.sign(dq) * W;
        const out = [];
        for (const p of Hex.lineDraw(a.q, a.r, a.q + dq, b.r)) out.push(W ? Hex.wrapQ(p.q, W) : p.q, p.r);
        return out;
    },

    _make(world, st, fields) {
        st.seq++;
        const unit = Object.assign(Object.create(WorldUnit.prototype), {
            type: RIDER_TYPE, id: `rider_${st.seq}`, path: [], step: 0, met: [],
            destroyed: false, age: 0, maxAge: 1e9, speed: 0, inventory: {},
            ...fields,
        });
        unit.sourceQ = unit.q; unit.sourceR = unit.r;
        if (!Array.isArray(world.units)) world.units = [];
        world.units.push(unit);
        st.stats.spawned++;
        return unit;
    },

    /**
     * A rider for one of the player's letters (Mail.send's letter), leaving the
     * town it was written in and due at the recipient's on its arrival day.
     * Draws no RNG. → the unit, or null (no road to ride, riders off).
     */
    dispatchLetter(world, player, L) {
        const C = this.config();
        if (!C.enabled || !world || typeof world.getTile !== 'function' || !L || L.rider || L.status !== 'transit') return null;
        L.riderTried = true;
        const a = L.from || {};
        const b = L.to || {};
        if (!Number.isFinite(a.q) || !Number.isFinite(b.q) || (a.q === b.q && a.r === b.r)) return null;
        const route = this._route(world, a, b);
        if (!route || route.length < 4) return null;
        const st = this.state(world);
        const ownRider = L.courier.id === 'own';
        const c = ownRider ? null : Couriers.get(world, L.courier.id);
        const cover = _num(L.courier.guardCover);
        const strength = Math.round(_num(C.guardBase, 2) + cover * _num(C.guardPer, 6));
        const unit = this._make(world, st, {
            name: ownRider ? (L.courier.name === 'Your own rider' ? 'Your Rider' : L.courier.name) : `${L.courier.name} Rider`,
            icon: ownRider ? C.ownIcon : (c && c.icon) || C.icon,
            q: a.q, r: a.r, targetQ: b.q, targetR: b.r, route,
            departDay: _num(L.sentDay, _day(world)), dueDay: _num(L.arriveDay, _day(world) + 1),
            letterId: L.id, courierId: ownRider ? null : L.courier.id, houseName: L.courier.name,
            own: ownRider || !!(c && c.owner === 'player'), mine: true,
            fromName: a.name || 'the road', toName: L.to.place || 'a town', toWhom: L.to.name,
            guardCover: cover, strength, population: strength + 1,
            inventory: _num(L.gold) > 0 ? { gold: Math.floor(L.gold) } : {},
            bag: { letters: 1, gold: _num(L.gold), player: true },
            kingdomId: a.kingdomId || null, destKingdomId: L.to.kingdomId || null,
        });
        L.rider = unit.id;
        st.stats.letters++;
        this._catchUp(world, unit, L);
        return unit;
    },

    /**
     * A messenger bringing a reply (Mail's st.replies entry) back from the
     * recipient's town to the town the letter was written in, due on the
     * reply's day. The robbers on its road take the purse it carries; the
     * letter itself still comes. Draws no RNG. → the unit, or null.
     */
    dispatchReply(world, player, R) {
        const C = this.config();
        if (!C.enabled || !world || typeof world.getTile !== 'function' || !R || R.rider || R.riderTried) return null;
        R.riderTried = true;
        const a = R.from || {};
        const b = R.back || {};
        if (!Number.isFinite(a.q) || !Number.isFinite(b.q) || (a.q === b.q && a.r === b.r)) return null;
        const route = this._route(world, a, b);
        if (!route || route.length < 4) return null;
        const st = this.state(world);
        const strength = Math.round(_num(C.guardBase, 2));
        const gold = Math.floor(_num(R.gold));
        const unit = this._make(world, st, {
            name: `Messenger of ${a.name || 'a correspondent'}`, icon: '📨',
            q: a.q, r: a.r, targetQ: b.q, targetR: b.r, route,
            departDay: _num(R.sentDay, _day(world)), dueDay: _num(R.due, _day(world) + 1),
            letterId: null, replyId: R.id, courierId: null, houseName: `${a.name || 'your correspondent'}'s messenger`,
            own: false, mine: true,
            fromName: a.place || a.name || 'the road', toName: b.name || 'a town', toWhom: player && player.name ? player.name : 'you',
            guardCover: 0, strength, population: strength + 1,
            inventory: gold > 0 ? { gold } : {},
            bag: { letters: 1, gold, player: true },
            kingdomId: a.kingdomId || null, destKingdomId: b.kingdomId || null,
        });
        R.rider = unit.id;
        this._catchUp(world, unit, null);
        return unit;
    },

    /**
     * A rider sent out after its day (a letter or reply from a save made
     * before the riders, or one the road lost track of) starts where it would
     * be by now; the road it has already ridden is not ridden again.
     */
    _catchUp(world, u, L) {
        const last = Array.isArray(u.route) ? u.route.length / 2 - 1 : 0;
        const day = _day(world);
        if (last < 1 || day <= _num(u.departDay)) return;
        const span = Math.max(1, _num(u.dueDay) - _num(u.departDay));
        const target = Math.max(0, Math.min(last - 1, Math.round(last * (day - _num(u.departDay)) / span)));
        u.step = target;
        u.q = u.route[target * 2];
        u.r = u.route[target * 2 + 1];
    },

    /** One of a house's riders between two of its stations (the sampled traffic). */
    _spawnHouse(world, st, c, a, b) {
        const C = this.config();
        const route = this._route(world, a, b);
        if (!route || route.length < 4) return null;
        const day = _day(world);
        const days = Couriers.travelDays(world, a, b, Couriers.hexesPerDay(c));
        const cover = Couriers.guardCover(c);
        const strength = Math.round(_num(C.guardBase, 2) + cover * _num(C.guardPer, 6));
        const [ll, lh] = C.bagLetters;
        const [gl, gh] = C.bagGold;
        const bag = { letters: Utils.randInt(ll, lh), gold: Utils.randInt(gl, gh), sealed: null };
        // Now and then a lord's sealed letter rides in the bag
        const k = a.kingdomId && world.getKingdom ? world.getKingdom(a.kingdomId) : null;
        if (k && k.lord && k.isAlive !== false && Utils.random() < C.sealedChance) {
            const foes = (k.wars || []).map(id => world.getKingdom(id)).filter(e => e && e.isAlive !== false);
            bag.sealed = { kingdomId: k.id, lordName: k.lord.name || k.ruler || 'the ruler', realm: k.name, enemyId: foes.length ? Utils.randPick(foes).id : null };
        }
        return this._make(world, st, {
            name: `${c.name} Rider`, icon: c.owner === 'player' ? '📮' : (c.icon || C.icon),
            q: a.q, r: a.r, targetQ: b.q, targetR: b.r, route,
            departDay: day, dueDay: day + days, letterId: null, courierId: c.id, houseName: c.name,
            own: c.owner === 'player', mine: false,
            fromName: a.name, toName: b.name, toWhom: null,
            guardCover: cover, strength, population: strength + 1,
            inventory: bag.gold > 0 ? { gold: bag.gold } : {}, bag,
            kingdomId: a.kingdomId || null, destKingdomId: b.kingdomId || null,
        });
    },

    // ──────────── THE DAY ────────────

    _dayRng(world) {
        return Utils.seededRandom((_hash(`${_seed(world)}:riders:${_day(world)}`) % 233279) + 1);
    },

    /**
     * One day on the post roads: each rider rides its share of the way and
     * meets what lies on it; the houses send out new riders. Run before
     * Mail.processDay so a letter's rider is at its gates on its arrival day.
     * Draws only its own seeded stream. → { notices }
     */
    processDay(world, player = null) {
        const out = { notices: [] };
        const C = this.config();
        if (!world || C.enabled === false || typeof world.getTile !== 'function') return out;
        if (!Array.isArray(world.units)) world.units = [];
        const st = this.state(world);
        const day = _day(world);
        if (st.lastDay === day) return out;
        st.lastDay = day;
        Utils.withRng(this._dayRng(world), () => {
            // The player's letters written today on other paths ride too
            // — and those still on the road with no rider (sent before a save that had none, or lost track of)
            if (player && player.mail) {
                const ms = Mail.state(player);
                for (const L of ms.outbox) {
                    if (L.status !== 'transit') continue;
                    if (L.rider && !this._onMap(world, L.rider)) { L.rider = null; L.riderTried = false; }
                    if (!L.rider && !L.riderTried) this.dispatchLetter(world, player, L);
                }
                // The answers ride home
                for (const R of ms.replies) {
                    if (R.robbed) continue; // its messenger was waylaid: the letter comes on with no one to rob
                    if (R.rider && !this._onMap(world, R.rider)) { R.rider = null; R.riderTried = false; }
                    if (!R.rider && !R.riderTried && R.due > day) this.dispatchReply(world, player, R);
                }
            }
            const threats = Couriers._threats(world, player);
            for (const u of this.riders(world)) this._ride(world, player, st, u, threats, out);
            if (st.lastSpawnDay == null || day - st.lastSpawnDay >= _num(C.everyDays, 2) || day < st.lastSpawnDay) {
                st.lastSpawnDay = day;
                this._spawnTraffic(world, player, st);
            }
        });
        return out;
    },

    _replyOf(player, u) {
        if (!player || u.replyId == null) return null;
        return Mail.state(player).replies.find(x => x.id === u.replyId) || null;
    },

    _letterOf(player, u) {
        if (!player || u.letterId == null) return null;
        return Mail.state(player).outbox.find(x => x.id === u.letterId) || null;
    },

    _ride(world, player, st, u, threats, out) {
        const route = Array.isArray(u.route) ? u.route : [];
        const last = route.length / 2 - 1;
        if (last < 1) { u.destroyed = true; return; }
        let L = null;
        if (u.letterId != null) {
            L = this._letterOf(player, u);
            if (!L) { u.arrived = true; u.destroyed = true; return; } // the letter met its fate: the rider is done
        } else if (u.replyId != null && !this._replyOf(player, u)) {
            u.arrived = true; u.destroyed = true; return; // the reply came home
        }
        const day = _day(world);
        const span = Math.max(1, _num(u.dueDay) - _num(u.departDay));
        let target = Math.max(0, Math.min(last, Math.round(last * (day - _num(u.departDay)) / span)));
        // Held up on the road: it waits a hex short of the gates
        if (L && L.delayed && target >= last && day < L.arriveDay) target = last - 1;
        while (_num(u.step) < target) {
            u.step = _num(u.step) + 1;
            u.q = route[u.step * 2];
            u.r = route[u.step * 2 + 1];
            if (u.step >= last) break; // safe inside the gates
            if (this._danger(world, player, st, u, L, threats, out)) return;
        }
        if (u.step >= last) {
            u.arrived = true;
            if (!L) { st.stats.arrived++; u.destroyed = true; }
        }
    },

    /** Realms at war with the rider's ends. */
    _enemies(world, u) {
        const set = new Set();
        for (const kid of [u.kingdomId, u.destKingdomId]) {
            const k = kid && world.getKingdom ? world.getKingdom(kid) : null;
            if (k && Array.isArray(k.wars)) for (const e of k.wars) set.add(e);
        }
        return set;
    },

    /** What waits on this hex. → true when the rider's trip ended here. */
    _danger(world, player, st, u, L, threats, out) {
        const C = this.config();
        const cover = _num(u.guardCover);
        if (!Array.isArray(u.met)) u.met = [];
        for (const h of threats.hostiles) {
            if (h.destroyed || u.met.includes(h.id) || _dist(world, h, u) > _num(C.hostileRange, 1)) continue;
            u.met.push(h.id);
            const hs = Math.max(1, _num(h.strength, 5));
            if (Utils.random() < hs / (hs + Math.max(1, _num(u.strength))) * _num(C.robShare, 0.7)) {
                return this._waylaid(world, player, st, u, L, { unit: h, by: h.name || 'raiders' }, out);
            }
        }
        for (const l of threats.lairs) {
            const key = `lair:${l.id}`;
            if (u.met.includes(key) || l.status !== 'active' || _dist(world, l, u) > _num(C.lairRange, 2)) continue;
            u.met.push(key);
            if (l.leader && l.leader.slain) continue;
            if (Utils.random() < _num(C.lairChance, 0.35) * (1 - cover)) {
                return this._waylaid(world, player, st, u, L, { lair: l, by: `the outlaws of ${l.name || 'the lair'}` }, out);
            }
        }
        const t = world.getTile(u.q, u.r);
        const realm = t && t.kingdom != null ? t.kingdom : null;
        if (realm == null || u.met.includes(`realm:${realm}`)) return false;
        const enemies = L ? new Set(((L.to.kingdomId && world.getKingdom && world.getKingdom(L.to.kingdomId)) || {}).wars || []) : this._enemies(world, u);
        if (!enemies.has(realm)) return false;
        u.met.push(`realm:${realm}`);
        const k = world.getKingdom ? world.getKingdom(realm) : null;
        if (!k || k.isAlive === false) return false;
        if (L) {
            // The enemy's agents read a letter to a lord, a rival House or a child at court
            if ((L.road && L.road.intercepted) || !['lord', 'rival', 'child'].includes(L.to.type)) return false;
            if (Utils.random() < _num(C.warIntercept, 0.3) * (1 - cover * 0.5)) {
                L.road = { ...(L.road || {}), intercepted: { kind: 'realm', kingdomId: k.id, name: `agents of ${Names.realm(k.name)}`, q: u.q, r: u.r, day: _day(world) } };
                st.stats.intercepted++;
            }
            return false;
        }
        if (Utils.random() < _num(C.warSeize, 0.2) * (1 - cover)) {
            return this._waylaid(world, player, st, u, null, { kingdomId: k.id, seized: true, by: `soldiers of ${Names.realm(k.name)}` }, out);
        }
        return false;
    },

    /** The rider is waylaid: the bag's coin (and a letter's enclosure) to its takers. → true when the trip ended. */
    _waylaid(world, player, st, u, L, att, out) {
        const C = this.config();
        const gold = Math.floor(_num(u.inventory && u.inventory.gold));
        const item = L && L.item ? L.item : null;
        if (att.unit) {
            const inv = att.unit.inventory || (att.unit.inventory = {});
            if (gold > 0) inv.gold = _num(inv.gold) + gold;
            if (item) inv[item.id] = _num(inv[item.id]) + _num(item.qty, 1);
        } else if (att.lair) {
            const hoard = att.lair.hoard || (att.lair.hoard = { gold: 0, goods: {} });
            if (!hoard.goods) hoard.goods = {};
            hoard.gold = Math.round(_num(hoard.gold) + gold);
            if (item) hoard.goods[item.id] = _num(hoard.goods[item.id]) + _num(item.qty, 1);
        } else if (att.kingdomId && world.getKingdom) {
            const k = world.getKingdom(att.kingdomId);
            if (k) k.treasury = _num(k.treasury) + gold;
        }
        u.inventory = {};
        if (u.bag) u.bag.gold = 0;
        if (att.seized) st.stats.seized++;
        else st.stats.robbed++;
        const where = this._nearTown(world, u);
        if (L) {
            const ended = Mail.robLetter(world, player, L, out, { by: att.by, where, q: u.q, r: u.r });
            if (ended) u.destroyed = true;
            return ended;
        }
        if (u.replyId != null) {
            // A reply's messenger: the purse is taken, the letter still comes
            const R = this._replyOf(player, u);
            if (R) {
                R.robbed = { by: att.by, where, gold: Math.max(0, Math.floor(_num(R.gold))) };
                R.gold = 0;
                out.notices.push({ icon: '🗡️', title: 'A Messenger Waylaid', text: `The messenger bringing ${R.from.name}'s reply was ${att.seized ? 'seized' : 'robbed'} by ${att.by} near ${where}.${R.robbed.gold ? ` The ${R.robbed.gold} gold they carried is gone.` : ''} The letter will still find you.`, type: 'warning' });
            }
            u.destroyed = true;
            return true;
        }
        Couriers.recordLoss(world, u.courierId, 1);
        Couriers.riderLost(world, u.courierId, gold, !!att.seized);
        Couriers._news(world, `A rider of ${u.houseName} was ${att.seized ? 'seized' : 'robbed'} by ${att.by} near ${where} on the road to ${u.toName}.`, '🗡️');
        const near = player && Number.isFinite(player.q) && _dist(world, player, u) <= _num(C.noticeRange, 6);
        if (u.own) out.notices.push({ icon: '🗡️', title: 'Your Rider Waylaid', text: `A rider of ${u.houseName} bound for ${u.toName} was ${att.seized ? 'seized' : 'robbed'} by ${att.by} near ${where}. The bag is gone; the house's name suffers.`, type: 'warning' });
        else if (near) out.notices.push({ icon: '🗡️', title: 'A Courier Waylaid', text: `${att.by} fell on a rider of ${u.houseName} near ${where}.`, type: 'info' });
        u.destroyed = true;
        return true;
    },

    _nearTown(world, u) {
        let best = null;
        let bd = Infinity;
        for (const t of Couriers.towns(world).values()) {
            const d = _dist(world, t, u);
            if (d < bd) { bd = d; best = t; }
        }
        return best ? best.name : 'the road';
    },

    /** The houses send out riders: a capped sample near the player, and the player's own house's. */
    _spawnTraffic(world, player, st) {
        const C = this.config();
        const out = this.riders(world).filter(u => u.letterId == null);
        let npcCount = out.filter(u => !u.own).length;
        for (const c of Couriers.alive(world)) {
            if (!c || c.stations.length < 2 || _num(c.riders) <= 0) continue;
            const mine = c.owner === 'player';
            const have = out.filter(u => u.courierId === c.id).length;
            if (mine) {
                if (have >= _num(C.ownHouseMax, 3)) continue;
            } else if (!player || !Number.isFinite(player.q) || npcCount >= _num(C.npcMax, 6) || have >= _num(C.npcPerHouse, 1)) continue;
            const pairs = [];
            for (const a of c.stations) {
                if (Couriers.barred(world, c, a.kingdomId)) continue;
                for (const b of c.stations) {
                    if (a.key === b.key) continue;
                    if (!mine && Math.min(_dist(world, player, a), _dist(world, player, b)) > _num(C.nearRange, 16)) continue;
                    pairs.push([a, b]);
                }
            }
            if (!pairs.length) continue;
            if (Utils.random() >= (mine ? _num(C.ownHouseChance, 0.6) : _num(C.npcChance, 0.5))) continue;
            const [a, b] = Utils.randPick(pairs);
            const u = this._spawnHouse(world, st, c, a, b);
            if (u && !mine) npcCount++;
        }
    },

    // ──────────── THE PLAYER ON THE ROAD ────────────

    /** Riders the player can hail (same or next hex). */
    meetable(player, world) {
        if (!player || !Number.isFinite(player.q)) return [];
        const range = _num(this.config().meetRange, 1);
        return this.riders(world).filter(u => _dist(world, player, u) <= range);
    },

    progress(u) {
        const last = Array.isArray(u && u.route) ? u.route.length / 2 - 1 : 0;
        return last > 0 ? Math.max(0, Math.min(1, _num(u.step) / last)) : 0;
    },

    /** What the panel says about a rider. */
    describe(world, player, u) {
        if (!u) return null;
        const L = this._letterOf(player, u);
        const K = L ? Mail.kind(L.kind) || {} : null;
        const R = this._replyOf(player, u);
        return {
            yourReply: R ? { from: R.from.name, gold: Math.floor(_num(R.gold)) } : null,
            id: u.id, name: u.name, icon: u.icon, house: u.houseName, own: !!u.own, from: u.fromName, to: u.toName,
            progress: Math.round(this.progress(u) * 100), daysLeft: Math.max(0, _num(u.dueDay) - _day(world)),
            guards: _num(u.strength), coin: Math.floor(_num(u.inventory && u.inventory.gold)),
            letters: u.bag ? _num(u.bag.letters, 1) : 1, sealed: !!(u.bag && u.bag.sealed),
            yourLetter: L ? { kind: K.name || L.kind, icon: K.icon || '✉️', to: L.to.name, gold: L.gold, item: L.item, delayed: !!L.delayed } : null,
        };
    },

    /** The player robbed a rider (PlayerMilitary.attackUnit's victory over one). */
    onRobbed(player, world, u) {
        if (!player || !u) return null;
        const C = this.config();
        const R = C.robbery;
        const st = this.state(world);
        const day = _day(world);
        st.stats.robbedByPlayer++;
        const kid = u.kingdomId || u.destKingdomId || Underworld._nearestKingdom(world, u.q, u.r);
        const yours = !!u.own || u.letterId != null || u.replyId != null;
        const res = { kingdomId: kid, caught: false, letters: u.bag ? _num(u.bag.letters, 1) : 1, sealed: false };
        // Your own letter: it goes no further (what it enclosed comes back to you)
        const L = this._letterOf(player, u);
        if (L) {
            if (L.item && player.inventory) player.inventory[L.item.id] = _num(player.inventory[L.item.id]) + _num(L.item.qty, 1);
            L.resolvedDay = day;
            Mail._done(player, L, 'robbed', `You stopped your own rider on the road: the letter to ${L.to.name} goes no further.`);
        }
        // The messenger bringing your own reply: you took its purse yourself
        const Rp = this._replyOf(player, u);
        if (Rp) { Rp.robbed = { by: 'you', where: this._nearTown(world, u), gold: Math.max(0, Math.floor(_num(Rp.gold))) }; Rp.gold = 0; }
        // A house's rider: the bag's coin is the house's to make good
        if (u.courierId) Couriers.riderLost(world, u.courierId, Math.floor(_num(u.inventory && u.inventory.gold)), false);
        if (!yours) {
            res.caught = MerchantCaravans._witnessed(world, u);
            Underworld.recordCrime(player, world, R.crime, { kingdom: kid, caught: res.caught, q: u.q, r: u.r, victim: { name: u.houseName || 'the post', type: 'merchant', icon: u.icon || '🏇' } });
            if (kid != null) {
                if (!player.reputation || typeof player.reputation !== 'object') player.reputation = {};
                player.reputation[kid] = _num(player.reputation[kid]) - _num(R.reputation, 8);
            }
        }
        if (u.courierId) Couriers.recordLoss(world, u.courierId, yours ? 1 : _num(R.houseRep, 3));
        const sealed = u.bag && u.bag.sealed;
        if (sealed && !yours) {
            res.sealed = true;
            const K = CourtLetters.kind('stolen_mailbag') || {};
            const [pl, ph] = R.sealedPrice;
            const price = pl + (_hash(`${_seed(world)}:${u.id}`) % Math.max(1, ph - pl + 1));
            const enemy = sealed.enemyId && world.getKingdom ? world.getKingdom(sealed.enemyId) : null;
            const vars = { courier: u.houseName, lordName: sealed.lordName, realm: sealed.realm, dest: u.toName, enemy: enemy ? enemy.name : '', price, letters: res.letters };
            CourtLetters.deliver(player, {
                id: 0, kind: 'stolen_mailbag', day, expires: day + _num(K.expiry, 6),
                from: { type: 'courier', name: u.houseName, kingdomId: sealed.kingdomId }, key: `stolen:${u.id}`,
                vars, data: { courierId: u.courierId, kingdomId: sealed.kingdomId, enemyId: enemy ? enemy.id : null, price, stolen: true },
                subject: _fill(K.subject, vars), body: _fill(K.body, vars), read: false,
            });
        }
        Couriers._news(world, `A rider of ${u.houseName} was robbed on the road near ${this._nearTown(world, u)}${yours ? '' : ' by a highwayman'}.`, '🗡️');
        u.inventory = {};
        u.bag = { letters: 0, gold: 0 };
        return res;
    },

    /** A robbery that failed: the rider's guards saw a face. */
    onRobberyFailed(player, world, u) {
        if (!player || !u || u.own || u.letterId != null || u.replyId != null) return null;
        const R = this.config().robbery;
        const kid = u.kingdomId || Underworld._nearestKingdom(world, u.q, u.r);
        Underworld.recordCrime(player, world, R.crime, { kingdom: kid, scale: _num(R.failScale, 0.5) });
        if (kid != null) {
            if (!player.reputation || typeof player.reputation !== 'object') player.reputation = {};
            player.reputation[kid] = _num(player.reputation[kid]) - Math.round(_num(R.reputation, 8) / 2);
        }
        return { kingdomId: kid };
    },
};
