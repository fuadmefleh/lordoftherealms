// ============================================
// DISCOVERY — uncharted lands: places on no map until someone finds them
// ============================================
// The world map is generated whole at the start, but a handful of places in
// it are nobody's knowledge yet: remote islands, hidden coves, lost valleys
// behind the mountains and sunken reefs. They are picked from the existing
// map — never by changing world generation — lazily on the first daily tick
// (or the first voyage / exploration), ranked by a hash of the world seed so
// the same world always hides the same places and the game RNG is untouched.
//
// How they are found:
//   - at sea (Discovery.processDay): aboard a ship within sight of one, with
//     a chance per day — better in open sea far from ports, and when you
//     already have a rumour or a chart of it. Expeditions
//     (startExpedition) are voyages (systems/shipVoyages.js) that end out at
//     sea: to a rumoured place, or into open water far from every port.
//   - the explore-ocean activity (Discovery.exploreOcean wraps Ships')
//   - on foot or aboard within a couple of hexes (lost valleys are walked to)
//   - ancient and treasure maps can point to one (chartFromMap, called from
//     Cartography.applyMap), tavern notice boards carry rumours (tavernRumors)
//   - rival adventurers (systems/rivals.js) may find one first
//
// The first discoverer names it (the player picks from generated names or
// keeps the default), earning renown and an entry in the House chronicle.
// What's there: exotic goods (data/discovery.json → goods, merged into the
// GOODS table at load and stocked by no market, so they come only from here),
// native peoples (tile.indigenous — Colonization's tribes, named for one of
// the Peoples), ruins (a 'ruins' improvement — a delve site), and hazards
// (reefs and storms that batter hulls, sickness through Ailments).
//
// A place can be sold to a realm's Royal Archive (it then knows of it, may
// claim it, and its traders take from the stock) or kept secret. Found a
// colony there (Colonization) for exclusive access and a richer stock; realms
// that know of it may contest the claim with their navy.
//
// State lives on player.discovery (saved by saveLoad, backfilled on load);
// ruins and natives placed on discovery live on the tiles (saved with them).
// World / player / day are passed in; all randomness is Utils or a seed hash.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { PlayerInventory } from '../core/inventory.js';
import { Colonization } from '../world/colonization.js';
import { KingdomNavy } from '../world/kingdomNavy.js';
import { KingdomAtlas } from '../world/kingdomAtlas.js';
import { Ships } from './ships.js';
import { Rivals } from './rivals.js';
import { House } from './house.js';
import { Traits } from './traits.js';
import { Ailments } from './ailments.js';
import { Quests } from './quests.js';

const DEFAULT_CONFIG = {
    minDay: 1,
    minSpacing: 7,
    islandMaxRegion: 45,
    walkFindRadius: 2,
    sightRadius: 5,
    openSeaDistance: 5,
    sighting: { base: 0.25, openSea: 0.2, hinted: 0.3, shipExploration: 0.03 },
    exploreOcean: { radius: 16, base: 0.35, hinted: 0.35, perLeague: 0.015 },
    expedition: { maxLeagues: 45, openSeaMin: 8, victualDays: 3 },
    namingDays: 3,
    renown: { island: 12, cove: 8, valley: 10, reef: 8 },
    prestige: { island: 6, cove: 4, valley: 5, reef: 4 },
    rumour: { chance: 0.35, radius: 30, blur: 4, hintRadius: 5 },
    maps: { ancient: 0.5, treasure: 0.25 },
    rivals: { startDay: 30, dailyChance: 0.02, renown: [4, 9] },
    stock: { max: 6, regenDays: 4, claimedMax: 16, claimedRegenDays: 1, gatherMax: 4, skimChance: 0.08 },
    archive: { base: { island: 260, cove: 160, valley: 200, reef: 150 }, perFeature: 0.25, secondHand: 0.5, reputation: 3 },
    claim: { colonyRadius: 3, kingdomClaimChance: 0.006, poachReputation: 2 },
    contest: { chance: 0.008, days: 20, tribute: [250, 600], fleetShare: 0.5, minFleet: 15, winRenown: 10, loseReputation: 10 },
    hazards: { reefDamage: [6, 16], reefChartedSafe: true, stormDamage: [3, 9], stormChance: 0.3, diseaseChance: 0.35 },
    salvage: { gold: [40, 160] },
};

const KIND_ORDER = ['island', 'cove', 'valley', 'reef'];
const FALLBACK_KIND = { label: 'Uncharted Land', icon: '❔', count: 0, minSettlementDistance: 8, goods: [], names: ['{adj} Land'] };
const WATER = ['ocean', 'deep_ocean', 'coast', 'lake', 'sea'];
const HIGH = ['mountain', 'snow_peak', 'highlands', 'hills'];
const DIRS = ['east', 'north-east', 'north-west', 'west', 'south-west', 'south-east'];

/** Per-world caches (not saved): settlements, ports. */
const _cache = new WeakMap();

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _day = (world) => (world && world.day) || 0;

/** A well-mixed unsigned 32-bit hash of the parts (no RNG draws). */
function _hash(...parts) {
    const s = parts.join('|');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
}

/** A hash as a fraction in [0, 1). */
const _unit = (...parts) => _hash(...parts) / 4294967296;

function _rollHash(range, ...parts) {
    if (!Array.isArray(range)) return _num(range);
    const lo = Math.min(range[0], range[1]);
    const hi = Math.max(range[0], range[1]);
    return lo + (_hash(...parts) % (hi - lo + 1));
}

function _dist(world, q1, r1, q2, r2) {
    const w = (world && world.width) || 0;
    return w > 0 ? Hex.wrappingDistance(q1, r1, q2, r2, w) : Hex.distance(q1, r1, q2, r2);
}

function _isWater(tile) {
    return !!(tile && tile.terrain && WATER.includes(tile.terrain.id));
}

function _isLand(tile) {
    return !!(tile && tile.terrain && tile.terrain.passable && !_isWater(tile));
}

function _neighbours(world, q, r) {
    const W = world.width || 0;
    const out = [];
    for (const n of Hex.neighbors(q, r)) {
        const t = world.getTile(W ? Hex.wrapQ(n.q, W) : n.q, n.r);
        if (t) out.push(t);
    }
    return out;
}

function _fill(text, vars) {
    let s = String(text || '');
    for (const [k, v] of Object.entries(vars || {})) s = s.split(`{${k}}`).join(v);
    return s;
}

function _dir(world, fromQ, fromR, toQ, toR) {
    const W = world.width || 0;
    let dq = toQ - fromQ;
    if (W) {
        if (dq > W / 2) dq -= W;
        if (dq < -W / 2) dq += W;
    }
    const dr = toR - fromR;
    // Axial → pixel-ish angle (pointy hexes): x = q + r/2, y = r
    const x = dq + dr / 2;
    const y = -dr;
    const a = (Math.atan2(y, x) * 180) / Math.PI;
    const idx = ((Math.round(a / 60) % 6) + 6) % 6;
    return DIRS[idx];
}

