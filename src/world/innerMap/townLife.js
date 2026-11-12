// ============================================
// InnerMap — town life: where townsfolk live, work and go each hour
// ============================================
// Folk keep to the town itself — its streets, its square, its doors — and
// never wander off out to the edge of the map (only a departing traveler or
// someone fleeing walks out of town). Farmers (and a few others) go out to
// work the town's fields: hoeing and weeding as the crop grows, cutting and
// carrying it in when it is ripe (world/townProps.js, so a field the town
// works runs down before the player's eyes). What they cut they carry on
// their back to the granary (or the barn, the mill, the warehouse), where it
// goes into the town's food store. Each has a home
// and a place of work, and the hour decides what they're about: up at dawn,
// at work in the morning, the market or the tavern at midday, an evening out,
// abed at night. Neighbours stop to talk; children play about the square.
//
// The town watch stands posts at the roads in and on the square, and walks
// a beat round the streets; half of it keeps the night watch.
//
// Data: data/townLife.json (schedules, the watch's strength, chat lines).
// Draws only from Utils (seedable) and the spawn rng it is handed.

import { InnerMap } from './_ref.js';
import { Utils, DataLoader, TownProps } from './_imports.js';
import { PLAN } from '../townPlanner.js';

const DEFAULTS = {
    // How many of the watch a place keeps at least (townsfolk guards count toward it)
    watch: { village: 2, town: 5, city: 8, capital: 12 },
    nightWatchShare: 0.34,
    // Keep this many tiles clear of the map's edge
    edgeMargin: 8,
    // Hours each part of the day begins
    periods: { dawn: 5, morning: 7, midday: 12, afternoon: 14, evening: 18, night: 21 },
    // Weights of what folk do, by role and part of the day ('default' for any role not listed)
    schedule: {
        default: {
            dawn: { home: 2, well: 2, stroll: 1 },
            morning: { work: 5, errand: 2, chat: 1, stroll: 1 },
            midday: { market: 3, tavern: 1, chat: 2, well: 1, work: 2 },
            afternoon: { work: 5, errand: 2, chat: 1, stroll: 1 },
            evening: { tavern: 3, chat: 3, plaza: 2, home: 2 },
            night: { home: 1 },
        },
    },
    // How long each thing takes once there (seconds, [min, max]); 1 real minute is an hour
    stay: {
        home: [25, 50], work: [20, 45], tend: [12, 25], field: [20, 40], deliver: [4, 10], errand: [8, 20], market: [10, 22], tavern: [20, 40],
        church: [15, 30], plaza: [8, 18], well: [5, 12], stroll: [2, 6], play: [1, 3], post: [30, 60], patrol: [2, 5],
        chat: [6, 12], sleep: [60, 120],
    },
    // Roles that work out front of their door (a stall, an anvil) rather than inside
    tendOutside: { merchant: 0.6, blacksmith_npc: 0.5, farmer: 0.4, beggar: 1 },
    // At work, the share of each role that goes out to the fields instead (when the town has any);
    // a hand cutting a ripe field brings in this much of its crop each spell of work
    fieldWork: { farmer: 0.75, villager: 0.15, child: 0.05 },
    fieldHarvestPerSpell: 2,
    // Where the cut crop is carried, in order of preference
    harvestStores: ['granary', 'barn', 'mill', 'warehouse', 'farm', 'marketplace'],
    workplaces: {
        merchant: ['marketplace', 'warehouse', 'bakery'],
        farmer: ['farm', 'barn', 'granary', 'mill'],
        priest: ['church', 'temple'],
        blacksmith_npc: ['blacksmith'],
        noble: ['town_hall', 'manor'],
        guard: ['barracks', 'guard_tower', 'town_hall'],
        villager: ['bakery', 'tavern', 'warehouse', 'mill', 'stable', 'apothecary', 'marketplace', 'granary'],
        traveler: ['marketplace', 'stable'],
    },
    lodgings: ['inn', 'tavern', 'guest_house', 'hotel', 'roadhouse'],
    chat: {
        radius: 10, playerRadius: 22,
        lines: {
            any: ['Good day, {name}.', 'How fares the family, {name}?', 'Did you hear the news?', 'Fine weather, isn\'t it?', 'Hm. Prices again.', 'Ha! You don\'t say.'],
        },
    },
};

function _now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function _obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }

function _span(range, rnd) {
    const [a, b] = Array.isArray(range) ? range : [5, 10];
    return a + rnd() * (b - a);
}

function _weighted(weights, rnd) {
    const entries = Object.entries(weights || {}).filter(([, w]) => w > 0);
    if (!entries.length) return null;
    let roll = rnd() * entries.reduce((s, [, w]) => s + w, 0);
    for (const [k, w] of entries) { roll -= w; if (roll <= 0) return k; }
    return entries[entries.length - 1][0];
}

function _dirTo(dq, dr) {
    if (Math.abs(dq) >= Math.abs(dr)) return dq >= 0 ? 3 : 1;
    return dr >= 0 ? 2 : 0;
}

let _cfg = null;
let _cfgSrc;

