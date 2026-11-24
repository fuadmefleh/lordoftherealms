// InnerMap — the interior planner: a building's inside laid out by rules, not coordinates.
//
// Every building of a type used to be the same box (INTERIOR_LAYOUTS). Here each one is
// planned from its own seed (its interior key: the town, its type, its place): its size
// from its wealth tier and footprint, its rooms carved off the main room with inner walls
// and doorways (data/interiorPlans.json), the type's required pieces (INTERIOR_LAYOUTS,
// whose coordinates only count them) and each room's extras placed by placement rules
// (against the back wall, in a corner, in the open middle, by the hearth, behind the
// bar, in rows before the altar…), each kept usable and the whole house walkable from
// the door (checked by a flood on every piece set down). Then its decor: things on its
// tables, counters and shelves (tile._decor) and on its walls (tile._wallDecor).
//
// Each interior belongs to its building and its people (_interiorIdentity): its width from
// the street front's frontage, its depth from the footprint, its door where the facade's
// door is and its front windows where the facade's are (_exteriorOf); its trade's pieces
// and decor and a bed for each of its household (data/interiorPlans.json `trades`,
// `household`); its culture's taste in rugs, hangings and things about the house (`cultures`).
import { InnerMap } from './_ref.js';
import { DataLoader, CustomBuildings } from './_imports.js';

const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const _hash = (s) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
};
const _rng = (seed) => {
    let s = _hash(String(seed)) || 1;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
};
const _num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const _clamp01 = (x) => Math.max(0, Math.min(1, x));
/** A whole number from [a, b] (or a number); `lean` (0..1) tips the pick toward the top. */
const _pickRange = (rng, r, lean = null) => {
    if (!Array.isArray(r)) return Math.round(_num(r));
    const a = Math.round(_num(r[0])), b = Math.max(a, Math.round(_num(r[1], a)));
    const u = lean == null ? rng() : _clamp01(0.5 * rng() + 0.5 * lean);
    return a + Math.min(b - a, Math.floor(u * (b - a + 1)));
};
/** A value given per tier ({ poor, mid, rich }) or for all. */
const _byTier = (v, tier) => (v && typeof v === 'object' && !Array.isArray(v) ? (v[tier] || v.mid || Object.values(v)[0]) : v);
const _shuffle = (a, rng) => {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
};
const _tiersOk = (e, tier) => !Array.isArray(e.tiers) || e.tiers.includes(tier);

// The order pieces go down in: the room's anchors first (the altar, the bar, the pews, the
// hearth and the beds), the tables in the open, then what fills in round them
const PRIORITY = { far: 0, bar: 1, rows: 2, back: 3, centre: 4, aisles: 5, stacks: 5, side: 6, wall: 6, corner: 7, foot: 8, near: 8, behind: 8, ends: 9, aisle: 9, any: 10 };
// Tall pieces against a wall hide what would hang on it
const TALL = new Set(['bookshelf', 'shelf', 'cupboard', 'wardrobe', 'rack', 'barrel_rack', 'crate_stack', 'stairs']);
// (each design's front read once: def id → its exterior)
const _exteriorCache = new Map();
const _bare = (b) => String((b && b.type) || '').replace(/^player_/, '');

