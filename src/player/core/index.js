// ============================================
// PLAYER CORE — Index
// Assembles the Player class by mixing in method groups.
// Import from here to get the complete Player.
// ============================================

import { Player } from './state.js';
import { PlayerMovementMethods } from './movement.js';
import { PlayerNeedsMethods } from './needs.js';
import { PlayerLifecycleMethods } from './lifecycle.js';

Object.assign(Player.prototype, PlayerMovementMethods, PlayerNeedsMethods, PlayerLifecycleMethods);

export { Player };
