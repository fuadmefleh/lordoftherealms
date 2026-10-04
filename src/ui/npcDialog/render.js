// npcDialog — render functions.
import { InnerMap } from '../../world/innerMap.js';
import { ActionMenu } from '../actionMenu.js';
import { NpcFamily } from '../../systems/npcFamily.js';
import { NpcBrain } from '../../systems/npcBrain.js';
import { NpcDisposition } from '../../systems/npcDisposition.js';
import { GREETINGS, RETURNING_GREETINGS, RESPECTFUL_GREETINGS, HOSTILE_GREETINGS, RUMORS, FAREWELLS, THREAT_RESPONSES, THREAT_SUCCESS, FLATTER_RESPONSES, FLATTER_SUCCESS, TIME_COMMENTS, WEATHER_COMMENTS, NPC_QUEST_HOOKS, LOCATION_INFO, KINGDOM_INFO } from '../npcDialog.data.js';
import { dialogState } from './shared.js';
import { NpcDialog } from './index.js'; // call-time facade ref (ESM cycle-safe)
import { _mem, _dispositionLabel, _pick, _getTimeOfDay, _getWeather, _getSettlement, _getKingdom, _skillCheck, _getAttributeBonus, _getSkillTotal, _getPlayerTitle, _isPlayerRenowned, _getGreeting, _getRumor, _getFarewell } from './helpers.js';
import { _handleChoice, _showGiftSubmenu, _giveGoldGift, _giveItemGift, _showAskAboutSubmenu, _showSkillCheckResult, _animateDispositionChange, _updateDispositionBar, _createOverlay } from './choices.js';

export function _buildConversation(npc) {
    const mem = _mem(npc);
    // A newly titled player is congratulated (and liked a little more)
    const titleNews = NpcDisposition.notePlayerTitle(npc, _getPlayerTitle());
    mem.timesSpoken++;

    let greeting = _getGreeting(npc);
    if (titleNews.changed && !mem.grudge && !mem.threatened) {
        greeting = `I hear you're ${titleNews.title} now — congratulations! ` + greeting;
    }
    dialogState._lines = [{
        speaker: npc.name,
        icon: npc.icon,
        text: greeting,
        isNpc: true,
    }];
    dialogState._lineIndex = 0;

    // LLM voice (Spec 2): for major NPCs, when the brain is enabled, request a
    // bespoke greeting and swap it in when it arrives. The template shows
    // immediately and stays if the model is off, slow, or offline.
    if (typeof NpcBrain !== 'undefined' && NpcBrain.isEnabled() && NpcBrain.isMajor(npc)) {
        const disposition = _dispositionLabel(mem.disposition || 0);
        NpcBrain.generateNpcLine(npc, { topic: 'a fitting greeting', disposition, fallback: greeting })
            .then((line) => {
                // Only swap if the dialog is still open on the greeting line.
                if (!line || line === greeting) return;
                if (dialogState._lineIndex !== 0 || !dialogState._lines[0]) return;
                dialogState._lines[0].text = line;
                const box = dialogState._overlay && dialogState._overlay.querySelector('.npc-dialog-box');
                const textEl = box && box.querySelector('.npc-dialog-text');
                if (textEl) {
                    textEl.textContent = '';
                    dialogState._typewriteComplete = false;
                    _typewrite(textEl, line, 0);
                }
            })
            .catch(() => { /* keep the template greeting */ });
    }
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

    // A terrified or hateful NPC won't talk — only amends (a gift) or leaving
    if ((mem.threatened || mem.grudge) && mem.disposition < 15) {
        if (dialogState._game?.player?.gold > 0 || _hasGiftableInventory()) {
            choices.push({ icon: '🎁', label: 'Let me make amends.', action: 'give_gift', tooltip: 'Gifts are the only way back into their good graces' });
        }
        choices.push({ icon: '👋', label: 'Farewell.', action: 'farewell' });
        for (const choice of choices) {
            const btn = document.createElement('button');
            btn.className = 'npc-dialog-choice';
            btn.innerHTML = `<span class="npc-dialog-choice-icon">${choice.icon}</span> ${choice.label}`;
            if (choice.tooltip) btn.title = choice.tooltip;
            btn.addEventListener('click', () => _handleChoice(choice.action));
            choicesEl.appendChild(btn);
        }
        return;
    }

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
        const pm = NpcDisposition.getPriceModifiers(dialogState._npc);
        if (pm.refuses) {
            choices.push({ icon: '🚫', label: 'Show me your wares.', action: 'trade', tooltip: pm.refuseReason });
        } else {
            const why = pm.reasons.map(r => `${r.label} ${r.pct > 0 ? '+' : ''}${r.pct}%`).join(', ');
            const tag = pm.pct === 0 ? '' : ` (${pm.pct > 0 ? '+' : ''}${pm.pct}% prices)`;
            choices.push({ icon: '💰', label: `Show me your wares.${tag}`, action: 'trade', tooltip: why ? `Prices: ${why}` : 'Fair prices' });
        }
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
        const baseDifficulty = npcType === 'guard' || npcType === 'blacksmith_npc' ? 5 : npcType === 'noble' ? 4 : 2;
        const difficulty = dialogState._npc ? NpcDisposition.threatDifficulty(dialogState._npc, baseDifficulty) : baseDifficulty;
        const cowed = difficulty < baseDifficulty ? ' | 😨 Already afraid of you — easier to cow' : '';
        const chance = Math.min(100, Math.round((combatTotal / difficulty) * 100));
        choices.push({
            icon: '😠',
            label: `[Intimidate — Combat ${combatTotal}/${difficulty}] Watch your tongue.`,
            action: 'threat',
            skillTag: chance >= 100 ? 'guaranteed' : chance >= 60 ? 'likely' : 'risky',
            tooltip: `${chance}% chance${cowed} | Success: they hand over coin | ⚠ Lowers disposition, they may report you to the guard`,
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
            tooltip: `${chance}% chance | Requires Warm+ disposition | They may share a map, a cache, true intel or a discount`,
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
