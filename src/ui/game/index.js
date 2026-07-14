// ============================================
// GAME INDEX — assembles Game class from split method modules
// All method groups are applied to Game.prototype via Object.assign.
// ============================================

import { Game } from './core.js';

import * as editorUIMethods from './editorUI.js';
import * as gameSetupMethods from './gameSetup.js';
import * as gameLoopMethods from './gameLoop.js';
import * as innerMapMethods from './innerMap.js';
import * as endDayMethods from './endDay.js';
import * as combatMethods from './combat.js';

Object.assign(
    Game.prototype,
    editorUIMethods,
    gameSetupMethods,
    gameLoopMethods,
    innerMapMethods,
    endDayMethods,
    combatMethods
);

export { Game };
