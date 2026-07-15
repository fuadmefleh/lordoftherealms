// UI — core: constructor + module-scoped helpers. Instance/static methods
// are Object.assign'd onto UI / UI.prototype by the sibling modules.
import { Utils, ActionMenu, Religion, Economy, PlayerEconomy, PlayerReligion, Infrastructure, Peoples, CustomObjects, Characters, Culture, Quests, Technology, Banking, MarketDynamics, Taxation, Hex, SaveLoad, audioManager, NpcFamily, Relationships, Housing } from './_imports.js';

// DISABLED: Inner map feature disabled
// import { InnerMapCharacters } from './innerMapCharacters.js';


// ─────────────────────────────────────────────────────────────────────────────
// Delegated event routing. Dynamically-built panel HTML uses data-ui-act /
// data-am-act attributes instead of inline onclick="window.game.ui.X()" /
// onclick="ActionMenu.Y(window.game)", so the game no longer has to be published
// on the window global. One document-level listener (attached once) routes each
// click to the CURRENT UI instance, which carries the game reference.
// ─────────────────────────────────────────────────────────────────────────────
let _activeUI = null;
let _delegationAttached = false;

function _parseArgs(raw) {
    if (!raw) return [];
    try {
        return JSON.parse(raw);
    } catch {
        return [];
    }
}

/**
 * Pure dispatch for a delegated panel click. Given the UI instance and the
 * clicked element, routes to a UI method (data-ui-act) or an ActionMenu method
 * (data-am-act, called with the game). Exported so the routing is unit-testable
 * without a real DOM. Returns the matched action name, or null if none.
 */
export function routeDelegatedClick(ui, targetEl) {
    if (!ui || !targetEl || !targetEl.closest) return null;

    const uiEl = targetEl.closest('[data-ui-act]');
    if (uiEl) {
        const method = uiEl.dataset.uiAct;
        const args = _parseArgs(uiEl.dataset.uiArgs);
        if (uiEl.dataset.uiEl) args.push(uiEl); // methods that took the clicked element (was `this`)
        if (typeof ui[method] === 'function') ui[method](...args);
        return `ui:${method}`;
    }

    const amEl = targetEl.closest('[data-am-act]');
    if (amEl) {
        const method = amEl.dataset.amAct;
        const args = _parseArgs(amEl.dataset.amArgs);
        if (ActionMenu && typeof ActionMenu[method] === 'function') ActionMenu[method](ui.game, ...args);
        return `am:${method}`;
    }

    return null;
}

function _handleDelegatedClick(e) {
    routeDelegatedClick(_activeUI, e.target);
}

export class UI {
    constructor(game) {
        this.game = game;
        this.activePanel = null;
        this._activeHudTab = 'stats';
        this.notificationLog = [];

        // Route delegated panel clicks to this (the latest) UI instance.
        _activeUI = this;
        if (!_delegationAttached && typeof document !== 'undefined' && document.addEventListener) {
            _delegationAttached = true;
            document.addEventListener('click', _handleDelegatedClick);
        }

        this.setupEventListeners();
    }
}