export const Discovery = {
    // ──────────── DATA ────────────

    data() {
        return DataLoader.discovery || (DataLoader._gamedata && DataLoader._gamedata.discovery) || {};
    },

    config() {
        const c = Discovery.data().config || {};
        const out = { ...DEFAULT_CONFIG, ...c };
        for (const k of Object.keys(DEFAULT_CONFIG)) {
            const d = DEFAULT_CONFIG[k];
            if (d && typeof d === 'object' && !Array.isArray(d)) out[k] = { ...d, ...(c[k] || {}) };
        }
        return out;
    },

    kinds() {
        return Discovery.data().kinds || {};
    },

    kind(id) {
        return Discovery.kinds()[id] || FALLBACK_KIND;
    },

    /** The exotic goods (data/discovery.json → goods). */
    goods() {
        const g = Discovery.data().goods;
        return Array.isArray(g) ? g : [];
    },

    good(id) {
        return Discovery.goods().find(g => g.id === id) || null;
    },

    /**
     * Merge the exotic goods into the GOODS table (DataLoader calls this),
     * so markets buy them and inventories value them. No market stocks them.
     */
    registerGoods(goodsTable, goods) {
        if (!goodsTable || !Array.isArray(goods)) return;
        for (const g of goods) {
            if (!g || !g.id) continue;
            const key = String(g.id).toUpperCase();
            if (!goodsTable[key]) goodsTable[key] = { id: g.id, name: g.name, icon: g.icon, basePrice: g.basePrice, exotic: true };
        }
    },

    // ──────────── STATE ────────────

    _blank() {
        return {
            initialized: false,
            seed: null,
            sites: [],
            nextId: 1,
            log: [],
            lastDay: null,
            stats: { found: 0, named: 0, sold: 0, gathered: 0, colonies: 0, contestsWon: 0, contestsLost: 0, rivalFinds: 0 },
        };
    },

    /** The player's discovery record, created/backfilled on first use (old saves). */
    state(player) {
        if (!player) return Discovery._blank();
        let st = player.discovery;
        if (!st || typeof st !== 'object' || Array.isArray(st)) {
            player.discovery = Discovery._blank();
            return player.discovery;
        }
        const blank = Discovery._blank();
        if (!Array.isArray(st.sites)) st.sites = [];
        if (typeof st.initialized !== 'boolean') st.initialized = st.sites.length > 0;
        if (st.seed === undefined) st.seed = null;
        if (!(st.nextId > 0)) st.nextId = st.sites.length + 1;
        if (!Array.isArray(st.log)) st.log = [];
        if (st.lastDay === undefined) st.lastDay = null;
        st.stats = { ...blank.stats, ...(st.stats && typeof st.stats === 'object' ? st.stats : {}) };
        for (const s of st.sites) Discovery._backfillSite(s);
        return st;
    },

    _backfillSite(s) {
        if (!s.features || typeof s.features !== 'object') s.features = {};
        const f = s.features;
        if (!Array.isArray(f.goods)) f.goods = [];
        if (f.natives === undefined) f.natives = null;
        if (typeof f.ruins !== 'boolean') f.ruins = false;
        if (!Array.isArray(f.hazards)) f.hazards = [];
        if (!Array.isArray(s.nameOptions)) s.nameOptions = [];
        if (typeof s.name !== 'string') s.name = s.nameOptions[0] || 'Uncharted Land';
        if (s.discovered === undefined) s.discovered = null;
        if (typeof s.known !== 'boolean') s.known = !!s.discovered;
        if (s.hint === undefined) s.hint = null;
        if (s.naming === undefined) s.naming = null;
        if (s.claim === undefined) s.claim = null;
        if (s.contest === undefined) s.contest = null;
        if (!Array.isArray(s.knownBy)) s.knownBy = [];
        if (!s.stock || typeof s.stock !== 'object') s.stock = {};
        if (typeof s.regen !== 'number') s.regen = 0;
        if (typeof s.landed !== 'boolean') s.landed = false;
        if (typeof s.lastGatherDay !== 'number') s.lastGatherDay = -1;
        if (typeof s.visited !== 'boolean') s.visited = !!(s.discovered && s.discovered.by === 'player');
        return s;
    },

    serialize(player) {
        return player && player.discovery ? JSON.parse(JSON.stringify(player.discovery)) : null;
    },

    /** Backfill after load (older saves have none; the places are chosen on the next day). */
    loadState(player) {
        Discovery.state(player);
    },

    sites(player) {
        return Discovery.state(player).sites;
    },

    get(player, id) {
        return Discovery.state(player).sites.find(s => s.id === id) || null;
    },

    _log(player, world, icon, text, siteId = null) {
        const st = Discovery.state(player);
        st.log.unshift({ day: _day(world), icon, text, siteId });
        if (st.log.length > 40) st.log.length = 40;
    },

    // ──────────── WORLD HELPERS ────────────

    _worldCache(world) {
        let c = _cache.get(world);
        if (!c) {
            c = { settlements: null, day: -999 };
            _cache.set(world, c);
        }
        const day = _day(world);
        if (!c.settlements || day - c.day >= 10 || day < c.day) {
            const all = typeof world.getAllSettlements === 'function' ? world.getAllSettlements() : [];
            c.settlements = all.filter(s => s && Number.isFinite(s.q));
            c.ports = c.settlements.filter(s => Ships.isPortTile(world, s.q, s.r));
            c.day = day;
        }
        return c;
    },

    _nearestDist(world, q, r, list) {
        let best = Infinity;
        for (const s of list) {
            const d = _dist(world, q, r, s.q, s.r);
            if (d < best) best = d;
        }
        return best;
    },

    _seed(world) {
        const p = world && world.generationParams;
        return (p && p.seed) || 0;
    },

    // ──────────── CHOOSING THE PLACES ────────────

    /**
     * Pick the uncharted places from the map (once — lazily on the first
     * daily tick, voyage or exploration). Ranked by a hash of the world seed,
     * so no RNG is drawn and world generation is untouched.
     */
    ensureSites(player, world) {
        const st = Discovery.state(player);
        if (st.initialized || !world || !Array.isArray(world.tiles) || !world.width) return st.sites;
        const cfg = Discovery.config();
        const seed = Discovery._seed(world);
        const settlements = Discovery._worldCache(world).settlements;
        st.seed = seed;
        st.initialized = true;
        if (!settlements.length) return st.sites;

        // Land regions small enough to be islands, and which hold a settlement or realm
        const regionSize = new Map();
        const regionTaken = new Set();
        for (const row of world.tiles) {
            for (const t of row) {
                if (!_isLand(t)) continue;
                regionSize.set(t.regionId, (regionSize.get(t.regionId) || 0) + 1);
                if (t.settlement || t.kingdom) regionTaken.add(t.regionId);
            }
        }

        const cand = { island: [], cove: [], valley: [], reef: [] };
        const kinds = Discovery.kinds();
        const minDist = (k) => _num(kinds[k] && kinds[k].minSettlementDistance, 8);
        const islandRegions = new Set();
        for (const row of world.tiles) {
            for (const t of row) {
                if (!t || t.settlement || t.kingdom || t.explored) continue;
                const nb = _neighbours(world, t.q, t.r);
                const waterNb = nb.filter(_isWater).length;
                if (_isLand(t)) {
                    const size = regionSize.get(t.regionId) || 0;
                    const isIsland = size > 0 && size <= cfg.islandMaxRegion && !regionTaken.has(t.regionId);
                    if (isIsland) {
                        if (waterNb > 0) cand.island.push({ t, region: t.regionId });
                        islandRegions.add(t.regionId);
                        continue;
                    }
                    if (waterNb >= 2 || (waterNb > 0 && t.terrain.id === 'beach')) cand.cove.push({ t });
                    else if (waterNb === 0) {
                        // Ringed by high ground: hills, highlands, mountains
                        const high = nb.filter(n => n.terrain && HIGH.includes(n.terrain.id)).length;
                        if (high >= 2) cand.valley.push({ t });
                    }
                } else if (t.terrain && (t.terrain.id === 'coast' || t.terrain.id === 'ocean')) {
                    // Shoal water out at sea, no land beside it
                    if (waterNb === nb.length && nb.length >= 6) cand.reef.push({ t });
                }
            }
        }

        const chosen = [];
        const far = (q, r) => chosen.every(s => _dist(world, q, r, s.q, s.r) >= cfg.minSpacing);
        for (const kindId of KIND_ORDER) {
            const def = kinds[kindId];
            if (!def || !(def.count > 0)) continue;
            const list = cand[kindId]
                .map(c => ({ ...c, h: _hash('discovery', seed, kindId, c.t.q, c.t.r) }))
                .sort((a, b) => a.h - b.h);
            const usedRegions = new Set();
            let n = 0;
            for (const c of list) {
                if (n >= def.count) break;
                const { t } = c;
                if (kindId === 'island' && usedRegions.has(c.region)) continue;
                if (!far(t.q, t.r)) continue;
                if (Discovery._nearestDist(world, t.q, t.r, settlements) < minDist(kindId)) continue;
                if (kindId === 'island') usedRegions.add(c.region);
                const site = Discovery._makeSite(player, world, kindId, t, seed, kindId === 'island' ? regionSize.get(c.region) : 1);
                // No two places share a name
                const taken = new Set(chosen.map(x => x.name));
                site.nameOptions = Discovery._nameOptions(site, null, taken);
                site.name = site.nameOptions[0];
                chosen.push(site);
                n++;
            }
        }
        st.sites.push(...chosen);
        return st.sites;
    },

    _makeSite(player, world, kindId, tile, seed, size) {
        const st = Discovery.state(player);
        const def = Discovery.kind(kindId);
        const h = (...p) => _hash('site', seed, kindId, tile.q, tile.r, ...p);
        const u = (...p) => h(...p) / 4294967296;
        // Goods: one or two of the kind's exotic goods
        const pool = (def.goods || []).filter(g => Discovery.good(g));
        const goods = [];
        if (pool.length) {
            goods.push(pool[h('g1') % pool.length]);
            if (pool.length > 1 && u('g2n') < 0.45) {
                const second = pool[h('g2') % pool.length];
                if (!goods.includes(second)) goods.push(second);
            }
        }
        const hazards = [];
        for (const [hz, p] of Object.entries(def.hazards || {})) if (u('hz', hz) < p) hazards.push(hz);
        const peoples = (Discovery.data().natives || {})[kindId] || [];
        const natives = peoples.length && u('nat') < _num(def.nativesChance) ? peoples[h('people') % peoples.length] : null;
        const site = Discovery._backfillSite({
            id: `disc_${st.nextId++}`,
            kind: kindId,
            q: tile.q,
            r: tile.r,
            size,
            features: { goods, natives, ruins: u('ruins') < _num(def.ruinsChance), hazards },
            seedKey: h('names'),
            name: '',
            nameOptions: [],
        });
        site.nameOptions = Discovery._nameOptions(site, null);
        site.name = site.nameOptions[0];
        return site;
    },

    /** Three or four names for a place, the finder's among them when known. */
    _nameOptions(site, finder, taken = null) {
        const def = Discovery.kind(site.kind);
        const parts = Discovery.data().nameParts || {};
        const adj = parts.adj && parts.adj.length ? parts.adj : ['Hidden'];
        const noun = parts.noun && parts.noun.length ? parts.noun : ['Gull'];
        const tpl = (def.names && def.names.length ? def.names : FALLBACK_KIND.names);
        const out = [];
        for (let i = 0; i < tpl.length * 3 && out.length < 4; i++) {
            const t = tpl[(site.seedKey + i) % tpl.length];
            if (t.includes('{finder}') && !finder) continue;
            const name = _fill(t, {
                adj: adj[_hash(site.seedKey, 'adj', i) % adj.length],
                noun: noun[_hash(site.seedKey, 'noun', i) % noun.length],
                finder: finder || '',
            });
            if (!out.includes(name) && !(taken && taken.has(name))) out.push(name);
        }
        return out.length ? out : [`${def.label}`];
    },

    _takenNames(player, except) {
        return new Set(Discovery.state(player).sites.filter(s => s !== except).map(s => s.name));
    },

    _finderName(player) {
        if (!player) return 'Wanderer';
        return player.lastName || String(player.name || '').split(' ').pop() || 'Wanderer';
    },

    /** Has the player themselves found (or reached) this place? */
    playerKnowsExactly(site) {
        return !!(site && (site.known || site.hint === 'charted'));
    },

    describeFeatures(site) {
        const out = [];
        for (const g of site.features.goods) {
            const def = Discovery.good(g);
            if (def) out.push(`${def.icon} ${def.name}`);
        }
        if (site.features.natives) out.push(`👥 ${Discovery._peopleName(site.features.natives)}`);
        if (site.features.ruins) out.push(site.kind === 'reef' ? '⚓ a wreck' : '🏚️ ruins');
        const HZ = { reef: '⚠️ reefs', storms: '⛈️ storms', disease: '🦟 sickness' };
        for (const hz of site.features.hazards) out.push(HZ[hz] || hz);
        return out;
    },

    _peopleName(id) {
        const roots = (DataLoader._gamedata && DataLoader._gamedata.peoples && DataLoader._gamedata.peoples.tribalRoots) || {};
        const p = roots[id] || Object.values(roots).find(x => x && x.id === id);
        return (p && p.name) || String(id).replace(/_/g, ' ');
    },

    // ──────────── DAILY ────────────

    /**
     * One day: choose the places (first day), spot places at sea or close by,
     * rivals' finds, names that fall to the default, stock, claims and
     * contests. Returns { notices: [{icon,title,text,type}], found: [site] }.
     */
    processDay(world, player) {
        const out = { notices: [], found: [] };
        if (!world || !player) return out;
        const st = Discovery.state(player);
        const day = _day(world);
        if (st.lastDay === day) return out;
        st.lastDay = day;
        const cfg = Discovery.config();
        if (day < cfg.minDay && !st.initialized) return out;
        Discovery.ensureSites(player, world);
        if (!st.sites.length) return out;
        const notify = (icon, title, text, type = 'info') => out.notices.push({ icon, title, text, type });

        Discovery._lookAround(player, world, notify, out);
        Discovery._namesFallDue(player, world, notify);
        Discovery._rivalFinds(player, world, notify);
        Discovery._tickStock(player, world);
        Discovery._tickClaims(player, world, notify);
        Discovery._tickContests(player, world, notify);
        return out;
    },

    /** Where the player's ship is when aboard (else null). */
    _boardedShip(player) {
        return player && player.boardedShip != null ? Ships.getShipById(player, player.boardedShip) : null;
    },

    /** Places close by or in sight from a ship's deck. */
    _lookAround(player, world, notify, out) {
        const cfg = Discovery.config();
        const st = Discovery.state(player);
        const here = world.getTile(player.q, player.r);
        const ship = Discovery._boardedShip(player);
        const atSea = !!ship && _isWater(here);
        const ports = Discovery._worldCache(world).ports;
        let portDist = null;
        for (const site of st.sites) {
            const d = _dist(world, player.q, player.r, site.q, site.r);
            // Weather around a stormy place batters a passing ship
            if (atSea && d <= 2 && site.features.hazards.includes('storms') && site.known) {
                Discovery._stormHazard(player, world, ship, site, notify);
            }
            if (site.discovered && (site.discovered.by === 'player' || site.visited)) {
                if (d <= 1) Discovery._visit(player, world, site, notify);
                continue;
            }
            if (d <= cfg.walkFindRadius) {
                Discovery._found(player, world, site, atSea ? 'sea' : 'land', ship, notify, out);
                if (d <= 1) Discovery._visit(player, world, site, notify);
                continue;
            }
            // In sight from the deck (inland valleys can't be seen from the sea)
            if (!atSea || site.kind === 'valley' || d > cfg.sightRadius) continue;
            if (portDist === null) portDist = Discovery._nearestDist(world, player.q, player.r, ports);
            const S = cfg.sighting;
            let p = S.base;
            if (portDist >= cfg.openSeaDistance) p += S.openSea;
            if (site.hint) p += S.hinted;
            p += S.shipExploration * (Ships.getShipEffectiveStats(ship).effects.explorationBonus || 0);
            p *= Ships.getExplorationMultiplier(player, ship) * (1 - (d - 1) / (cfg.sightRadius + 1) * 0.5);
            if (Utils.random() < p) Discovery._found(player, world, site, 'sighting', ship, notify, out);
        }
    },

    /**
     * The player has found a place — or reached one someone else found.
     * how: 'sea' | 'land' | 'sighting' | 'exploration'
     */
    _found(player, world, site, how, ship, notify, out = null) {
        const cfg = Discovery.config();
        const def = Discovery.kind(site.kind);
        const day = _day(world);
        // Uncover the place on the player's map
        for (const hx of Hex.hexesInRange(site.q, site.r, 2)) {
            const t = world.getTile(world.width ? Hex.wrapQ(hx.q, world.width) : hx.q, hx.r);
            if (t) t.explored = true;
        }
        if (site.discovered && site.discovered.by !== 'player') {
            if (!site.visited) {
                site.visited = true;
                site.known = true;
                Discovery._log(player, world, def.icon, `Reached ${site.name}, which ${site.discovered.byName} found first.`, site.id);
                notify(def.icon, `${site.name}`, `You reach ${site.name} — ${site.discovered.byName} charted it before you.`, 'info');
            }
            return site;
        }
        const st = Discovery.state(player);
        site.discovered = { by: 'player', byName: player.name || 'You', day, how };
        site.known = true;
        site.visited = true;
        site.nameOptions = Discovery._nameOptions(site, Discovery._finderName(player), Discovery._takenNames(player, site));
        site.name = site.nameOptions[0];
        site.naming = { untilDay: day + cfg.namingDays };
        for (const g of site.features.goods) site.stock[g] = Math.max(_num(site.stock[g]), Math.ceil(cfg.stock.max / 2));
        st.stats.found++;
        if (site.hint) Quests.track(player, 'hinted_lands_found'); // a rumoured or charted land
        player.renown = Math.max(0, _num(player.renown) + _num(cfg.renown[site.kind], 8));
        Traits.recordDeed(player, how === 'land' ? 'travel' : 'seafaring', 1);
        Traits.recordDeed(player, 'learning', 1);
        Discovery._placeFeatures(world, site);
        // An uncharted reef can open a hull before anyone sees it
        if (ship && site.features.hazards.includes('reef') && !(cfg.hazards.reefChartedSafe && site.hint === 'charted') && Utils.random() < 0.5) {
            const dmg = Ships.mitigateHullDamage(ship, Utils.randInt(cfg.hazards.reefDamage[0], cfg.hazards.reefDamage[1]));
            ship.condition = Math.max(5, _num(ship.condition, 100) - dmg);
            notify('⚠️', 'Struck a Reef', `${ship.name} scrapes over hidden rocks (hull −${dmg}%).`, 'warning');
        }
        // A wreck on the reef gives up its salvage to whoever finds it
        if (site.kind === 'reef' && site.features.ruins) {
            const gold = Utils.randInt(cfg.salvage.gold[0], cfg.salvage.gold[1]);
            player.gold = _num(player.gold) + gold;
            if (player.financeToday) player.financeToday.income.exploration = (player.financeToday.income.exploration || 0) + gold;
            notify('⚓', 'Salvage', `Divers bring up ${gold}g from an old wreck on the reef.`, 'success');
        }
        const how2 = { sighting: 'Land ho! The lookout sights', exploration: 'Your exploration turns up', sea: 'You sail upon', land: 'You come upon' }[how] || 'You find';
        const text = `${how2} ${def.label.toLowerCase()} on no map: ${Discovery.describeFeatures(site).join(', ') || 'untouched'}. Name it in Journal → Discoveries (or it will be called ${site.name}).`;
        Discovery._log(player, world, def.icon, `Discovered a ${def.label.toLowerCase()} (${site.q}, ${site.r}).`, site.id);
        notify(def.icon, `Discovery! A ${def.label}`, text, 'success');
        if (ship && ship.voyage && Array.isArray(ship.voyage.log)) {
            ship.voyage.log.push({ day, icon: def.icon, text: `Discovered a ${def.label.toLowerCase()} — not on any chart.` });
        }
        if (out) out.found.push(site);
        return site;
    },

    /** Ruins and native peoples on the tiles, placed once the place is found. */
    _placeFeatures(world, site) {
        const f = site.features;
        const spots = [world.getTile(site.q, site.r), ..._neighbours(world, site.q, site.r)].filter(_isLand);
        if (f.ruins && site.kind !== 'reef') {
            const t = spots.find(x => !x.improvement && !x.settlement);
            if (t) {
                t.improvement = { type: 'ruins', icon: '🏚️', name: `Ruins on ${site.name}`, explored: false, founded: 0, discoverySite: site.id };
                site.ruinsAt = { q: t.q, r: t.r };
            }
        }
        if (f.natives) {
            const t = spots.find(x => !x.indigenous && !x.settlement);
            if (t) {
                const tribes = Colonization.INDIGENOUS_TRIBES || [];
                const tribe = tribes.find(tr => (tr.terrains || []).includes(t.terrain.id))
                    || tribes.find(tr => tr.id === (site.kind === 'valley' ? 'mountain_clans' : 'coastal_tribes')) || tribes[0];
                if (tribe) {
                    t.indigenous = {
                        tribeId: tribe.id,
                        name: Discovery._peopleName(f.natives),
                        icon: tribe.icon,
                        population: 40 + (_hash(site.seedKey, 'pop') % 120),
                        hostility: tribe.hostility,
                        tradeability: tribe.tradeability,
                        relation: 0,
                        discovered: true,
                        peopleId: f.natives,
                    };
                    site.nativesAt = { q: t.q, r: t.r };
                }
            }
        }
    },

    /** First steps ashore: sickness in the air. */
    _visit(player, world, site, notify) {
        if (site.landed || Discovery._boardedShip(player)) return;
        const here = world.getTile(player.q, player.r);
        if (!_isLand(here)) return;
        site.landed = true;
        const cfg = Discovery.config();
        if (site.features.hazards.includes('disease') && Utils.random() < cfg.hazards.diseaseChance) {
            const id = site.kind === 'valley' ? 'marsh_fever' : 'flux';
            const rec = Ailments.inflict(player, world, id, { source: 'discovery' });
            if (rec) notify(rec.icon || '🦟', 'Sickness Ashore', `The air of ${site.name} carries ${String(rec.name).toLowerCase()}.`, 'warning');
        }
    },

    _stormHazard(player, world, ship, site, notify) {
        const cfg = Discovery.config();
        if (_unit('storm', site.id, _day(world)) >= cfg.hazards.stormChance) return;
        const dmg = Ships.mitigateHullDamage(ship, _rollHash(cfg.hazards.stormDamage, 'stormdmg', site.id, _day(world)));
        ship.condition = Math.max(5, _num(ship.condition, 100) - dmg);
        notify('⛈️', 'Squalls', `The squalls that ring ${site.name} batter ${ship.name} (hull −${dmg}%).`, 'warning');
    },

    _namesFallDue(player, world, notify) {
        for (const site of Discovery.state(player).sites) {
            if (site.naming && _day(world) >= site.naming.untilDay) {
                Discovery.nameSite(player, world, site.id, null);
                notify(Discovery.kind(site.kind).icon, 'Named', `Your discovery enters the charts as ${site.name}.`, 'info');
            }
        }
    },

    // ──────────── NAMING ────────────

    /**
     * The discoverer names the place: one of its generated names, or (null)
     * the default. Writes the House chronicle and awards Prestige.
     */
    nameSite(player, world, siteId, name) {
        const site = Discovery.get(player, siteId);
        if (!site || !site.naming) return { success: false, message: 'There is nothing to name.' };
        let chosen = site.nameOptions[0] || site.name;
        if (name != null) {
            const clean = String(name).replace(/[<>"`&]/g, '').trim().slice(0, 40);
            if (!clean) return { success: false, message: 'Choose a name.' };
            chosen = clean;
        }
        site.name = chosen;
        site.naming = null;
        if (site.ruinsAt) {
            const t = world && world.getTile(site.ruinsAt.q, site.ruinsAt.r);
            if (t && t.improvement && t.improvement.discoverySite === site.id) t.improvement.name = `Ruins on ${chosen}`;
        }
        const st = Discovery.state(player);
        st.stats.named++;
        const cfg = Discovery.config();
        const def = Discovery.kind(site.kind);
        if (player.house) {
            House.award(player.house, _num(cfg.prestige[site.kind], 4), 'discovery', _day(world));
            House._chronicle(player.house, world, `${player.name} discovered and named ${chosen}, a ${def.label.toLowerCase()} on no map before.`, ['discovery']);
        }
        Discovery._log(player, world, '✒️', `Named it ${chosen}.`, site.id);
        return { success: true, site, message: `${chosen} enters the charts under your name.` };
    },

    // ──────────── RIVALS ────────────

    /** Rival adventurers find places too — and sell them to a realm's archive. */
    _rivalFinds(player, world, notify) {
        const cfg = Discovery.config();
        const day = _day(world);
        if (day < cfg.rivals.startDay) return;
        const st = Discovery.state(player);
        if (_unit('rivalfind', st.seed, day) >= cfg.rivals.dailyChance) return;
        const open = st.sites.filter(s => !s.discovered);
        const rivals = Rivals.alive(player);
        if (!open.length || !rivals.length) return;
        const site = open[_hash('rivalsite', st.seed, day) % open.length];
        const rival = rivals[_hash('rivalwho', st.seed, day) % rivals.length];
        const def = Discovery.kind(site.kind);
        site.nameOptions = Discovery._nameOptions(site, rival.firstName || String(rival.name).split(' ')[0], Discovery._takenNames(player, site));
        site.name = site.nameOptions[_hash('rivalname', site.id) % site.nameOptions.length];
        site.discovered = { by: rival.id, byName: rival.name, day, how: 'rival' };
        site.known = true;
        for (const g of site.features.goods) site.stock[g] = Math.max(_num(site.stock[g]), Math.ceil(cfg.stock.max / 2));
        Discovery._placeFeatures(world, site);
        rival.renown = _num(rival.renown) + _rollHash(cfg.rivals.renown, 'rivalrenown', site.id);
        // The rival sells the chart to the nearest realm's archive
        const home = rival.home || { q: rival.q, r: rival.r };
        const kId = Discovery._nearestKingdom(world, home.q, home.r);
        if (kId && !site.knownBy.includes(kId)) site.knownBy.push(kId);
        st.stats.rivalFinds++;
        const text = `${rival.name} returns from the ${_dir(world, home.q, home.r, site.q, site.r)} with a chart of ${site.name}, a ${def.label.toLowerCase()} no one knew.`;
        Rivals._news(player, world, rival, '🗺️', text, site.q, site.r);
        Discovery._log(player, world, '🗺️', text, site.id);
        notify('🗺️', site.hint ? 'Beaten to It' : 'A Rival\'s Discovery', text, site.hint ? 'warning' : 'info');
    },

    _nearestKingdom(world, q, r) {
        let best = null;
        let bestD = Infinity;
        for (const s of Discovery._worldCache(world).settlements) {
            if (!s.kingdom) continue;
            const k = world.getKingdom && world.getKingdom(s.kingdom);
            if (!k || !k.isAlive) continue;
            const d = _dist(world, q, r, s.q, s.r);
            if (d < bestD) { bestD = d; best = s.kingdom; }
        }
        return best;
    },

    // ──────────── GOODS ────────────

    _maxStock(site) {
        const c = Discovery.config().stock;
        return site.claim && site.claim.by === 'player' ? c.claimedMax : c.max;
    },

    _tickStock(player, world) {
        const c = Discovery.config().stock;
        const day = _day(world);
        for (const site of Discovery.state(player).sites) {
            if (!site.discovered || !site.features.goods.length) continue;
            const mine = site.claim && site.claim.by === 'player';
            site.regen = _num(site.regen) + 1;
            const every = mine ? c.claimedRegenDays : c.regenDays;
            if (site.regen >= every) {
                site.regen = 0;
                const max = Discovery._maxStock(site);
                for (const g of site.features.goods) site.stock[g] = Math.min(max, _num(site.stock[g]) + 1);
            }
            // Others who know the place take from it, unless it is yours
            if (!mine && (site.knownBy.length || (site.discovered.by !== 'player'))) {
                const takers = Math.max(1, site.knownBy.length);
                if (_unit('skim', site.id, day) < c.skimChance * takers) {
                    for (const g of site.features.goods) site.stock[g] = Math.max(0, _num(site.stock[g]) - 1);
                }
            }
        }
    },

    /** Can the player gather at this place from where they stand? */
    gatherReason(player, world, site) {
        if (!site || !site.known) return 'You do not know where that is.';
        if (!site.features.goods.length) return 'Nothing of value grows or lies here.';
        const day = _day(world);
        if (site.lastGatherDay === day) return 'You have gathered here today.';
        const d = _dist(world, player.q, player.r, site.q, site.r);
        const ship = Discovery._boardedShip(player);
        const atColony = site.claim && site.claim.by === 'player' && site.claim.colony
            && player.q === site.claim.colony.q && player.r === site.claim.colony.r;
        if (!atColony) {
            if (d > 1) return `You must be at ${site.name}.`;
            if (site.kind === 'reef' && !ship) return 'You need a ship to dive the reef.';
            if (site.kind !== 'reef' && ship && !_isLand(world.getTile(player.q, player.r)) && d > 0) return 'Go ashore to gather.';
        }
        const total = site.features.goods.reduce((n, g) => n + _num(site.stock[g]), 0);
        if (total <= 0) return 'Picked clean — come back in a few days.';
        return null;
    },

    /**
     * Gather the exotic goods at a place into the packs (PlayerInventory —
     * the inventory cap applies). Poaching a realm's claim costs reputation.
     */
    gather(player, world, siteId) {
        const site = Discovery.get(player, siteId);
        const why = Discovery.gatherReason(player, world, site);
        if (why) return { success: false, message: why };
        const cfg = Discovery.config();
        const got = {};
        let full = null;
        for (const g of site.features.goods) {
            const n = Math.min(cfg.stock.gatherMax, _num(site.stock[g]));
            if (n <= 0) continue;
            const r = PlayerInventory.addItem(player, g, n);
            if (!r.success) { full = r.reason; continue; }
            site.stock[g] -= n;
            got[g] = n;
        }
        if (!Object.keys(got).length) return { success: false, message: full || 'Nothing to gather.' };
        site.lastGatherDay = _day(world);
        const st = Discovery.state(player);
        st.stats.gathered += Object.values(got).reduce((a, b) => a + b, 0);
        let note = '';
        if (site.claim && site.claim.by !== 'player') {
            const k = world.getKingdom && world.getKingdom(site.claim.by);
            if (k && player.reputation) {
                player.reputation[k.id] = _num(player.reputation[k.id]) - cfg.claim.poachReputation;
                note = ` ${k.name} claims this place — they will not thank you for it.`;
            }
        }
        const text = Object.entries(got).map(([g, n]) => `${n} ${(Discovery.good(g) || { name: g }).name}`).join(', ');
        return { success: true, got, message: `Gathered ${text} at ${site.name}.${note}${full ? ' Some was left behind: your packs are full.' : ''}` };
    },

    // ──────────── HINTS: RUMOURS & MAPS ────────────

    _hint(site, kind, world, q, r, radius) {
        if (site.hint === 'charted' && kind === 'rumoured') return false;
        if (site.hint === kind) return false;
        site.hint = kind;
        site.hintQ = q;
        site.hintR = r;
        site.hintRadius = radius;
        return true;
    },

    /**
     * Tavern notice-board talk of a place nobody has charted, near this town
     * (a hash of the day and town decides, so reading the board draws no RNG).
     * Returns [{ icon, title, text, siteId }].
     */
    tavernRumors(player, world, tile) {
        const out = [];
        if (!player || !world || !tile || !tile.settlement) return out;
        const cfg = Discovery.config();
        const st = Discovery.state(player);
        Discovery.ensureSites(player, world);
        const day = _day(world);
        if (_unit('rumour', st.seed, day, tile.q, tile.r) >= cfg.rumour.chance) return out;
        let best = null;
        let bestD = Infinity;
        for (const s of st.sites) {
            if (s.known || s.hint) continue;
            const d = _dist(world, tile.q, tile.r, s.q, s.r);
            if (d <= cfg.rumour.radius && d < bestD) { best = s; bestD = d; }
        }
        if (!best) return out;
        const b = cfg.rumour.blur;
        const hq = best.q + ((_hash('blurq', best.id, day) % (2 * b + 1)) - b);
        const hr = Math.max(0, Math.min((world.height || 1) - 1, best.r + ((_hash('blurr', best.id, day) % (2 * b + 1)) - b)));
        const wq = world.width ? Hex.wrapQ(hq, world.width) : hq;
        Discovery._hint(best, 'rumoured', world, wq, hr, cfg.rumour.hintRadius);
        const def = Discovery.kind(best.kind);
        const tpl = Discovery.data().rumours || ['Folk in {town} speak of a {kind} to the {dir}.'];
        const text = _fill(tpl[_hash('rumourtpl', best.id) % tpl.length], {
            town: tile.settlement.name, dir: _dir(world, tile.q, tile.r, best.q, best.r),
            kind: def.label.toLowerCase(), leagues: String(Math.round(bestD / 5) * 5 || bestD),
        });
        Discovery._log(player, world, '🗣️', `Rumour in ${tile.settlement.name}: ${text}`, best.id);
        out.push({ icon: def.icon, title: `Uncharted: a ${def.label}`, text: `${text} (Journal → Discoveries)`, siteId: best.id });
        return out;
    },

    /**
     * Reading an ancient or treasure map: a hash of the map's id decides
     * whether it shows one of the uncharted places (decided once per map).
     * Returns { site, text } or null.
     */
    chartFromMap(player, world, map) {
        if (!player || !world || !map || !['ancient', 'treasure'].includes(map.type)) return null;
        const cfg = Discovery.config();
        const st = Discovery.state(player);
        Discovery.ensureSites(player, world);
        if (map.discoverySiteId === undefined) {
            map.discoverySiteId = null;
            if (_unit('map', st.seed, map.id) < _num(cfg.maps[map.type])) {
                const open = st.sites.filter(s => !(s.discovered && s.discovered.by === 'player'));
                const cq = Number.isFinite(map.centerQ) ? map.centerQ : player.q;
                const cr = Number.isFinite(map.centerR) ? map.centerR : player.r;
                open.sort((a, b) => _dist(world, cq, cr, a.q, a.r) - _dist(world, cq, cr, b.q, b.r) || (a.id < b.id ? -1 : 1));
                if (open.length) map.discoverySiteId = open[0].id;
            }
        }
        const site = map.discoverySiteId ? Discovery.get(player, map.discoverySiteId) : null;
        if (!site || (site.discovered && site.discovered.by === 'player')) return null;
        const fresh = Discovery._hint(site, 'charted', world, site.q, site.r, 0);
        if (!fresh) return null;
        const def = Discovery.kind(site.kind);
        const text = `The map marks a ${def.label.toLowerCase()} at (${site.q}, ${site.r}) that is on no other chart${site.discovered ? `, though ${site.discovered.byName} has been there` : ''}.`;
        Discovery._log(player, world, '📜', text, site.id);
        return { site, text };
    },

    // ──────────── THE OCEAN ────────────

    /**
     * The explore-ocean activity: a day's search of the open sea can turn up
     * an uncharted place within reach; otherwise the usual table of events
     * at sea (Ships.exploreOcean).
     */
    exploreOcean(player, shipId, world) {
        const ship = Ships.getShipById(player, shipId);
        if (!ship || !world) return Ships.exploreOcean(player, shipId, world);
        Discovery.ensureSites(player, world);
        const cfg = Discovery.config();
        const E = cfg.exploreOcean;
        const pos = player.boardedShip === ship.id ? { q: player.q, r: player.r } : { q: ship.q, r: ship.r };
        let best = null;
        let bestD = Infinity;
        for (const s of Discovery.state(player).sites) {
            if ((s.discovered && s.discovered.by === 'player') || s.kind === 'valley') continue;
            const d = _dist(world, pos.q, pos.r, s.q, s.r);
            if (d <= E.radius && d < bestD) { best = s; bestD = d; }
        }
        if (best) {
            const p = (E.base + (best.hint ? E.hinted : 0) + E.perLeague * (E.radius - bestD)) * Ships.getExplorationMultiplier(player, ship);
            if (Utils.random() < p) {
                const notices = [];
                Discovery._found(player, world, best, 'exploration', ship, (icon, title, text, type) => notices.push({ icon, title, text, type }));
                ship.condition = Math.max(5, _num(ship.condition, 100) - 1);
                const main = notices.find(n => n.title.startsWith('Discovery')) || notices[0];
                return {
                    success: true, icon: Discovery.kind(best.kind).icon, type: 'success',
                    title: main ? main.text : `You found ${best.name}.`, discovery: best, notices,
                };
            }
        }
        return Ships.exploreOcean(player, shipId, world);
    },

    /**
     * Where an expedition can sail from this ship's berth: rumoured or
     * charted places (to open water near them), and the open sea farthest
     * from every port. [{ id, q, r, name, leagues, siteId }]
     */
    expeditionTargets(player, world, ship) {
        if (!ship || !world) return [];
        Discovery.ensureSites(player, world);
        const cfg = Discovery.config();
        const X = cfg.expedition;
        const nodes = [...Ships._seaSearch(world, ship.q, ship.r).values()]
            .filter(n => n.d > 0 && n.d <= X.maxLeagues && _isWater(world.getTile(n.q, n.r)));
        if (!nodes.length) return [];
        const out = [];
        for (const s of Discovery.state(player).sites) {
            if (s.kind === 'valley' || !s.hint || (s.discovered && s.discovered.by === 'player')) continue;
            const hq = s.hint === 'charted' ? s.q : s.hintQ;
            const hr = s.hint === 'charted' ? s.r : s.hintR;
            let best = null;
            let bestD = Infinity;
            for (const n of nodes) {
                const d = _dist(world, n.q, n.r, hq, hr);
                if (d < bestD || (d === bestD && best && n.d < best.d)) { best = n; bestD = d; }
            }
            if (!best || bestD > 4) continue;
            const label = s.hint === 'charted' ? `the charted ${Discovery.kind(s.kind).label.toLowerCase()}` : `the rumoured ${Discovery.kind(s.kind).label.toLowerCase()}`;
            out.push({ id: `site:${s.id}`, q: best.q, r: best.r, name: label, leagues: best.d, siteId: s.id });
        }
        const ports = Discovery._worldCache(world).ports;
        let open = null;
        let openScore = -1;
        for (const n of nodes) {
            if (n.d < X.openSeaMin) continue;
            const score = Discovery._nearestDist(world, n.q, n.r, ports);
            if (score > openScore || (score === openScore && open && n.d < open.d)) { open = n; openScore = score; }
        }
        if (open) {
            out.push({ id: 'open', q: open.q, r: open.r, name: `open sea to the ${_dir(world, ship.q, ship.r, open.q, open.r)}`, leagues: open.d, siteId: null, portDistance: openScore });
        }
        return out;
    },

    /**
     * Set out on an expedition: a voyage (Ships.startVoyage) that ends out at
     * sea with the player at the helm instead of in a port.
     */
    startExpedition(player, world, shipId, targetId) {
        const ship = Ships.getShipById(player, shipId);
        if (!ship) return { success: false, message: 'Ship not found.' };
        const target = Discovery.expeditionTargets(player, world, ship).find(t => t.id === targetId);
        if (!target) return { success: false, message: 'No sea route to that water from here.' };
        const res = Ships.startVoyage(player, world, shipId, target.q, target.r, target.name);
        if (!res.success) return res;
        ship.voyage.expedition = { target: target.id, siteId: target.siteId };
        return { ...res, target, message: `${ship.name} stands out for ${target.name}: about ${res.days} day${res.days === 1 ? '' : 's'} at sea, ${target.leagues} leagues.` };
    },

    // ──────────── ARCHIVES ────────────

    /** What a realm's archive here would pay for a chart of the place, or { reason }. */
    archiveOffer(player, world, site) {
        if (!site || !site.discovered || site.discovered.by !== 'player') return { reason: 'Only places you found yourself can be sold.' };
        if (site.naming) return { reason: 'Name it first.' };
        const tile = world.getTile(player.q, player.r);
        const s = tile && tile.settlement;
        if (!s || !['town', 'city', 'capital'].includes(s.type) || !s.kingdom) return { reason: 'Sell charts at a royal archive — in a realm\'s town or city.' };
        const k = world.getKingdom && world.getKingdom(s.kingdom);
        if (!k || !k.isAlive) return { reason: 'No archive here.' };
        if (site.knownBy.includes(k.id)) return { reason: `${k.name} already knows of it.` };
        const atlas = KingdomAtlas.ensure(k);
        if (atlas.distrust >= KingdomAtlas.CONFIG.distrustLimit) return { reason: `${k.name}'s archive will not deal with you.` };
        const cfg = Discovery.config().archive;
        const features = site.features.goods.length + (site.features.natives ? 1 : 0) + (site.features.ruins ? 1 : 0);
        let price = _num(cfg.base[site.kind], 150) * (1 + cfg.perFeature * features);
        if (site.knownBy.length) price *= cfg.secondHand;
        price = Math.round(price * (1 - 0.25 * atlas.distrust));
        price = Math.min(price, Math.max(0, Math.floor(_num(k.treasury))));
        if (price <= 0) return { reason: `${k.name}'s treasury is empty.` };
        return { kingdom: k, price };
    },

    /** Sell the chart of a place to the realm's Royal Archive here. */
    sellToArchive(player, world, siteId) {
        const site = Discovery.get(player, siteId);
        const offer = Discovery.archiveOffer(player, world, site);
        if (offer.reason) return { success: false, message: offer.reason };
        const { kingdom: k, price } = offer;
        k.treasury = _num(k.treasury) - price;
        player.gold = _num(player.gold) + price;
        if (player.financeToday) player.financeToday.income.exploration = (player.financeToday.income.exploration || 0) + price;
        if (player.reputation) player.reputation[k.id] = _num(player.reputation[k.id]) + Discovery.config().archive.reputation;
        site.knownBy.push(k.id);
        const st = Discovery.state(player);
        st.stats.sold++;
        Discovery._log(player, world, '📜', `Sold the chart of ${site.name} to the archive of ${k.name} for ${price}g.`, site.id);
        return { success: true, price, kingdom: k, message: `The royal archive of ${k.name} pays ${price}g for your chart of ${site.name}. It is no longer your secret.` };
    },

    // ──────────── SETTLING & CLAIMS ────────────

    /** Can the player found a colony for this place where they stand? */
    colonyReason(player, world, site) {
        if (!site || !site.known) return 'Unknown place.';
        if (site.claim) return site.claim.by === 'player' ? 'Your colony already holds it.' : 'A realm has claimed it.';
        if (Discovery._boardedShip(player)) return 'Go ashore first.';
        const tile = world.getTile(player.q, player.r);
        if (_dist(world, player.q, player.r, site.q, site.r) > 1) return `Stand on ${site.name}.`;
        if (!_isLand(tile)) return 'Stand on dry land.';
        const check = Colonization.canPlayerFoundColony(player, tile, world, player.q, player.r);
        return check.can ? null : check.reason;
    },

    /** Found a colony (Colonization) here: exclusive access, a richer stock. */
    foundColony(player, world, siteId, policyId = 'coexistence') {
        const site = Discovery.get(player, siteId);
        const why = Discovery.colonyReason(player, world, site);
        if (why) return { success: false, message: why };
        const tile = world.getTile(player.q, player.r);
        const res = Colonization.foundPlayerColony(player, tile, world, player.q, player.r, site.name, policyId);
        if (!res.success) return { success: false, message: res.reason };
        Discovery._claimForPlayer(player, world, site, { q: player.q, r: player.r, name: res.name });
        return { success: true, name: res.name, message: `You found the colony of ${res.name}. ${site.name} is yours to work — and to defend.` };
    },

    _claimForPlayer(player, world, site, colony) {
        site.claim = { by: 'player', name: player.name, day: _day(world), colony };
        Discovery.state(player).stats.colonies++;
        Discovery._log(player, world, '🏕️', `Claimed ${site.name} with the colony of ${colony.name}.`, site.id);
    },

    _tickClaims(player, world, notify) {
        const cfg = Discovery.config().claim;
        const day = _day(world);
        for (const site of Discovery.state(player).sites) {
            if (!site.discovered) continue;
            if (site.claim && site.claim.by === 'player') {
                // The claim lasts as long as the colony is yours
                const c = site.claim.colony;
                const t = c && world.getTile(c.q, c.r);
                const col = t && t.settlement && t.settlement.colony;
                if (!col || !col.isPlayerColony) {
                    const k = t && t.settlement && t.settlement.kingdom;
                    site.claim = k ? { by: k, day } : null;
                    site.contest = null;
                    Discovery._log(player, world, '🏚️', `${site.name} is no longer yours.`, site.id);
                    notify('🏚️', 'Claim Lost', `Your claim on ${site.name} has lapsed with its colony.`, 'warning');
                }
                continue;
            }
            // A colony of yours founded near the place claims it
            if (!site.claim || site.claim.by !== 'player') {
                const col = (player.colonies || []).find(c => _dist(world, c.q, c.r, site.q, site.r) <= cfg.colonyRadius);
                const t = col && world.getTile(col.q, col.r);
                if (col && !site.claim && t && t.settlement && t.settlement.colony && t.settlement.colony.isPlayerColony) {
                    Discovery._claimForPlayer(player, world, site, { q: col.q, r: col.r, name: col.name });
                    notify('🏕️', 'Claimed', `${col.name} lays claim to ${site.name}.`, 'success');
                    continue;
                }
            }
            // Realms that know of an unclaimed place may claim it
            if (!site.claim && site.knownBy.length && _unit('kclaim', site.id, day) < cfg.kingdomClaimChance * site.knownBy.length) {
                const kId = site.knownBy[_hash('kclaimwho', site.id, day) % site.knownBy.length];
                const k = world.getKingdom && world.getKingdom(kId);
                if (k && k.isAlive) {
                    site.claim = { by: k.id, name: k.name, day };
                    Discovery._log(player, world, '🚩', `${k.name} has claimed ${site.name}.`, site.id);
                    if (site.discovered.by === 'player') notify('🚩', 'A Realm Claims Your Find', `${k.name} plants its banner on ${site.name}.`, 'warning');
                }
            }
        }
    },

    // ──────────── CONTESTS ────────────

    /** The player's sea power for a contest: ships, galleys, the colony's garrison. */
    _playerFleet(player, world, site) {
        let n = Ships.getSquadronStrength(player);
        for (const ship of player.ships || []) {
            if (ship.status !== 'building') n += Ships._getShipCombatStrength(ship, player);
        }
        const c = site.claim && site.claim.colony;
        const t = c && world.getTile(c.q, c.r);
        const col = t && t.settlement && t.settlement.colony;
        return n + _num(col && col.garrisonStrength);
    },

    _contestFleet(kingdom) {
        const cfg = Discovery.config().contest;
        return Math.max(cfg.minFleet, Math.round(KingdomNavy.effectiveStrength(kingdom) * cfg.fleetShare));
    },

    _tickContests(player, world, notify) {
        const cfg = Discovery.config().contest;
        const day = _day(world);
        for (const site of Discovery.state(player).sites) {
            if (!site.claim || site.claim.by !== 'player') continue;
            if (site.contest) {
                if (day >= site.contest.deadline) Discovery._resolveContest(player, world, site, notify);
                continue;
            }
            if (!site.knownBy.length || _unit('contest', site.id, day) >= cfg.chance * site.knownBy.length) continue;
            const kId = site.knownBy[_hash('contestwho', site.id, day) % site.knownBy.length];
            const k = world.getKingdom && world.getKingdom(kId);
            if (!k || !k.isAlive || kId === player.allegiance) continue;
            site.contest = {
                kingdomId: k.id, kingdomName: k.name, startDay: day, deadline: day + cfg.days,
                tribute: _rollHash(cfg.tribute, 'tribute', site.id, day), fleet: Discovery._contestFleet(k),
            };
            Discovery._log(player, world, '⚔️', `${k.name} contests your claim to ${site.name}.`, site.id);
            notify('⚔️', 'Claim Contested', `${k.name} disputes your claim to ${site.name} and readies ships. Pay ${site.contest.tribute}g in Journal → Discoveries, or meet their fleet (about ${site.contest.fleet} strength) in ${cfg.days} days.`, 'warning');
        }
    },

    /** Pay off a realm's contest for a place. */
    payTribute(player, world, siteId) {
        const site = Discovery.get(player, siteId);
        if (!site || !site.contest) return { success: false, message: 'No one contests that claim.' };
        const c = site.contest;
        if (_num(player.gold) < c.tribute) return { success: false, message: `You need ${c.tribute}g.` };
        player.gold -= c.tribute;
        if (player.financeToday) player.financeToday.expenses.diplomacy = (player.financeToday.expenses.diplomacy || 0) + c.tribute;
        const k = world.getKingdom && world.getKingdom(c.kingdomId);
        if (k) k.treasury = _num(k.treasury) + c.tribute;
        site.knownBy = site.knownBy.filter(id => id !== c.kingdomId);
        site.contest = null;
        Discovery._log(player, world, '💰', `Paid ${c.tribute}g to ${c.kingdomName}; they renounce ${site.name}.`, site.id);
        return { success: true, message: `${c.kingdomName} takes your ${c.tribute}g and renounces its claim to ${site.name}.` };
    },

    _resolveContest(player, world, site, notify) {
        const cfg = Discovery.config().contest;
        const c = site.contest;
        site.contest = null;
        const k = world.getKingdom && world.getKingdom(c.kingdomId);
        if (!k || !k.isAlive) return;
        const mine = Discovery._playerFleet(player, world, site);
        const won = mine * Utils.randFloat(0.8, 1.2) > c.fleet * Utils.randFloat(0.8, 1.2);
        const st = Discovery.state(player);
        if (won) {
            st.stats.contestsWon++;
            player.renown = _num(player.renown) + cfg.winRenown;
            site.knownBy = site.knownBy.filter(id => id !== k.id);
            Discovery._log(player, world, '🛡️', `Drove off ${k.name}'s ships from ${site.name}.`, site.id);
            notify('🛡️', 'Claim Defended', `${k.name}'s ships turn back from ${site.name}. The place stays yours.`, 'success');
            return;
        }
        st.stats.contestsLost++;
        if (player.reputation) player.reputation[k.id] = _num(player.reputation[k.id]) - cfg.loseReputation;
        const col = site.claim.colony;
        const t = col && world.getTile(col.q, col.r);
        if (t && t.settlement && t.settlement.colony) {
            t.settlement.kingdom = k.id;
            t.settlement.colony.isPlayerColony = false;
            t.settlement.colony.motherKingdom = k.id;
            t.settlement.colony.governor = k.ruler || k.name;
            t.kingdom = k.id;
            if (Array.isArray(k.territory) && !k.territory.some(x => x.q === t.q && x.r === t.r)) k.territory.push({ q: t.q, r: t.r });
            player.colonies = (player.colonies || []).filter(x => !(x.q === col.q && x.r === col.r));
            if (typeof world.invalidateSettlements === 'function') world.invalidateSettlements();
        }
        site.claim = { by: k.id, name: k.name, day: _day(world) };
        Discovery._log(player, world, '🏴', `${k.name} took ${site.name}.`, site.id);
        notify('🏴', 'Claim Lost', `${k.name}'s fleet outmatched yours (${mine} against ${c.fleet}). ${col ? col.name : site.name} now flies their banner.`, 'error');
    },

    // ──────────── VIEWS ────────────

    /** Places for the Discoveries log: found (by anyone the player knows of) and hinted. */
    journal(player) {
        const st = Discovery.state(player);
        return {
            known: st.sites.filter(s => s.known),
            hinted: st.sites.filter(s => !s.known && s.hint),
            log: st.log.slice(0, 15),
            stats: st.stats,
            uncharted: st.sites.filter(s => !s.discovered).length,
        };
    },

    /** Markers for the world map. */
    markers(player) {
        const out = [];
        for (const s of Discovery.state(player).sites) {
            if (s.known) out.push({ q: s.q, r: s.r, icon: Discovery.kind(s.kind).icon, name: s.name, claimed: !!s.claim, mine: !!(s.claim && s.claim.by === 'player') });
            else if (s.hint === 'charted') out.push({ q: s.q, r: s.r, icon: '❔', name: 'Charted, unvisited', hint: true });
            else if (s.hint === 'rumoured') out.push({ q: s.hintQ, r: s.hintR, icon: '❔', name: 'Rumoured land', hint: true, radius: s.hintRadius });
        }
        return out;
    },

    /** Problems in data/discovery.json (empty when valid). Used by tests. */
    validate() {
        const problems = [];
        const goods = new Set(Discovery.goods().map(g => g.id));
        for (const g of Discovery.goods()) {
            if (!(g.basePrice > 0)) problems.push(`good ${g.id}: basePrice`);
        }
        for (const [id, k] of Object.entries(Discovery.kinds())) {
            for (const g of k.goods || []) if (!goods.has(g)) problems.push(`kind ${id}: unknown good ${g}`);
            if (!Array.isArray(k.names) || !k.names.length) problems.push(`kind ${id}: no names`);
        }
        return problems;
    },
};
