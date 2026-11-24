// InnerMap — a household in its own rooms: the beds, the cradle, the hearth.
//
// The planner (interiorPlanner.js _householdBeds) counts a house's beds from who lives
// there: one for each couple and each other grown one, the children two to a bed, a cradle
// for each infant. This file gives each of them theirs, so walking in shows the house as
// its people use it:
//
//   householdOf(building)        those whose home it is (the street's npcs: outer list when
//                                inside), oldest first, the town's travellers left out
//   householdBedPlan(b, tiles)   who sleeps where on a floor: Map id → { q, r, side, kind }
//                                — a couple side by side in one bed (side -1 / +1), each other
//                                grown one a bed, the children paired in the children's beds
//                                (then any bed left), an infant in a cradle; the house's
//                                servants (living in: npc._liveIn) in the servants' cots;
//                                never the family in a cot, a guest room's bed or a
//                                dormitory's (_hhBedRole), nor anyone in a broken one;
//                                whoever the beds run out on is left to floors.js (a bedroll)
//   _householdBedFor(npc, int.)  this one's place in that plan, for floors._placeNpcOnFloor
//   _householdReserved(int.)     the beds the household has (callers take the others first)
//   _inCradle(npc)               an infant at home lies in its cradle, day and night
//   _householdLikes(npc)         awake at home: the hearth-keeper of the day to the fire, a
//                                parent of a babe to the cradle, the children by the cradle
//                                (else the hearth and the rug) — townWork._jobFurniture's hook
//   _householdActFor(npc, type)  what they're seen doing there (furnitureUse's walk phase)
//
// Who is who reads npc.age, npc.spouseId (or the roster's p.spouse) and npc.parentIds (or
// p.parents). Pure reads of the map; the day's hearth-keeper is a hash of the day and the
// house (no RNG drawn). Ages and labels: data/interiorPlans.json `household`, `householdLife`.

import { InnerMap } from './_ref.js';
import { DataLoader, npcCanUse } from './_imports.js';

const _num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const _hash = (s) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
};
const _byId = (a, z) => String(a.id).localeCompare(String(z.id), 'en', { numeric: true });

const LIFE = {
    hearth: { icon: '🔥', label: 'tending the fire', anim: 'idle', duration: [8, 14] },
    cradleParent: { icon: '👶', label: 'minding the baby', anim: 'idle', duration: [8, 14] },
    cradleChild: { icon: '👶', label: 'by the cradle', anim: 'idle', duration: [5, 9] },
    inCradle: { icon: '👶', label: 'in the cradle' },
    childLikes: ['rug', 'fireplace', 'table'],
};

function _life() {
    const P = (DataLoader._gamedata && DataLoader._gamedata.interiorPlans) || {};
    const d = (P.householdLife && typeof P.householdLife === 'object') ? P.householdLife : {};
    return { ...LIFE, ...d };
}

function _hhCfg() {
    const P = (DataLoader._gamedata && DataLoader._gamedata.interiorPlans) || {};
    const H = P.household || {};
    const names = [H.childBed && H.childBed.name, H.childBedPoor && H.childBedPoor.name].filter(Boolean);
    const list = (v, d) => (Array.isArray(v) ? v : d);
    return {
        adultAge: _num(H.adultAge, 14), infantAge: _num(H.infantAge, 2), childBedNames: names.length ? names : ['Children\'s Bed', 'Straw Pallet'],
        // (beds that are not the family's: the servants' cots, the guest rooms', a dormitory's)
        servantRooms: list(H.servantRooms, ['servants']),
        servantBedNames: list(H.servantBedNames, ['Servant\'s Cot']),
        apartRooms: list(H.apartRooms, ['guest', 'dormitory', 'sergeant']),
        liveInTypes: list(H.liveInTypes, ['manor', 'house']),
    };
}

/** A household's servant: one in service living in (townWork._assignJobPlaces sets _liveIn), or in service to this house. */
function _isServant(npc, building) {
    if (!npc || !building) return false;
    if (npc._liveIn) return true;
    const w = npc._work;
    return npc.job === 'servant' && !!w && w.q === building.q && w.r === building.r;
}

