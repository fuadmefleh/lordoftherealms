// ============================================
// PLAYER � Barrel re-export
// The Player class is defined in player/core/ and split across:
//   state.js      � constructor & world placement
//   movement.js   � hex movement, pathfinding, visibility
//   needs.js      � Sims-style needs system
//   lifecycle.js  � daily turn, food, kingdom, discovery
//   index.js      � assembles class via prototype mixins
// ============================================

export { Player } from './core/index.js';
