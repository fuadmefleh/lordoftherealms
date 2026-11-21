// Where fish were fed on the street map, as fishing reads it: the edge a line cast at a cell
// gets from fish fed there lately (ui/innerMapLayers/surfaceFish.js fills biteBonus in when it
// loads; ui/mapTasks/wildTasks.js reads it). A module of its own with no imports, so the
// fishing tasks need not import the renderer's layers (they load in the other order).
//
// The light held over the water at night (ui/innerMapTorchlight.js sets `light` each frame:
// { x, y } in tiles, the light's near, bonus — 0 by day — and how it draws the fish, or null):
// surfaceFish.js gathers the fish to it, and a line cast near it bites the readier (lightBonus).
export const FishFed = {
    /** The carried light over the water this frame, or null */
    light: null,

    /** (q, r) → the extra chance of a bite a cast there gets from the light held near it */
    lightBonus(q, r) {
        const L = FishFed.light;
        if (!L || !(L.bonus > 0)) return 0;
        return Math.hypot(q + 0.5 - L.x, r + 0.5 - L.y) <= (L.near || 3.5) ? L.bonus : 0;
    },

    /** (q, r) → extra chance of a bite, 0 when none were fed near (and no light held there) */
    biteBonus: (q, r) => FishFed.lightBonus(q, r),
};
