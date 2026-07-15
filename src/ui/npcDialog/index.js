// NpcDialog — assembled from ./npcDialog/*.js
import { InnerMap } from '../../world/innerMap.js';
import { ActionMenu } from '../actionMenu.js';
import { NpcFamily } from '../../systems/npcFamily.js';
import { GREETINGS, RETURNING_GREETINGS, RESPECTFUL_GREETINGS, HOSTILE_GREETINGS, RUMORS, FAREWELLS, THREAT_RESPONSES, THREAT_SUCCESS, FLATTER_RESPONSES, FLATTER_SUCCESS, TIME_COMMENTS, WEATHER_COMMENTS, NPC_QUEST_HOOKS, LOCATION_INFO, KINGDOM_INFO } from '../npcDialog.data.js';
import { dialogState } from './shared.js';
import { _mem, _dispositionLabel, _pick, _getTimeOfDay, _getWeather, _getSettlement, _getKingdom, _skillCheck, _getAttributeBonus, _getSkillTotal, _getPlayerTitle, _isPlayerRenowned, _getGreeting, _getRumor, _getFarewell } from './helpers.js';
import { _buildConversation, _render, _typewrite, _skipTypewrite, _renderChoices, _hasGiftableInventory } from './render.js';
import { _handleChoice, _showGiftSubmenu, _giveGoldGift, _giveItemGift, _showAskAboutSubmenu, _showSkillCheckResult, _animateDispositionChange, _updateDispositionBar, _createOverlay } from './choices.js';

export const NpcDialog = {

    get active() { return dialogState._active; },

    /**
     * Open a dialog with an NPC.
     * @param {object} game — Game instance
     * @param {object} npc  — NPC object from InnerMap.npcs
     */
    open(game, npc) {
        if (dialogState._active) this.close();

        dialogState._game = game;
        dialogState._npc = npc;
        dialogState._active = true;

        // Freeze this NPC
        npc._dialogFrozen = true;
        npc._preDialogState = npc.state;
        npc.state = 'dialog';
        npc.path = null;
        npc.moveProgress = 0;

        // Make the NPC face the player
        const dq = InnerMap.playerInnerQ - npc.q;
        const dr = InnerMap.playerInnerR - npc.r;
        if (Math.abs(dq) >= Math.abs(dr)) {
            npc.facing = dq >= 0 ? 3 : 1; // RIGHT : LEFT
        } else {
            npc.facing = dr >= 0 ? 2 : 0; // DOWN : UP
        }

        // Build conversation
        _buildConversation(npc);

        // Create DOM
        dialogState._overlay = _createOverlay();

        // Initial render
        setTimeout(() => _render(), 50);

        // Social need boost for starting conversation
        if (dialogState._game.player?.modifyNeed) {
            dialogState._game.player.modifyNeed('social', 5);
        }
    },

    /**
     * Close the current dialog.
     */
    close() {
        if (!dialogState._active) return;

        // Unfreeze NPC
        if (dialogState._npc) {
            dialogState._npc._dialogFrozen = false;
            if (dialogState._npc.state === 'dialog') {
                dialogState._npc.state = 'idle';
                dialogState._npc.idleTimer = 2 + Math.random() * 3;
            }
        }

        // Clean up typewriter
        if (dialogState._typewriteTimer) { clearTimeout(dialogState._typewriteTimer); dialogState._typewriteTimer = null; }

        // Remove DOM
        if (dialogState._overlay) {
            if (dialogState._overlay._escHandler) window.removeEventListener('keydown', dialogState._overlay._escHandler, true);
            dialogState._overlay.remove();
            dialogState._overlay = null;
        }

        dialogState._active = false;
        dialogState._game = null;
        dialogState._npc = null;
        dialogState._lines = [];
        dialogState._lineIndex = 0;
        dialogState._typewriteComplete = false;
    },
};
