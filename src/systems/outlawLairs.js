// ============================================
// OUTLAW LAIRS — persistent strongholds of directed opposition
// ============================================
// Random raider bands come and go (World.spawnUnits). A LAIR stays: a bandit
// camp on a forest road, a smugglers' den in the marsh, a deserters' fort in
// a realm at war, a cultist grotto, a beast den deep in the woods. Lairs form
// in poorly policed country — low kingdom stability, wilderness, a few days
// from the nearest town, near a road — and grow while nobody deals with them.
//
// What a lair does (every effect has a reader):
//   • Raiding parties — real world units ('raider' / 'beast', tagged lairId)
//     ride out at a target town. On the way they rob caravans (units.js) and
//     hunt the player like any raider; next to a player holding they raid it
//     (Holdings._raid); at an NPC town they burn buildings (settlement.damage
//     → production), kill people (population), take the stores (economy.food)
//     and coin from the realm's treasury; cultists sap the realm's faith
//     unity. Parties come home and bank their plunder in the lair's hoard.
//   • The realm suffers — a known lair is a regional timed event ("Outlaws
//     of …", world.activeEvents) scaled by notoriety: stability (KingdomStability
//     target) and land trade income (caravans) fall in that kingdom.
//   • It grows — strength by the day (faster where the realm is restless or
//     at war, slower under a lawful lord), notoriety with every raid.
//
// Counterplay:
//   • Realms (lawful lords more often) send expeditions — 'lair_expedition'
//     world units marching from the nearest town; they win or are beaten.
//   • The player finds lairs on the road, in tavern talk, from bounty notices
//     and heralds; scouts them; assaults them in three stages through
//     PlayerMilitary.combat; strikes at the leader alone; takes the bounty on
//     the leader's head (BountyHunting, type 'lair_leader'); pays tribute for
//     protection (its parties spare the player); or — a known rogue or guild
//     man — becomes the lair's partner (a weekly cut, underworld heat and
//     guild standing). Clearing a lair pays its hoard, renown, Prestige
//     (House) and standing with the local realm.
//
// Formation is deterministic and draws no RNG: candidate places are scored
// from the map and picked by a hash of the world seed and the day (world
// generation is untouched; nothing happens before the first daily tick).
// The daily tick (raids, expeditions) draws from its own Utils stream, seeded
// by the world seed and the day (Utils.withRng + seededRandom), so lairs never
// reshuffle another system's dice; the player's deeds (scout, storm, strike)
// draw from the main stream like any action. State on player.outlawLairs
// (saved with the player); party and expedition units are saved with the world.
// Content in data/outlawLairs.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { PlayerInventory } from '../core/inventory.js';
import { WorldUnit } from '../world/units.js';
import { LordInfluence } from '../world/kingdomState.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { House } from './house.js';
import { Traits } from './traits.js';
import { Underworld } from './underworld.js';

const WATER = new Set(['ocean', 'deep_ocean', 'coast', 'lake', 'sea']);
const TYPE_WEIGHT = { village: 3, hamlet: 3, town: 2, city: 1, capital: 0.4 };
const ROADS = ['dirt_road', 'stone_road', 'bridge'];

