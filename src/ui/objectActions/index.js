// ObjectActions — assembled from ./objectActions/*.js
import { InnerMap } from '../../world/innerMap.js';
import { Hotbar } from '../hotbar.js';
import { FOOD_ITEMS, COOK_RECIPES, CRAFT_RECIPES, SMELT_RECIPES, BREW_RECIPES, HEAL_ITEMS, MODAL_STYLE, MODAL_HEADER_STYLE, MODAL_BODY_STYLE, MODAL_FOOTER_STYLE } from './data.js';
import {
    _getPlayerFoods,
    _getCookableItems,
    _canCraftRecipe,
    _consumeIngredients,
    _giveResults,
    _advanceTime,
    _applyEffects,
    _btn,
    _removeModal,
    _showSleepModal,
    _calcSleepEnergy,
    _calcSleepHealth,
    _calcSleepComfort,
    _formatHour,
    _showEatModal,
    _showRecipeModal,
    _showFishModal,
    _showStoreModal,
    _showHealModal,
} from './logic.js';
import { OBJECT_ACTIONS } from './actions.js';

export const ObjectActions = {

    /** Get the action registry (for editor UI to enumerate) */
    getAll() { return OBJECT_ACTIONS; },

    /** Get a specific action definition */
    get(actionKey) { return OBJECT_ACTIONS[actionKey] || null; },

    /** Get actions available for an object def */
    getActionsForObject(objDef) {
        if (!objDef || !objDef.actions || !Array.isArray(objDef.actions)) return [];
        return objDef.actions
            .map(key => {
                const def = OBJECT_ACTIONS[key];
                if (!def) return null;
                return { key, ...def };
            })
            .filter(Boolean);
    },

    /**
     * Build context menu items for an object's actions.
     * Returns an array of menu item objects for innerMapUI.
     */
    buildMenuItems(game, objDef, objAnchorQ, objAnchorR) {
        const actions = this.getActionsForObject(objDef);
        if (!actions.length) return [];

        const items = [];
        for (const action of actions) {
            // Check condition
            let disabled = false;
            let disabledReason = '';
            if (action.condition && typeof action.condition === 'function') {
                if (!action.condition(game)) {
                    disabled = true;
                    disabledReason = action.conditionFail || 'Not available';
                }
            }

            if (disabled) {
                items.push({
                    type: 'disabled',
                    label: `${action.icon} ${action.label}`,
                    desc: disabledReason,
                });
            } else {
                items.push({
                    type: 'action',
                    action: `obj_action_${action.key}`,
                    label: action.label,
                    icon: action.icon,
                    desc: action.desc,
                    customObjDef: objDef,
                    objAnchorQ,
                    objAnchorR,
                    _objectActionKey: action.key,
                });
            }
        }
        return items;
    },

    /**
     * Execute an object action.
     * Called from the context menu handler.
     */
    execute(game, actionKey, objDef, anchorQ, anchorR) {
        const actionDef = OBJECT_ACTIONS[actionKey];
        if (!actionDef) {
            game.ui.showNotification('❓ Unknown', `Unknown action: ${actionKey}`, 'error');
            return;
        }

        // Check condition
        if (actionDef.condition && typeof actionDef.condition === 'function') {
            if (!actionDef.condition(game)) {
                game.ui.showNotification(`${actionDef.icon} ${actionDef.label}`, actionDef.conditionFail || 'Not available right now.', 'error');
                return;
            }
        }

        // Modal actions
        if (actionDef.modal) {
            switch (actionDef.modal) {
                case 'sleep': _showSleepModal(game, objDef); return;
                case 'eat':   _showEatModal(game, objDef); return;
                case 'cook':  _showRecipeModal(game, objDef, 'Cook', '🍳', COOK_RECIPES); return;
                case 'craft': _showRecipeModal(game, objDef, 'Craft', '🔨', CRAFT_RECIPES); return;
                case 'smelt': _showRecipeModal(game, objDef, 'Smelt', '⚒️', SMELT_RECIPES); return;
                case 'brew':  _showRecipeModal(game, objDef, 'Brew Potion', '🧪', BREW_RECIPES); return;
                case 'fish':  _showFishModal(game, objDef); return;
                case 'store': _showStoreModal(game, objDef, anchorQ, anchorR); return;
                case 'heal':  _showHealModal(game, objDef); return;
            }
        }

        // Instant actions — apply effects, run callback, show message
        let message = actionDef.message;

        // Run custom onExecute if present
        if (actionDef.onExecute && typeof actionDef.onExecute === 'function') {
            const result = actionDef.onExecute(game);
            if (result) message = result;
        }

        // Apply need effects
        if (actionDef.effects) {
            _applyEffects(game, actionDef.effects);
        }

        // Apply gold cost
        if (actionDef.cost) {
            game.player.gold -= actionDef.cost;
        }

        // Advance time
        if (actionDef.timeSkip) {
            _advanceTime(actionDef.timeSkip);
        }

        // Show notification
        if (message) {
            game.ui.showNotification(`${actionDef.icon} ${actionDef.label}`, message, 'success');
        }

        game.ui.updateStats(game.player, game.world);
        Hotbar.refresh();
    },
};
