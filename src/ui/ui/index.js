// ============================================
// UI — assembled from ./ui/*.js
// ============================================
import { UI, routeDelegatedClick } from './core.js';
import './hud.js';
import './hexinfo.js';
import './panels.js';
import './inventoryPanel.js';
import './panels2.js';
import './techTreasury.js';
import './propertiesSettings.js';
import './cheats.js';
import { trackShows } from '../panelRefresh.js';

// Panels painted by the UI's own show* methods redraw after the day (ui/panelRefresh.js)
trackShows(UI.prototype);

export { UI, routeDelegatedClick };
