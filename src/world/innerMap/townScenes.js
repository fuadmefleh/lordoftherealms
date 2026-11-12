// ============================================
// InnerMap — town scenes: workplaces that are worked, scenes that happen
// ============================================
// Over world/innerMap/townLife.js (who goes where each hour) this puts the
// town's people to visible work and play:
//
//   - the square's market stalls are staffed in market hours by real
//     townsfolk (merchants first), standing behind the counter, hawking what
//     the town's market really stocks (world/settlementMarket.js); shoppers
//     stop at a stall, haggle, browse on; the vendors pack up at close;
//   - the church rings its bell before each service (mornings, evenings, and
//     a holy day's high service); a share of the town walks in and sits in
//     the pews, the priest preaches in the words of the town's faith, the
//     congregation says amen and goes home; between services a few pray;
//   - the tavern fills towards evening: the keeper behind the bar, drinkers
//     at the tables, a bard by the hearth of an evening, toasts, dice, and
//     now and then an argument that comes to blows before the keeper breaks
//     it up; some stagger home drunk at night;
//   - the smith hammers at the anvil (out front, or inside), the baker at the
//     oven, a beggar asks alms; a town crier cries the realm's news in the
//     square; folk at the well pass on the news; children shout at play;
//   - at a Dawn of Man camp the eldest tells stories by the fire of an
//     evening, the clan sat round to listen.
//
// Inside a building the player is in, the scene pulls people in from the
// street through the door as the hour wants them (and they walk out again),
// so a service gathers and ends, and the tavern fills, before your eyes.
//
// Every choice is a hash of the town, the day, the hour and the person — the
// shared RNG (Utils.random) is never drawn here. Data: data/townScenes.json.

import { InnerMap } from './_ref.js';
import { DataLoader, SettlementMarket, MarketStalls } from './_imports.js';

const DIRS4 = [[0, 1], [1, 0], [-1, 0], [0, -1]];

function _now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function _obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }
function _arr(v) { return Array.isArray(v) ? v : []; }