function _num(v, d = 0) {
    return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

function _day(world) {
    return (world && Number.isFinite(world.day)) ? world.day : 0;
}

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function _range(v, h) {
    if (!Array.isArray(v)) return _num(v);
    const lo = _num(v[0]);
    const hi = _num(v[1], lo);
    return lo + (h % (Math.max(0, hi - lo) + 1));
}

function _roll(v) {
    if (!Array.isArray(v)) return _num(v);
    return Utils.randInt(_num(v[0]), _num(v[1], v[0]));
}

function _dist(world, q1, r1, q2, r2) {
    return Hex.wrappingDistance(q1, r1, q2, r2, (world && world.width) || 0);
}

function _kingdom(world, id) {
    if (!world || id == null) return null;
    if (world.getKingdom) return world.getKingdom(id) || null;
    return (world.kingdoms || []).find(k => k.id === id) || null;
}

function _settlements(world) {
    if (!world) return [];
    if (typeof world.getSettlementViews === 'function') return world.getSettlementViews();
    return typeof world.getAllSettlements === 'function' ? world.getAllSettlements() : [];
}

function _liveSettlement(world, q, r) {
    const tile = world && world.getTile ? world.getTile(q, r) : null;
    return tile && tile.settlement ? tile.settlement : null;
}

function _isPlayerHolding(s) {
    return !!(s && s.holding && typeof s.holding === 'object' && !s.holding.lost);
}

function _seed(world) {
    const p = world && world.generationParams;
    return (p && p.seed) || 0;
}

export const OutlawLairs = {

    // ──────────── DATA ────────────

    data() {
        return DataLoader.outlawLairs || (DataLoader.get && DataLoader.get('outlawLairs')) || {};
    },

    config() {
        return OutlawLairs.data().config || {};
    },

    kinds() {
        return OutlawLairs.data().kinds || {};
    },

    kind(id) {
        return OutlawLairs.kinds()[id] || null;
    },

    leaderTrait(lair) {
        const traits = (OutlawLairs.data().leaders || {}).traits || {};
        return (lair && lair.leader && traits[lair.leader.trait]) || {};
    },

    // ──────────── STATE ────────────

    _blank() {
        return {
            initialized: false,
            lairs: [],
            expeditions: [],
            history: [],
            nextId: 1,
            lastDay: null,
            lastFormDay: null,
            stats: {
                formed: 0, raids: 0, cleared: 0, clearedByPlayer: 0, clearedByRealms: 0, expeditions: 0,
                leadersSlain: 0, scouted: 0, tributes: 0, tributeGold: 0, alliances: 0, allyGold: 0, partiesBroken: 0,
            },
        };
    },

    /** Get (creating / backfilling) the outlaw record. */
    state(player) {
        if (!player) return OutlawLairs._blank();
        let st = player.outlawLairs;
        if (!st || typeof st !== 'object' || Array.isArray(st)) {
            player.outlawLairs = OutlawLairs._blank();
            return player.outlawLairs;
        }
        const blank = OutlawLairs._blank();
        if (typeof st.initialized !== 'boolean') st.initialized = false;
        if (!Array.isArray(st.lairs)) st.lairs = [];
        if (!Array.isArray(st.expeditions)) st.expeditions = [];
        if (!Array.isArray(st.history)) st.history = [];
        if (!(st.nextId > 0)) st.nextId = st.lairs.length + 1;
        if (st.lastDay === undefined) st.lastDay = null;
        if (st.lastFormDay === undefined) st.lastFormDay = null;
        st.stats = { ...blank.stats, ...(st.stats && typeof st.stats === 'object' ? st.stats : {}) };
        for (const l of st.lairs) {
            if (!Array.isArray(l.parties)) l.parties = [];
            if (!l.hoard || typeof l.hoard !== 'object') l.hoard = { gold: 0, goods: {} };
            if (!l.hoard.goods || typeof l.hoard.goods !== 'object') l.hoard.goods = {};
            if (!Array.isArray(l.log)) l.log = [];
        }
        return st;
    },

    serialize(player) {
        return player && player.outlawLairs ? JSON.parse(JSON.stringify(player.outlawLairs)) : null;
    },

    /** After a load: older saves get a blank record (lairs form on the next tick). */
    loadState(player) {
        return OutlawLairs.state(player);
    },

    /** Every lair still standing. */
    active(player) {
        const st = player && player.outlawLairs;
        return st && Array.isArray(st.lairs) ? st.lairs.filter(l => l && l.status === 'active') : [];
    },

    find(player, id) {
        const st = player && player.outlawLairs;
        return (st && Array.isArray(st.lairs) ? st.lairs.find(l => l && l.id === id) : null) || null;
    },

    /** Lairs the player knows of (found, rumoured or notorious), standing ones first. */
    known(player) {
        const st = player && player.outlawLairs;
        if (!st || !Array.isArray(st.lairs)) return [];
        return st.lairs.filter(l => l && (l.known || l.rumoured)).sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1));
    },

    /** A known, standing lair on (q, r) or next to it, or null. */
    lairNear(player, world, q, r, radius = 1) {
        let best = null;
        for (const l of OutlawLairs.active(player)) {
            if (!l.known) continue;
            const d = _dist(world, q, r, l.q, l.r);
            if (d <= radius && (!best || d < best.d)) best = { lair: l, d };
        }
        return best ? best.lair : null;
    },

    /** Men at home: the lair's strength less its parties in the field. */
    garrison(lair) {
        if (!lair) return 0;
        const out = (lair.parties || []).reduce((s, p) => s + _num(p.strength), 0);
        return Math.max(0, Math.round(_num(lair.strength) - out));
    },

    notorietyLabel(n) {
        const c = OutlawLairs.config().notoriety || {};
        if (n >= _num(c.infamousAt, 80)) return 'Infamous';
        if (n >= _num(c.feared, 50)) return 'Feared';
        if (n >= _num(c.rumourAt, 25)) return 'Known';
        return 'Whispered';
    },

    strengthLabel(s) {
        if (s >= 120) return 'a small army';
        if (s >= 70) return 'a strong band';
        if (s >= 35) return 'a sizeable band';
        return 'a handful of desperate men';
    },

    _log(lair, world, text) {
        lair.log.push({ day: _day(world), text });
        if (lair.log.length > 12) lair.log.splice(0, lair.log.length - 12);
    },

    _record(st, entry) {
        st.history.push(entry);
        const cap = _num(OutlawLairs.config().historyCap, 30);
        if (st.history.length > cap) st.history.splice(0, st.history.length - cap);
    },

    // ──────────── FORMATION ────────────

    _nearRoad(world, q, r, radius) {
        for (const h of Hex.hexesInRange(q, r, radius)) {
            const t = world.getTile(h.q, h.r);
            if (!t) continue;
            if (t.hasRoad) return true;
            if (t.infrastructure && ROADS.includes(t.infrastructure.id) && !t.infrastructure.underConstruction) return true;
        }
        return false;
    },

    _nearWater(world, q, r) {
        return Hex.neighbors(q, r).some(n => {
            const t = world.getTile(n.q, n.r);
            return t && t.terrain && WATER.has(t.terrain.id);
        });
    },

    _atWar(kingdom) {
        return !!(kingdom && Array.isArray(kingdom.wars) && kingdom.wars.length);
    },

    /** The lair kind a place suits, or null (first fit in kindOrder). */
    kindFor(world, tile, q, r, kingdom, h) {
        const data = OutlawLairs.data();
        const order = Array.isArray(data.kindOrder) ? data.kindOrder : Object.keys(OutlawLairs.kinds());
        const terrain = tile && tile.terrain && tile.terrain.id;
        const road = OutlawLairs._nearRoad(world, q, r, _num(OutlawLairs.config().roadRadius, 2));
        for (const id of order) {
            const k = OutlawLairs.kind(id);
            if (!k || !Array.isArray(k.terrains) || !k.terrains.includes(terrain)) continue;
            if (k.needsWater && !OutlawLairs._nearWater(world, q, r)) continue;
            if (k.needsRoad && !road) continue;
            if (k.beasts && road) continue;
            if (k.warBonus && !OutlawLairs._atWar(kingdom)) continue;
            if (id === 'cultist_grotto' && h % 3 !== 0) continue;
            return { kind: id, road };
        }
        return null;
    },

    _lawful(kingdom) {
        if (!kingdom) return 0;
        try {
            return Utils.clamp(_num(LordInfluence.mod(kingdom, 'lawful')), 0, 0.9);
        } catch (e) {
            return 0;
        }
    },

    /** Scored places where a lair could take root: [{ q, r, kind, kingdomId, wild, score }], best first. */
    candidates(world, st) {
        const cfg = OutlawLairs.config();
        const minD = _num(cfg.minTownDist, 3);
        const maxD = _num(cfg.maxTownDist, 8);
        const spacing = _num(cfg.lairSpacing, 9);
        const seed = _seed(world);
        const standing = (st.lairs || []).filter(l => l.status === 'active');
        const perKingdom = {};
        for (const l of standing) if (l.kingdomId != null) perKingdom[l.kingdomId] = (perKingdom[l.kingdomId] || 0) + 1;
        const seen = new Set();
        const out = [];
        for (const s of _settlements(world)) {
            if (!s || !Number.isFinite(s.q)) continue;
            const sk = _kingdom(world, s.kingdom);
            const stile = world.getTile(s.q, s.r);
            const region = stile ? stile.regionId : undefined;
            if ((perKingdom[s.kingdom] || 0) >= _num(cfg.maxPerKingdom, 2)) continue;
            for (const h of Hex.hexesInRange(s.q, s.r, maxD)) {
                const q = Hex.wrapQ(h.q, world.width);
                const r = h.r;
                const key = `${q},${r}`;
                if (seen.has(key)) continue;
                seen.add(key);
                const tile = world.getTile(q, r);
                if (!tile || !tile.terrain || !tile.terrain.passable) continue;
                if (tile.settlement || tile.improvement || tile.playerProperty || tile.structure || tile.holySite || tile.religiousBuilding) continue;
                if (_dist(world, q, r, s.q, s.r) < minD) continue;
                // On the same land as the town (its riders must be able to reach it)
                if (region !== undefined && tile.regionId !== undefined && tile.regionId !== region) continue;
                let crowded = false;
                for (const n of Hex.hexesInRange(q, r, minD - 1)) {
                    const t = world.getTile(n.q, n.r);
                    if (t && t.settlement) { crowded = true; break; }
                }
                if (crowded) continue;
                if (standing.some(l => _dist(world, q, r, l.q, l.r) < spacing)) continue;
                const owner = tile.kingdom ? _kingdom(world, tile.kingdom) : null;
                const kingdom = owner || sk;
                const hv = _hash(`${seed}:${key}`);
                const fit = OutlawLairs.kindFor(world, tile, q, r, kingdom, hv);
                if (!fit) continue;
                const stab = owner ? _num(owner.stability, 60) : 30;
                let score = (100 - stab) / 100;
                if (!owner) score += 0.3;
                if (fit.road) score += 0.2;
                score -= OutlawLairs._lawful(kingdom) * 0.6;
                score += (hv % 100) / 500;
                out.push({ q, r, kind: fit.kind, kingdomId: kingdom ? kingdom.id : null, wild: !owner, score });
            }
        }
        out.sort((a, b) => b.score - a.score || a.q - b.q || a.r - b.r);
        return out;
    },

    _makeLeader(kindId, h, gen = 1) {
        const L = OutlawLairs.data().leaders || {};
        const k = OutlawLairs.kind(kindId) || {};
        const traits = Object.entries(L.traits || {});
        let name;
        let pool;
        if (k.beasts) {
            const beasts = L.beasts || ['the Beast'];
            name = beasts[h % beasts.length];
            pool = traits.filter(([, t]) => t.beastOnly || t.defense).map(([id]) => id);
        } else {
            const first = L.first || ['Hask'];
            const ep = L.epithets || ['the Red'];
            const titles = k.titles || ['Captain'];
            name = `${titles[(h >>> 4) % titles.length]} ${first[(h >>> 8) % first.length]} ${ep[(h >>> 12) % ep.length]}`;
            pool = traits.filter(([, t]) => !t.beastOnly).map(([id]) => id);
        }
        const trait = pool.length ? pool[(h >>> 16) % pool.length] : null;
        return { name, trait, gen, slain: false, slainBy: null, slainDay: null };
    },

    /** Raise a lair at a candidate place. Deterministic (hash-picked names, strength, hoard). */
    _create(world, st, c) {
        const k = OutlawLairs.kind(c.kind);
        const day = _day(world);
        const h = _hash(`${_seed(world)}:${c.q},${c.r}:${st.nextId}`);
        const places = OutlawLairs.data().places || ['Crowmoor'];
        const nouns = k.nouns || ['Lair'];
        let name = `${places[h % places.length]} ${nouns[(h >>> 5) % nouns.length]}`;
        if (st.lairs.some(l => l.name === name)) name = `Old ${name}`;
        const goods = {};
        for (const [id, rng] of Object.entries((k.hoard && k.hoard.goods) || {})) {
            const n = _range(rng, _hash(`${h}:${id}`));
            if (n > 0) goods[id] = n;
        }
        const lair = {
            id: st.nextId++,
            kind: c.kind,
            name,
            q: c.q, r: c.r,
            kingdomId: c.kingdomId,
            wild: !!c.wild,
            founded: day,
            strength: _range(k.strength || [20, 30], h >>> 3),
            notoriety: 5,
            hoard: { gold: _range((k.hoard && k.hoard.gold) || [30, 60], h >>> 7), goods },
            leader: OutlawLairs._makeLeader(c.kind, h, 1),
            leaderlessUntil: null,
            parties: [],
            status: 'active',
            known: false, rumoured: false,
            hintQ: c.q + ((h >>> 9) % 5) - 2, hintR: c.r + ((h >>> 11) % 5) - 2,
            scouted: null, alertUntil: null,
            tribute: null, allied: null,
            nextRaidDay: day + 3 + (h % 6),
            lastExpeditionCheck: day,
            raids: 0,
            log: [],
        };
        st.lairs.push(lair);
        st.stats.formed++;
        return lair;
    },

    /** Form at most one new lair (several on the first tick). Draws no RNG. */
    _formation(world, st, count) {
        const cfg = OutlawLairs.config();
        const made = [];
        for (let i = 0; i < count; i++) {
            if (OutlawLairs.active({ outlawLairs: st }).length >= _num(cfg.maxLairs, 6)) break;
            const pool = OutlawLairs.candidates(world, st).slice(0, Math.max(1, _num(cfg.candidatePool, 12)));
            if (!pool.length) break;
            const pick = pool[_hash(`${_seed(world)}:form:${_day(world)}:${st.nextId}`) % pool.length];
            made.push(OutlawLairs._create(world, st, pick));
        }
        return made;
    },

    // ──────────── THE DAILY TICK ────────────

    /**
     * One day: form, grow, ride out and come home, raid, burden the realm,
     * march expeditions, tick tribute and partnerships, and let the player
     * find what is near. → { notices: [{ icon, title, text, type }] }
     */
    processDay(world, player) {
        const out = { notices: [] };
        if (!world || !player || !Array.isArray(world.tiles)) return out;
        const st = OutlawLairs.state(player);
        const day = _day(world);
        if (st.lastDay === day) return out;
        st.lastDay = day;
        if (!Object.keys(OutlawLairs.kinds()).length) return out;
        if (!Array.isArray(world.units)) world.units = [];
        // The outlaws roll their own dice — a stream seeded by the world and
        // the day — so their raids never reshuffle any other system's draws
        Utils.withRng(OutlawLairs._dayRng(world), () => OutlawLairs._tick(world, player, st, out));
        return out;
    },

    /** Today's outlaw dice: a seeded stream from the world seed and the day. */
    _dayRng(world) {
        return Utils.seededRandom((_hash(`${_seed(world)}:outlaws:${_day(world)}`) % 233279) + 1);
    },

    _tick(world, player, st, out) {
        const cfg = OutlawLairs.config();
        const day = _day(world);
        if (!st.initialized) {
            st.initialized = true;
            st.lastFormDay = day;
            OutlawLairs._formation(world, st, _num(cfg.initialLairs, 2));
        } else if (day >= _num(cfg.firstFormDay, 12) && day - _num(st.lastFormDay) >= _num(cfg.formEvery, 14)) {
            st.lastFormDay = day;
            OutlawLairs._formation(world, st, 1);
        }

        const units = new Map();
        for (const u of world.units) if (u && (u.lairId != null || u.lairExpedition != null)) units.set(u.id, u);

        for (const lair of st.lairs) {
            if (lair.status !== 'active') continue;
            OutlawLairs._syncParties(world, player, st, lair, units, out);
            if (lair.status !== 'active') continue;
            OutlawLairs._grow(world, player, st, lair, out);
            if (lair.status !== 'active') continue;
            OutlawLairs._dealings(world, player, st, lair, out);
            OutlawLairs._maybeRaid(world, player, st, lair);
            OutlawLairs._infamy(world, st, lair);
            OutlawLairs._sight(world, player, lair, out);
            OutlawLairs._maybeExpedition(world, st, lair);
        }
        OutlawLairs._expeditions(world, player, st, units, out);
        OutlawLairs._realmEvents(world, st);
        return out;
    },

    _syncParties(world, player, st, lair, units, out) {
        const cfg = OutlawLairs.config().raids || {};
        const day = _day(world);
        const spare = OutlawLairs.sparesPlayer(lair, day);
        for (let i = lair.parties.length - 1; i >= 0; i--) {
            const p = lair.parties[i];
            const unit = units.get(p.unitId);
            if (!unit || unit.destroyed) {
                // Broken in the field: by the player, a patrol, a holding's walls
                const byPlayer = !!(unit && unit.slainByPlayer);
                lair.strength = Math.max(0, _num(lair.strength) - _num(p.strength) * (byPlayer ? 1 : 0.6));
                lair.parties.splice(i, 1);
                if (byPlayer) {
                    st.stats.partiesBroken++;
                    lair.notoriety = Math.max(0, _num(lair.notoriety) - 3);
                    OutlawLairs._log(lair, world, `A party was cut down by ${player.name || 'a stranger'}.`);
                    if (lair.known) out.notices.push({ icon: '⚔️', title: 'Raiders Broken', text: `The riders of ${lair.name} will not come home. ${lair.leader.name} is weaker for it.`, type: 'success' });
                }
                continue;
            }
            // Under a bargain they leave the player be; laden with plunder on the
            // way home they avoid a fight
            unit.sparesPlayer = spare || p.phase === 'home';
            unit.pursuitRange = _num(cfg.pursuitRange, 2);
            const home = _dist(world, unit.q, unit.r, lair.q, lair.r);
            if (p.phase === 'out') {
                const reached = _dist(world, unit.q, unit.r, p.targetQ, p.targetR) <= 1;
                if (reached) {
                    OutlawLairs._raidArrive(world, player, st, lair, p, unit, out);
                    p.phase = 'home';
                } else if (day - _num(p.sentDay) > _num(cfg.daysOut, 18)) {
                    p.phase = 'home';
                }
            }
            if (p.phase === 'home' && (home <= 1 || day - _num(p.sentDay) > _num(cfg.daysOut, 18) * 2)) {
                // Home with the plunder (or melted back to it by night)
                const inv = unit.inventory || {};
                lair.hoard.gold = Math.round(_num(lair.hoard.gold) + _num(inv.gold));
                for (const [id, n] of Object.entries(inv)) {
                    if (id === 'gold' || !(n > 0)) continue;
                    lair.hoard.goods[id] = (lair.hoard.goods[id] || 0) + n;
                }
                unit.inventory = {};
                unit.destroyed = true;
                lair.parties.splice(i, 1);
                continue;
            }
            const tq = p.phase === 'home' ? lair.q : p.targetQ;
            const tr = p.phase === 'home' ? lair.r : p.targetR;
            if (unit.targetQ !== tq || unit.targetR !== tr) {
                unit.targetQ = tq;
                unit.targetR = tr;
                unit.path = [];
            }
        }
    },

    /** Does this lair's word protect the player today (tribute paid, or partners)? */
    sparesPlayer(lair, day) {
        if (!lair) return false;
        if (lair.allied) return true;
        return !!(lair.tribute && _num(lair.tribute.until) >= day);
    },

    _grow(world, player, st, lair, out) {
        const cfg = OutlawLairs.config();
        const G = cfg.growth || {};
        const N = cfg.notoriety || {};
        const k = OutlawLairs.kind(lair.kind) || {};
        const day = _day(world);
        let kingdom = _kingdom(world, lair.kingdomId);
        if (!kingdom || kingdom.isAlive === false) {
            // No realm (or a fallen one) answers for this country: the nearest
            // living realm's towns suffer it, and that realm must deal with it
            if (kingdom) lair.wild = true;
            kingdom = OutlawLairs._nearestRealm(world, lair);
            lair.kingdomId = kingdom ? kingdom.id : null;
        }
        const stab = lair.wild || !kingdom ? 30 : _num(kingdom.stability, 60);
        const line = _num(cfg.stabilityLine, 70);
        let rate = _num(G.base, 0.3) * _num(k.growth, 1);
        rate *= 1 + _num(G.lowStability, 0.4) * Math.max(0, line - stab) / line;
        if (OutlawLairs._atWar(kingdom)) rate += _num(G.warBonus, 0.2) * _num(k.warBonus, 1);
        rate -= _num(G.lawfulDrag, 0.5) * OutlawLairs._lawful(kingdom) * _num(G.base, 0.3);
        rate += Math.min(0.3, _num(lair.hoard.gold) / Math.max(1, _num(G.hoardPer, 400)) * 0.1);
        if (lair.leader.slain) rate = -0.3; // infighting over who leads
        // A hoard past what the chief can hide is spent on more blades
        const cap = _num(G.hoardCap, 2000);
        if (_num(lair.hoard.gold) > cap) {
            rate += (_num(lair.hoard.gold) - cap) / Math.max(1, _num(G.goldPerMan, 100));
            lair.hoard.gold = cap;
        }
        lair.strength = Utils.clamp(_num(lair.strength) + rate, 0, _num(k.maxStrength, 160));
        lair.strength = Math.round(lair.strength * 100) / 100;

        const before = _num(lair.notoriety);
        lair.notoriety = Math.max(0, Math.round((before - _num(N.decay, 0.04)) * 100) / 100);

        // A new leader rises from the infighting — or the band scatters
        if (lair.leader.slain && lair.leaderlessUntil != null && day >= lair.leaderlessUntil) {
            if (lair.strength >= _num((cfg.raids || {}).minGarrison, 12)) {
                const gen = _num(lair.leader.gen, 1) + 1;
                lair.leader = OutlawLairs._makeLeader(lair.kind, _hash(`${_seed(world)}:${lair.id}:leader:${gen}`), gen);
                lair.leaderlessUntil = null;
                OutlawLairs._log(lair, world, `${lair.leader.name} now leads ${lair.name}.`);
                if (lair.known) out.notices.push({ icon: k.icon || '🏕️', title: 'A New Outlaw Chief', text: `${lair.leader.name} has taken ${lair.name} in hand.`, type: 'warning' });
            }
        }
        if (lair.strength < _num((cfg.raids || {}).minParty, 8) && !lair.parties.length) {
            OutlawLairs._end(world, player, st, lair, 'dispersed', null, out);
        }
    },

    /** The living realm with a town nearest the lair (within reach of its raids), or null. */
    _nearestRealm(world, lair) {
        const reach = _num((OutlawLairs.config().raids || {}).radius, 9) + 5;
        let best = null;
        for (const s of _settlements(world)) {
            if (!s || s.kingdom == null || !Number.isFinite(s.q)) continue;
            const k = _kingdom(world, s.kingdom);
            if (!k || k.isAlive === false) continue;
            const d = _dist(world, s.q, s.r, lair.q, lair.r);
            if (d <= reach && (!best || d < best.d)) best = { d, k };
        }
        return best ? best.k : null;
    },

    /** Tribute running out; the partner's weekly cut, heat and standing. */
    _dealings(world, player, st, lair, out) {
        const day = _day(world);
        if (lair.tribute && _num(lair.tribute.until) < day) {
            lair.tribute = null;
            out.notices.push({ icon: '💰', title: 'Protection Lapsed', text: `Your bargain with ${lair.leader.name} of ${lair.name} has run out.`, type: 'warning' });
        }
        const A = OutlawLairs.config().ally || {};
        if (lair.allied && day - _num(lair.allied.lastCut, day) >= _num(A.cutEvery, 7)) {
            lair.allied.lastCut = day;
            const cut = Math.min(_num(A.cutMax, 200), Math.floor(_num(lair.hoard.gold) * _num(A.cutShare, 0.15)));
            if (cut > 0) {
                lair.hoard.gold -= cut;
                player.gold = _num(player.gold) + cut;
                st.stats.allyGold += cut;
                out.notices.push({ icon: '🗝️', title: 'Your Cut', text: `A rider from ${lair.name} leaves ${cut} gold under the stone. Your share of the road.`, type: 'info' });
            }
            if (lair.kingdomId != null) Underworld.addHeat(player, lair.kingdomId, _num(A.heatPerWeek, 3), world);
            const uw = Underworld.ensure(player);
            if (uw.guild.member) Underworld._gainStanding(player, world, _num(A.standing, 2));
        }
    },

    _raidTarget(world, player, lair) {
        const cfg = OutlawLairs.config().raids || {};
        const radius = _num(cfg.radius, 9);
        const k = OutlawLairs.kind(lair.kind) || {};
        const spare = OutlawLairs.sparesPlayer(lair, _day(world));
        const home = world.getTile(lair.q, lair.r);
        const pool = [];
        for (const s of _settlements(world)) {
            if (!s || !Number.isFinite(s.q)) continue;
            const d = _dist(world, s.q, s.r, lair.q, lair.r);
            if (d > radius) continue;
            const live = _liveSettlement(world, s.q, s.r);
            if (!live) continue;
            if (home && home.regionId !== undefined) {
                const t = world.getTile(s.q, s.r);
                if (t && t.regionId !== undefined && t.regionId !== home.regionId) continue;
            }
            const mine = _isPlayerHolding(live);
            if (mine && spare) continue;
            let w = (TYPE_WEIGHT[live.type] || 1.5) / (1 + d * 0.3);
            // A town picked clean lately is hardly worth the ride
            const last = (lair.recent || []).find(x => x.q === s.q && x.r === s.r);
            if (last && _day(world) - last.day < _num(cfg.restDays, 30)) w *= 0.15;
            if (mine) w *= k.beasts ? 1 : 1.2;
            pool.push({ q: s.q, r: s.r, name: live.name || 'a town', w });
        }
        if (!pool.length) return null;
        const total = pool.reduce((a, b) => a + b.w, 0);
        let x = Utils.random() * total;
        for (const p of pool) {
            x -= p.w;
            if (x <= 0) return p;
        }
        return pool[pool.length - 1];
    },

    _maybeRaid(world, player, st, lair) {
        const cfg = OutlawLairs.config().raids || {};
        const day = _day(world);
        if (day < _num(lair.nextRaidDay) || lair.leader.slain) return;
        const k = OutlawLairs.kind(lair.kind) || {};
        const maxParties = Math.min(_num(cfg.maxParties, 3), 1 + Math.floor(_num(lair.strength) / Math.max(1, _num(cfg.partyPer, 45))));
        const garrison = OutlawLairs.garrison(lair);
        const speed = 1 - _num(cfg.notorietySpeedup, 0.4) * Math.min(100, _num(lair.notoriety)) / 100;
        lair.nextRaidDay = day + Math.max(_num(cfg.minGap, 5), Math.round(_roll(cfg.every || [7, 13]) * speed));
        if (lair.parties.length >= maxParties || garrison < _num(cfg.minGarrison, 12)) return;
        const target = OutlawLairs._raidTarget(world, player, lair);
        if (!target) return;
        const strength = Utils.clamp(Math.round(garrison * _num(cfg.partyShare, 0.35)), _num(cfg.minParty, 8), _num(cfg.maxParty, 36));
        const party = k.party || {};
        const unit = new WorldUnit(party.type || 'raider', lair.q, lair.r);
        unit.name = String(party.name || '{leader}\'s Band').replace('{leader}', lair.leader.name).replace('{lair}', lair.name);
        unit.icon = party.icon || unit.icon;
        unit.strength = strength;
        unit.population = Math.max(3, Math.round(strength * 1.5));
        unit.inventory = {};
        unit.maxAge = 1e9;
        unit.lairId = lair.id;
        unit.id = `outlaws_${lair.id}_${day}`; // unique (one party a lair a day), whatever the dice
        unit.sparesPlayer = OutlawLairs.sparesPlayer(lair, day);
        unit.pursuitRange = _num(cfg.pursuitRange, 2); // bound for a town: only waylays those on its path
        unit.targetQ = target.q;
        unit.targetR = target.r;
        world.units.push(unit);
        lair.parties.push({ unitId: unit.id, strength, targetQ: target.q, targetR: target.r, targetName: target.name, phase: 'out', sentDay: day });
        lair.recent = [...(lair.recent || []).filter(x => day - x.day < _num(cfg.restDays, 30)), { q: target.q, r: target.r, day }].slice(-6);
    },

    /** A party reaches its target town: fire, blood, stores and coin. */
    _raidArrive(world, player, st, lair, p, unit, out) {
        const cfg = OutlawLairs.config();
        const N = cfg.notoriety || {};
        const k = OutlawLairs.kind(lair.kind) || {};
        const R = k.raid || {};
        const trait = OutlawLairs.leaderTrait(lair);
        const s = _liveSettlement(world, p.targetQ, p.targetR);
        lair.raids++;
        st.stats.raids++;
        lair.notoriety = Math.min(100, _num(lair.notoriety) + _num(N.perRaid, 5));
        if (!s) return;
        const mine = _isPlayerHolding(s);
        // A player's holding with its own walls and watch: Holdings._raid fights
        // raider bands in reach. Beasts go round the walls for the herds.
        if (mine && unit.type === 'raider') {
            OutlawLairs._log(lair, world, `Rode on ${s.name}.`);
            return;
        }
        const harm = _num(trait.raidHarm, 1);
        s.damage = Math.min(0.9, _num(s.damage) + _num(R.damage) * harm);
        s.damage = Math.round(s.damage * 1000) / 1000;
        const lost = Math.round(_num(s.population) * _num(R.population) * harm);
        s.population = Math.max(10, Math.round(_num(s.population) - lost));
        if (s.economy && Number.isFinite(s.economy.food)) s.economy.food = Math.floor(s.economy.food * (1 - Math.min(0.9, _num(R.food) * harm)));
        const kingdom = _kingdom(world, s.kingdom);
        let coin = Math.round(_roll(R.loot || [0, 0]) * _num(trait.lootMult, 1));
        if (kingdom) {
            coin = Math.min(coin, Math.max(0, Math.floor(_num(kingdom.treasury))));
            kingdom.treasury = _num(kingdom.treasury) - coin;
            if (R.unity && kingdom.religion && typeof kingdom.religion.unity === 'number') {
                kingdom.religion.unity = Utils.clamp(kingdom.religion.unity - _num(R.unity), 0, 100);
            }
        } else coin = 0;
        if (coin > 0) unit.inventory.gold = _num(unit.inventory.gold) + coin;
        if (mine) {
            s.holding.unrest = Utils.clamp(_num(s.holding.unrest) + 4, 0, 100);
        }
        if (_num(R.damage) * harm >= 0.08) lair.notoriety = Math.min(100, lair.notoriety + _num(N.perSack, 8) - _num(N.perRaid, 5));
        const text = `${unit.name} fell on ${s.name}: ${lost} dead, stores burned${coin ? `, ${coin} gold carried off` : ''}.`;
        OutlawLairs._log(lair, world, text);
        if (Array.isArray(world.events)) world.events.push({ text, type: 'military' });
        const near = Number.isFinite(player.q) && _dist(world, player.q, player.r, s.q, s.r) <= 6;
        if (mine || near) {
            out.notices.push({ icon: k.icon || '🔥', title: mine ? 'Your Holding Raided' : 'Raiders Strike', text, type: mine ? 'error' : 'warning' });
            if (!lair.rumoured) lair.rumoured = true;
        }
    },

    /** A lair grown infamous is news the heralds cry (once per leader). */
    _infamy(world, st, lair) {
        const at = _num((OutlawLairs.config().notoriety || {}).infamousAt, 80);
        if (_num(lair.notoriety) < at || lair.infamousGen === lair.leader.gen) return;
        lair.infamousGen = lair.leader.gen;
        const kingdom = _kingdom(world, lair.kingdomId);
        OutlawLairs._record(st, {
            key: `lair:${lair.id}:risen:${lair.leader.gen}`, kind: 'risen', day: _day(world), lairId: lair.id, name: lair.name,
            leader: lair.leader.name, kingdom: kingdom ? kingdom.name : 'the borderlands', own: false,
            q: lair.q, r: lair.r, kingdomId: lair.kingdomId,
        });
    },

    /** Find lairs on the road: close by, or so notorious everyone knows the way. */
    _sight(world, player, lair, out) {
        if (lair.known) return;
        const cfg = OutlawLairs.config();
        const close = Number.isFinite(player.q) && _dist(world, player.q, player.r, lair.q, lair.r) <= _num((cfg.sight || {}).radius, 2);
        const infamous = _num(lair.notoriety) >= _num((cfg.notoriety || {}).infamousAt, 80);
        if (!close && !infamous) return;
        lair.known = true;
        lair.rumoured = true;
        const k = OutlawLairs.kind(lair.kind) || {};
        out.notices.push({
            icon: k.icon || '🏕️',
            title: close ? 'Outlaw Lair Found' : 'An Infamous Lair',
            text: close
                ? `You come upon ${lair.name}, a ${String(k.name || 'lair').toLowerCase()} held by ${lair.leader.name}. (Action menu when beside it; Journal → Outlaw Lairs)`
                : `All the country speaks of ${lair.name} and ${lair.leader.name}. Its place is no secret now.`,
            type: 'warning',
        });
    },

    // ──────────── REALM PRESSURE ────────────

    /** Each lair the realm knows of is a regional event: stability and land trade fall with its notoriety. */
    _realmEvents(world, st) {
        if (!Array.isArray(world.activeEvents)) world.activeEvents = [];
        const R = OutlawLairs.config().realm || {};
        const live = new Set();
        for (const lair of st.lairs) {
            if (lair.status !== 'active' || lair.kingdomId == null) continue;
            if (_num(lair.notoriety) < _num(R.eventAt, 20)) continue;
            const kingdom = _kingdom(world, lair.kingdomId);
            if (!kingdom || kingdom.isAlive === false) continue;
            live.add(lair.id);
            const n = _num(lair.notoriety);
            const effects = {
                stability: -Math.min(_num(R.stabilityCap, 8), Math.round(n * _num(R.stabilityPer, 0.08) * 10) / 10),
                landTradeIncome: -Math.min(_num(R.tradeCap, 0.2), Math.round(n * _num(R.tradePer, 0.0025) * 1000) / 1000),
            };
            let ev = world.activeEvents.find(e => e && e.lairId === lair.id);
            if (!ev) {
                const k = OutlawLairs.kind(lair.kind) || {};
                ev = {
                    id: 'outlaw_lair',
                    name: `Outlaws of ${lair.name}`,
                    icon: k.icon || '🏕️',
                    severity: 'minor',
                    effects,
                    kingdomId: kingdom.id,
                    partnerKingdomId: null,
                    regionName: kingdom.name,
                    settlementName: null,
                    q: lair.q, r: lair.r,
                    daysLeft: _num(R.eventDays, 3),
                    text: `${lair.leader.name}'s outlaws of ${lair.name} prey on the roads of ${kingdom.name}.`,
                    lairId: lair.id,
                };
                world.activeEvents.push(ev);
            }
            ev.effects = effects;
            ev.kingdomId = kingdom.id;
            ev.daysLeft = _num(R.eventDays, 3);
        }
        world.activeEvents = world.activeEvents.filter(e => !(e && e.lairId != null && !live.has(e.lairId)));
    },

    // ──────────── EXPEDITIONS ────────────

    _maybeExpedition(world, st, lair) {
        const E = OutlawLairs.config().expedition || {};
        const day = _day(world);
        if (day - _num(lair.lastExpeditionCheck) < _num(E.checkEvery, 10)) return;
        lair.lastExpeditionCheck = day;
        if (lair.kingdomId == null || _num(lair.notoriety) < _num(E.minNotoriety, 20)) return;
        if (st.expeditions.some(x => x.lairId === lair.id)) return;
        const kingdom = _kingdom(world, lair.kingdomId);
        if (!kingdom || kingdom.isAlive === false) return;
        if (_num(kingdom.treasury) < _num(E.minTreasury, 300)) return;
        const lawful = OutlawLairs._lawful(kingdom);
        const chance = _num(E.baseChance, 0.06) + lawful * _num(E.lawfulWeight, 0.35) + _num(lair.notoriety) * _num(E.notorietyWeight, 0.004);
        if (Utils.random() >= chance) return;
        const menPer = Math.max(1, _num(E.menPer, 5));
        // Sized to the lair the realm's scouts report, out of what its army can spare
        const garrison = OutlawLairs.garrison(lair) * _num(OutlawLairs.leaderTrait(lair).defense, 1);
        const spare = _num(kingdom.military) * _num(E.militaryShare, 0.25) / menPer;
        if (spare < garrison * _num(E.minOdds, 1.1)) return; // too weak to try
        const strength = Math.round(Utils.clamp(Math.min(spare, garrison * _num(E.sizing, 1.7) + 10), _num(E.minStrength, 25), _num(E.maxStrength, 220)));
        if (_num(kingdom.military) < strength * menPer) return;
        const from = _settlements(world).filter(s => s && s.kingdom === kingdom.id)
            .sort((a, b) => _dist(world, a.q, a.r, lair.q, lair.r) - _dist(world, b.q, b.r, lair.q, lair.r))[0];
        if (!from) return;
        kingdom.military = _num(kingdom.military) - strength * menPer;
        kingdom.treasury = _num(kingdom.treasury) - _num(E.cost, 150);
        const unit = new WorldUnit('lair_expedition', from.q, from.r);
        unit.name = `${kingdom.name}'s Wardens`;
        unit.icon = '🛡️';
        unit.strength = strength;
        unit.population = strength * menPer;
        unit.speed = _num(E.speed, 4);
        unit.inventory = {};
        unit.maxAge = 1e9;
        unit.kingdomId = kingdom.id;
        unit.lairExpedition = lair.id;
        unit.id = `wardens_${lair.id}_${day}`; // unique, whatever the dice
        unit.targetQ = lair.q;
        unit.targetR = lair.r;
        world.units.push(unit);
        st.expeditions.push({ lairId: lair.id, kingdomId: kingdom.id, unitId: unit.id, strength, startDay: day });
        st.stats.expeditions++;
        OutlawLairs._log(lair, world, `${kingdom.name} sent wardens against the lair.`);
        if (Array.isArray(world.events)) world.events.push({ text: `${kingdom.name} sends wardens against the outlaws of ${lair.name}.`, type: 'military' });
    },

    _expeditions(world, player, st, units, out) {
        const E = OutlawLairs.config().expedition || {};
        const menPer = Math.max(1, _num(E.menPer, 5));
        const day = _day(world);
        for (let i = st.expeditions.length - 1; i >= 0; i--) {
            const x = st.expeditions[i];
            const unit = units.get(x.unitId) || world.units.find(u => u && u.id === x.unitId) || null; // sent today: not in the map yet
            const lair = OutlawLairs.find(player, x.lairId);
            const kingdom = _kingdom(world, x.kingdomId);
            const done = (back) => {
                if (unit) unit.destroyed = true;
                if (kingdom && back > 0) kingdom.military = _num(kingdom.military) + Math.round(back * menPer);
                st.expeditions.splice(i, 1);
            };
            if (!unit || unit.destroyed) { st.expeditions.splice(i, 1); continue; }
            if (!lair || lair.status !== 'active') { done(x.strength); continue; }
            if (day - _num(x.startDay) > _num(E.maxDays, 40)) { done(x.strength * 0.8); continue; }
            unit.targetQ = lair.q;
            unit.targetR = lair.r;
            for (let s = 0, n = unit.stepsToday(world); s < n; s++) {
                if (_dist(world, unit.q, unit.r, lair.q, lair.r) <= 1) break;
                const before = `${unit.q},${unit.r}`;
                unit.moveTowardsTarget(world);
                if (`${unit.q},${unit.r}` === before) break;
            }
            if (_dist(world, unit.q, unit.r, lair.q, lair.r) > 1) continue;
            // The assault on the lair
            const trait = OutlawLairs.leaderTrait(lair);
            const attack = _num(x.strength) * Utils.randFloat(0.8, 1.2);
            const defense = (OutlawLairs.garrison(lair) + 1) * _num(E.defenseBonus, 1.25) * _num(trait.defense, 1) * Utils.randFloat(0.8, 1.2);
            if (attack > defense) {
                const loss = _num(E.lossShare, 0.5) * defense / attack;
                if (kingdom) kingdom.treasury = _num(kingdom.treasury) + _num(lair.hoard.gold);
                lair.hoard.gold = 0;
                done(x.strength * (1 - loss));
                OutlawLairs._end(world, player, st, lair, 'cleared', { by: 'realm', name: kingdom ? kingdom.name : 'the wardens', kingdomId: x.kingdomId }, out);
            } else {
                lair.strength = Math.max(0, _num(lair.strength) - attack * 0.3);
                lair.notoriety = Math.min(100, _num(lair.notoriety) + _num(E.winNotoriety, 12));
                lair.hoard.goods.weapons = (lair.hoard.goods.weapons || 0) + 2;
                done(x.strength * 0.2);
                OutlawLairs._log(lair, world, `Threw back the wardens of ${kingdom ? kingdom.name : 'the crown'}.`);
                const text = `The wardens of ${kingdom ? kingdom.name : 'the crown'} were thrown back from ${lair.name}.`;
                if (Array.isArray(world.events)) world.events.push({ text, type: 'military' });
                if (lair.known) out.notices.push({ icon: '🛡️', title: 'Wardens Beaten', text, type: 'warning' });
            }
        }
    },

    // ──────────── ENDINGS ────────────

    /** A lair falls (cleared by the player or a realm) or scatters. Parties disband. */
    _end(world, player, st, lair, how, by, out) {
        const day = _day(world);
        lair.status = how;
        lair.endedDay = day;
        lair.endedBy = by ? by.by : null;
        lair.endedByName = by ? by.name : null;
        for (const p of lair.parties) {
            const u = (world.units || []).find(x => x && x.id === p.unitId);
            if (u) u.destroyed = true;
        }
        lair.parties = [];
        if (how === 'cleared') {
            st.stats.cleared++;
            if (by && by.by === 'player') st.stats.clearedByPlayer++;
            else st.stats.clearedByRealms++;
            OutlawLairs._record(st, {
                key: `lair:${lair.id}:cleared`, kind: 'cleared', day, lairId: lair.id, name: lair.name,
                leader: lair.leader.name, by: by ? by.name : 'the wardens', own: !!(by && by.by === 'player'),
                q: lair.q, r: lair.r, kingdomId: lair.kingdomId,
            });
            // A partner of the lair is named by the men taken alive
            if (lair.allied && !(by && by.by === 'player') && lair.kingdomId != null) {
                Underworld.addHeat(player, lair.kingdomId, _num((OutlawLairs.config().ally || {}).exposedHeat, 25), world);
                out.notices.push({ icon: '🗝️', title: 'Named by Outlaws', text: `Taken alive at ${lair.name}, the outlaws named you as their partner. The guards of ${lair.endedByName || 'the realm'} are looking for you.`, type: 'error' });
            }
            if (lair.known && !(by && by.by === 'player')) {
                out.notices.push({ icon: '🛡️', title: 'Lair Destroyed', text: `${lair.endedByName || 'The wardens'} have burned ${lair.name}. ${lair.leader.name} is no more.`, type: 'info' });
            }
        } else if (how === 'dispersed') {
            OutlawLairs._log(lair, world, 'The band scattered to the winds.');
            if (lair.known) out.notices.push({ icon: '🍂', title: 'Outlaws Scatter', text: `What was left of ${lair.name} has scattered.`, type: 'info' });
        }
        if (Array.isArray(world.activeEvents)) world.activeEvents = world.activeEvents.filter(e => !(e && e.lairId === lair.id));
    },

    /** Pay the player for taking a lair: hoard, renown, Prestige, the realm's thanks. */
    _reward(player, world, lair) {
        const C = OutlawLairs.config().clear || {};
        const n = _num(lair.notoriety);
        const gold = Math.round(_num(lair.hoard.gold) * _num(C.goldShare, 1));
        player.gold = _num(player.gold) + gold;
        lair.hoard.gold = 0;
        const loot = PlayerInventory.addItems(player, lair.hoard.goods);
        lair.hoard.goods = {};
        const renown = Math.round(_num(C.renown, 10) + n * _num(C.renownPerNotoriety, 0.25));
        player.renown = _num(player.renown) + renown;
        const prestige = House.recordPlayerDeed(player, world, 'battleWon', {
            scale: _num(C.prestigeScale, 1.5),
            reason: `cleared ${lair.name}`,
            chronicle: `Cleared the outlaw lair of ${lair.name} and put an end to ${lair.leader.name}.`,
            tags: ['outlaws'],
        });
        let reputation = 0;
        if (lair.kingdomId != null) {
            if (!player.reputation || typeof player.reputation !== 'object') player.reputation = {};
            reputation = Math.round(_num(C.reputation, 8) + n * _num(C.reputationPerNotoriety, 0.1));
            player.reputation[lair.kingdomId] = _num(player.reputation[lair.kingdomId]) + reputation;
        }
        Traits.recordDeeds(player, { valor: 2, popularity: 1 });
        return { gold, goods: loot.added, left: loot.dropped, renown, prestige, reputation };
    },

    // ──────────── THE PLAYER'S DEALINGS ────────────

    _within(player, world, lair, radius) {
        return Number.isFinite(player.q) && _dist(world, player.q, player.r, lair.q, lair.r) <= radius;
    },

    _guard(player, world, lairId, radius = 1) {
        const lair = OutlawLairs.find(player, lairId);
        if (!lair || lair.status !== 'active') return { error: 'That lair is no more.' };
        if (!OutlawLairs._within(player, world, lair, radius)) return { error: `You must be at ${lair.name} or beside it.` };
        return { lair };
    },

    scoutChance(player, lair) {
        const S = OutlawLairs.config().scout || {};
        let p = _num(S.base, 0.55) + _num(player.skills && player.skills.stealth) * _num(S.stealthWeight, 0.05);
        if (OutlawLairs.leaderTrait(lair).scoutPenalty) p -= _num(S.cunningPenalty, 0.15);
        return Utils.clamp(p, 0.05, 0.95);
    },

    /** Creep close and count them: garrison, leader, hoard. A scouted lair is easier to storm. */
    scout(player, world, lairId) {
        const g = OutlawLairs._guard(player, world, lairId, _num((OutlawLairs.config().sight || {}).scoutRadius, 2));
        if (g.error) return { success: false, reason: g.error };
        const lair = g.lair;
        const S = OutlawLairs.config().scout || {};
        const st = OutlawLairs.state(player);
        if (Utils.random() < OutlawLairs.scoutChance(player, lair)) {
            lair.scouted = { day: _day(world), garrison: OutlawLairs.garrison(lair), hoard: _num(lair.hoard.gold) };
            st.stats.scouted++;
            Traits.recordDeed(player, 'cunning');
            return { success: true, scouted: true, text: `You count ${OutlawLairs.garrison(lair)} fighting men at home, ${lair.parties.length} band(s) out riding, and a hoard worth some ${Math.round(_num(lair.hoard.gold))} gold. ${lair.leader.name} is ${OutlawLairs.leaderTrait(lair).label || 'unknown'} — ${OutlawLairs.leaderTrait(lair).desc || ''}.` };
        }
        const hurt = _roll(S.caughtHealth || [4, 10]);
        player.health = Math.max(1, _num(player.health) - hurt);
        lair.alertUntil = _day(world) + 5;
        return { success: true, scouted: false, text: `A sentry spots you. You get away with ${hurt} wounds, and the camp is on its guard for days.` };
    },

    /** Enemy strength for an assault stage (fortification, leader, scouting, alarm). */
    stageStrength(player, world, lair, stage) {
        const A = OutlawLairs.config().assault || {};
        const S = OutlawLairs.config().scout || {};
        const trait = OutlawLairs.leaderTrait(lair);
        let s = OutlawLairs.garrison(lair) * _num(stage.share, 0.5) * _num(A.fortify, 1.15) * _num(trait.defense, 1);
        if (stage.leader && !lair.leader.slain) s += _num(A.leaderStrength, 10);
        if (lair.scouted) s *= 1 - _num(S.assaultBonus, 0.15);
        if (lair.alertUntil != null && _day(world) <= lair.alertUntil) s *= 1.15;
        return Math.max(1, Math.round(s));
    },

    /**
     * Storm the lair in three stages (palisade, camp, the leader's hold), each a
     * battle through PlayerMilitary.combat. A lost stage ends the assault.
     * → { success, stages: [{ name, enemy, victory, casualties }], cleared, rewards }
     */
    assault(player, world, lairId) {
        const g = OutlawLairs._guard(player, world, lairId, 1);
        if (g.error) return { success: false, reason: g.error };
        const lair = g.lair;
        if (!(player.army || []).length) return { success: false, reason: 'You need an army to storm a lair.' };
        const A = OutlawLairs.config().assault || {};
        const N = OutlawLairs.config().notoriety || {};
        const st = OutlawLairs.state(player);
        const tile = world.getTile(lair.q, lair.r);
        const res = { success: true, stages: [], cleared: false, rewards: null };
        // Betraying a partner, or breaking a bargain
        lair.allied = null;
        lair.tribute = null;
        for (const stage of A.stages || []) {
            const enemy = OutlawLairs.stageStrength(player, world, lair, stage);
            const fight = PlayerMilitary.combat(player, enemy, `${lair.name} (${stage.name})`, {
                terrainId: tile && tile.terrain ? tile.terrain.id : null, world,
            });
            if (fight.reason) return { success: false, reason: fight.reason };
            res.stages.push({ name: stage.name, enemy, victory: !!fight.victory, casualties: _num(fight.casualties), loot: _num(fight.loot), captured: !!fight.captured });
            if (!fight.victory) {
                lair.notoriety = Math.min(100, _num(lair.notoriety) + _num(N.perVictory, 10));
                OutlawLairs._log(lair, world, `Beat off an assault by ${player.name || 'a stranger'}.`);
                return res;
            }
            // The defenders of this stage are dead or fled
            lair.strength = Math.max(0, _num(lair.strength) - enemy * _num(A.stageLoss, 0.45));
        }
        lair.leader.slain = true;
        lair.leader.slainBy = 'player';
        lair.leader.slainDay = _day(world);
        st.stats.leadersSlain++;
        res.rewards = OutlawLairs._reward(player, world, lair);
        res.cleared = true;
        OutlawLairs._end(world, player, st, lair, 'cleared', { by: 'player', name: player.name || 'a bold captain' }, { notices: [] });
        return res;
    },

    strikeChance(player, lair) {
        const S = OutlawLairs.config().strike || {};
        let p = _num(S.base, 0.25)
            + _num(player.skills && player.skills.stealth) * _num(S.stealthWeight, 0.05)
            + _num(player.skills && player.skills.combat) * _num(S.combatWeight, 0.04);
        if (OutlawLairs.leaderTrait(lair).scoutPenalty) p -= _num(S.cunningPenalty, 0.12);
        if (lair.scouted) p += _num(S.scoutedBonus, 0.1);
        return Utils.clamp(p, 0.05, 0.9);
    },

    /** Slip in alone and kill the leader. The band falls to infighting — or scatters. */
    strike(player, world, lairId) {
        const g = OutlawLairs._guard(player, world, lairId, 1);
        if (g.error) return { success: false, reason: g.error };
        const lair = g.lair;
        if (lair.leader.slain) return { success: false, reason: 'The lair has no leader to strike at.' };
        const S = OutlawLairs.config().strike || {};
        const st = OutlawLairs.state(player);
        const day = _day(world);
        if (Utils.random() >= OutlawLairs.strikeChance(player, lair)) {
            const hurt = _roll(S.failHealth || [12, 25]);
            player.health = Math.max(1, _num(player.health) - hurt);
            lair.alertUntil = day + 7;
            return { success: true, slain: false, text: `${lair.leader.name}'s guards were waiting. You cut your way out with ${hurt} wounds.` };
        }
        const name = lair.leader.name;
        lair.leader.slain = true;
        lair.leader.slainBy = 'player';
        lair.leader.slainDay = day;
        lair.leaderlessUntil = day + _roll(S.newLeaderDays || [18, 32]);
        lair.strength = Math.max(0, _num(lair.strength) * (1 - _num(S.leaderlessLoss, 0.35)));
        st.stats.leadersSlain++;
        player.renown = _num(player.renown) + 5;
        Traits.recordDeeds(player, { valor: 1, cunning: 1 });
        OutlawLairs._log(lair, world, `${name} was killed in the night.`);
        const out = { notices: [] };
        let scattered = false;
        if (lair.strength < _num((OutlawLairs.config().raids || {}).minGarrison, 12)) {
            OutlawLairs._end(world, player, st, lair, 'dispersed', null, out);
            scattered = true;
        }
        return { success: true, slain: true, scattered, text: `${name} dies in the dark.${scattered ? ' Leaderless, the band scatters.' : ' The camp tears itself apart over who leads next.'}` };
    },

    tributePrice(player, lair) {
        const T = OutlawLairs.config().tribute || {};
        const mult = _num(OutlawLairs.leaderTrait(lair).tributeMult, 1);
        return Math.round((_num(T.base, 60) + _num(lair.strength) * _num(T.perStrength, 4) + _num(lair.notoriety) * _num(T.perNotoriety, 2)) * mult);
    },

    /** Pay for protection: the lair's riders spare you and your holdings. The gold feeds them. */
    payTribute(player, world, lairId) {
        const g = OutlawLairs._guard(player, world, lairId, 1);
        if (g.error) return { success: false, reason: g.error };
        const lair = g.lair;
        const k = OutlawLairs.kind(lair.kind) || {};
        if (!k.parley) return { success: false, reason: 'There is no bargaining with beasts.' };
        if (lair.leader.slain) return { success: false, reason: 'There is no one to bargain with.' };
        const T = OutlawLairs.config().tribute || {};
        const price = OutlawLairs.tributePrice(player, lair);
        if (_num(player.gold) < price) return { success: false, reason: `${lair.leader.name} wants ${price} gold.` };
        const st = OutlawLairs.state(player);
        const day = _day(world);
        player.gold -= price;
        lair.hoard.gold = _num(lair.hoard.gold) + price;
        lair.strength = Math.min(_num(k.maxStrength, 160), _num(lair.strength) + price * _num(T.growthShare, 0.5) / 20);
        lair.tribute = { until: Math.max(day, _num(lair.tribute && lair.tribute.until)) + _num(T.days, 60), paid: price };
        st.stats.tributes++;
        st.stats.tributeGold += price;
        if (lair.kingdomId != null) {
            if (!player.reputation || typeof player.reputation !== 'object') player.reputation = {};
            player.reputation[lair.kingdomId] = _num(player.reputation[lair.kingdomId]) + _num(T.reputation, -2);
        }
        Traits.recordDeed(player, 'cowardice');
        for (const p of lair.parties) {
            const u = (world.units || []).find(x => x && x.id === p.unitId);
            if (u) u.sparesPlayer = true;
        }
        return { success: true, price, until: lair.tribute.until, text: `${lair.leader.name} takes ${price} gold. Until day ${lair.tribute.until}, the riders of ${lair.name} will leave you and yours be.` };
    },

    /** Can the player make the lair a partner? Rogues and guild men only. */
    canAlly(player, lair) {
        const k = OutlawLairs.kind(lair && lair.kind) || {};
        if (!lair || lair.status !== 'active') return { ok: false, reason: 'That lair is no more.' };
        if (!k.ally) return { ok: false, reason: 'They make no partners.' };
        if (lair.allied) return { ok: false, reason: 'You are already partners.' };
        if (lair.leader.slain) return { ok: false, reason: 'There is no one to deal with.' };
        const A = OutlawLairs.config().ally || {};
        const uw = player && player.underworld;
        const member = !!(uw && uw.guild && uw.guild.member);
        if (!member && _num(player && player.karma) > _num(A.karmaMax, -15)) return { ok: false, reason: 'They do not trust an honest face. (Thieves\' Guild members or the notorious only)' };
        if (_num(player && player.gold) < _num(A.cost, 100)) return { ok: false, reason: `It takes ${_num(A.cost, 100)} gold to buy in.` };
        return { ok: true };
    },

    /** Buy into the lair: a weekly cut of its plunder, its riders spare you; heat with the realm. */
    ally(player, world, lairId) {
        const g = OutlawLairs._guard(player, world, lairId, 1);
        if (g.error) return { success: false, reason: g.error };
        const lair = g.lair;
        const ok = OutlawLairs.canAlly(player, lair);
        if (!ok.ok) return { success: false, reason: ok.reason };
        const A = OutlawLairs.config().ally || {};
        const st = OutlawLairs.state(player);
        const cost = _num(A.cost, 100);
        player.gold -= cost;
        lair.hoard.gold = _num(lair.hoard.gold) + cost;
        lair.allied = { since: _day(world), lastCut: _day(world) };
        lair.tribute = null;
        st.stats.alliances++;
        player.karma = _num(player.karma) - 3;
        Traits.recordDeeds(player, { cunning: 1, deceit: 1, greed: 1 });
        if (lair.kingdomId != null) Underworld.addHeat(player, lair.kingdomId, _num(A.heatPerWeek, 3), world);
        for (const p of lair.parties) {
            const u = (world.units || []).find(x => x && x.id === p.unitId);
            if (u) u.sparesPlayer = true;
        }
        return { success: true, text: `You clasp hands with ${lair.leader.name}. Each week a share of what ${lair.name} takes on the road is yours — and the guards of the realm will not thank you for it.` };
    },

    /** Reveal a lair (a bounty notice gives its place). */
    reveal(player, lairId) {
        const lair = OutlawLairs.find(player, lairId);
        if (lair) { lair.known = true; lair.rumoured = true; }
        return lair;
    },

    // ──────────── BOUNTIES, RUMOURS ────────────

    bountyPrice(lair) {
        const B = OutlawLairs.config().bounty || {};
        return Math.round(_num(B.base, 80) + _num(lair.notoriety) * _num(B.perNotoriety, 6));
    },

    /** Notices for outlaw chiefs near this board (BountyHunting.generateBoardOffers). */
    bountyOffers(player, world, tile) {
        const out = [];
        if (!player || !world || !tile) return out;
        const B = OutlawLairs.config().bounty || {};
        for (const lair of OutlawLairs.active(player)) {
            if (lair.leader.slain || _num(lair.notoriety) < _num(B.postAt, 30)) continue;
            if (_dist(world, tile.q, tile.r, lair.q, lair.r) > _num(B.radius, 24)) continue;
            const k = OutlawLairs.kind(lair.kind) || {};
            const kingdom = _kingdom(world, lair.kingdomId);
            const pay = OutlawLairs.bountyPrice(lair);
            out.push({
                id: `lair_${lair.id}_${lair.leader.gen}`,
                type: 'lair_leader',
                icon: k.icon || '🏕️',
                name: `Bounty: ${lair.leader.name}`,
                targetName: lair.leader.name,
                lairId: lair.id,
                leaderGen: lair.leader.gen,
                notoriety: OutlawLairs.notorietyLabel(lair.notoriety).toLowerCase(),
                difficulty: Math.min(10, Math.max(3, Math.round(_num(lair.strength) / 15))),
                actualPay: pay,
                daysLimit: _num(B.daysLimit, 120),
                daysElapsed: 0,
                fromSettlement: (tile.settlement && tile.settlement.name) || 'Unknown Settlement',
                fromQ: tile.q, fromR: tile.r,
                targetQ: lair.q, targetR: lair.r,
                lastKnownQ: lair.q, lastKnownR: lair.r,
                status: 'active',
                canRecruit: false,
                targetBackstory: `Chief of ${lair.name}, ${OutlawLairs.strengthLabel(_num(lair.strength))}. Storm the lair or strike at the leader alone.`,
                description: `${kingdom ? kingdom.name : 'The villages'} pay ${pay}g for the head of ${lair.leader.name} of ${lair.name} (${lair.q}, ${lair.r}).`,
            });
        }
        return out;
    },

    /** The lair-leader bounty's fate: 'slain' (by the player), 'gone' (no longer claimable) or null. */
    bountyStatus(player, bounty) {
        const lair = OutlawLairs.find(player, bounty && bounty.lairId);
        if (!lair) return 'gone';
        const L = lair.leader;
        if (L && _num(L.gen) === _num(bounty.leaderGen) && L.slain) return L.slainBy === 'player' ? 'slain' : 'gone';
        if (L && _num(L.gen) !== _num(bounty.leaderGen)) return 'gone';
        if (lair.status !== 'active') return 'gone';
        return null;
    },

    /** Tavern talk of the lairs within earshot. The player hears where they are. → [{ icon, title, text }] */
    tavernRumors(player, world, tile) {
        const out = [];
        if (!player || !world || !tile) return out;
        const cfg = OutlawLairs.config();
        const N = cfg.notoriety || {};
        for (const lair of OutlawLairs.active(player)) {
            if (_num(lair.notoriety) < _num(N.rumourAt, 25)) continue;
            if (_dist(world, tile.q, tile.r, lair.q, lair.r) > _num(cfg.tavernRadius, 20)) continue;
            const k = OutlawLairs.kind(lair.kind) || {};
            const exact = _num(lair.notoriety) >= _num(N.feared, 50);
            lair.rumoured = true;
            if (exact) lair.known = true;
            const where = exact ? `at (${lair.q}, ${lair.r})` : `somewhere near (${lair.hintQ}, ${lair.hintR})`;
            const bounty = _num(lair.notoriety) >= _num((cfg.bounty || {}).postAt, 30) && !lair.leader.slain ? ` There's ${OutlawLairs.bountyPrice(lair)} gold on the chief's head at the notice board.` : '';
            out.push({
                icon: k.icon || '🏕️',
                title: `${OutlawLairs.notorietyLabel(lair.notoriety)} outlaws: ${lair.name}`,
                text: `${lair.leader.slain ? 'The leaderless' : `${lair.leader.name}'s`} ${String(k.name || 'outlaws').toLowerCase()} ${where} — ${OutlawLairs.strengthLabel(_num(lair.strength))}, ${lair.raids} raid(s) this far.${bounty} (Journal → Outlaw Lairs)`,
            });
        }
        return out;
    },

    // ──────────── CONTENT INTEGRITY ────────────

    /** Problems in data/outlawLairs.json (empty when valid). Used by tests. */
    validate(terrainIds = null, goodIds = null) {
        const problems = [];
        const d = OutlawLairs.data();
        const traits = (d.leaders || {}).traits || {};
        for (const id of d.kindOrder || []) if (!OutlawLairs.kind(id)) problems.push(`kindOrder: unknown kind ${id}`);
        for (const [id, k] of Object.entries(OutlawLairs.kinds())) {
            if (!(d.kindOrder || []).includes(id)) problems.push(`${id}: missing from kindOrder`);
            if (!Array.isArray(k.terrains) || !k.terrains.length) problems.push(`${id}: no terrains`);
            for (const t of k.terrains || []) if (terrainIds && !terrainIds.includes(t)) problems.push(`${id}: unknown terrain ${t}`);
            if (!k.party || !['raider', 'beast'].includes(k.party.type)) problems.push(`${id}: party type must be raider or beast`);
            if (!Array.isArray(k.strength) || k.strength.length !== 2) problems.push(`${id}: strength must be [min, max]`);
            if (!(k.maxStrength > 0)) problems.push(`${id}: no maxStrength`);
            for (const g of Object.keys((k.hoard && k.hoard.goods) || {})) if (goodIds && !goodIds.includes(g)) problems.push(`${id}: unknown hoard good ${g}`);
            if (!Array.isArray(k.nouns) || !k.nouns.length) problems.push(`${id}: no nouns`);
            if (!k.beasts && (!Array.isArray(k.titles) || !k.titles.length)) problems.push(`${id}: no leader titles`);
        }
        if (!Object.keys(traits).length) problems.push('leaders: no traits');
        if (!Array.isArray(d.places) || d.places.length < 5) problems.push('places: too few');
        return problems;
    },
};
