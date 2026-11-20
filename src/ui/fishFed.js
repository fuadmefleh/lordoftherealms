// Where fish were fed on the street map, as fishing reads it: the edge a line cast at a cell
// gets from fish fed there lately (ui/innerMapLayers/surfaceFish.js fills biteBonus in when it
// loads; ui/mapTasks/wildTasks.js reads it). A module of its own with no imports, so the
// fishing tasks need not import the renderer's layers (they load in the other order).
export const FishFed = {
    /** (q, r) → extra chance of a bite, 0 when none were fed near */
    biteBonus: () => 0,
};
