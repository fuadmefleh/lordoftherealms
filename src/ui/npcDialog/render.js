// npcDialog — render functions.
import { InnerMap } from '../../world/innerMap.js';
import { ActionMenu } from '../actionMenu.js';
import { NpcFamily } from '../../systems/npcFamily.js';
import { GREETINGS, RETURNING_GREETINGS, RESPECTFUL_GREETINGS, HOSTILE_GREETINGS, RUMORS, FAREWELLS, THREAT_RESPONSES, THREAT_SUCCESS, FLATTER_RESPONSES, FLATTER_SUCCESS, TIME_COMMENTS, WEATHER_COMMENTS, NPC_QUEST_HOOKS, LOCATION_INFO, KINGDOM_INFO } from '../npcDialog.data.js';
import { dialogState } from './shared.js';
import { NpcDialog } from './index.js'; // call-time facade ref (ESM cycle-safe)
import { _mem, _dispositionLabel, _pick, _getTimeOfDay, _getWeather, _getSettlement, _getKingdom, _skillCheck, _getAttributeBonus, _getSkillTotal, _getPlayerTitle, _isPlayerRenowned, _getGreeting, _getRumor, _getFarewell } from './helpers.js';
import { _handleChoice, _showGiftSubmenu, _giveGoldGift, _giveItemGift, _showAskAboutSubmenu, _showSkillCheckResult, _animateDispositionChange, _updateDispositionBar, _createOverlay } from './choices.js';

export function _buildConversation(npc) {
    const mem = _mem(npc);
    mem.timesSpoken++;
    mem.playerTitle = _getPlayerTitle();

    dialogState._lines = [{
        speaker: npc.name,
        icon: npc.icon,
        text: _getGreeting(npc),
        isNpc: true,
    }];
    dialogState._lineIndex = 0;
}

export function _render() {
    if (!dialogState._overlay) return;
    const box = dialogState._overlay.querySelector('.npc-dialog-box');
    if (!box) return;
    const line = dialogState._lines[dialogState._lineIndex];
    if (!line) return;

    // Update disposition bar
    _updateDispositionBar();

    // Speaker label
    const speakerEl = box.querySelector('.npc-dialog-speaker');
    if (speakerEl) {
        speakerEl.textContent = line.isNpc ? `${line.icon} ${line.speaker}` : '🧑 You';
        speakerEl.style.color = line.isNpc ? 'var(--gold)' : '#4FC3F7';
    }

    // Dialog text with typewriter
    const textEl = box.querySelector('.npc-dialog-text');
    if (textEl) {
        textEl.textContent = '';
        dialogState._typewriteComplete = false;
        _typewrite(textEl, line.text, 0);
    }

    // Choices
    _renderChoices(box);
}

export function _typewrite(el, text, idx) {
    if (dialogState._typewriteTimer) clearTimeout(dialogState._typewriteTimer);
    if (idx >= text.length) {
        dialogState._typewriteComplete = true;
        return;
    }
    el.textContent += text[idx];
    dialogState._typewriteTimer = setTimeout(() => _typewrite(el, text, idx + 1), 18);
}

export function _skipTypewrite(el, text) {
    if (dialogState._typewriteTimer) clearTimeout(dialogState._typewriteTimer);
    dialogState._typewriteTimer = null;
    el.textContent = text;
    dialogState._typewriteComplete = true;
}

