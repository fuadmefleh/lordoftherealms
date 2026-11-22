// FOLLOWER STEP — keeps the figures that walk behind you on the street map
// (your animals: innerMapPets.js, your companions: innerMapCompanions.js, your
// guard: innerMapEscort.js) out of walls. They used to glide in a straight
// line to their place on your trail, so a dog cut a corner through a house,
// a guard's place beside the trail sat inside a wall, and a figure set down
// from afar could land in a building.
//   walkable(x, y)                 can a figure stand at this world-px point
//   place(tx, ty, ...fallbacks)    the first of these points a figure may stand on
//   move(m, tx, ty, maxStep)       step m toward (tx, ty) without entering a wall
//                                  or crossing a blocked side; px actually moved
import { InnerMap } from '../world/innerMap.js';
import { stepBlockedBySides } from '../core/tileSides.js';

const T_PX = 32;

function _cell(v) { return Math.floor(v / T_PX); }

function _tile(q, r) {
    return InnerMap && typeof InnerMap.getTile === 'function' ? InnerMap.getTile(q, r) : null;
}

function _open(t) {
    return !!(t && t.subTerrain && t.subTerrain.passable);
}

/** Can a figure pass from cell (q0, r0) into the neighbouring cell (q1, r1)? */
function _pass(q0, r0, q1, r1) {
    if (q0 === q1 && r0 === r1) return true;
    const to = _tile(q1, r1);
    if (!_open(to)) return false;
    const from = _tile(q0, r0);
    if (from && (from.blockedSides || to.blockedSides)
        && stepBlockedBySides(from.blockedSides, to.blockedSides, q1 - q0, r1 - r0)) return false;
    return true;
}

export const FollowerStep = {
    walkable(x, y) {
        return _open(_tile(_cell(x), _cell(y)));
    },

    /** The first point given ({x, y}) that a figure may stand on, or null. */
    place(...pts) {
        for (const p of pts) if (p && FollowerStep.walkable(p.x, p.y)) return p;
        return null;
    },

    /**
     * Step m ({x, y}) toward (tx, ty) by at most maxStep px. A step that would
     * enter a wall slides along it (one axis at a time); one that can do
     * neither stops. Cutting diagonally past a corner needs both side cells
     * open. A figure already inside a wall (an old save, a door shut on it)
     * may walk out of it. Returns the px moved.
     */
    move(m, tx, ty, maxStep) {
        const dx = tx - m.x, dy = ty - m.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= 0.5 || maxStep <= 0) return 0;
        const k = Math.min(1, maxStep / dist);
        const sx = dx * k, sy = dy * k;
        const q0 = _cell(m.x), r0 = _cell(m.y);
        const stuckIn = !_open(_tile(q0, r0));
        const ok = (nx, ny) => {
            if (stuckIn) return true;
            const q1 = _cell(nx), r1 = _cell(ny);
            if (q1 === q0 && r1 === r0) return true;
            if (Math.abs(q1 - q0) > 1 || Math.abs(r1 - r0) > 1) return false;
            if (q1 !== q0 && r1 !== r0) return _pass(q0, r0, q1, r0) && _pass(q0, r0, q0, r1) && _pass(q1, r0, q1, r1) && _pass(q0, r1, q1, r1);
            return _pass(q0, r0, q1, r1);
        };
        if (ok(m.x + sx, m.y + sy)) { m.x += sx; m.y += sy; return Math.hypot(sx, sy); }
        if (sx && ok(m.x + sx, m.y)) { m.x += sx; return Math.abs(sx); }
        if (sy && ok(m.x, m.y + sy)) { m.y += sy; return Math.abs(sy); }
        return 0;
    },
};