Object.assign(InnerMap, {
    /** Those whose home this building is: [npc], oldest first (ties by id). */
    householdOf(building) {
        if (!building) return [];
        const list = (this._insideBuilding && this._outerMapState ? this._outerMapState.npcs : this.npcs) || [];
        return list.filter(n => n && n._home && n._home.q === building.q && n._home.r === building.r
            && n.type !== 'traveler' && n.state !== 'dead' && n.state !== 'gone' && !n.departing)
            .sort((a, z) => this._hhAge(z) - this._hhAge(a) || _byId(a, z));
    },

    /** Is this a home the planner beds by its household (data/interiorPlans.json household.types)? */
    _hhPlanned(building) {
        const P = (DataLoader._gamedata && DataLoader._gamedata.interiorPlans) || {};
        const types = (P.household && P.household.types) || ['house', 'farm'];
        return !!building && types.includes(String(building.type || '').replace(/^player_/, ''));
    },

    /** Their age: npc.age, else a child's guess or a grown one's. */
    _hhAge(npc) {
        if (Number.isFinite(Number(npc && npc.age))) return Number(npc.age);
        return npc && npc.type === 'child' ? 8 : 30;
    },

    _hhInfant(npc) { return this._hhAge(npc) < _hhCfg().infantAge; },
    _hhChild(npc) { const a = this._hhAge(npc), C = _hhCfg(); return a >= C.infantAge && a < C.adultAge; },

    /** Is `a` the spouse of `b` (by the map's ids or the roster's)? */
    _hhSpouses(a, b) {
        if (!a || !b || a === b) return false;
        if (a.spouseId != null && a.spouseId === b.id) return true;
        if (b.spouseId != null && b.spouseId === a.id) return true;
        const pa = a._person, pb = b._person;
        return !!(pa && pb && ((pa.spouse != null && pa.spouse === pb.id) || (pb.spouse != null && pb.spouse === pa.id)));
    },

    /** Is `a` a parent of `child`? */
    _hhParentOf(a, child) {
        if (!a || !child) return false;
        if (Array.isArray(child.parentIds) && child.parentIds.includes(a.id)) return true;
        const pa = a._person, pc = child._person;
        return !!(pa && pc && Array.isArray(pc.parents) && pc.parents.includes(pa.id));
    },

    /**
     * Whose a bed is by the room it stands in: 'servant' (a servants' room, a servant's
     * cot), 'apart' (a guest room, a dormitory — callers' and lodgers', never the family's),
     * else 'family'. `kind`: the floor's room kind (data/buildingFloors.json upperRooms).
     */
    _hhBedRole(t, kind = null) {
        const C = _hhCfg();
        const f = t && t._furniture;
        if (C.servantRooms.includes(t && t._roomId) || (f && C.servantBedNames.includes(f.name))) return 'servant';
        if (C.apartRooms.includes(t && t._roomId) || (kind && C.apartRooms.includes(kind))) return 'apart';
        return 'family';
    },

    /**
     * The head tiles of this floor's beds and cradles: { adult: [t], child: [t], cradle: [t],
     * servant: [t] } — the family's beds by size, the servants' cots apart; a guest room's
     * or a dormitory's beds in none (left to callers), nor any broken piece (world/furnitureUsable.js).
     */
    _hhPieces(tiles, kind = null) {
        const C = _hhCfg();
        const out = { adult: [], child: [], cradle: [], servant: [] };
        for (const row of tiles || []) for (const t of row || []) {
            const f = t && t._furniture;
            if (!f || (f.piece && f.piece.j)) continue;
            if ((f.type === 'cradle' || f.type === 'bed') && !npcCanUse(f)) continue;
            if (f.type === 'cradle') { out.cradle.push(t); continue; }
            if (f.type !== 'bed') continue;
            const role = this._hhBedRole(t, kind);
            if (role === 'servant') out.servant.push(t);
            else if (role === 'family') (C.childBedNames.includes(f.name) || f.art === 'straw' ? out.child : out.adult).push(t);
        }
        const order = (a, z) => a.r - z.r || a.q - z.q;
        out.adult.sort(order); out.child.sort(order); out.cradle.sort(order); out.servant.sort(order);
        return out;
    },

    /**
     * The floors of the building the player is in, as [{ k, tiles }]: the floors with beds
     * first (bedFloors: upstairs where there are any), then the rest. Outside it, `tiles`
     * alone (one floor).
     */
    _hhFloors(building, tiles = null) {
        if (!building || this._insideBuilding !== building) return tiles ? [{ k: 0, tiles }] : [];
        const n = this._floorCount || 1;
        const order = [];
        for (const k of (this.bedFloors ? this.bedFloors(building) : [0])) if (!order.includes(k)) order.push(k);
        for (let k = 0; k < n; k++) if (!order.includes(k)) order.push(k);
        const out = [];
        for (const k of order) {
            let t = null;
            const fi = k === 0 ? (this._floorInteriors && this._floorInteriors[0]) : (this._floorInterior ? this._floorInterior(k) : null);
            if (k === (this._floor || 0)) t = this.tiles;
            else t = fi ? fi.tiles : null;
            // (the floor's room kind: a dormitory's beds are nobody's of the family)
            if (t) out.push({ k, tiles: t, kind: (fi && fi._room) || null });
        }
        return out;
    },

    /**
     * Who of the household sleeps where: Map npc.id → { k, tiles, q, r, side, kind } —
     * over every floor of the house the player is in (the bed floors first), else over
     * `tiles`. Cached per house, household and floors.
     */
    householdBedPlan(building, tiles = null) {
        if (!building) return new Map();
        const floors = this._hhFloors(building, tiles);
        if (!floors.length) return new Map();
        const people = this.householdOf(building);
        const sig = `${building.q},${building.r}|${people.map(n => n.id).join(',')}`;
        const C0 = this._hhPlanCache;
        if (C0 && C0.sig === sig && C0.floors.length === floors.length && C0.floors.every((f, i) => f.tiles === floors[i].tiles)) return C0.plan;
        const plan = new Map();
        const adultBeds = [], childBeds = [], cradles = [], cots = [];
        for (const f of floors) {
            const P = this._hhPieces(f.tiles, f.kind);
            for (const t of P.adult) adultBeds.push({ t, f });
            for (const t of P.child) childBeds.push({ t, f });
            for (const t of P.cradle) cradles.push({ t, f });
            for (const t of P.servant) cots.push({ t, f });
        }
        const put = (npc, at, side, kind, cot = false) => plan.set(npc.id, { k: at.f.k, tiles: at.f.tiles, q: at.t.q, r: at.t.r, side, kind, ...(cot ? { cot: true } : {}) });
        // The house's servants to the servants' cots, one each (none left: a bedroll, floors.js);
        // the family never in a cot, a guest room's bed or a dormitory's (_hhPieces)
        const servants = people.filter(n => _isServant(n, building));
        for (const n of servants) {
            const cot = cots.shift();
            if (!cot) break;
            put(n, cot, 0, 'bed', true);
        }
        const family = people.filter(n => !servants.includes(n));
        const infants = family.filter(n => this._hhInfant(n));
        const children = family.filter(n => this._hhChild(n));
        const grown = family.filter(n => !this._hhInfant(n) && !this._hhChild(n));
        // The grown: a couple to a bed, side by side; each other one a bed of their own
        const done = new Set();
        for (const n of grown) {
            if (done.has(n.id)) continue;
            const mate = grown.find(o => !done.has(o.id) && this._hhSpouses(n, o));
            const bed = adultBeds.shift() || childBeds.shift();
            if (!bed) break;
            done.add(n.id);
            if (mate) { done.add(mate.id); put(n, bed, -1, 'bed'); put(mate, bed, 1, 'bed'); } else put(n, bed, 0, 'bed');
        }
        // The children two to a bed, theirs first, then any bed left
        for (let i = 0; i < children.length; i += 2) {
            const bed = childBeds.shift() || adultBeds.shift();
            if (!bed) break;
            const pair = children.slice(i, i + 2);
            if (pair.length === 2) { put(pair[0], bed, -1, 'bed'); put(pair[1], bed, 1, 'bed'); } else put(pair[0], bed, 0, 'bed');
        }
        // The babes in their cradles
        for (const n of infants) {
            const c = cradles.shift();
            if (!c) break;
            put(n, c, 0, 'cradle');
        }
        this._hhPlanCache = { floors, sig, plan };
        return plan;
    },

    /** This one's own bed (or cradle) in their home: { k, tiles, q, r, side, kind } or null. */
    _householdOwn(npc) {
        const b = this._insideBuilding;
        if (!npc || !b || !npc._home || npc._home.q !== b.q || npc._home.r !== b.r) return null;
        return this.householdBedPlan(b).get(npc.id) || null;
    },

    /** This one's own bed (or cradle) on this floor (`interior`) of their home, or null. */
    _householdBedFor(npc, interior) {
        const own = this._householdOwn(npc);
        return own && interior && own.tiles === interior.tiles ? own : null;
    },

    /**
     * The floor a babe's cradle stands on, for one of the house who keeps by it by day:
     * its parent, or any child of the house. Null for anyone else, or where no babe is.
     */
    _hhCradleFloor(npc, building) {
        if (!npc || this._hhInfant(npc)) return null;
        const child = this._hhChild(npc);
        const plan = this.householdBedPlan(building);
        for (const n of this.householdOf(building)) {
            const s = plan.get(n.id);
            if (!s || s.kind !== 'cradle') continue;
            if (child || this._hhParentOf(npc, n)) return s.k;
        }
        return null;
    },

    /** The beds and cradles of this floor the household sleeps in: a Set of "q,r". */
    _householdReserved(interior) {
        const b = this._insideBuilding;
        const out = new Set();
        if (!b || !interior) return out;
        for (const s of this.householdBedPlan(b).values()) if (s.tiles === interior.tiles) out.add(`${s.q},${s.r}`);
        // (and the servants' cots, slept in or not: a caller takes a guest room's bed, or any other, first)
        for (const t of this._hhPieces(interior.tiles).servant) out.add(`${t.q},${t.r}`);
        return out;
    },

    /** An infant at home, laid in its cradle (it stays there: floors.js lays it, furnitureUse.js keeps it). */
    _inCradle(npc) {
        const b = this._insideBuilding;
        return !!(npc && npc._asleep && npc._asleep.cradle && b && npc._home && npc._home.q === b.q && npc._home.r === b.r && this._hhInfant(npc));
    },

    /** Lay an infant of the house in its cradle now, by day as by night. True when laid. */
    _layInCradle(npc, interior) {
        if (!this._hhInfant(npc)) return false;
        const own = this._householdBedFor(npc, interior);
        if (!own || own.kind !== 'cradle') return false;
        const L = _life();
        npc.q = npc.prevQ = own.q;
        npc.r = npc.prevR = own.r;
        npc.path = null;
        npc.moveProgress = 0;
        npc._act = null;
        npc._asleep = { q: own.q, r: own.r, cradle: true };
        npc.activity = { type: 'cradle', icon: L.inCradle.icon, label: L.inCradle.label, anim: 'idle' };
        npc.facing = 2;
        return true;
    },

    /** The one who keeps the fire today in this house (a grown one at home, by a hash of the day). */
    _hearthKeeper(building) {
        const home = this.householdOf(building).filter(n => !this._hhInfant(n) && !this._hhChild(n)
            && n.state === 'inside_building' && n._insideBuildingQ === building.q && n._insideBuildingR === building.r);
        if (!home.length) return null;
        home.sort(_byId);
        return home[_hash(`${this.worldDay || 0}|${building.q},${building.r}|hearth`) % home.length];
    },

    /** The household's infants laid in a cradle here now. */
    _babesHere() {
        return (this.npcs || []).filter(n => this._inCradle(n));
    },

    /**
     * Awake at home (not at a meal): what they go to — the fire for the day's keeper, the
     * cradle for a babe's parent and the children, the hearth and the rug for children
     * otherwise. Null: as anyone would (townWork's own, then the type's affinity).
     */
    _householdLikes(npc) {
        const b = this._insideBuilding;
        if (!npc || !b || !npc._home || npc._home.q !== b.q || npc._home.r !== b.r || npc._homeRole) return null;
        if (npc._meal === 'breakfast' || npc._meal === 'supper' || this._hhInfant(npc)) return null;
        const babes = this._babesHere();
        if (babes.length && babes.some(c => this._hhParentOf(npc, c))) return ['cradle'];
        if (this._hhChild(npc)) return babes.length ? ['cradle', ...(_life().childLikes || [])] : (_life().childLikes || null);
        if (this._hearthKeeper(b) === npc) return ['fireplace'];
        return null;
    },

    /** What one of the household is seen doing at a piece of their home, or null for the usual. */
    _householdActFor(npc, type) {
        const likes = this._householdLikes(npc);
        if (!likes || !likes.includes(type)) return null;
        const L = _life();
        if (type === 'fireplace' && likes[0] === 'fireplace') return L.hearth;
        if (type === 'cradle') return this._hhChild(npc) ? L.cradleChild : L.cradleParent;
        return null;
    },
});