export function _renderChoices(box) {
    const choicesEl = box.querySelector('.npc-dialog-choices');
    if (!choicesEl) return;
    choicesEl.innerHTML = '';

    const line = dialogState._lines[dialogState._lineIndex];
    if (!line || !line.isNpc) return;

    const npcType = dialogState._npc.type || 'villager';
    const mem = _mem(dialogState._npc);
    const choices = [];

    // ── Ask for rumors (can ask multiple unique ones) ──
    if (mem.rumorsTold < 3) {
        choices.push({
            icon: '💬', label: 'What news do you have?', action: 'ask_rumor',
            tooltip: `Rumors heard: ${mem.rumorsTold}/3`,
        });
    }

    // ── Ask about location ──
    const askedLocation = dialogState._lines.some(l => l._action === 'ask_location');
    if (!askedLocation) {
        choices.push({ icon: '🗺️', label: 'Tell me about this place.', action: 'ask_location' });
    }

    // ── Ask about kingdom ──
    const kingdom = _getKingdom();
    const askedKingdom = dialogState._lines.some(l => l._action === 'ask_kingdom');
    if (kingdom && !askedKingdom && (npcType === 'noble' || npcType === 'guard' || npcType === 'merchant' || npcType === 'traveler' || npcType === 'priest')) {
        choices.push({
            icon: '👑', label: `What do you know about ${kingdom.name}?`, action: 'ask_kingdom',
        });
    }

    // ── Ask about family (if NPC has family members) ──
    const hasFamily = (dialogState._npc.spouseId != null || (dialogState._npc.childIds && dialogState._npc.childIds.length > 0) ||
        (dialogState._npc.parentIds && dialogState._npc.parentIds.length > 0) || (dialogState._npc.siblingIds && dialogState._npc.siblingIds.length > 0));
    const askedFamily = dialogState._lines.some(l => l._action === 'ask_family');
    if (hasFamily && !askedFamily) {
        choices.push({
            icon: '👨‍👩‍👧', label: 'Tell me about your family.', action: 'ask_family',
            tooltip: 'Learn about their relatives',
        });
    }

    // ── Ask about someone (gossip about another NPC) ──
    const knownNpcs = NpcFamily.getKnownNpcs(dialogState._npc, InnerMap.npcs || []);
    const askedAbout = dialogState._lines.some(l => l._action === 'ask_about_npc');
    if (!askedAbout && knownNpcs.length > 0) {
        choices.push({
            icon: '🗣️', label: 'What do you think of the people here?', action: 'ask_about_npc',
            tooltip: `Knows ${knownNpcs.length} people`,
        });
    }

    // ── Trade (merchants, blacksmiths, travelers) ──
    if (npcType === 'merchant' || npcType === 'blacksmith_npc' || npcType === 'traveler') {
        choices.push({ icon: '💰', label: 'Show me your wares.', action: 'trade' });
    }

    // ── Quest hook (once per NPC, disposition >= 40) ──
    if (!mem.questOffered && mem.disposition >= 40 && NPC_QUEST_HOOKS[npcType]) {
        choices.push({
            icon: '📜', label: 'Do you need any help?', action: 'ask_quest',
            tooltip: 'Ask if they have a task for you',
        });
    }

    // ── Accept / decline a pending quest ──
    if (mem.pendingHook && !mem.questAccepted) {
        choices.push({
            icon: '✅', label: "I'll help you.", action: 'accept_quest',
        });
        choices.push({
            icon: '❌', label: "That's not for me.", action: 'decline_quest',
        });
    }

    // ── Give gift ──
    const hasGiftableItems = dialogState._game?.player?.gold > 0 || _hasGiftableInventory();
    if (hasGiftableItems && mem.disposition < 95) {
        choices.push({
            icon: '🎁', label: 'I have something for you.', action: 'give_gift',
            tooltip: `Current disposition: ${mem.disposition}`,
        });
    }

    // ── Charm / Flatter [Diplomacy check] ──
    const flattered = dialogState._lines.some(l => l._action === 'flatter');
    if (!flattered) {
        const diplomacyTotal = _getSkillTotal('diplomacy');
        const difficulty = 3;
        const chance = Math.min(100, Math.round((diplomacyTotal / difficulty) * 100));
        choices.push({
            icon: '😊',
            label: `[Charm — Diplomacy ${diplomacyTotal}/${difficulty}] You seem wise — tell me more.`,
            action: 'flatter',
            skillTag: chance >= 100 ? 'guaranteed' : chance >= 60 ? 'likely' : 'risky',
            tooltip: `${chance}% chance of success`,
        });
    }

    // ── Intimidate [Combat check] ──
    const threatened = dialogState._lines.some(l => l._action === 'threat');
    if (!threatened) {
        const combatTotal = _getSkillTotal('combat');
        const difficulty = npcType === 'guard' || npcType === 'blacksmith_npc' ? 5 : npcType === 'noble' ? 4 : 2;
        const chance = Math.min(100, Math.round((combatTotal / difficulty) * 100));
        choices.push({
            icon: '😠',
            label: `[Intimidate — Combat ${combatTotal}/${difficulty}] Watch your tongue.`,
            action: 'threat',
            skillTag: chance >= 100 ? 'guaranteed' : chance >= 60 ? 'likely' : 'risky',
            tooltip: `${chance}% chance | ⚠ May lower disposition`,
        });
    }

    // ── Persuade [Diplomacy check] — convince NPC to reveal deeper secrets ──
    if (mem.disposition >= 60 && !dialogState._lines.some(l => l._action === 'persuade')) {
        const diplomacyTotal = _getSkillTotal('diplomacy');
        const difficulty = 5;
        const chance = Math.min(100, Math.round((diplomacyTotal / difficulty) * 100));
        choices.push({
            icon: '🤝',
            label: `[Persuade — Diplomacy ${diplomacyTotal}/${difficulty}] I need your trust on something important.`,
            action: 'persuade',
            skillTag: chance >= 100 ? 'guaranteed' : chance >= 60 ? 'likely' : 'risky',
            tooltip: `${chance}% chance | Requires Warm+ disposition`,
        });
    }

    // ── Farewell ──
    choices.push({ icon: '👋', label: 'Farewell.', action: 'farewell' });

    // Render choice buttons
    for (const choice of choices) {
        const btn = document.createElement('button');
        btn.className = 'npc-dialog-choice';
        if (choice.skillTag) btn.classList.add(`npc-dialog-skill-${choice.skillTag}`);

        let html = `<span class="npc-dialog-choice-icon">${choice.icon}</span> ${choice.label}`;
        if (choice.skillTag) {
            const tagLabels = { guaranteed: '✓ Sure', likely: '● Likely', risky: '⚠ Risky' };
            html += ` <span class="npc-dialog-skill-tag npc-dialog-skill-tag-${choice.skillTag}">${tagLabels[choice.skillTag]}</span>`;
        }
        btn.innerHTML = html;

        if (choice.tooltip) btn.title = choice.tooltip;
        btn.addEventListener('click', () => _handleChoice(choice.action));
        choicesEl.appendChild(btn);
    }
}

export function _hasGiftableInventory() {
    if (!dialogState._game?.player?.inventory) return false;
    return Object.values(dialogState._game.player.inventory).some(qty => qty > 0);
}