Object.assign(InnerMap, {
    /** The planning rules (data/interiorPlans.json), or null when they aren't loaded. */
    _planData() {
        const g = DataLoader._gamedata;
        return (g && g.interiorPlans) || null;
    },

    /**
     * What a building design shows the street (its tile-composed def: bounds, meta, layers):
     * { frontage, rows, doorFrac, front: [fractions], upper: [fractions], storeys, wall,
     * style, culture, party } — its width in tiles, its height in rows, where along the
     * front its door stands (0..1, its middle), its ground-floor and upper windows along the
     * front (0..1 each), how many storeys its windows show, what it is built of, its style,
     * and whether it stands shoulder to shoulder with its neighbours (no side windows).
     * Null for no design. Storeys are only known for a composed front (`composed` tag).
     */
    _exteriorOf(def) {
        if (!def || !def.bounds) return null;
        const key = def.id != null ? String(def.id) : null;
        if (key && _exteriorCache.has(key) && _exteriorCache.get(key).def === def) return _exteriorCache.get(key).ex;
        const b = def.bounds;
        const frontage = Math.max(1, _num(b.maxCol) - _num(b.minCol) + 1);
        const rows = Math.max(1, _num(b.maxRow) - _num(b.minRow) + 1);
        const door = (Array.isArray(def.meta) ? def.meta : []).find(m => m && m.door);
        const doorFrac = door ? _clamp01((_num(door.q) - _num(b.minCol) + 0.5) / frontage) : 0.5;
        const X = (this._planData() || {}).exterior || {};
        const upperRow = _num(X.upperRow, -4);
        const front = [], upper = [];
        const walls = def.layers && Array.isArray(def.layers.walls) ? def.layers.walls : [];
        let top = 0;
        for (const c of walls) {
            if (!c || !/window/i.test(String(c.sheetPath || ''))) continue;
            const f = _clamp01((_num(c.q) - _num(b.minCol) + 0.5) / frontage);
            if (_num(c.r) > upperRow) { if (!front.some(x => Math.abs(x - f) < 0.02)) front.push(f); }
            else {
                if (!upper.some(x => Math.abs(x - f) < 0.02)) upper.push(f);
                top = Math.min(top, _num(c.r));
            }
        }
        front.sort((a, z) => a - z); upper.sort((a, z) => a - z);
        const composed = Array.isArray(def.tags) && def.tags.includes('composed');
        const step = Math.max(1, Math.abs(upperRow) - 1);
        const storeys = composed ? (upper.length ? 1 + Math.max(1, Math.round((upperRow - top) / step) + 1) : 1) : null;
        const ex = {
            frontage, rows, doorFrac, front, upper, storeys,
            wall: def.wall || null, style: def.style || null, culture: def.culture || null,
            party: (X.partyWalls || []).includes(def.style),
        };
        if (key) _exteriorCache.set(key, { def, ex });
        return ex;
    },

    /**
     * Whose a building is: { exterior, household, trades, culture, wear, storeys } —
     * what its design shows the street, who lives there (InnerMap.npcs whose home it is:
     * ages, couples, their trades; none known → null), the culture it was built by (its
     * design's, its town's), how worn it stands (the street tile's era wear) and how many
     * floors it has (floors.js). `def` its custom design, when it has one.
     */
    _interiorIdentity(building, def = null) {
        if (!building) return null;
        const P = this._planData() || {};
        const exterior = this._exteriorOf(def);
        const type = _bare(building);
        // Its people: those whose home it is (a lodger passing through is not of the house)
        let household = null;
        const H = P.household || {};
        const npcs = Array.isArray(this.npcs) ? this.npcs : [];
        // (a servant living in sleeps in the servants' cots, not one of the family's beds: householdRooms.js)
        const here = npcs.filter(n => n && n._home && n._home.q === building.q && n._home.r === building.r
            && n.type !== 'traveler' && n.state !== 'dead' && n.state !== 'gone' && !n.departing && !n._liveIn);
        if (here.length && (H.types || ['house', 'farm']).includes(type) && !building.isPlayerOwned && !building.isPlayerProperty) {
            const adultAge = _num(H.adultAge, 14), infantAge = _num(H.infantAge, 2);
            const ids = new Set(here.map(n => n.id));
            const ageOf = (n) => (Number.isFinite(Number(n.age)) ? Number(n.age) : adultAge);
            const adults = here.filter(n => ageOf(n) >= adultAge);
            const infants = here.filter(n => ageOf(n) < infantAge).length;
            const children = here.filter(n => ageOf(n) >= infantAge && ageOf(n) < adultAge).length;
            let couples = 0;
            const paired = new Set();
            for (const n of adults) {
                if (paired.has(n.id) || n.spouseId == null || !ids.has(n.spouseId) || paired.has(n.spouseId)) continue;
                paired.add(n.id); paired.add(n.spouseId); couples++;
            }
            household = { size: here.length, adults: adults.length, couples, singles: adults.length - 2 * couples, children, infants };
        }
        // Their trades: what those of the house do (worked at home where the town has no shop of it)
        const trades = [];
        if ((((P.trades || {})._types) || ['house', 'farm']).includes(type)) {
            const owner = building.ownerId != null ? npcs.find(n => n && n.id === building.ownerId) : null;
            const people = [...(owner && !here.includes(owner) ? [owner] : []), ...here]
                .filter(n => Number.isFinite(Number(n.age)) ? Number(n.age) >= _num(H.adultAge, 14) : true)
                .sort((a, z) => String(a.id).localeCompare(String(z.id), 'en', { numeric: true }));
            for (const n of people) {
                const j = n.job || n.type;
                // (only a trade worked at home: a baker who bakes at the town's bakery keeps no oven
                // in the house — world/innerMap/townLife.js gives each their workplace, npc._work)
                const w = n._work;
                const awayAtWork = !!(w && w !== building && !(w.q === building.q && w.r === building.r) && w.type !== 'house');
                if (awayAtWork) continue;
                if (j && (P.trades || {})[j] && !trades.includes(j)) trades.push(j);
            }
        }
        // Its culture: its design's, else its town's, else its people's
        const st = this._currentWorldTileRef && this._currentWorldTileRef.settlement;
        const folk = here.find(n => n._folk && n._folk.culture);
        const culture = (exterior && exterior.culture) || (st && st.culture) || (folk && folk._folk.culture) || null;
        // How worn it stands on the street (world/townEras.js, the anchor tile's wear)
        const at = this.tiles && this.tiles[building.r] && this.tiles[building.r][building.q];
        const wear = at && at.customBuilding && Number.isFinite(at.customBuilding.wear) ? at.customBuilding.wear : 0;
        const storeys = this.floorsOf ? this.floorsOf(building) : 1;
        return { exterior, household, trades: trades.slice(0, Math.max(1, _num((P.trades || {})._max, 2))), culture, wear, storeys };
    },

    /**
     * The beds a household sleeps in (data/interiorPlans.json `household`): { adult, child:
     * [piece specs], cradles } — a bed for each couple and each other grown one (at least
     * one), the children `childrenPerBed` to a bed (straw pallets in a poor house), a cradle
     * for each infant; all held to maxBeds / maxCradles.
     */
    _householdBeds(hh, tier) {
        const H = (this._planData() || {}).household || {};
        const maxBeds = Math.max(1, _num(H.maxBeds, 6));
        const adult = Math.min(maxBeds, Math.max(1, _num(hh.couples) + Math.max(0, _num(hh.singles))));
        const per = Math.max(1, _num(H.childrenPerBed, 2));
        const nChild = Math.min(maxBeds - adult, Math.ceil(_num(hh.children) / per));
        const spec = (tier === 'poor' ? H.childBedPoor : H.childBed) || { type: 'bed', name: 'Children\'s Bed', icon: '🛏️' };
        const child = [];
        for (let i = 0; i < nChild; i++) child.push(spec);
        return { adult, child, cradles: Math.min(Math.max(0, _num(H.maxCradles, 2)), _num(hh.infants)) };
    },

    /** Does this household sleep upstairs (a floor of bedchambers over the house: floors.js)? */
    _householdUpstairs(building, who) {
        if (!who || !(who.storeys >= 2) || !this.floorRoom) return false;
        const room = this.floorRoom(building, 1);
        return !!(room && (room.furniture || []).some(f => f.type === 'bed'));
    },

    /**
     * An upper floor's room furnished for the household that sleeps there (floors.js
     * _buildUpperFloor): its beds as many as the household's, its children's pallets and
     * its cradles beside them; the room as it was where nobody is known.
     */
    _householdRoom(room, who, tier) {
        const hh = who && who.household;
        if (!hh || !room || !(room.furniture || []).some(f => f.type === 'bed')) return room;
        const beds = this._householdBeds(hh, tier || 'mid');
        const furniture = [];
        for (const f of room.furniture) {
            if (f.type !== 'bed') { furniture.push(f); continue; }
            furniture.push({ ...f, count: beds.adult });
            for (const c of beds.child) furniture.push({ type: c.type, icon: c.icon || '🛏️', name: c.name || 'Bed', count: 1, ...(c.art || tier === 'poor' ? { art: c.art || 'straw', noJoin: true } : {}) });
            if (beds.cradles) furniture.push({ type: 'cradle', icon: '🛏️', name: 'Cradle', count: beds.cradles });
        }
        return { ...room, furniture };
    },

    /**
     * A layout's furniture as pieces: [{ f, count }] — the same piece counted once however
     * many tiles the old layout drew it over (two table tiles side by side: one table).
     */
    _requiredPieces(layout) {
        const list = (layout && layout.furniture) || [];
        const key = (f) => `${f.type}|${f.name}|${f.icon}|${!!f.passable}|${f.art || ''}`;
        const used = new Set(), groups = [], byKey = new Map();
        list.forEach((f, i) => {
            if (used.has(i)) return;
            used.add(i);
            const span = this.PIECE_SPANS[f.type];
            if (span && !/horse/i.test(f.name || '')) {
                const dq = span[0] > 1 ? 1 : 0, dr = span[0] > 1 ? 0 : 1;
                const j = list.findIndex((o, k) => !used.has(k) && key(o) === key(f) && o.q === f.q + dq && o.r === f.r + dr);
                if (j >= 0) used.add(j);
            }
            const k = key(f);
            if (!byKey.has(k)) {
                const g = { f: { type: f.type, icon: f.icon, name: f.name, passable: !!f.passable, ...(f.art ? { art: f.art } : {}) }, count: 0 };
                byKey.set(k, g);
                groups.push(g);
            }
            byKey.get(k).count++;
        });
        return groups;
    },

    /**
     * Plan a building's interior. → { tiles, width, height, rooms, info } or null (no plan
     * data: the caller lays the old fixed layout). `look` is _interiorLook's; `ownDef` the
     * building's custom def (its footprint leans the size).
     *
     * A floor above the ground or a cellar under it (floors.js) is planned the same way with
     * `opts`: { size: [W, H] (the ground floor's), entry: { q, r } (the stairs it is reached
     * by: no front door, the way in kept clear and in the main room), plan (its plan spec:
     * data/interiorPlans.json `floors`), pieces ([{ f, count }]: its required pieces, the
     * floor's room of data/buildingFloors.json), floorId, upper | cellar }.
     */
    _planInterior(building, seedKey, baseLayout, look, ownDef = null, who = null, opts = {}) {
        const P = this._planData();
        if (!P || !P.types) return null;
        const bare = String((building && building.type) || '').replace(/^player_/, '');
        const planType = this.INTERIOR_LAYOUTS[bare] ? bare : 'house';
        const T = opts.plan || P.types[planType];
        if (!T) return null;
        const entry = opts.entry || null;
        const below = !!(opts.upper || opts.cellar);
        const tier = look.tier || 'mid';
        const rng = _rng(`${seedKey}|plan`);
        const ex = (who && who.exterior) || null;
        const X = P.exterior || {};

        // ── Its size: as wide as its street front, as deep as its footprint (each held to the
        // type's range about its tier, so its pieces fit); else the tier's range, leaning ──
        const size = _byTier(T.size, tier) || [[baseLayout.width, baseLayout.width], [baseLayout.height, baseLayout.height]];
        let W, H;
        if (Array.isArray(opts.size)) {
            W = Math.max(5, _num(opts.size[0], 5));
            H = Math.max(5, _num(opts.size[1], 5));
        } else if (ex) {
            const all = ['poor', 'mid', 'rich'].map(t => _byTier(T.size, t)).filter(Boolean);
            const span = (i, lean) => {
                const lo0 = Math.min(...all.map(s => _num(Array.isArray(s[i]) ? s[i][0] : s[i])));
                const hi0 = Math.max(...all.map(s => _num(Array.isArray(s[i]) ? s[i][1] : s[i])));
                const own = Array.isArray(size[i]) ? size[i] : [size[i], size[i]];
                const slack = _num(X.slack, 2);
                const lo = Math.max(lo0, _num(own[0]) - slack), hi = Math.min(hi0 + 1, _num(own[1]) + slack);
                return lo + Math.round(_clamp01(lean) * Math.max(0, hi - lo));
            };
            const fr = X.frontage || [3, 10], dp = X.depth || [5, 10];
            W = Math.max(5, span(0, (ex.frontage - fr[0]) / Math.max(1, fr[1] - fr[0])));
            H = Math.max(5, span(1, (ex.rows - dp[0]) / Math.max(1, dp[1] - dp[0])));
        } else {
            const fw = ownDef ? _num(ownDef.width) : 0, fh = ownDef ? _num(ownDef.height) : 0;
            // (no front to go by: a big household's house the roomier — household.leanFrom/leanTo)
            const hh0 = who && who.household, HH = P.household || {};
            const lean = hh0 ? _clamp01((_num(hh0.size) - _num(HH.leanFrom, 2)) / Math.max(1, _num(HH.leanTo, 7) - _num(HH.leanFrom, 2))) : null;
            W = Math.max(5, _pickRange(rng, size[0], fw > 0 ? _clamp01((fw - 3) / 6) : lean));
            H = Math.max(5, _pickRange(rng, size[1], fh > 0 ? _clamp01((fh - 5) / 5) : lean));
        }
        // The door where the street front has it (its middle, along the inside of the front
        // wall), kept a step off the corners; in the middle where the front is unknown
        let doorQ = Math.floor(W / 2);
        if (ex) {
            const m = Math.max(1, Math.min(_num(X.doorMargin, 2), Math.floor((W - 3) / 2)));
            doorQ = Math.max(m, Math.min(W - 1 - m, 1 + Math.round(ex.doorFrac * (W - 2) - 0.5)));
        }
        // (a floor reached by its stairs: the stairs stand for the door, in the main room)
        if (entry) doorQ = entry.q;
        const startQ = entry ? entry.q : doorQ, startR = entry ? entry.r : H - 1;
        // (no inner wall on the stairs or the landing round them)
        const noCarve = new Set();
        if (entry) { noCarve.add(`${entry.q},${entry.r}`); for (const [dq, dr] of D4) noCarve.add(`${entry.q + dq},${entry.r + dr}`); }
        if (entry && opts.landing) for (const dq of [-1, 1]) for (const dr of [-1, 1]) noCarve.add(`${entry.q + dq},${entry.r + dr}`);

        // ── The shell, then its rooms carved off the main room ──
        const grid = [];
        for (let r = 0; r < H; r++) {
            grid[r] = [];
            for (let q = 0; q < W; q++) {
                const door = !entry && r === H - 1 && q === doorQ;
                const wall = !door && (r === 0 || q === 0 || q === W - 1 || r === H - 1);
                grid[r][q] = { wall, door, inner: false, doorway: false, room: wall || door ? -1 : 0 };
            }
        }
        const mainSpec = T.main || {};
        const rooms = [{ id: 'main', name: mainSpec.name || 'Room', spec: mainSpec, sub: 0 }];
        const snapshot = () => grid.map(row => row.map(c => ({ ...c })));
        const restore = (snap) => { for (let r = 0; r < H; r++) for (let q = 0; q < W; q++) grid[r][q] = snap[r][q]; };
        const mainFloor = (q, r) => { const c = grid[r] && grid[r][q]; return !!(c && !c.wall && !c.door && c.room === 0 && !c.doorway); };
        const carvable = (q, r) => mainFloor(q, r) && !noCarve.has(`${q},${r}`);
        const setWall = (q, r) => Object.assign(grid[r][q], { wall: true, inner: true, room: -1, doorway: false });
        const connected = () => {
            const seen = new Set([`${startQ},${startR}`]), queue = [[startQ, startR]];
            while (queue.length) {
                const [q, r] = queue.shift();
                for (const [dq, dr] of D4) {
                    const c = grid[r + dr] && grid[r + dr][q + dq], k = `${q + dq},${r + dr}`;
                    if (!c || c.wall || seen.has(k)) continue;
                    seen.add(k); queue.push([q + dq, r + dr]);
                }
            }
            let main = 0;
            for (let r = 0; r < H; r++) for (let q = 0; q < W; q++) {
                const c = grid[r][q];
                if (!c.wall && !seen.has(`${q},${r}`)) return false;
                if (c.room === 0 && !c.wall) main++;
            }
            // (the main room keeps the better part of the house: at least a third of it)
            return main >= (W - 2) * (H - 2) / 3;
        };
        const openDoorway = (cands) => {
            if (!cands.length) return false;
            const [q, r] = cands[Math.floor(rng() * cands.length)];
            Object.assign(grid[r][q], { wall: false, inner: false, doorway: true, room: -1 });
            return true;
        };
        // A side strip the depth of the house, split into k rooms, each its doorway onto the main room
        const carveSide = (side, sw, k, base) => {
            const cols = side === 'left' ? [1, sw] : [W - 1 - sw, W - 2];
            const wallCol = side === 'left' ? sw + 1 : W - 2 - sw;
            if (side === 'left' ? wallCol > doorQ - 2 : wallCol < doorQ + 2) return false;
            for (let r = 1; r <= H - 2; r++) for (let q = Math.min(cols[0], wallCol); q <= Math.max(cols[1], wallCol); q++) if (!carvable(q, r)) return false;
            const rowsAvail = H - 2;
            let n = k;
            while (n > 1 && (rowsAvail - (n - 1)) / n < 3) n--;
            for (let r = 1; r <= H - 2; r++) setWall(wallCol, r);
            let start = 1;
            const hSub = Math.floor((rowsAvail - (n - 1)) / n);
            for (let i = 0; i < n; i++) {
                const end = i === n - 1 ? H - 2 : start + hSub - 1;
                const idx = rooms.length;
                rooms.push({ id: n > 1 ? `${base.id}_${i + 1}` : base.id, name: base.name, spec: base, sub: i });
                for (let r = start; r <= end; r++) for (let q = cols[0]; q <= cols[1]; q++) grid[r][q].room = idx;
                const across = side === 'left' ? wallCol + 1 : wallCol - 1;
                const cands = [];
                for (let r = start; r <= end; r++) if (mainFloor(across, r) && (end - start < 2 || (r !== start || i === 0) && r !== end)) cands.push([wallCol, r]);
                if (!openDoorway(cands.length ? cands : [[wallCol, start + Math.floor((end - start) / 2)]])) return false;
                if (i < n - 1) for (let q = cols[0]; q <= cols[1]; q++) setWall(q, end + 1);
                start = end + 2;
            }
            return true;
        };
        // A corner room at the back (or front) of a side, walled off with its doorway
        const carveCorner = (side, end, cw, cd, base) => {
            const cols = side === 'left' ? [1, cw] : [W - 1 - cw, W - 2];
            const wallCol = side === 'left' ? cw + 1 : W - 2 - cw;
            // (the door's column kept to the main room; a floor reached by its stairs keeps only the landing: noCarve)
            if (!entry && (side === 'left' ? wallCol > doorQ - 2 : wallCol < doorQ + 2)) return false;
            const rows = end === 'front' ? [H - 1 - cd, H - 2] : [1, cd];
            const wallRow = end === 'front' ? H - 2 - cd : cd + 1;
            if (wallRow <= 1 || wallRow >= H - 2) return false;
            const qa = Math.min(cols[0], wallCol), qb = Math.max(cols[1], wallCol);
            const ra = Math.min(rows[0], wallRow), rb = Math.max(rows[1], wallRow);
            for (let r = ra; r <= rb; r++) for (let q = qa; q <= qb; q++) if (!carvable(q, r)) return false;
            for (let r = ra; r <= rb; r++) setWall(wallCol, r);
            for (let q = qa; q <= qb; q++) setWall(q, wallRow);
            const idx = rooms.length;
            rooms.push({ id: base.id, name: base.name, spec: base, sub: 0 });
            for (let r = rows[0]; r <= rows[1]; r++) for (let q = cols[0]; q <= cols[1]; q++) grid[r][q].room = idx;
            const cands = [];
            const rowAcross = end === 'front' ? wallRow - 1 : wallRow + 1;
            for (let q = cols[0]; q <= cols[1]; q++) if (mainFloor(q, rowAcross)) cands.push([q, wallRow]);
            const colAcross = side === 'left' ? wallCol + 1 : wallCol - 1;
            for (let r = rows[0]; r <= rows[1]; r++) if (mainFloor(colAcross, r)) cands.push([wallCol, r]);
            return openDoorway(cands);
        };
        for (const spec of (T.rooms || [])) {
            if (!spec || !_tiersOk(spec, tier)) continue;
            const sides = spec.side === 'left' || spec.side === 'right' ? [spec.side] : _shuffle(['left', 'right'], rng);
            const wantW = _pickRange(rng, spec.width || [2, 3]);
            const minW = Array.isArray(spec.width) ? Math.min(...spec.width) : wantW;
            const k = Math.max(1, _pickRange(rng, _byTier(spec.split, tier) || 1));
            const depth = _pickRange(rng, spec.depth || [2, 3]);
            // (a corner room at either end: 'any')
            const ends = spec.end === 'any' ? _shuffle(['back', 'front'], rng) : [spec.end === 'front' ? 'front' : 'back'];
            let done = false;
            for (const side of sides) {
                for (const end of ends) {
                    for (let sw = wantW; sw >= Math.max(2, minW) && !done; sw--) {
                        const snap = snapshot(), before = rooms.length;
                        const ok = spec.shape === 'corner' ? carveCorner(side, end, sw, depth, spec) : carveSide(side, sw, k, spec);
                        if (ok && connected()) done = true;
                        else { restore(snap); rooms.length = before; }
                    }
                    if (done || spec.shape !== 'corner') break;
                }
                if (done) break;
            }
        }

        // ── The tiles ──
        // (a hut, hovel, croft or longhouse of an older age keeps an earth floor where its tier allows: exterior.styles)
        let floorId = opts.floorId && this.INTERIOR_FLOORS[opts.floorId] ? opts.floorId : look.floor;
        const styleLook = !below && ex && ex.style && (X.styles || {})[ex.style];
        if (styleLook && styleLook.floor && look.kind === 'home' && !(styleLook.tiers && !styleLook.tiers.includes(tier)) && this.INTERIOR_FLOORS[styleLook.floor]) floorId = styleLook.floor;
        const floorDef = this.INTERIOR_FLOORS[floorId] || this.INTERIOR_FLOORS.wood_floor;
        const ctx = { floor: floorId, floorDef, wall: look.wall, wallColor: baseLayout.wallColor, tint: look.tint, buildingType: building.type };
        const tiles = [];
        for (let r = 0; r < H; r++) {
            tiles[r] = [];
            for (let q = 0; q < W; q++) {
                const c = grid[r][q];
                const t = this._interiorTile(q, r, c.door ? 'door' : c.wall ? 'wall' : 'floor', ctx);
                if (c.inner) t._innerWall = true;
                if (c.doorway) t._doorway = true;
                tiles[r][q] = t;
            }
        }
        // Doorways belong to no room; everything else its room's name (as the castle's rooms have: seats.js)
        const roomOf = grid.map(row => row.map(c => c.room));
        const cellsOf = rooms.map(() => []);
        for (let r = 0; r < H; r++) for (let q = 0; q < W; q++) {
            const ri = roomOf[r][q];
            if (ri < 0) continue;
            cellsOf[ri].push([q, r]);
            tiles[r][q]._room = rooms[ri].name;
            tiles[r][q]._roomId = rooms[ri].id;
        }
        // The way in kept clear: the door, the tile inside it, each doorway and the tiles either side
        const reserved = entry ? new Set(noCarve) : new Set([`${doorQ},${H - 1}`, `${doorQ},${H - 2}`]);
        // (a cellar's landing: the whole square round the steps kept clear, opts.landing)
        if (entry && opts.landing) for (let dr = -1; dr <= 1; dr++) for (let dq = -1; dq <= 1; dq++) reserved.add(`${entry.q + dq},${entry.r + dr}`);
        for (let r = 0; r < H; r++) for (let q = 0; q < W; q++) {
            if (!grid[r][q].doorway) continue;
            reserved.add(`${q},${r}`);
            for (const [dq, dr] of D4) reserved.add(`${q + dq},${r + dr}`);
        }

        // ── What goes in each room: the type's required pieces, then each room's extras ──
        const groups = Array.isArray(opts.pieces) ? opts.pieces.map(g => ({ f: { ...g.f }, count: Math.max(0, _num(g.count, 1)) })) : this._requiredPieces(baseLayout);
        const baseArea = Math.max(1, (baseLayout.width - 2) * (baseLayout.height - 2));
        const area = (W - 2) * (H - 2);
        for (const g of groups) {
            if ((T.scale || []).includes(g.f.type)) {
                g.count = Math.max(Math.max(1, g.count - 1), Math.min(g.count + 2, Math.round(g.count * area / baseArea)));
            }
        }
        const units = rooms.map(() => []);
        const typePlace = { ...(P.place || {}), ...(T.place || {}) };
        const unitOf = (f, ri, req) => ({ ...f, place: f.place || typePlace[f.type] || 'wall', room: ri, req });
        // Each room spec's rooms (a split strip's several)
        const specRooms = new Map();
        rooms.forEach((rm, i) => { if (i > 0) { if (!specRooms.has(rm.spec)) specRooms.set(rm.spec, []); specRooms.get(rm.spec).push(i); } });
        for (const [spec, idxs] of specRooms) {
            for (const take of (spec.take || [])) {
                const [tt, nm] = String(take).split(':');
                for (const g of groups) {
                    if (g.f.type !== tt || (nm && g.f.name !== nm) || g.count <= 0) continue;
                    for (let i = 0; i < g.count; i++) units[idxs[i % idxs.length]].push(unitOf(g.f, idxs[i % idxs.length], true));
                    g.count = 0;
                }
            }
        }
        for (const g of groups) for (let i = 0; i < g.count; i++) units[0].push(unitOf(g.f, 0, true));
        const pieceDefs = P.pieces || {};
        const hh = (who && who.household) || null;
        const pieceOf = (e) => {
            const base = pieceDefs[e.type] || {};
            return {
                type: e.type, icon: e.icon || base.icon || '📦', name: e.name || base.name || e.type,
                passable: !!(e.passable != null ? e.passable : base.passable),
                ...(e.place || base.place ? { place: e.place || base.place } : {}),
                ...(e.art ? { art: e.art } : {}),
                ...(e.noJoin ? { noJoin: true } : {}),
                ...(e.decor ? { decor: e.decor } : {}),
                ...(e.fill ? { _fill: true } : {}),
            };
        };
        const addExtras = (list, ri, req = false) => {
            for (const e of (list || [])) {
                if (!e || !e.type || !_tiersOk(e, tier)) continue;
                if (e.onlySub != null && rooms[ri].sub !== e.onlySub) continue;
                // (a cradle or a spare bed by chance only where nobody knows who lives here)
                if (e.household && hh) continue;
                if (e.chance != null && rng() >= _num(e.chance)) continue;
                const n = e.count != null ? _pickRange(rng, e.count) : 1;
                const f = pieceOf(e);
                for (let i = 0; i < n; i++) units[ri].push(unitOf(f, ri, req));
            }
        };
        rooms.forEach((rm, ri) => addExtras(rm.spec.extras, ri));
        // Its people's trades, worked at home: the cobbler's bench, the weaver's loom (trades)
        const trades = (below ? [] : (who && who.trades) || []).map(id => ({ id, ...((P.trades || {})[id] || {}) }));
        for (const tr of trades) {
            const ri = tr.room ? Math.max(0, rooms.findIndex(rm => rm.spec && rm.spec.id === tr.room)) : 0;
            // (they come first in their room: unshifted, so a crowded house drops a stool before the loom)
            const before = units[ri].length;
            addExtras(tr.pieces, ri, true);
            const added = units[ri].splice(before);
            units[ri].unshift(...added.map(u => ({ ...u, _first: true })));
        }
        // Its culture's own things about the house: the north's furs, the south's rugs and lamps (cultures)
        const cult = (who && who.culture && (P.cultures || {})[who.culture]) || null;
        if (cult && look.kind !== 'work' && !below) addExtras(cult.extras, 0);
        // A bed for each of the household (household): one for a couple, one for each other
        // grown one, the children two to a bed (on straw in a poor house), a cradle for each
        // infant — upstairs where the house has a floor of bedchambers (floors.js), else here
        if (hh && !below && !this._householdUpstairs(building, who)) {
            const beds = this._householdBeds(hh, tier);
            const bedRoom = units.findIndex(list => list.some(u => u.type === 'bed'));
            const ri = bedRoom >= 0 ? bedRoom : 0;
            const have = units.reduce((n, list) => n + list.filter(u => u.type === 'bed').length, 0);
            const proto = (units[ri].find(u => u.type === 'bed')) || unitOf({ type: 'bed', icon: '🛏️', name: 'Bed', passable: false }, ri, true);
            for (let i = have; i < beds.adult; i++) units[ri].push({ ...proto, req: true, _first: true });
            for (const c of beds.child) units[ri].push({ ...unitOf(pieceOf(c), ri, true), _first: true });
            for (let i = 0; i < beds.cradles; i++) units[ri].push({ ...unitOf(pieceOf({ type: 'cradle' }), ri, true), _first: true });
        }
        // As the tier keeps house: the poor without finery, sleeping on straw (_furnishByTier)
        for (let ri = 0; ri < units.length; ri++) units[ri] = this._furnishByTier(units[ri], look.tier, look.kind);

        // ── Setting the pieces down ──
        const placer = this._interiorPlacer({ tiles, W, H, doorQ, roomOf, cellsOf, reserved, rng, start: { q: startQ, r: startR }, hasDoor: !entry });
        const order = [];
        for (let ri = 1; ri < rooms.length; ri++) order.push(ri);
        order.push(0);
        for (const ri of order) {
            const list = units[ri].slice().sort((a, b) => {
                const pr = (u) => { const p = PRIORITY[String(u.place).split(':')[0]] ?? 10; return (u.passable ? 20 : 0) + (u._first ? Math.min(p, 6) - 0.5 : p); };
                const pa = pr(a);
                const pb = pr(b);
                if (pa !== pb) return pa - pb;
                const sa = this.PIECE_SPANS[a.type] ? 1 : 0, sb = this.PIECE_SPANS[b.type] ? 1 : 0;
                return sb - sa;
            });
            const done = new Set();
            for (const u of list) {
                if (done.has(u)) continue;
                const rule = String(u.place).split(':')[0];
                if (rule === 'bar' && !u.passable) {
                    const bars = list.filter(o => !done.has(o) && o.place === u.place && o.type === u.type);
                    bars.forEach(o => done.add(o));
                    placer.placeRun(bars, ri);
                    continue;
                }
                if (rule === 'rows') {
                    const pews = list.filter(o => !done.has(o) && o.place === u.place && o.type === u.type);
                    pews.forEach(o => done.add(o));
                    placer.placeRows(pews, ri);
                    continue;
                }
                done.add(u);
                placer.place(u, ri);
            }
        }
        // Pews face the altar ahead of them: seen from the door, their backs
        const altars = placer.placed.filter(p => p.unit.type === 'altar');
        for (const p of placer.placed) {
            if (p.unit.type !== 'pew') continue;
            const [q, r] = p.cells[0];
            if (altars.some(a => a.unit.room === p.unit.room && a.cells.some(([, ar]) => ar < r))) tiles[r][q]._furniture.facing = 'up';
        }
        return {
            tiles, width: W, height: H,
            door: entry ? null : { q: doorQ, r: H - 1 },
            rooms: rooms.map((rm, i) => ({ id: rm.id, name: rm.name, cells: cellsOf[i].length })),
            info: { rooms, roomOf, tier, look, rng, P, who, doorQ: entry ? null : doorQ, trades, cult, upper: !!opts.upper, cellar: !!opts.cellar },
        };
    },

    /** One interior tile: floor, wall or door, in the building's stuff (shared with the fixed layouts). */
    _interiorTile(q, r, kind, ctx) {
        const isWall = kind === 'wall', isDoor = kind === 'door';
        const alt = (q + r) % 2 === 0;
        const fd = ctx.floorDef || this.INTERIOR_FLOORS.wood_floor;
        const t = {
            q, r,
            baseTerrain: isWall ? 'wall' : ctx.floor,
            subTerrain: isWall ? { id: 'wall', name: 'Wall', icon: '🧱', color: ctx.wallColor, passable: false }
                : isDoor ? { id: 'door', name: 'Door', icon: '🚪', color: '#6a4a2a', passable: true }
                    : { id: ctx.floor, name: fd.name, icon: '🏠', color: alt ? fd.color : fd.altColor, passable: true },
            explored: true,
            visible: true,
            parentTerrain: 'interior',
            encounter: null,
            building: null,
            _isInterior: true,
            _interiorBuildingType: ctx.buildingType,
            _wallMaterial: ctx.wall || null,
            _furniture: null,
            effectiveTemp: 20,
            moisture: 0.3,
            weatherType: 'clear',
        };
        // (the inside wall in the outside wall's own colour; the door drawn in the wall it stands in)
        if ((isWall || isDoor) && ctx.tint) t._wallTint = ctx.tint;
        if (isDoor) t._isDoor = true;
        return t;
    },

    /**
     * The placer of one interior: candidate tiles by rule, each piece set down only where
     * every walkable tile is still reached from the door and every piece still has a
     * reachable side to be used from.
     */
    _interiorPlacer({ tiles, W, H, doorQ, roomOf, cellsOf, reserved, rng, start = null, hasDoor = true }) {
        const self = this;
        const F = (q, r) => (tiles[r] && tiles[r][q]) || null;
        const K = (q, r) => `${q},${r}`;
        const isWall = (q, r) => { const t = F(q, r); return !t || t.baseTerrain === 'wall'; };
        const ring = new Map();         // tile → the piece whose clearance it is
        const placed = [];
        const anchors = (ri, types) => placed.filter(p => p.unit.room === ri && types.includes(p.unit.type));
        const free = (q, r, ri, u) => {
            const t = F(q, r);
            if (!t || t.baseTerrain === 'wall' || t._isDoor || t._doorway || t._furniture) return false;
            if (roomOf[r][q] !== ri || reserved.has(K(q, r))) return false;
            if (!u.passable && !u._ringOk && ring.has(K(q, r))) return false;
            return true;
        };
        // (the flood from the door over a flat grid: run on every piece set down, so kept cheap)
        const seenAt = new Uint8Array(W * H), queueAt = new Int32Array(W * H);
        const reach = () => {
            seenAt.fill(0);
            let head = 0, tail = 0;
            const s0 = start ? start.r * W + start.q : (H - 1) * W + doorQ;
            seenAt[s0] = 1; queueAt[tail++] = s0;
            while (head < tail) {
                const i = queueAt[head++], q = i % W, r = (i - q) / W;
                for (const [dq, dr] of D4) {
                    const nq = q + dq, nr = r + dr;
                    if (nq < 0 || nr < 0 || nq >= W || nr >= H) continue;
                    const j = nr * W + nq;
                    if (seenAt[j] || !tiles[nr][nq].subTerrain.passable) continue;
                    seenAt[j] = 1; queueAt[tail++] = j;
                }
            }
            return seenAt;
        };
        const seenHas = (seen, q, r) => q >= 0 && r >= 0 && q < W && r < H && seen[r * W + q] === 1;
        const valid = () => {
            const seen = reach();
            for (let r = 0; r < H; r++) for (let q = 0; q < W; q++) if (tiles[r][q].subTerrain.passable && !seen[r * W + q]) return false;
            for (const p of placed) {
                if (p.unit.passable) continue;
                if (!p.cells.some(([q, r]) => D4.some(([dq, dr]) => seenHas(seen, q + dq, r + dr)))) return false;
            }
            return true;
        };
        const set = (cells, u) => {
            for (const [q, r] of cells) {
                const t = F(q, r);
                t._furniture = { type: u.type, icon: u.icon, name: u.name, passable: !!u.passable };
                if (u.art) t._furniture.art = u.art;
                if (u.noJoin || u._single) t._furniture.noJoin = true;
                // (a trade's piece comes with its work on it: the cobbler's leather, the baker's loaves)
                if (u.decor && cells[0][0] === q && cells[0][1] === r) t._decor = u.decor;
                if (!u.passable) {
                    t._planFloor = t.subTerrain;
                    t.subTerrain = { id: `furniture_${u.type}`, name: u.name, icon: u.icon, color: self.FURNITURE_COLORS[u.type] || '#6a5a4a', passable: false };
                }
            }
        };
        const unset = (cells) => {
            for (const [q, r] of cells) {
                const t = F(q, r);
                t._furniture = null;
                delete t._decor;
                if (t._planFloor) { t.subTerrain = t._planFloor; delete t._planFloor; }
            }
        };
        const ringOf = (cells) => {
            const out = [];
            const own = new Set(cells.map(([q, r]) => K(q, r)));
            for (const [q, r] of cells) for (let dr = -1; dr <= 1; dr++) for (let dq = -1; dq <= 1; dq++) {
                const k = K(q + dq, r + dr);
                if (!own.has(k)) out.push([q + dq, r + dr]);
            }
            return out;
        };
        /** Try the piece with its head at (q, r) in the given span. */
        const tryAt = (u, ri, q, r, span, opts = {}) => {
            const cells = [];
            for (let j = 0; j < span[1]; j++) for (let i = 0; i < span[0]; i++) cells.push([q + i, r + j]);
            if (!cells.every(([cq, cr]) => free(cq, cr, ri, u))) return false;
            if (opts.clear && !u.passable) {
                // (clearance: nothing in the way round it, and no wall right up against it)
                for (const [cq, cr] of ringOf(cells)) {
                    const t = F(cq, cr);
                    if (opts.clear === 'open' && isWall(cq, cr)) return false;
                    if (t && t._furniture && !t._furniture.passable) return false;
                    if (opts.clear === 'open' && ring.has(K(cq, cr))) return false;
                }
            }
            set(cells, u);
            if (!u.passable && !valid()) { unset(cells); return false; }
            const p = { unit: u, cells };
            placed.push(p);
            if (opts.clear && !u.passable) for (const [cq, cr] of ringOf(cells)) ring.set(K(cq, cr), p);
            return true;
        };
        const centroid = (ri) => {
            const cs = cellsOf[ri];
            const q = cs.reduce((s, c) => s + c[0], 0) / Math.max(1, cs.length);
            const r = cs.reduce((s, c) => s + c[1], 0) / Math.max(1, cs.length);
            const hasDoorCol = cs.some(([cq]) => cq === doorQ);
            return { q: hasDoorCol && ri === 0 ? doorQ : q, r };
        };
        const bounds = (ri) => {
            const cs = cellsOf[ri];
            return {
                x0: Math.min(...cs.map(c => c[0])), x1: Math.max(...cs.map(c => c[0])),
                y0: Math.min(...cs.map(c => c[1])), y1: Math.max(...cs.map(c => c[1])),
            };
        };
        const jitter = (list, score) => list.map(c => ({ c, s: score(c) + rng() * 0.9 })).sort((a, b) => a.s - b.s).map(x => x.c);
        // A room's stack rows (the 'stacks' rule), worked out once a room so every piece keeps to them
        const stacks = new Map();
        const stackPlan = (ri, gap0) => {
            if (stacks.has(ri)) return stacks.get(ri);
            const b = bounds(ri);
            const gap = Math.max(3, Math.round(gap0));
            const midQ = (b.x0 + b.x1) / 2;
            const aisleQ = doorQ >= b.x0 && doorQ <= b.x1 ? doorQ : Math.round(midQ);
            // (the cross aisle at the end away from the steps; and every `gap` columns from it)
            const endQ = aisleQ <= midQ ? b.x1 : b.x0;
            const cross = new Set([aisleQ, endQ]);
            for (let q = endQ; q >= b.x0 && q <= b.x1; q += endQ === b.x1 ? -gap : gap) cross.add(q);
            const rows = [];
            for (let r = b.y0; r <= b.y1; r++) {
                const k = r - b.y0;
                if (k > 0 && k % 3 === 1) continue;
                // (the lower of a double row can't stand against the front wall: nothing to reach it from)
                if (k > 0 && k % 3 === 0 && r === b.y1) continue;
                rows.push(r);
            }
            const inRoom = new Set(cellsOf[ri].map(([q, r]) => K(q, r)));
            const cells = [];
            for (const r of rows) {
                const line = [];
                for (let q = b.x0; q <= b.x1; q++) {
                    if (!inRoom.has(K(q, r))) continue;
                    // (the back row runs the wall's length; the double rows break at the cross aisles)
                    if (r !== b.y0 && cross.has(q)) continue;
                    line.push([q, r]);
                }
                // (the far end of a row first, toward the steps last)
                line.sort((a, z) => Math.abs(z[0] - aisleQ) - Math.abs(a[0] - aisleQ));
                cells.push(...line);
            }
            const S = { cells, rows, cross };
            stacks.set(ri, S);
            return S;
        };
        /** Head tiles for a rule, in the order to try them. */
        const candidates = (rule, arg, ri, span) => {
            const cs = cellsOf[ri];
            if (!cs.length) return [];
            const wallN = ([q, r]) => isWall(q, r - 1) && !F(q, r - 1)?._isDoor;
            const wallW = ([q, r]) => isWall(q - 1, r), wallE = ([q, r]) => isWall(q + span[0], r);
            // (the front wall too, away from the door)
            const wallS = ([q, r]) => (r + span[1] === H - 1 ? (!hasDoor || Math.abs(q - doorQ) > 1) : isWall(q, r + span[1]));
            const c0 = centroid(ri);
            switch (rule) {
            case 'back': return _shuffle(cs.filter(wallN), rng);
            case 'side': return _shuffle(cs.filter(c => wallW(c) || wallE(c)), rng);
            case 'corner': return _shuffle(cs.filter(c => (wallN(c) || wallS(c)) && (wallW(c) || wallE(c))), rng);
            case 'wall': {
                const back = _shuffle(cs.filter(wallN), rng);
                const sides = _shuffle(cs.filter(c => !wallN(c) && (wallW(c) || wallE(c) || wallS(c))), rng);
                return [...back, ...sides];
            }
            case 'centre': {
                const mid = (q, r) => Math.abs(q + (span[0] - 1) / 2 - c0.q) + Math.abs(r + (span[1] - 1) / 2 - c0.r);
                return jitter(cs, ([q, r]) => mid(q, r));
            }
            case 'far': {
                const b = bounds(ri);
                const deep = b.y1 - b.y0 >= 8;
                const rows = deep ? [b.y0 + 1, b.y0] : [b.y0];
                const out = [];
                for (const row of rows) {
                    const line = cs.filter(([, r]) => r === row);
                    line.sort((a, z) => Math.abs(a[0] + (span[0] - 1) / 2 - c0.q) - Math.abs(z[0] + (span[0] - 1) / 2 - c0.q));
                    out.push(...line);
                }
                return out;
            }
            case 'near': case 'foot': case 'behind': case 'ends': {
                const types = String(arg || '').split('|');
                const anc = anchors(ri, rule === 'behind' ? ['bar'] : types);
                if (!anc.length) return [];
                const out = [], seen = new Set();
                const add = (q, r, s) => { const k = K(q, r); if (!seen.has(k)) { seen.add(k); out.push({ c: [q, r], s }); } };
                for (const a of anc) {
                    const qs = a.cells.map(c => c[0]), rs = a.cells.map(c => c[1]);
                    const qa = Math.min(...qs), qb = Math.max(...qs), ra = Math.min(...rs), rb = Math.max(...rs);
                    if (rule === 'foot') {
                        add(qa, rb + 1, 0);
                        for (let r = ra; r <= rb; r++) { add(qa - 1, r, 1 + (rb - r)); add(qb + 1, r, 1 + (rb - r)); }
                    } else if (rule === 'ends') {
                        add(qa - span[0], ra, rng()); add(qb + 1, ra, rng());
                    } else if (rule === 'behind') {
                        for (let q = qa - 1; q <= qb + 1; q++) for (let r = ra - 2; r < ra; r++) add(q, r, (ra - r) + rng());
                    } else {
                        for (let r = ra - 2; r <= rb + 2; r++) for (let q = qa - 2; q <= qb + 2; q++) {
                            const d = Math.max(Math.max(qa - q, q - qb, 0), Math.max(ra - r, r - rb, 0));
                            if (d >= 1) add(q, r, d + rng() * 0.9);
                        }
                    }
                }
                return out.sort((a, z) => a.s - z.s).map(x => x.c);
            }
            case 'aisles': {
                // Storage in rows: against the back wall, then double rows between walkways; the door's column kept open
                const b = bounds(ri);
                const out = [];
                const left = rng() < 0.5;
                for (let r = b.y0; r <= b.y1 - 1; r++) {
                    const k = (r - b.y0) % 3;
                    if (r !== b.y0 && k === 1) continue;
                    if (r > b.y0 && k === 0 && r === b.y1 - 1) continue;
                    const line = cs.filter(([q, rr]) => rr === r && q !== doorQ);
                    line.sort((a, z) => (left ? a[0] - z[0] : z[0] - a[0]));
                    out.push(...line);
                }
                return out;
            }
            case 'stacks': {
                // A cellar's casks, crates and sacks in rows across it, filled from the back: the
                // row against the back wall, then double rows between walkways; cross aisles kept
                // open down the steps' column, at the far end and every `arg` columns between
                const S = stackPlan(ri, _num(arg, 5));
                return S.cells;
            }
            case 'aisle': {
                const b = bounds(ri);
                return cs.filter(([q, r]) => q === doorQ && r > b.y0 + 1 && r < H - 2).sort((a, z) => a[1] - z[1]);
            }
            default: return _shuffle(cs.slice(), rng);
            }
        };
        const spanOf = (u) => {
            const s = self.PIECE_SPANS[u.type];
            return s && !u.noJoin && !/horse/i.test(u.name || '') ? s : null;
        };
        const tryRule = (u, ri, rule, arg, sp) => {
            const v = sp[0] * sp[1] > 1 || !spanOf(u) ? { ...u } : { ...u, _single: true };
            if (rule === 'ends') v._ringOk = true;
            const opts = rule === 'centre' ? { clear: 'open' } : rule === 'centreLoose' ? { clear: 'own' } : {};
            for (const [q, r] of candidates(rule === 'centreLoose' ? 'centre' : rule, arg, ri, sp)) {
                if (tryAt(v, ri, q, r, sp, opts)) return true;
            }
            return false;
        };
        const place = (u, ri) => {
            const [rule, arg] = String(u.place || 'wall').split(':');
            if (rule === 'aisle' && u.passable) {
                // (a runner the length of the aisle)
                let any = false;
                for (const [q, r] of candidates('aisle', null, ri, [1, 1])) if (tryAt(u, ri, q, r, [1, 1])) any = true;
                if (any) return true;
            }
            // (a piece filling out a cellar's rows — _fill — goes in its rows or not at all)
            const chain = u._fill ? [rule] : rule === 'centre' ? ['centre', 'centreLoose', 'wall', 'any'] : [rule, 'wall', 'any'];
            // (at its full size anywhere the rules allow before a tile's piece)
            const span = spanOf(u);
            const spans = span ? [span, [1, 1]] : [[1, 1]];
            for (const sp of spans) for (const step of chain) if (tryRule(u, ri, step, step === rule ? arg : null, sp)) return true;
            // A required piece crowded out of its room stands in the main room
            if (u.req && !u._fill && ri !== 0) for (const sp of spans) for (const step of ['wall', 'any']) if (tryRule({ ...u, room: 0 }, 0, step, null, sp)) return true;
            return false;
        };
        /** A counter run (the bar, the tellers'): along a row near the back, its end against a side wall, room behind for the keeper. */
        const placeRun = (list, ri) => {
            if (!list.length) return;
            const n = list.length;
            const b = bounds(ri);
            const runs = [];
            for (const rb of [b.y0 + 1, b.y0 + 2]) {
                for (let q = b.x0; q + n - 1 <= b.x1; q++) {
                    let ok = true;
                    for (let i = 0; i < n && ok; i++) {
                        if (!free(q + i, rb, ri, list[0]) || !free(q + i, rb - 1, ri, list[0])) ok = false;
                    }
                    if (!ok) continue;
                    const againstWall = isWall(q - 1, rb) || isWall(q + n, rb);
                    runs.push({ q, rb, s: (againstWall ? 0 : 2) + (rb - b.y0 - 1) + rng() * 1.5 });
                }
            }
            runs.sort((a, z) => a.s - z.s);
            for (const run of runs) {
                const got = [];
                let ok = true;
                for (let i = 0; i < n; i++) {
                    if (!tryAt({ ...list[i] }, ri, run.q + i, run.rb, [1, 1])) { ok = false; break; }
                    got.push(placed[placed.length - 1]);
                }
                if (ok) {
                    // (the keeper's place behind the middle of it)
                    reserved.add(K(run.q + Math.floor(n / 2), run.rb - 1));
                    return;
                }
                for (const p of got) { unset(p.cells); placed.splice(placed.indexOf(p), 1); }
            }
            for (const u of list) place({ ...u, place: 'wall' }, ri);
        };
        /** Pews in rows facing the far end, either side of the aisle up the middle. */
        const placeRows = (list, ri) => {
            if (!list.length) return;
            const b = bounds(ri);
            const alt = anchors(ri, ['altar', 'throne', 'statue']);
            const front = alt.length ? Math.max(...alt.flatMap(a => a.cells.map(c => c[1]))) : b.y0 - 1;
            const aisle = cellsOf[ri].some(([q]) => q === doorQ) ? doorQ : Math.round(centroid(ri).q);
            const rows = [];
            for (let r = front + 2; r <= Math.min(b.y1, H - 3); r += 2) rows.push(r);
            if (!rows.length) { for (const u of list) place({ ...u, place: 'wall' }, ri); return; }
            // Each row full either side of the aisle (up to three abreast), as many rows as the nave
            // holds; at least the pieces asked for
            const side = b.x1 - b.x0 >= 6 ? 1 : 0;   // (a side aisle along each wall where the nave is wide)
            const blockW = Math.min(3, aisle - (b.x0 + side), (b.x1 - side) - aisle);
            let i = 0;
            for (const r of rows) {
                for (let d = 1; d <= Math.max(1, blockW); d++) {
                    for (const q of [aisle - d, aisle + d]) {
                        if (q < b.x0 || q > b.x1) continue;
                        const u = i < list.length ? list[i] : { ...list[0], req: false };
                        if (tryAt(u, ri, q, r, [1, 1])) i++;
                    }
                }
            }
            for (; i < list.length; i++) place({ ...list[i], place: 'wall' }, ri);
        };
        return { place, placeRun, placeRows, placed };
    },

    /**
     * The things about the house (data/interiorPlans.json): on its tables, counters, desks
     * and shelves (tile._decor), and on the walls facing into its rooms (tile._wallDecor,
     * tile._wallDecorFace 'down' | 'left' | 'right' | 'up': the side the room lies): windows
     * along the back wall at the tier's spacing (curtained in homes), in the front wall where
     * the street front shows them (its ground-floor windows), a side window for a room the
     * back wall misses (never through a wall shared with the house next door), then the
     * room's own hangings, its trade's, its culture's and the tier's finery — fewer where
     * the house stands worn.
     */
    _decorateInterior(tiles, w, h, info) {
        if (!info || !info.P) return;
        const { P, rooms, roomOf, tier, look, rng } = info;
        const who = info.who || null, ex = (who && who.exterior) || null;
        const trades = info.trades || [], cult = info.cult || null;
        const X = P.exterior || {};
        const items = new Set(P.decorItems || []), walls = new Set(P.wallDecor || []);
        const TD = (P.tiers || {})[tier] || {};
        const on = new Set(P.decorOn || []);
        const F = (q, r) => (tiles[r] && tiles[r][q]) || null;
        const pick = (list) => (list.length ? list[Math.floor(rng() * list.length)] : null);
        const work = look.kind === 'work';
        // (a worn house keeps less about it: exterior.wear, by the street's era wear 0..2)
        const wearK = _num((X.wear || [1, 0.85, 0.6])[Math.max(0, Math.min(2, _num(who && who.wear)))], 1);
        const cultItems = (!work && cult && cult.items) || [];
        const tradeItems = trades.flatMap(tr => tr.items || []);
        // ── On the furniture ──
        for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) {
            const t = tiles[r][q], f = t._furniture;
            if (!f || !on.has(f.type) || f.passable || t._decor) continue;
            if (rng() >= _num(TD.itemChance, 0.6) * wearK) continue;
            const ri = roomOf[r] ? roomOf[r][q] : 0;
            const spec = (rooms[ri >= 0 ? ri : 0] || rooms[0]).spec || {};
            const own = (P.itemsFor || {})[f.type] || [];
            let pool;
            if (f.type === 'table' || f.type === 'bar') pool = (spec.items && spec.items.length ? spec.items : own).slice();
            else if (f.type === 'desk' || f.type === 'workbench') pool = own.concat((spec.items || []).filter(x => x === 'papers' || x === 'books' || x === 'tools' || x === 'herbs' || x === 'coins'));
            else pool = own.concat(spec.items || []);
            if (!work && !info.cellar && f.type !== 'workbench') pool = pool.concat(TD.items || []);
            // (the house's trade and its culture leave their things about: twice as likely as any one other)
            if (f.type !== 'bar') pool = pool.concat(tradeItems, tradeItems, cultItems);
            const id = pick(pool.filter(x => items.has(x)));
            if (id) t._decor = id;
        }
        // ── On the walls ──
        const floorAt = (q, r) => { const t = F(q, r); return !!(t && t.baseTerrain !== 'wall' && !t._isDoor); };
        const faceOf = (q, r) => {
            if (floorAt(q, r + 1)) return { face: 'down', at: [q, r + 1] };
            if (floorAt(q + 1, r)) return { face: 'right', at: [q + 1, r] };
            if (floorAt(q - 1, r)) return { face: 'left', at: [q - 1, r] };
            return null;
        };
        const roomAt = ([q, r]) => { const ri = roomOf[r] && roomOf[r][q]; return ri >= 0 ? rooms[ri] : null; };
        const home = look.kind === 'home';
        const gap = Math.max(2, Math.round(_num(TD.windowGap, 3)));
        const off = Math.floor(rng() * gap);
        const curtainsOk = (spec) => home || (spec.wall || []).includes('curtains');
        const hang = (t, id, face) => { if (walls.has(id)) { t._wallDecor = id; t._wallDecorFace = face; } };
        const glaze = (spec) => (curtainsOk(spec) && rng() < _num(TD.curtains, 0) ? 'curtains' : 'window');
        const windowed = new Set();
        // (a cellar is underground: no windows at all; a floor above has its front's upper ones)
        const cellar = !!info.cellar, upper = !!info.upper;
        const frontWins = cellar || !ex ? [] : upper ? (ex.upper || []) : (ex.front || []);
        // Windows along the back wall (a front with none — a hovel's — has few at the back too)
        let backLeft = cellar ? 0 : ex && !frontWins.length ? Math.max(0, _num(X.blindBackMax, 1)) : Infinity;
        for (let q = 1; q < w - 1 && backLeft > 0; q++) {
            const t = tiles[0][q];
            if (t.baseTerrain !== 'wall' || (q + off) % gap !== 0) continue;
            const fc = faceOf(q, 0);
            const rm = fc && fc.face === 'down' ? roomAt(fc.at) : null;
            if (!rm || rm.spec.windows === false) continue;
            hang(t, glaze(rm.spec), 'down');
            windowed.add(rm);
            backLeft--;
        }
        // Windows in the front wall where the street front has them (either side of the door)
        if (frontWins.length) {
            // (upstairs there is no door in the front wall to keep off)
            const doorQ = upper ? -9 : info.doorQ != null ? info.doorQ : Math.floor(w / 2);
            const fits = (q) => {
                const t = F(q, h - 1), inside = F(q, h - 2);
                // (in the wall, off the door's frame, not where an inner wall meets the front, not beside another)
                if (q < 1 || q > w - 2 || !t || t.baseTerrain !== 'wall' || t._wallDecor || t._isDoor || Math.abs(q - doorQ) <= 1) return null;
                if (!inside || inside.baseTerrain === 'wall') return null;
                if ([-1, 1].some(d => { const o = F(q + d, h - 1); return !!(o && o._wallDecor); })) return null;
                const rm = roomAt([q, h - 2]);
                return rm && rm.spec.windows !== false ? rm : null;
            };
            for (const f of frontWins) {
                const at = Math.max(1, Math.min(w - 2, 1 + Math.round(f * (w - 2) - 0.5)));
                const side = f < ex.doorFrac ? -1 : 1;
                // (where the facade has it, else the nearest good stretch of wall on the window's own side of the door)
                for (const d of [0, 1, -1, 2, -2]) {
                    const q = at + d;
                    if (!upper && (q - doorQ) * side <= 0) continue;
                    const rm = fits(q);
                    if (!rm) continue;
                    hang(F(q, h - 1), glaze(rm.spec), 'up');
                    windowed.add(rm);
                    break;
                }
            }
        }
        // A side window for a room the back and front walls miss (none through a party wall)
        if (!(ex && ex.party) && !cellar) {
            rooms.forEach((rm, ri) => {
                if (windowed.has(rm) || rm.spec.windows === false || ri === 0) return;
                const side = [];
                for (let r = 1; r < h - 1; r++) for (const q of [0, w - 1]) {
                    const fc = tiles[r][q].baseTerrain === 'wall' ? faceOf(q, r) : null;
                    if (fc && fc.face !== 'down' && roomOf[fc.at[1]][fc.at[0]] === ri) side.push([q, r, fc.face]);
                }
                if (!side.length) return;
                const [q, r, face] = side[Math.floor(side.length / 2)];
                hang(tiles[r][q], 'window', face);
            });
        }
        // The trade's own sign on the wall (the hunter's antlers, the scribe's map): one, by the work
        const hangable = (q, r) => {
            const t = F(q, r);
            if (!t || t.baseTerrain !== 'wall' || t._wallDecor || r >= h - 1) return null;
            const fc = faceOf(q, r);
            if (!fc) return null;
            const below = F(fc.at[0], fc.at[1]);
            if (below._doorway || (below._furniture && TALL.has(below._furniture.type))) return null;
            return fc;
        };
        for (const tr of trades) {
            const id = (tr.wall || [])[0];
            if (!id || !walls.has(id)) continue;
            let done = false;
            for (let r = 0; r < h - 1 && !done; r++) for (let q = 0; q < w && !done; q++) {
                const fc = hangable(q, r);
                if (!fc || (roomOf[fc.at[1]] && roomOf[fc.at[1]][fc.at[0]]) !== 0) continue;
                hang(F(q, r), id, fc.face);
                done = true;
            }
        }
        // The room's own hangings, its trade's and culture's, and the tier's finery
        const near = (q, r) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dq, dr]) => { const o = F(q + dq, r + dr); return !!(o && o._wallDecor); });
        const wallK = wearK * (cult && !work ? _num(cult.wallChance, 1) : 1);
        const tradeWall = trades.flatMap(tr => tr.wall || []);
        const cultWall = (!work && cult && cult.wall) || [];
        for (let r = 0; r < h - 1; r++) for (let q = 0; q < w; q++) {
            const fc = hangable(q, r);
            if (!fc) continue;
            const rm = roomAt(fc.at);
            if (!rm || near(q, r) || rng() >= _num(TD.wallChance, 0.2) * wallK) continue;
            const pool = (rm.spec.wall || []).filter(x => x !== 'window' && x !== 'curtains');
            // (no finery hung in a cellar: its own torches, shelves and herbs)
            if (!work && !info.cellar) pool.push(...(TD.wall || []));
            if (rm === rooms[0]) pool.push(...tradeWall);
            pool.push(...cultWall.filter(x => x !== 'window' && x !== 'curtains'));
            const id = pick(pool);
            if (id) hang(F(q, r), id, fc.face);
        }
    },
});
