// ============================================
// ACTION MENU — assembled from ./actionMenu/*.js
// ============================================
import { ActionMenu } from './_ref.js';
import './core.js';
import './trade.js';
import './build.js';
import './colony.js';
import './combat.js';
import './jobs.js';
import './gambling.js';
import './realm.js';
import './skills.js';
import './social.js';
import './houseShips.js';
import './titlesEspionage.js';
import './services.js';

// Expose ActionMenu globally so inline onclick handlers in dynamic HTML can access it
window.ActionMenu = ActionMenu;

export { ActionMenu };