/** A hash of the parts (numbers or strings) → [0, 1). */
function _hs(...parts) {
    let h = 2166136261 >>> 0;
    for (const p of parts) {
        const s = String(p);
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
        h ^= 0x9e; h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
}

function _span(range, u) {
    const [a, b] = Array.isArray(range) ? range : [5, 10];
    return a + u * (b - a);
}

function _dirTo(dq, dr) {
    if (Math.abs(dq) >= Math.abs(dr)) return dq >= 0 ? 3 : 1;
    return dr >= 0 ? 2 : 0;
}

function _cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

let _cfg = null;
let _cfgSrc;

Object.assign(InnerMap, {
    /** Town-scene settings (data/townScenes.json), with safe empties for anything missing. */
    townScenesConfig() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.townScenes : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            _cfg = {
                ...d,
                playerRadius: Number(d.playerRadius) || 24,
                market: { open: 7, close: 18, vendorRoles: ['merchant'], hawkEvery: [7, 14], browse: 0.4, stay: {}, stallGoods: {}, goodNames: {}, hawk: {}, haggle: [], packUp: [], ...(_obj(d.market) || {}) },
                church: { types: ['church', 'temple', 'chapel'], services: [], holyDay: null, share: 0.2, bellLead: 0.5, roles: [], sermon: {}, ...(_obj(d.church) || {}) },
                tavern: { types: ['tavern', 'inn'], bard: null, events: {}, ...(_obj(d.tavern) || {}) },
                interiors: _obj(d.interiors) || {},
                tend: _obj(d.tend) || {},
                well: _obj(d.well) || {},
                crier: _obj(d.crier) || null,
                camp: _obj(d.camp) || null,
            };
        }
        return _cfg;
    },

    /** The day's clock as a fraction (8.5 is half past eight). */
    _sceneClock() {
        const h = Number(this.timeOfDay);
        const base = Number.isFinite(h) ? h : 8;
        const scale = this.TIME_SCALE || 60;
        return base + Math.max(0, Math.min(0.999, (Number(this._timeAccumulator) || 0) / scale));
    },

    /** Game seconds till the clock reaches `hour` (0 if past). */
    _sceneSecsTo(hour) {
        return Math.max(0, (hour - this._sceneClock()) * (this.TIME_SCALE || 60));
    },

    _sceneNear(q, r) {
        return Math.max(Math.abs(q - this.playerInnerQ), Math.abs(r - this.playerInnerR)) <= this.townScenesConfig().playerRadius;
    },

    /** A line from a list, chosen by a hash of the town and a running count (no shared RNG). */
    _scenePickLine(list, salt = '') {
        const l = _arr(list);
        if (!l.length) return null;
        const S = this._scn || (this._scn = { seed: 1, n: 0 });
        S.n = (S.n || 0) + 1;
        return l[Math.floor(_hs(S.seed, salt, S.n) * l.length) % l.length];
    },

    _sceneFill(text, vars = {}) {
        if (!text) return text;
        const S = this._scn || {};
        const faith = S.faith || {};
        const all = {
            town: (S.settlement && S.settlement.name) || 'town',
            ruler: S.ruler || 'the lord',
            faith: faith.name || 'the gods',
            tenet: (_arr(faith.tenets)[Math.floor(_hs(S.seed, 'tenet', this.worldDay || 0) * Math.max(1, _arr(faith.tenets).length))]) || 'kindness',
            news: (_arr(S.news)[0]) || 'the roads are quiet',
            ...vars,
        };
        return String(text).replace(/\{(\w+)\}/g, (m, k) => (all[k] != null ? all[k] : m));
    },

    /** Say `text` over an NPC's head, `delay` ms from now, for `secs` seconds. */
    _sceneSay(npc, text, delay = 0, secs = 3.4) {
        if (!npc || !text) return;
        const at = _now() + delay;
        if (delay <= 0) { npc._bark = { text, until: at + secs * 1000 }; return; }
        (this._sceneQueue || (this._sceneQueue = [])).push({ npc, text, at, secs, tiles: this.tiles });
    },

    _sceneFlushSays() {
        const Q = this._sceneQueue;
        if (!Q || !Q.length) return;
        const now = _now();
        for (let i = Q.length - 1; i >= 0; i--) {
            const s = Q[i];
            if (s.tiles !== this.tiles) { Q.splice(i, 1); continue; }
            if (now < s.at) continue;
            s.npc._bark = { text: s.text, until: now + s.secs * 1000 };
            Q.splice(i, 1);
        }
    },

    _sceneSound(kind, q, r, radius = null) {
        if (radius != null ? Math.max(Math.abs(q - this.playerInnerQ), Math.abs(r - this.playerInnerR)) > radius : !this._sceneNear(q, r)) return;
        (this._sceneSounds || (this._sceneSounds = [])).push({ kind, q, r });
    },

    /** A line said over a place (the church's bell over its door). */
    _sceneSpot(q, r, text, secs = 4) {
        (this._spotBarks || (this._spotBarks = [])).push({ q, r, text, until: _now() + secs * 1000, tiles: this.tiles });
    },

    // ──────────── SETTLING IN ────────────

    /**
     * On entering a town: its stalls and who keeps them, the crier, its faith,
     * its ruler and its news; vendors at their stalls and the faithful in
     * church if the hour has them there already.
     */
    _settleTownScenes(settlement, world) {
        const wt = this.currentWorldTile || { q: 0, r: 0 };
        const wseed = (world && world.generationParams && world.generationParams.seed) || 0;
        const S = this._scn = {
            seed: Math.floor(_hs('town', wt.q, wt.r, wseed) * 1e9), n: 0, acc: 0, tiles: this.tiles, settlement,
            stalls: [], crierId: null, faith: null, ruler: null, news: [], goods: {}, bellKey: null,
        };
        this._sceneQueue = [];
        this._spotBarks = [];
        this._scnIn = null;
        // Each stall its trade, its goods on the counter (world/innerMap/stalls.js, world/marketStalls.js)
        const trades = this._dressStalls ? this._dressStalls(settlement, world) : {};
        const A = this.townArea();
        if (!A || !settlement) return;
        const C = this.townScenesConfig();
        const kingdom = world && world.getKingdom && settlement.kingdom != null ? world.getKingdom(settlement.kingdom) : null;
        // The faith (the realm's, the town's own if it keeps one)
        const faiths = ((DataLoader._gamedata || {}).religion || {}).faiths || {};
        const fid = (settlement.religion && settlement.religion.faithId) || (kingdom && kingdom.religion && kingdom.religion.faithId) || null;
        const fdef = fid && faiths[fid];
        S.faith = fdef ? { id: fid, name: fdef.name, tenets: fdef.tenets || [] }
            : (kingdom && kingdom.religion && kingdom.religion.name ? { id: null, name: kingdom.religion.name, tenets: [] } : null);
        S.ruler = (kingdom && (typeof kingdom.ruler === 'string' ? kingdom.ruler : kingdom.ruler && kingdom.ruler.name)) || (kingdom && kingdom.name) || null;
        S.news = this._sceneNews(settlement, world, kingdom);
        // What the market really has, by the kind of stall (its stock laid in, as the trade panel would)
        SettlementMarket.ensure(settlement);
        for (const [role, ids] of Object.entries(C.market.stallGoods || {})) {
            S.goods[role] = _arr(ids).filter(id => SettlementMarket.tracks(id) && SettlementMarket.stock(settlement, id) >= 1);
        }
        // The stalls and their vendors
        for (const row of this.tiles) {
            for (const t of row) {
                if (!t || !t.customObject || t.customObject.defId !== 'tp_stall' || t._isInterior) continue;
                // (under the stall's own awning: its walk-over rows)
                const behind = { q: t.q + 1, r: t.r - 2 };
                const bt = this.tiles[behind.r] && this.tiles[behind.r][behind.q];
                if (!(bt && bt.subTerrain && bt.subTerrain.passable && !bt.customObject && !bt.isWater)) continue;
                const front = [0, 1, 2].map(d => ({ q: t.q + d, r: t.r + 1 })).filter(s => this._scenePassable(s.q, s.r));
                S.stalls.push({ q: t.q, r: t.r, behind, front, vendorId: null, trade: trades[`o:${t.q},${t.r}`] || null });
            }
        }
        const owners = new Set((this.buildings || []).filter(b => b && b.type !== 'house' && b.ownerId != null).map(b => b.ownerId));
        const roles = _arr(C.market.vendorRoles);
        const vendors = (this.npcs || []).filter(n => roles.includes(n.type) && !owners.has(n.id) && !(n.age != null && n.age < 16))
            .sort((a, b) => (roles.indexOf(a.type) - roles.indexOf(b.type)) || (_hs(S.seed, 'vend', a.uid || a.id) - _hs(S.seed, 'vend', b.uid || b.id)));
        S.stalls.forEach((st, i) => {
            const v = vendors[i];
            if (!v) return;
            st.vendorId = v.id;
            v._stall = st;
        });
        // The crier
        if (C.crier) {
            const cr = _arr(C.crier.roles);
            const pool = (this.npcs || []).filter(n => cr.includes(n.type) && !n._stall && !owners.has(n.id) && !(n.age != null && n.age < 18))
                .sort((a, b) => _hs(S.seed, 'crier', a.uid || a.id) - _hs(S.seed, 'crier', b.uid || b.id));
            if (pool.length) { S.crierId = pool[0].id; pool[0]._crier = true; }
        }
        this._scenePlaceAtStart();
    },

    /** The news a crier cries and folk at the well pass on: the realm's events, its wars, dear goods. */
    _sceneNews(settlement, world, kingdom) {
        const C = this.townScenesConfig();
        const out = [];
        const evs = _arr(world && world.activeEvents);
        const mine = evs.filter(e => e && kingdom && e.kingdomId === kingdom.id);
        for (const e of [...mine, ...evs.filter(e => !mine.includes(e))].slice(0, 3)) {
            const t = e && (e.text || e.name);
            if (t) out.push(String(t).replace(/\s+/g, ' ').slice(0, 90));
        }
        if (kingdom && Array.isArray(kingdom.wars) && kingdom.wars.length && world.getKingdom && C.crier) {
            const foe = world.getKingdom(kingdom.wars[0]);
            const line = this._scenePickLine(C.crier.war, 'war');
            if (foe && line) out.push(line.replace('{kingdom}', kingdom.name).replace('{other}', foe.name));
        }
        if (C.crier && settlement && settlement.market) {
            for (const id of ['bread', 'grain', 'salt', 'firewood', 'beer']) {
                if (!SettlementMarket.tracks(id)) continue;
                const tgt = SettlementMarket.target(settlement, id);
                if (tgt > 0 && SettlementMarket.stock(settlement, id) < tgt * 0.3) {
                    const line = this._scenePickLine(C.crier.dear, 'dear');
                    if (line) out.push(line.replace('{good}', _cap(this._sceneGoodName(id))));
                    break;
                }
            }
        }
        return out;
    },

    _sceneGoodName(id) {
        const names = this.townScenesConfig().market.goodNames || {};
        return names[id] || String(id).replace(/_/g, ' ');
    },

    _scenePassable(q, r) {
        const t = this.tiles[r] && this.tiles[r][q];
        return !!(t && t.subTerrain && t.subTerrain.passable && !t.customObject && !t.customObjectPart && !t.isWater);
    },

    /** Where the hour finds the stalls' keepers and the faithful on arrival. */
    _scenePlaceAtStart() {
        const S = this._scn;
        const h = this._sceneClock();
        if (this._sceneMarketOpen(h)) {
            for (const st of S.stalls) {
                const v = (this.npcs || []).find(n => n.id === st.vendorId);
                if (!v || v.state === 'inside_building') continue;
                v.q = v.prevQ = v.targetQ = st.behind.q;
                v.r = v.prevR = v.targetR = st.behind.r;
                v.path = null;
                v.state = 'idle';
                this._sceneArrived(v, 'vend');
            }
        }
        const sv = this.serviceAt(h, this.worldDay || 0);
        const church = sv && this._sceneChurch();
        if (church) {
            const door = this._findPassableAdjacentTile(church.q, church.r);
            for (const n of this.npcs || []) {
                if (n.type !== 'priest' && !this._sceneAttends(n, sv)) continue;
                n.path = null;
                n.q = n.prevQ = door.q; n.r = n.prevR = door.r;
                n.state = 'inside_building';
                n.currentBuilding = church.type;
                n._insideBuildingQ = church.q; n._insideBuildingR = church.r;
                n._outsideQ = door.q; n._outsideR = door.r;
                n.idleTimer = this._sceneSecsTo(sv.end) + 2;
            }
        }
    },

    // ──────────── THE HOURS ────────────

    _sceneMarketOpen(h = this._sceneClock()) {
        const M = this.townScenesConfig().market;
        return h >= M.open && h < M.close;
    },

    /** Is `day` a holy day (the week's high service)? */
    isHolyDay(day = this.worldDay || 0) {
        const H = this.townScenesConfig().church.holyDay;
        if (!H || !(H.every > 0)) return false;
        return ((Math.floor(day) - (H.offset || 0)) % H.every + H.every) % H.every === 0;
    },

    /**
     * The service under way at `hour` (or about to begin: within the bell's
     * lead, `lead` true), as { idx, start, end, holy, share, phase 0..1 }, or null.
     */
    serviceAt(hour = this._sceneClock(), day = this.worldDay || 0, withLead = true) {
        const C = this.townScenesConfig().church;
        const holy = this.isHolyDay(day);
        const list = [..._arr(C.services)];
        if (holy && C.holyDay && C.holyDay.extra) list.push(C.holyDay.extra);
        const lead = withLead ? Number(C.bellLead) || 0 : 0;
        for (let i = 0; i < list.length; i++) {
            const s = list[i];
            if (hour >= s.start - lead && hour < s.end) {
                return {
                    idx: i, start: s.start, end: s.end, holy,
                    share: holy && C.holyDay ? Number(C.holyDay.share) || 0 : Number(C.share) || 0,
                    phase: Math.max(0, (hour - s.start) / Math.max(0.1, s.end - s.start)),
                    begun: hour >= s.start,
                };
            }
        }
        return null;
    },

    /** Does this person go to this service (a hash of the town, the day, the service and them)? */
    _sceneAttends(npc, sv) {
        const C = this.townScenesConfig().church;
        if (!npc || !sv || npc.departing || npc._doorPost) return false;
        // (who goes is their devotion and faith, where they're townsfolk: world/innerMap/townWork.js)
        const own = this._worshipAttends ? this._worshipAttends(npc, sv) : null;
        if (own != null) return own && !(npc._stall && this._sceneMarketOpen());
        if (!_arr(C.roles).includes(npc.type)) return false;
        if (npc._stall && this._sceneMarketOpen()) return false;
        const S = this._scn || { seed: 1 };
        return _hs(S.seed, 'svc', this.worldDay || 0, sv.idx, npc.uid || npc.id) < sv.share;
    },

    _sceneChurch() {
        const types = this.townScenesConfig().church.types;
        const A = this.townArea();
        const list = this._townBuildings().filter(b => types.includes(b.type));
        if (!list.length) return null;
        return A ? list.sort((a, b) => Math.hypot(a.q - A.center.q, a.r - A.center.r) - Math.hypot(b.q - A.center.q, b.r - A.center.r))[0] : list[0];
    },

    // ──────────── WHAT THEY DO NEXT (from townLife._townPickActivity) ────────────

    /** Put down what a scene had them doing. */
    _sceneClear(npc) {
        if (!npc) return;
        npc._vending = null;
        npc._behindCounter = null;
        npc._swing = null;
        npc._pose = null;
        npc._shopAt = null;
        if (npc.activity && npc.activity._scene) npc.activity = null;
        if (npc._drunk) {
            if (npc._drunk.speed) npc.speed = npc._drunk.speed;
            npc._drunk = null;
        }
    },

    /** A scene's claim on what they do next; true when it set them going. */
    _scenePick(npc, period) {
        const S = this._scn;
        if (!S || S.tiles !== this.tiles || !this.townArea() || npc.type === 'guard') { if (npc) npc._lastVenue = null; return false; }
        const C = this.townScenesConfig();
        const h = this._sceneClock();
        const day = this.worldDay || 0;
        // Out of the tavern late: some stagger home
        const venue = npc._lastVenue;
        npc._lastVenue = null;
        const T = C.tavern;
        if (venue && _arr(T.types).includes(venue) && h >= (Number(T.drunkAfter) || 20) && npc.type !== 'child'
            && _hs(S.seed, 'drunk', day, Math.floor(h), npc.uid || npc.id) < (Number(T.drunkShare) || 0)) {
            if (npc._home && this._sceneGoInto(npc, npc._home, 'sleep', 60 + _hs(S.seed, 'zz', npc.id, day) * 60)) {
                npc._drunk = { speed: npc.speed, next: 2 };
                npc.speed = (npc.speed || 1) * 0.6;
                if (this._sceneNear(npc.q, npc.r)) this._sceneSay(npc, this._scenePickLine(T.drunk, 'drunk'));
                return true;
            }
        }
        // The crier's round
        const CR = C.crier;
        if (CR && npc._crier && h >= CR.hours[0] && h < CR.hours[1]) {
            const every = Math.max(1, Number(CR.everyHours) || 2);
            const slot = Math.floor((h - CR.hours[0]) / every);
            const key = `${day}:${slot}`;
            if (npc._criedSlot !== key && h - (CR.hours[0] + slot * every) < 1) {
                npc._criedSlot = key;
                const A = this.townArea();
                const spot = this.townSpot(() => _hs(S.seed, 'cry', key), A.center, 2);
                if (spot && this._goStand(npc, spot, 'cry', 2)) return true;
            }
        }
        // The bell: to church
        const sv = this.serviceAt(h, day);
        if (sv) {
            const church = this._sceneChurch();
            if (church && (npc.type === 'priest' || this._sceneAttends(npc, sv))) {
                if (this._sceneGoInto(npc, church, 'church', this._sceneSecsTo(sv.end) + 2)) return true;
            }
        }
        // A vendor to their stall
        if (npc._stall && this._sceneMarketOpen(h) && period !== 'night') {
            if (this._goStand(npc, npc._stall.behind, 'vend', 2)) return true;
        }
        // Browsing on to another stall
        if (npc._shopLeft > 0 && this._sceneMarketOpen(h)) {
            npc._shopLeft--;
            if (this._goShopStall(npc)) return true;
        }
        npc._shopLeft = 0;
        return false;
    },

    /** Walk to a building and go in for `secs` (townLife's _goInto, without its RNG draw). */
    _sceneGoInto(npc, bldg, act, secs) {
        const door = this._findPassableAdjacentTile(bldg.q, bldg.r);
        if (npc.q === door.q && npc.r === door.r) {
            this._townDelivered(npc, bldg);
            npc.path = null;
            npc.state = 'inside_building';
            npc.currentBuilding = bldg.type;
            npc._insideBuildingQ = bldg.q; npc._insideBuildingR = bldg.r;
            npc._outsideQ = npc.q; npc._outsideR = npc.r;
            npc._activity = act;
            npc.idleTimer = secs;
            return true;
        }
        if (!this._walkTo(npc, door)) return false;
        npc._targetBuilding = bldg;
        npc._activity = act;
        npc._stayFor = secs;
        return true;
    },

    /** A shopper to a staffed stall's front, to haggle. */
    _goShopStall(npc) {
        const S = this._scn;
        if (!S || !S.stalls.length || !this._sceneMarketOpen()) return false;
        const staffed = S.stalls.filter(st => (this.npcs || []).some(v => v.id === st.vendorId && v._vending === st) && st.front.length);
        if (!staffed.length) return false;
        const u = _hs(S.seed, 'shop', this.worldDay || 0, npc.uid || npc.id, S.n = (S.n || 0) + 1);
        const st = staffed.find(s => s !== npc._shopAt && npc._lastStall !== s) || staffed[Math.floor(u * staffed.length) % staffed.length];
        const free = st.front.filter(s => !(this.npcs || []).some(o => o !== npc && o.q === s.q && o.r === s.r));
        const spot = (free.length ? free : st.front)[Math.floor(u * 7) % (free.length || st.front.length)];
        if (npc._shopLeft == null || npc._shopLeft <= 0) npc._shopLeft = _hs(S.seed, 'browse', npc.uid || npc.id, this.worldDay || 0) < this.townScenesConfig().market.browse ? 1 : 0;
        npc._lastStall = st;
        if (!this._goStand(npc, spot, 'shop', 0)) return false;
        npc._shopAt = st;
        return true;
    },

    /** A tradesperson's place out front: at their prop (the smith's anvil), else their door. */
    _tendSpot(npc) {
        const b = npc && npc._work;
        const T = b && this.townScenesConfig().tend[b.type];
        if (!T || !T.prop) return null;
        // (no anvil out front: the smith works within — heard from the street)
        const none = { inside: true };
        const door = this._findPassableAdjacentTile(b.q, b.r);
        const reach = Number(T.reach) || 6;
        let best = null;
        for (let r = door.r - reach; r <= door.r + reach; r++) {
            for (let q = door.q - reach; q <= door.q + reach; q++) {
                const t = this.tiles[r] && this.tiles[r][q];
                if (!t || !t.customObject || t.customObject.defId !== T.prop) continue;
                for (const key of this._footprintAt(q, r)) {
                    const [fq, fr] = key.split(',').map(Number);
                    for (const [dq, dr] of DIRS4) {
                        const sq = fq + dq, sr = fr + dr;
                        if (!this._scenePassable(sq, sr)) continue;
                        const d = Math.hypot(sq - door.q, sr - door.r);
                        if (!best || d < best.d) best = { d, spot: { q: sq, r: sr }, face: _dirTo(fq - sq, fr - sr) };
                    }
                }
            }
        }
        return best || none;
    },

    /** Arrived at a scene's business in the street (from townLife._npcArrivedInTown). */
    _sceneArrived(npc, act) {
        const S = this._scn;
        if (!S) return;
        const C = this.townScenesConfig();
        const near = this._sceneNear(npc.q, npc.r);
        const u = _hs(S.seed, act, npc.uid || npc.id, S.n = (S.n || 0) + 1);
        switch (act) {
            case 'vend': {
                const st = npc._stall;
                if (!st || npc.q !== st.behind.q || npc.r !== st.behind.r) return;
                npc._vending = st;
                npc._behindCounter = { row: st.r };
                npc.facing = 2;
                npc.activity = { type: 'vend', icon: '💰', label: 'Minding the stall', anim: 'idle', _scene: true };
                npc.idleTimer = Math.min(_span(C.market.stay.vend || [40, 70], u), this._sceneSecsTo(C.market.close) + 1);
                npc._hawkIn = 1 + u * 4;
                return;
            }
            case 'shop': {
                const st = npc._shopAt;
                npc.activity = { type: 'shop', icon: '🛒', label: 'Shopping', anim: 'idle', _scene: true };
                npc.idleTimer = _span(C.market.stay.shop || [8, 16], u);
                const v = st && (this.npcs || []).find(n => n.id === st.vendorId && n._vending === st);
                if (v && near) {
                    const pair = this._scenePickLine(C.market.haggle, 'haggle');
                    const good = this._sceneGoodName(this._scenePickLine(this._sceneStallGoods(v), 'g') || 'wares');
                    if (pair) {
                        this._sceneSay(npc, this._sceneFill(pair[0], { good, name: v.name }));
                        this._sceneSay(v, this._sceneFill(pair[1], { good, name: npc.name }), 2400);
                    }
                }
                return;
            }
            case 'cry': {
                if (!C.crier) return;
                npc.activity = { type: 'cry', icon: '📜', label: 'Crying the news', anim: 'emotes', _scene: true };
                npc.facing = 2;
                npc.idleTimer = _span(C.crier.stay || [24, 34], u);
                if (!near) return;
                const news = S.news.length ? S.news : _arr(C.crier.fallback).map(l => this._sceneFill(l));
                const lines = [this._scenePickLine(C.crier.open, 'cry'), ...news.slice(0, 2), this._scenePickLine(C.crier.close, 'cry')];
                lines.forEach((l, i) => l && this._sceneSay(npc, this._sceneFill(l), i * 4200, 4));
                return;
            }
            case 'tend': {
                const T = npc.type === 'beggar' ? C.tend.beggar : (npc._work && C.tend[npc._work.type]);
                if (!T || !T.activity) return;
                npc.activity = { type: 'tend', ...T.activity, _scene: true };
                if (T.activity.pose != null) npc._pose = T.activity.pose;
                if (T.activity.tool) npc._swing = { tool: T.activity.tool, interval: Number(T.activity.swing) || 0.9, t: u, sound: T.activity.sound || null };
                if (near && T.barks && u < 0.5) this._sceneSay(npc, this._scenePickLine(T.barks, 'tend'), 600);
                return;
            }
            case 'well': {
                const W = C.well;
                if (W.activity) npc.activity = { type: 'well', ...W.activity, _scene: true };
                if (!near) return;
                const other = (this.npcs || []).find(o => o !== npc && o.state === 'idle' && o.activity && o.activity.type === 'well'
                    && Math.max(Math.abs(o.q - npc.q), Math.abs(o.r - npc.r)) <= 3);
                if (other && u < 0.7) {
                    this._sceneSay(npc, this._sceneFill(this._scenePickLine(W.lines, 'well')));
                    this._sceneSay(other, this._sceneFill(this._scenePickLine(['Is that so?', 'Never!', 'Well I never.', 'So I heard.'], 'well2')), 2600);
                }
                return;
            }
            case 'play':
                if (near && u < 0.18) this._sceneSay(npc, this._scenePickLine(C.play, 'play'), 0, 2.2);
                return;
            default:
        }
    },

    // ──────────── EACH FRAME (from updateNPCs) ────────────

    _updateTownScenes(dt) {
        this._sceneFlushSays();
        if (this._spotBarks && this._spotBarks.length) {
            const now = _now();
            this._spotBarks = this._spotBarks.filter(b => b.until > now);
        }
        if (this._insideBuilding) { this._sceneInteriorTick(dt); return; }
        const S = this._scn;
        if (!S || S.tiles !== this.tiles) return;
        // The swings of hammers at the anvil, heard near enough
        for (const npc of this.npcs) {
            const sw = npc._swing;
            if (!sw || npc.state !== 'idle' || !npc.activity) continue;
            sw.t += dt;
            if (sw.t >= sw.interval) {
                sw.t -= sw.interval;
                if (sw.sound) this._sceneSound(sw.sound, npc.q, npc.r);
            }
        }
        S.acc += dt;
        if (S.acc < 0.5) return;
        const step = S.acc;
        S.acc = 0;
        const C = this.townScenesConfig();
        const h = this._sceneClock();
        // The church bell
        const sv = this.serviceAt(h, this.worldDay || 0);
        const key = sv ? `${this.worldDay || 0}:${sv.idx}` : null;
        if (key && key !== S.bellKey) {
            S.bellKey = key;
            const church = this._sceneChurch();
            if (church) {
                const door = this._findPassableAdjacentTile(church.q, church.r);
                if (this._sceneNear(door.q, door.r)) {
                    this._sceneSpot(church.q, church.r, this._scenePickLine(C.church.bell, 'bell') || '🔔', 5);
                    this._sceneSound('bell', door.q, door.r);
                }
            }
        }
        for (const npc of this.npcs) {
            // At work within: the smith's hammer heard from the street
            if (npc.state === 'inside_building') {
                const K = this._sceneKindOf(npc.currentBuilding);
                const A = K && K.K.staffActivity;
                if (A && A.sound && _arr(K.K.staffRoles).includes(npc.type) && this._sceneOnDuty({ K: K.K }, h)) {
                    npc._clang = (npc._clang || 0) + step;
                    if (npc._clang >= (Number(A.swing) || 0.9) * 2) {
                        npc._clang = 0;
                        this._sceneSound(A.sound, npc._insideBuildingQ, npc._insideBuildingR, 12);
                    }
                }
                continue;
            }
            if (npc._dialogFrozen) continue;
            // Vendors: hawking, and packing up at the close
            if (npc._vending) {
                if (npc.state !== 'idle' || npc.q !== npc._vending.behind.q || npc.r !== npc._vending.behind.r) { this._sceneClear(npc); continue; }
                if (!this._sceneMarketOpen(h)) {
                    if (this._sceneNear(npc.q, npc.r)) this._sceneSay(npc, this._scenePickLine(C.market.packUp, 'pack'));
                    this._sceneClear(npc);
                    npc.idleTimer = Math.min(npc.idleTimer, 1.5);
                    continue;
                }
                npc._hawkIn = (npc._hawkIn || 0) - step;
                if (npc._hawkIn <= 0) {
                    npc._hawkIn = _span(C.market.hawkEvery, _hs(S.seed, 'hawk', npc.id, S.n = (S.n || 0) + 1));
                    if (this._sceneNear(npc.q, npc.r) && !(npc._bark && npc._bark.until > _now())) this._sceneSay(npc, this._sceneHawk(npc));
                }
            }
            // The drunk on the way home
            if (npc._drunk && npc.state === 'walking') {
                npc._drunk.next -= step;
                if (npc._drunk.next <= 0) {
                    npc._drunk.next = 4 + _hs(S.seed, 'hic', npc.id, S.n = (S.n || 0) + 1) * 5;
                    if (this._sceneNear(npc.q, npc.r)) this._sceneSay(npc, this._scenePickLine(C.tavern.drunk, 'hic'), 0, 3.2);
                }
            }
        }
    },

    /** A vendor's cry, of what their stall really has. */
    _sceneHawk(npc) {
        const C = this.townScenesConfig().market;
        const S = this._scn;
        const goods = this._sceneStallGoods(npc);
        // A trader cries their own trade (data/marketStalls.json cries), now and then the general cries
        const trade = npc._stall && npc._stall.trade;
        const u = _hs(S.seed, 'cry', npc.id, S.n = (S.n || 0) + 1);
        if (trade && (u < 0.65 || !goods.length)) {
            const gid = goods.length ? goods[Math.floor(_hs(S.seed, 'cryg', npc.id, S.n) * goods.length) % goods.length] : null;
            const town = S.settlement && S.settlement.name;
            const line = MarketStalls.cry(trade, _hs(S.seed, 'cryl', npc.id, S.n), gid ? this._sceneGoodName(gid) : null, town);
            if (line) return line;
        }
        if (!goods.length) return this._sceneFill(this._scenePickLine(C.hawk.none, 'hawk'));
        const id = this._scenePickLine(goods, 'hg');
        const grp = (SettlementMarket.good(id) || {}).group;
        const pool = [..._arr(C.hawk[grp]), ..._arr(C.hawk.any)];
        return _cap(this._sceneFill(this._scenePickLine(pool, 'hawk'), { good: this._sceneGoodName(id) }));
    },

    /** What a vendor's stall has to sell today: its trade's wares in stock, else the old wares of their kind. */
    _sceneStallGoods(npc) {
        const S = this._scn || {};
        const trade = npc && npc._stall && npc._stall.trade;
        if (trade && this.stallWares) return this.stallWares(trade);
        return (S.goods && S.goods[npc && npc.type]) || [];
    },

    // ──────────── INSIDE ────────────

    /** The scene kind of a building type: { key, K } from interiors, or null. */
    _sceneKindOf(type) {
        const I = this.townScenesConfig().interiors;
        const t = String(type || '').replace(/^player_/, '');
        for (const [key, K] of Object.entries(I)) if (_arr(K.types).includes(t)) return { key, K };
        return null;
    },

    _sceneFloorOk(q, r) {
        const t = this.tiles[r] && this.tiles[r][q];
        return !!(t && t.subTerrain && t.subTerrain.passable && !t._isDoor && !t._stairs && !(t._furniture && !t._furniture.passable));
    },

    /** The interior's stations (for the staff), seats (for the patrons) and the bard's stage. */
    _sceneInteriorSetup(b, kind) {
        const { K } = kind;
        const spots = this.getFurnitureSpots();
        const taken = new Set();
        const key = (q, r) => `${q},${r}`;
        const stations = [];
        for (const f of spots.filter(s => _arr(K.staffAt).includes(s.type))) {
            // (behind a counter; beside an anvil or oven from the side, where the work is seen)
            const order = K.staffSide === 'behind' ? [[0, -1], [0, 1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]];
            for (const [dq, dr] of order) {
                const q = f.q + dq, r = f.r + dr;
                if (!this._sceneFloorOk(q, r) || taken.has(key(q, r))) continue;
                taken.add(key(q, r));
                stations.push({ q, r, face: _dirTo(f.q - q, f.r - r), type: f.type });
                break;
            }
        }
        // (behind the bar first: the altar before the lectern)
        stations.sort((a, b) => (_arr(K.staffAt).indexOf(a.type) - _arr(K.staffAt).indexOf(b.type)) || ((a.face === 2 ? 0 : 1) - (b.face === 2 ? 0 : 1)));
        const seats = [];
        for (const f of spots.filter(s => _arr(K.seatsAt).includes(s.type))) {
            const add = (q, r, face, on = null) => {
                if (taken.has(key(q, r))) return;
                if (!on && !this._sceneFloorOk(q, r)) return;
                taken.add(key(q, r));
                seats.push({ q, r, face, on, at: f.type, fq: f.q, fr: f.r });
            };
            if (K.seatSide === 'row') {
                const face = Number.isFinite(K.face) ? K.face : 0;
                const via = [[0, 1], [-1, 0], [1, 0], [0, -1]].map(([dq, dr]) => ({ q: f.q + dq, r: f.r + dr })).find(s => this._sceneFloorOk(s.q, s.r));
                add(f.q - 1, f.r, face);
                if (K.seatOn && via) add(f.q, f.r, face, via);
                add(f.q + 1, f.r, face);
            } else if (K.seatSide === 'front') {
                add(f.q, f.r + 1, 0);
            } else {
                // (sat either side of a table; at its ends they stand to drink)
                for (const [dq, dr] of DIRS4) {
                    add(f.q + dq, f.r + dr, _dirTo(-dq, -dr));
                    const last = seats[seats.length - 1];
                    if (last && last.q === f.q + dq && last.r === f.r + dr && dr !== 0 && K.seatSide === 'around') last.stand = true;
                }
            }
        }
        let stage = null;
        for (const f of spots.filter(s => _arr(K.stage).includes(s.type))) {
            for (const [dq, dr] of [[0, 1], [-1, 1], [1, 1], [0, 2]]) {
                const q = f.q + dq, r = f.r + dr;
                if (this._sceneFloorOk(q, r) && !taken.has(key(q, r))) { stage = { q, r, face: 2 }; break; }
            }
            if (stage) break;
        }
        const door = this._doorTile() || { q: Math.floor(this.width / 2), r: this.height - 1 };
        return { tiles: this.tiles, b, kind: kind.key, K, stations, seats, stage, door, acc: 0, arriveIn: 0, eventIn: 4, svcKey: null, said: {} };
    },

    /** The building's door on the street (where those who come in came from). */
    _sceneOuterDoor(b) {
        const T = this._outerMapState && this._outerMapState.tiles;
        if (!T) return { q: b.q, r: b.r + 1 };
        for (const [dq, dr] of [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
            const t = T[b.r + dr] && T[b.r + dr][b.q + dq];
            if (t && t.subTerrain && t.subTerrain.passable) return { q: b.q + dq, r: b.r + dr };
        }
        return { q: b.q, r: b.r };
    },

    _sceneIsStaff(n, I) {
        const b = I.b;
        if (b.ownerId != null && b.ownerId === n.id && !b.isPlayerOwned) return true;
        if (n._work && n._work.q === b.q && n._work.r === b.r) return true;
        return false;
    },

    _sceneOnDuty(I, h) {
        const hrs = I.K.hours;
        return !Array.isArray(hrs) || (h >= hrs[0] && h < hrs[1]);
    },

    /** How many patrons the hour wants in here. */
    sceneCrowd(kindKey, h = this._sceneClock(), day = this.worldDay || 0) {
        const C = this.townScenesConfig();
        const K = C.interiors[kindKey];
        if (!K) return 0;
        if (kindKey === 'church') {
            const sv = this.serviceAt(h, day, false);
            if (!sv) return Number(K.between) || 0;
            const outer = (this._outerMapState && this._outerMapState.npcs) || this.npcs || [];
            return outer.filter(n => this._sceneAttends(n, sv)).length;
        }
        const row = _arr(K.crowdByHour);
        return Number(row[Math.floor(((h % 24) + 24) % 24)]) || 0;
    },

    /** One frame inside: who's needed, who comes in, what happens. */
    _sceneInteriorTick(dt) {
        const b = this._insideBuilding;
        if (!b || this._floor) return;
        let I = this._scnIn;
        let first = false;
        if (!I || I.tiles !== this.tiles) {
            const kind = this._sceneKindOf(b.type);
            if (!kind) { this._scnIn = null; return; }
            I = this._scnIn = this._sceneInteriorSetup(b, kind);
            first = true;
        }
        // Swings at the anvil
        for (const npc of this.npcs) {
            const sw = npc._swing;
            if (!sw || !npc._scene || npc._scene.phase !== 'at') continue;
            sw.t += dt;
            if (sw.t >= sw.interval) { sw.t -= sw.interval; if (sw.sound) this._sceneSound(sw.sound, npc.q, npc.r); }
        }
        I.acc += dt;
        if (!first && I.acc < 0.5) return;
        const step = first ? 0 : I.acc;
        I.acc = 0;
        this._sceneCast(I, first, step);
        if (I.kind === 'church') this._sceneService(I, step);
        else if (I.kind === 'tavern') this._sceneTavern(I, step);
    },

    /** Staff to their stations, patrons in to the seats the hour wants filled. */
    _sceneCast(I, first, step) {
        const S = this._scn || (this._scn = { seed: 1, n: 0 });
        const C = this.townScenesConfig();
        const h = this._sceneClock();
        const day = this.worldDay || 0;
        const outer = (this._outerMapState && this._outerMapState.npcs) || [];
        // The staff (the priest is the church's staff wherever their work is written)
        const isStaff = n => this._sceneIsStaff(n, I) || (_arr(I.K.staffRoles).includes(n.type) && n.type === 'priest' && I.kind === 'church');
        const duty = this._sceneOnDuty(I, h);
        if (duty && I.stations.length && !this.npcs.some(n => n._scene && n._scene.role === 'staff')) {
            const here = this.npcs.find(n => !n._scene && !n._asleep && isStaff(n));
            // The keeper: from the street, or called in from another house (not from their bed);
            // failing them, a hand from the town minds the bar or the stall
            const callable = n => !this.npcs.includes(n) && (this._sceneFree(n) || (n.state === 'inside_building' && !n._asleep
                && !(this._townAbed && this._townAbed(n)) && n.type !== 'guard' && !n._dialogFrozen));
            const hands = ['villager', 'merchant'];
            const pulled = here || outer.filter(n => isStaff(n) && callable(n)).sort((a, b) => a.id - b.id)[0]
                || (I.kind === 'tavern' || I.kind === 'market' ? outer.filter(n => hands.includes(n.type) && this._sceneFree(n) && !n._stall)
                    .sort((a, b) => _hs(S.seed, 'hand', I.b.q, I.b.r, a.uid || a.id) - _hs(S.seed, 'hand', I.b.q, I.b.r, b.uid || b.id))[0] : null);
            if (pulled) {
                if (!here) this._scenePullIn(pulled, I, first);
                this._sceneCastAs(pulled, I, 'staff', I.stations[0], 1e9, first);
            }
        }
        // Another priest in the church: stood beside the altar as the assistant, not wandering the nave
        if (I.kind === 'church' && I.stations.length) {
            for (const n of this.npcs) {
                if (n._scene || n._asleep || !isStaff(n) || !this.npcs.some(o => o !== n && o._scene && o._scene.role === 'staff')) continue;
                const spot = this._sceneAssistSpot(I, n);
                if (!spot) break;
                this._sceneCastAs(n, I, 'assistant', spot, 1e9, first);
            }
        }
        // The bard of an evening
        const BD = I.kind === 'tavern' ? C.tavern.bard : null;
        if (BD && I.stage && h >= BD.hours[0] && h < BD.hours[1] && !this.npcs.some(n => n._scene && n._scene.role === 'bard')) {
            const pool = outer.filter(n => _arr(BD.roles).includes(n.type) && this._sceneFree(n) && !isStaff(n))
                .sort((a, b) => (_arr(BD.roles).indexOf(a.type) - _arr(BD.roles).indexOf(b.type)) || (_hs(S.seed, 'bard', day, a.uid || a.id) - _hs(S.seed, 'bard', day, b.uid || b.id)));
            if (pool[0]) {
                this._scenePullIn(pool[0], I, first);
                this._sceneCastAs(pool[0], I, 'bard', I.stage, this._sceneSecsTo(BD.hours[1]) + 1, first);
            }
        }
        // A wedding in the church: the couple stood before the altar (ui/innerMapCourting.js); the guests take the pews
        if (I.kind === 'church') {
            for (const n of this.npcs) {
                if (n._scene || n._asleep || n._weddingRole !== 'couple') continue;
                const spot = this._sceneAltarFront(I, n);
                if (spot) this._sceneCastAs(n, I, 'couple', spot, Math.max(20, Number(n.idleTimer) || 30), first);
            }
        }
        // Those already in when the player came in take seats
        for (const n of this.npcs) {
            if (n._scene || n._asleep || isStaff(n)) continue;
            const seat = this._sceneFreeSeat(I, n);
            if (!seat) continue;
            this._sceneCastAs(n, I, 'patron', seat, Math.max(20, Number(n.idleTimer) || 30), first);
        }
        // More come in while the hour wants them
        const want = Math.min(I.seats.length, this.sceneCrowd(I.kind, h, day));
        const present = this.npcs.filter(n => n._scene && n._scene.role === 'patron' && n._scene.phase !== 'leave').length;
        I.arriveIn -= step;
        if (present < want && (first || I.arriveIn <= 0)) {
            const roles = I.kind === 'church' ? null : _arr(I.K.roles);
            const sv = I.kind === 'church' ? this.serviceAt(h, day, false) : null;
            const pool = outer.filter(n => this._sceneFree(n) && !isStaff(n) && !(I.kind === 'tavern' && this._sceneBarred(n)) && (roles ? roles.includes(n.type) : (sv ? this._sceneAttends(n, sv) : _arr(C.church.roles).includes(n.type))))
                .sort((a, b) => _hs(S.seed, I.kind, day, Math.floor(h), a.uid || a.id) - _hs(S.seed, I.kind, day, Math.floor(h), b.uid || b.id));
            const n = first ? want - present : 1;
            for (const p of pool.slice(0, n)) {
                const seat = this._sceneFreeSeat(I, p);
                if (!seat) break;
                this._scenePullIn(p, I, first);
                const stay = sv ? this._sceneSecsTo(sv.end) + 1 : _span(I.K.stay || [40, 90], _hs(S.seed, 'stay', p.id, day, Math.floor(h)));
                this._sceneCastAs(p, I, 'patron', seat, stay, first);
            }
            const u = _hs(S.seed, 'arrive', day, h, present);
            I.arriveIn = I.kind === 'church' ? 1 + u * 1.5 : 2 + u * 4;
        }
        // Off duty: the staff go
        if (!duty) for (const n of this.npcs) if (n._scene && (n._scene.role === 'staff' || n._scene.role === 'assistant') && n._scene.phase !== 'leave') n._scene.left = 0;
    },

    /** Before the altar, facing it, for one of a couple being wed (two spots side by side). */
    _sceneAltarFront(I, npc) {
        const busy = new Set(this.npcs.filter(n => n !== npc && n._scene && n._scene.spot).map(n => `${n._scene.spot.q},${n._scene.spot.r}`));
        const station = new Set(I.stations.map(x => `${x.q},${x.r}`));
        const seat = new Set(I.seats.map(x => `${x.q},${x.r}`));
        const altar = this.getFurnitureSpots().find(f => f.type === 'altar') || I.stations[0];
        if (!altar) return null;
        for (const [dq, dr] of [[0, 2], [1, 2], [-1, 2], [0, 1], [1, 1], [-1, 1], [0, 3], [1, 3], [-1, 3]]) {
            const q = altar.q + dq, r = altar.r + dr;
            const k = `${q},${r}`;
            if (busy.has(k) || station.has(k) || seat.has(k) || !this._sceneFloorOk(q, r)) continue;
            return { q, r, face: 0, type: 'altar' };
        }
        return null;
    },

    /**
     * A wedding service in here (the couple at the altar): the priest's
     * prayers, the vows, the blessing, the guests' hymn. → true while one is on
     * (the day's own service waits).
     */
    _sceneWedding(I, step) {
        const couple = this.npcs.filter(n => n._scene && n._scene.role === 'couple' && n._scene.phase === 'at');
        if (!couple.length) { I.wed = null; return false; }
        const L = (DataLoader._gamedata && DataLoader._gamedata.townWorship && DataLoader._gamedata.townWorship.lines) || {};
        const priest = this.npcs.find(n => n._scene && n._scene.role === 'staff' && n._scene.phase === 'at');
        const flock = this.npcs.filter(n => n._scene && n._scene.role === 'patron' && n._scene.phase === 'at');
        const S = this._scn || {};
        if (!I.wed) I.wed = { n: 0, next: 1.5 };
        const W = I.wed;
        if (priest && priest.activity) { priest.activity.anim = W.n < 4 ? 'emotes' : 'idle'; priest.activity.icon = '💍'; priest.activity.label = 'Marrying the couple'; }
        for (const n of flock) { n._pose = n._scene.spot.on ? 2 : 0; if (n.activity) n.activity.label = 'At the wedding'; }
        W.next -= step;
        if (W.next > 0) return true;
        W.next = 4 + _hs(S.seed, 'wed', W.n) * 2;
        const pick = (list, salt) => { const a = _arr(list); return a.length ? a[Math.floor(_hs(S.seed, salt, W.n, this.worldDay || 0) * a.length) % a.length] : ''; };
        const step0 = W.n++;
        if (step0 === 0 && priest) this._sceneSay(priest, pick(L.weddingPrayer, 'wp'), 0, 4.5);
        else if (step0 === 1) this._sceneSay(couple[0], pick(L.weddingVow, 'v1'), 0, 3);
        else if (step0 === 2 && couple[1]) this._sceneSay(couple[1], pick(L.weddingVow, 'v2'), 0, 3);
        else if (step0 === 3 && priest) this._sceneSay(priest, pick(L.weddingBlessing, 'wb'), 0, 4);
        else if (flock.length) {
            const who = flock[Math.floor(_hs(S.seed, 'wh', W.n) * flock.length) % flock.length];
            this._sceneSay(who, pick(L.hymn, 'hy'), 0, 3);
        }
        return true;
    },

    /** A spot for a second priest: another altar or lectern's station, else beside the first, facing the same way. */
    _sceneAssistSpot(I, npc) {
        const busy = new Set(this.npcs.filter(n => n !== npc && n._scene && n._scene.spot).map(n => `${n._scene.spot.q},${n._scene.spot.r}`));
        const st = I.stations.find((x, i) => i > 0 && !busy.has(`${x.q},${x.r}`));
        if (st) return st;
        const main = I.stations[0];
        for (const [dq, dr] of [[1, 0], [-1, 0], [2, 0], [-2, 0], [0, 1], [1, 1], [-1, 1]]) {
            const q = main.q + dq, r = main.r + dr;
            if (busy.has(`${q},${r}`) || !this._sceneFloorOk(q, r) || I.seats.some(x => x.q === q && x.r === r) || (I.door && I.door.q === q && I.door.r === r)) continue;
            return { q, r, face: main.face, type: main.type, assist: true };
        }
        return null;
    },

    /** Out in the street and free to come in (not on watch, not in a fight, not abed). */
    /** Barred from the tavern by its keeper after a brawl (systems/brawls.js: settlement.brawls.barred[pid] = until day). */
    _sceneBarred(n) {
        const s = this._currentWorldTileRef && this._currentWorldTileRef.settlement;
        const until = n && n._person && s && s.brawls && s.brawls.barred ? s.brawls.barred[n._person.id] : null;
        return until != null && (this.worldDay || 0) < until;
    },

    _sceneFree(n) {
        if (!n || this.npcs.includes(n)) return false;
        if (n.state !== 'idle' && n.state !== 'walking') return false;
        if (n.type === 'guard' || n._dialogFrozen || n.departing || n._doorPost || n._drunk || n._carry) return false;
        if (n._vending || (n._stall && this._sceneMarketOpen())) return false;
        if (n.type === 'child' && this.townPeriod() === 'night') return false;
        return true;
    },

    _sceneFreeSeat(I, npc) {
        const busy = new Set(this.npcs.filter(n => n !== npc && n._scene && n._scene.spot).map(n => `${n._scene.spot.q},${n._scene.spot.r}`));
        const S = this._scn || { seed: 1 };
        const all = I.seats.filter(s => !busy.has(`${s.q},${s.r}`));
        if (!all.length) return null;
        // (the pews themselves first: only when they're full do the rest kneel beside them)
        const on = all.filter(s => s.on);
        const free = on.length ? on : all;
        return free[Math.floor(_hs(S.seed, 'seat', npc.uid || npc.id, this.worldDay || 0) * free.length) % free.length];
    },

    /** In from the street: bound to this building on the town map, stood at the door in here. */
    _scenePullIn(n, I) {
        const od = this._sceneOuterDoor(I.b);
        this._sceneClear(n);
        n.path = null; n.moveProgress = 0; n._targetBuilding = null; n._activity = null;
        n._awaiting = null; n._chatWith = null; n._stayFor = null;
        n.state = 'inside_building';
        n.currentBuilding = I.b.type;
        n._insideBuildingQ = I.b.q; n._insideBuildingR = I.b.r;
        n._outsideQ = od.q; n._outsideR = od.r;
        n._act = null; n.activity = null;
        n.q = n.prevQ = I.door.q; n.r = n.prevR = I.door.r;
        this.npcs.push(n);
    },

    /** Give them their part: walk to the spot (or be there already, on first sight). */
    _sceneCastAs(n, I, role, spot, stay, instant) {
        n._act = null;
        n.activity = null;
        n._scene = { role, spot, phase: 'go', left: stay };
        n.idleTimer = Math.max(1, Math.min(stay, 600));
        const target = spot.on || spot;
        if (instant) {
            n.q = n.prevQ = target.q; n.r = n.prevR = target.r;
            n.path = null;
            this._sceneSeat(n, I);
            return;
        }
        if (!this._npcWalkTo(n, target.q, target.r)) this._sceneSeat(n, I);
    },

    /** At their spot: sat down (onto the pew), facing the business, at it. */
    _sceneSeat(n, I) {
        const sc = n._scene;
        const C = this.townScenesConfig();
        sc.phase = 'at';
        if (sc.spot.on) { n.q = n.prevQ = sc.spot.q; n.r = n.prevR = sc.spot.r; n._seatOn = true; }
        n.facing = sc.spot.face;
        n.path = null;
        if (sc.role === 'staff') {
            const A = I.K.staffActivity || {};
            n.activity = { type: 'scene', ...A, _scene: true };
            n._pose = A.pose != null ? A.pose : null;
            n._swing = A.tool ? { tool: A.tool, interval: Number(A.swing) || 0.9, t: 0, sound: A.sound || null } : null;
            // (a stall's keeper stood behind it, facing out: its awning and counter before them)
            if (sc.spot.face === 2 && ((this.FURNITURE_ACTIVITIES || {})[sc.spot.type] || {}).keepers) {
                const st = this.getTile(sc.spot.q, sc.spot.r + 1), pc = st && st._furniture && st._furniture.piece;
                n._behindCounter = { row: sc.spot.r + 1, piece: pc ? { q: pc.q, r: pc.r } : null };
            }
        } else if (sc.role === 'couple') {
            // (one of the pair being wed, stood before the altar)
            n.activity = { type: 'scene', icon: '💍', label: 'Being wed', anim: 'idle', _scene: true, quiet: true };
            n._pose = null;
        } else if (sc.role === 'assistant') {
            // (the second priest beside the altar: hands folded, at the prayers)
            n.activity = { type: 'scene', icon: '🙏', label: 'Assisting at the altar', anim: 'idle', _scene: true, quiet: true };
            n._pose = null;
        } else if (sc.role === 'bard') {
            n.activity = { type: 'scene', icon: '🎵', label: 'Playing for the room', anim: 'emotes', _scene: true };
            n._pose = null;
        } else {
            // (sat on the pew, kneeling beside it; at a table's end, stood drinking) — no marker over every head
            const A = I.K.seatActivity || {};
            n.activity = { type: 'scene', ...A, _scene: true, quiet: true };
            if (sc.spot.stand) n.activity.anim = 'idle';
            n._pose = n.activity.anim === 'sitting' ? (sc.spot.on || I.kind !== 'church' ? 2 : 0) : null;
            // (beside a table: on a stool drawn up to it — furnitureUse.js FURNITURE_ACTIVITIES[type].seat)
            const seat = !sc.spot.on && n.activity.anim === 'sitting' && ((this.FURNITURE_ACTIVITIES || {})[sc.spot.at] || {}).seat;
            if (seat) Object.assign(n.activity, { seat, at: { q: sc.spot.fq, r: sc.spot.fr } });
        }
        if (I.kind === 'tavern' && sc.role === 'staff' && this._sceneNear(n.q, n.r) && _hs((this._scn || {}).seed, 'kp', n.id, this.worldDay || 0) < 0.5) {
            this._sceneSay(n, this._scenePickLine(C.tavern.keeper, 'keeper'), 800);
        }
    },

    /** Leaving: up off the pew, out of the door. */
    _sceneLeave(n) {
        const sc = n._scene;
        if (!sc) return;
        if (n._seatOn && sc.spot && sc.spot.on) { n.q = n.prevQ = sc.spot.on.q; n.r = n.prevR = sc.spot.on.r; }
        n._seatOn = false;
        n._pose = null;
        n._swing = null;
        if (n.activity && n.activity._scene) n.activity = null;
        sc.phase = 'leave';
        const door = this._doorTile() || (this._stairsDownTile && this._stairsDownTile());
        if (!door || !this._npcWalkTo(n, door.q, door.r)) n.state = 'leaving_building';
    },

    /** Drop every scene part (the player walked out: from interiors.exitBuilding). */
    _sceneDrop(n) {
        if (!n) return;
        if (n._seatOn && n._scene && n._scene.spot && n._scene.spot.on) { n.q = n.prevQ = n._scene.spot.on.q; n.r = n.prevR = n._scene.spot.on.r; }
        n._scene = null;
        n._seatOn = false;
        n._pose = null;
        n._swing = null;
        n._scuffle = null;
        if (n.activity && n.activity._scene) n.activity = null;
    },

    /** One frame of a person playing a part in here (from updateNPCs); false when they have none. */
    _sceneNpcUpdate(npc, dt) {
        const sc = npc._scene;
        if (!sc || npc._asleep) return false;
        const I = this._scnIn;
        if (!I || I.tiles !== this.tiles) { this._sceneDrop(npc); return false; }
        sc.left -= dt;
        npc.idleTimer = Math.max(1, Math.min(sc.left, 600));
        switch (sc.phase) {
            case 'go': {
                if (!this._npcStep(npc, dt)) return true;
                const target = sc.spot.on || sc.spot;
                if (npc.q === target.q && npc.r === target.r) this._sceneSeat(npc, I);
                else if (!this._npcWalkTo(npc, target.q, target.r)) this._sceneLeave(npc);
                return true;
            }
            case 'at':
                if (npc._scuffle) {
                    npc._scuffle.left -= dt;
                    if (npc._scuffle.left <= 0) {
                        const loser = npc._scuffle.loser;
                        npc._scuffle = null;
                        if (loser) sc.left = 0;
                        else this._sceneSeat(npc, I);
                    }
                    return true;
                }
                if (npc._flash) {
                    npc._flash.left -= dt;
                    if (npc._flash.left <= 0) { npc._flash = null; this._sceneSeat(npc, I); }
                }
                if (sc.left <= 0) this._sceneLeave(npc);
                return true;
            case 'leave':
                if (this._npcStep(npc, dt)) npc.state = 'leaving_building';
                return true;
            default:
                return true;
        }
    },

    // ──────────── THE SERVICE ────────────

    _sceneService(I, step) {
        // (a wedding at the altar takes the church first)
        if (this._sceneWedding(I, step)) return;
        const C = this.townScenesConfig().church;
        const S = this._scn || {};
        const h = this._sceneClock();
        const day = this.worldDay || 0;
        const sv = this.serviceAt(h, day, false);
        const priest = this.npcs.find(n => n._scene && n._scene.role === 'staff' && n._scene.phase === 'at');
        const flock = this.npcs.filter(n => n._scene && n._scene.role === 'patron' && n._scene.phase === 'at');
        const key = sv ? `${day}:${sv.idx}` : null;
        if (key && I.svcKey !== key) {
            I.svcKey = key;
            I.said = {};
            I.eventIn = 3;
            this._sceneSound('bell', I.door.q, I.door.r);
            if (priest) this._sceneSay(priest, this._sceneFill(this._scenePickLine(C.open, 'open')), 600, 4);
        }
        if (!sv) {
            // Between services: the priest at the altar, a few at prayer, kneeling
            // (on a school morning the pupils sit at their lessons, the priest teaching: world/innerMap/townKin.js)
            const pupils = flock.some(n => n._pupil);
            if (priest && priest.activity) {
                priest.activity.anim = pupils ? 'emotes' : 'idle';
                priest.activity.icon = pupils ? '📖' : '🙏';
                priest.activity.label = pupils ? 'Teaching the children' : 'Tending the altar';
            }
            for (const n of flock) {
                n._pose = n._pupil && n._scene.spot.on ? 2 : 0;
                if (n.activity) n.activity.label = n._pupil ? 'At lessons' : 'At prayer';
            }
            I.eventIn -= step;
            if (I.eventIn <= 0) {
                I.eventIn = 9 + _hs(S.seed, 'pray', S.n = (S.n || 0) + 1) * 8;
                const who = flock[Math.floor(_hs(S.seed, 'pw', S.n) * flock.length)];
                if (who && this._sceneNear(who.q, who.r)) this._sceneSay(who, this._scenePickLine(C.between, 'between'), 0, 3);
            }
            if (I.svcKey) {
                // The service ended: the congregation goes home
                I.svcKey = null;
                for (const n of flock) n._scene.left = Math.min(n._scene.left, 1 + _hs(S.seed, 'go', n.id) * 6);
            }
            return;
        }
        const preaching = sv.phase >= 0.1 && sv.phase < 0.75;
        const kneeling = sv.phase >= 0.75 && sv.phase < 0.9;
        if (priest && priest.activity) {
            priest.activity.anim = preaching ? 'emotes' : 'idle';
            priest.activity.icon = preaching ? '📖' : '🙏';
            priest.activity.label = preaching ? 'Preaching' : 'Leading the prayers';
        }
        for (const n of flock) {
            n._pose = kneeling || !n._scene.spot.on ? 0 : 2;
            if (n.activity) n.activity.label = preaching ? 'Listening to the sermon' : 'At prayer';
        }
        if (sv.phase >= 0.9 && !I.said.close && priest) {
            I.said.close = true;
            this._sceneSay(priest, this._sceneFill(this._scenePickLine(C.close, 'close')), 0, 4);
        }
        I.eventIn -= step;
        if (I.eventIn > 0 || !priest || !preaching) return;
        I.eventIn = 6 + _hs(S.seed, 'sermon', S.n = (S.n || 0) + 1) * 4;
        const sm = C.sermon || {};
        const own = S.faith && S.faith.id ? _arr(sm[S.faith.id]) : [];
        this._sceneSay(priest, this._sceneFill(this._scenePickLine([...own, ...own, ..._arr(sm.any)], 'sermon')), 0, 4.5);
        const who = flock[Math.floor(_hs(S.seed, 'amen', S.n) * Math.max(1, flock.length))];
        if (who && _hs(S.seed, 'amen?', S.n) < 0.6) this._sceneSay(who, this._scenePickLine(C.amen, 'amen'), 3200, 2.5);
    },

    // ──────────── THE TAVERN ────────────

    _sceneTavern(I, step) {
        const T = this.townScenesConfig().tavern;
        const S = this._scn || {};
        const sitting = this.npcs.filter(n => n._scene && n._scene.role === 'patron' && n._scene.phase === 'at' && !n._scuffle && !n._flash && !n._fight);
        const bard = this.npcs.find(n => n._scene && n._scene.role === 'bard' && n._scene.phase === 'at');
        const keeper = this.npcs.find(n => n._scene && n._scene.role === 'staff' && n._scene.phase === 'at');
        // The bard's songs, a cheer from the room
        if (bard) {
            bard._songIn = (bard._songIn == null ? 1 : bard._songIn) - step;
            if (bard._songIn <= 0) {
                bard._songIn = 5 + _hs(S.seed, 'song', S.n = (S.n || 0) + 1) * 3;
                if (this._sceneNear(bard.q, bard.r)) {
                    this._sceneSay(bard, this._scenePickLine(T.bard.songs, 'song'), 0, 4);
                    const fan = sitting[Math.floor(_hs(S.seed, 'fan', S.n) * Math.max(1, sitting.length))];
                    if (fan && _hs(S.seed, 'fan?', S.n) < 0.35) this._sceneSay(fan, this._scenePickLine(T.bard.cheer, 'cheer'), 3000, 2.5);
                }
            }
        }
        I.eventIn -= step;
        if (I.eventIn > 0 || !sitting.length) return;
        I.eventIn = _span(T.eventEvery || [6, 11], _hs(S.seed, 'ev', S.n = (S.n || 0) + 1));
        const weights = Object.entries(T.events || {}).filter(([k, w]) => w > 0 && (k !== 'argue' || sitting.length >= 2) && (k !== 'dice' || sitting.length >= 2));
        if (!weights.length) return;
        let roll = _hs(S.seed, 'evk', S.n) * weights.reduce((s, [, w]) => s + w, 0);
        let ev = weights[weights.length - 1][0];
        for (const [k, w] of weights) { roll -= w; if (roll <= 0) { ev = k; break; } }
        const pick = salt => sitting[Math.floor(_hs(S.seed, salt, S.n) * sitting.length) % sitting.length];
        const a = pick('a');
        const near = this._sceneNear(a.q, a.r);
        switch (ev) {
            case 'toast': {
                a._flash = { left: 2.2 };
                a._pose = null;
                a.activity = { type: 'scene', icon: '🍻', label: 'Raising a toast', anim: 'emotes', _scene: true };
                if (near) {
                    this._sceneSay(a, this._sceneFill(this._scenePickLine(T.toast, 'toast'), { name: (pick('b') || a).name }));
                    sitting.filter(n => n !== a).slice(0, 2).forEach((n, i) => this._sceneSay(n, this._scenePickLine(T.cheers, 'cheers'), 1800 + i * 500, 2));
                }
                return;
            }
            case 'dice': {
                // Those at a's table (or by them) at dice a while
                const at = a._scene.spot;
                const table = sitting.filter(n => n._scene.spot && n._scene.spot.fq === at.fq && n._scene.spot.fr === at.fr);
                for (const n of table.length >= 2 ? table : sitting.slice(0, 2)) {
                    n.activity = { ...n.activity, icon: '🎲', label: 'Playing dice', quiet: false };
                }
                if (near) this._sceneSay(a, this._scenePickLine(T.dice, 'dice'));
                return;
            }
            case 'argue': {
                const b = sitting.find(n => n !== a && Math.max(Math.abs(n.q - a.q), Math.abs(n.r - a.r)) <= 3) || sitting.find(n => n !== a);
                if (!b) return;
                const pair = this._scenePickLine(T.argue, 'argue') || ['…', '…'];
                this._sceneSay(a, this._sceneFill(pair[0], { name: b.name }));
                this._sceneSay(b, this._sceneFill(pair[1], { name: a.name }), 2200);
                // A real fight that may come of it (ui/innerMapBrawls.js: words, a shove, fists, the keeper)
                if (this.onSceneArgue) { this.onSceneArgue(a, b); return; }
                // It comes to blows: up off the benches, swinging, till the keeper breaks it up
                const loserA = _hs(S.seed, 'loser', S.n) < 0.5;
                for (const [n, other, loser] of [[a, b, loserA], [b, a, !loserA]]) {
                    n._scuffle = { left: 6.5, loser };
                    n._pose = null;
                    n.facing = _dirTo(other.q - n.q, other.r - n.r);
                    n.activity = { type: 'scene', icon: '💢', label: 'Brawling', anim: 'halfslash', _scene: true };
                }
                if (keeper) this._sceneSay(keeper, this._scenePickLine(T.keeperBreak, 'break'), 4200, 3);
                return;
            }
            default:
                if (near) this._sceneSay(a, this._sceneFill(this._scenePickLine(T.banter, 'banter')));
        }
    },

    /** What a scene in here offers the player (ui/objectActions: listen to the bard, attend the service). */
    sceneState() {
        const b = this._insideBuilding;
        const I = this._scnIn;
        if (!b || !I || I.tiles !== this.tiles) return { kind: null, bard: false, service: false };
        return {
            kind: I.kind,
            bard: this.npcs.some(n => n._scene && n._scene.role === 'bard' && n._scene.phase === 'at'),
            service: I.kind === 'church' && !!this.serviceAt(this._sceneClock(), this.worldDay || 0, false),
        };
    },

    // ──────────── THE CAMP FIRE (Dawn of Man, world/innerMap/camp.js) ────────────

    /** Of an evening the eldest tells stories by the fire and a few sit round; true when handled. */
    _campScene(npc) {
        const CP = this.townScenesConfig().camp;
        const hub = npc && npc.campHub;
        if (!CP || !hub) return false;
        const h = this._sceneClock();
        npc._pose = null;
        if (npc.activity && npc.activity._scene) npc.activity = null;
        if (!(h >= CP.hours[0] && h < CP.hours[1])) return false;
        const clan = (this.npcs || []).filter(n => n.campHub && n.campHub.q === hub.q && n.campHub.r === hub.r && n.state !== 'gone');
        const age = n => Number(n.age != null ? n.age : (n._person && n._person.age)) || 0;
        const elder = clan.slice().sort((a, b) => (age(b) - age(a)) || (a.id - b.id))[0];
        const seed = _hs('camp', hub.q, hub.r);
        const listeners = clan.filter(n => n !== elder).sort((a, b) => _hs(seed, this.worldDay || 0, a.id) - _hs(seed, this.worldDay || 0, b.id)).slice(0, Number(CP.listeners) || 4);
        let spot = null;
        let face = 2;
        if (npc === elder) {
            spot = [[0, 2], [1, 2], [-1, 2], [0, -2]].map(([dq, dr]) => ({ q: hub.q + dq, r: hub.r + dr })).find(s => this._scenePassable(s.q, s.r) || (s.q === npc.q && s.r === npc.r));
            face = 0;
        } else {
            const i = listeners.indexOf(npc);
            if (i < 0) return false;
            const n = listeners.length + 1;
            for (let k = 0; k < 6 && !spot; k++) {
                const a = Math.PI * 0.5 + (2 * Math.PI * (i + 1 + k * 0.37)) / n;
                const s = { q: Math.round(hub.q + Math.cos(a) * 2.4), r: Math.round(hub.r + Math.sin(a) * 2) };
                if (this._scenePassable(s.q, s.r) || (s.q === npc.q && s.r === npc.r)) spot = s;
            }
            if (spot) face = _dirTo(hub.q - spot.q, hub.r - spot.r);
        }
        if (!spot) return false;
        if (npc.q !== spot.q || npc.r !== spot.r) {
            const path = this._findPath(npc.q, npc.r, spot.q, spot.r);
            if (!path || path.length < 2) return false;
            npc.path = path.slice(1);
            npc.pathIndex = 0;
            npc.moveProgress = 0;
            npc.prevQ = npc.q; npc.prevR = npc.r;
            npc.state = 'walking';
            return true;
        }
        npc.state = 'idle';
        npc.facing = face;
        npc.idleTimer = 14;
        const S = this._scn || (this._scn = { seed: Math.floor(seed * 1e9), n: 0 });
        if (npc === elder) {
            npc.activity = { type: 'scene', icon: '🔥', label: 'Telling a story', anim: 'emotes', _scene: true };
            if (this._sceneNear(npc.q, npc.r)) {
                this._sceneSay(npc, this._scenePickLine(CP.stories, 'story'), 0, 4.5);
                this._sceneSay(npc, this._scenePickLine(CP.stories, 'story'), 6500, 4.5);
            }
        } else {
            npc.activity = { type: 'scene', icon: '👂', label: 'Listening to the story', anim: 'sitting', _scene: true };
            npc._pose = 0;
            if (this._sceneNear(npc.q, npc.r) && _hs(S.seed, 'ls', S.n = (S.n || 0) + 1) < 0.2) this._sceneSay(npc, this._scenePickLine(CP.listen, 'listen'), 4000, 2.2);
        }
        return true;
    },
});