Object.assign(InnerMap, {
    /** Town-life settings: data/townLife.json over the defaults. */
    townLifeConfig() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.townLife : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            _cfg = {
                ...DEFAULTS, ...d,
                watch: { ...DEFAULTS.watch, ...(_obj(d.watch) || {}) },
                periods: { ...DEFAULTS.periods, ...(_obj(d.periods) || {}) },
                schedule: { ...DEFAULTS.schedule, ...(_obj(d.schedule) || {}) },
                stay: { ...DEFAULTS.stay, ...(_obj(d.stay) || {}) },
                tendOutside: { ...DEFAULTS.tendOutside, ...(_obj(d.tendOutside) || {}) },
                fieldWork: { ...DEFAULTS.fieldWork, ...(_obj(d.fieldWork) || {}) },
                workplaces: { ...DEFAULTS.workplaces, ...(_obj(d.workplaces) || {}) },
                chat: { ...DEFAULTS.chat, ...(_obj(d.chat) || {}), lines: { ...DEFAULTS.chat.lines, ...((_obj(d.chat) || {}).lines || {}) } },
            };
        }
        return _cfg;
    },

    /** The part of the day by the inner-map clock: dawn, morning, midday, afternoon, evening, night. */
    townPeriod(hour = this.timeOfDay) {
        const P = this.townLifeConfig().periods;
        const h = ((hour == null ? 8 : hour) % 24 + 24) % 24;
        if (h >= P.night || h < P.dawn) return 'night';
        if (h >= P.evening) return 'evening';
        if (h >= P.afternoon) return 'afternoon';
        if (h >= P.midday) return 'midday';
        if (h >= P.morning) return 'morning';
        return 'dawn';
    },

    // ──────────── THE TOWN'S BOUNDS ────────────

    /**
     * The town on this map: its centre and reach, its streets (well in from
     * the map's edge), the square and the roads in. Null on a map with no
     * settlement or no streets (the open road, a building's interior).
     */
    townArea() {
        if (this._town && this._town.tiles === this.tiles) return this._town.area;
        const area = this._computeTownArea();
        this._town = { tiles: this.tiles, area };
        return area;
    },

    _computeTownArea() {
        if (this._insideBuilding) return null;
        const wt = this._currentWorldTileRef || null;
        const settlement = wt && wt.settlement;
        const blds = (this.buildings || []).filter(b => b && !b.isPlayerProperty);
        if (!settlement || !blds.length) return null;
        const W = this.width, H = this.height;
        const margin = Number(this.townLifeConfig().edgeMargin) || 8;
        const layout = this.tiles && this.tiles._settlementLayout;
        let cq, cr;
        if (layout && layout.center) { cq = layout.center.q; cr = layout.center.r; } else {
            cq = Math.round(blds.reduce((s, b) => s + b.q, 0) / blds.length);
            cr = Math.round(blds.reduce((s, b) => s + b.r, 0) / blds.length);
        }
        const plan = PLAN[settlement.type] || PLAN.village;
        // The town reaches as far as its buildings do (within the plan's radius, a little beyond)
        const dists = blds.map(b => Math.hypot(b.q - cq, b.r - cr)).sort((a, b) => a - b);
        const far = dists[Math.floor(dists.length * 0.9)] || plan.R;
        const R = Math.max(8, Math.min(plan.R * 1.1, far + 3));
        const inBounds = (q, r) => q >= margin && r >= margin && q < W - margin && r < H - margin;
        const passable = (q, r) => { const t = this.tiles[r] && this.tiles[r][q]; return !!(t && t.subTerrain && t.subTerrain.passable); };
        const streets = [];
        const edgeRoads = [];
        for (const rd of this.roads || []) {
            if (!inBounds(rd.q, rd.r) || !passable(rd.q, rd.r)) continue;
            const d = Math.hypot(rd.q - cq, rd.r - cr);
            if (d <= R) streets.push({ q: rd.q, r: rd.r, d });
            if (d > R * 0.82 && d <= R * 1.05) edgeRoads.push({ q: rd.q, r: rd.r, d, a: Math.atan2(rd.r - cr, rd.q - cq) });
        }
        // No streets drawn: the passable ground about the buildings will do
        if (streets.length < 6) {
            for (let r = Math.max(margin, Math.floor(cr - R)); r <= Math.min(H - margin - 1, Math.ceil(cr + R)); r += 2) {
                for (let q = Math.max(margin, Math.floor(cq - R)); q <= Math.min(W - margin - 1, Math.ceil(cq + R)); q += 2) {
                    const d = Math.hypot(q - cq, r - cr);
                    if (d <= R && passable(q, r) && !this.getBuildingAt(q, r)) streets.push({ q, r, d });
                }
            }
        }
        if (!streets.length) return null;
        // The square: the streets nearest the centre
        const square = streets.filter(s => s.d <= Math.max(4, R * 0.18));
        // The roads in: one per quarter of the compass, where a street leaves town
        const gates = [];
        for (let i = 0; i < 4; i++) {
            const lo = -Math.PI + i * Math.PI / 2;
            const quarter = edgeRoads.filter(e => e.a >= lo && e.a < lo + Math.PI / 2).sort((a, b) => b.d - a.d);
            if (quarter.length) gates.push({ q: quarter[0].q, r: quarter[0].r, face: _dirTo(quarter[0].q - cq, quarter[0].r - cr) });
        }
        return { center: { q: cq, r: cr }, R, streets, square: square.length ? square : streets.slice(0, 6), gates, margin };
    },

    /** A street tile in town (or, `near` a point, one within `within` tiles of it). */
    townSpot(rnd = Utils.random, near = null, within = 6) {
        const A = this.townArea();
        if (!A) return null;
        let pool = A.streets;
        if (near) {
            const close = A.streets.filter(s => Math.max(Math.abs(s.q - near.q), Math.abs(s.r - near.r)) <= within);
            if (close.length) pool = close;
        }
        const s = pool[Math.floor(rnd() * pool.length) % pool.length];
        return { q: s.q, r: s.r };
    },

    /** The town's buildings whose doors are in town (not the farmsteads out in the fields). */
    _townBuildings() {
        if (this._townBlds && this._townBlds.tiles === this.tiles && this._townBlds.n === (this.buildings || []).length) return this._townBlds.list;
        const list = (this.buildings || []).filter(b => {
            if (!b || b.isPlayerProperty) return false;
            const door = this._findPassableAdjacentTile(b.q, b.r);
            return this.inTown(door.q, door.r);
        });
        this._townBlds = { tiles: this.tiles, n: (this.buildings || []).length, list };
        return list;
    },

    /** Is this tile in town (on the streets' side of the edge margin, within its reach)? */
    inTown(q, r) {
        const A = this.townArea();
        if (!A) return true;
        if (q < A.margin || r < A.margin || q >= this.width - A.margin || r >= this.height - A.margin) return false;
        return Math.hypot(q - A.center.q, r - A.center.r) <= A.R * 1.1;
    },

    // ──────────── SETTLING IN ────────────

    /**
     * After the roster and the buildings' owners are known: the watch filled
     * out, everyone given a home and a place of work, and set down where the
     * hour finds them — indoors at home by night, about the streets by day.
     */
    _settleTownLife(settlement, rng) {
        const A = this.townArea();
        if (!A || !settlement) return;
        const C = this.townLifeConfig();
        // The watch
        const want = Number(C.watch[settlement.type] != null ? C.watch[settlement.type] : C.watch.village) || 0;
        let guards = this.npcs.filter(n => n.type === 'guard').length;
        let id = this.npcs.reduce((m, n) => Math.max(m, n.id), -1) + 1;
        while (guards < want) {
            const g = this._makeNpc('guard', id++, rng);
            if (!g) break;
            g.watchman = true;
            g.gender = rng() < 0.3 ? 'female' : 'male';
            g.roleTitle = g.gender === 'female' ? 'Watchwoman' : 'Watchman';
            this.npcs.push(g);
            guards++;
        }
        // Night watch: every other guard keeps the night
        const share = Number(C.nightWatchShare) || 0;
        const watch = this.npcs.filter(n => n.type === 'guard');
        watch.forEach((g, i) => { g._nightWatch = i < Math.round(watch.length * share); g._post = A.gates.length && i % 2 === 0 ? A.gates[(i / 2) % A.gates.length] : null; });

        // Each lord's seat its lord (world/innerMap/seats.js)
        if (this._seatLords) this._seatLords(rng);

        this._assignHomesAndWork(rng);
        // ...and each to their own trade's place (world/innerMap/townWork.js)
        if (this._assignJobPlaces) this._assignJobPlaces();

        // Where the hour finds them
        const night = this.townPeriod() === 'night';
        for (const npc of this.npcs) {
            npc._activity = null;
            // (a camp's folk keep the places among the tents they were given — world/innerMap/interiors.js)
            const spot = npc.campHub ? null : (npc.type === 'guard' && npc._post) ? npc._post : this.townSpot(rng);
            if (spot) { npc.q = npc.prevQ = npc.targetQ = spot.q; npc.r = npc.prevR = npc.targetR = spot.r; }
            npc.path = null;
            npc.state = 'idle';
            npc.idleTimer = rng() * 4;
            const onDuty = npc.type === 'guard' && this._guardOnDuty(npc);
            if ((night || (npc.type === 'guard' && !onDuty) || (this._sickAbed && this._sickAbed(npc, true))) && (!onDuty || (this._sickAbed && this._sickAbed(npc, true))) && npc._home && npc.type !== 'traveler') {
                const door = this._findPassableAdjacentTile(npc._home.q, npc._home.r);
                npc.q = npc.prevQ = door.q; npc.r = npc.prevR = door.r;
                npc.state = 'inside_building';
                npc.currentBuilding = npc._home.type;
                npc._insideBuildingQ = npc._home.q;
                npc._insideBuildingR = npc._home.r;
                npc._outsideQ = door.q;
                npc._outsideR = door.r;
                npc.idleTimer = 10 + rng() * 60;
            }
        }
        // Guards at the seats' doors, day and night (world/innerMap/seats.js)
        if (this._postSeatGuards) this._postSeatGuards(rng);
    },

    /** Each person's home (a family shares one) and work (what they keep, else by trade). */
    _assignHomesAndWork(rng) {
        const C = this.townLifeConfig();
        const blds = this._townBuildings().filter(b => !b.isPlayerOwned);
        // Vacant houses stand empty (world/innerMap/lots.js)
        const houses = blds.filter(b => b.type === 'house' && !b._vacant);
        const lodgings = blds.filter(b => (C.lodgings || []).includes(b.type));
        const byType = {};
        for (const b of blds) (byType[b.type] = byType[b.type] || []).push(b);
        const byId = new Map(this.npcs.map(n => [n.id, n]));
        let next = 0;
        const famHome = new Map();
        for (const npc of this.npcs) {
            npc._home = null;
            npc._work = null;
            const owned = blds.filter(b => b.ownerId === npc.id);
            const ownHouse = owned.find(b => b.type === 'house');
            if (npc.type === 'traveler') {
                npc._home = lodgings.length ? lodgings[Math.floor(rng() * lodgings.length)] : null;
            } else if (ownHouse) {
                npc._home = ownHouse;
            }
            const work = owned.find(b => b.type !== 'house');
            if (work) npc._work = work;
            // A lord lives at his seat
            const seat = this.isSeat ? owned.find(b => this.isSeat(b)) : null;
            if (seat) npc._home = seat;
            else {
                const kinds = (C.workplaces[npc.type] || []).filter(t => byType[t] && byType[t].length);
                if (kinds.length) {
                    const list = byType[kinds[Math.floor(rng() * kinds.length)]];
                    npc._work = list[Math.floor(rng() * list.length)];
                }
            }
            if (npc.type === 'guard' && npc._work && !npc._home && ['barracks', 'guard_tower'].includes(npc._work.type)) npc._home = npc._work;
        }
        // Family members share a home: whoever already has one houses the rest
        for (const npc of this.npcs) {
            if (!npc._home) continue;
            const key = npc.familyGroupId != null ? `f${npc.familyGroupId}` : null;
            if (key && !famHome.has(key)) famHome.set(key, npc._home);
        }
        for (const npc of this.npcs) {
            if (npc._home) continue;
            const kin = [npc.spouseId, ...(npc.parentIds || [])].map(i => byId.get(i)).find(k => k && k._home && k._home.type === 'house' && (npc._hh == null || k._hh == null || k._hh === npc._hh));
            const key = npc.familyGroupId != null ? `f${npc.familyGroupId}` : null;
            npc._home = (kin && kin._home) || (key && famHome.get(key)) || (houses.length ? houses[next++ % houses.length] : null);
            if (key && npc._home && !famHome.has(key)) famHome.set(key, npc._home);
        }
    },

    // ──────────── THE HOUR'S BUSINESS ────────────

    /**
     * Choose and set off on what an NPC does next, by role and hour. Returns
     * false when this map has no town (the caller falls back to wandering).
     */
    _townPickActivity(npc) {
        if (this._insideBuilding || !this.townArea()) return false;
        const C = this.townLifeConfig();
        const period = this.townPeriod();
        const rnd = Utils.random;
        npc._chatWith = null;
        // Down tools at a scene: the stall, the anvil, the pew (world/innerMap/townScenes.js)
        if (this._sceneClear) this._sceneClear(npc);
        if (npc._field) this._leaveField(npc);
        if (npc._forage && this._leaveForage) this._leaveForage(npc);
        if (npc._chop && this._stopChopping) this._stopChopping(npc);
        // A sack bought at a stall home, a producer's to market (world/innerMap/townTrading.js)
        if (this._tradeCarry && this._tradeCarry(npc)) return true;
        // Carrying in what was cut: to the granary first
        if (npc._carry && this._goStore(npc)) return true;
        npc._carry = null;
        // Walking a bier to the churchyard, at a wedding in the church (ui/innerMapRites.js, ui/innerMapCourting.js): stay put
        if (npc._rite) { npc.state = 'idle'; npc.idleTimer = 3; return true; }
        // The sick abed at home, the healer's round, a frightened town, mourners (world/innerMap/townSickness.js)
        if (this._sickPick && this._sickPick(npc, period)) return true;

        // A guard: the night watch walks by night and sleeps by day's end; the day watch the reverse
        npc._awaiting = null;
        // A seat's door guard keeps the door
        if (npc._doorPost) return this._goStand(npc, npc._doorPost, 'post', npc._doorPost.face);
        if (npc.type === 'guard') {
            if (!this._guardOnDuty(npc, period)) return this._goHome(npc, 'sleep');
            if (npc._post && rnd() < 0.55) return this._goStand(npc, npc._post, 'post', npc._post.face);
            return this._goPatrol(npc);
        }
        // School, children at play and chores, the old in the sun (world/innerMap/townKin.js)
        if (this._kinPick && this._kinPick(npc, period)) return true;
        // Sweethearts walking out, flowers from the market, a broken heart at the well (world/innerMap/townCourting.js)
        if (this._courtPick && this._courtPick(npc, period)) return true;
        // The stall, the service, the crier's round, a drunk's way home (world/innerMap/townScenes.js)
        if (this._scenePick && this._scenePick(npc, period)) return true;
        // A producer's sack to market of a morning, a hawker's or a pedlar's round, a neighbour to swap with (world/innerMap/townTrading.js)
        if (this._tradePick && this._tradePick(npc, period)) return true;
        // (the hours of their own trade, meals and bed: world/innerMap/townWork.js)
        const table = (this._jobSchedule && this._jobSchedule(npc)) || C.schedule[npc.type] || C.schedule.default || DEFAULTS.schedule.default;
        const act = _weighted(table[period] || table.morning, rnd) || 'stroll';
        return this._doActivity(npc, act, period);
    },

    _doActivity(npc, act, period) {
        const A = this.townArea();
        const rnd = Utils.random;
        // At their trade, a meal, asleep in a doorway (world/innerMap/townWork.js)
        if (this._jobActivity && this._jobActivity(npc, act, period)) return true;
        const C = this.townLifeConfig();
        const find = types => this._townBuildings().filter(b => types.includes(b.type));
        const pickB = types => { const l = find(types); return l.length ? l[Math.floor(rnd() * l.length)] : null; };
        switch (act) {
            case 'home': return this._goHome(npc, period === 'night' ? 'sleep' : 'home');
            case 'work': {
                // A woodcutter out to fell a tree (world/innerMap/townWoodcutters.js)
                if (this._isTownWoodcutter && this._isTownWoodcutter(npc) && rnd() < (Number(this.townWoodConfig().share) || 0) && this._goToTree(npc)) return true;
                // A miner out to break stone (world/innerMap/townMiners.js)
                if (this._isTownMiner && this._isTownMiner(npc) && rnd() < (Number(this.townMineConfig().share) || 0) && this._goToRock(npc)) return true;
                // A herbalist out to gather herbs, berries or flowers (world/innerMap/townHerbalists.js)
                if (this._isTownHerbalist && this._isTownHerbalist(npc) && rnd() < (Number(this.townForageConfig().share) || 0) && this._goToBush(npc)) return true;
                // Out to the fields
                if (rnd() < (Number(C.fieldWork[npc.type]) || 0) && this._goToField(npc)) return true;
                if (!npc._work) return this._doActivity(npc, 'errand', period);
                const outside = rnd() < (Number(C.tendOutside[npc.type]) || 0);
                // (out front at their own prop, the smith at the anvil: world/innerMap/townScenes.js)
                const yard = outside && this._tendSpot ? this._tendSpot(npc) : null;
                if (yard) return yard.inside ? this._goInto(npc, npc._work, 'work') : this._goStand(npc, yard.spot, 'tend', yard.face);
                return outside ? this._goStand(npc, this._findPassableAdjacentTile(npc._work.q, npc._work.r), 'tend', 2)
                    : this._goInto(npc, npc._work, 'work');
            }
            case 'errand': {
                const b = pickB(npc.destinations && npc.destinations.length ? npc.destinations : ['marketplace']);
                return b ? this._goInto(npc, b, 'errand') : this._doActivity(npc, 'stroll', period);
            }
            case 'market': {
                // To a staffed stall in the square, to haggle (world/innerMap/townScenes.js)
                if (this._goShopStall && this._goShopStall(npc)) return true;
                const b = pickB(['marketplace']);
                if (b && rnd() < 0.5) return this._goInto(npc, b, 'market');
                return this._goStand(npc, this.townSpot(rnd, A.center, 7), 'market');
            }
            case 'tavern': {
                const b = pickB(['tavern', 'inn']);
                return b ? this._goInto(npc, b, 'tavern') : this._doActivity(npc, 'plaza', period);
            }
            case 'church': {
                const b = pickB(['church', 'temple']);
                return b ? this._goInto(npc, b, 'church') : this._doActivity(npc, 'plaza', period);
            }
            case 'well':
            case 'plaza': {
                const s = A.square[Math.floor(rnd() * A.square.length)];
                return this._goStand(npc, s, act);
            }
            case 'play': {
                const base = rnd() < 0.5 && npc._home ? npc._home : A.center;
                return this._goStand(npc, this.townSpot(rnd, base, 5), 'play');
            }
            case 'chat': {
                const partner = this._findChatPartner(npc);
                if (!partner) return this._doActivity(npc, 'stroll', period);
                const at = this._findPassableAdjacentTile(partner.q, partner.r);
                // Hold them where they stand till we arrive
                partner.path = null;
                partner.state = 'idle';
                partner.idleTimer = Math.max(partner.idleTimer || 0, 12);
                partner._awaiting = npc.id;
                npc._chatWith = partner.id;
                return this._goStand(npc, at, 'chat');
            }
            case 'stroll':
            default:
                return this._goStand(npc, this.townSpot(rnd, rnd() < 0.6 ? { q: npc.q, r: npc.r } : null, 14), 'stroll');
        }
    },

    // ──────────── THE FIELDS ────────────

    /** The town's fields on this map: [{ q, r, w, h }] by their anchors (bottom-left). */
    _townFields() {
        if (this._fieldsCache && this._fieldsCache.tiles === this.tiles) return this._fieldsCache.list;
        const list = [];
        for (const row of this.tiles || []) {
            for (const t of row) {
                const f = t && t.customObject && TownProps.parseFieldId(t.customObject.defId);
                if (f && !t._isInterior) list.push({ q: t.q, r: t.r, w: f.w, h: f.h });
            }
        }
        this._fieldsCache = { tiles: this.tiles, list };
        return list;
    },

    /** Walk out to a field (one of the nearer few to home) and stand at its edge, facing it. */
    _goToField(npc) {
        const fields = this._townFields();
        if (!fields.length) return false;
        const rnd = Utils.random;
        const base = npc._home || npc;
        const near = fields.map(f => ({ f, d: Math.hypot(f.q - base.q, f.r - base.r) })).sort((a, b) => a.d - b.d).slice(0, 3);
        const { f } = near[Math.floor(rnd() * near.length)];
        // The cells round its edge a hand can stand on
        const ring = [];
        const top = f.r - f.h + 1;
        // (not the corners: stood off a corner they'd face the grass, not the crop)
        for (let q = f.q; q < f.q + f.w; q++) for (const r of [top - 1, f.r + 1]) ring.push({ q, r });
        for (let r = top; r <= f.r; r++) for (const q of [f.q - 1, f.q + f.w]) ring.push({ q, r });
        const free = ring.filter(s => {
            const t = this.tiles[s.r] && this.tiles[s.r][s.q];
            return t && t.subTerrain && t.subTerrain.passable && !t.customObject && !t.customObjectPart && !t.isWater
                && !(this.npcs || []).some(o => o !== npc && o.q === s.q && o.r === s.r);
        });
        // (never out by the map's edge)
        const m = (this.townArea() || {}).margin || 8;
        const inMap = free.filter(s => s.q >= m && s.r >= m && s.q < this.width - m && s.r < this.height - m);
        if (!inMap.length) return false;
        const spot = inMap[Math.floor(rnd() * inMap.length)];
        const cq = Math.min(Math.max(spot.q, f.q), f.q + f.w - 1), cr = Math.min(Math.max(spot.r, top), f.r);
        npc._field = { q: f.q, r: f.r };
        if (this._goStand(npc, spot, 'field', _dirTo(cq - spot.q, cr - spot.r))) return true;
        npc._field = null;
        return false;
    },

    /** At the field's edge: to work, cutting if it is ripe, else hoeing and weeding. */
    _startFieldWork(npc) {
        const t = npc._field && this.tiles[npc._field.r] && this.tiles[npc._field.r][npc._field.q];
        const obj = t && t.customObject;
        if (!obj) { npc._field = null; return; }
        const crop = TownProps.fieldCrop(obj, this.worldDay || 1);
        npc.activity = crop.ripe && crop.left > 0
            ? { type: 'field', icon: '🌾', label: 'Bringing in the harvest', anim: 'halfslash', tool: 'sickle' }
            : { type: 'field', icon: '🌾', label: 'Working the field', anim: 'swing', tool: 'hoe' };
    },

    /** Done with a spell in the field: what was cut is carried in. */
    _leaveField(npc) {
        const f = npc._field;
        npc._field = null;
        const cutting = npc.activity && npc.activity.type === 'field' && npc.activity.anim === 'halfslash';
        if (npc.activity && npc.activity.type === 'field') npc.activity = null;
        const t = f && this.tiles[f.r] && this.tiles[f.r][f.q];
        // Only a hand who stood and worked (not one called away on the road out)
        if (!cutting || !t || !t.customObject || Math.hypot(npc.q - f.q, npc.r - f.r) > 12) return;
        const day = this.worldDay || 1;
        const good = TownProps.fieldCrop(t.customObject, day).good;
        const n = TownProps.takeFromField(t.customObject, day, Number(this.townLifeConfig().fieldHarvestPerSpell) || 2, this.tiles);
        if (n > 0 && good) npc._carry = { good, qty: (npc._carry && npc._carry.good === good ? npc._carry.qty : 0) + n };
    },

    /** Off to the nearest granary (or barn, mill, warehouse…) with what they carry. */
    _goStore(npc) {
        // (logs, firewood and stone to the yard: world/innerMap/townMiners.js _yardStores)
        const types = (this._yardStores && this._yardStores(npc._carry)) || this.townLifeConfig().harvestStores || DEFAULTS.harvestStores;
        const blds = (this.buildings || []).filter(b => b && !b.isPlayerProperty);
        for (const type of types) {
            const near = blds.filter(b => b.type === type).sort((a, b) => Math.hypot(a.q - npc.q, a.r - npc.r) - Math.hypot(b.q - npc.q, b.r - npc.r));
            for (const b of near.slice(0, 2)) if (this._goInto(npc, b, 'deliver')) return true;
        }
        return false;
    },

    /** Gone indoors: a load carried into a store goes into the town's food. */
    _townDelivered(npc, bldg) {
        const c = npc._carry;
        if (!c || !bldg) return;
        // (a sack bought at market, or a producer's goods for it: world/innerMap/townTrading.js)
        if (this._tradeDelivered && this._tradeDelivered(npc, bldg)) return;
        if (this._isYardLoad && this._isYardLoad(c)) { this._yardDelivered(npc, bldg); return; }
        const types = this.townLifeConfig().harvestStores || DEFAULTS.harvestStores;
        if (!types.includes(bldg.type)) return;
        npc._carry = null;
        const ref = this._currentWorldTileRef;
        TownProps.storeHarvest(ref && ref.settlement, c.good, c.qty);
    },

    _goHome(npc, act) {
        if (!npc._home) return this._goStand(npc, this.townSpot(Utils.random, { q: npc.q, r: npc.r }, 6), 'stroll');
        return this._goInto(npc, npc._home, act);
    },

    /** Walk to a building's door and go in, to stay as long as the business takes. */
    _goInto(npc, bldg, act) {
        const door = this._findPassableAdjacentTile(bldg.q, bldg.r);
        if (!this._walkTo(npc, door)) {
            // Already on the doorstep: straight in
            if (npc.q === door.q && npc.r === door.r) {
                this._enterNow(npc, bldg, act);
                return true;
            }
            return false;
        }
        npc._targetBuilding = bldg;
        npc._activity = act;
        npc._stayFor = _span(this.townLifeConfig().stay[act], Utils.random);
        return true;
    },

    _enterNow(npc, bldg, act) {
        this._townDelivered(npc, bldg);
        if (this._townEntered) this._townEntered(npc, bldg);
        npc.path = null;
        npc.state = 'inside_building';
        npc.currentBuilding = bldg.type;
        npc._insideBuildingQ = bldg.q;
        npc._insideBuildingR = bldg.r;
        npc._outsideQ = npc.q;
        npc._outsideR = npc.r;
        npc._activity = act;
        npc.idleTimer = _span(this.townLifeConfig().stay[act], Utils.random);
    },

    /** Walk to a spot and stand there a while (facing `face`, if given). */
    _goStand(npc, spot, act, face = null) {
        if (!spot) return false;
        npc._activity = act;
        npc._face = face;
        npc._targetBuilding = null;
        npc._stayFor = null;
        if (npc.q === spot.q && npc.r === spot.r) {
            this._npcArrivedInTown(npc);
            return true;
        }
        return this._walkTo(npc, spot);
    },

    /** A guard's beat: the next of the town's gates and square, by way of the streets. */
    _goPatrol(npc) {
        const A = this.townArea();
        const rnd = Utils.random;
        const marks = [...A.gates, A.center];
        const target = rnd() < 0.5 && marks.length
            ? this.townSpot(rnd, marks[Math.floor(rnd() * marks.length)], 3)
            : this.townSpot(rnd, { q: npc.q, r: npc.r }, 18);
        return this._goStand(npc, target, 'patrol');
    },

    _walkTo(npc, spot) {
        if (!spot || (spot.q === npc.q && spot.r === npc.r)) return false;
        const path = this._findPath(npc.q, npc.r, spot.q, spot.r);
        if (!path || path.length < 2) return false;
        npc.path = path.slice(1);
        npc.pathIndex = 0;
        npc.moveProgress = 0;
        npc.prevQ = npc.q;
        npc.prevR = npc.r;
        npc.state = 'walking';
        npc._targetBuilding = null;
        return true;
    },

    /** Someone idle nearby to talk to (not on watch, not busy, not in a building). */
    _findChatPartner(npc) {
        const C = this.townLifeConfig();
        const radius = Number(C.chat.radius) || 10;
        const now = _now();
        const near = (this.npcs || []).filter(o => o !== npc && o.state === 'idle' && !o._dialogFrozen && !(o._bark && o._bark.until > now)
            && o.type !== 'guard' && !o._chatWith && o._awaiting == null && !o.departing && !o._fight   // (not in a brawl: ui/innerMapBrawls.js)
            && Math.max(Math.abs(o.q - npc.q), Math.abs(o.r - npc.r)) <= radius);
        if (!near.length) return null;
        // Kin and those they get on with first
        const kin = near.filter(o => o.familyGroupId != null && o.familyGroupId === npc.familyGroupId);
        const pool = kin.length && Utils.random() < 0.6 ? kin : near;
        return pool[Math.floor(Utils.random() * pool.length)];
    },

    /** Reached the end of a walk (not into a building): stand at the business a while. */
    _npcArrivedInTown(npc) {
        const C = this.townLifeConfig();
        const act = npc._activity || 'stroll';
        npc.state = 'idle';
        npc.idleTimer = _span(C.stay[act] || C.stay.stroll, Utils.random);
        if (npc._face != null) npc.facing = npc._face;
        if (act === 'chat') this._startChat(npc);
        if (act === 'field') this._startFieldWork(npc);
        if (act === 'chop' && this._startChopping) this._startChopping(npc);
        if (act === 'forage' && this._startForaging) this._startForaging(npc);
        // At the stall, the crier's spot, the anvil, the well (world/innerMap/townScenes.js)
        if (this._sceneArrived) this._sceneArrived(npc, act);
        // The stall's real sale, a hawker's cry, a swap (world/innerMap/townTrading.js)
        if (this._tradeArrived) this._tradeArrived(npc, act);
        // At their trade, a bite at midday, a doorway to sleep in (world/innerMap/townWork.js)
        if (this._jobArrived) this._jobArrived(npc, act);
        npc._activity = null;
        npc._face = null;
    },

    /** Two folk face each other and talk; a line or two over their heads when the player is near. */
    _startChat(npc) {
        const partner = (this.npcs || []).find(o => o.id === npc._chatWith);
        npc._chatWith = null;
        if (!partner || partner._awaiting !== npc.id || partner.state !== 'idle' || Math.max(Math.abs(partner.q - npc.q), Math.abs(partner.r - npc.r)) > 1) {
            if (partner && partner._awaiting === npc.id) partner._awaiting = null;
            return;
        }
        partner._awaiting = null;
        const C = this.townLifeConfig();
        const secs = _span(C.stay.chat, Utils.random);
        npc.idleTimer = secs;
        partner.idleTimer = secs;
        npc.facing = _dirTo(partner.q - npc.q, partner.r - npc.r);
        partner.facing = _dirTo(npc.q - partner.q, npc.r - partner.r);
        const pr = Number(C.chat.playerRadius) || 22;
        if (Math.max(Math.abs(npc.q - this.playerInnerQ), Math.abs(npc.r - this.playerInnerR)) > pr) return;
        const L = C.chat.lines || {};
        const pool = [...(L[this.townPeriod()] || []), ...(L[npc.type] || []), ...(L.any || [])];
        if (!pool.length) return;
        const say = (who, other, delay) => {
            const line = pool[Math.floor(Utils.random() * pool.length)].replace(/\{name\}/g, other.name || 'friend');
            who._bark = { text: line, until: _now() + delay + 3200, from: _now() + delay };
        };
        say(npc, partner, 0);
        say(partner, npc, 2600);
    },

    /** The day watch sleeps at night; the night watch sleeps the morning away. */
    _guardOnDuty(npc, period = this.townPeriod()) {
        if (npc._nightWatch) return period !== 'morning';
        return period !== 'night';
    },

    /** Indoors and the hour says stay put (abed at night, or a guard off watch): how much longer, else 0. */
    _townStayInside(npc) {
        if (!this.townArea() || this._insideBuilding) return 0;
        // (the sick laid up stay abed, day or night: world/innerMap/townSickness.js)
        if (this._sickAbed && this._sickAbed(npc)) return _span(this.townLifeConfig().stay.sleep, Utils.random);
        if (npc.type === 'guard' && npc._home && !this._guardOnDuty(npc)) return _span(this.townLifeConfig().stay.post, Utils.random);
        // (abed by their trade's hours: the baker before dawn, the innkeeper late — world/innerMap/townWork.js)
        const js = this._jobSleeps && !npc.departing ? this._jobSleeps(npc) : null;
        if (js != null) return js && npc._home && npc._insideBuildingQ === npc._home.q && npc._insideBuildingR === npc._home.r ? _span(this.townLifeConfig().stay.sleep, Utils.random) : 0;
        const night = this.townPeriod() === 'night';
        if (!night || npc.departing) return 0;
        if (npc.type === 'guard' && npc._nightWatch) return 0;
        const home = npc._home;
        const atHome = home && npc._insideBuildingQ === home.q && npc._insideBuildingR === home.r;
        const lodging = npc.type === 'traveler' && (this.townLifeConfig().lodgings || []).includes(npc.currentBuilding);
        return atHome || lodging ? _span(this.townLifeConfig().stay.sleep, Utils.random) : 0;
    },

    /** A traveller staying the night at this house of lodging. */
    _isLodger(npc, bldg) {
        return !!(npc && bldg && npc.type === 'traveler' && (this.townLifeConfig().lodgings || []).includes(bldg.type)
            && npc._insideBuildingQ === bldg.q && npc._insideBuildingR === bldg.r);
    },

    /**
     * In bed, in a town: indoors at home (or a lodger at their inn) by night,
     * or a guard of the day watch off duty… the night watch sleeps the
     * morning away. (world/innerMap/floors.js lays them in their beds.)
     */
    _townAbed(npc) {
        const ref = this._currentWorldTileRef;
        if (!npc || !(ref && ref.settlement) || npc.state !== 'inside_building' || npc.departing) return false;
        const home = npc._home;
        const atHome = !!(home && npc._insideBuildingQ === home.q && npc._insideBuildingR === home.r);
        if (atHome && this._sickAbed && this._sickAbed(npc)) return true;
        if (npc.type === 'guard') return atHome && !this._guardOnDuty(npc);
        const js = this._jobSleeps ? this._jobSleeps(npc) : null;
        if (js != null) return js && atHome;
        if (this.townPeriod() !== 'night') return false;
        if (atHome) return true;
        const b = { type: npc.currentBuilding, q: npc._insideBuildingQ, r: npc._insideBuildingR };
        return this._isLodger(npc, b);
    },
});
